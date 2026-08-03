# Data Formats

## Safely inspected local sample

`E:\848.txt` was inspected through a read-only file handle. A 256 KiB maximum prefix and 2,048 non-empty lines were used for aggregate detection, which is less than 0.01 percent of the file. No source value was printed, copied, logged, committed, or used in a fixture.

Detected properties:

- Size: 3,816,025,927 bytes at inspection time
- Encoding: valid UTF-8 without a byte-order mark in the inspected prefix
- Line endings: CRLF
- Primary structure: heterogeneous, newline-delimited, single-value records
- Common inferred value type: email-like
- Secondary shape: opaque single values that must stay `unknown` until the user maps them
- Preamble: fixed-width, pipe-framed display/header lines
- Delimiter decision: no stable record delimiter was found; pipe characters belong primarily to the preamble and must not cause the whole file to be classified as pipe-delimited
- Header decision: the pipe-framed prefix is presentation noise, not a reliable tabular header
- Safety decision: default to the raw-line parser with one `value` column, conservative type inference, and a user-confirmed mapping

This conclusion is intentionally conservative. Aletheia must let the user override the parser and field mapping before indexing.

## MVP formats

| Format         | Detection                          | Parser                                        |
| -------------- | ---------------------------------- | --------------------------------------------- |
| TXT            | content and extension              | bounded line stream, configurable delimiter   |
| CSV            | stable comma counts and quoting    | Rust CSV reader                               |
| TSV            | stable tab counts                  | Rust CSV reader with tab delimiter            |
| JSONL / NDJSON | one JSON object per non-empty line | streaming JSON object parser                  |
| GZIP           | magic bytes `1f 8b`                | bounded decompression into a supported parser |

## Direct live search

The Search page can scan supported text files without importing them. It also streams `.gz`, `.zip`, and `.rar` sources read-only. ZIP and RAR members are filtered to supported text extensions and decoded directly into bounded line readers; no member is written to disk.

Live archive protections include a 100,000-entry ceiling, a bounded decompression ratio, a 1 MiB line limit, a 5,000-result cap, cancellation, path validation, and rejection of encrypted RAR text entries. Split or unsupported RAR variants fail with a sanitized message. Re-running a live query scans the chosen sources again; build a Fast index when repeated searches justify the storage cost.

Extensions are hints only. Content detection wins when they disagree.

## Detection limits

- Sample bytes: 256 KiB maximum
- Preview records: 20 maximum
- Line bytes: configurable, 1 MiB default
- Fields per record: 256 maximum
- Field bytes: 256 KiB maximum
- JSON nesting: 32 levels maximum
- Decompression ratio and output: bounded by configured limits

## Synthetic fixtures

All fixtures under `tests/fixtures` are invented. They use `example.com`, `example.net`, `example.org`, `.test`, and documentation IP address ranges. Tests never open `E:\848.txt`.
