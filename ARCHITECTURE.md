# Aletheia Architecture

## Product boundary

Aletheia is a local-only Windows desktop investigation app for data the user is authorized to analyze. Source files are opened read-only. Their records, file paths, search queries, index contents, and exports never cross the local trust boundary.

The app does not download breach data, test credentials, automate logins, scrape sites, enrich records through network services, or contact people.

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
  |-- jobs: cancellation tokens, pause gates, bounded channels
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

Backpressure is provided by bounded Tokio channels. Jobs expose running, paused, cancelled, completed, and failed states. Cancellation is checked between records and before durable batch commits. Parser errors are counted and sanitized; raw record values are never logged.

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
- Contains: indexed n-gram or bounded safe fallback
- Prefix: prefix-oriented indexed term query
- Fuzzy: allowed only for non-secret text types
- Regex: size and complexity limited
- Related: resolves identity membership before querying

Every hit includes dataset ID, source file ID, line or record position, parser, import time, and match reason.

## Domain grouping

URL and hostname normalization lowercases hostnames, removes trailing dots and ports, preserves Unicode safely, and uses Public Suffix List semantics to find the registrable domain. It never assumes the last two labels form the parent.

## Identity grouping

Automatic groups use deterministic keys only:

- exact normalized email
- exact normalized phone
- exact service-scoped user ID

User merges are confirmed links. Username-only matches remain possible suggestions and are never auto-merged. Merge, split, reject, and undo actions write append-only audit events.

## Redaction and export

Exports are built from explicit record IDs and selected fields. Defaults exclude passwords, tokens, cookies, API keys, hashes, and raw records; phone values are masked. Optional email-local-part masking is explicit. A sidecar manifest records filters and redaction settings without secret values. Files are written to a temporary sibling and atomically renamed. Each export creates an audit event.

## Cleanup

Cleanup resolves and verifies every generated path under the configured storage root before deletion. It can remove the Tantivy index, cache, temporary files, search history, or all generated state. It never follows a path to a source dataset and never deletes outside the storage root.

## UI architecture

The app uses a persistent left rail, top command/search bar, route workspace, optional right details panel, and bottom privacy/status strip. React Query owns server state; router search parameters own searchable/filterable UI state; local component state owns transient controls.

Obsidian Signal uses graphite surfaces, fine neutral borders, a cool cyan primary accent, violet only as a secondary analysis cue, and mono type for technical values. Status includes text or icons so color is never the only signal. Dense screens use separators and alignment, not generic card grids.

## Quality gates

Each development phase must leave the app runnable and pass:

- frontend formatting, lint, type checking, unit tests, and production build
- Rust formatting, Clippy with warnings denied, and tests
- end-to-end tests when the phase exposes a complete user flow
- Tauri package build at the final gate
- safety scan proving no real dataset records or generated indexes are tracked
