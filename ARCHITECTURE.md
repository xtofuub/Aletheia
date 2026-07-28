# Aletheia Architecture

## Product boundary

Aletheia is a local-only Windows desktop investigation app for data the user is authorized to analyze. Source files are opened read-only. Their records, file paths, search queries, index contents, and exports never cross the local trust boundary.

The app does not download breach data, test credentials, automate logins, scrape sites, enrich records through network services, or contact people. Its only optional outbound request checks the official GitHub Releases API for a newer app version and carries no workspace information.

## Stack

- Desktop: Tauri 2
- UI: React, TypeScript, Vite, Tailwind CSS, owned shadcn-style primitives
- Navigation and data: TanStack Router, TanStack Query, TanStack Table
- Forms and validation: React Hook Form, Zod
- Interaction: Lucide icons and restrained Motion transitions
- Native core: Rust, Tokio, Serde
- Metadata: SQLite in WAL mode with versioned migrations
- Search: Tantivy in a separate generated index directory
- Domain parsing: a bundled Public Suffix List parser

## Process layout

```text
React renderer
  | typed Tauri commands and throttled progress events
  v
Rust application state
  |-- commands: validate requests, authorize paths, shape responses
  |-- jobs: cancellation tokens, pause gates, configured concurrency
  |-- import: detection, streaming parsers, normalization, fingerprints
  |-- storage: SQLite repositories and migrations
  |-- search: Tantivy writer, reader, query compiler
  |-- analysis: domain and deterministic identity grouping
  |-- export: redaction, atomic local writes, audit records
  `-- security: masking, path checks, archive and regex limits
```

React never reads datasets directly. Rust owns every source file handle and opens it without write permission.

## Local storage layout

The user-selected Aletheia storage root contains only generated state:

```text
aletheia-storage/
  metadata.sqlite3
  search-index/
  cache/
  temp/
  export-audit/
```

Source datasets can live anywhere. SQLite stores their absolute path, fingerprint, size, modification time, parser, and source location metadata. Removing a dataset reference or index never removes the source file.

## Import pipeline

```text
read-only file
  -> bounded sample detection
  -> user-approved field mapping
  -> bounded BufRead stream
  -> parsed record
  -> normalized fields + sensitivity
  -> BLAKE3 fingerprint and duplicate check
  -> batched SQLite metadata write
  -> Tantivy document batch
  -> domain and identity materialization
  -> checkpoint and throttled progress event
```

Backpressure is provided by the synchronous parser-to-batch callback: the reader cannot advance while a bounded SQLite/Tantivy batch is being committed. Jobs expose running, paused, cancelled, interrupted, completed, and failed states. Cancellation is checked between records and every 64 KiB while discarding an oversized record. Cancelled and interrupted jobs preserve a resumable plan and source position. Parser errors are counted and sanitized; raw record values are never logged.

Import heap use is based on the configured memory budget rather than source size. The reader retains at most one 1 MiB record, in-memory record batches are capped between 4 and 64 MiB, and Tantivy receives between 64 MiB and 2 GiB. The worker limit controls one Tantivy writer's indexing threads, and only one import writer runs at a time. Tantivy and sanitized job checkpoints are committed every 1,000,000 records and at every file boundary. Identity and record-to-domain links are materialized incrementally inside each batch instead of accumulating the dataset in memory. All byte and record totals use 64-bit counters for multi-terabyte inputs.

Supported MVP inputs are TXT, CSV, TSV, JSONL, NDJSON, and GZIP-wrapped variants. Format detection uses a small byte sample, not the extension alone. The parser enforces maximum sample, line, field, and decompression sizes.

## Metadata model

SQLite is authoritative for:

- settings and onboarding authorization
- datasets and source files
- import jobs, checkpoints, mappings, and reports
- record traceability and field metadata
- domains, URLs, identities, and memberships
- saved searches, notes, tags, review state, and bookmarks
- export history and audit events

Raw records are not copied into SQLite. Recognized field values needed for details and analysis are stored with sensitivity metadata. Tantivy documents store normalized safe searchable fields plus IDs that join back to SQLite. Secret fields are excluded from general full-text indexes.

## Search model

The frontend sends a parsed search request with mode, query, filters, sort, offset, and limit. Rust compiles it into a bounded Tantivy query and returns view models that are masked by default.

- Exact: normalized term query
- Contains: escaped literal regex over safe normalized terms
- Prefix: escaped prefix regex over safe normalized terms

Exact domain queries use the record-to-domain SQLite index so parent domains
also resolve hostnames extracted from URL fields. Secret fields are rejected
before query compilation.

Every hit includes dataset ID, source file ID, line or record position, parser, import time, and match reason.

Result pages support 25, 50, 100, or 200 records with explicit ranges and navigation. Domain drilldowns load a bounded masked field preview for each linked source line.

## Domain grouping

URL and hostname normalization lowercases hostnames, removes trailing dots and ports, preserves Unicode safely, and uses Public Suffix List semantics to find the registrable domain. It never assumes the last two labels form the parent.

## Identity grouping

Automatic groups use deterministic keys only:

- exact normalized email
- exact normalized phone
- exact service-scoped user ID

User merges are confirmed links. Username-only matches remain possible suggestions and are never auto-merged. Merge, split, reject, and undo actions write append-only audit events.

An idempotent bounded rebuild applies the same deterministic rules to records indexed by older versions.

## Redaction and export

Exports are built from explicit record IDs and selected fields. Defaults exclude passwords, tokens, cookies, API keys, hashes, and raw records; phone values are masked. Optional email-local-part masking is explicit. A sidecar manifest records filters and redaction settings without secret values. Files are written to a temporary sibling and atomically renamed. Each export creates an audit event.

## Cleanup

Cleanup resolves and verifies every generated path under the configured storage root before deletion. It can remove the Tantivy index, cache, temporary files, search history, or all generated state. It never follows a path to a source dataset and never deletes outside the storage root.

## UI architecture

The app uses a persistent left rail, top command/search bar, route workspace, optional right details panel, and bottom privacy/status strip. React Query owns server state and local component state owns transient controls.

Obsidian Signal uses graphite surfaces, fine neutral borders, a cool cyan primary accent, violet only as a secondary analysis cue, and mono type for technical values. Status includes text or icons so color is never the only signal. Dense screens use separators and alignment, not generic card grids.

## Quality gates

Each development phase must leave the app runnable and pass:

- frontend formatting, lint, type checking, unit tests, and production build
- Rust formatting, Clippy with warnings denied, and tests
- end-to-end tests when the phase exposes a complete user flow
- Tauri package build at the final gate
- safety scan proving no real dataset records or generated indexes are tracked
