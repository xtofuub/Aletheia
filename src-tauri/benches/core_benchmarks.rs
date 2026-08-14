use std::path::PathBuf;

use aletheia_lib::{
    detection::inspect_paths,
    direct_scan::benchmark_plain_scan_bytes,
    domain_analysis::{normalize_domain, normalize_url},
    models::SearchMode,
    search_index::{SearchIndex, make_document},
};
use criterion::{BatchSize, BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use tantivy::{
    collector::{Count, TopDocs},
    query::RegexQuery,
};
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

fn synthetic_live_source(lines: usize) -> Vec<u8> {
    let mut source = Vec::with_capacity(lines.saturating_mul(72));
    for number in 0..lines {
        source.extend_from_slice(
            format!(
                "user-{number:010}|person-{number:010}@example.test|common.example|synthetic\n"
            )
            .as_bytes(),
        );
    }
    source.extend_from_slice(b"final|target-near-end@example.test|synthetic\n");
    source
}

fn live_search(criterion: &mut Criterion) {
    for line_count in [100_000_usize, 1_000_000] {
        let source = synthetic_live_source(line_count);
        let mut group = criterion.benchmark_group(format!("live_scan_{line_count}_lines"));
        group.throughput(Throughput::Bytes(source.len() as u64));
        for (label, query) in [
            ("no_match", "absent-probe.invalid"),
            ("match_near_end", "target-near-end@example.test"),
            ("common_match", "common.example"),
        ] {
            group.bench_with_input(BenchmarkId::new(label, 1), &query, |bench, query| {
                bench.iter(|| {
                    benchmark_plain_scan_bytes(&source, query, SearchMode::Contains, false, 1)
                })
            });
        }
        if line_count == 1_000_000 {
            for workers in [2_usize, 4] {
                group.bench_with_input(
                    BenchmarkId::new("no_match_workers", workers),
                    &workers,
                    |bench, workers| {
                        bench.iter(|| {
                            benchmark_plain_scan_bytes(
                                &source,
                                "absent-probe.invalid",
                                SearchMode::Contains,
                                false,
                                *workers,
                            )
                        })
                    },
                );
            }
        }
        group.finish();
    }
}

fn indexing_and_search(criterion: &mut Criterion) {
    criterion.bench_function("index_100000_synthetic_records", |bench| {
        bench.iter_batched(
            || {
                let directory = tempdir().expect("temporary index");
                let index = SearchIndex::open_or_create(directory.path()).expect("search index");
                (directory, index)
            },
            |(_directory, index)| {
                let mut writer = index.writer().expect("writer");
                for number in 0..100_000 {
                    writer
                        .add_document(make_document(
                            index.fields,
                            &format!("record-{number}"),
                            "dataset-benchmark",
                            &[
                                format!("email:person{number}@example.com"),
                                format!("person{number}@example.com"),
                            ],
                        ))
                        .expect("document");
                }
                writer.commit().expect("commit");
            },
            BatchSize::LargeInput,
        )
    });

    let directory = tempdir().expect("temporary index");
    let index = SearchIndex::open_or_create(directory.path()).expect("search index");
    let mut writer = index.writer().expect("writer");
    for number in 0..100_000 {
        writer
            .add_document(make_document(
                index.fields,
                &format!("record-{number}"),
                "dataset-benchmark",
                &[
                    format!("email:person{number}@example.com"),
                    format!("person{number}@example.com"),
                ],
            ))
            .expect("document");
    }
    writer.commit().expect("commit benchmark index");
    criterion.bench_function("exact_email_search_100000_records", |bench| {
        bench.iter(|| {
            index.search_record_ids(
                "email:person50000@example.com",
                SearchMode::Exact,
                None,
                None,
                0,
                20,
            )
        })
    });
    criterion.bench_function("domain_contains_search_100000_records", |bench| {
        bench.iter(|| {
            index.search_record_ids("example.com", SearchMode::Contains, None, None, 0, 20)
        })
    });
    criterion.bench_function("legacy_regex_contains_search_100000_records", |bench| {
        bench.iter(|| {
            let reader = index.index.reader().expect("legacy reader");
            reader.reload().expect("legacy reload");
            let searcher = reader.searcher();
            let query = RegexQuery::from_pattern(".*example\\.com.*", index.fields.exact_values)
                .expect("legacy regex");
            let total = searcher.search(&query, &Count).expect("legacy count");
            let hits = searcher
                .search(&query, &TopDocs::with_limit(20).order_by_score())
                .expect("legacy top docs");
            (total, hits)
        })
    });
    criterion.bench_function("prefix_search_100000_records", |bench| {
        bench.iter(|| index.search_record_ids("person500", SearchMode::Prefix, None, None, 0, 20))
    });
    criterion.bench_function("rare_contains_search_100000_records", |bench| {
        bench.iter(|| {
            index.search_record_ids("person99999", SearchMode::Contains, None, None, 0, 20)
        })
    });
    criterion.bench_function("legacy_regex_rare_search_100000_records", |bench| {
        bench.iter(|| {
            let reader = index.index.reader().expect("legacy reader");
            reader.reload().expect("legacy reload");
            let searcher = reader.searcher();
            let query = RegexQuery::from_pattern(".*person99999.*", index.fields.exact_values)
                .expect("legacy regex");
            let total = searcher.search(&query, &Count).expect("legacy count");
            let hits = searcher
                .search(&query, &TopDocs::with_limit(20).order_by_score())
                .expect("legacy top docs");
            (total, hits)
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

criterion_group!(
    benches,
    parsing_and_normalization,
    live_search,
    indexing_and_search
);
criterion_main!(benches);
