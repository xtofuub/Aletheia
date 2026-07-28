# Import pipeline

```text
read-only source
  -> canonical path and metadata verification
  -> 256 KiB bounded detection sample
  -> masked preview and user-approved mapping
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

Sources are rejected if they disappear or change size between inspection and import. Directory discovery does not follow links. Parsing is line-oriented and bounded. Severe limit violations stop the job when the safe default is enabled; malformed rows can otherwise be counted and skipped.

SQLite is authoritative for metadata and analysis. Tantivy stores record IDs plus safe normalized search values. Secret originals are replaced before either store is written.

Cancellation is checked between records and while paused. Completed batches remain valid and traceable; source files are never rolled back because they are never modified.
