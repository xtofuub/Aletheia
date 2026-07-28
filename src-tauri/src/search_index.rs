use std::{fs, path::Path};

use tantivy::{
    Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
    collector::{Count, TopDocs},
    query::{BooleanQuery, Occur, Query, RegexQuery, TermQuery},
    schema::{Field, IndexRecordOption, STORED, STRING, Schema, TEXT, Value},
};

use crate::models::SearchMode;

pub const INDEX_DIRECTORY: &str = "search-index";
const WRITER_MEMORY_BYTES: usize = 30_000_000;

#[derive(Clone, Copy)]
pub struct IndexFields {
    pub record_id: Field,
    pub dataset_id: Field,
    pub exact_values: Field,
}

pub struct SearchIndex {
    pub index: Index,
    pub fields: IndexFields,
}

impl SearchIndex {
    pub fn open_or_create(storage_root: &Path) -> Result<Self, String> {
        let path = storage_root.join(INDEX_DIRECTORY);
        fs::create_dir_all(&path).map_err(sanitized)?;
        let index = if path.join("meta.json").exists() {
            Index::open_in_dir(&path).map_err(sanitized)?
        } else {
            Index::create_in_dir(&path, schema()).map_err(sanitized)?
        };
        let fields = fields(&index.schema())?;
        Ok(Self { index, fields })
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

    pub fn reader(&self) -> Result<IndexReader, String> {
        self.index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(sanitized)
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

        let value_query: Box<dyn Query> = match mode {
            SearchMode::Exact => Box::new(TermQuery::new(
                Term::from_field_text(self.fields.exact_values, &term_value),
                IndexRecordOption::Basic,
            )),
            SearchMode::Contains => {
                if value.len() < 2 {
                    return Err("contains searches require at least two characters".to_string());
                }
                Box::new(
                    RegexQuery::from_pattern(
                        &format!(".*{}.*", escape_tantivy_regex(&term_value)),
                        self.fields.exact_values,
                    )
                    .map_err(sanitized)?,
                )
            }
            SearchMode::Prefix => Box::new(
                RegexQuery::from_pattern(
                    &format!("{}.*", escape_tantivy_regex(&term_value)),
                    self.fields.exact_values,
                )
                .map_err(sanitized)?,
            ),
        };

        let query: Box<dyn Query> = if let Some(dataset_id) = dataset_id {
            Box::new(BooleanQuery::new(vec![
                (Occur::Must, value_query),
                (
                    Occur::Must,
                    Box::new(TermQuery::new(
                        Term::from_field_text(self.fields.dataset_id, dataset_id),
                        IndexRecordOption::Basic,
                    )),
                ),
            ]))
        } else {
            value_query
        };

        let reader = self.reader()?;
        reader.reload().map_err(sanitized)?;
        let searcher = reader.searcher();
        let total = searcher.search(&query, &Count).map_err(sanitized)?;
        let top_docs = searcher
            .search(
                &query,
                &TopDocs::with_limit(limit.clamp(1, 200))
                    .and_offset(offset)
                    .order_by_score(),
            )
            .map_err(sanitized)?;
        let mut record_ids = Vec::with_capacity(top_docs.len());
        for (_, address) in top_docs {
            let document = searcher
                .doc::<TantivyDocument>(address)
                .map_err(sanitized)?;
            if let Some(record_id) = document
                .get_first(self.fields.record_id)
                .and_then(|value| value.as_str())
            {
                record_ids.push(record_id.to_string());
            }
        }
        Ok((total, record_ids))
    }
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
    for value in exact_values {
        document.add_text(fields.exact_values, value);
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
    builder.add_text_field("search_text", TEXT);
    builder.build()
}

fn fields(schema: &Schema) -> Result<IndexFields, String> {
    Ok(IndexFields {
        record_id: schema.get_field("record_id").map_err(sanitized)?,
        dataset_id: schema.get_field("dataset_id").map_err(sanitized)?,
        exact_values: schema.get_field("exact_values").map_err(sanitized)?,
    })
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
        writer.commit().expect("commit");

        for (query, mode) in [
            ("email:person@example.com", SearchMode::Exact),
            ("example", SearchMode::Contains),
            ("person@", SearchMode::Prefix),
        ] {
            let (_, hits) = search
                .search_record_ids(query, mode, None, None, 0, 20)
                .expect("search");
            assert_eq!(hits, ["record-1"]);
        }
    }
}
