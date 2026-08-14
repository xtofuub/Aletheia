use std::{collections::HashSet, fs, path::Path, sync::Mutex};

use once_cell::sync::Lazy;
use rusqlite::Connection;
use tantivy::{
    DocAddress, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
    collector::{Count, TopDocs},
    query::{BooleanQuery, EnableScoring, Occur, Query, RegexQuery, TermQuery},
    schema::{Field, IndexRecordOption, STORED, STRING, Schema, TEXT, Value},
};

use crate::models::SearchMode;

pub const INDEX_DIRECTORY: &str = "search-index";
const WRITER_MEMORY_BYTES: usize = 30_000_000;
const DATABASE_FILE: &str = "metadata.sqlite3";
static INDEX_OPEN_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Clone, Copy)]
pub struct IndexFields {
    pub record_id: Field,
    pub dataset_id: Field,
    pub exact_values: Field,
    pub search_grams: Field,
    pub search_values: Field,
}

pub struct SearchIndex {
    pub index: Index,
    pub fields: IndexFields,
    reader: IndexReader,
}

impl SearchIndex {
    pub fn open_or_create(storage_root: &Path) -> Result<Self, String> {
        let _guard = INDEX_OPEN_LOCK
            .lock()
            .map_err(|_| "search index lock is unavailable".to_string())?;
        let path = storage_root.join(INDEX_DIRECTORY);
        fs::create_dir_all(&path).map_err(sanitized)?;
        if path.join("meta.json").exists() && !has_current_schema(&path)? {
            rebuild_legacy_index(storage_root, &path)?;
        }
        let index = if path.join("meta.json").exists() {
            Index::open_in_dir(&path).map_err(sanitized)?
        } else {
            Index::create_in_dir(&path, schema()).map_err(sanitized)?
        };
        let fields = fields(&index.schema())?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(sanitized)?;
        Ok(Self {
            index,
            fields,
            reader,
        })
    }

    pub fn writer(&self) -> Result<IndexWriter, String> {
        self.index.writer(WRITER_MEMORY_BYTES).map_err(sanitized)
    }

    pub fn writer_with_limits(
        &self,
        worker_limit: usize,
        memory_bytes: usize,
    ) -> Result<IndexWriter, String> {
        let memory_bytes = memory_bytes.clamp(64 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
        let workers_allowed_by_memory = (memory_bytes / 15_000_000).max(1);
        let workers = worker_limit.clamp(1, 8).min(workers_allowed_by_memory);
        self.index
            .writer_with_num_threads(workers, memory_bytes)
            .map_err(sanitized)
    }

    pub fn document_count(&self) -> Result<u64, String> {
        self.reader.reload().map_err(sanitized)?;
        Ok(self.reader.searcher().num_docs())
    }

    pub fn reload(&self) -> Result<(), String> {
        self.reader.reload().map_err(sanitized)
    }

    pub fn delete_dataset(&self, dataset_id: &str) -> Result<(), String> {
        let mut writer = self.writer()?;
        writer.delete_term(Term::from_field_text(self.fields.dataset_id, dataset_id));
        writer.commit().map_err(sanitized)?;
        writer.wait_merging_threads().map_err(sanitized)?;
        self.reader.reload().map_err(sanitized)
    }

    pub fn search_record_ids(
        &self,
        query_text: &str,
        mode: SearchMode,
        dataset_id: Option<&str>,
        field_type: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<(usize, Vec<String>), String> {
        let query_text = query_text.trim().to_lowercase();
        if query_text.is_empty() {
            return Ok((0, Vec::new()));
        }
        if query_text.len() > 512 {
            return Err("search query exceeds the 512 character limit".to_string());
        }

        let (structured_type, value) = split_structured_query(&query_text);
        let value = value.trim_matches('"');
        let requested_type = field_type.or(structured_type);
        let term_value = requested_type
            .map(|kind| format!("{kind}:{value}"))
            .unwrap_or_else(|| value.to_string());

        let searcher = self.reader.searcher();

        if matches!(mode, SearchMode::Contains) && is_complete_identifier(requested_type, value) {
            let exact_query = with_dataset_filter(
                Box::new(TermQuery::new(
                    Term::from_field_text(self.fields.exact_values, &term_value),
                    IndexRecordOption::Basic,
                )),
                dataset_id,
                self.fields.dataset_id,
            );
            let exact = collect_record_ids(
                &searcher,
                &exact_query,
                self.fields.record_id,
                offset,
                limit,
            )?;
            if exact.0 > 0 {
                return Ok(exact);
            }
        }

        if matches!(mode, SearchMode::Contains) {
            if value.chars().count() < 2 {
                return Err("contains searches require at least two characters".to_string());
            }
            let flexible_tokens = requested_type
                .is_none()
                .then(|| flexible_name_tokens(value))
                .flatten();
            let gram_values = flexible_tokens
                .as_ref()
                .cloned()
                .unwrap_or_else(|| vec![value.to_string()]);
            let gram_query = with_dataset_filter(
                ngram_query(&gram_values, self.fields.search_grams)?,
                dataset_id,
                self.fields.dataset_id,
            );
            return collect_verified_contains(
                &searcher,
                &gram_query,
                self.fields,
                requested_type,
                value,
                flexible_tokens.as_deref(),
                offset,
                limit,
            );
        }

        let value_query: Box<dyn Query> = match mode {
            SearchMode::Exact => Box::new(TermQuery::new(
                Term::from_field_text(self.fields.exact_values, &term_value),
                IndexRecordOption::Basic,
            )),
            SearchMode::Contains => unreachable!("contains queries use the n-gram path"),
            SearchMode::Prefix => Box::new(
                RegexQuery::from_pattern(
                    &format!("{}.*", escape_tantivy_regex(&term_value)),
                    self.fields.exact_values,
                )
                .map_err(sanitized)?,
            ),
        };

        let query = with_dataset_filter(value_query, dataset_id, self.fields.dataset_id);
        collect_record_ids(&searcher, &query, self.fields.record_id, offset, limit)
    }
}

fn with_dataset_filter(
    value_query: Box<dyn Query>,
    dataset_id: Option<&str>,
    dataset_field: Field,
) -> Box<dyn Query> {
    match dataset_id {
        Some(dataset_id) => Box::new(BooleanQuery::new(vec![
            (Occur::Must, value_query),
            (
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(dataset_field, dataset_id),
                    IndexRecordOption::Basic,
                )),
            ),
        ])),
        None => value_query,
    }
}

fn collect_record_ids(
    searcher: &tantivy::Searcher,
    query: &dyn Query,
    record_id_field: Field,
    offset: usize,
    limit: usize,
) -> Result<(usize, Vec<String>), String> {
    let collectors = (
        Count,
        TopDocs::with_limit(limit.clamp(1, 200))
            .and_offset(offset)
            .order_by_score(),
    );
    let (total, top_docs) = searcher.search(query, &collectors).map_err(sanitized)?;
    let mut record_ids = Vec::with_capacity(top_docs.len());
    for (_, address) in top_docs {
        let document = searcher
            .doc::<TantivyDocument>(address)
            .map_err(sanitized)?;
        if let Some(record_id) = document
            .get_first(record_id_field)
            .and_then(|value| value.as_str())
        {
            record_ids.push(record_id.to_string());
        }
    }
    Ok((total, record_ids))
}

fn ngram_query(values: &[String], field: Field) -> Result<Box<dyn Query>, String> {
    let mut seen = HashSet::new();
    let mut clauses = Vec::new();
    for value in values {
        for gram in query_grams(value) {
            if seen.insert(gram.clone()) {
                clauses.push((
                    Occur::Must,
                    Box::new(TermQuery::new(
                        Term::from_field_text(field, &gram),
                        IndexRecordOption::Basic,
                    )) as Box<dyn Query>,
                ));
            }
        }
    }
    if clauses.is_empty() {
        return Err("contains search could not create an indexed query".to_string());
    }
    Ok(Box::new(BooleanQuery::new(clauses)))
}

#[allow(clippy::too_many_arguments)]
fn collect_verified_contains(
    searcher: &tantivy::Searcher,
    query: &dyn Query,
    fields: IndexFields,
    requested_type: Option<&str>,
    value: &str,
    flexible_tokens: Option<&[String]>,
    offset: usize,
    limit: usize,
) -> Result<(usize, Vec<String>), String> {
    let weight = query
        .weight(EnableScoring::disabled_from_searcher(searcher))
        .map_err(sanitized)?;
    let bounded_limit = limit.clamp(1, 200);
    let mut total = 0_usize;
    let mut record_ids = Vec::with_capacity(bounded_limit);
    let mut first_error = None;
    for (segment_ord, segment_reader) in searcher.segment_readers().iter().enumerate() {
        weight
            .for_each(segment_reader, &mut |doc_id, _score| {
                if first_error.is_some() {
                    return;
                }
                let document = match searcher
                    .doc::<TantivyDocument>(DocAddress::new(segment_ord as u32, doc_id))
                {
                    Ok(document) => document,
                    Err(error) => {
                        first_error = Some(error);
                        return;
                    }
                };
                if !document_matches_contains(
                    &document,
                    fields.search_values,
                    requested_type,
                    value,
                    flexible_tokens,
                ) {
                    return;
                }
                if total >= offset
                    && record_ids.len() < bounded_limit
                    && let Some(record_id) = document
                        .get_first(fields.record_id)
                        .and_then(|stored| stored.as_str())
                {
                    record_ids.push(record_id.to_string());
                }
                total = total.saturating_add(1);
            })
            .map_err(sanitized)?;
    }
    if let Some(error) = first_error {
        return Err(sanitized(error));
    }
    Ok((total, record_ids))
}

fn document_matches_contains(
    document: &TantivyDocument,
    search_values: Field,
    requested_type: Option<&str>,
    value: &str,
    flexible_tokens: Option<&[String]>,
) -> bool {
    let field_prefix = requested_type.map(|kind| format!("{kind}:"));
    let contains = |needle: &str| {
        document
            .get_all(search_values)
            .filter_map(|stored| stored.as_str())
            .filter_map(|stored| {
                field_prefix
                    .as_deref()
                    .map_or(Some(stored), |prefix| stored.strip_prefix(prefix))
            })
            .any(|stored| stored.contains(needle))
    };
    if let Some(tokens) = flexible_tokens {
        return tokens.iter().all(|token| contains(token));
    }
    contains(value)
}

fn query_grams(value: &str) -> Vec<String> {
    let characters = value.chars().collect::<Vec<_>>();
    let width = if characters.len() >= 3 { 3 } else { 2 };
    characters
        .windows(width)
        .map(|window| format!("{width}:{}", window.iter().collect::<String>()))
        .collect()
}

fn indexed_grams(value: &str) -> Vec<String> {
    let characters = value.chars().collect::<Vec<_>>();
    let mut grams = Vec::new();
    for width in 2..=3 {
        grams.extend(
            characters
                .windows(width)
                .map(|window| format!("{width}:{}", window.iter().collect::<String>())),
        );
    }
    grams
}

fn is_complete_identifier(requested_type: Option<&str>, value: &str) -> bool {
    matches!(
        requested_type,
        Some("email" | "domain" | "url" | "phone" | "ip_address")
    ) || value.contains('@')
        || value.contains('.')
        || value.contains("://")
        || (value.starts_with('+') && value.chars().filter(char::is_ascii_digit).count() >= 7)
        || value.parse::<std::net::IpAddr>().is_ok()
}

fn flexible_name_tokens(value: &str) -> Option<Vec<String>> {
    let mut tokens = value
        .split_whitespace()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_lowercase)
        .collect::<Vec<_>>();
    tokens.dedup();
    if !(2..=4).contains(&tokens.len())
        || tokens
            .iter()
            .any(|token| token.chars().count() < 2 || !token.chars().all(char::is_alphabetic))
    {
        return None;
    }
    Some(tokens)
}

pub fn make_document(
    fields: IndexFields,
    record_id: &str,
    dataset_id: &str,
    exact_values: &[String],
) -> TantivyDocument {
    let mut document = TantivyDocument::default();
    document.add_text(fields.record_id, record_id);
    document.add_text(fields.dataset_id, dataset_id);
    let mut grams = HashSet::new();
    for value in exact_values {
        document.add_text(fields.exact_values, value);
        document.add_text(fields.search_values, value);
        for gram in indexed_grams(value) {
            grams.insert(gram);
        }
    }
    for gram in grams {
        document.add_text(fields.search_grams, gram);
    }
    document
}

fn schema() -> Schema {
    let mut builder = Schema::builder();
    builder.add_text_field("record_id", STRING | STORED);
    builder.add_text_field("dataset_id", STRING);
    builder.add_text_field("source_file_id", STRING);
    builder.add_text_field("source_location", STORED);
    builder.add_text_field("exact_values", STRING);
    builder.add_text_field("search_grams", STRING);
    builder.add_text_field("search_values", STORED);
    builder.add_text_field("search_text", TEXT);
    builder.build()
}

fn fields(schema: &Schema) -> Result<IndexFields, String> {
    Ok(IndexFields {
        record_id: schema.get_field("record_id").map_err(sanitized)?,
        dataset_id: schema.get_field("dataset_id").map_err(sanitized)?,
        exact_values: schema.get_field("exact_values").map_err(sanitized)?,
        search_grams: schema.get_field("search_grams").map_err(sanitized)?,
        search_values: schema.get_field("search_values").map_err(sanitized)?,
    })
}

fn has_current_schema(path: &Path) -> Result<bool, String> {
    let index = Index::open_in_dir(path).map_err(sanitized)?;
    let schema = index.schema();
    Ok(schema.get_field("search_grams").is_ok() && schema.get_field("search_values").is_ok())
}

fn rebuild_legacy_index(storage_root: &Path, index_path: &Path) -> Result<(), String> {
    let database_path = storage_root.join(DATABASE_FILE);
    if !database_path.exists() {
        return Err("the search index requires a workspace rebuild".to_string());
    }
    let temporary_path = storage_root.join("search-index-v2-building");
    let backup_path = storage_root.join("search-index-v1-backup");
    remove_generated_index_dir(&temporary_path)?;
    remove_generated_index_dir(&backup_path)?;
    fs::create_dir_all(&temporary_path).map_err(sanitized)?;

    let rebuild = (|| -> Result<(), String> {
        let index = Index::create_in_dir(&temporary_path, schema()).map_err(sanitized)?;
        let index_fields = fields(&index.schema())?;
        let mut writer = index.writer(WRITER_MEMORY_BYTES).map_err(sanitized)?;
        let connection = Connection::open(&database_path).map_err(sanitized)?;
        let mut statement = connection
            .prepare(
                "SELECT record_id, dataset_id, value
                 FROM (
                   SELECT r.id AS record_id, r.dataset_id AS dataset_id,
                          fv.normalized_value AS value
                   FROM records r
                   JOIN field_values fv ON fv.record_id = r.id
                   WHERE fv.is_sensitive = 0 AND fv.normalized_value <> ''
                   UNION ALL
                   SELECT r.id, r.dataset_id,
                          fv.field_type || ':' || fv.normalized_value
                   FROM records r
                   JOIN field_values fv ON fv.record_id = r.id
                   WHERE fv.is_sensitive = 0 AND fv.normalized_value <> ''
                   UNION ALL
                   SELECT r.id, r.dataset_id, rd.hostname
                   FROM records r JOIN record_domains rd ON rd.record_id = r.id
                   UNION ALL
                   SELECT r.id, r.dataset_id, 'domain:' || rd.hostname
                   FROM records r JOIN record_domains rd ON rd.record_id = r.id
                   UNION ALL
                   SELECT r.id, r.dataset_id, rdp.registrable_domain
                   FROM records r JOIN record_domain_parents rdp ON rdp.record_id = r.id
                   UNION ALL
                   SELECT r.id, r.dataset_id, 'domain:' || rdp.registrable_domain
                   FROM records r JOIN record_domain_parents rdp ON rdp.record_id = r.id
                 )
                 ORDER BY record_id, value",
            )
            .map_err(sanitized)?;
        let mut rows = statement.query([]).map_err(sanitized)?;
        let mut current_record = String::new();
        let mut current_dataset = String::new();
        let mut values = Vec::new();
        while let Some(row) = rows.next().map_err(sanitized)? {
            let record_id = row.get::<_, String>(0).map_err(sanitized)?;
            let dataset_id = row.get::<_, String>(1).map_err(sanitized)?;
            let value = row.get::<_, String>(2).map_err(sanitized)?;
            if !current_record.is_empty() && record_id != current_record {
                values.sort_unstable();
                values.dedup();
                writer
                    .add_document(make_document(
                        index_fields,
                        &current_record,
                        &current_dataset,
                        &values,
                    ))
                    .map_err(sanitized)?;
                values.clear();
            }
            if record_id != current_record {
                current_record = record_id;
                current_dataset = dataset_id;
            }
            values.push(value);
        }
        if !current_record.is_empty() {
            values.sort_unstable();
            values.dedup();
            writer
                .add_document(make_document(
                    index_fields,
                    &current_record,
                    &current_dataset,
                    &values,
                ))
                .map_err(sanitized)?;
        }
        writer.commit().map_err(sanitized)?;
        writer.wait_merging_threads().map_err(sanitized)
    })();
    if let Err(error) = rebuild {
        let _ = fs::remove_dir_all(&temporary_path);
        return Err(error);
    }

    fs::rename(index_path, &backup_path).map_err(sanitized)?;
    if fs::rename(&temporary_path, index_path).is_err() {
        let _ = fs::rename(&backup_path, index_path);
        return Err("search index upgrade could not be activated".to_string());
    }
    remove_generated_index_dir(&backup_path)
}

fn remove_generated_index_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(sanitized)?;
    }
    Ok(())
}

fn split_structured_query(query: &str) -> (Option<&str>, &str) {
    let Some((field, value)) = query.split_once(':') else {
        return (None, query);
    };
    if matches!(
        field,
        "email"
            | "username"
            | "first_name"
            | "last_name"
            | "full_name"
            | "phone"
            | "ip_address"
            | "domain"
            | "url"
            | "city"
            | "country"
            | "postal_code"
            | "company"
            | "job_title"
            | "user_id"
            | "timestamp"
            | "unknown"
    ) && !value.is_empty()
    {
        (Some(field), value.trim_matches('"'))
    } else {
        (None, query)
    }
}

fn escape_tantivy_regex(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(
            character,
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn sanitized(error: impl std::fmt::Display) -> String {
    let _ = error;
    "search index operation failed".to_string()
}

#[cfg(test)]
mod tests {
    use tantivy::{
        Index, TantivyDocument,
        schema::{STORED, STRING, Schema},
    };
    use tempfile::tempdir;

    use super::{SearchIndex, make_document};
    use crate::models::SearchMode;

    #[test]
    fn exact_contains_and_prefix_queries_return_stored_record_ids() {
        let directory = tempdir().expect("temporary directory");
        let search = SearchIndex::open_or_create(directory.path()).expect("index");
        let mut writer = search.writer().expect("writer");
        writer
            .add_document(make_document(
                search.fields,
                "record-1",
                "dataset-1",
                &[
                    "email:person@example.com".to_string(),
                    "person@example.com".to_string(),
                ],
            ))
            .expect("document");
        writer
            .add_document(make_document(
                search.fields,
                "record-2",
                "dataset-1",
                &[
                    "first_name:john".to_string(),
                    "last_name:doe".to_string(),
                    "email:john.doe@sample.test".to_string(),
                    "john.doe@sample.test".to_string(),
                ],
            ))
            .expect("name document");
        writer.commit().expect("commit");
        assert_eq!(search.document_count().expect("document count"), 2);

        for (query, mode) in [
            ("email:person@example.com", SearchMode::Exact),
            ("person@example.com", SearchMode::Contains),
            ("example", SearchMode::Contains),
            ("person@", SearchMode::Prefix),
        ] {
            let (_, hits) = search
                .search_record_ids(query, mode, None, None, 0, 20)
                .expect("search");
            assert_eq!(hits, ["record-1"]);
        }

        let (_, hits) = search
            .search_record_ids("John Doe", SearchMode::Contains, None, None, 0, 20)
            .expect("name search");
        assert_eq!(hits, ["record-2"]);
    }

    #[test]
    fn deleting_a_dataset_removes_only_its_documents() {
        let directory = tempdir().expect("temporary directory");
        let search = SearchIndex::open_or_create(directory.path()).expect("index");
        let mut writer = search.writer().expect("writer");
        for (record, dataset) in [("record-a", "dataset-a"), ("record-b", "dataset-b")] {
            writer
                .add_document(make_document(
                    search.fields,
                    record,
                    dataset,
                    &["shared-value".to_string()],
                ))
                .expect("document");
        }
        writer.commit().expect("commit");
        drop(writer);

        search.delete_dataset("dataset-a").expect("delete dataset");
        let (_, hits) = search
            .search_record_ids("shared-value", SearchMode::Exact, None, None, 0, 20)
            .expect("remaining search");
        assert_eq!(hits, ["record-b"]);
    }

    #[test]
    fn trigram_candidates_are_verified_and_field_filters_match_substrings() {
        let directory = tempdir().expect("temporary directory");
        let search = SearchIndex::open_or_create(directory.path()).expect("index");
        let mut writer = search.writer().expect("writer");
        for (record, values) in [
            (
                "record-real",
                vec![
                    "email:person@google.example".to_string(),
                    "person@google.example".to_string(),
                    "xxabcdexx".to_string(),
                ],
            ),
            (
                "record-false-candidate",
                vec!["abc".to_string(), "bcd".to_string(), "cde".to_string()],
            ),
        ] {
            writer
                .add_document(make_document(search.fields, record, "dataset-1", &values))
                .expect("document");
        }
        writer.commit().expect("commit");
        search.reload().expect("reload committed index");

        let (total, hits) = search
            .search_record_ids("abcde", SearchMode::Contains, None, None, 0, 20)
            .expect("verified contains");
        assert_eq!(total, 1);
        assert_eq!(hits, ["record-real"]);

        let (_, hits) = search
            .search_record_ids("google", SearchMode::Contains, None, Some("email"), 0, 20)
            .expect("field contains");
        assert_eq!(hits, ["record-real"]);
    }

    #[test]
    fn legacy_indexes_rebuild_from_local_metadata() {
        let directory = tempdir().expect("temporary directory");
        let database = rusqlite::Connection::open(directory.path().join("metadata.sqlite3"))
            .expect("metadata database");
        database
            .execute_batch(
                "CREATE TABLE records(id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL);
                 CREATE TABLE field_values(
                   record_id TEXT NOT NULL, field_type TEXT NOT NULL,
                   normalized_value TEXT NOT NULL, is_sensitive INTEGER NOT NULL
                 );
                 CREATE TABLE record_domains(
                   record_id TEXT NOT NULL, hostname TEXT NOT NULL,
                   registrable_domain TEXT NOT NULL
                 );
                 CREATE TABLE record_domain_parents(
                   record_id TEXT NOT NULL, registrable_domain TEXT NOT NULL
                 );
                 INSERT INTO records VALUES ('record-legacy', 'dataset-legacy');
                 INSERT INTO field_values VALUES (
                   'record-legacy', 'email', 'legacy@example.test', 0
                 );",
            )
            .expect("legacy metadata");

        let mut builder = Schema::builder();
        let record_id = builder.add_text_field("record_id", STRING | STORED);
        builder.add_text_field("dataset_id", STRING);
        builder.add_text_field("exact_values", STRING);
        let legacy_path = directory.path().join(super::INDEX_DIRECTORY);
        std::fs::create_dir_all(&legacy_path).expect("legacy index directory");
        let legacy = Index::create_in_dir(&legacy_path, builder.build()).expect("legacy index");
        let mut writer = legacy.writer(15_000_000).expect("legacy writer");
        let mut document = TantivyDocument::default();
        document.add_text(record_id, "record-legacy");
        writer.add_document(document).expect("legacy document");
        writer.commit().expect("legacy commit");
        drop(writer);
        drop(legacy);

        let current = SearchIndex::open_or_create(directory.path()).expect("upgraded index");
        let (_, hits) = current
            .search_record_ids(
                "legacy@example.test",
                SearchMode::Contains,
                None,
                None,
                0,
                20,
            )
            .expect("upgraded search");
        assert_eq!(hits, ["record-legacy"]);
        assert!(!directory.path().join("search-index-v1-backup").exists());
        assert!(!directory.path().join("search-index-v2-building").exists());
    }
}
