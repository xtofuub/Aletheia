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

if (-not $version) {
    throw "package.json does not contain a version."
}

Push-Location $projectRoot
try {
    & node "scripts/verify-release-version.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Release version validation failed."
    }

    & npm run tauri build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed."
    }

    $targetRoot = Join-Path $projectRoot "src-tauri/target/release"
    $setupSource = Join-Path $targetRoot "bundle/nsis/Aletheia_${version}_x64-setup.exe"
    $msiSource = Join-Path $targetRoot "bundle/msi/Aletheia_${version}_x64_en-US.msi"
    $standaloneSource = Join-Path $targetRoot "aletheia.exe"
    $releaseRoot = Join-Path $projectRoot "release"

    foreach ($requiredFile in @($setupSource, $msiSource, $standaloneSource)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Expected build output is missing: $requiredFile"
        }
    }

    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

    $setupName = "aletheia_${version}_x64-setup.exe"
    $standaloneName = "aletheia_${version}_x64.exe"
    $msiName = "aletheia_${version}_x64.msi"

    Copy-Item -LiteralPath $setupSource -Destination (Join-Path $releaseRoot $setupName) -Force
    Copy-Item -LiteralPath $standaloneSource -Destination (Join-Path $releaseRoot $standaloneName) -Force
    Copy-Item -LiteralPath $msiSource -Destination (Join-Path $releaseRoot $msiName) -Force

    $checksumFiles = @($setupName, $standaloneName, $msiName)
    $checksums = foreach ($fileName in $checksumFiles) {
        $hash = Get-Sha256Hex (Join-Path $releaseRoot $fileName)
        "$hash  $fileName"
    }
    Set-Content -LiteralPath (Join-Path $releaseRoot "SHA256SUMS.txt") -Value $checksums -Encoding ascii

    Write-Host "Windows release artifacts:"
    Get-ChildItem -LiteralPath $releaseRoot -File | Select-Object Name, Length
}
finally {
    Pop-Location
}
