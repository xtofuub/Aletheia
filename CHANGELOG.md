# Changelog

## Unreleased

## 0.1.9 - 2026-08-12

- Fixed Live scan progress jumping backwards when startup and parallel-worker events arrive out of order, and kept throughput/ETA stable across pauses.
- Made pause, resume, and cancel acknowledge immediately across Search and Identity Builder while preventing a second scan during cancellation.
- Moved large-folder discovery off the command thread, applied the saved worker limit to Search, Domains, and Identities, and added a first-match fast-stop option.
- Debounced Domains and subdomain filters and removed stale linked-evidence placeholders that caused results to flicker between domain selections.

## 0.1.8 - 2026-08-10

- Added on-demand domain scanning across one saved Live source or all saved Live sources, including TXT, GZIP, ZIP, and RAR content without extraction.
- Added reusable Live-domain collections that deduplicate and store up to 5,000 matching source lines locally with file, archive-entry, location, query, and match provenance.
- Updated Domains with scan throughput, progress, stored-collection navigation, paginated Live evidence, and long-line wrapping alongside existing indexed evidence.
- Updated Search to show indexed and Live source counts separately and added a single **All saved Live sources** option with deduplicated paths.
- Added a versioned SQLite migration, generated-workspace cleanup support, Rust regression coverage, browser workflow coverage, and a refreshed README with current product screenshots.

## 0.1.7 - 2026-08-10

- Removed identifier masking across Search, Live scans, Domains, Identities, previews, and exports; complete non-secret values are shown while reusable secret fields are excluded instead of rendered as placeholders.
- Tightened the full-workspace UI audit: domain evidence now adapts without overlapping, empty charts and saved views offer direct next steps, activity charts use honest scales, and resource copy is easier to scan.
- Added completed Live scans to Overview metrics, charts, recent sources, and activity so the dashboard no longer reports only indexed evidence.
- Made Identity Builder reuse saved Live folders and archives from Datasets, with automatic source selection and no repeated folder picker.
- Restored Search to a compact single-line indexed query bar, kept the multiline batch composer only for saved Live sources, and added clear source-specific Search/Scan loading states.
- Bumped the next Windows build to 0.1.7 and made NSIS recreate legacy shortcuts with a dedicated transparent icon resource, then notify Explorer so stale desktop and Start Menu icon caches are refreshed.
- Re-encoded Windows ICO frames as alpha-preserving bitmaps and added a release-build check that fails if the standalone executable regresses to an opaque black icon background.
- Fixed stuck single-writer locks by guaranteeing import-job cleanup even if a background worker exits unexpectedly, and restored active indexing telemetry after page navigation so pause, continue, and cancel remain available.
- Prevented a second index workflow from opening while an import or cancellation is active, replaced the technical writer error with actionable guidance, and made cancellation state immediate and explicit.
- Rebuilt Review import around a dedicated scrollable file table so every selected or recursively discovered file is visible before indexing, with totals, relative paths, formats, estimated rows, and skipped-file feedback.
- Added native and browser coverage proving that Index folder recursively discovers supported files in subfolders while leaving archives for the Live scan workflow.
- Added persistent, removable Live-source catalogs and merged indexed lookup and live scanning into one source-aware Search workflow; source removal never deletes original files.
- Replaced implementation-facing redaction wording in Search with a neutral protected-value marker and constrained indexed and direct-scan tables so long fields, paths, excerpts, and match values wrap without overlapping adjacent content.
- Rebuilt the desktop, taskbar, installer, and in-app logo assets with a transparent canvas and an 87.5% mark footprint so the Aletheia symbol matches normal Windows icon sizing without a black tile.
- Added automatic signed GitHub update detection with an in-app approval dialog, verified download progress, passive installation, and application relaunch; release CI now fails closed without signing material and validates updater artifacts before publishing.
- Added one-pass batch Live scan for up to 512 values, pause and resume controls, physical-source progress, decoded throughput, and ETA so very large TXT, ZIP, RAR, and GZIP collections remain observable without indexing.
- Added explicit Fast and Relationship index profiles, generated storage estimates, HDD-aware worker guidance, and scalable synthetic performance soaks for large-corpus validation.
- Switched imported record keys to time-ordered UUIDv7 values, folded dataset counters into batch transactions, and tuned bounded SQLite cache/WAL windows to reduce write amplification during multi-million-row imports.
- Enlarged the dashboard brand mark and tightened the Windows icon artwork so Aletheia stays legible in the sidebar, title bar, taskbar, and installer.
- Added reviewed identity bundles built directly from live TXT, ZIP, RAR, and GZIP scan results, preserving selected masked source snapshots without requiring a full persistent index.
- Fixed streamed live-search batches disappearing on completion and paginated direct-scan result rendering so thousands of matches do not freeze the interface.
- Detects index-only workspaces whose SQLite dataset catalog is missing, explains that localhost shows sample data only, and confirms workspace switches before previously indexed datasets disappear from view.
- Redesigned the dataset entry point as two clean Shadcn workflow cards, removed the gray action footers and duplicated header buttons, and made live scan versus persistent indexing easier to understand.
- Replaced the old application mark with the supplied Aletheia artwork, regenerated every Windows icon asset, and integrated branded minimize, maximize, and close controls into the frameless app shell.
- Added flexible first/last-name lookup across separate fields and common email separators for both Tantivy search and direct file scans.
- Added safe dataset removal that deletes only generated SQLite and Tantivy data, blocks removal during active work, and proves the original source remains untouched.
- Made live scanning the recommended path for multi-million-row, multi-gigabyte, HDD, ZIP, RAR, and GZIP sources; added clear throughput, loading, resume, removal, and long-running workflow feedback.
- Rebuilt the README around current product screenshots, large-source guidance, normal-user installation, and the live-scan versus persistent-index decision.
- Capped index-growth bars so single-dataset workspaces stay readable while preserving the chart's hover detail.
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
