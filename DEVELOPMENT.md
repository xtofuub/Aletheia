# Development

## Layout

```text
src/                    React and TypeScript interface
src-tauri/src/          Rust commands and services
src-tauri/migrations/   SQLite migrations
src-tauri/benches/      Criterion benchmarks
tests/fixtures/         Invented test-only sources
e2e/                    Playwright browser flows
docs/                   Product and workflow documentation
scripts/                Safety and screenshot utilities
```

## Prerequisites

Install Node.js 24+, Rust stable, WebView2, and Visual Studio 2022 Build Tools with the C++ workload. Run native commands from an x64 Visual Studio developer shell so `link.exe` is available.

## Common commands

```powershell
npm install
npm run dev
npm run tauri dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run tauri build
npm run safety
```

Rust:

```powershell
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo bench --bench core_benchmarks
```

## Change discipline

Keep source access read-only. Do not log values. Use reserved domains, documentation IP ranges, and invented names in fixtures and screenshots. Add a migration rather than editing an already released schema. Preserve bounded-memory behavior and cancellation checks when changing import code.

## Native command boundary

TypeScript declarations live in `src/lib/desktop.ts`. Rust request and response models live in `src-tauri/src/models.rs`. Keep their camel-case serialized shapes aligned. Browser fallbacks exist only for frontend tests and use synthetic values.
