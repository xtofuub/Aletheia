# Changelog

## Unreleased

- Replaced identity source-only rows and field badges with readable delimited record values, plus an intentional full-identifier view that never exposes passwords, tokens, cookies, or API keys.
- Separated Indexed Search from Direct File Scan with clear mode cards, independent queries, automatic query-type hints, and advanced scan controls for workers, archives, and result limits.
- Standardized action footers across Search, Datasets, Identities, Exports, and Settings to the square Efferd treatment without rounded gray corners.
- Simplified page descriptions and empty-state instructions across the investigation and library workflows.
- Filled the identity builder side pane with a clear selection state and a square Efferd footer, removing the empty gray column below the bundle controls.
- Removed the rounded gray footer treatment from Settings storage and update cards so they match the square Efferd grid.
- Replaced every shield glyph with context-specific icons and added a persistent Documentation link to the Aletheia GitHub repository in the sidebar footer.
- Restored the canonical Efferd Dashboard 2 stat-card footer treatment on Overview and removed the redundant Offline pill from the application header.
- Consolidated Settings into one dense Efferd page, rebuilt Identities as a searchable master-detail workspace, and replaced Live Files with a focused Direct Scan workflow.
- Reset the frontend and rebuilt every application route from the official Efferd Dashboard 2 registry block while preserving the native Rust backend and local data engine.
- Replaced the legacy Overview page completely with the literal Efferd Dashboard 2 grid and adapted its original stats, bar chart, line chart, table, health, and activity sections to real Aletheia data.
- Installed the complete Efferd Dashboard 2 registry block with `npx shadcn@latest add @efferd/dashboard-2`, then adapted its real shell, sidebar, breadcrumbs, cards, charts, tables, empty states, Geist fonts, and Lucide icon system to Aletheia.
- Rebuilt Overview around the real Efferd Dashboard 2 composition: four compact KPI cards, paired operational charts, a recent-datasets table, workspace health, and activity panels in the original four-column one-pixel grid.
- Made the official `@efferd/dashboard-2` registry block the canonical component base and migrated overview, search, datasets, domains, identities, saved views, exports, settings, and empty states onto its square DashboardCard and one-pixel grid composition.
- Rebuilt the complete application shell around Efferd Dashboard 2: edge-to-edge workbench layout, dark-first near-black palette, compact route bar, square data panels, restrained green signals, and one consistent density across every page.
- Reworked the sidebar into a compact operational rail with a dedicated local-privacy boundary and made the Efferd theme the default for new workspaces and existing browser previews without overriding later theme choices.
- Added unified Automatic and Advanced search with query-shape detection, exact-first indexed lookup, and domain matching that also finds emails, URLs, and subdomains.
- Added Live files search for read-only TXT, CSV, TSV, JSONL, NDJSON, LOG, GZIP, ZIP, and RAR sources without extraction or persistent indexing.
- Added background live-scan workers, cancellation, result caps, streaming masked hits, decompressed-byte throughput, source progress, archive safety limits, and synthetic ZIP/RAR regression coverage.
- Added Fast index and Deep analysis profiles so smaller databases can keep instant repeated search without paying for optional deduplication, domain, and identity work.
- Precompiled live literal matching and reused SQLite import statements per batch to reduce CPU and database preparation overhead.
- Adapted the Efferd operational grid across the unified search workflow with compact shared controls, technical typography, sharp separators, and restrained signal color.
- Matched Identities and Settings to the approved Overview density, typography, borders, spacing, and monochrome brand language.
- Rebuilt Settings with official Shadcn tabs, selects, switches, badges, and a single small save action.
- Added bundled Geist Mono typography for record locations and identifiers, and simplified Search, Datasets, and Exports copy.
- Rebuilt identity evidence and member rows with Shadcn tables, compact bundle cards, and consistent controls.
- Added signed in-app NSIS update download and installation with progress feedback, passive Windows installation, and release manifest generation.
- Restored saved-view queries and advanced filters when reopened, persisted browser-preview export history, and linked every ready dataset directly into a scoped search.
- Hardened cleanup against active indexing and added proof that only named generated folders can be removed while source files remain untouched.
- Exposed the native audited identity split workflow through selectable member rows and a compact Shadcn action.
- Added a separate local search-history cleanup action that preserves saved views.

## 0.1.6 - 2026-07-28

- Rebuilt Search, Domains, Identities, Datasets, and Settings on one consistent Shadcn component system with a deeper neutral dark theme and compact source-location typography.
- Replaced the search viewport illusion with real result rows, explicit first/previous/page/next/last controls, and configurable 25–200 row pages.
- Made plain Contains search the default, simplified the search prompt, and moved advanced mode, dataset, field, and sort controls into a compact optional section.
- Batch-loaded search hits and domain record fields to remove per-result SQLite queries.
- Added paginated parent domains, paginated source-line evidence, clickable hostname filters, server-side hostname prefix lookup, and lazy repair of missing legacy breach-dataset counts.
- Added a manual identity builder that searches local records, keeps selections across pages, names reviewed bundles, and displays manual and automatic identities in a compact bento collection.
- Changed automatic identities to materialize only after an exact email, phone, or service-scoped ID repeats, avoiding millions of useless singleton groups on large imports.
- Fixed automatic identity rebuilding while preserving reviewed links, and paginated identity members instead of loading entire groups at once.
- Separated dataset status and Resume actions, and added smoothed records-per-second and bytes-per-second indexing telemetry.
- Reworked Settings with clear appearance, performance presets, privacy controls, local storage status, network boundary, cleanup confirmation, and a persistent save bar.
- Added a composite domain lookup index, identity candidates, domain repair markers, and regression coverage for paging, manual identities, automatic rebuilds, settings persistence, and linked evidence.

## 0.1.5 - 2026-07-28

- Made resource-protection settings save atomically and refresh immediately, added a disabled inactivity-lock option, and expanded the real per-import memory budget to 4 GiB.
- Connected the worker limit to Tantivy writer threads, connected the memory limit to writer and batch budgets, and prevented competing imports from fighting over one local index.
- Added resumable cancelled and interrupted imports with persisted plans, source validation, plain-file byte seeking, compressed-file replay protection, and duplicate-safe checkpoints.
- Recover stale queued, running, paused, and cancelling jobs on startup so datasets no longer remain incorrectly marked as indexing after the app or computer stops.
- Keep dataset record totals current during indexing so dashboard counts and the index-growth chart update while work is running.
- Added optional GitHub release checks and an in-app update notification without sending dataset paths, names, queries, or record information.
- Added 25, 50, 100, and 200-row search pages with visible page counts, ranges, navigation, consistent source-location typography, and surfaced search errors.
- Fixed exact quoted-value handling and made exact bare-domain lookup work through Domain or URL filters while using authoritative linked-record counts.
- Added masked field contents to domain record drilldowns so each source line shows useful evidence instead of only a line number.
- Added a bounded, idempotent identity rebuild for already indexed records, clearer member inspection, and removal of empty identity groups.
- Added regression coverage for cancelled-import resume, masked domain evidence, identity rebuilding, search pagination, and the updated review workflow.

## 0.1.4 - 2026-07-28

- Fixed exact domain searches so a bare domain, `domain:` query, or Domain field filter resolves domains extracted from both URL and domain fields.
- Added a searchable domain explorer with parent-domain pagination, hostname evidence, linked breach-dataset filters, and paginated source-record drilldown.
- Added incremental record-to-hostname, record-to-parent, and per-dataset domain aggregates so domain lookup avoids full-workspace record scans.
- Explained in the interface that identity groups are created automatically during import using strict normalized email, phone, and service-scoped ID rules.
- Moved identity list, member, and review work off the command thread and bounded the initial group view for large workspaces.
- Extended 64-bit resource-math coverage and the configurable generated-stream soak ceiling to 4 TiB while preserving fixed memory ceilings, pause, and cancellation behavior.
- Expanded the 100,000-record generated full-index soak to cover URL extraction and incremental domain aggregates.
- Added changelog-backed GitHub release notes that identify the recommended setup executable and list every addition and change.

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
