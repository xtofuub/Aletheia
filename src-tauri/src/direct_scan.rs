use std::{
    collections::{HashSet, VecDeque},
    fs::File,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, AhoCorasickKind};
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
const MAX_QUERY_COUNT: usize = 512;
const MAX_QUERY_BYTES: usize = 64 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_DECOMPRESSION_RATIO: u64 = 250;
const MIN_DECOMPRESSION_LIMIT: u64 = 8 * 1024 * 1024 * 1024;
const HIT_BATCH_SIZE: usize = 20;
const PROGRESS_EMIT_INTERVAL_MS: u64 = 250;
const PROGRESS_BYTE_INTERVAL: u64 = 1024 * 1024;

static SECRET_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(password|passwd|pwd|token|cookie|secret|api[_-]?key)\s*[:=]\s*[^\s,;|]+")
        .expect("secret filtering pattern")
});
static EMAIL_SECRET_PAIR_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\s*:\s*([^:\s,;|]+)")
        .expect("email credential-pair filtering pattern")
});

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
    pub query_count: usize,
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
    pub matched_query: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchProgress {
    pub job_id: String,
    pub sequence: u64,
    pub status: String,
    pub current_source: Option<String>,
    pub source_count: usize,
    pub files_scanned: usize,
    pub total_bytes: u64,
    pub source_bytes_scanned: u64,
    pub content_bytes_scanned: u64,
    pub matches: usize,
    pub elapsed_ms: u64,
    pub bytes_per_second: u64,
    pub estimated_remaining_ms: Option<u64>,
    pub query_count: usize,
    pub truncated: bool,
    pub message: String,
    pub hits: Vec<DirectSearchHit>,
}

#[derive(Clone)]
struct Candidate {
    path: PathBuf,
    size: u64,
}

struct CandidateSourceProgress {
    total_bytes: u64,
    reported_bytes: AtomicU64,
    decoded_bytes: AtomicU64,
    decoded_total_bytes: AtomicU64,
}

impl CandidateSourceProgress {
    fn new(total_bytes: u64) -> Self {
        Self {
            total_bytes,
            reported_bytes: AtomicU64::new(0),
            decoded_bytes: AtomicU64::new(0),
            decoded_total_bytes: AtomicU64::new(0),
        }
    }

    fn active_limit(&self) -> u64 {
        self.total_bytes.saturating_sub(1)
    }

    fn advance_to(&self, target: u64, completed: bool) -> u64 {
        let limit = if completed {
            self.total_bytes
        } else {
            self.active_limit()
        };
        let target = target.min(limit);
        loop {
            let current = self.reported_bytes.load(Ordering::Relaxed);
            if target <= current {
                return 0;
            }
            if self
                .reported_bytes
                .compare_exchange_weak(current, target, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                return target.saturating_sub(current);
            }
        }
    }

    fn add_physical_bytes(&self, bytes: u64, shared: &SharedScan) {
        if bytes == 0 {
            return;
        }
        let current = self.reported_bytes.load(Ordering::Relaxed);
        let added = self.advance_to(current.saturating_add(bytes), false);
        shared.add_source_bytes(added);
    }

    fn set_decoded_total(&self, total: u64) {
        self.decoded_total_bytes.store(total, Ordering::Relaxed);
    }

    fn add_decoded_bytes(&self, bytes: u64, shared: &SharedScan) {
        let total = self.decoded_total_bytes.load(Ordering::Relaxed);
        if bytes == 0 || total == 0 {
            return;
        }
        let decoded = self
            .decoded_bytes
            .fetch_add(bytes, Ordering::Relaxed)
            .saturating_add(bytes)
            .min(total);
        let target = ((self.total_bytes as u128).saturating_mul(decoded as u128) / total as u128)
            .min(u64::MAX as u128) as u64;
        let added = self.advance_to(target, false);
        shared.add_source_bytes(added);
    }

    fn complete(&self, shared: &SharedScan) {
        let added = self.advance_to(self.total_bytes, true);
        shared.add_source_bytes(added);
    }
}

struct SourceProgressReader<R> {
    inner: R,
    progress: Arc<CandidateSourceProgress>,
    shared: Arc<SharedScan>,
}

impl<R> SourceProgressReader<R> {
    fn new(inner: R, progress: Arc<CandidateSourceProgress>, shared: Arc<SharedScan>) -> Self {
        Self {
            inner,
            progress,
            shared,
        }
    }
}

impl<R: Read> Read for SourceProgressReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let bytes = self.inner.read(buffer)?;
        self.progress.add_physical_bytes(bytes as u64, &self.shared);
        Ok(bytes)
    }
}

impl<R: Seek> Seek for SourceProgressReader<R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
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
    source_bytes_scanned: AtomicU64,
    content_bytes_scanned: AtomicU64,
    matches: AtomicUsize,
    stop: AtomicBool,
    last_progress_emit_ms: AtomicU64,
    pause_announced: AtomicBool,
    pause_started_ms: AtomicU64,
    paused_total_ms: AtomicU64,
    sequence: AtomicU64,
}

struct QueryMatcher {
    literal: Option<AhoCorasick>,
    literal_query_indices: Vec<usize>,
    unicode_queries: Vec<(usize, String)>,
    flexible_name: Option<(AhoCorasick, usize)>,
    queries: Vec<String>,
    mode: SearchMode,
    case_sensitive: bool,
}

impl QueryMatcher {
    fn new(query: &str, mode: SearchMode, case_sensitive: bool) -> Result<Self, String> {
        let queries = parse_queries(query, case_sensitive)?;
        let name_tokens = if queries.len() == 1 && matches!(mode, SearchMode::Contains) {
            flexible_ascii_name_tokens(&queries[0])
        } else {
            None
        };
        let flexible_name = name_tokens
            .as_ref()
            .map(|tokens| {
                AhoCorasickBuilder::new()
                    .kind(Some(AhoCorasickKind::DFA))
                    .ascii_case_insensitive(!case_sensitive)
                    .build(tokens)
                    .map(|matcher| (matcher, tokens.len()))
                    .map_err(|_| "the name search could not be compiled".to_string())
            })
            .transpose()?;
        let literal_query_indices = queries
            .iter()
            .enumerate()
            .filter_map(|(index, query)| query.is_ascii().then_some(index))
            .collect::<Vec<_>>();
        let literal = if literal_query_indices.is_empty() {
            None
        } else {
            Some(
                AhoCorasickBuilder::new()
                    .kind(Some(AhoCorasickKind::DFA))
                    .ascii_case_insensitive(!case_sensitive)
                    .build(
                        literal_query_indices
                            .iter()
                            .map(|index| queries[*index].as_bytes()),
                    )
                    .map_err(|_| "the live search query could not be compiled".to_string())?,
            )
        };
        let unicode_queries = queries
            .iter()
            .enumerate()
            .filter(|(_, query)| !query.is_ascii())
            .map(|(index, query)| {
                (
                    index,
                    if case_sensitive {
                        query.clone()
                    } else {
                        query.to_lowercase()
                    },
                )
            })
            .collect();
        Ok(Self {
            literal,
            literal_query_indices,
            unicode_queries,
            flexible_name,
            queries,
            mode,
            case_sensitive,
        })
    }

    fn find_match(&self, line: &[u8]) -> Option<usize> {
        if let Some((matcher, pattern_count)) = &self.flexible_name {
            let mut found = 0_u8;
            for matched in matcher.find_iter(line) {
                found |= 1_u8 << matched.pattern().as_usize();
                if found.count_ones() as usize == *pattern_count {
                    return Some(0);
                }
            }
            return None;
        }
        if let Some(literal) = &self.literal {
            for matched in literal.find_iter(line) {
                let valid = match self.mode {
                    SearchMode::Contains => true,
                    SearchMode::Prefix => {
                        matched.start() == 0 || is_field_boundary(line[matched.start() - 1])
                    }
                    SearchMode::Exact => {
                        (matched.start() == 0 || is_field_boundary(line[matched.start() - 1]))
                            && (matched.end() == line.len()
                                || is_field_boundary(line[matched.end()]))
                    }
                };
                if valid {
                    return self
                        .literal_query_indices
                        .get(matched.pattern().as_usize())
                        .copied();
                }
            }
        }
        if self.unicode_queries.is_empty() {
            return None;
        }
        let text = String::from_utf8_lossy(line);
        let haystack = if self.case_sensitive {
            text.into_owned()
        } else {
            text.to_lowercase()
        };
        self.unicode_queries.iter().find_map(|(index, needle)| {
            let matches = match self.mode {
                SearchMode::Contains => haystack.contains(needle),
                SearchMode::Prefix => {
                    field_tokens(&haystack).any(|token| token.starts_with(needle))
                }
                SearchMode::Exact => field_tokens(&haystack).any(|token| token == needle),
            };
            matches.then_some(*index)
        })
    }

    fn could_match_block(&self, block: &[u8]) -> bool {
        if let Some((matcher, pattern_count)) = &self.flexible_name {
            let mut found = 0_u8;
            for matched in matcher.find_iter(block) {
                found |= 1_u8 << matched.pattern().as_usize();
                if found.count_ones() as usize == *pattern_count {
                    return true;
                }
            }
            return false;
        }
        if self
            .literal
            .as_ref()
            .is_some_and(|matcher| matcher.is_match(block))
        {
            return true;
        }
        if self.unicode_queries.is_empty() {
            return false;
        }
        let text = String::from_utf8_lossy(block);
        let haystack = if self.case_sensitive {
            text.into_owned()
        } else {
            text.to_lowercase()
        };
        self.unicode_queries
            .iter()
            .any(|(_, needle)| haystack.contains(needle))
    }

    fn is_flexible_name(&self) -> bool {
        self.flexible_name.is_some()
    }

    fn query(&self, index: usize) -> &str {
        &self.queries[index]
    }

    fn query_count(&self) -> usize {
        self.queries.len()
    }
}

fn parse_queries(value: &str, case_sensitive: bool) -> Result<Vec<String>, String> {
    if value.len() > MAX_QUERY_BYTES {
        return Err("live search input is limited to 64 KiB".to_string());
    }
    let mut seen = HashSet::new();
    let mut queries = Vec::new();
    for query in value
        .lines()
        .map(str::trim)
        .filter(|query| !query.is_empty())
    {
        if query.len() < 2 || query.len() > 512 {
            return Err("each live search value requires between 2 and 512 characters".to_string());
        }
        let key = if case_sensitive {
            query.to_string()
        } else {
            query.to_lowercase()
        };
        if seen.insert(key) {
            queries.push(query.to_string());
        }
        if queries.len() > MAX_QUERY_COUNT {
            return Err("live search supports up to 512 values per scan".to_string());
        }
    }
    if queries.is_empty() {
        return Err("enter at least one live search value".to_string());
    }
    Ok(queries)
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

    fn add_source_bytes(&self, bytes: u64) {
        self.source_bytes_scanned
            .fetch_add(bytes, Ordering::Relaxed);
    }

    fn wait_until_running(&self) -> bool {
        if !self.control.is_paused() {
            return !self.should_stop();
        }
        if !self.pause_announced.swap(true, Ordering::Relaxed) {
            self.pause_started_ms.store(
                (self.started.elapsed().as_millis().min(u64::MAX as u128) as u64).max(1),
                Ordering::Relaxed,
            );
            self.emit("paused", None, "Live search paused", Vec::new());
        }
        while self.control.is_paused() && !self.should_stop() {
            thread::sleep(Duration::from_millis(100));
        }
        if !self.should_stop() && self.pause_announced.swap(false, Ordering::Relaxed) {
            let wall_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
            let pause_started_ms = self.pause_started_ms.swap(0, Ordering::Relaxed);
            self.paused_total_ms
                .fetch_add(wall_ms.saturating_sub(pause_started_ms), Ordering::Relaxed);
            self.last_progress_emit_ms.store(0, Ordering::Relaxed);
            self.emit("running", None, "Live search resumed", Vec::new());
        }
        !self.should_stop()
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
        let wall_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let pause_started_ms = self.pause_started_ms.load(Ordering::Relaxed);
        let current_pause_ms = if pause_started_ms > 0 {
            wall_ms.saturating_sub(pause_started_ms)
        } else {
            0
        };
        let elapsed_ms = active_elapsed_ms(
            wall_ms,
            self.paused_total_ms.load(Ordering::Relaxed),
            current_pause_ms,
        );
        if status == "running" && hits.is_empty() {
            let previous = self.last_progress_emit_ms.load(Ordering::Relaxed);
            if previous > 0 && elapsed_ms.saturating_sub(previous) < PROGRESS_EMIT_INTERVAL_MS {
                return;
            }
            if self
                .last_progress_emit_ms
                .compare_exchange(
                    previous,
                    elapsed_ms.max(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                )
                .is_err()
            {
                return;
            }
        }
        let source_bytes_scanned = self.source_bytes_scanned.load(Ordering::Relaxed);
        let content_bytes_scanned = self.content_bytes_scanned.load(Ordering::Relaxed);
        let bytes_per_second = content_bytes_scanned
            .saturating_mul(1_000)
            .checked_div(elapsed_ms)
            .unwrap_or(0);
        let matches = self.matches.load(Ordering::Relaxed);
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.app.emit(
            DIRECT_SEARCH_EVENT,
            DirectSearchProgress {
                job_id: self.job_id.clone(),
                sequence,
                status: status.to_string(),
                current_source,
                source_count: self.source_count,
                files_scanned: self.files_scanned.load(Ordering::Relaxed),
                total_bytes: self.total_bytes,
                source_bytes_scanned,
                content_bytes_scanned,
                matches,
                elapsed_ms,
                bytes_per_second,
                estimated_remaining_ms: estimate_remaining_ms(
                    self.total_bytes,
                    source_bytes_scanned,
                    elapsed_ms,
                ),
                query_count: self.matcher.query_count(),
                truncated: matches >= self.request.max_results,
                message: message.to_string(),
                hits,
            },
        );
    }
}

fn estimate_remaining_ms(total_bytes: u64, scanned_bytes: u64, elapsed_ms: u64) -> Option<u64> {
    if scanned_bytes == 0 || scanned_bytes >= total_bytes || elapsed_ms == 0 {
        return None;
    }
    total_bytes
        .saturating_sub(scanned_bytes)
        .saturating_mul(elapsed_ms)
        .checked_div(scanned_bytes)
}

fn active_elapsed_ms(wall_ms: u64, paused_total_ms: u64, current_pause_ms: u64) -> u64 {
    wall_ms
        .saturating_sub(paused_total_ms)
        .saturating_sub(current_pause_ms)
}

#[tauri::command]
pub async fn start_direct_search(
    app: AppHandle,
    state: State<'_, AppState>,
    mut request: DirectSearchRequest,
) -> Result<DirectSearchStart, String> {
    request.query = request.query.trim().to_string();
    if request.paths.is_empty() || request.paths.len() > MAX_INPUT_PATHS {
        return Err("choose between 1 and 64 local sources".to_string());
    }
    request.max_results = request.max_results.clamp(1, MAX_RESULTS);
    request.worker_limit = request.worker_limit.clamp(1, 8);
    let matcher = QueryMatcher::new(&request.query, request.mode, request.case_sensitive)?;
    let query_count = matcher.query_count();

    let candidate_paths = request.paths.clone();
    let include_archives = request.include_archives;
    let candidates = tauri::async_runtime::spawn_blocking(move || {
        collect_candidates(&candidate_paths, include_archives)
    })
    .await
    .map_err(|_| "live source discovery task failed".to_string())??;
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
        .scan_jobs
        .lock()
        .map_err(|_| "search controls are unavailable".to_string())?
        .insert(job_id.clone(), Arc::clone(&control));

    let jobs = Arc::clone(&state.scan_jobs);
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
                source_bytes_scanned: AtomicU64::new(0),
                content_bytes_scanned: AtomicU64::new(0),
                matches: AtomicUsize::new(0),
                stop: AtomicBool::new(false),
                last_progress_emit_ms: AtomicU64::new(0),
                pause_announced: AtomicBool::new(false),
                pause_started_ms: AtomicU64::new(0),
                paused_total_ms: AtomicU64::new(0),
                sequence: AtomicU64::new(0),
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
        query_count,
    })
}

#[tauri::command]
pub fn cancel_direct_search(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let jobs = state
        .scan_jobs
        .lock()
        .map_err(|_| "search controls are unavailable".to_string())?;
    let control = jobs
        .get(&job_id)
        .ok_or_else(|| "live search is no longer active".to_string())?;
    control.cancel();
    Ok(())
}

#[tauri::command]
pub fn pause_direct_search(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    set_direct_search_paused(&job_id, true, &state)
}

#[tauri::command]
pub fn resume_direct_search(job_id: String, state: State<'_, AppState>) -> Result<(), String> {
    set_direct_search_paused(&job_id, false, &state)
}

fn set_direct_search_paused(
    job_id: &str,
    paused: bool,
    state: &State<'_, AppState>,
) -> Result<(), String> {
    let jobs = state
        .scan_jobs
        .lock()
        .map_err(|_| "search controls are unavailable".to_string())?;
    let control = jobs
        .get(job_id)
        .ok_or_else(|| "live search is no longer active".to_string())?;
    control.set_paused(paused);
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
                    if !shared.wait_until_running() {
                        break;
                    }
                    let candidate = match queue.lock() {
                        Ok(mut queue) => queue.pop_front(),
                        Err(_) => None,
                    };
                    let Some(candidate) = candidate else { break };
                    let source_progress = Arc::new(CandidateSourceProgress::new(candidate.size));
                    let source_name = file_name(&candidate.path);
                    shared.emit(
                        "running",
                        Some(source_name.clone()),
                        "Scanning local sources",
                        Vec::new(),
                    );
                    let result = scan_candidate(&candidate, &shared, &source_progress);
                    if result.is_ok() && !shared.should_stop() {
                        source_progress.complete(&shared);
                    }
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

fn scan_candidate(
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) -> Result<(), String> {
    match extension(&candidate.path).as_str() {
        "gz" => scan_gzip(candidate, shared, source_progress),
        "zip" => scan_zip(candidate, shared, source_progress),
        "rar" => scan_rar(candidate, shared, source_progress),
        _ => scan_plain(candidate, shared, source_progress),
    }
}

fn scan_plain(
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) -> Result<(), String> {
    let file = File::open(&candidate.path)
        .map_err(|_| "a source could not be opened read-only".to_string())?;
    scan_reader(
        BufReader::with_capacity(1024 * 1024, file),
        &candidate.path.to_string_lossy(),
        &file_name(&candidate.path),
        None,
        true,
        shared,
        source_progress,
    )
}

fn scan_gzip(
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) -> Result<(), String> {
    let file = File::open(&candidate.path)
        .map_err(|_| "a compressed source could not be opened read-only".to_string())?;
    let decoder = GzDecoder::new(SourceProgressReader::new(
        file,
        Arc::clone(source_progress),
        Arc::clone(shared),
    ));
    scan_reader(
        BufReader::with_capacity(1024 * 1024, decoder),
        &candidate.path.to_string_lossy(),
        &file_name(&candidate.path),
        None,
        false,
        shared,
        source_progress,
    )
}

fn scan_zip(
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) -> Result<(), String> {
    let file = File::open(&candidate.path)
        .map_err(|_| "a ZIP source could not be opened read-only".to_string())?;
    let reader = SourceProgressReader::new(file, Arc::clone(source_progress), Arc::clone(shared));
    let mut archive = ZipArchive::new(reader)
        .map_err(|_| "a ZIP source is invalid or unsupported".to_string())?;
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
            false,
            shared,
            source_progress,
        )?;
    }
    Ok(())
}

fn scan_rar(
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) -> Result<(), String> {
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
    source_progress.set_decoded_total(declared_bytes);
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
            Arc::clone(source_progress),
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
    track_source_bytes: bool,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) -> Result<(), String> {
    let mut line = Vec::with_capacity(4096);
    let mut line_number = 0_u64;
    let mut hits = Vec::new();
    let mut bytes_since_progress = 0_u64;
    loop {
        if !shared.wait_until_running() {
            break;
        }
        let skippable = {
            let available = reader
                .fill_buf()
                .map_err(|_| "source read failed".to_string())?;
            skippable_complete_prefix(available, &shared.matcher)
        };
        if let Some((bytes, lines)) = skippable {
            reader.consume(bytes);
            let bytes = bytes as u64;
            line_number = line_number.saturating_add(lines as u64);
            shared.add_content_bytes(bytes);
            bytes_since_progress = bytes_since_progress.saturating_add(bytes);
            if track_source_bytes {
                source_progress.add_physical_bytes(bytes, shared);
            }
            if bytes_since_progress >= PROGRESS_BYTE_INTERVAL {
                shared.emit(
                    "running",
                    Some(source_file.to_string()),
                    "Scanning local sources",
                    Vec::new(),
                );
                bytes_since_progress = 0;
            }
            continue;
        }
        let (bytes, exceeded) = read_bounded_line(&mut reader, &mut line)?;
        if bytes == 0 {
            break;
        }
        shared.add_content_bytes(bytes);
        bytes_since_progress = bytes_since_progress.saturating_add(bytes);
        if track_source_bytes {
            source_progress.add_physical_bytes(bytes, shared);
        }
        if bytes_since_progress >= PROGRESS_BYTE_INTERVAL {
            shared.emit(
                "running",
                Some(source_file.to_string()),
                "Scanning local sources",
                Vec::new(),
            );
            bytes_since_progress = 0;
        }
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

fn skippable_complete_prefix(block: &[u8], matcher: &QueryMatcher) -> Option<(usize, usize)> {
    let end = memchr::memrchr(b'\n', block)?.saturating_add(1);
    let complete_lines = &block[..end];
    if matcher.could_match_block(complete_lines) {
        return None;
    }
    Some((end, memchr::memchr_iter(b'\n', complete_lines).count()))
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
        let newline = memchr::memchr(b'\n', available);
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
    let query_index = shared.matcher.find_match(line)?;
    if !shared.reserve_hit() {
        return None;
    }
    Some(DirectSearchHit {
        id: Uuid::new_v4().to_string(),
        source_path: source_path.to_string(),
        source_file: source_file.to_string(),
        archive_entry: archive_entry.map(ToString::to_string),
        source_location: format!("line {line_number}"),
        excerpt: display_excerpt(&String::from_utf8_lossy(line)),
        match_reason: if shared.matcher.is_flexible_name() {
            "Name tokens found"
        } else if shared.matcher.query_count() > 1 {
            "Batch value found"
        } else {
            match shared.request.mode {
                SearchMode::Exact => "Exact field match",
                SearchMode::Prefix => "Field prefix match",
                SearchMode::Contains => "Line contains query",
            }
        }
        .to_string(),
        matched_query: shared.matcher.query(query_index).to_string(),
    })
}

#[cfg(test)]
fn line_matches(text: &str, query: &str, mode: SearchMode, case_sensitive: bool) -> bool {
    QueryMatcher::new(query, mode, case_sensitive)
        .is_ok_and(|matcher| matcher.find_match(text.as_bytes()).is_some())
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

fn display_excerpt(value: &str) -> String {
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
    let secrets = SECRET_PATTERN.replace_all(&normalized, "");
    let pairs = EMAIL_SECRET_PAIR_PATTERN.replace_all(&secrets, "$1");
    let compact = pairs.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut excerpt: String = compact.chars().take(360).collect();
    if compact.chars().count() > 360 {
        excerpt.push('…');
    }
    excerpt
}

struct RarLineWriter {
    source_path: String,
    source_file: String,
    archive_entry: String,
    shared: Arc<SharedScan>,
    source_progress: Arc<CandidateSourceProgress>,
    pending: Vec<u8>,
    discarding: bool,
    line_number: u64,
    hits: Vec<DirectSearchHit>,
    bytes_since_progress: u64,
}

impl RarLineWriter {
    fn new(
        source_path: String,
        source_file: String,
        archive_entry: String,
        shared: Arc<SharedScan>,
        source_progress: Arc<CandidateSourceProgress>,
    ) -> Self {
        Self {
            source_path,
            source_file,
            archive_entry,
            shared,
            source_progress,
            pending: Vec::with_capacity(4096),
            discarding: false,
            line_number: 0,
            hits: Vec::new(),
            bytes_since_progress: 0,
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
        if !self.shared.wait_until_running() {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "live search stopped",
            ));
        }
        self.shared.add_content_bytes(buffer.len() as u64);
        self.source_progress
            .add_decoded_bytes(buffer.len() as u64, &self.shared);
        self.bytes_since_progress = self
            .bytes_since_progress
            .saturating_add(buffer.len() as u64);
        if self.bytes_since_progress >= PROGRESS_BYTE_INTERVAL {
            self.shared.emit(
                "running",
                Some(self.source_file.clone()),
                "Scanning local sources",
                Vec::new(),
            );
            self.bytes_since_progress = 0;
        }
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
        io::{BufRead, BufReader, Read, Write},
        path::Path,
        sync::{
            Arc, Mutex,
            atomic::{AtomicU64, Ordering},
        },
        time::Instant,
    };

    use rars::rar15_40::{StoredEntry, WriterOptions, write_stored_archive};
    use tempfile::tempdir;
    use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

    use super::{
        ArchiveReader, CandidateSourceProgress, MAX_LINE_BYTES, MAX_QUERY_COUNT, QueryMatcher,
        active_elapsed_ms, display_excerpt, estimate_remaining_ms, extension, field_tokens,
        is_text_extension, line_matches, parse_queries, read_bounded_line,
        skippable_complete_prefix,
    };
    use crate::models::SearchMode;

    #[test]
    fn compressed_progress_advances_before_candidate_completion() {
        let progress = CandidateSourceProgress::new(100);

        assert_eq!(progress.advance_to(20, false), 20);
        assert_eq!(progress.advance_to(60, false), 40);
        assert_eq!(progress.advance_to(40, false), 0);
        assert_eq!(progress.advance_to(100, false), 39);
        assert_eq!(progress.advance_to(100, true), 1);
    }

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
    fn batch_search_compiles_many_values_into_one_matcher() {
        let matcher = QueryMatcher::new(
            "first@example.test\nsecond.example.test\n+1 202 555 0199",
            SearchMode::Contains,
            false,
        )
        .expect("batch matcher");
        assert_eq!(matcher.query_count(), 3);
        let match_index = matcher
            .find_match(b"domain=second.example.test|status=synthetic")
            .expect("batch match");
        assert_eq!(matcher.query(match_index), "second.example.test");
        assert_eq!(
            parse_queries("VALUE\nvalue\nother", false).expect("deduplicated values"),
            vec!["VALUE", "other"]
        );
    }

    #[test]
    fn block_prefilter_skips_complete_nonmatching_lines_without_crossing_a_tail() {
        let matcher = QueryMatcher::new(
            "needle@example.test\nportal.example.test",
            SearchMode::Contains,
            false,
        )
        .expect("batch matcher");
        let block = b"first absent line\nsecond absent line\npartial tail";
        assert_eq!(skippable_complete_prefix(block, &matcher), Some((37, 2)));
        assert!(
            skippable_complete_prefix(
                b"first absent line\nneedle@example.test appears here\n",
                &matcher,
            )
            .is_none()
        );
        let name_matcher =
            QueryMatcher::new("Jane Doe", SearchMode::Contains, false).expect("name matcher");
        assert_eq!(
            skippable_complete_prefix(b"unrelated generated row\n", &name_matcher),
            Some((24, 1))
        );
    }

    #[test]
    fn remaining_time_uses_physical_source_progress() {
        assert_eq!(estimate_remaining_ms(1_000, 250, 2_000), Some(6_000));
        assert_eq!(estimate_remaining_ms(1_000, 0, 2_000), None);
        assert_eq!(estimate_remaining_ms(1_000, 1_000, 2_000), None);
    }

    #[test]
    fn paused_time_does_not_reduce_reported_scan_throughput() {
        assert_eq!(active_elapsed_ms(10_000, 2_000, 3_000), 5_000);
        assert_eq!(active_elapsed_ms(1_000, 2_000, 0), 0);
    }

    struct RepeatingScanReader {
        pattern: Vec<u8>,
        offset: usize,
        remaining: u64,
    }

    impl RepeatingScanReader {
        fn new(total_bytes: u64) -> Self {
            Self {
                pattern: b"user-0000000000|person-0000000000@example.test|synthetic-value\n"
                    .to_vec(),
                offset: 0,
                remaining: total_bytes,
            }
        }
    }

    impl Read for RepeatingScanReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let requested = buffer.len().min(self.remaining as usize);
            let mut written = 0;
            while written < requested {
                let available = self.pattern.len() - self.offset;
                let copy = available.min(requested - written);
                buffer[written..written + copy]
                    .copy_from_slice(&self.pattern[self.offset..self.offset + copy]);
                written += copy;
                self.offset = (self.offset + copy) % self.pattern.len();
            }
            self.remaining = self.remaining.saturating_sub(written as u64);
            Ok(written)
        }
    }

    #[test]
    #[ignore = "manual generated direct-scan throughput soak test"]
    fn generated_direct_scan_soak() {
        let gibibytes = std::env::var("ALETHEIA_DIRECT_SOAK_GIB")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(1)
            .clamp(1, 4_096);
        let target_bytes = gibibytes * 1024 * 1024 * 1024;
        let query_count = std::env::var("ALETHEIA_DIRECT_SOAK_QUERIES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(MAX_QUERY_COUNT)
            .clamp(1, MAX_QUERY_COUNT);
        let source = RepeatingScanReader::new(target_bytes);
        let mut reader = BufReader::with_capacity(1024 * 1024, source);
        let queries = (0..query_count)
            .map(|index| format!("absent-{index:04}@example.test"))
            .collect::<Vec<_>>()
            .join("\n");
        let matcher =
            QueryMatcher::new(&queries, SearchMode::Contains, false).expect("soak matcher");
        let mut line = Vec::with_capacity(4096);
        let mut consumed = 0_u64;
        let mut lines = 0_u64;
        let started = Instant::now();
        while consumed < target_bytes {
            let skippable = {
                let available = reader.fill_buf().expect("generated scan buffer");
                skippable_complete_prefix(available, &matcher)
            };
            if let Some((bytes, skipped_lines)) = skippable {
                reader.consume(bytes);
                consumed = consumed.saturating_add(bytes as u64);
                lines = lines.saturating_add(skipped_lines as u64);
                continue;
            }
            let (bytes, exceeded) = read_bounded_line(&mut reader, &mut line).expect("scan line");
            if bytes == 0 {
                break;
            }
            assert!(!exceeded);
            consumed = consumed.saturating_add(bytes);
            lines += 1;
            assert!(matcher.find_match(&line).is_none());
        }
        let elapsed = started.elapsed();
        assert_eq!(consumed, target_bytes);
        assert!(line.capacity() <= MAX_LINE_BYTES + 2);
        eprintln!(
            "scanned {gibibytes} GiB / {lines} generated lines against {query_count} queries in {:.2?} ({:.1} MiB/s)",
            elapsed,
            consumed as f64 / 1024.0 / 1024.0 / elapsed.as_secs_f64()
        );
    }

    #[test]
    #[ignore = "manual authorized RAR metadata compatibility probe"]
    fn authorized_rar_metadata_probe() {
        let path = std::env::var("ALETHEIA_RAR_PROBE_PATH")
            .expect("set ALETHEIA_RAR_PROBE_PATH to an authorized archive");
        let archive = ArchiveReader::read_path(Path::new(&path))
            .expect("authorized RAR metadata should be readable");
        let mut entries = 0_u64;
        let mut text_entries = 0_u64;
        let mut packed_bytes = 0_u64;
        let mut unpacked_bytes = 0_u64;
        let mut encrypted_entries = 0_u64;
        for member in archive.members() {
            if member.meta.is_directory {
                continue;
            }
            entries += 1;
            packed_bytes = packed_bytes.saturating_add(member.meta.packed_size);
            unpacked_bytes = unpacked_bytes.saturating_add(member.meta.unpacked_size);
            encrypted_entries += u64::from(member.meta.is_encrypted);
            let entry_name = member.meta.name_lossy();
            text_entries += u64::from(is_text_extension(&extension(Path::new(&entry_name))));
        }
        assert!(
            entries > 0,
            "authorized RAR should contain at least one entry"
        );
        eprintln!(
            "RAR metadata probe: {entries} entries, {text_entries} text entries, {packed_bytes} packed bytes, {unpacked_bytes} unpacked bytes, {encrypted_entries} encrypted entries"
        );
    }

    struct ArchiveProbeWriter {
        matcher: Arc<QueryMatcher>,
        decoded_bytes: Arc<AtomicU64>,
        matches: Arc<AtomicU64>,
    }

    impl Write for ArchiveProbeWriter {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.decoded_bytes
                .fetch_add(buffer.len() as u64, Ordering::Relaxed);
            if self.matcher.find_match(buffer).is_some() {
                self.matches.fetch_add(1, Ordering::Relaxed);
            }
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    #[ignore = "manual authorized RAR read-only throughput probe"]
    fn authorized_rar_stream_probe() {
        let path = std::env::var("ALETHEIA_RAR_PROBE_PATH")
            .expect("set ALETHEIA_RAR_PROBE_PATH to an authorized archive");
        let archive = ArchiveReader::read_path(Path::new(&path))
            .expect("authorized RAR metadata should be readable");
        let matcher = Arc::new(
            QueryMatcher::new(
                "aletheia-guaranteed-absent-synthetic-probe.invalid",
                SearchMode::Contains,
                false,
            )
            .expect("probe matcher"),
        );
        let decoded_bytes = Arc::new(AtomicU64::new(0));
        let matches = Arc::new(AtomicU64::new(0));
        let writer_matcher = Arc::clone(&matcher);
        let writer_bytes = Arc::clone(&decoded_bytes);
        let writer_matches = Arc::clone(&matches);
        let started = Instant::now();
        archive
            .extract_to(None, move |meta| {
                let entry_name = meta.name_lossy();
                if meta.is_directory || !is_text_extension(&extension(Path::new(&entry_name))) {
                    return Ok(Box::new(std::io::sink()));
                }
                Ok(Box::new(ArchiveProbeWriter {
                    matcher: Arc::clone(&writer_matcher),
                    decoded_bytes: Arc::clone(&writer_bytes),
                    matches: Arc::clone(&writer_matches),
                }))
            })
            .expect("authorized RAR should stream read-only");
        let elapsed = started.elapsed();
        let bytes = decoded_bytes.load(Ordering::Relaxed);
        assert!(bytes > 0, "authorized RAR should decode text content");
        assert_eq!(matches.load(Ordering::Relaxed), 0);
        eprintln!(
            "RAR stream probe: {bytes} decoded bytes in {:.2?} ({:.1} MiB/s)",
            elapsed,
            bytes as f64 / 1024.0 / 1024.0 / elapsed.as_secs_f64()
        );
    }

    #[test]
    fn excerpts_show_identifiers_and_drop_secret_values() {
        let excerpt = display_excerpt(
            "synthetic@example.com:invented-value password=invented-secret +1 202 555 0142",
        );
        assert!(excerpt.contains("synthetic@example.com"));
        assert!(excerpt.contains("+1 202 555 0142"));
        assert!(!excerpt.contains("password"));
        assert!(!excerpt.contains("invented-secret"));
        assert!(!excerpt.contains("invented-value"));
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
