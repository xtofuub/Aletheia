# Privacy

Aletheia is designed around local processing and data minimization.

## Data that remains local

- source paths and source metadata;
- normalized record fields and BLAKE3 fingerprints;
- SQLite metadata and Tantivy index segments;
- search queries and saved views;
- domain and identity groups;
- notes, tags, audit events, and export history;
- redacted export files and manifests.

The application has no analytics or telemetry. It does not measure or transmit record contents, searched values, file paths, dataset names, or exports.

If automatic update checks are enabled, Aletheia requests only the latest release metadata from the official GitHub repository. The request contains the current app version in its user agent and no workspace information. Update checks can be disabled in Settings.

## Masking

Detection previews are masked in Rust before they reach React. Search results mask emails, phones, secrets, and other sensitive values. Export defaults are stricter: secret fields are omitted, sensitive fields are masked or removed, and a sidecar manifest records the redaction policy without values.

## Retention

Generated data remains until the user clears an index, clears all generated state, or removes the chosen workspace manually. Cleanup does not remove source files or exports saved outside the workspace.

## Clipboard and lock settings

The interface exposes local clipboard-clear and inactivity-lock policy values for the desktop workflow. The inactivity lock can be disabled. These settings are stored locally. No policy value is transmitted.
