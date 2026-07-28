# Identity grouping

Automatic identity links use deterministic keys only:

- exact normalized email;
- exact normalized phone;
- exact user ID scoped to its source service boundary.

Usernames, similar names, shared domains, and fuzzy text never cause an automatic merge.

When **Identity grouping** is enabled in the import options, Aletheia creates
these groups automatically as records are indexed. “Automatic” describes the
strict rule that created the link; it is not a confidence guess and it does not
contact an external service.

Each membership records a link type, confidence score, machine-readable explanation, and user review status. The interface shows the masked group label, reason, member count, and confidence.

Users can confirm or reject memberships, merge complete groups, or select records to split into a reviewed group. Every change appends an audit event. Undo appends another event and restores the prior membership state; audit history is never rewritten.
