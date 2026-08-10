use std::{
    collections::VecDeque,
    fs::File,
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    thread,
    time::Instant,
};

use aho_corasick::{AhoCorasick, AhoCorasickBuilder};
use flate2::read::GzDecoder;
use once_cell::sync::Lazy;
use rars::ArchiveReader;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

use crate::{
    models::SearchMode,
    storage::{AppState, JobControl},
};

const DIRECT_SEARCH_EVENT: &str = "direct-search-progress";
const MAX_INPUT_PATHS: usize = 64;
const MAX_SOURCE_FILES: usize = 250_000;
const MAX_RESULTS: usize = 5_000;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_DECOMPRESSION_RATIO: u64 = 250;
const MIN_DECOMPRESSION_LIMIT: u64 = 8 * 1024 * 1024 * 1024;
const HIT_BATCH_SIZE: usize = 20;

static EMAIL_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b([a-z0-9._%+\-])([a-z0-9._%+\-]*)@([a-z0-9.\-]+\.[a-z]{2,})\b")
        .expect("email redaction pattern")
});
static SECRET_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(password|passwd|pwd|token|cookie|secret|api[_-]?key)\s*[:=]\s*[^\s,;|]+")
        .expect("secret redaction pattern")
});
static EMAIL_SECRET_PAIR_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\s*:\s*([^:\s,;|]+)")
        .expect("email credential-pair redaction pattern")
});
static PHONE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:\+?[0-9][0-9 ()-]{5,}[0-9])").expect("phone redaction pattern"));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchRequest {
    pub paths: Vec<String>,
    pub query: String,
    pub mode: SearchMode,
    pub case_sensitive: bool,
    pub include_archives: bool,
    pub max_results: usize,
    pub worker_limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchStart {
    pub job_id: String,
    pub source_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchHit {
    pub id: String,
    pub source_path: String,
    pub source_file: String,
    pub archive_entry: Option<String>,
    pub source_location: String,
    pub excerpt: String,
    pub match_reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchProgress {
    pub job_id: String,
    pub status: String,
    pub current_source: Option<String>,
    pub source_count: usize,
    pub files_scanned: usize,
    pub total_bytes: u64,
    pub content_bytes_scanned: u64,
    pub matches: usize,
    pub elapsed_ms: u64,
    pub bytes_per_second: u64,
    pub truncated: bool,
    pub message: String,
    pub hits: Vec<DirectSearchHit>,
}

#[derive(Clone)]
struct Candidate {
    path: PathBuf,
    size: u64,
}

struct SharedScan {
    app: AppHandle,
    job_id: String,
    request: DirectSearchRequest,
    matcher: QueryMatcher,
    control: Arc<JobControl>,
    source_count: usize,
    total_bytes: u64,
    started: Instant,
    files_scanned: AtomicUsize,
    content_bytes_scanned: AtomicU64,
    matches: AtomicUsize,
    stop: AtomicBool,
}

struct QueryMatcher {
    literal: Option<AhoCorasick>,
    flexible_name: Option<(AhoCorasick, usize)>,
    needle: Vec<u8>,
    mode: SearchMode,
    case_sensitive: bool,
}

impl QueryMatcher {
    fn new(query: &str, mode: SearchMode, case_sensitive: bool) -> Result<Self, String> {
        let needle = query.as_bytes().to_vec();
        let name_tokens = if matches!(mode, SearchMode::Contains) {
            flexible_ascii_name_tokens(query)
        } else {
            None
        };
        let flexible_name = name_tokens
            .as_ref()
            .map(|tokens| {
                AhoCorasickBuilder::new()
                    .ascii_case_insensitive(!case_sensitive)
                    .build(tokens)
                    .map(|matcher| (matcher, tokens.len()))
                    .map_err(|_| "the name search could not be compiled".to_string())
            })
            .transpose()?;
        let literal = if query.is_ascii() {
            Some(
                AhoCorasickBuilder::new()
                    .ascii_case_insensitive(!case_sensitive)
                    .build([query])
                    .map_err(|_| "the live search query could not be compiled".to_string())?,
            )
        } else {
            None
        };
        Ok(Self {
            literal,
            flexible_name,
            needle,
            mode,
            case_sensitive,
        })
    }

    fn matches(&self, line: &[u8]) -> bool {
        if let Some((matcher, pattern_count)) = &self.flexible_name {
            let mut found = 0_u8;
            for matched in matcher.find_iter(line) {
                found |= 1_u8 << matched.pattern().as_usize();
                if found.count_ones() as usize == *pattern_count {
                    return true;
                }
            }
            return false;
        }
        if let Some(literal) = &self.literal {
            return match self.mode {
                SearchMode::Contains => literal.is_match(line),
                SearchMode::Prefix => literal.find_iter(line).any(|matched| {
                    matched.start() == 0 || is_field_boundary(line[matched.start() - 1])
                }),
                SearchMode::Exact => literal.find_iter(line).any(|matched| {
                    (matched.start() == 0 || is_field_boundary(line[matched.start() - 1]))
                        && (matched.end() == line.len() || is_field_boundary(line[matched.end()]))
                }),
            };
        }

        let text = String::from_utf8_lossy(line);
        let query = String::from_utf8_lossy(&self.needle);
        let (haystack, needle) = if self.case_sensitive {
            (text.into_owned(), query.into_owned())
        } else {
            (text.to_lowercase(), query.to_lowercase())
        };
        match self.mode {
            SearchMode::Contains => haystack.contains(&needle),
            SearchMode::Prefix => field_tokens(&haystack).any(|token| token.starts_with(&needle)),
            SearchMode::Exact => field_tokens(&haystack).any(|token| token == needle),
        }
    }

    fn is_flexible_name(&self) -> bool {
        self.flexible_name.is_some()
    }
}

fn flexible_ascii_name_tokens(value: &str) -> Option<Vec<String>> {
    let mut tokens = value
        .split_whitespace()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    tokens.dedup();
    if !(2..=4).contains(&tokens.len())
        || tokens
            .iter()
            .any(|token| token.len() < 2 || !token.bytes().all(|byte| byte.is_ascii_alphabetic()))
    {
        return None;
    }
    Some(tokens)
}

fn is_field_boundary(byte: u8) -> bool {
    byte.is_ascii_whitespace()
        || matches!(
            byte,
            b'|' | b',' | b';' | b'=' | b':' | b'"' | b'\'' | b'[' | b']' | b'(' | b')'
        )
}

impl SharedScan {
    fn should_stop(&self) -> bool {
        self.stop.load(Ordering::Relaxed) || self.control.is_cancelled()
    }

    fn add_content_bytes(&self, bytes: u64) {
        self.content_bytes_scanned
            .fetch_add(bytes, Ordering::Relaxed);
    }

    fn reserve_hit(&self) -> bool {
        loop {
            let current = self.matches.load(Ordering::Relaxed);
            if current >= self.request.max_results {
                self.stop.store(true, Ordering::Relaxed);
                return false;
            }
            if self
                .matches
                .compare_exchange_weak(current, current + 1, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                if current + 1 >= self.request.max_results {
                    self.stop.store(true, Ordering::Relaxed);
                }
                return true;
            }
        }
    }

    fn emit(
        &self,
        status: &str,
        current_source: Option<String>,
        message: &str,
        hits: Vec<DirectSearchHit>,
    ) {
        let elapsed_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let content_bytes_scanned = self.content_bytes_scanned.load(Ordering::Relaxed);
        let bytes_per_second = content_bytes_scanned
            .saturating_mul(1_000)
            .checked_div(elapsed_ms)
            .unwrap_or(0);
        let matches = self.matches.load(Ordering::Relaxed);
        let _ = self.app.emit(
            DIRECT_SEARCH_EVENT,
            DirectSearchProgress {
                job_id: self.job_id.clone(),
                status: status.to_string(),
                current_source,
                source_count: self.source_count,
                files_scanned: self.files_scanned.load(Ordering::Relaxed),
                total_bytes: self.total_bytes,
                content_bytes_scanned,
                matches,
                elapsed_ms,
                bytes_per_second,
                truncated: matches >= self.request.max_results,
                message: message.to_string(),
                hits,
            },
        );
    }
}

#[tauri::command]
pub fn start_direct_search(
    app: AppHandle,
    state: State<'_, AppState>,
    mut request: DirectSearchRequest,
) -> Result<DirectSearchStart, String> {
    request.query = request.query.trim().to_string();
    if request.query.len() < 2 || request.query.len() > 512 {
        return Err("live searches require between 2 and 512 characters".to_string());
    }
    if request.paths.is_empty() || request.paths.len() > MAX_INPUT_PATHS {
        return Err("choose between 1 and 64 local sources".to_string());
    }
    request.max_results = request.max_results.clamp(1, MAX_RESULTS);
    request.worker_limit = request.worker_limit.clamp(1, 8);
    let matcher = QueryMatcher::new(&request.query, request.mode, request.case_sensitive)?;

    let candidates = collect_candidates(&request.paths, request.include_archives)?;
    if candidates.is_empty() {
        return Err("no supported local text or archive sources were found".to_string());
    }
    let total_bytes = candidates.iter().fold(0_u64, |total, candidate| {
        total.saturating_add(candidate.size)
    });
    let source_count = candidates.len();
    let job_id = Uuid::new_v4().to_string();
    let control = Arc::new(JobControl::default());
    state
        .jobs
        .lock()
        .map_err(|_| "search controls are unavailable".to_string())?
        .insert(job_id.clone(), Arc::clone(&control));

    let jobs = Arc::clone(&state.jobs);
    let worker_job_id = job_id.clone();
    thread::Builder::new()
        .name("aletheia-live-search".to_string())
        .spawn(move || {
            let shared = Arc::new(SharedScan {
                app,
                job_id: worker_job_id.clone(),
                request,
                matcher,
                control,
                source_count,
                total_bytes,
                started: Instant::now(),
                files_scanned: AtomicUsize::new(0),
                content_bytes_scanned: AtomicU64::new(0),
                matches: AtomicUsize::new(0),
                stop: AtomicBool::new(false),
            });
            shared.emit("running", None, "Scanning local sources", Vec::new());
            let result = run_scan(candidates, Arc::clone(&shared));
            if shared.control.is_cancelled() {
                shared.emit("cancelled", None, "Live search cancelled", Vec::new());
            } else if let Err(error) = result {
                shared.emit("failed", None, &error, Vec::new());
            } else {
                let message =
                    if shared.matches.load(Ordering::Relaxed) >= shared.request.max_results {
                        "Result limit reached"
                    } else {
                        "Live search complete"
                    };
                shared.emit("completed", None, message, Vec::new());
            }
            if let Ok(mut active) = jobs.lock() {
                active.remove(&worker_job_id);
            }
        })
        .map_err(|_| "live search worker could not start".to_string())?;

    Ok(DirectSearchStart {
        job_id,
        source_count,
        total_bytes,
    })
}

#[tauri::command]
pub fn cancel_direct_search(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let jobs = state
        .jobs
        .lock()
        .map_err(|_| "search controls are unavailable".to_string())?;
    let control = jobs
        .get(&job_id)
        .ok_or_else(|| "live search is no longer active".to_string())?;
    control.cancel();
    Ok(())
}

fn collect_candidates(paths: &[String], include_archives: bool) -> Result<Vec<Candidate>, String> {
    let mut candidates = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        let canonical = path
            .canonicalize()
            .map_err(|_| "a selected source is unavailable".to_string())?;
        if canonical.is_file() {
            maybe_add_candidate(&mut candidates, canonical, include_archives)?;
        } else if canonical.is_dir() {
            for entry in WalkDir::new(&canonical).follow_links(false).into_iter() {
                let entry = entry.map_err(|_| "a source folder could not be read".to_string())?;
                if entry.file_type().is_file() {
                    maybe_add_candidate(
                        &mut candidates,
                        entry.path().to_path_buf(),
                        include_archives,
                    )?;
                    if candidates.len() >= MAX_SOURCE_FILES {
                        return Err(
                            "source selection exceeds the 250,000 file safety limit".to_string()
                        );
                    }
                }
            }
        }
    }
    candidates.sort_by(|left, right| left.path.cmp(&right.path));
    candidates.dedup_by(|left, right| left.path == right.path);
    Ok(candidates)
}

fn maybe_add_candidate(
    candidates: &mut Vec<Candidate>,
    path: PathBuf,
    include_archives: bool,
) -> Result<(), String> {
    let extension = extension(&path);
    let supported = is_text_extension(&extension)
        || extension == "gz"
        || (include_archives && matches!(extension.as_str(), "zip" | "rar"));
    if supported {
        let size = path
            .metadata()
            .map_err(|_| "source metadata is unavailable".to_string())?
            .len();
        candidates.push(Candidate { path, size });
    }
    Ok(())
}

fn run_scan(candidates: Vec<Candidate>, shared: Arc<SharedScan>) -> Result<(), String> {
    let queue = Arc::new(Mutex::new(VecDeque::from(candidates)));
    let first_error = Arc::new(Mutex::new(None::<String>));
    let workers = shared.request.worker_limit.min(shared.source_count).max(1);
    thread::scope(|scope| {
        for _ in 0..workers {
            let queue = Arc::clone(&queue);
            let shared = Arc::clone(&shared);
            let first_error = Arc::clone(&first_error);
            scope.spawn(move || {
                loop {
                    if shared.should_stop() {
                        break;
                    }
                    let candidate = match queue.lock() {
                        Ok(mut queue) => queue.pop_front(),
                        Err(_) => None,
                    };
                    let Some(candidate) = candidate else { break };
                    let source_name = file_name(&candidate.path);
                    shared.emit(
                        "running",
                        Some(source_name.clone()),
                        "Scanning local sources",
                        Vec::new(),
                    );
                    let result = scan_candidate(&candidate, &shared);
                    shared.files_scanned.fetch_add(1, Ordering::Relaxed);
                    shared.emit(
                        "running",
                        Some(source_name),
                        "Scanning local sources",
                        Vec::new(),
                    );
                    if let Err(error) = result
                        && !shared.should_stop()
                        && let Ok(mut slot) = first_error.lock()
                        && slot.is_none()
                    {
                        *slot = Some(error);
                    }
                }
            });
        }
    });
    first_error
        .lock()
        .map_err(|_| "live search worker state is unavailable".to_string())?
        .take()
        .map_or(Ok(()), Err)
}

fn scan_candidate(candidate: &Candidate, shared: &Arc<SharedScan>) -> Result<(), String> {
    match extension(&candidate.path).as_str() {
        "gz" => scan_gzip(candidate, shared),
        "zip" => scan_zip(candidate, shared),
        "rar" => scan_rar(candidate, shared),
        _ => scan_plain(candidate, shared),
    }
}

fn scan_plain(candidate: &Candidate, shared: &Arc<SharedScan>) -> Result<(), String> {
    let file = File::open(&candidate.path)
        .map_err(|_| "a source could not be opened read-only".to_string())?;
    scan_reader(
        BufReader::with_capacity(1024 * 1024, file),
        &candidate.path.to_string_lossy(),
        &file_name(&candidate.path),
        None,
        shared,
    )
}

fn scan_gzip(candidate: &Candidate, shared: &Arc<SharedScan>) -> Result<(), String> {
    let file = File::open(&candidate.path)
        .map_err(|_| "a compressed source could not be opened read-only".to_string())?;
    let decoder = GzDecoder::new(file);
    scan_reader(
        BufReader::with_capacity(1024 * 1024, decoder),
        &candidate.path.to_string_lossy(),
        &file_name(&candidate.path),
        None,
        shared,
    )
}

fn scan_zip(candidate: &Candidate, shared: &Arc<SharedScan>) -> Result<(), String> {
    let file = File::open(&candidate.path)
        .map_err(|_| "a ZIP source could not be opened read-only".to_string())?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| "a ZIP source is invalid or unsupported".to_string())?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("a ZIP source exceeds the 100,000 entry safety limit".to_string());
    }
    let decompression_limit = candidate
        .size
        .saturating_mul(MAX_DECOMPRESSION_RATIO)
        .max(MIN_DECOMPRESSION_LIMIT);
    let mut declared_bytes = 0_u64;
    for index in 0..archive.len() {
        let Ok(entry) = archive.by_index(index) else {
            continue;
        };
        declared_bytes = declared_bytes.saturating_add(entry.size());
        if declared_bytes > decompression_limit {
            return Err("a ZIP source exceeded the safe decompression limit".to_string());
        }
    }
    for index in 0..archive.len() {
        if shared.should_stop() {
            break;
        }
        let entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let Some(entry_path) = entry.enclosed_name() else {
            continue;
        };
        if !is_text_extension(&extension(&entry_path)) {
            continue;
        }
        let entry_name = entry_path.to_string_lossy().into_owned();
        scan_reader(
            BufReader::with_capacity(1024 * 1024, entry),
            &candidate.path.to_string_lossy(),
            &file_name(&candidate.path),
            Some(entry_name),
            shared,
        )?;
    }
    Ok(())
}

fn scan_rar(candidate: &Candidate, shared: &Arc<SharedScan>) -> Result<(), String> {
    let archive = ArchiveReader::read_path(&candidate.path)
        .map_err(|_| "a RAR source is invalid, encrypted, split, or unsupported".to_string())?;
    let decompression_limit = candidate
        .size
        .saturating_mul(MAX_DECOMPRESSION_RATIO)
        .max(MIN_DECOMPRESSION_LIMIT);
    let mut declared_bytes = 0_u64;
    let mut entries = 0_usize;
    let mut encrypted_text_entry = false;
    for member in archive.members() {
        if member.meta.is_directory
            || !is_text_extension(&extension(Path::new(&member.meta.name_lossy())))
        {
            continue;
        }
        if member.meta.is_encrypted {
            encrypted_text_entry = true;
            continue;
        }
        entries += 1;
        declared_bytes = declared_bytes.saturating_add(member.meta.unpacked_size);
        if entries > MAX_ARCHIVE_ENTRIES || declared_bytes > decompression_limit {
            return Err("a RAR source exceeded archive safety limits".to_string());
        }
    }
    if encrypted_text_entry {
        return Err("encrypted RAR text entries require an unlocked copy".to_string());
    }
    let archive_path = candidate.path.to_string_lossy().into_owned();
    let archive_name = file_name(&candidate.path);
    let shared_for_writers = Arc::clone(shared);
    let extraction = archive.extract_to(None, move |meta| {
        let entry_name = meta.name_lossy();
        if meta.is_directory || !is_text_extension(&extension(Path::new(&entry_name))) {
            return Ok(Box::new(io::sink()));
        }
        Ok(Box::new(RarLineWriter::new(
            archive_path.clone(),
            archive_name.clone(),
            entry_name,
            Arc::clone(&shared_for_writers),
        )))
    });
    if extraction.is_err() && !shared.should_stop() {
        return Err("a RAR entry could not be streamed safely".to_string());
    }
    Ok(())
}

fn scan_reader<R: BufRead>(
    mut reader: R,
    source_path: &str,
    source_file: &str,
    archive_entry: Option<String>,
    shared: &Arc<SharedScan>,
) -> Result<(), String> {
    let mut line = Vec::with_capacity(4096);
    let mut line_number = 0_u64;
    let mut hits = Vec::new();
    loop {
        if shared.should_stop() {
            break;
        }
        let (bytes, exceeded) = read_bounded_line(&mut reader, &mut line)?;
        if bytes == 0 {
            break;
        }
        shared.add_content_bytes(bytes);
        line_number += 1;
        if exceeded || line.is_empty() {
            continue;
        }
        if let Some(hit) = make_hit(
            source_path,
            source_file,
            archive_entry.as_deref(),
            line_number,
            &line,
            shared,
        ) {
            hits.push(hit);
            if hits.len() >= HIT_BATCH_SIZE {
                shared.emit(
                    "running",
                    Some(source_file.to_string()),
                    "Matches found",
                    std::mem::take(&mut hits),
                );
            }
        }
    }
    if !hits.is_empty() {
        shared.emit(
            "running",
            Some(source_file.to_string()),
            "Matches found",
            hits,
        );
    }
    Ok(())
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    line: &mut Vec<u8>,
) -> Result<(u64, bool), String> {
    line.clear();
    let mut consumed = 0_u64;
    let mut exceeded = false;
    loop {
        let available = reader
            .fill_buf()
            .map_err(|_| "source read failed".to_string())?;
        if available.is_empty() {
            break;
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |index| index + 1);
        consumed = consumed.saturating_add(take as u64);
        if line.len() < MAX_LINE_BYTES + 2 {
            let copy = take.min(MAX_LINE_BYTES + 2 - line.len());
            line.extend_from_slice(&available[..copy]);
            exceeded |= copy < take;
        } else {
            exceeded = true;
        }
        reader.consume(take);
        if newline.is_some() {
            break;
        }
    }
    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    Ok((consumed, exceeded || line.len() > MAX_LINE_BYTES))
}

fn make_hit(
    source_path: &str,
    source_file: &str,
    archive_entry: Option<&str>,
    line_number: u64,
    line: &[u8],
    shared: &Arc<SharedScan>,
) -> Option<DirectSearchHit> {
    if !shared.matcher.matches(line) {
        return None;
    }
    if !shared.reserve_hit() {
        return None;
    }
    Some(DirectSearchHit {
        id: Uuid::new_v4().to_string(),
        source_path: source_path.to_string(),
        source_file: source_file.to_string(),
        archive_entry: archive_entry.map(ToString::to_string),
        source_location: format!("line {line_number}"),
        excerpt: mask_excerpt(&String::from_utf8_lossy(line)),
        match_reason: if shared.matcher.is_flexible_name() {
            "Name tokens found"
        } else {
            match shared.request.mode {
                SearchMode::Exact => "Exact field match",
                SearchMode::Prefix => "Field prefix match",
                SearchMode::Contains => "Line contains query",
            }
        }
        .to_string(),
    })
}

#[cfg(test)]
fn line_matches(text: &str, query: &str, mode: SearchMode, case_sensitive: bool) -> bool {
    QueryMatcher::new(query, mode, case_sensitive)
        .is_ok_and(|matcher| matcher.matches(text.as_bytes()))
}

fn field_tokens(value: &str) -> impl Iterator<Item = &str> {
    value
        .split(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '|' | ',' | ';' | '=' | '"' | '\'' | '[' | ']' | '(' | ')'
                )
        })
        .flat_map(|token| token.split(':'))
        .map(|token| token.trim())
        .filter(|token| !token.is_empty())
}

fn mask_excerpt(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    let secrets = SECRET_PATTERN.replace_all(&normalized, "$1=[REDACTED]");
    let pairs = EMAIL_SECRET_PAIR_PATTERN.replace_all(&secrets, "$1:[REDACTED]");
    let emails = EMAIL_PATTERN.replace_all(&pairs, |captures: &regex::Captures<'_>| {
        format!("{}•••@{}", &captures[1], &captures[3])
    });
    let phones = PHONE_PATTERN.replace_all(&emails, |captures: &regex::Captures<'_>| {
        let value = captures.get(0).map_or("", |matched| matched.as_str());
        let digits = value
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>();
        if !(7..=16).contains(&digits.len()) {
            return value.to_string();
        }
        format!("•••{}", &digits[digits.len().saturating_sub(2)..])
    });
    let mut excerpt: String = phones.chars().take(360).collect();
    if phones.chars().count() > 360 {
        excerpt.push('…');
    }
    excerpt
}

struct RarLineWriter {
    source_path: String,
    source_file: String,
    archive_entry: String,
    shared: Arc<SharedScan>,
    pending: Vec<u8>,
    discarding: bool,
    line_number: u64,
    hits: Vec<DirectSearchHit>,
}

impl RarLineWriter {
    fn new(
        source_path: String,
        source_file: String,
        archive_entry: String,
        shared: Arc<SharedScan>,
    ) -> Self {
        Self {
            source_path,
            source_file,
            archive_entry,
            shared,
            pending: Vec::with_capacity(4096),
            discarding: false,
            line_number: 0,
            hits: Vec::new(),
        }
    }

    fn finish_line(&mut self) {
        while matches!(self.pending.last(), Some(b'\r')) {
            self.pending.pop();
        }
        self.line_number += 1;
        if let Some(hit) = make_hit(
            &self.source_path,
            &self.source_file,
            Some(&self.archive_entry),
            self.line_number,
            &self.pending,
            &self.shared,
        ) {
            self.hits.push(hit);
            if self.hits.len() >= HIT_BATCH_SIZE {
                self.shared.emit(
                    "running",
                    Some(self.source_file.clone()),
                    "Matches found",
                    std::mem::take(&mut self.hits),
                );
            }
        }
        self.pending.clear();
    }

    fn flush_hits(&mut self) {
        if !self.hits.is_empty() {
            self.shared.emit(
                "running",
                Some(self.source_file.clone()),
                "Matches found",
                std::mem::take(&mut self.hits),
            );
        }
    }
}

impl Write for RarLineWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if self.shared.should_stop() {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "live search stopped",
            ));
        }
        self.shared.add_content_bytes(buffer.len() as u64);
        for byte in buffer {
            if self.discarding {
                if *byte == b'\n' {
                    self.discarding = false;
                    self.line_number += 1;
                }
                continue;
            }
            if *byte == b'\n' {
                self.finish_line();
            } else if self.pending.len() < MAX_LINE_BYTES {
                self.pending.push(*byte);
            } else {
                self.pending.clear();
                self.discarding = true;
            }
        }
        if self.shared.should_stop() {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "live search stopped",
            ));
        }
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for RarLineWriter {
    fn drop(&mut self) {
        if !self.discarding && !self.pending.is_empty() {
            self.finish_line();
        }
        self.flush_hits();
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_text_extension(extension: &str) -> bool {
    matches!(
        extension,
        "txt" | "csv" | "tsv" | "jsonl" | "ndjson" | "log"
    )
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("local source")
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        sync::{Arc, Mutex},
    };

    use rars::rar15_40::{StoredEntry, WriterOptions, write_stored_archive};
    use tempfile::tempdir;
    use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

    use super::{ArchiveReader, field_tokens, line_matches, mask_excerpt};
    use crate::models::SearchMode;

    #[test]
    fn automatic_identifier_matching_uses_field_boundaries() {
        assert!(line_matches(
            "synthetic@example.com:invented-value",
            "synthetic@example.com",
            SearchMode::Exact,
            false,
        ));
        assert!(!line_matches(
            "prefix-synthetic@example.com-suffix",
            "synthetic@example.com",
            SearchMode::Exact,
            false,
        ));
        assert!(line_matches(
            "portal.example.com/path",
            "example.com",
            SearchMode::Contains,
            false,
        ));
        assert!(line_matches(
            "url=https://portal.example.com/path|status=synthetic",
            "https://portal.example.com/path",
            SearchMode::Exact,
            false,
        ));
        assert!(line_matches(
            "url=https://portal.example.com/path|status=synthetic",
            "https://portal.example",
            SearchMode::Prefix,
            false,
        ));
    }

    #[test]
    fn name_search_matches_columns_and_email_local_parts() {
        assert!(line_matches(
            "John,Doe,john.doe@example.test",
            "john doe",
            SearchMode::Contains,
            false,
        ));
        assert!(!line_matches(
            "John,Smith,john.smith@example.test",
            "john doe",
            SearchMode::Contains,
            false,
        ));
    }

    #[test]
    fn excerpts_mask_email_and_secret_labels() {
        let masked = mask_excerpt(
            "synthetic@example.com:invented-value password=invented-secret +1 202 555 0142",
        );
        assert!(masked.contains("s•••@example.com"));
        assert!(masked.contains("s•••@example.com:[REDACTED]"));
        assert!(masked.contains("password=[REDACTED]"));
        assert!(!masked.contains("invented-secret"));
        assert!(!masked.contains("invented-value"));
        assert!(masked.contains("•••42"));
    }

    #[test]
    fn zip_fixture_is_searched_without_extracting_to_disk() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("synthetic.zip");
        let file = std::fs::File::create(&destination).expect("zip destination");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("synthetic.txt", SimpleFileOptions::default())
            .expect("zip entry");
        writer
            .write_all(b"synthetic@example.com:invented-value\n")
            .expect("zip payload");
        writer.finish().expect("finish zip");
        let mut archive = ZipArchive::new(
            std::fs::File::open(&destination).expect("open synthetic archive read-only"),
        )
        .expect("read synthetic archive");
        let mut entry = archive.by_index(0).expect("synthetic entry");
        let mut contents = String::new();
        entry.read_to_string(&mut contents).expect("stream entry");
        assert!(line_matches(
            &contents,
            "synthetic@example.com",
            SearchMode::Exact,
            false,
        ));
        assert_eq!(
            std::fs::read_dir(directory.path())
                .expect("list temporary directory")
                .count(),
            1,
            "the archive must not be extracted beside the source",
        );
        assert_eq!(
            field_tokens("a|b:c").collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
    }

    struct SharedBuffer(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedBuffer {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .expect("lock synthetic buffer")
                .extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn rar_fixture_streams_to_a_writer_without_extraction() {
        let directory = tempdir().expect("temporary directory");
        let destination = directory.path().join("synthetic.rar");
        let payload = b"synthetic@example.com:invented-value\n";
        let bytes = write_stored_archive(
            &[StoredEntry {
                name: b"synthetic.txt",
                data: payload,
                file_time: 0,
                file_attr: 0,
                host_os: 2,
                password: None,
                file_comment: None,
            }],
            WriterOptions::default(),
        )
        .expect("build synthetic RAR");
        std::fs::write(&destination, bytes).expect("write synthetic RAR fixture");

        let archive = ArchiveReader::read_path(&destination).expect("read synthetic RAR");
        let output = Arc::new(Mutex::new(Vec::new()));
        let writer_output = Arc::clone(&output);
        archive
            .extract_to(None, move |_| {
                Ok(Box::new(SharedBuffer(Arc::clone(&writer_output))))
            })
            .expect("stream synthetic RAR entry");
        let contents = String::from_utf8(
            output
                .lock()
                .expect("lock extracted synthetic bytes")
                .clone(),
        )
        .expect("synthetic UTF-8");
        assert!(line_matches(
            &contents,
            "synthetic@example.com",
            SearchMode::Exact,
            false,
        ));
        assert_eq!(
            std::fs::read_dir(directory.path())
                .expect("list temporary directory")
                .count(),
            1,
            "the RAR must not be extracted beside the source",
        );
    }
}
