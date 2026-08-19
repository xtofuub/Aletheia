# Aletheia Architecture

## Product boundary

Aletheia is a local-only Windows desktop investigation app for data the user is authorized to analyze. Source files are opened read-only. Their records, file paths, search queries, index contents, and exports never cross the local trust boundary.

The app does not download breach data, test credentials, automate logins, scrape sites, enrich records through network services, or contact people. Its only optional outbound path checks the official signed Aletheia release feed and can download a verified app installer. It carries no workspace information.

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
  |-- live scan: bounded direct search over text, GZIP, ZIP, and RAR
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

Source datasets can live anywhere. SQLite stores indexed dataset metadata and a small catalog of saved Live-source paths. Removing an indexed dataset or saved Live source never removes the original file or folder.

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

Import heap use is based on the configured memory budget rather than source size. The reader retains at most one 1 MiB record, in-memory record batches are capped between 4 and 64 MiB, and Tantivy receives between 64 MiB and 2 GiB. The worker limit controls one Tantivy writer's indexing threads, and only one import writer runs at a time. Record IDs use time-ordered UUIDv7 keys, dataset counters commit inside the batch transaction, and bounded SQLite page-cache/WAL windows avoid random B-tree churn and tiny checkpoints during long imports. Tantivy and sanitized job checkpoints are committed after at least 250,000 new records and 15 seconds, no later than 1,000,000 records, and at every file boundary or graceful cancellation. Identity and record-to-domain links are materialized incrementally inside each batch instead of accumulating the dataset in memory. All byte and record totals use 64-bit counters for multi-terabyte inputs.

Supported indexed inputs are TXT, CSV, TSV, JSONL, NDJSON, and GZIP-wrapped variants. Format detection uses a small byte sample, not the extension alone. The parser enforces maximum sample, line, field, and decompression sizes.

The import wizard offers two explicit plans. **Fast index** stores searchable fields and source offsets while skipping deduplication, URL/domain materialization, and automatic identity grouping. **Relationship index** enables that relationship work when the user needs the Domains and Identities views. Both plans reuse prepared SQLite statements for each batch. This keeps indexing available for small and medium databases without making it the only way to search a very large corpus.

## Metadata model

SQLite is authoritative for:

- settings and onboarding authorization
- datasets and source files
- saved Live sources and their read-only paths
- import jobs, checkpoints, mappings, and reports
- record traceability and field metadata
- domains, URLs, identities, indexed memberships, selected identity evidence, and reusable Live-domain line snapshots
- bounded identity candidates and one-time domain aggregate repair markers
- saved searches, notes, tags, review state, and bookmarks
- export history and audit events

Raw records are not copied into SQLite. Recognized field values needed for details and analysis are stored with sensitivity metadata. Tantivy documents store normalized safe searchable fields plus IDs that join back to SQLite. Secret fields are excluded from general full-text indexes.

## Search model

Aletheia exposes both search engines through one source-aware command deck. The chosen saved source determines the engine automatically:

- **Indexed** compiles a bounded request into Tantivy and joins masked, traceable view models from SQLite. It is best for repeated investigations, paging, saved views, exports, identities, and domain analysis.
- **Saved Live source** opens cataloged authorized paths read-only and scans them on background Rust workers. It streams text, GZIP, ZIP, and RAR entries without extracting an archive to disk or creating a persistent index. Up to 512 newline-separated queries share one Aho-Corasick matcher and one physical read pass. Search can combine the deduplicated paths from every saved Live source. The local catalog persists names, paths, and archive preferences; the local metadata database also retains bounded result batches and safe resume checkpoints for interrupted scans.
- **Performance preflight** enumerates supported source files on a background worker and reads at most a 64 MiB sample without modifying them. It combines measured source throughput with the saved local CPU/archive benchmark to estimate a full scan range and recommend a worker count. The Settings benchmark uses generated temporary data inside the workspace and deletes its benchmark file immediately afterward.

Automatic mode recognizes common query shapes. Email, IP, phone, and service-ID queries use field-boundary matching; indexed domain queries use normalized domain links with an exact-first fallback, while live domain queries use literal containment so matches inside emails, URLs, and subdomains are not missed. Advanced mode exposes exact, contains, prefix, dataset, field, archive, case, worker, and result-limit controls.

- Exact: normalized term query
- Contains: intersected bigram/trigram candidates followed by stored normalized-value verification for new indexes, with a compatible Tantivy-regex fallback for older generated indexes so startup never performs a blocking schema rebuild
- Prefix: escaped prefix regex over safe normalized terms

Exact domain queries use the record-to-domain SQLite index so parent domains
also resolve hostnames extracted from URL fields. Secret fields are rejected
before query compilation.

Every hit includes dataset ID, source file ID, line or record position, parser, import time, and match reason.

The live path compiles literal queries into a release-tuned Aho-Corasick DFA once per scan. Plain files are read once in 8 MiB newline-aligned blocks, searched as raw bytes, and only matching offsets pay the cost of line-boundary resolution and bounded excerpt sanitation. One sequential source reader avoids rotational-disk seek thrash while a large plain file can feed up to eight CPU match workers through a bounded queue. Windows file handles carry the sequential-scan hint. Streamed archives use single-pass bounded line readers. Pause and cancellation are checked between bounded reads, results are emitted in batches of 128, and the whole worker set stops at the configured result cap. Result batches, completed files, and newline-safe plain-file byte offsets are checkpointed locally; after a process interruption the unfinished plain file resumes from the latest ordered checkpoint while ZIP, RAR, and GZIP restart at their current archive boundary. Progress is throttled, physical source bytes are tracked separately from expanded archive bytes, and ETA uses physical progress. React coalesces events to one render per animation frame and reuses accumulated hits for progress-only events. ZIP and RAR archives are entry-count and decompression-ratio limited; encrypted RAR text entries are rejected. Reusable secret-like fragments are filtered in Rust before events reach React; complete non-secret line contents remain visible.

Tantivy uses a reader cached per active storage root and its commit-aware reload policy instead of opening and reloading a reader for every query. Exact and Prefix keep their dedicated term-dictionary paths. Contains intersects indexed bigrams/trigrams, then verifies candidates against stored normalized safe values while collecting the exact count and requested page in one pass. The generated-index schema is detected explicitly; older indexes are rebuilt from local SQLite metadata into a temporary directory and atomically swapped without reading or changing source datasets.

Result pages support 25, 50, 100, or 200 records with explicit ranges and
navigation. Search hit metadata and fields are loaded in batches instead of one
SQLite query per row. Domain drilldowns use materialized per-parent and
per-hostname links, server-side hostname prefix filters, and bounded masked
field previews for each linked source line.

## Domain grouping

URL and hostname normalization lowercases hostnames, removes trailing dots and ports, preserves Unicode safely, and uses Public Suffix List semantics to find the registrable domain. It never assumes the last two labels form the parent.

Indexed domain links remain incrementally materialized for fast dataset and
hostname drilldowns. An on-demand Live-domain scan can instead search one or all
saved Live sources and persist at most 5,000 deduplicated line snapshots in
SQLite. Stored Live collections retain provenance and remain separate from the
Tantivy index.

## Identity grouping

Automatic groups use deterministic keys only:

- exact normalized email
- exact normalized phone
- exact service-scoped user ID

Unique values remain compact candidates and do not become singleton identity
groups. A group materializes only after a deterministic key repeats. Username
matches are never automatically grouped. Manual reviewed bundles contain only
the indexed records and bounded live-scan rows explicitly selected by the user.
Live evidence stores the already-masked excerpt, source path, archive entry, and
line location; it does not create a full index or copy an archive. Merge, split,
reject, and undo actions write append-only audit events.

An idempotent bounded rebuild applies the same deterministic rules to records indexed by older versions.

## Redaction and export

Exports are built from explicit record IDs and selected fields. Defaults exclude passwords, tokens, cookies, API keys, hashes, and raw records; phone values are masked. Optional email-local-part masking is explicit. A sidecar manifest records filters and redaction settings without secret values. Files are written to a temporary sibling and atomically renamed. Each export creates an audit event.

## Cleanup

Cleanup resolves and verifies every generated path under the configured storage root before deletion. It can remove the Tantivy index, cache, temporary files, search history, or all generated state. It never follows a path to a source dataset and never deletes outside the storage root.

## UI architecture

The app uses a persistent left rail, top command/search bar, route workspace, optional right details panel, and bottom privacy/status strip. React Query owns server state and local component state owns transient controls.

The interface uses `@efferd/dashboard-2` as its canonical composition base: neutral surfaces, one-pixel `DashboardGrid` separators, square `DashboardCard` surfaces, compact controls, restrained green signal accents, and mono type only for technical values. Aletheia adapts the content, not the component language. Status includes text or icons so color is never the only signal. Dense screens use shared table, tab, badge, switch, select, and pagination primitives instead of unrelated page-specific patterns.

## Application updates

When automatic checks are enabled, the desktop client asks the Tauri updater for the latest signed `latest.json` manifest after startup. A missing network connection stays quiet. A newer signed version opens one Shadcn dialog; nothing downloads until the user approves it. The updater verifies the NSIS signature, installs in passive mode, and relaunches Aletheia through the narrowly scoped process restart permission. Release CI refuses to publish when the updater signing key is missing, checks the manifest URL and SHA-256 checksums, and cryptographically verifies the NSIS artifact against the public key embedded in the app before upload.

## Quality gates

Each development phase must leave the app runnable and pass:

- frontend formatting, lint, type checking, unit tests, and production build
- Rust formatting, Clippy with warnings denied, and tests
- end-to-end tests when the phase exposes a complete user flow
- Tauri package build at the final gate
- safety scan proving no real dataset records or generated indexes are tracked
