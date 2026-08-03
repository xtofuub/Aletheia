# Security

## Trust boundary

Aletheia is a local desktop application. Dataset contents, paths, queries, indexes, identity links, notes, and exports are processed on the user's computer. Core data workflows contain no outbound network client or credential-testing capability. The optional updater is restricted to the official signed Aletheia release endpoint, verifies the installer signature before installation, and sends no workspace information.

## Source protection

- Sources are canonicalized and opened with `File::open`, never a write handle.
- Directory discovery does not follow symbolic links and is depth- and count-limited.
- An import is rejected when a source changes between inspection and indexing.
- Cleanup accepts only fixed generated directory names directly below the canonical storage root.
- Cleanup never traverses or deletes a source-file path stored in SQLite.
- Live search streams ZIP and RAR entries to bounded readers and never writes extracted members to disk.
- Encrypted RAR text entries, unsafe ZIP paths, excessive archive entry counts, and excessive declared decompression are rejected.

## Resource limits

- detection sample: 256 KiB;
- preview: at most 20 masked rows;
- import line: 1 MiB;
- field: 256 KiB;
- fields per record: 256;
- discovered files: 10,000;
- directory depth: 32;
- indexed GZIP decompression: at most 100x the compressed size, with a 64 MiB minimum ceiling;
- live ZIP/RAR declared decompression: at most 250x compressed size, with an 8 GiB minimum ceiling;
- live archive entries: 100,000 maximum;
- live result cap: 5,000;
- query: 512 characters;
- result page: at most 200 records;
- exported selection: at most 100,000 records.

## Sensitive data

Passwords, password hashes, and salts are replaced with `[REDACTED]` plus a one-way BLAKE3 comparison fingerprint before storage. They never enter the general Tantivy index or redacted export. Email local parts and phone values are masked in result views. Address and date-of-birth fields are excluded or redacted by strict export defaults.

Logs and user-facing failures contain operation categories, not raw records.

Domain line previews use the same masking rules as search results. Identity rebuilding reads only already indexed local fields and remains bounded to 10,000-row transactions.

## Reporting

Do not include datasets, records, credentials, file paths, or exported findings in a security report. Reproduce issues with the synthetic fixtures under `tests/fixtures`. Report the affected version, operating system, exact safe steps, and expected versus actual behavior.

## Non-goals

Aletheia does not provide credential validation, automated login, remote enrichment, scraping, dataset acquisition, or user-to-user collaboration.
