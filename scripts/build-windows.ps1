$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $hashBytes = $sha256.ComputeHash($stream)
        return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$localSigningKey = Join-Path $env:USERPROFILE ".tauri\aletheia.key"
$signingEnabled =
    -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY) -or
    -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH) -or
    (Test-Path -LiteralPath $localSigningKey -PathType Leaf)
$requireSignedUpdater = $env:ALETHEIA_REQUIRE_SIGNED_UPDATE -eq "1"

if (-not $version) {
    throw "package.json does not contain a version."
}
if ($requireSignedUpdater -and -not $signingEnabled) {
    throw "A signed updater artifact is required, but no Tauri updater key is configured."
}

Push-Location $projectRoot
try {
    & node "scripts/verify-release-version.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Release version validation failed."
    }

    & powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/generate-installer-assets.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "Installer asset generation failed."
    }

    if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
        if (-not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
            $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH -Raw
        }
        elseif (Test-Path -LiteralPath $localSigningKey -PathType Leaf) {
            $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $localSigningKey -Raw
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
        $storedSigningPassword = [Environment]::GetEnvironmentVariable(
            "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
            "User"
        )
        if (-not [string]::IsNullOrWhiteSpace($storedSigningPassword)) {
            $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $storedSigningPassword
        }
    }

    $buildArguments = @("tauri", "build")
    if ($signingEnabled) {
        $buildArguments += @("--config", "src-tauri/tauri.updater.conf.json")
    }
    & pnpm @buildArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed."
    }

    $targetRoot = Join-Path $projectRoot "src-tauri/target/release"
    $setupSource = Join-Path $targetRoot "bundle/nsis/Aletheia_${version}_x64-setup.exe"
    $setupSignatureSource = "$setupSource.sig"
    $msiSource = Join-Path $targetRoot "bundle/msi/Aletheia_${version}_x64_en-US.msi"
    $standaloneSource = Join-Path $targetRoot "aletheia.exe"
    $releaseRoot = Join-Path $projectRoot "release"

    $requiredFiles = @($setupSource, $msiSource, $standaloneSource)
    if ($signingEnabled) {
        $requiredFiles += $setupSignatureSource
    }
    foreach ($requiredFile in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Expected build output is missing: $requiredFile"
        }
    }

    Add-Type -AssemblyName System.Drawing
    foreach ($iconBearingExecutable in @($standaloneSource, $setupSource)) {
        $embeddedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($iconBearingExecutable)
        if ($null -eq $embeddedIcon -or $embeddedIcon.Width -lt 16 -or $embeddedIcon.Height -lt 16) {
            throw "Executable is missing its embedded application icon: $iconBearingExecutable"
        }
        $embeddedBitmap = $embeddedIcon.ToBitmap()
        try {
            $transparentPixels = 0
            for ($y = 0; $y -lt $embeddedBitmap.Height; $y++) {
                for ($x = 0; $x -lt $embeddedBitmap.Width; $x++) {
                    if ($embeddedBitmap.GetPixel($x, $y).A -eq 0) {
                        $transparentPixels++
                    }
                }
            }
            if ($transparentPixels -eq 0) {
                throw "Executable icon lost transparency during resource embedding: $iconBearingExecutable"
            }
        }
        finally {
            $embeddedBitmap.Dispose()
            $embeddedIcon.Dispose()
        }
    }

    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $releaseRoot -File |
        Where-Object {
            $_.Name -like "aletheia_*" -or
            $_.Name -eq "SHA256SUMS.txt" -or
            $_.Name -eq "notes-preview.md" -or
            $_.Name -eq "latest.json"
        } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

    $setupName = "aletheia_${version}_x64-setup.exe"
    $setupSignatureName = "$setupName.sig"
    $standaloneName = "aletheia_${version}_x64.exe"
    $msiName = "aletheia_${version}_x64.msi"

    Copy-Item -LiteralPath $setupSource -Destination (Join-Path $releaseRoot $setupName) -Force
    Copy-Item -LiteralPath $standaloneSource -Destination (Join-Path $releaseRoot $standaloneName) -Force
    Copy-Item -LiteralPath $msiSource -Destination (Join-Path $releaseRoot $msiName) -Force

    $checksumFiles = @($setupName, $standaloneName, $msiName)
    if ($signingEnabled) {
        $signatureDestination = Join-Path $releaseRoot $setupSignatureName
        Copy-Item -LiteralPath $setupSignatureSource -Destination $signatureDestination -Force
        $latestJson = [ordered]@{
            version = $version
            notes = "Signed Aletheia Windows update. See the release notes for changes."
            pub_date = (Get-Date).ToUniversalTime().ToString("o")
            platforms = [ordered]@{
                "windows-x86_64" = [ordered]@{
                    signature = (Get-Content -LiteralPath $setupSignatureSource -Raw).Trim()
                    url = "https://github.com/xtofuub/Aletheia/releases/download/v$version/$setupName"
                }
            }
        }
        $latestJsonPath = Join-Path $releaseRoot "latest.json"
        $latestJsonText = $latestJson | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText(
            $latestJsonPath,
            "$latestJsonText$([Environment]::NewLine)",
            [System.Text.UTF8Encoding]::new($false)
        )
        $checksumFiles += @($setupSignatureName, "latest.json")
    }
    $checksums = foreach ($fileName in $checksumFiles) {
        $hash = Get-Sha256Hex (Join-Path $releaseRoot $fileName)
        "$hash  $fileName"
    }
    Set-Content -LiteralPath (Join-Path $releaseRoot "SHA256SUMS.txt") -Value $checksums -Encoding ascii

    if ($signingEnabled) {
        & node "scripts/verify-updater-artifacts.mjs"
        if ($LASTEXITCODE -ne 0) {
            throw "Signed updater artifact validation failed."
        }
        & cargo test --manifest-path "src-tauri/Cargo.toml" --test updater_signature signed_updater_matches_embedded_public_key -- --ignored --exact
        if ($LASTEXITCODE -ne 0) {
            throw "The updater signature does not match Aletheia's embedded public key."
        }
    }

    Write-Host "Windows release artifacts:"
    Get-ChildItem -LiteralPath $releaseRoot -File | Select-Object Name, Length
}
finally {
    Pop-Location
}
