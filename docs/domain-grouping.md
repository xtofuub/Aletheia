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

The domain explorer shows parent domains, public suffixes, subdomain counts, hostnames, and observed record totals. No DNS request or remote enrichment occurs.
