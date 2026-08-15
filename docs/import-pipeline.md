# Import pipeline

```text
read-only source
  -> canonical path and metadata verification
  -> 256 KiB bounded detection sample
  -> complete non-secret preview and user-approved mapping
  -> background job with pause/cancel control
  -> bounded line decoding and parsing
  -> field normalization and secret replacement
  -> BLAKE3 record fingerprint
  -> batched SQLite traceability writes
  -> Tantivy safe-field document
  -> URL/domain materialization
  -> deterministic identity materialization
  -> sanitized report and progress event
```

Sources are rejected if they disappear or change size between inspection and import. **Index folder** recursively discovers supported TXT, CSV, TSV, JSONL, NDJSON, LOG, and GZIP files in subfolders without following links. Review import lists every discovered file before work begins. ZIP and RAR archives remain available through the saved Live-source workflow instead of persistent indexing. Parsing is line-oriented and bounded. Severe limit violations stop the job when the safe default is enabled; malformed rows can otherwise be counted and skipped.

SQLite is authoritative for metadata and analysis. Tantivy stores record IDs plus safe normalized search values. Secret originals are replaced before either store is written.

Cancellation is checked between records and while paused. Completed batches remain valid and traceable; source files are never rolled back because they are never modified. Cancelled and interrupted jobs can resume after source-size validation. Plain files seek to the last stored byte offset; compressed files replay safely to the last stored line without reinserting it.

The background importer uses its own SQLite WAL connection. Dashboard reads therefore do not wait behind a long import transaction, and completed or failed jobs stop their high-frequency UI polling automatically.

## Index profiles

- **Fast index** is the default for smaller databases that need repeated search. It indexes approved safe fields and stores traceable source offsets, but skips deduplication, URL/domain grouping, and automatic identity grouping.
- **Deep analysis** enables exact-record deduplication, normalized URL/domain links, and deterministic identity groups. Choose it when those investigation views justify the extra write and CPU cost.

Profile options remain visible and can be changed before the job starts. SQLite record, field, and duplicate statements are prepared once per batch instead of once per record.

For lookup over a very large folder or archive, save it as a **Live source** on the Datasets page and choose it in Search. The small source catalog persists, but scans create neither record rows nor a Tantivy index.

## Very large datasets

Input size is tracked with 64-bit counters, including multi-terabyte sources. Plain and GZIP sources are read through a 64 KiB buffer, never loaded as a whole. A record may contain at most 1 MiB; an oversized record is drained in chunks so even a malformed file with no newline cannot grow the process heap without bound. Cancellation and pause checks continue while that record is drained.

The configured memory limit controls two independent budgets:

- Tantivy writer memory: 64 MiB–2 GiB
- pending SQLite/Tantivy record batch: 4–64 MiB, with a 10,000-record ceiling

The worker setting controls one Tantivy writer's indexing threads; Aletheia permits one active import so multiple jobs cannot contend for the same index writer. Search-index commits and sanitized SQLite checkpoints occur after at least 250,000 new records and 15 seconds, no later than 1,000,000 records, at each file boundary, and on graceful cancellation. Prepared SQLite statements are reused across each batch, and normalized field lookup is served by Tantivy instead of duplicate SQLite indexes. Tantivy documents contain the record ID, dataset filter, exact normalized values, stored safe values used for verification, and deduplicated bigram/trigram terms for Contains lookup. Secret fields never enter those terms. Older generated Tantivy schemas are rebuilt locally from SQLite into a temporary index and atomically swapped. Identity and domain grouping are incremental, so their memory use does not grow with dataset size.

Hundreds-of-gigabytes and terabyte-scale imports remain dependent on local SSD throughput, record shape, and free space. The generated SQLite and Tantivy stores can be larger than the source, especially when records contain many searchable fields. Put the workspace on a fast local volume with substantial headroom; network shares and nearly-full system drives are poor targets. Aletheia guarantees bounded processing, not a fixed completion time on every drive.
