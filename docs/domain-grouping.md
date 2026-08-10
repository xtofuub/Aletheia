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
and paginated source records with complete non-secret field contents. Secret
fields are excluded. Hostname chips are
clickable evidence filters, and the hostname search is applied in SQLite with a
bounded result limit. These links are materialized incrementally during import
so opening a domain does not scan the full workspace. Older URL links and
missing per-dataset counts are repaired locally once when that domain is
requested.

The same page can run a bounded containment scan over one saved Live source or
all saved Live sources. A completed scan stores up to 5,000 deduplicated source
line snapshots, including file, archive entry, location, and match reason, in
local SQLite under the normalized parent domain. These reusable Live
collections do not create Tantivy documents or modify the selected sources.

No DNS request or remote enrichment occurs.
