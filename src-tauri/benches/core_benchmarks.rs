use std::path::PathBuf;

use aletheia_lib::{
    detection::inspect_paths,
    domain_analysis::{normalize_domain, normalize_url},
    models::SearchMode,
    search_index::{SearchIndex, make_document},
};
use criterion::{Criterion, criterion_group, criterion_main};
use tempfile::tempdir;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn parsing_and_normalization(criterion: &mut Criterion) {
    criterion.bench_function("parse_and_detect_synthetic_csv", |bench| {
        bench.iter(|| inspect_paths(&[fixture("records_valid.csv")]))
    });
    criterion.bench_function("normalize_synthetic_url_and_domain", |bench| {
        bench.iter(|| {
            normalize_url("https://portal.example.co.uk/path?page=2");
            normalize_domain("portal.example.co.uk");
        })
    });
}

fn indexing_and_search(criterion: &mut Criterion) {
    criterion.bench_function("index_1000_synthetic_records", |bench| {
        bench.iter_batched(
            || {
                let directory = tempdir().expect("temporary index");
                let index = SearchIndex::open_or_create(directory.path()).expect("search index");
                (directory, index)
            },
            |(_directory, index)| {
                let mut writer = index.writer().expect("writer");
                for number in 0..1_000 {
                    writer
                        .add_document(make_document(
                            index.fields,
                            &format!("record-{number}"),
                            "dataset-benchmark",
                            "file-benchmark",
                            &format!("line {}", number + 1),
                            &[
                                format!("email:person{number}@example.com"),
                                format!("person{number}@example.com"),
                            ],
                            &format!("person{number} example"),
                        ))
                        .expect("document");
                }
                writer.commit().expect("commit");
            },
            criterion::BatchSize::SmallInput,
        )
    });

    let directory = tempdir().expect("temporary index");
    let index = SearchIndex::open_or_create(directory.path()).expect("search index");
    let mut writer = index.writer().expect("writer");
    for number in 0..1_000 {
        writer
            .add_document(make_document(
                index.fields,
                &format!("record-{number}"),
                "dataset-benchmark",
                "file-benchmark",
                &format!("line {}", number + 1),
                &[
                    format!("email:person{number}@example.com"),
                    format!("person{number}@example.com"),
                ],
                &format!("person{number} example"),
            ))
            .expect("document");
    }
    writer.commit().expect("commit");
    criterion.bench_function("exact_email_search_1000_records", |bench| {
        bench.iter(|| {
            index.search_record_ids(
                "email:person500@example.com",
                SearchMode::Exact,
                None,
                None,
                0,
                20,
            )
        })
    });
    criterion.bench_function("domain_contains_search_1000_records", |bench| {
        bench.iter(|| {
            index.search_record_ids("example.com", SearchMode::Contains, None, None, 0, 20)
        })
    });

    let identities = rusqlite::Connection::open_in_memory().expect("identity database");
    identities
        .execute_batch(
            "CREATE TABLE groups(id TEXT PRIMARY KEY, label TEXT NOT NULL);
             CREATE TABLE members(group_id TEXT NOT NULL, record_id TEXT NOT NULL);",
        )
        .expect("identity schema");
    for number in 0..1_000 {
        identities
            .execute(
                "INSERT INTO groups(id, label) VALUES (?1, ?2)",
                rusqlite::params![format!("group-{number}"), format!("synthetic-{number}")],
            )
            .expect("group");
        identities
            .execute(
                "INSERT INTO members(group_id, record_id) VALUES (?1, ?2)",
                rusqlite::params![format!("group-{number}"), format!("record-{number}")],
            )
            .expect("member");
    }
    criterion.bench_function("load_1000_identity_groups", |bench| {
        bench.iter(|| {
            let mut statement = identities
                .prepare(
                    "SELECT g.id, g.label, COUNT(m.record_id)
                     FROM groups g LEFT JOIN members m ON m.group_id = g.id
                     GROUP BY g.id ORDER BY COUNT(m.record_id) DESC",
                )
                .expect("statement");
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })
                .expect("query")
                .collect::<Result<Vec<_>, _>>()
                .expect("rows")
        })
    });
}

criterion_group!(benches, parsing_and_normalization, indexing_and_search);
criterion_main!(benches);
