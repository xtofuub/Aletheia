# Aletheia Implementation Checklist

Status key: `[ ]` pending, `[x]` complete.

## Preflight

- [x] Inspect repository and read both specifications completely
- [x] Define architecture and local trust boundary
- [x] Add dataset, index, database, export, temporary, and secret ignore rules
- [x] Check Windows, Node, Rust, MSVC, WebView, and Tauri prerequisites
- [x] Inspect the minimum read-only masked sample from `E:\848.txt`
- [x] Document inferred format without real values
- [x] Create structure-matching synthetic fixtures
- [x] Add pre-commit dataset safety checks

## Phase 1: Bootstrap

- [x] Initialize Vite, React, TypeScript, Tailwind, and Tauri 2
- [x] Add TanStack Router and Query, themes, UI primitives, and primary routes
- [x] Build the persistent dashboard shell and command palette
- [x] Add onboarding authorization and storage selection
- [x] Add SQLite migrations, settings commands, and UI states
- [x] Pass phase quality gates
- [x] Update documentation

## Phase 2: Import foundation

- [x] Add file and folder pickers
- [x] Inspect metadata through read-only handles
- [x] Detect encoding, line ending, delimiter, header, format, and compression
- [x] Infer conservative field types and return masked previews
- [x] Add field mapping and guarded import configuration
- [x] Add background job states, pause, resume, cancel, and progress UI
- [x] Cover malformed and heterogeneous synthetic fixtures
- [x] Pass phase quality gates and update documentation

## Phase 3: Indexing

- [x] Stream TXT, CSV, TSV, delimited, JSONL, NDJSON, and GZIP sources
- [x] Enforce bounded lines, fields, buffers, discovery, and decompression
- [x] Normalize supported field types
- [x] Add BLAKE3 record fingerprints and deduplication
- [x] Store traceable record metadata in SQLite batches
- [x] Build and commit Tantivy document batches
- [x] Support cancellation and sanitized reports
- [x] Pass phase quality gates and update documentation

## Phase 4: Search

- [x] Parse simple and structured queries
- [x] Support exact, contains, and prefix modes
- [x] Exclude secret fields and avoid unsafe regex/fuzzy modes
- [x] Add field and dataset filters, sort, pagination, and virtualization
- [x] Add masked record details and source traceability
- [x] Resolve exact domain queries from URL-derived hostname and parent links
- [x] Add saved searches and bounded local search history
- [x] Pass phase quality gates and update documentation

## Phase 5: Domains

- [x] Extract and sanitize URLs and hostnames
- [x] Normalize ports, trailing dots, IDNs, paths, query keys, and IPs
- [x] Integrate Public Suffix List resolution
- [x] Materialize parent-domain and subdomain statistics
- [x] Build the expandable domain explorer
- [x] Add domain search, breach-dataset filters, and record drilldown
- [x] Cover `co.uk`, Unicode/IDNA, malformed URL, credential, query, and IP cases
- [x] Pass phase quality gates and update documentation

## Phase 6: Identities

- [x] Group exact normalized email and phone matches
- [x] Group exact service-scoped user IDs
- [x] Show confidence and reasons
- [x] Add confirm, reject, merge, split, and undo
- [x] Persist append-only audit history
- [x] Prove username-only records never auto-merge
- [x] Pass phase quality gates and update documentation

## Phase 7: Export and hardening

- [x] Export CSV, JSON, JSONL, and Markdown
- [x] Enforce strict redaction and write sidecar manifests
- [x] Add export audit history
- [x] Safely clear index, cache, temporary data, history, or all generated state
- [x] Add clipboard, inactivity lock, memory, worker, and network policy settings
- [x] Add path, archive/discovery, line, decompression, query, and regex protections
- [x] Bound oversized-line draining, record batches, and Tantivy writer memory
- [x] Commit safe index/checkpoint boundaries during multi-hundred-gigabyte imports
- [x] Validate fixed-memory resource math and generated streams through 4 TiB
- [x] Add indexed hostname, parent-domain, and per-dataset record links
- [x] Materialize identity groups incrementally without dataset-sized memory
- [x] Complete responsive, accessibility, keyboard, and reduced-motion review
- [x] Add performance benchmarks and smoke targets
- [x] Complete the required documentation set and synthetic screenshots
- [x] Pass frontend, Rust, end-to-end, native build, and safety gates
- [x] Build the Windows executable and installer configuration
- [x] Publish changelog-backed release notes with setup guidance

## 0.1.5 reliability pass

- [x] Make resource settings atomic, controlled, and immediately visible
- [x] Add disabled inactivity lock and optional GitHub update checks
- [x] Apply worker and memory settings to the real Tantivy writer
- [x] Recover stale job states and resume cancelled or interrupted imports
- [x] Keep dataset totals and the index-growth chart current during indexing
- [x] Add explicit search page sizes, ranges, navigation, and error states
- [x] Show masked domain source-line contents with consistent location typography
- [x] Rebuild deterministic identities for already indexed records
- [x] Add resume, domain masking, identity rebuild, and settings regression tests

## 0.1.6 investigation workflow pass

- [x] Unify Search, Domains, Identities, Datasets, and Settings on Shadcn primitives
- [x] Add real search pagination, page-size controls, and plain Contains defaults
- [x] Batch-load search and domain evidence without per-record query loops
- [x] Add domain paging, hostname filtering, masked line evidence, and count repair
- [x] Add manual identity search, selection, naming, bundling, and bento cards
- [x] Materialize automatic identities only for repeated exact identifiers
- [x] Make identity rebuild deterministic, review-preserving, and member-paginated
- [x] Separate dataset Resume actions and show live indexing throughput
- [x] Rebuild Settings with performance presets and persistent save feedback
- [x] Deepen and normalize the dark theme across all investigation routes
- [x] Add frontend, Rust, and end-to-end regression coverage

## Unified search and archive pass

- [x] Adapt the approved Efferd grid language to the unified Search workflow
- [x] Add Automatic query-shape detection and explicit Advanced controls
- [x] Add Indexed and Live files scopes behind one command deck
- [x] Stream TXT, CSV, TSV, JSONL, NDJSON, LOG, GZIP, ZIP, and RAR read-only
- [x] Keep ZIP and RAR members in memory without extracting to disk
- [x] Add result caps, cancellation, worker limits, throughput, and source progress
- [x] Add archive entry, path, line, encryption, and decompression protections
- [x] Add Fast index and optional Deep analysis import profiles
- [x] Precompile direct literal matching and reuse SQLite batch statements
- [x] Add synthetic ZIP/RAR, profile, automatic-domain, and end-to-end coverage
- [x] Pass formatting, lint, type checking, frontend tests, Rust tests, Clippy, benchmarks, browser flows, screenshots, and data safety checks

## Very large corpus pass

- [x] Scan up to 512 lookup values in one physical read pass
- [x] Add live-scan pause, resume, ETA, decoded throughput, and physical-byte progress
- [x] Default direct scans to one worker for physical HDD collections
- [x] Split persistent imports into Fast and Relationship index profiles
- [x] Add generated 1 GiB direct-scan and 50-million-record-capable index soaks
- [x] Complete a 4.2-million-record Fast index reliability soak
- [x] Reduce SQLite write amplification with UUIDv7 keys and batched counters
- [x] Add read-only aggregate RAR metadata and streaming probes
- [x] Add end-to-end coverage for batch scan and index-profile selection
