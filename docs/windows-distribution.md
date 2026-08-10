# Windows distribution

## Recommended download

Ordinary users should install Aletheia from the project’s GitHub Releases page:

1. Download `aletheia_<version>_x64-setup.exe`.
2. Run the setup program.
3. Start Aletheia from the Start Menu.

The NSIS setup executable is the primary Windows release. It installs for the current user, creates a Start Menu shortcut, registers an uninstaller in Windows Settings, and silently installs or updates the Microsoft Edge WebView2 Runtime when required. Rust, Cargo, Node.js, npm, and Visual Studio build tools are not needed.

The setup executable may require internet access if WebView2 is missing because it uses Microsoft’s Evergreen bootstrapper. Windows 10 and 11 normally already include WebView2.

## Other release files

- `aletheia_<version>_x64.exe` is the standalone binary. Keep it for smoke testing and diagnostics; normal users should use setup. It does not create shortcuts or an uninstaller and expects a compatible WebView2 Runtime.
- `aletheia_<version>_x64.msi` is retained as an alternate enterprise deployment artifact.
- `aletheia_<version>_x64-setup.exe.sig` lets the in-app updater verify the NSIS installer.
- `latest.json` is the signed update manifest consumed by installed copies of Aletheia.

Installed copies check this signed manifest after startup when automatic checks are enabled. If a newer version exists, Aletheia shows an approval dialog with release notes. The app downloads nothing until the user selects **Update and restart**. It then verifies the installer signature, installs in passive mode, and relaunches itself. The same workflow is available manually under Settings.

- `SHA256SUMS.txt` contains SHA-256 checksums for every binary artifact.

Release binaries are currently unsigned. Windows SmartScreen may show an unrecognized-app warning until the project uses a trusted code-signing certificate. Verify the checksum and download only from the official repository.

## Local release build

Builds require Windows 10 or 11, Node.js 24 or newer, Rust stable with the MSVC target, Visual Studio C++ Build Tools, and WebView2:

```powershell
pnpm install --frozen-lockfile
pnpm dist:windows
```

The script checks that the versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` match. Tauri produces the application and bundles, then the script copies consistently named deliverables to `release/`:

```text
aletheia_<version>_x64-setup.exe
aletheia_<version>_x64-setup.exe.sig
aletheia_<version>_x64.exe
aletheia_<version>_x64.msi
latest.json
SHA256SUMS.txt
```

`release/` and native build output are excluded from Git.

Maintainer builds use the updater key at `%USERPROFILE%\.tauri\aletheia.key` when it exists. Other source builds remain normal development builds and do not need the updater private key. Never commit or share the private key.

## Publishing a GitHub release

1. Update the same semantic version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Update `CHANGELOG.md`.
3. Run all quality gates and `pnpm dist:windows`.
4. Commit and push the release changes.
5. Create and push a matching tag, such as `v0.1.0`.

The `Windows release` GitHub Actions workflow repeats the quality gates on a clean Windows runner, builds the installers, preserves all artifacts, and publishes the tagged GitHub release. The tag must exactly match the configured version.

The repository must define `TAURI_SIGNING_PRIVATE_KEY` as a GitHub Actions secret. The release workflow now fails closed when that key is missing. The optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret is needed only when the updater key has a password. Losing this key prevents future installed versions from accepting updates signed by a replacement key.

Do not commit generated release files, datasets, indexes, exports, secrets, or local application state.
