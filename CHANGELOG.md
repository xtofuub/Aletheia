# Changelog

## 0.1.1 - 2026-07-28

- Hardened the streaming importer for multi-hundred-gigabyte sources.
- Bounded oversized-line draining and in-memory record batches.
- Added periodic Tantivy commits and sanitized SQLite checkpoints.
- Made identity grouping incremental instead of dataset-sized in memory.
- Corrected compressed-source progress and per-file byte offsets.
- Added generated 1 GiB and 300 GiB streaming soak coverage.

## 0.1.0 - 2026-07-28

- Added Tauri 2 Windows desktop shell with React, TypeScript, Rust, SQLite, and Tantivy.
- Added local onboarding, authorization confirmation, storage selection, themes, command palette, and clean compact dashboard.
- Added bounded read-only source detection, masked previews, field mapping, and background import controls.
- Added streaming TXT, CSV, TSV, delimited, JSONL, NDJSON, and GZIP indexing.
- Added normalized exact, contains, prefix, and structured search with virtualized masked results.
- Added Public Suffix List domain grouping and expandable domain explorer.
- Added deterministic identity grouping, confirm, reject, merge, split, undo, and append-only audit events.
- Added strict CSV, JSON, JSONL, and Markdown exports with sidecar manifests.
- Added guarded generated-data cleanup, security settings, tests, benchmarks, safety checks, and Windows packaging.
