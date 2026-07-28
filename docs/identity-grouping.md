# Identity grouping

Automatic identity links use deterministic keys only:

- exact normalized email;
- exact normalized phone;
- exact user ID scoped to its source service boundary.

Usernames, similar names, shared domains, and fuzzy text never cause an automatic merge.

When **Identity grouping** is enabled in the import options, Aletheia tracks
exact candidates as records are indexed. A visible automatic group is created
only when the same deterministic identifier appears in at least two records.
This avoids creating singleton groups for every unique value. “Automatic”
describes the strict rule that created the link; it is not a confidence guess
and it does not contact an external service.

The **Rebuild groups** action applies the same rules to already indexed records. It is idempotent, processes local fields in bounded batches, preserves existing review states, and removes empty groups left by prior merge or split actions.

Each membership records a link type, confidence score, machine-readable explanation, and user review status. The interface shows the masked group label, reason, member count, and confidence.

The manual builder accepts a normal local search. Users select two or more
matching records, name the bundle, and create a confirmed identity containing
only those selected records. Member lists are paginated.

Users can confirm or reject automatic memberships and merge complete groups.
Every change appends an audit event. Undo appends another event and restores the
prior membership state; audit history is never rewritten.
