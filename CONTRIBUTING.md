# Contributing

1. Create focused changes that leave the application runnable.
2. Use only invented synthetic fixtures.
3. Do not add telemetry, remote enrichment, credential testing, login automation, or dataset acquisition.
4. Keep file inspection and imports read-only.
5. Preserve masking, traceability, bounded-memory behavior, and cleanup guards.
6. Update documentation and tests with behavior changes.
7. Run all gates in [TESTING.md](TESTING.md).

Before committing:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm safety
```

Then run Rust formatting, tests, and Clippy from `src-tauri`.

Security reports must use synthetic reproduction data and follow [SECURITY.md](SECURITY.md).
