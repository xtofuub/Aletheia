# Identity grouping

Automatic identity links use deterministic keys only:

- exact normalized email;
- exact normalized phone;
- exact user ID scoped to its source service boundary.

Usernames, similar names, shared domains, and fuzzy text never cause an automatic merge.

Each membership records a link type, confidence score, machine-readable explanation, and user review status. The interface shows the masked group label, reason, member count, and confidence.

Users can confirm or reject memberships, merge complete groups, or select records to split into a reviewed group. Every change appends an audit event. Undo appends another event and restores the prior membership state; audit history is never rewritten.
