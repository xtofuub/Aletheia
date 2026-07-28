# UI guidelines

## Direction

Aletheia uses a clean professional dashboard structure adapted from the referenced shadcn dashboard: inset application frame, persistent navigation, compact top command bar, dense aligned tables, and restrained panels.

The product identity remains “Obsidian Signal”: graphite surfaces, fine neutral borders, cool cyan for primary actions, green for verified local protections, violet only for identity analysis, and red only for destructive actions.

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

## Density

Tables use 38–64 px rows depending on content. Result virtualization assumes 54 px rows. Panels use compact 8–16 px internal spacing and one-pixel borders. Minimum desktop viewport is 1100×700; the sidebar collapses at narrower widths.
