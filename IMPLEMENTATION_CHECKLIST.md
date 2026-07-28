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
