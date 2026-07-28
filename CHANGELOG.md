# Changelog

## 0.1.3 - 2026-07-28

- Unified dark mode around a neutral graphite palette and eliminated the startup theme flash.
- Moved long imports onto a dedicated SQLite WAL connection so dashboard reads remain responsive.
- Added single-instance handling so reopening Aletheia focuses the existing window instead of competing for the active workspace.
- Replaced expensive overview scans with compact database counts and stopped needless completed-job polling.
- Split route code so the desktop shell starts with substantially less JavaScript.
- Increased bounded import batches, reduced index checkpoints, reused prepared statements, and removed duplicate SQLite indexing.
- Reduced new Tantivy index write amplification and added a generated 100,000-record full-pipeline soak test.
- Regenerated the Windows icon set, used the real logo throughout the app, and made embedded EXE icon validation part of the release build.

## 0.1.2 - 2026-07-28

- Rebuilt the overview on the supplied Shadcn Dashboard composition.
- Added an animated, data-driven Recharts index growth chart.
- Added animated workspace metrics, richer source summaries, and a detailed dataset table.
- Refined the light dashboard hierarchy while preserving local-only privacy controls.

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
