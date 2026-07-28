# Security

## Trust boundary

Aletheia is a local desktop application. Dataset contents, paths, queries, indexes, identity links, notes, and exports are processed on the user's computer. Core data workflows contain no outbound network client or credential-testing capability.

## Source protection

- Sources are canonicalized and opened with `File::open`, never a write handle.
- Directory discovery does not follow symbolic links and is depth- and count-limited.
- An import is rejected when a source changes between inspection and indexing.
- Cleanup accepts only fixed generated directory names directly below the canonical storage root.
- Cleanup never traverses or deletes a source-file path stored in SQLite.

## Resource limits

- detection sample: 256 KiB;
- preview: at most 20 masked rows;
- import line: 1 MiB;
- field: 256 KiB;
- fields per record: 256;
- discovered files: 10,000;
- directory depth: 32;
- decompression: at most 100× the compressed size, with a 64 MiB minimum ceiling;
- query: 512 characters;
- result page: at most 200 records;
- exported selection: at most 100,000 records.

## Sensitive data

Passwords, password hashes, and salts are replaced with `[REDACTED]` plus a one-way BLAKE3 comparison fingerprint before storage. They never enter the general Tantivy index or redacted export. Email local parts and phone values are masked in result views. Address and date-of-birth fields are excluded or redacted by strict export defaults.

Logs and user-facing failures contain operation categories, not raw records.

## Reporting

Do not include datasets, records, credentials, file paths, or exported findings in a security report. Reproduce issues with the synthetic fixtures under `tests/fixtures`. Report the affected version, operating system, exact safe steps, and expected versus actual behavior.

## Non-goals

Aletheia does not provide credential validation, automated login, remote enrichment, scraping, dataset acquisition, or user-to-user collaboration.
