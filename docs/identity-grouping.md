# Identity grouping

Automatic identity links use deterministic keys only:

- exact normalized email;
- exact normalized phone;
- exact user ID scoped to its source service boundary.

Usernames, similar names, shared domains, and fuzzy text never cause an automatic merge.

When **Identity grouping** is enabled in the import options, Aletheia tracks
exact candidates as records are indexed. A visible automatic group is created
only when the same deterministic identifier appears in at least two records.
This avoids creating singleton groups for every unique value. "Automatic"
describes the strict rule that created the link; it is not a confidence guess
and it does not contact an external service.

The identity catalog is searched and paginated by the local SQLite backend.
All stored groups remain reachable; the interface loads 25 at a time and
preloads the next page instead of imposing a fixed catalog limit.

The **Rebuild groups** action applies the same rules to already indexed records. It is idempotent, processes local fields in bounded batches, preserves existing review states, and removes empty groups left by prior merge or split actions.

Each membership records a link type, confidence score, machine-readable explanation, and user review status. Member evidence is shown as a compact delimited row instead of separate field badges. Complete non-secret identifiers are available for local review; passwords, tokens, cookies, API keys, and other reusable secrets remain excluded.

The manual builder accepts a normal local search. Users select two or more
matching records, name the bundle, and create a confirmed identity containing
only those selected records. Member lists are paginated.

The same builder can run a read-only live scan across large text files and
compressed archives. Users may select two or more returned rows and persist
only those bounded, secret-filtered evidence snapshots in the identity. This does not
create a Tantivy index, extract an archive, or modify the source. Indexed and
live evidence may also be combined in one reviewed bundle.

Users can confirm or reject automatic memberships, merge complete groups, or select individual member rows and split them into a new reviewed identity. Every action can be undone from the identity workspace.
Every change appends an audit event. Undo appends another event and restores the
prior membership state; audit history is never rewritten.
