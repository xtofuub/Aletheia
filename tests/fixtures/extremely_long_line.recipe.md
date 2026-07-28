# Extremely long line fixture recipe

Tests construct a line containing 1,048,577 `x` characters in memory, followed by CRLF. Keeping the generated line out of Git prevents accidental large-file patterns while still testing the configured 1 MiB limit.
