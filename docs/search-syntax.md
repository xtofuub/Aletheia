# Search

## Automatic mode

Automatic mode is the default. Enter a value normally; no field prefix is required. Aletheia recognizes email addresses, domains, URLs, IP addresses, phone numbers, service IDs, and person names, then chooses a safe field and match strategy. Other input is treated as text or a username.

Indexed searches try normalized exact matching first for identifiers and fall back to literal containment when needed. Live domain searches use containment because a domain may be embedded in an email address, URL, or subdomain. A full search starts only when the user presses the Search button. Selecting a Live source runs one bounded, read-only preflight sample of at most 64 MiB so the interface can show a realistic full-scan range before starting; it never scans the whole source on each keystroke.

Contains searches split a likely person name into meaningful tokens. A query such as `Jane Doe` can therefore match separate first/last-name fields or common email-local-part separators such as `jane.doe`, `jane_doe`, and `jane-doe`. All name tokens must be present; token order does not matter.

## Search scopes

- **Indexed** searches an existing Tantivy index. Use it for fast repeated queries, paging, saved views, export, domain analysis, and identity grouping.
- **Saved Live source** scans cataloged TXT, CSV, TSV, JSONL, NDJSON, LOG, GZIP, ZIP, and RAR paths directly. Archives are streamed in memory and are never extracted beside the source. Saving a source records only its local paths and preferences; removing it does not touch the original data.

The Search page uses one query control and one source selector. Choosing an indexed dataset or saved Live source automatically selects the matching engine. The selector reports indexed and Live counts separately and includes an **All saved Live sources** option that deduplicates their selected paths before scanning.

Live scans expose a result limit, 1-8 match workers, archive inclusion, case sensitivity, throughput, decompressed bytes scanned, source progress, pause/resume/cancel controls, and paginated results. Preflight reports total supported bytes, sampled source read speed, archive count, expected minimum/maximum duration, the likely bottleneck, and a source-specific worker recommendation. Physical source reading stays sequential to avoid HDD seek thrash; large plain files can distribute matching across CPU workers through a bounded queue. One huge archive is processed by one decoder worker. The native scanner searches each plain byte block once, resolves line boundaries only after a match, coalesces result batches to the display refresh rate, and stores ordered byte/result checkpoints locally. After an unexpected close, Continue skips completed files and resumes an unchanged plain file from the latest safe newline boundary; the current compressed archive restarts because compressed streams are not safely seekable.

## Advanced mode

- **Exact** matches a complete normalized field value. A bare domain or
  `domain:` query also matches hostnames extracted from URLs and their
  registrable parent.
- **Contains** intersects indexed bigram/trigram candidates and verifies the complete normalized safe values before returning results; it requires at least two characters and never exposes n-gram false positives.
- **Prefix** matches safe indexed values beginning with the query.

Queries are limited to 512 characters. Choose 25, 50, 100, or 200 records per page; the result range, editable
page number, and first/previous/next/last navigation remain visible below the
result table.

The field selector applies the same structured prefix internally, so choosing
**Domain** with `example.com` is equivalent to `domain:example.com`.

## Structured fields

Advanced indexed searches may also use `field:value`:

```text
email:analyst@example.com
domain:example.co.uk
url:https://portal.example.com/login
ip_address:198.51.100.25
user_id:svc-1001
```

Supported structured fields include email, username, name, phone, IP address, domain, URL, location, company, job title, user ID, timestamp, and explicitly approved unknown text.

Password, password-hash, and salt fields cannot be searched. Regex and fuzzy secret search are intentionally unavailable.

## Results

Every result includes dataset, source file, consistently formatted source location, parser, match reason, and complete non-secret fields. Secret fields are excluded. Search failures are shown instead of being presented as empty results. Select explicit records to export them through the protected export pipeline. Saved views keep the query and filters only in local SQLite.

Opening a saved view restores its Automatic/Advanced mode, match mode, dataset, indexed field, and sort order. Ready datasets also link directly to Advanced search with that dataset already selected.
