# Domain grouping

Aletheia normalizes HTTP and HTTPS URLs by:

- lowercasing and IDNA-normalizing the hostname;
- removing a trailing dot;
- preserving explicit ports as metadata;
- preserving the path;
- recording query keys but removing query values;
- removing credentials and fragments from the normalized URL;
- recording whether a fragment existed.

The bundled Public Suffix List determines the registrable parent. Aletheia therefore groups `portal.example.co.uk` under `example.co.uk`, not `co.uk`. IP addresses remain their own parent and are not passed through suffix heuristics.

The domain explorer has a local prefix search for parent domains and observed
hostnames. Selecting a parent shows its hostnames, every linked breach dataset,
and paginated source records with masked field contents. Hostname chips are
clickable evidence filters, and the hostname search is applied in SQLite with a
bounded result limit. These links are materialized incrementally during import
so opening a domain does not scan the full workspace. Older URL links and
missing per-dataset counts are repaired locally once when that domain is
requested.

No DNS request or remote enrichment occurs.
