# Search syntax

## Modes

- **Exact** matches a complete normalized field value. A bare domain or
  `domain:` query also matches hostnames extracted from URLs and their
  registrable parent.
- **Contains** performs a bounded literal substring match over complete safe indexed values and requires at least two characters.
- **Prefix** matches safe indexed values beginning with the query.

Queries are limited to 512 characters. Plain searches start in **Contains**
mode. Choose 25, 50, 100, or 200 records per page; the result range, editable
page number, and first/previous/next/last navigation remain visible below the
result table.

The field selector applies the same structured prefix internally, so choosing
**Domain** with `example.com` is equivalent to `domain:example.com`.

## Structured fields

Use `field:value`:

```text
email:analyst@example.com
domain:example.co.uk
url:https://portal.example.com/login
ip_address:198.51.100.25
user_id:svc-1001
```

Supported structured fields include email, username, name, phone, IP address, domain, URL, location, company, job title, user ID, timestamp, and explicitly approved unknown text.

Password, password-hash, and salt fields cannot be searched. Regex and fuzzy secret search are intentionally unavailable.

## Results

Every result includes dataset, source file, consistently formatted source location, parser, match reason, and masked fields. Search failures are shown instead of being presented as empty results. Select explicit records to export them through the strict redaction pipeline. Saved views keep the query and filters only in local SQLite.
