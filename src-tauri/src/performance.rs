use std::{
    fs::{self, File, OpenOptions},
    hint::black_box,
    io::{Read, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use aho_corasick::AhoCorasick;
use chrono::Utc;
use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::storage::AppState;

const DISK_BENCHMARK_BYTES: u64 = 64 * 1024 * 1024;
const MEMORY_BENCHMARK_BYTES: usize = 32 * 1024 * 1024;
const CPU_SAMPLE_BYTES: usize = 8 * 1024 * 1024;
const ARCHIVE_SAMPLE_BYTES: usize = 8 * 1024 * 1024;
const PROFILE_KEY: &str = "performance_profile";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceProfile {
    pub disk_read_bytes_per_second: u64,
    pub disk_write_bytes_per_second: u64,
    pub cpu_scan_bytes_per_second: u64,
    pub memory_copy_bytes_per_second: u64,
    pub archive_bytes_per_second: u64,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub logical_cores: usize,
    pub recommended_worker_limit: u32,
    pub recommended_memory_limit_mb: u32,
    pub storage_class: String,
    pub recommendation_reason: String,
    pub measured_at: String,
}

struct BenchmarkFile(PathBuf);

impl Drop for BenchmarkFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[tauri::command]
pub async fn run_performance_benchmark(
    state: State<'_, AppState>,
) -> Result<PerformanceProfile, String> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let storage_root = app_state
            .current_storage_root()
            .map_err(|_| "benchmark storage is unavailable".to_string())?;
        let profile = benchmark(&storage_root)?;
        persist_profile(&app_state, &profile)?;
        Ok(profile)
    })
    .await
    .map_err(|_| "performance benchmark task failed".to_string())?
}

#[tauri::command]
pub fn get_performance_profile(
    state: State<'_, AppState>,
) -> Result<Option<PerformanceProfile>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "performance profile is unavailable".to_string())?;
    load_profile(&connection)
}

pub(crate) fn load_profile(connection: &Connection) -> Result<Option<PerformanceProfile>, String> {
    let value = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = ?1",
            [PROFILE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "performance profile is unavailable".to_string())?;
    value
        .map(|json| {
            serde_json::from_str(&json)
                .map_err(|_| "saved performance profile is invalid".to_string())
        })
        .transpose()
}

fn persist_profile(state: &AppState, profile: &PerformanceProfile) -> Result<(), String> {
    let json = serde_json::to_string(profile)
        .map_err(|_| "performance profile could not be saved".to_string())?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "performance profile could not be saved".to_string())?;
    connection
        .execute(
            "INSERT INTO settings(key, value_json, updated_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = CURRENT_TIMESTAMP",
            params![PROFILE_KEY, json],
        )
        .map_err(|_| "performance profile could not be saved".to_string())?;
    Ok(())
}

fn benchmark(storage_root: &Path) -> Result<PerformanceProfile, String> {
    let (disk_read_bytes_per_second, disk_write_bytes_per_second) = benchmark_disk(storage_root)?;
    let cpu_scan_bytes_per_second = benchmark_cpu_scan()?;
    let memory_copy_bytes_per_second = benchmark_memory_copy();
    let archive_bytes_per_second = benchmark_archive()?;
    let (total_memory_bytes, available_memory_bytes) = physical_memory();
    let logical_cores = thread::available_parallelism().map_or(1, usize::from);
    let io_rate = disk_read_bytes_per_second.min(disk_write_bytes_per_second);
    let recommended_worker_limit = recommended_workers(io_rate, logical_cores);
    let recommended_memory_limit_mb =
        recommended_memory(total_memory_bytes, available_memory_bytes);
    let storage_class = classify_storage(io_rate).to_string();
    let recommendation_reason = format!(
        "{storage_class} workspace I/O and {logical_cores} logical CPU cores support {recommended_worker_limit} indexing workers with a {recommended_memory_limit_mb} MB writer budget."
    );

    Ok(PerformanceProfile {
        disk_read_bytes_per_second,
        disk_write_bytes_per_second,
        cpu_scan_bytes_per_second,
        memory_copy_bytes_per_second,
        archive_bytes_per_second,
        total_memory_bytes,
        available_memory_bytes,
        logical_cores,
        recommended_worker_limit,
        recommended_memory_limit_mb,
        storage_class,
        recommendation_reason,
        measured_at: Utc::now().to_rfc3339(),
    })
}

fn benchmark_disk(storage_root: &Path) -> Result<(u64, u64), String> {
    fs::create_dir_all(storage_root)
        .map_err(|_| "benchmark storage could not be prepared".to_string())?;
    let path = storage_root.join(format!(".aletheia-benchmark-{}.tmp", Uuid::new_v4()));
    let _cleanup = BenchmarkFile(path.clone());
    let mut block = vec![0_u8; 1024 * 1024];
    fill_pattern(&mut block);

    let write_started = Instant::now();
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|_| "benchmark file could not be created".to_string())?;
    let mut written = 0_u64;
    while written < DISK_BENCHMARK_BYTES {
        file.write_all(&block)
            .map_err(|_| "benchmark write failed".to_string())?;
        written = written.saturating_add(block.len() as u64);
    }
    file.sync_all()
        .map_err(|_| "benchmark write could not be flushed".to_string())?;
    let write_rate = bytes_per_second(written, write_started.elapsed());
    drop(file);

    let read_started = Instant::now();
    let mut file = File::open(&path).map_err(|_| "benchmark read could not start".to_string())?;
    let mut read = 0_u64;
    loop {
        let count = file
            .read(&mut block)
            .map_err(|_| "benchmark read failed".to_string())?;
        if count == 0 {
            break;
        }
        read = read.saturating_add(count as u64);
        black_box(&block[..count]);
    }
    let read_rate = bytes_per_second(read, read_started.elapsed());
    Ok((read_rate, write_rate))
}

fn benchmark_cpu_scan() -> Result<u64, String> {
    let line = b"synthetic-user@example.test|portal.example.test|account-1002\n";
    let mut sample = Vec::with_capacity(CPU_SAMPLE_BYTES);
    while sample.len() < CPU_SAMPLE_BYTES {
        sample.extend_from_slice(line);
    }
    sample.truncate(CPU_SAMPLE_BYTES);
    let matcher = AhoCorasick::new(["synthetic-user@example.test", "not-present.test"])
        .map_err(|_| "CPU benchmark matcher could not start".to_string())?;
    let started = Instant::now();
    let mut scanned = 0_u64;
    while started.elapsed() < Duration::from_millis(350) || scanned == 0 {
        let matches = matcher.find_iter(&sample).count();
        black_box(matches);
        scanned = scanned.saturating_add(sample.len() as u64);
    }
    Ok(bytes_per_second(scanned, started.elapsed()))
}

fn benchmark_memory_copy() -> u64 {
    let mut source = vec![0_u8; MEMORY_BENCHMARK_BYTES];
    fill_pattern(&mut source);
    let mut target = vec![0_u8; MEMORY_BENCHMARK_BYTES];
    let started = Instant::now();
    let mut copied = 0_u64;
    for _ in 0..8 {
        target.copy_from_slice(&source);
        black_box(&target);
        copied = copied.saturating_add(source.len() as u64);
    }
    bytes_per_second(copied, started.elapsed())
}

fn benchmark_archive() -> Result<u64, String> {
    let mut source = vec![0_u8; ARCHIVE_SAMPLE_BYTES];
    fill_pattern(&mut source);
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder
        .write_all(&source)
        .map_err(|_| "archive benchmark could not be prepared".to_string())?;
    let compressed = encoder
        .finish()
        .map_err(|_| "archive benchmark could not be prepared".to_string())?;
    let started = Instant::now();
    let mut decoded = 0_u64;
    for _ in 0..8 {
        let mut decoder = GzDecoder::new(compressed.as_slice());
        let count = std::io::copy(&mut decoder, &mut std::io::sink())
            .map_err(|_| "archive benchmark failed".to_string())?;
        decoded = decoded.saturating_add(count);
    }
    Ok(bytes_per_second(decoded, started.elapsed()))
}

fn bytes_per_second(bytes: u64, elapsed: Duration) -> u64 {
    let nanos = elapsed.as_nanos().max(1);
    ((bytes as u128).saturating_mul(1_000_000_000) / nanos).min(u64::MAX as u128) as u64
}

fn fill_pattern(buffer: &mut [u8]) {
    let mut state = 0x9e37_79b9_u32;
    for byte in buffer {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        *byte = (state & 0xff) as u8;
    }
}

fn recommended_workers(io_rate: u64, logical_cores: usize) -> u32 {
    let mib = io_rate / (1024 * 1024);
    let storage_limit = if mib < 110 {
        1
    } else if mib < 300 {
        2
    } else if mib < 700 {
        4
    } else if mib < 1_200 {
        6
    } else {
        8
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

fn recommended_memory(total: u64, available: u64) -> u32 {
    let gib = total / (1024 * 1024 * 1024);
    let total_limit = match gib {
        0..=7 => 512,
        8..=15 => 1024,
        16..=31 => 2048,
        _ => 4096,
    };
    let available_mb = available / (1024 * 1024);
    let available_limit = match available_mb / 4 {
        0..=511 => 256,
        512..=1023 => 512,
        1024..=2047 => 1024,
        2048..=4095 => 2048,
        _ => 4096,
    };
    total_limit.min(available_limit)
}

fn classify_storage(io_rate: u64) -> &'static str {
    match io_rate / (1024 * 1024) {
        0..=109 => "HDD-like",
        110..=449 => "SSD-like",
        _ => "fast SSD/NVMe-like",
    }
}

#[cfg(windows)]
fn physical_memory() -> (u64, u64) {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
    }

    let mut status = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        memory_load: 0,
        total_phys: 0,
        avail_phys: 0,
        total_page_file: 0,
        avail_page_file: 0,
        total_virtual: 0,
        avail_virtual: 0,
        avail_extended_virtual: 0,
    };
    // SAFETY: `status` is initialized with the documented structure size and
    // remains valid and exclusively borrowed for the duration of the call.
    let succeeded = unsafe { GlobalMemoryStatusEx(&mut status) } != 0;
    if succeeded {
        (status.total_phys, status.avail_phys)
    } else {
        (0, 0)
    }
}

#[cfg(not(windows))]
fn physical_memory() -> (u64, u64) {
    (0, 0)
}

#[cfg(test)]
mod tests {
    use super::{classify_storage, recommended_memory, recommended_workers};

    #[test]
    fn recommendations_stay_inside_supported_limits() {
        assert_eq!(recommended_workers(80 * 1024 * 1024, 16), 1);
        assert_eq!(recommended_workers(400 * 1024 * 1024, 8), 4);
        assert_eq!(recommended_workers(2_000 * 1024 * 1024, 4), 4);
        assert_eq!(
            recommended_memory(8 * 1024_u64.pow(3), 4 * 1024_u64.pow(3)),
            1024
        );
        assert_eq!(
            recommended_memory(64 * 1024_u64.pow(3), 2 * 1024_u64.pow(3)),
            512
        );
    }

    #[test]
    fn storage_classification_is_honest_about_hdd_rates() {
        assert_eq!(classify_storage(90 * 1024 * 1024), "HDD-like");
        assert_eq!(classify_storage(250 * 1024 * 1024), "SSD-like");
        assert_eq!(classify_storage(900 * 1024 * 1024), "fast SSD/NVMe-like");
    }
}
