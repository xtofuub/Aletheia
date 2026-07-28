use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    time::SystemTime,
};

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use chrono::{DateTime, Utc};
use flate2::read::GzDecoder;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use walkdir::WalkDir;

use crate::models::{
    FieldMapping, FieldType, FileInspection, InspectionResult, PreviewRow, SourceFormat,
};

const SAMPLE_BYTES: u64 = 256 * 1024;
const PREVIEW_ROWS: usize = 20;
const DISCOVERY_LIMIT: usize = 10_000;
const MAX_DISCOVERY_DEPTH: usize = 32;

static EMAIL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$")
        .expect("email regex")
});
static IPV4: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?:\d{1,3}\.){3}\d{1,3}$").expect("ipv4 regex"));
static PHONE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\+?[0-9][0-9 ()-]{5,}$").expect("phone regex"));
static DOMAIN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$")
        .expect("domain regex")
});
static HEX_HASH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^[a-f0-9]{32,128}$").expect("hash regex"));
static ISO_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]+)?$").expect("date regex"));

pub fn inspect_paths(paths: &[PathBuf]) -> Result<InspectionResult, String> {
    let mut discovered = Vec::new();
    let mut rejected_paths = Vec::new();

    for input in paths {
        let canonical = match fs::canonicalize(input) {
            Ok(path) => path,
            Err(_) => {
                rejected_paths.push(input.to_string_lossy().into_owned());
                continue;
            }
        };
        let metadata = match fs::metadata(&canonical) {
            Ok(metadata) => metadata,
            Err(_) => {
                rejected_paths.push(input.to_string_lossy().into_owned());
                continue;
            }
        };

        if metadata.is_file() {
            if is_supported(&canonical) {
                discovered.push((canonical.clone(), canonical));
            } else {
                rejected_paths.push(canonical.to_string_lossy().into_owned());
            }
            continue;
        }
        if !metadata.is_dir() {
            rejected_paths.push(canonical.to_string_lossy().into_owned());
            continue;
        }

        for entry in WalkDir::new(&canonical)
            .follow_links(false)
            .max_depth(MAX_DISCOVERY_DEPTH)
            .into_iter()
            .filter_map(Result::ok)
            .take(DISCOVERY_LIMIT)
        {
            if entry.file_type().is_file() && is_supported(entry.path()) {
                discovered.push((canonical.clone(), entry.into_path()));
            }
        }
    }

    discovered.sort_by(|left, right| left.1.cmp(&right.1));
    discovered.dedup_by(|left, right| left.1 == right.1);

    let mut files = Vec::with_capacity(discovered.len());
    let mut total_bytes = 0;
    for (root, path) in discovered {
        match inspect_file(&root, &path) {
            Ok(inspection) => {
                total_bytes += inspection.file_size;
                files.push(inspection);
            }
            Err(_) => rejected_paths.push(path.to_string_lossy().into_owned()),
        }
    }

    Ok(InspectionResult {
        files,
        rejected_paths,
        total_bytes,
    })
}

#[tauri::command]
pub async fn inspect_sources(paths: Vec<String>) -> Result<InspectionResult, String> {
    if paths.is_empty() {
        return Err("select at least one local source".to_string());
    }
    let source_paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || inspect_paths(&source_paths))
        .await
        .map_err(|_| "source inspection task failed".to_string())?
}

fn inspect_file(root: &Path, path: &Path) -> Result<FileInspection, String> {
    let metadata = fs::metadata(path).map_err(sanitize)?;
    let compressed = has_gzip_magic(path).unwrap_or(false);
    let mut warnings = Vec::new();
    let sample = read_sample(path, compressed).map_err(sanitize)?;
    let (text, encoding, encoding_warning) = decode_sample(&sample);
    if let Some(warning) = encoding_warning {
        warnings.push(warning);
    }
    let line_ending = detect_line_ending(&text);
    let delimiter = detect_delimiter(&text);
    let format = detect_format(path, &text, delimiter, compressed);
    let rows = parse_sample_rows(&text, format, delimiter);
    let (has_header, source_names, data_rows) = prepare_rows(&rows, format);
    let column_count = source_names.len().max(1);
    let row_consistency = calculate_consistency(&data_rows, column_count);
    if row_consistency < 0.8 {
        warnings.push("Inconsistent field counts detected in the sample.".to_string());
    }
    if matches!(format, SourceFormat::Text) && text.lines().any(|line| line.contains('|')) {
        warnings.push(
            "Pipe characters are inconsistent and were treated as text, not a delimiter."
                .to_string(),
        );
    }
    let mappings = infer_mappings(&source_names, &data_rows);
    let preview = build_preview(&data_rows, &mappings);
    let estimated_records = estimate_records(metadata.len(), &sample, &text);

    Ok(FileInspection {
        absolute_path: path.to_string_lossy().into_owned(),
        relative_path: path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned(),
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed source".to_string()),
        file_size: metadata.len(),
        modified_at: metadata.modified().ok().map(system_time_iso),
        format,
        compressed,
        encoding,
        line_ending,
        delimiter: delimiter.map(delimiter_name),
        has_header,
        estimated_records,
        column_count,
        row_consistency,
        mappings,
        preview,
        warnings,
        eligible: true,
    })
}

fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "txt" | "csv" | "tsv" | "jsonl" | "ndjson" | "log" | "gz"
            )
        })
        .unwrap_or(false)
}

fn has_gzip_magic(path: &Path) -> Result<bool, std::io::Error> {
    let mut file = File::open(path)?;
    let mut magic = [0_u8; 2];
    Ok(file.read(&mut magic)? == 2 && magic == [0x1f, 0x8b])
}

fn read_sample(path: &Path, compressed: bool) -> Result<Vec<u8>, std::io::Error> {
    let file = File::open(path)?;
    let mut sample = Vec::with_capacity(SAMPLE_BYTES as usize);
    if compressed {
        let mut decoder = GzDecoder::new(file).take(SAMPLE_BYTES);
        decoder.read_to_end(&mut sample)?;
    } else {
        let mut reader = file.take(SAMPLE_BYTES);
        reader.read_to_end(&mut sample)?;
    }
    Ok(sample)
}

fn decode_sample(sample: &[u8]) -> (String, String, Option<String>) {
    if sample.starts_with(&[0xef, 0xbb, 0xbf]) {
        return (
            String::from_utf8_lossy(&sample[3..]).into_owned(),
            "UTF-8 with BOM".to_string(),
            None,
        );
    }
    if sample.starts_with(&[0xff, 0xfe]) {
        let (text, _, had_errors) = encoding_rs::UTF_16LE.decode(&sample[2..]);
        return (
            text.into_owned(),
            "UTF-16 LE".to_string(),
            had_errors.then(|| "Malformed encoded bytes were replaced in preview.".to_string()),
        );
    }
    if sample.starts_with(&[0xfe, 0xff]) {
        let (text, _, had_errors) = encoding_rs::UTF_16BE.decode(&sample[2..]);
        return (
            text.into_owned(),
            "UTF-16 BE".to_string(),
            had_errors.then(|| "Malformed encoded bytes were replaced in preview.".to_string()),
        );
    }
    if let Ok(text) = std::str::from_utf8(sample) {
        return (text.to_string(), "UTF-8".to_string(), None);
    }

    let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
    detector.feed(sample, true);
    let guessed = detector.guess(None, Utf8Detection::Allow);
    let (text, _, had_errors) = guessed.decode(sample);
    (
        text.into_owned(),
        guessed.name().to_string(),
        Some(if had_errors {
            "Encoding was inferred and malformed bytes were replaced in preview.".to_string()
        } else {
            "Encoding was inferred from a bounded sample.".to_string()
        }),
    )
}

fn detect_line_ending(text: &str) -> String {
    let crlf = text.match_indices("\r\n").count();
    let without_crlf = text.replace("\r\n", "");
    let lf = without_crlf.matches('\n').count();
    let cr = without_crlf.matches('\r').count();
    if crlf >= lf && crlf >= cr && crlf > 0 {
        "CRLF".to_string()
    } else if lf >= cr && lf > 0 {
        "LF".to_string()
    } else if cr > 0 {
        "CR".to_string()
    } else {
        "Unknown".to_string()
    }
}

fn detect_delimiter(text: &str) -> Option<u8> {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .take(80)
        .collect();
    if lines.len() < 3 {
        return None;
    }

    b"\t,;|"
        .iter()
        .copied()
        .filter_map(|delimiter| {
            let mut modes = HashMap::<usize, usize>::new();
            for line in &lines {
                let count = line
                    .as_bytes()
                    .iter()
                    .filter(|byte| **byte == delimiter)
                    .count();
                if count > 0 {
                    *modes.entry(count).or_default() += 1;
                }
            }
            let (mode, matching) = modes.into_iter().max_by_key(|(_, count)| *count)?;
            let ratio = matching as f32 / lines.len() as f32;
            (mode > 0 && matching >= 3 && ratio >= 0.8)
                .then_some((delimiter, ratio, mode, matching))
        })
        .max_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.3.cmp(&right.3))
                .then_with(|| left.2.cmp(&right.2))
        })
        .map(|candidate| candidate.0)
}

fn detect_format(
    path: &Path,
    text: &str,
    delimiter: Option<u8>,
    _compressed: bool,
) -> SourceFormat {
    let json_lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(5)
        .collect();
    if json_lines.len() >= 2
        && json_lines
            .iter()
            .all(|line| serde_json::from_str::<serde_json::Map<String, Value>>(line).is_ok())
    {
        return SourceFormat::Jsonl;
    }
    match delimiter {
        Some(b',') => SourceFormat::Csv,
        Some(b'\t') => SourceFormat::Tsv,
        Some(_) => SourceFormat::Delimited,
        None => path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .filter(|extension| extension == "jsonl" || extension == "ndjson")
            .map(|_| SourceFormat::Jsonl)
            .unwrap_or(SourceFormat::Text),
    }
}

fn parse_sample_rows(text: &str, format: SourceFormat, delimiter: Option<u8>) -> Vec<Vec<String>> {
    match format {
        SourceFormat::Jsonl => text
            .lines()
            .filter_map(|line| {
                let object = serde_json::from_str::<serde_json::Map<String, Value>>(line).ok()?;
                Some(
                    object
                        .into_iter()
                        .map(|(key, value)| format!("{key}\u{1f}{}", scalar_json(value)))
                        .collect(),
                )
            })
            .take(PREVIEW_ROWS + 1)
            .collect(),
        SourceFormat::Csv | SourceFormat::Tsv | SourceFormat::Delimited => {
            let selected = delimiter.unwrap_or(match format {
                SourceFormat::Tsv => b'\t',
                _ => b',',
            });
            csv::ReaderBuilder::new()
                .has_headers(false)
                .flexible(true)
                .delimiter(selected)
                .from_reader(text.as_bytes())
                .records()
                .filter_map(Result::ok)
                .map(|record| record.iter().map(ToString::to_string).collect())
                .take(PREVIEW_ROWS + 1)
                .collect()
        }
        SourceFormat::Text | SourceFormat::Gzip => text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| vec![line.to_string()])
            .take(PREVIEW_ROWS)
            .collect(),
    }
}

fn scalar_json(value: Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value,
        nested => nested.to_string(),
    }
}

fn prepare_rows(
    rows: &[Vec<String>],
    format: SourceFormat,
) -> (bool, Vec<String>, Vec<Vec<String>>) {
    if rows.is_empty() {
        return (false, vec!["value".to_string()], Vec::new());
    }
    if format == SourceFormat::Jsonl {
        let mut names = Vec::new();
        for encoded in &rows[0] {
            let (name, _) = encoded.split_once('\u{1f}').unwrap_or(("value", encoded));
            names.push(name.to_string());
        }
        let data = rows
            .iter()
            .map(|row| {
                let lookup: HashMap<&str, &str> = row
                    .iter()
                    .filter_map(|encoded| encoded.split_once('\u{1f}'))
                    .collect();
                names
                    .iter()
                    .map(|name| lookup.get(name.as_str()).copied().unwrap_or("").to_string())
                    .collect()
            })
            .collect();
        return (false, names, data);
    }

    let first = &rows[0];
    let has_header = matches!(
        format,
        SourceFormat::Csv | SourceFormat::Tsv | SourceFormat::Delimited
    ) && looks_like_header(first, rows.get(1));
    let names = if has_header {
        first
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    format!("column_{}", index + 1)
                } else {
                    trimmed.to_string()
                }
            })
            .collect()
    } else if first.len() == 1 {
        vec!["value".to_string()]
    } else {
        (0..first.len())
            .map(|index| format!("column_{}", index + 1))
            .collect()
    };
    let data = if has_header {
        rows.iter().skip(1).cloned().collect()
    } else {
        rows.to_vec()
    };
    (has_header, names, data)
}

fn looks_like_header(first: &[String], second: Option<&Vec<String>>) -> bool {
    let Some(second) = second else {
        return false;
    };
    if first.len() != second.len() || first.is_empty() {
        return false;
    }
    let headerish = first
        .iter()
        .filter(|value| {
            let trimmed = value.trim();
            !trimmed.is_empty()
                && trimmed.len() <= 64
                && trimmed
                    .chars()
                    .all(|character| character.is_alphanumeric() || "_ -".contains(character))
        })
        .count();
    let first_typed = first
        .iter()
        .filter(|value| infer_value_type(value) != FieldType::Unknown)
        .count();
    let second_typed = second
        .iter()
        .filter(|value| infer_value_type(value) != FieldType::Unknown)
        .count();
    headerish == first.len() && first_typed == 0 && second_typed > 0
}

fn calculate_consistency(rows: &[Vec<String>], column_count: usize) -> f32 {
    if rows.is_empty() {
        return 1.0;
    }
    rows.iter().filter(|row| row.len() == column_count).count() as f32 / rows.len() as f32
}

fn infer_mappings(names: &[String], rows: &[Vec<String>]) -> Vec<FieldMapping> {
    names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let header_type = infer_header_type(name);
            let values: Vec<&str> = rows
                .iter()
                .filter_map(|row| row.get(index))
                .map(String::as_str)
                .filter(|value| !value.trim().is_empty())
                .collect();
            let (value_type, ratio) = dominant_value_type(&values);
            let (field_type, confidence) = if header_type != FieldType::Unknown {
                (header_type, 0.98)
            } else if ratio >= 0.75 {
                (value_type, ratio)
            } else {
                (FieldType::Unknown, ratio.min(0.49))
            };
            FieldMapping {
                source_name: name.clone(),
                field_type,
                confidence,
                is_sensitive: field_type.is_sensitive(),
            }
        })
        .collect()
}

fn infer_header_type(name: &str) -> FieldType {
    let normalized = name.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    match normalized.as_str() {
        "email" | "email_address" | "mail" => FieldType::Email,
        "username" | "user_name" | "login" => FieldType::Username,
        "first_name" | "firstname" => FieldType::FirstName,
        "last_name" | "lastname" | "surname" => FieldType::LastName,
        "name" | "full_name" | "display_name" => FieldType::FullName,
        "phone" | "telephone" | "mobile" | "phone_number" => FieldType::Phone,
        "ip" | "ip_address" => FieldType::IpAddress,
        "domain" | "hostname" | "host" => FieldType::Domain,
        "url" | "uri" | "website" => FieldType::Url,
        "password" | "pass" | "passwd" => FieldType::Password,
        "password_hash" | "pass_hash" | "hash" => FieldType::PasswordHash,
        "salt" => FieldType::Salt,
        "dob" | "date_of_birth" | "birth_date" => FieldType::DateOfBirth,
        "address" | "street_address" => FieldType::Address,
        "city" => FieldType::City,
        "country" => FieldType::Country,
        "postal_code" | "postcode" | "zip" => FieldType::PostalCode,
        "company" | "organization" | "organisation" => FieldType::Company,
        "job_title" | "title" => FieldType::JobTitle,
        "user_id" | "account_id" | "uid" | "id" => FieldType::UserId,
        "timestamp" | "record_date" | "created_at" | "breach_date" => FieldType::Timestamp,
        _ => FieldType::Unknown,
    }
}

fn dominant_value_type(values: &[&str]) -> (FieldType, f32) {
    if values.is_empty() {
        return (FieldType::Unknown, 0.0);
    }
    let mut counts = HashMap::<FieldType, usize>::new();
    for value in values {
        *counts.entry(infer_value_type(value)).or_default() += 1;
    }
    let (field_type, count) = counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .unwrap_or((FieldType::Unknown, 0));
    (field_type, count as f32 / values.len() as f32)
}

fn infer_value_type(value: &str) -> FieldType {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return FieldType::Unknown;
    }
    if EMAIL.is_match(trimmed) {
        FieldType::Email
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        FieldType::Url
    } else if IPV4.is_match(trimmed) && valid_ipv4(trimmed) {
        FieldType::IpAddress
    } else if PHONE.is_match(trimmed) {
        FieldType::Phone
    } else if DOMAIN.is_match(trimmed) {
        FieldType::Domain
    } else if HEX_HASH.is_match(trimmed) {
        FieldType::PasswordHash
    } else if ISO_DATE.is_match(trimmed) {
        FieldType::Timestamp
    } else {
        FieldType::Unknown
    }
}

fn valid_ipv4(value: &str) -> bool {
    value
        .split('.')
        .all(|part| part.parse::<u8>().map(|_| true).unwrap_or(false))
}

fn build_preview(rows: &[Vec<String>], mappings: &[FieldMapping]) -> Vec<PreviewRow> {
    rows.iter()
        .take(PREVIEW_ROWS)
        .enumerate()
        .map(|(index, row)| PreviewRow {
            source_location: (index + 1) as u64,
            values: mappings
                .iter()
                .enumerate()
                .map(|(column, mapping)| {
                    mask_value(
                        row.get(column).map(String::as_str).unwrap_or(""),
                        mapping.field_type,
                    )
                })
                .collect(),
        })
        .collect()
}

pub fn mask_value(value: &str, field_type: FieldType) -> String {
    if value.is_empty() {
        return String::new();
    }
    match field_type {
        FieldType::Email => {
            let (local, domain) = value.split_once('@').unwrap_or(("", value));
            let first = local.chars().next().unwrap_or('•');
            format!("{first}•••@{domain}")
        }
        FieldType::Phone => {
            let suffix: String = value
                .chars()
                .rev()
                .take(2)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            format!("••••••{suffix}")
        }
        FieldType::Password | FieldType::PasswordHash | FieldType::Salt => {
            "••••••••••••".to_string()
        }
        FieldType::Url => mask_url(value),
        FieldType::Username | FieldType::FullName | FieldType::FirstName | FieldType::LastName => {
            let prefix: String = value.chars().take(2).collect();
            format!("{prefix}•••")
        }
        FieldType::Unknown => "••••••••".to_string(),
        _ => value.to_string(),
    }
}

fn mask_url(value: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(value) else {
        return "••••••••".to_string();
    };
    if parsed.query().is_some() {
        let keys: Vec<String> = parsed
            .query_pairs()
            .map(|(key, _)| key.into_owned())
            .collect();
        parsed.set_query(None);
        let query = keys
            .into_iter()
            .map(|key| format!("{key}=•••"))
            .collect::<Vec<_>>()
            .join("&");
        parsed.set_query(Some(&query));
    }
    parsed.to_string()
}

fn estimate_records(file_size: u64, sample: &[u8], text: &str) -> Option<u64> {
    let lines = text.lines().filter(|line| !line.is_empty()).count() as u64;
    if lines == 0 || sample.is_empty() {
        return None;
    }
    Some(((file_size as f64 / sample.len() as f64) * lines as f64).round() as u64)
}

fn delimiter_name(delimiter: u8) -> String {
    match delimiter {
        b'\t' => "tab",
        b',' => "comma",
        b';' => "semicolon",
        b'|' => "pipe",
        _ => "custom",
    }
    .to_string()
}

fn system_time_iso(value: SystemTime) -> String {
    DateTime::<Utc>::from(value).to_rfc3339()
}

fn sanitize(error: impl std::fmt::Display) -> String {
    let _ = error;
    "source inspection failed".to_string()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{detect_delimiter, inspect_paths, mask_value};
    use crate::models::{FieldType, SourceFormat};

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    #[test]
    fn detects_csv_header_mapping_and_masks_secrets() {
        let result = inspect_paths(&[fixture("records_valid.csv")]).expect("inspection");
        let file = result.files.first().expect("file");
        assert_eq!(file.format, SourceFormat::Csv);
        assert!(file.has_header);
        assert_eq!(file.column_count, 9);
        assert_eq!(file.mappings[0].field_type, FieldType::Email);
        assert_eq!(file.mappings[5].field_type, FieldType::Password);
        assert!(!file.preview[0].values[0].contains("ava.research"));
        assert!(!file.preview[0].values[5].contains("Synthetic"));
    }

    #[test]
    fn does_not_treat_inconsistent_pipe_preamble_as_delimited() {
        let text = "| synthetic notice |\r\n| another | notice | block |\r\nemail@example.com\r\nopaque\r\nemail2@example.net\r\n";
        assert_eq!(detect_delimiter(text), None);
        let result = inspect_paths(&[fixture("synthetic_848_shape.txt")]).expect("inspection");
        assert_eq!(result.files[0].format, SourceFormat::Text);
        assert_eq!(result.files[0].column_count, 1);
    }

    #[test]
    fn masks_email_phone_and_unknown_values() {
        assert_eq!(
            mask_value("ava@example.com", FieldType::Email),
            "a•••@example.com"
        );
        assert_eq!(mask_value("+12025550142", FieldType::Phone), "••••••42");
        assert_eq!(mask_value("opaque", FieldType::Unknown), "••••••••");
    }
}
