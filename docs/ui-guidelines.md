# UI guidelines

## Direction

Aletheia uses a clean professional dashboard structure adapted from Efferd Dashboard 2: an edge-to-edge workbench, persistent navigation, compact route bar, dense aligned tables, sharp operational grids, and restrained panels.

`@efferd/dashboard-2` is the canonical composition base. New product surfaces start with its `DashboardCard` and one-pixel `DashboardGrid` pattern, then adapt the content to investigation workflows. They must not introduce a separate card language.

The product identity uses neutral white and near-black surfaces, fine borders, green only for verified local signals, orange only for limited overview emphasis, and red only for destructive actions. It avoids decorative gradients, oversized marketing copy, and unrelated card styles.

## Rules

- Prefer alignment, separators, and typography over grids of decorative cards.
- Keep source traceability visible beside each result.
- Mask sensitive values by default and pair privacy state with text or icons.
- Use monospace for IDs, paths, locations, queries, and counts.
- Keep primary actions singular and clear.
- Require a second deliberate action for destructive cleanup.
- Preserve keyboard navigation, visible focus, semantic headings, labels, and live progress.
- Respect `prefers-reduced-motion`; motion is brief and functional.
- Empty states explain the next safe action and the local privacy boundary.
- Use the shared Shadcn primitives for buttons, tabs, selects, switches, badges, alerts, and tables.
- Build page sections from the registry-installed `src/components/dashboard-card.tsx` and the one-pixel grid pattern; extend the base only when the data model requires it.
- Keep operational grids square or subtly rounded; use small radii only for compact controls.

## Density

Tables use 38-64 px rows depending on content. Result pages show 25-200 records with explicit pagination. Panels use compact 8-16 px internal spacing and one-pixel borders. Minimum desktop viewport is 1100x700; the sidebar collapses at narrower widths.
