use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs::{File, OpenOptions},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, AhoCorasickKind};
use flate2::read::GzDecoder;
use once_cell::sync::Lazy;
use rars::ArchiveReader;
use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

use crate::{
    live_domains::{LiveDomainEvidenceInput, SaveLiveDomainEvidenceInput, save_evidence},
    models::SearchMode,
    performance::{PerformanceProfile, load_profile},
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
const HIT_BATCH_SIZE: usize = 128;
const PROGRESS_EMIT_INTERVAL_MS: u64 = 250;
const PROGRESS_BYTE_INTERVAL: u64 = 1024 * 1024;
const PLAIN_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const PARALLEL_PLAIN_THRESHOLD: u64 = 128 * 1024 * 1024;
const RAW_EXCERPT_BYTES: usize = 1024;
const PREFLIGHT_SAMPLE_BYTES: u64 = 64 * 1024 * 1024;
const SOURCE_READER_LIMIT: usize = 1;
const PLAIN_CHECKPOINT_BYTES: u64 = 256 * 1024 * 1024;
#[cfg(windows)]
const FILE_FLAG_SEQUENTIAL_SCAN: u32 = 0x0800_0000;

static SECRET_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(password|passwd|pwd|token|cookie|secret|api[_-]?key)\s*[:=]\s*[^\s,;|]+")
        .expect("secret filtering pattern")
});
static EMAIL_SECRET_PAIR_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})\s*:\s*([^:\s,;|]+)")
        .expect("email credential-pair filtering pattern")
});

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchRequest {
    pub paths: Vec<String>,
    pub query: String,
    pub mode: SearchMode,
    #[serde(default)]
    pub domain_match: bool,
    pub case_sensitive: bool,
    pub include_archives: bool,
    pub max_results: usize,
    pub worker_limit: usize,
    #[serde(default)]
    pub session_context: Option<DirectSearchSessionContext>,
    #[serde(default)]
    pub live_domain_autosave: Option<LiveDomainAutosaveRequest>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDomainAutosaveRequest {
    pub domain: String,
    pub source_id: String,
    pub source_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchSessionContext {
    pub scope: String,
    pub source_id: Option<String>,
    pub source_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchStart {
    pub job_id: String,
    pub source_count: usize,
    pub total_bytes: u64,
    pub query_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchPreflightRequest {
    pub paths: Vec<String>,
    pub include_archives: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectSearchPreflight {
    pub source_count: usize,
    pub total_bytes: u64,
    pub archive_count: usize,
    pub archive_bytes: u64,
    pub sample_read_bytes_per_second: u64,
    pub archive_bytes_per_second: u64,
    pub estimated_minimum_ms: u64,
    pub estimated_maximum_ms: u64,
    pub source_reader_limit: u32,
    pub recommended_worker_limit: u32,
    pub recommended_memory_limit_mb: u32,
    pub bottleneck: String,
    pub confidence: String,
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
    pub autosave_enabled: bool,
    pub saved_matches: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableDirectSearch {
    pub progress: DirectSearchProgress,
    pub scope: String,
    pub query: String,
    pub source_id: Option<String>,
    pub source_name: Option<String>,
}

#[derive(Clone)]
struct Candidate {
    path: PathBuf,
    size: u64,
    modified_ns: u64,
}

#[derive(Default)]
struct ScanBaseline {
    elapsed_ms: u64,
    files_scanned: usize,
    source_bytes_scanned: u64,
    content_bytes_scanned: u64,
    matches: usize,
    seen_hit_ids: HashSet<String>,
    resume_points: HashMap<String, PlainResumePoint>,
}

#[derive(Debug, Clone, Copy)]
struct PlainResumePoint {
    source_size: u64,
    source_modified_ns: u64,
    byte_offset: u64,
    next_line: u64,
}

struct CandidateSourceProgress {
    total_bytes: u64,
    physical_bytes: AtomicU64,
    reported_bytes: AtomicU64,
    decoded_bytes: AtomicU64,
    decoded_total_bytes: AtomicU64,
}

impl CandidateSourceProgress {
    #[cfg(test)]
    fn new(total_bytes: u64) -> Self {
        Self::new_at(total_bytes, 0)
    }

    fn new_at(total_bytes: u64, reported_bytes: u64) -> Self {
        let reported_bytes = reported_bytes.min(total_bytes);
        Self {
            total_bytes,
            physical_bytes: AtomicU64::new(reported_bytes),
            reported_bytes: AtomicU64::new(reported_bytes),
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
        let target = self
            .physical_bytes
            .fetch_add(bytes, Ordering::Relaxed)
            .saturating_add(bytes);
        let added = self.advance_to(target, false);
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
    elapsed_offset_ms: u64,
    files_scanned: AtomicUsize,
    source_bytes_scanned: AtomicU64,
    content_bytes_scanned: AtomicU64,
    matches: AtomicUsize,
    stop: AtomicBool,
    last_progress_emit_ms: AtomicU64,
    last_checkpoint_ms: AtomicU64,
    pause_announced: AtomicBool,
    pause_started_ms: AtomicU64,
    paused_total_ms: AtomicU64,
    sequence: AtomicU64,
    database: Arc<Mutex<rusqlite::Connection>>,
    autosave_error: Mutex<Option<String>>,
    saved_matches: AtomicUsize,
    seen_hit_ids: Mutex<HashSet<String>>,
    resume_points: HashMap<String, PlainResumePoint>,
}

struct QueryMatcher {
    literal: Option<AhoCorasick>,
    literal_query_indices: Vec<usize>,
    unicode_queries: Vec<(usize, String)>,
    flexible_name: Option<(AhoCorasick, usize)>,
    queries: Vec<String>,
    mode: SearchMode,
    domain_match: bool,
    case_sensitive: bool,
}

impl QueryMatcher {
    fn new(query: &str, mode: SearchMode, case_sensitive: bool) -> Result<Self, String> {
        Self::compile(query, mode, case_sensitive, false)
    }

    fn for_domain(query: &str, mode: SearchMode, case_sensitive: bool) -> Result<Self, String> {
        Self::compile(query, mode, case_sensitive, true)
    }

    fn compile(
        query: &str,
        mode: SearchMode,
        case_sensitive: bool,
        domain_match: bool,
    ) -> Result<Self, String> {
        let queries = parse_queries(query, case_sensitive)?;
        let name_tokens =
            if !domain_match && queries.len() == 1 && matches!(mode, SearchMode::Contains) {
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
            domain_match,
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
                let valid = if self.domain_match {
                    is_domain_occurrence(line, matched.start(), matched.end())
                } else {
                    match self.mode {
                        SearchMode::Contains => true,
                        SearchMode::Prefix => {
                            matched.start() == 0 || is_field_boundary(line[matched.start() - 1])
                        }
                        SearchMode::Exact => {
                            (matched.start() == 0 || is_field_boundary(line[matched.start() - 1]))
                                && (matched.end() == line.len()
                                    || is_field_boundary(line[matched.end()]))
                        }
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

    fn is_flexible_name(&self) -> bool {
        self.flexible_name.is_some()
    }

    fn is_domain_match(&self) -> bool {
        self.domain_match
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

fn is_domain_occurrence(line: &[u8], start: usize, end: usize) -> bool {
    let starts_at_domain_boundary =
        start == 0 || is_field_boundary(line[start - 1]) || matches!(line[start - 1], b'.' | b'@');
    let ends_at_domain_boundary = end == line.len()
        || is_field_boundary(line[end])
        || matches!(line[end], b'/' | b'?' | b'#');
    starts_at_domain_boundary && ends_at_domain_boundary
}

impl SharedScan {
    fn resume_point(&self, candidate: &Candidate) -> Option<PlainResumePoint> {
        self.resume_points
            .get(candidate.path.to_string_lossy().as_ref())
            .copied()
            .filter(|point| {
                point.source_size == candidate.size
                    && point.source_modified_ns == candidate.modified_ns
                    && point.byte_offset < candidate.size
                    && !matches!(extension(&candidate.path).as_str(), "zip" | "rar" | "gz")
            })
    }

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

    fn autosave_hits(&self, hits: &[DirectSearchHit]) -> Result<(), String> {
        let Some(config) = self.request.live_domain_autosave.as_ref() else {
            return Ok(());
        };
        if hits.is_empty() {
            return Ok(());
        }
        let summary = save_evidence(
            Arc::clone(&self.database),
            SaveLiveDomainEvidenceInput {
                domain: config.domain.clone(),
                source_id: config.source_id.clone(),
                source_name: config.source_name.clone(),
                evidence: hits
                    .iter()
                    .map(|hit| LiveDomainEvidenceInput {
                        source_path: hit.source_path.clone(),
                        source_file: hit.source_file.clone(),
                        archive_entry: hit.archive_entry.clone(),
                        source_location: hit.source_location.clone(),
                        excerpt: hit.excerpt.clone(),
                        match_reason: hit.match_reason.clone(),
                        matched_query: hit.matched_query.clone(),
                    })
                    .collect(),
            },
        )?;
        self.saved_matches.store(
            usize::try_from(summary.evidence_count).unwrap_or(usize::MAX),
            Ordering::Relaxed,
        );
        Ok(())
    }

    fn emit(
        &self,
        status: &str,
        current_source: Option<String>,
        message: &str,
        mut hits: Vec<DirectSearchHit>,
    ) {
        let mut emitted_status = status;
        let mut emitted_message = message.to_string();
        if let Err(error) = self.autosave_hits(&hits) {
            self.stop.store(true, Ordering::Relaxed);
            if let Ok(mut slot) = self.autosave_error.lock()
                && slot.is_none()
            {
                *slot = Some(error);
            }
            hits.clear();
            emitted_status = "failed";
            emitted_message = "Live result autosave failed".to_string();
        }
        let wall_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let pause_started_ms = self.pause_started_ms.load(Ordering::Relaxed);
        let current_pause_ms = if pause_started_ms > 0 {
            wall_ms.saturating_sub(pause_started_ms)
        } else {
            0
        };
        let elapsed_ms = self.elapsed_offset_ms.saturating_add(active_elapsed_ms(
            wall_ms,
            self.paused_total_ms.load(Ordering::Relaxed),
            current_pause_ms,
        ));
        if emitted_status == "running" && hits.is_empty() {
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
        let progress = DirectSearchProgress {
            job_id: self.job_id.clone(),
            sequence,
            status: emitted_status.to_string(),
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
            message: emitted_message,
            hits,
            autosave_enabled: self.request.live_domain_autosave.is_some(),
            saved_matches: self.saved_matches.load(Ordering::Relaxed),
        };
        let previous_checkpoint = self.last_checkpoint_ms.load(Ordering::Relaxed);
        if !progress.hits.is_empty() || emitted_status != "running" {
            self.last_checkpoint_ms
                .store(elapsed_ms.max(1), Ordering::Relaxed);
            let _ = persist_session_progress(&self.database, &progress);
        } else if elapsed_ms.saturating_sub(previous_checkpoint) >= 5_000
            && self
                .last_checkpoint_ms
                .compare_exchange(
                    previous_checkpoint,
                    elapsed_ms.max(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                )
                .is_ok()
        {
            let _ = persist_session_progress(&self.database, &progress);
        }
        let _ = self.app.emit(DIRECT_SEARCH_EVENT, progress);
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

fn sqlite_integer(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}

fn scan_session_context(
    request: &DirectSearchRequest,
) -> Result<(String, Option<String>, Option<String>), String> {
    let fallback = request.live_domain_autosave.as_ref().map(|config| {
        (
            "domains".to_string(),
            Some(config.source_id.clone()),
            Some(config.source_name.clone()),
        )
    });
    let (scope, source_id, source_name) = request
        .session_context
        .as_ref()
        .map(|context| {
            (
                context.scope.trim().to_ascii_lowercase(),
                context.source_id.clone(),
                context.source_name.clone(),
            )
        })
        .or(fallback)
        .unwrap_or_else(|| ("search".to_string(), None, None));
    if !matches!(scope.as_str(), "search" | "domains" | "identities") {
        return Err("live search session scope is invalid".to_string());
    }
    if source_id
        .as_deref()
        .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 128)
        || source_name
            .as_deref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 160)
    {
        return Err("live search source metadata is invalid".to_string());
    }
    Ok((scope, source_id, source_name))
}

fn create_scan_session(
    database: &Arc<Mutex<Connection>>,
    job_id: &str,
    request: &DirectSearchRequest,
    source_count: usize,
    total_bytes: u64,
    query_count: usize,
) -> Result<(), String> {
    let request_json = serde_json::to_string(request)
        .map_err(|_| "live search checkpoint could not be created".to_string())?;
    let (scope, source_id, source_name) = scan_session_context(request)?;
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "INSERT INTO live_scan_sessions(
               id, request_json, scope, source_id, source_name, status,
               source_count, total_bytes, query_count, message
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7, ?8,
                       'Scanning local sources')",
            params![
                job_id,
                request_json,
                scope,
                source_id,
                source_name,
                source_count as i64,
                sqlite_integer(total_bytes),
                query_count as i64,
            ],
        )
        .map_err(|_| "live search checkpoint could not be created".to_string())?;
    connection
        .execute(
            "DELETE FROM live_scan_sessions
             WHERE id IN (
               SELECT id FROM live_scan_sessions
               WHERE status IN ('completed', 'cancelled', 'failed')
               ORDER BY updated_at DESC, id DESC
               LIMIT -1 OFFSET 50
             )",
            [],
        )
        .map_err(|_| "old live search checkpoints could not be pruned".to_string())?;
    Ok(())
}

fn persist_session_progress(
    database: &Arc<Mutex<Connection>>,
    progress: &DirectSearchProgress,
) -> Result<(), String> {
    let mut connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|_| "live search checkpoint could not be updated".to_string())?;
    let finished = matches!(
        progress.status.as_str(),
        "completed" | "cancelled" | "failed"
    );
    transaction
        .execute(
            "UPDATE live_scan_sessions
             SET status = ?2, current_source = ?3, source_count = ?4,
                 files_scanned = ?5, total_bytes = ?6,
                 source_bytes_scanned = ?7, content_bytes_scanned = ?8,
                 matches = ?9, elapsed_ms = ?10, query_count = ?11,
                 truncated = ?12, message = ?13,
                 updated_at = CURRENT_TIMESTAMP,
                 finished_at = CASE WHEN ?14 THEN CURRENT_TIMESTAMP ELSE NULL END
             WHERE id = ?1",
            params![
                progress.job_id,
                progress.status,
                progress.current_source,
                progress.source_count as i64,
                progress.files_scanned as i64,
                sqlite_integer(progress.total_bytes),
                sqlite_integer(progress.source_bytes_scanned),
                sqlite_integer(progress.content_bytes_scanned),
                progress.matches as i64,
                sqlite_integer(progress.elapsed_ms),
                progress.query_count as i64,
                progress.truncated,
                progress.message,
                finished,
            ],
        )
        .map_err(|_| "live search checkpoint could not be updated".to_string())?;
    for hit in &progress.hits {
        transaction
            .execute(
                "INSERT OR IGNORE INTO live_scan_hits(
                   id, session_id, source_path, source_file, archive_entry,
                   source_location, excerpt, match_reason, matched_query
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    hit.id,
                    progress.job_id,
                    hit.source_path,
                    hit.source_file,
                    hit.archive_entry,
                    hit.source_location,
                    hit.excerpt,
                    hit.match_reason,
                    hit.matched_query,
                ],
            )
            .map_err(|_| "live search result checkpoint could not be updated".to_string())?;
    }
    transaction
        .commit()
        .map_err(|_| "live search checkpoint could not be committed".to_string())?;
    Ok(())
}

fn persist_completed_candidate(
    database: &Arc<Mutex<Connection>>,
    job_id: &str,
    candidate: &Candidate,
) -> Result<(), String> {
    let mut connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|_| "live search source checkpoint could not be updated".to_string())?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO live_scan_completed_sources(
               session_id, source_path, source_size, source_modified_ns
             ) VALUES (?1, ?2, ?3, ?4)",
            params![
                job_id,
                candidate.path.to_string_lossy(),
                sqlite_integer(candidate.size),
                sqlite_integer(candidate.modified_ns),
            ],
        )
        .map_err(|_| "live search source checkpoint could not be updated".to_string())?;
    transaction
        .execute(
            "DELETE FROM live_scan_source_progress
             WHERE session_id = ?1 AND source_path = ?2 AND source_size = ?3
               AND source_modified_ns = ?4",
            params![
                job_id,
                candidate.path.to_string_lossy(),
                sqlite_integer(candidate.size),
                sqlite_integer(candidate.modified_ns),
            ],
        )
        .map_err(|_| "live search source checkpoint could not be finalized".to_string())?;
    transaction
        .commit()
        .map_err(|_| "live search source checkpoint could not be committed".to_string())?;
    Ok(())
}

fn persist_plain_checkpoint(
    database: &Arc<Mutex<Connection>>,
    job_id: &str,
    candidate: &Candidate,
    byte_offset: u64,
    next_line: u64,
) -> Result<(), String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "INSERT INTO live_scan_source_progress(
               session_id, source_path, source_size, source_modified_ns,
               byte_offset, next_line
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(session_id, source_path, source_size, source_modified_ns)
             DO UPDATE SET
               byte_offset = MAX(byte_offset, excluded.byte_offset),
               next_line = CASE
                 WHEN excluded.byte_offset >= byte_offset THEN excluded.next_line
                 ELSE next_line
               END,
               updated_at = CURRENT_TIMESTAMP",
            params![
                job_id,
                candidate.path.to_string_lossy(),
                sqlite_integer(candidate.size),
                sqlite_integer(candidate.modified_ns),
                sqlite_integer(byte_offset.min(candidate.size)),
                sqlite_integer(next_line.max(1)),
            ],
        )
        .map_err(|_| "plain source checkpoint could not be updated".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn preflight_direct_search(
    state: State<'_, AppState>,
    request: DirectSearchPreflightRequest,
) -> Result<DirectSearchPreflight, String> {
    if request.paths.is_empty() || request.paths.len() > MAX_INPUT_PATHS {
        return Err("choose between 1 and 64 local sources".to_string());
    }
    let profile = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "performance profile is unavailable".to_string())?;
        load_profile(&connection)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let candidates = collect_candidates(&request.paths, request.include_archives)?;
        if candidates.is_empty() {
            return Err("no supported local text or archive sources were found".to_string());
        }
        build_preflight(&candidates, profile.as_ref())
    })
    .await
    .map_err(|_| "Live source preflight task failed".to_string())?
}

fn build_preflight(
    candidates: &[Candidate],
    profile: Option<&PerformanceProfile>,
) -> Result<DirectSearchPreflight, String> {
    let total_bytes = candidates.iter().fold(0_u64, |total, candidate| {
        total.saturating_add(candidate.size)
    });
    let (archive_count, archive_bytes) =
        candidates
            .iter()
            .fold((0_usize, 0_u64), |(count, bytes), candidate| {
                if matches!(extension(&candidate.path).as_str(), "zip" | "rar" | "gz") {
                    (
                        count.saturating_add(1),
                        bytes.saturating_add(candidate.size),
                    )
                } else {
                    (count, bytes)
                }
            });
    let sample_read_bytes_per_second = measure_source_read_rate(candidates)?;
    let fallback_read_rate = profile
        .map(|value| value.disk_read_bytes_per_second)
        .unwrap_or(80 * 1024 * 1024);
    let read_rate = if sample_read_bytes_per_second > 0 {
        sample_read_bytes_per_second
    } else {
        fallback_read_rate
    }
    .max(1);
    let logical_cores = profile.map_or(2, |value| value.logical_cores);
    let recommended_worker_limit = recommended_source_workers(read_rate, logical_cores);
    let cpu_rate = profile
        .map(|value| value.cpu_scan_bytes_per_second)
        .unwrap_or(read_rate.saturating_mul(2))
        .saturating_mul(recommended_worker_limit as u64)
        .max(1);
    let archive_rate = profile
        .map(|value| value.archive_bytes_per_second)
        .unwrap_or(60 * 1024 * 1024)
        .max(1);
    let plain_bytes = total_bytes.saturating_sub(archive_bytes);
    let plain_rate = read_rate.min(cpu_rate).max(1);
    let archive_effective_rate = read_rate.min(cpu_rate).min(archive_rate).max(1);
    let minimum_ms = estimate_bytes_ms(plain_bytes, plain_rate)
        .saturating_add(estimate_bytes_ms(archive_bytes, archive_effective_rate));
    let uncertainty = if archive_count > 0 { 350_u64 } else { 180_u64 };
    let estimated_maximum_ms = minimum_ms
        .saturating_mul(uncertainty)
        .checked_div(100)
        .unwrap_or(u64::MAX)
        .max(minimum_ms);
    let bottleneck = if archive_count > 0 && archive_rate <= read_rate.min(cpu_rate) {
        "Archive decompression"
    } else if read_rate <= cpu_rate {
        "Source storage"
    } else {
        "CPU matching"
    }
    .to_string();

    Ok(DirectSearchPreflight {
        source_count: candidates.len(),
        total_bytes,
        archive_count,
        archive_bytes,
        sample_read_bytes_per_second,
        archive_bytes_per_second: archive_rate,
        estimated_minimum_ms: minimum_ms,
        estimated_maximum_ms,
        source_reader_limit: SOURCE_READER_LIMIT as u32,
        recommended_worker_limit,
        recommended_memory_limit_mb: profile
            .map(|value| value.recommended_memory_limit_mb)
            .unwrap_or(512),
        bottleneck,
        confidence: if sample_read_bytes_per_second > 0 {
            "Measured 64 MB source sample"
        } else {
            "Estimated from the latest device benchmark"
        }
        .to_string(),
    })
}

fn measure_source_read_rate(candidates: &[Candidate]) -> Result<u64, String> {
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut sampled = 0_u64;
    let started = Instant::now();
    for candidate in candidates {
        if sampled >= PREFLIGHT_SAMPLE_BYTES {
            break;
        }
        let mut file = open_source_file(&candidate.path)
            .map_err(|_| "a source could not be sampled read-only".to_string())?;
        loop {
            let remaining = PREFLIGHT_SAMPLE_BYTES.saturating_sub(sampled);
            if remaining == 0 {
                break;
            }
            let read_limit = remaining.min(buffer.len() as u64) as usize;
            let count = file
                .read(&mut buffer[..read_limit])
                .map_err(|_| "a source sample could not be read".to_string())?;
            if count == 0 {
                break;
            }
            sampled = sampled.saturating_add(count as u64);
        }
    }
    if sampled == 0 {
        return Ok(0);
    }
    let elapsed_ns = started.elapsed().as_nanos().max(1);
    Ok(((sampled as u128).saturating_mul(1_000_000_000) / elapsed_ns).min(u64::MAX as u128) as u64)
}

fn estimate_bytes_ms(bytes: u64, bytes_per_second: u64) -> u64 {
    if bytes == 0 {
        return 0;
    }
    bytes
        .saturating_mul(1_000)
        .checked_div(bytes_per_second.max(1))
        .unwrap_or(u64::MAX)
        .max(1)
}

fn open_source_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(FILE_FLAG_SEQUENTIAL_SCAN);
    }
    options.open(path)
}

fn recommended_source_workers(read_rate: u64, logical_cores: usize) -> u32 {
    let storage_limit = match read_rate / (1024 * 1024) {
        0..=109 => 1,
        110..=299 => 2,
        300..=699 => 4,
        700..=1_199 => 6,
        _ => 8,
    };
    let core_limit = match logical_cores {
        0 | 1 => 1,
        2..=3 => 2,
        4..=5 => 4,
        6..=7 => 6,
        _ => 8,
    };
    storage_limit.min(core_limit)
}

#[tauri::command]
pub async fn start_direct_search(
    app: AppHandle,
    state: State<'_, AppState>,
    mut request: DirectSearchRequest,
) -> Result<DirectSearchStart, String> {
    ensure_live_scan_idle(&state)?;
    request.query = request.query.trim().to_string();
    if request.paths.is_empty() || request.paths.len() > MAX_INPUT_PATHS {
        return Err("choose between 1 and 64 local sources".to_string());
    }
    request.max_results = request.max_results.clamp(1, MAX_RESULTS);
    request.worker_limit = request.worker_limit.clamp(1, 8);
    let matcher = if request.domain_match {
        QueryMatcher::for_domain(&request.query, request.mode, request.case_sensitive)?
    } else {
        QueryMatcher::new(&request.query, request.mode, request.case_sensitive)?
    };
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
    create_scan_session(
        &state.database,
        &job_id,
        &request,
        source_count,
        total_bytes,
        query_count,
    )?;
    launch_direct_scan(
        app,
        Arc::clone(&state.scan_jobs),
        Arc::clone(&state.database),
        request,
        matcher,
        candidates,
        job_id,
        source_count,
        total_bytes,
        ScanBaseline::default(),
    )
}

#[allow(clippy::too_many_arguments)]
fn launch_direct_scan(
    app: AppHandle,
    jobs: Arc<Mutex<HashMap<String, Arc<JobControl>>>>,
    database: Arc<Mutex<Connection>>,
    request: DirectSearchRequest,
    matcher: QueryMatcher,
    candidates: Vec<Candidate>,
    job_id: String,
    source_count: usize,
    total_bytes: u64,
    baseline: ScanBaseline,
) -> Result<DirectSearchStart, String> {
    let query_count = matcher.query_count();
    let control = Arc::new(JobControl::default());
    let mut active_jobs = jobs
        .lock()
        .map_err(|_| "search controls are unavailable".to_string())?;
    if !active_jobs.is_empty() {
        return Err(
            "another Live scan is active; finish or cancel it before starting a new one"
                .to_string(),
        );
    }
    active_jobs.insert(job_id.clone(), Arc::clone(&control));
    drop(active_jobs);

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
                elapsed_offset_ms: baseline.elapsed_ms,
                files_scanned: AtomicUsize::new(baseline.files_scanned),
                source_bytes_scanned: AtomicU64::new(baseline.source_bytes_scanned),
                content_bytes_scanned: AtomicU64::new(baseline.content_bytes_scanned),
                matches: AtomicUsize::new(baseline.matches),
                stop: AtomicBool::new(false),
                last_progress_emit_ms: AtomicU64::new(0),
                last_checkpoint_ms: AtomicU64::new(0),
                pause_announced: AtomicBool::new(false),
                pause_started_ms: AtomicU64::new(0),
                paused_total_ms: AtomicU64::new(0),
                sequence: AtomicU64::new(0),
                database,
                autosave_error: Mutex::new(None),
                saved_matches: AtomicUsize::new(0),
                seen_hit_ids: Mutex::new(baseline.seen_hit_ids),
                resume_points: baseline.resume_points,
            });
            shared.emit("running", None, "Scanning local sources", Vec::new());
            let result = run_scan(candidates, Arc::clone(&shared));
            let autosave_error = shared
                .autosave_error
                .lock()
                .ok()
                .and_then(|mut slot| slot.take());
            if let Some(error) = autosave_error {
                shared.emit("failed", None, &error, Vec::new());
            } else if shared.control.is_cancelled() {
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

#[derive(Debug)]
struct StoredScanSession {
    id: String,
    request: DirectSearchRequest,
    scope: String,
    source_id: Option<String>,
    source_name: Option<String>,
    current_source: Option<String>,
    source_count: usize,
    files_scanned: usize,
    total_bytes: u64,
    source_bytes_scanned: u64,
    content_bytes_scanned: u64,
    elapsed_ms: u64,
    query_count: usize,
    truncated: bool,
    message: String,
    hits: Vec<DirectSearchHit>,
}

fn load_recoverable_session(
    connection: &Connection,
    requested_id: Option<&str>,
) -> Result<Option<StoredScanSession>, String> {
    let query = "SELECT id, request_json, scope, source_id, source_name, current_source,
                source_count, files_scanned, total_bytes, source_bytes_scanned,
                content_bytes_scanned, elapsed_ms, query_count, truncated, message
         FROM live_scan_sessions
         WHERE status = 'interrupted' AND (?1 = '' OR id = ?1)
         ORDER BY updated_at DESC, id DESC LIMIT 1";
    let values = connection
        .query_row(query, [requested_id.unwrap_or("")], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, bool>(13)?,
                row.get::<_, String>(14)?,
            ))
        })
        .optional()
        .map_err(|_| "live search checkpoint could not be loaded".to_string())?;
    let Some((
        id,
        request_json,
        scope,
        source_id,
        source_name,
        current_source,
        source_count,
        files_scanned,
        total_bytes,
        source_bytes_scanned,
        content_bytes_scanned,
        elapsed_ms,
        query_count,
        truncated,
        message,
    )) = values
    else {
        return Ok(None);
    };
    let request = serde_json::from_str(&request_json)
        .map_err(|_| "live search checkpoint request is invalid".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, source_path, source_file, archive_entry, source_location,
                    excerpt, match_reason, matched_query
             FROM live_scan_hits WHERE session_id = ?1
             ORDER BY created_at, id LIMIT ?2",
        )
        .map_err(|_| "live search checkpoint results are unavailable".to_string())?;
    let hits = statement
        .query_map(params![id, MAX_RESULTS as i64], |row| {
            Ok(DirectSearchHit {
                id: row.get(0)?,
                source_path: row.get(1)?,
                source_file: row.get(2)?,
                archive_entry: row.get(3)?,
                source_location: row.get(4)?,
                excerpt: row.get(5)?,
                match_reason: row.get(6)?,
                matched_query: row.get(7)?,
            })
        })
        .map_err(|_| "live search checkpoint results are unavailable".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "live search checkpoint results are unavailable".to_string())?;
    Ok(Some(StoredScanSession {
        id,
        request,
        scope,
        source_id,
        source_name,
        current_source,
        source_count: source_count.max(0) as usize,
        files_scanned: files_scanned.max(0) as usize,
        total_bytes: total_bytes.max(0) as u64,
        source_bytes_scanned: source_bytes_scanned.max(0) as u64,
        content_bytes_scanned: content_bytes_scanned.max(0) as u64,
        elapsed_ms: elapsed_ms.max(0) as u64,
        query_count: query_count.max(0) as usize,
        truncated,
        message,
        hits,
    }))
}

#[tauri::command]
pub async fn get_recoverable_direct_search(
    state: State<'_, AppState>,
) -> Result<Option<RecoverableDirectSearch>, String> {
    let database = Arc::clone(&state.database);
    tauri::async_runtime::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        let Some(session) = load_recoverable_session(&connection, None)? else {
            return Ok(None);
        };
        let matches = session.hits.len();
        let bytes_per_second = session
            .content_bytes_scanned
            .saturating_mul(1_000)
            .checked_div(session.elapsed_ms.max(1))
            .unwrap_or(0);
        Ok(Some(RecoverableDirectSearch {
            progress: DirectSearchProgress {
                job_id: session.id,
                sequence: 0,
                status: "paused".to_string(),
                current_source: session.current_source,
                source_count: session.source_count,
                files_scanned: session.files_scanned,
                total_bytes: session.total_bytes,
                source_bytes_scanned: session.source_bytes_scanned,
                content_bytes_scanned: session.content_bytes_scanned,
                matches,
                elapsed_ms: session.elapsed_ms,
                bytes_per_second,
                estimated_remaining_ms: estimate_remaining_ms(
                    session.total_bytes,
                    session.source_bytes_scanned,
                    session.elapsed_ms,
                ),
                query_count: session.query_count,
                truncated: session.truncated,
                message: session.message,
                hits: session.hits,
                autosave_enabled: session.request.live_domain_autosave.is_some(),
                saved_matches: matches,
            },
            scope: session.scope,
            query: session.request.query,
            source_id: session.source_id,
            source_name: session.source_name,
        }))
    })
    .await
    .map_err(|_| "live search recovery task failed".to_string())?
}

#[tauri::command]
pub async fn restart_direct_search_session(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<DirectSearchStart, String> {
    ensure_live_scan_idle(&state)?;
    let (mut session, completed, stored_resume_points) = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        let session = load_recoverable_session(&connection, Some(&job_id))?
            .ok_or_else(|| "this interrupted live search is no longer recoverable".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT source_path, source_size, source_modified_ns
                 FROM live_scan_completed_sources WHERE session_id = ?1",
            )
            .map_err(|_| "completed source checkpoints are unavailable".to_string())?;
        let completed = statement
            .query_map([&job_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|_| "completed source checkpoints are unavailable".to_string())?
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|_| "completed source checkpoints are unavailable".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT source_path, source_size, source_modified_ns,
                        byte_offset, next_line
                 FROM live_scan_source_progress WHERE session_id = ?1",
            )
            .map_err(|_| "plain source checkpoints are unavailable".to_string())?;
        let resume_points = statement
            .query_map([&job_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    PlainResumePoint {
                        source_size: row.get::<_, i64>(1)?.max(0) as u64,
                        source_modified_ns: row.get::<_, i64>(2)?.max(0) as u64,
                        byte_offset: row.get::<_, i64>(3)?.max(0) as u64,
                        next_line: row.get::<_, i64>(4)?.max(1) as u64,
                    },
                ))
            })
            .map_err(|_| "plain source checkpoints are unavailable".to_string())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|_| "plain source checkpoints are unavailable".to_string())?;
        (session, completed, resume_points)
    };
    session.request.max_results = session.request.max_results.clamp(1, MAX_RESULTS);
    session.request.worker_limit = session.request.worker_limit.clamp(1, 8);
    let matcher = if session.request.domain_match {
        QueryMatcher::for_domain(
            &session.request.query,
            session.request.mode,
            session.request.case_sensitive,
        )?
    } else {
        QueryMatcher::new(
            &session.request.query,
            session.request.mode,
            session.request.case_sensitive,
        )?
    };
    let paths = session.request.paths.clone();
    let include_archives = session.request.include_archives;
    let all_candidates =
        tauri::async_runtime::spawn_blocking(move || collect_candidates(&paths, include_archives))
            .await
            .map_err(|_| "live source recovery task failed".to_string())??;
    if all_candidates.is_empty() {
        return Err("the saved Live source no longer contains supported files".to_string());
    }
    let total_bytes = all_candidates.iter().fold(0_u64, |total, candidate| {
        total.saturating_add(candidate.size)
    });
    let source_count = all_candidates.len();
    let mut completed_bytes = 0_u64;
    let mut completed_count = 0_usize;
    let mut resumed_bytes = 0_u64;
    let mut resume_points = HashMap::new();
    let candidates = all_candidates
        .into_iter()
        .filter(|candidate| {
            let key = (
                candidate.path.to_string_lossy().into_owned(),
                sqlite_integer(candidate.size),
                sqlite_integer(candidate.modified_ns),
            );
            if completed.contains(&key) {
                completed_count = completed_count.saturating_add(1);
                completed_bytes = completed_bytes.saturating_add(candidate.size);
                false
            } else {
                if let Some(point) = stored_resume_points.get(&key.0)
                    && point.source_size == candidate.size
                    && point.byte_offset < candidate.size
                    && point.source_modified_ns == candidate.modified_ns
                    && !matches!(extension(&candidate.path).as_str(), "zip" | "rar" | "gz")
                {
                    resumed_bytes = resumed_bytes.saturating_add(point.byte_offset);
                    resume_points.insert(key.0, *point);
                }
                true
            }
        })
        .collect::<Vec<_>>();
    let seen_hit_ids = session
        .hits
        .iter()
        .map(|hit| hit.id.clone())
        .collect::<HashSet<_>>();
    let baseline = ScanBaseline {
        elapsed_ms: session.elapsed_ms,
        files_scanned: completed_count,
        source_bytes_scanned: completed_bytes.saturating_add(resumed_bytes),
        content_bytes_scanned: completed_bytes.saturating_add(resumed_bytes),
        matches: seen_hit_ids.len(),
        seen_hit_ids,
        resume_points,
    };
    {
        let connection = state
            .database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        connection
            .execute(
                "UPDATE live_scan_sessions
                 SET status = 'running', current_source = NULL,
                     source_count = ?2, files_scanned = ?3, total_bytes = ?4,
                     source_bytes_scanned = ?5, content_bytes_scanned = ?5,
                     matches = ?6, message = 'Resuming from a saved checkpoint',
                     updated_at = CURRENT_TIMESTAMP, finished_at = NULL
                 WHERE id = ?1",
                params![
                    job_id,
                    source_count as i64,
                    completed_count as i64,
                    sqlite_integer(total_bytes),
                    sqlite_integer(completed_bytes.saturating_add(resumed_bytes)),
                    baseline.matches as i64,
                ],
            )
            .map_err(|_| "live search checkpoint could not be resumed".to_string())?;
    }
    launch_direct_scan(
        app,
        Arc::clone(&state.scan_jobs),
        Arc::clone(&state.database),
        session.request,
        matcher,
        candidates,
        job_id,
        source_count,
        total_bytes,
        baseline,
    )
}

fn ensure_live_scan_idle(state: &State<'_, AppState>) -> Result<(), String> {
    let active = state
        .scan_jobs
        .lock()
        .map_err(|_| "search controls are unavailable".to_string())?;
    if active.is_empty() {
        Ok(())
    } else {
        Err(
            "another Live scan is active; finish or cancel it before starting a new one"
                .to_string(),
        )
    }
}

#[tauri::command]
pub fn discard_direct_search_session(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "UPDATE live_scan_sessions
             SET status = 'cancelled', message = 'Interrupted scan dismissed',
                 updated_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND status = 'interrupted'",
            [&job_id],
        )
        .map_err(|_| "live search checkpoint could not be dismissed".to_string())?;
    Ok(())
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
        let metadata = path
            .metadata()
            .map_err(|_| "source metadata is unavailable".to_string())?;
        let size = metadata.len();
        let modified_ns = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_nanos().min(u64::MAX as u128) as u64)
            .unwrap_or(0);
        candidates.push(Candidate {
            path,
            size,
            modified_ns,
        });
    }
    Ok(())
}

fn run_scan(candidates: Vec<Candidate>, shared: Arc<SharedScan>) -> Result<(), String> {
    let queue = Arc::new(Mutex::new(VecDeque::from(candidates)));
    let first_error = Arc::new(Mutex::new(None::<String>));
    // Large breach collections are commonly stored on rotational disks. Keep physical
    // source reading sequential so multiple files do not make the drive seek between
    // streams. Plain-text matching still fans out across the configured CPU workers.
    let workers = SOURCE_READER_LIMIT.min(shared.source_count).max(1);
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
                    let resume_point = shared.resume_point(&candidate);
                    let source_progress = Arc::new(CandidateSourceProgress::new_at(
                        candidate.size,
                        resume_point.map_or(0, |point| point.byte_offset),
                    ));
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
                        let _ = persist_completed_candidate(
                            &shared.database,
                            &shared.job_id,
                            &candidate,
                        );
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
    let mut file = open_source_file(&candidate.path)
        .map_err(|_| "a source could not be opened read-only".to_string())?;
    let resume_point = shared.resume_point(candidate);
    if let Some(point) = resume_point {
        file.seek(SeekFrom::Start(point.byte_offset))
            .map_err(|_| "a plain source checkpoint could not be resumed".to_string())?;
    }
    let workers = if candidate.size >= PARALLEL_PLAIN_THRESHOLD {
        shared.request.worker_limit.clamp(1, 8)
    } else {
        1
    };
    if workers == 1 {
        scan_plain_sequential(file, candidate, shared, source_progress, resume_point)
    } else {
        scan_plain_parallel(
            file,
            candidate,
            shared,
            source_progress,
            resume_point,
            workers,
        )
    }
}

struct PlainBlock {
    bytes: Vec<u8>,
    start_line: u64,
    sequence: u64,
    end_offset: u64,
    next_line: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlainMatch {
    line_start: usize,
    line_end: usize,
    line_number: u64,
    query_index: usize,
}

struct PlainCheckpointTracker {
    next_sequence: u64,
    completed: BTreeMap<u64, (u64, u64)>,
    latest_offset: u64,
    latest_line: u64,
    persisted_offset: u64,
}

impl PlainCheckpointTracker {
    fn new(offset: u64, line: u64) -> Self {
        Self {
            next_sequence: 1,
            completed: BTreeMap::new(),
            latest_offset: offset,
            latest_line: line.max(1),
            persisted_offset: offset,
        }
    }
}

fn complete_plain_checkpoint(
    tracker: &Arc<Mutex<PlainCheckpointTracker>>,
    sequence: u64,
    end_offset: u64,
    next_line: u64,
    force: bool,
) -> Option<(u64, u64)> {
    let mut tracker = tracker.lock().ok()?;
    if !force {
        tracker.completed.insert(sequence, (end_offset, next_line));
        loop {
            let next_sequence = tracker.next_sequence;
            let Some((offset, line)) = tracker.completed.remove(&next_sequence) else {
                break;
            };
            tracker.latest_offset = offset;
            tracker.latest_line = line;
            tracker.next_sequence = tracker.next_sequence.saturating_add(1);
        }
    }
    if tracker.latest_offset > tracker.persisted_offset
        && (force
            || tracker
                .latest_offset
                .saturating_sub(tracker.persisted_offset)
                >= PLAIN_CHECKPOINT_BYTES)
    {
        tracker.persisted_offset = tracker.latest_offset;
        Some((tracker.latest_offset, tracker.latest_line))
    } else {
        None
    }
}

fn scan_plain_sequential(
    file: File,
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
    resume_point: Option<PlainResumePoint>,
) -> Result<(), String> {
    let mut last_checkpoint = resume_point.map_or(0, |point| point.byte_offset);
    let mut latest = resume_point.map_or((0, 1), |point| (point.byte_offset, point.next_line));
    let result = read_plain_blocks(file, shared, source_progress, resume_point, |block| {
        scan_plain_block(&block, candidate, shared, source_progress);
        latest = (block.end_offset, block.next_line);
        if block.end_offset.saturating_sub(last_checkpoint) >= PLAIN_CHECKPOINT_BYTES {
            persist_plain_checkpoint(
                &shared.database,
                &shared.job_id,
                candidate,
                block.end_offset,
                block.next_line,
            )?;
            last_checkpoint = block.end_offset;
        }
        Ok(())
    });
    if latest.0 > last_checkpoint {
        let _ = persist_plain_checkpoint(
            &shared.database,
            &shared.job_id,
            candidate,
            latest.0,
            latest.1,
        );
    }
    result
}

fn scan_plain_parallel(
    file: File,
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
    resume_point: Option<PlainResumePoint>,
    workers: usize,
) -> Result<(), String> {
    let (sender, receiver) = mpsc::sync_channel::<PlainBlock>(workers.saturating_mul(2));
    let receiver = Arc::new(Mutex::new(receiver));
    let checkpoints = Arc::new(Mutex::new(PlainCheckpointTracker::new(
        resume_point.map_or(0, |point| point.byte_offset),
        resume_point.map_or(1, |point| point.next_line),
    )));
    let mut read_result = Ok(());
    thread::scope(|scope| {
        for _ in 0..workers {
            let receiver = Arc::clone(&receiver);
            let shared = Arc::clone(shared);
            let source_progress = Arc::clone(source_progress);
            let checkpoints = Arc::clone(&checkpoints);
            scope.spawn(move || {
                loop {
                    if !shared.wait_until_running() {
                        break;
                    }
                    let block = match receiver.lock() {
                        Ok(receiver) => receiver.recv().ok(),
                        Err(_) => None,
                    };
                    let Some(block) = block else { break };
                    scan_plain_block(&block, candidate, &shared, &source_progress);
                    if let Some((offset, line)) = complete_plain_checkpoint(
                        &checkpoints,
                        block.sequence,
                        block.end_offset,
                        block.next_line,
                        false,
                    ) {
                        let _ = persist_plain_checkpoint(
                            &shared.database,
                            &shared.job_id,
                            candidate,
                            offset,
                            line,
                        );
                    }
                }
            });
        }
        read_result = read_plain_blocks(file, shared, source_progress, resume_point, |block| {
            sender
                .send(block)
                .map_err(|_| "live search workers stopped".to_string())
        });
        drop(sender);
    });
    if let Some((offset, line)) = complete_plain_checkpoint(&checkpoints, 0, 0, 1, true) {
        let _ = persist_plain_checkpoint(&shared.database, &shared.job_id, candidate, offset, line);
    }
    if shared.should_stop() {
        Ok(())
    } else {
        read_result
    }
}

fn read_plain_blocks<F>(
    file: File,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
    resume_point: Option<PlainResumePoint>,
    consume: F,
) -> Result<(), String>
where
    F: FnMut(PlainBlock) -> Result<(), String>,
{
    read_plain_blocks_from_at(
        file,
        PLAIN_CHUNK_BYTES,
        resume_point.map_or(0, |point| point.byte_offset),
        resume_point.map_or(1, |point| point.next_line),
        || shared.wait_until_running(),
        |bytes| account_plain_bytes(bytes, shared, source_progress),
        consume,
    )
}

#[cfg(test)]
fn read_plain_blocks_from<R, C, A, F>(
    reader: R,
    chunk_bytes: usize,
    should_continue: C,
    account_discarded: A,
    consume: F,
) -> Result<(), String>
where
    R: Read,
    C: FnMut() -> bool,
    A: FnMut(u64),
    F: FnMut(PlainBlock) -> Result<(), String>,
{
    read_plain_blocks_from_at(
        reader,
        chunk_bytes,
        0,
        1,
        should_continue,
        account_discarded,
        consume,
    )
}

fn read_plain_blocks_from_at<R, C, A, F>(
    mut reader: R,
    chunk_bytes: usize,
    starting_offset: u64,
    starting_line: u64,
    mut should_continue: C,
    mut account_discarded: A,
    mut consume: F,
) -> Result<(), String>
where
    R: Read,
    C: FnMut() -> bool,
    A: FnMut(u64),
    F: FnMut(PlainBlock) -> Result<(), String>,
{
    let chunk_bytes = chunk_bytes.max(1);
    let mut read_buffer = vec![0_u8; chunk_bytes];
    let mut pending = Vec::with_capacity(chunk_bytes.saturating_add(MAX_LINE_BYTES));
    let mut start_line = starting_line.max(1);
    let mut consumed_offset = starting_offset;
    let mut sequence = 0_u64;
    let mut discarding_long_line = false;

    loop {
        if !should_continue() {
            break;
        }
        let bytes_read = reader
            .read(&mut read_buffer)
            .map_err(|_| "source read failed".to_string())?;
        if bytes_read == 0 {
            break;
        }
        let mut incoming = &read_buffer[..bytes_read];
        if discarding_long_line {
            if let Some(newline) = memchr::memchr(b'\n', incoming) {
                account_discarded((newline + 1) as u64);
                consumed_offset = consumed_offset.saturating_add((newline + 1) as u64);
                start_line = start_line.saturating_add(1);
                incoming = &incoming[newline + 1..];
                discarding_long_line = false;
            } else {
                account_discarded(incoming.len() as u64);
                consumed_offset = consumed_offset.saturating_add(incoming.len() as u64);
                continue;
            }
        }
        pending.extend_from_slice(incoming);

        if let Some(last_newline) = memchr::memrchr(b'\n', &pending) {
            let tail = pending.split_off(last_newline + 1);
            let complete = std::mem::replace(&mut pending, tail);
            let line_count = memchr::memchr_iter(b'\n', &complete).count() as u64;
            consumed_offset = consumed_offset.saturating_add(complete.len() as u64);
            sequence = sequence.saturating_add(1);
            consume(PlainBlock {
                bytes: complete,
                start_line,
                sequence,
                end_offset: consumed_offset,
                next_line: start_line.saturating_add(line_count),
            })?;
            start_line = start_line.saturating_add(line_count);
        } else if pending.len() > MAX_LINE_BYTES {
            account_discarded(pending.len() as u64);
            consumed_offset = consumed_offset.saturating_add(pending.len() as u64);
            pending.clear();
            discarding_long_line = true;
        }
    }

    if should_continue() && !discarding_long_line && !pending.is_empty() {
        consumed_offset = consumed_offset.saturating_add(pending.len() as u64);
        sequence = sequence.saturating_add(1);
        consume(PlainBlock {
            bytes: pending,
            start_line,
            sequence,
            end_offset: consumed_offset,
            next_line: start_line.saturating_add(1),
        })?;
    }
    Ok(())
}

fn scan_plain_block(
    block: &PlainBlock,
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) {
    if !shared.should_stop() {
        let source_path = candidate.path.to_string_lossy();
        let source_file = file_name(&candidate.path);
        let mut hits = Vec::with_capacity(HIT_BATCH_SIZE);
        for matched in find_plain_matches(
            &block.bytes,
            block.start_line,
            &shared.matcher,
            shared.request.max_results,
        ) {
            if shared.should_stop() {
                break;
            }
            let line = block.bytes[matched.line_start..matched.line_end]
                .strip_suffix(b"\r")
                .unwrap_or(&block.bytes[matched.line_start..matched.line_end]);
            if let Some(hit) = make_hit(
                &source_path,
                &source_file,
                None,
                matched.line_number,
                line,
                matched.query_index,
                shared,
            ) {
                hits.push(hit);
                if hits.len() >= HIT_BATCH_SIZE {
                    shared.emit(
                        "running",
                        Some(source_file.clone()),
                        "Matches found",
                        std::mem::take(&mut hits),
                    );
                }
            }
        }
        if !hits.is_empty() {
            shared.emit("running", Some(source_file), "Matches found", hits);
        }
    }
    account_plain_bytes(block.bytes.len() as u64, shared, source_progress);
}

fn find_plain_matches(
    block: &[u8],
    start_line: u64,
    matcher: &QueryMatcher,
    limit: usize,
) -> Vec<PlainMatch> {
    if !matcher.unicode_queries.is_empty() {
        return find_plain_matches_by_line(block, start_line, matcher, limit);
    }
    if let Some((candidate_matcher, _)) = &matcher.flexible_name {
        return find_plain_matches_at_offsets(
            block,
            start_line,
            matcher,
            candidate_matcher
                .find_iter(block)
                .map(|matched| matched.start()),
            limit,
        );
    }
    if let Some(candidate_matcher) = &matcher.literal {
        return find_plain_matches_at_offsets(
            block,
            start_line,
            matcher,
            candidate_matcher
                .find_iter(block)
                .map(|matched| matched.start()),
            limit,
        );
    }
    Vec::new()
}

fn find_plain_matches_at_offsets<I>(
    block: &[u8],
    start_line: u64,
    matcher: &QueryMatcher,
    offsets: I,
    limit: usize,
) -> Vec<PlainMatch>
where
    I: Iterator<Item = usize>,
{
    let mut matches = Vec::new();
    let mut last_line_start = usize::MAX;
    let mut line_cursor = 0_usize;
    let mut line_number = start_line;
    for offset in offsets {
        if matches.len() >= limit {
            break;
        }
        let line_start = memchr::memrchr(b'\n', &block[..offset]).map_or(0, |newline| newline + 1);
        if line_start == last_line_start {
            continue;
        }
        last_line_start = line_start;
        line_number = line_number.saturating_add(
            memchr::memchr_iter(b'\n', &block[line_cursor..line_start]).count() as u64,
        );
        line_cursor = line_start;
        let line_end = memchr::memchr(b'\n', &block[line_start..])
            .map_or(block.len(), |newline| line_start + newline);
        let line = block[line_start..line_end]
            .strip_suffix(b"\r")
            .unwrap_or(&block[line_start..line_end]);
        if line.len() > MAX_LINE_BYTES {
            continue;
        }
        if let Some(query_index) = matcher.find_match(line) {
            matches.push(PlainMatch {
                line_start,
                line_end,
                line_number,
                query_index,
            });
        }
    }
    matches
}

fn find_plain_matches_by_line(
    block: &[u8],
    start_line: u64,
    matcher: &QueryMatcher,
    limit: usize,
) -> Vec<PlainMatch> {
    let mut start = 0_usize;
    let mut line_number = start_line;
    let mut matches = Vec::new();
    while start < block.len() && matches.len() < limit {
        let end =
            memchr::memchr(b'\n', &block[start..]).map_or(block.len(), |newline| start + newline);
        let line = block[start..end]
            .strip_suffix(b"\r")
            .unwrap_or(&block[start..end]);
        if line.len() <= MAX_LINE_BYTES
            && let Some(query_index) = matcher.find_match(line)
        {
            matches.push(PlainMatch {
                line_start: start,
                line_end: end,
                line_number,
                query_index,
            });
        }
        if end == block.len() {
            break;
        }
        start = end + 1;
        line_number = line_number.saturating_add(1);
    }
    matches
}

#[doc(hidden)]
pub fn benchmark_plain_scan_bytes(
    bytes: &[u8],
    query: &str,
    mode: SearchMode,
    case_sensitive: bool,
    workers: usize,
) -> Result<usize, String> {
    let matcher = QueryMatcher::new(query, mode, case_sensitive)?;
    let mut chunks = Vec::new();
    let mut start = 0_usize;
    while start < bytes.len() {
        let desired_end = start.saturating_add(PLAIN_CHUNK_BYTES).min(bytes.len());
        let end = if desired_end == bytes.len() {
            desired_end
        } else {
            memchr::memchr(b'\n', &bytes[desired_end..])
                .map_or(bytes.len(), |newline| desired_end + newline + 1)
        };
        chunks.push(&bytes[start..end]);
        start = end;
    }
    if workers <= 1 || chunks.len() <= 1 {
        return Ok(chunks
            .iter()
            .map(|chunk| find_plain_matches(chunk, 1, &matcher, usize::MAX).len())
            .sum());
    }
    let next = AtomicUsize::new(0);
    let total = AtomicUsize::new(0);
    thread::scope(|scope| {
        for _ in 0..workers.clamp(1, 8) {
            let chunks = &chunks;
            let matcher = &matcher;
            let next = &next;
            let total = &total;
            scope.spawn(move || {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(chunk) = chunks.get(index) else {
                        break;
                    };
                    total.fetch_add(
                        find_plain_matches(chunk, 1, matcher, usize::MAX).len(),
                        Ordering::Relaxed,
                    );
                }
            });
        }
    });
    Ok(total.load(Ordering::Relaxed))
}

fn account_plain_bytes(
    bytes: u64,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) {
    shared.add_content_bytes(bytes);
    source_progress.add_physical_bytes(bytes, shared);
    if bytes >= PROGRESS_BYTE_INTERVAL {
        shared.emit("running", None, "Scanning local sources", Vec::new());
    }
}

fn scan_gzip(
    candidate: &Candidate,
    shared: &Arc<SharedScan>,
    source_progress: &Arc<CandidateSourceProgress>,
) -> Result<(), String> {
    let file = open_source_file(&candidate.path)
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
    let file = open_source_file(&candidate.path)
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
        if let Some(query_index) = shared.matcher.find_match(&line)
            && let Some(hit) = make_hit(
                source_path,
                source_file,
                archive_entry.as_deref(),
                line_number,
                &line,
                query_index,
                shared,
            )
        {
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
    query_index: usize,
    shared: &Arc<SharedScan>,
) -> Option<DirectSearchHit> {
    let source_location = format!("line {line_number}");
    let mut fingerprint = blake3::Hasher::new();
    for part in [
        shared.job_id.as_str(),
        source_path,
        archive_entry.unwrap_or(""),
        source_location.as_str(),
        shared.matcher.query(query_index),
    ] {
        fingerprint.update(part.as_bytes());
        fingerprint.update(&[0x1f]);
    }
    let id = fingerprint.finalize().to_hex().to_string();
    let inserted = shared
        .seen_hit_ids
        .lock()
        .map(|mut seen| seen.insert(id.clone()))
        .unwrap_or(false);
    if !inserted {
        return None;
    }
    if !shared.reserve_hit() {
        return None;
    }
    Some(DirectSearchHit {
        id,
        source_path: source_path.to_string(),
        source_file: source_file.to_string(),
        archive_entry: archive_entry.map(ToString::to_string),
        source_location,
        excerpt: display_excerpt(
            line,
            shared.matcher.query(query_index),
            shared.matcher.case_sensitive,
        ),
        match_reason: if shared.matcher.is_domain_match() {
            "Parent or subdomain found"
        } else if shared.matcher.is_flexible_name() {
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

fn display_excerpt(line: &[u8], query: &str, case_sensitive: bool) -> String {
    let query_bytes = query.as_bytes();
    let match_start = if query.is_ascii() {
        if case_sensitive {
            memchr::memmem::find(line, query_bytes)
        } else {
            line.windows(query_bytes.len().max(1))
                .position(|window| window.eq_ignore_ascii_case(query_bytes))
        }
    } else {
        None
    }
    .unwrap_or(0);
    let start = match_start.saturating_sub(RAW_EXCERPT_BYTES / 3);
    let end = start.saturating_add(RAW_EXCERPT_BYTES).min(line.len());
    let value = String::from_utf8_lossy(&line[start..end]);
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
    let mut excerpt = String::with_capacity(361);
    let mut character_count = 0_usize;
    let mut pending_space = false;
    let mut truncated = end < line.len();
    for character in pairs.chars() {
        if character.is_whitespace() {
            pending_space = !excerpt.is_empty();
            continue;
        }
        if pending_space && character_count < 360 {
            excerpt.push(' ');
            character_count += 1;
        }
        pending_space = false;
        if character_count >= 360 {
            truncated = true;
            break;
        }
        excerpt.push(character);
        character_count += 1;
    }
    if truncated {
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
        if let Some(query_index) = self.shared.matcher.find_match(&self.pending)
            && let Some(hit) = make_hit(
                &self.source_path,
                &self.source_file,
                Some(&self.archive_entry),
                self.line_number,
                &self.pending,
                query_index,
                &self.shared,
            )
        {
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
        cell::Cell,
        io::{Cursor, Read, Write},
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
        ArchiveReader, Candidate, CandidateSourceProgress, DirectSearchHit, DirectSearchProgress,
        DirectSearchRequest, DirectSearchSessionContext, MAX_LINE_BYTES, MAX_QUERY_COUNT,
        PlainCheckpointTracker, QueryMatcher, active_elapsed_ms, build_preflight,
        complete_plain_checkpoint, create_scan_session, display_excerpt, estimate_remaining_ms,
        extension, field_tokens, find_plain_matches, is_text_extension, line_matches,
        load_recoverable_session, parse_queries, persist_completed_candidate,
        persist_plain_checkpoint, persist_session_progress, read_plain_blocks_from,
        read_plain_blocks_from_at,
    };
    use crate::{models::SearchMode, storage::open_database};

    #[test]
    fn live_scan_checkpoint_preserves_partial_hits_and_completed_sources() {
        let directory = tempdir().expect("temporary directory");
        let database = Arc::new(Mutex::new(
            open_database(directory.path()).expect("database"),
        ));
        let request = DirectSearchRequest {
            paths: vec!["C:\\Synthetic\\records".to_string()],
            query: "synthetic@example.test".to_string(),
            mode: SearchMode::Contains,
            domain_match: false,
            case_sensitive: false,
            include_archives: true,
            max_results: 100,
            worker_limit: 2,
            session_context: Some(DirectSearchSessionContext {
                scope: "search".to_string(),
                source_id: Some("source-synthetic".to_string()),
                source_name: Some("Synthetic source".to_string()),
            }),
            live_domain_autosave: None,
        };
        create_scan_session(&database, "scan-synthetic", &request, 2, 200, 1).expect("session");
        let hit = DirectSearchHit {
            id: "hit-synthetic".to_string(),
            source_path: "C:\\Synthetic\\records\\one.txt".to_string(),
            source_file: "one.txt".to_string(),
            archive_entry: None,
            source_location: "line 1".to_string(),
            excerpt: "synthetic@example.test".to_string(),
            match_reason: "Line contains query".to_string(),
            matched_query: "synthetic@example.test".to_string(),
        };
        persist_session_progress(
            &database,
            &DirectSearchProgress {
                job_id: "scan-synthetic".to_string(),
                sequence: 1,
                status: "running".to_string(),
                current_source: Some("one.txt".to_string()),
                source_count: 2,
                files_scanned: 1,
                total_bytes: 200,
                source_bytes_scanned: 100,
                content_bytes_scanned: 100,
                matches: 1,
                elapsed_ms: 50,
                bytes_per_second: 2_000,
                estimated_remaining_ms: Some(50),
                query_count: 1,
                truncated: false,
                message: "Scanning local sources".to_string(),
                hits: vec![hit],
                autosave_enabled: false,
                saved_matches: 0,
            },
        )
        .expect("progress");
        let candidate = Candidate {
            path: "C:\\Synthetic\\records\\one.txt".into(),
            size: 100,
            modified_ns: 1,
        };
        persist_plain_checkpoint(&database, "scan-synthetic", &candidate, 80, 12)
            .expect("plain checkpoint");
        persist_completed_candidate(&database, "scan-synthetic", &candidate)
            .expect("completed source");
        {
            let connection = database.lock().expect("database lock");
            connection
                .execute(
                    "UPDATE live_scan_sessions SET status = 'interrupted'
                     WHERE id = 'scan-synthetic'",
                    [],
                )
                .expect("interrupt");
            let recovered = load_recoverable_session(&connection, Some("scan-synthetic"))
                .expect("recovery")
                .expect("session exists");
            assert_eq!(recovered.files_scanned, 1);
            assert_eq!(recovered.hits.len(), 1);
            assert_eq!(recovered.hits[0].id, "hit-synthetic");
            let partial_count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM live_scan_source_progress
                     WHERE session_id = 'scan-synthetic'",
                    [],
                    |row| row.get(0),
                )
                .expect("partial checkpoint count");
            assert_eq!(partial_count, 0);
        }
    }

    #[test]
    fn plain_resume_offsets_and_parallel_checkpoints_advance_in_order() {
        let mut blocks = Vec::new();
        read_plain_blocks_from_at(
            Cursor::new(b"a\nb\nc"),
            2,
            5,
            10,
            || true,
            |_| {},
            |block| {
                blocks.push((
                    block.sequence,
                    block.start_line,
                    block.end_offset,
                    block.next_line,
                ));
                Ok(())
            },
        )
        .expect("resumed blocks");
        assert_eq!(
            blocks,
            vec![(1, 10, 7, 11), (2, 11, 9, 12), (3, 12, 10, 13)]
        );

        let tracker = Arc::new(Mutex::new(PlainCheckpointTracker::new(5, 10)));
        assert_eq!(complete_plain_checkpoint(&tracker, 2, 9, 12, false), None);
        assert_eq!(complete_plain_checkpoint(&tracker, 1, 7, 11, false), None);
        assert_eq!(
            complete_plain_checkpoint(&tracker, 0, 0, 1, true),
            Some((9, 12))
        );
    }

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

        let domain = QueryMatcher::for_domain("example.com", SearchMode::Contains, false)
            .expect("domain matcher");
        assert!(domain.find_match(b"domain=example.com").is_some());
        assert!(
            domain
                .find_match(b"url=https://portal.example.com/path")
                .is_some()
        );
        assert!(domain.find_match(b"email=person@example.com").is_some());
        assert!(domain.find_match(b"domain=notexample.com").is_none());
        assert!(domain.find_match(b"domain=example.com.evil.test").is_none());
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
    fn chunk_scanner_preserves_lines_newlines_and_invalid_utf8() {
        let matcher = QueryMatcher::new("needle", SearchMode::Contains, false).expect("matcher");
        let block = b"needle first\r\nabsent\ninvalid-\xff-NEEDLE\nlast needle";
        let matches = find_plain_matches(block, 1, &matcher, 20);
        assert_eq!(
            matches
                .iter()
                .map(|matched| matched.line_number)
                .collect::<Vec<_>>(),
            vec![1, 3, 4]
        );
    }

    #[test]
    fn chunk_scanner_keeps_exact_prefix_and_unicode_semantics() {
        let block = "prefix=value\nfield=exact\nlabel=Grüße\nnotexactly\n".as_bytes();
        let prefix = QueryMatcher::new("val", SearchMode::Prefix, false).expect("prefix matcher");
        let exact = QueryMatcher::new("exact", SearchMode::Exact, false).expect("exact matcher");
        let unicode =
            QueryMatcher::new("grüße", SearchMode::Contains, false).expect("unicode matcher");
        assert_eq!(find_plain_matches(block, 1, &prefix, 20)[0].line_number, 1);
        assert_eq!(find_plain_matches(block, 1, &exact, 20)[0].line_number, 2);
        assert_eq!(find_plain_matches(block, 1, &unicode, 20)[0].line_number, 3);
    }

    #[test]
    fn adjacent_chunks_do_not_duplicate_boundary_lines() {
        let matcher = QueryMatcher::new("needle", SearchMode::Contains, false).expect("matcher");
        let first = find_plain_matches(b"first needle\nsecond\n", 1, &matcher, 20);
        let second = find_plain_matches(b"third needle\nfourth needle", 3, &matcher, 20);
        let lines = first
            .into_iter()
            .chain(second)
            .map(|matched| matched.line_number)
            .collect::<Vec<_>>();
        assert_eq!(lines, vec![1, 3, 4]);
    }

    #[test]
    fn block_reader_aligns_small_reads_without_missing_the_final_line() {
        let source = b"first\r\nsecond needle\nthird\nfourth needle";
        let mut blocks = Vec::new();
        let mut discarded = 0_u64;
        read_plain_blocks_from(
            Cursor::new(source),
            7,
            || true,
            |bytes| discarded = discarded.saturating_add(bytes),
            |block| {
                blocks.push(block);
                Ok(())
            },
        )
        .expect("split plain source");
        assert_eq!(discarded, 0);
        assert_eq!(
            blocks
                .iter()
                .flat_map(|block| block.bytes.iter().copied())
                .collect::<Vec<_>>(),
            source
        );
        let matcher = QueryMatcher::new("needle", SearchMode::Contains, false).expect("matcher");
        let lines = blocks
            .iter()
            .flat_map(|block| find_plain_matches(&block.bytes, block.start_line, &matcher, 20))
            .map(|matched| matched.line_number)
            .collect::<Vec<_>>();
        assert_eq!(lines, vec![2, 4]);
    }

    #[test]
    fn block_reader_stops_at_a_cancellation_boundary() {
        let checks = Cell::new(0_usize);
        let mut scanned = 0_usize;
        read_plain_blocks_from(
            Cursor::new(b"one\ntwo\nthree\nfour\n"),
            4,
            || {
                let current = checks.get();
                checks.set(current + 1);
                current < 2
            },
            |_| {},
            |block| {
                scanned = scanned.saturating_add(block.bytes.len());
                Ok(())
            },
        )
        .expect("cancelled read");
        assert!(scanned < b"one\ntwo\nthree\nfour\n".len());
    }

    #[test]
    fn one_two_four_and_eight_workers_find_the_same_plain_matches() {
        let line = b"needle|synthetic\nabsent|synthetic\n";
        let mut source = Vec::with_capacity(super::PLAIN_CHUNK_BYTES + line.len());
        while source.len() <= super::PLAIN_CHUNK_BYTES {
            source.extend_from_slice(line);
        }
        let expected = memchr::memmem::find_iter(&source, b"needle").count();
        for workers in [1, 2, 4, 8] {
            assert_eq!(
                super::benchmark_plain_scan_bytes(
                    &source,
                    "needle",
                    SearchMode::Contains,
                    false,
                    workers,
                )
                .expect("parallel benchmark scan"),
                expected
            );
        }
    }

    #[test]
    fn chunk_scanner_bounds_long_lines_and_common_matches() {
        let matcher = QueryMatcher::new("needle", SearchMode::Contains, false).expect("matcher");
        let mut long_line = vec![b'x'; MAX_LINE_BYTES + 1];
        long_line.extend_from_slice(b"needle\nneedle\nneedle\n");
        let matches = find_plain_matches(&long_line, 1, &matcher, 2);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line_number, 2);
        assert_eq!(matches[1].line_number, 3);
    }

    #[test]
    fn remaining_time_uses_physical_source_progress() {
        assert_eq!(estimate_remaining_ms(1_000, 250, 2_000), Some(6_000));
        assert_eq!(estimate_remaining_ms(1_000, 0, 2_000), None);
        assert_eq!(estimate_remaining_ms(1_000, 1_000, 2_000), None);
    }

    #[test]
    fn preflight_samples_sources_and_returns_a_bounded_estimate() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("synthetic.txt");
        std::fs::write(&path, b"synthetic@example.test\n".repeat(4_096)).expect("synthetic source");
        let size = path.metadata().expect("metadata").len();
        let result = build_preflight(
            &[Candidate {
                path,
                size,
                modified_ns: 1,
            }],
            None,
        )
        .expect("preflight");

        assert_eq!(result.source_count, 1);
        assert_eq!(result.total_bytes, size);
        assert_eq!(result.archive_count, 0);
        assert!(result.sample_read_bytes_per_second > 0);
        assert!(result.estimated_maximum_ms >= result.estimated_minimum_ms);
        assert_eq!(result.source_reader_limit, 1);
        assert!((1..=8).contains(&result.recommended_worker_limit));
    }

    #[test]
    fn paused_time_does_not_reduce_reported_scan_throughput() {
        assert_eq!(active_elapsed_ms(10_000, 2_000, 3_000), 5_000);
        assert_eq!(active_elapsed_ms(1_000, 2_000, 0), 0);
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
        let queries = (0..query_count)
            .map(|index| format!("absent-{index:04}@example.test"))
            .collect::<Vec<_>>()
            .join("\n");
        let matcher =
            QueryMatcher::new(&queries, SearchMode::Contains, false).expect("soak matcher");
        let pattern = b"user-0000000000|person-0000000000@example.test|synthetic-value\n";
        let mut block = Vec::with_capacity(super::PLAIN_CHUNK_BYTES);
        while block.len() + pattern.len() <= super::PLAIN_CHUNK_BYTES {
            block.extend_from_slice(pattern);
        }
        let mut consumed = 0_u64;
        let mut lines = 0_u64;
        let started = Instant::now();
        while consumed < target_bytes {
            let remaining = target_bytes.saturating_sub(consumed) as usize;
            let current = &block[..remaining.min(block.len())];
            assert!(find_plain_matches(current, 1, &matcher, 1).is_empty());
            consumed = consumed.saturating_add(current.len() as u64);
            lines = lines.saturating_add(memchr::memchr_iter(b'\n', current).count() as u64);
        }
        let elapsed = started.elapsed();
        assert_eq!(consumed, target_bytes);
        eprintln!(
            "scanned {gibibytes} GiB / {lines} generated lines against {query_count} queries in {:.2?} ({:.1} MiB/s)",
            elapsed,
            consumed as f64 / 1024.0 / 1024.0 / elapsed.as_secs_f64()
        );
    }

    #[test]
    #[ignore = "manual authorized plain-file read-only throughput probe"]
    fn authorized_plain_stream_probe() {
        let path = std::env::var("ALETHEIA_PLAIN_PROBE_PATH")
            .expect("set ALETHEIA_PLAIN_PROBE_PATH to an authorized plain source");
        let mut file = std::fs::File::open(path).expect("open authorized source read-only");
        let matcher = QueryMatcher::new(
            "aletheia-guaranteed-absent-synthetic-probe.invalid",
            SearchMode::Contains,
            false,
        )
        .expect("probe matcher");
        let mut buffer = vec![0_u8; super::PLAIN_CHUNK_BYTES];
        let mut bytes = 0_u64;
        let started = Instant::now();
        loop {
            let read = file.read(&mut buffer).expect("read authorized source");
            if read == 0 {
                break;
            }
            assert!(find_plain_matches(&buffer[..read], 1, &matcher, 1).is_empty());
            bytes = bytes.saturating_add(read as u64);
        }
        let elapsed = started.elapsed();
        assert!(bytes > 0);
        eprintln!(
            "plain source probe: {bytes} bytes in {:.3}s ({:.1} MiB/s)",
            elapsed.as_secs_f64(),
            bytes as f64 / 1024.0 / 1024.0 / elapsed.as_secs_f64()
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
            b"synthetic@example.com:invented-value password=invented-secret +1 202 555 0142",
            "synthetic@example.com",
            false,
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
