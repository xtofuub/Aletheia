$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconRoot = Join-Path $projectRoot "src-tauri/icons"
$sourcePath = Join-Path $iconRoot "aletheia-logo.png"
$preparedPath = Join-Path $iconRoot "app-icon-source.png"
$publicPath = Join-Path $projectRoot "public/aletheia-logo.png"
$canvasSize = 1024
$targetCoverage = 0.875
$alphaThreshold = 8

Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
    $minX = $source.Width
    $minY = $source.Height
    $maxX = -1
    $maxY = -1

    for ($y = 0; $y -lt $source.Height; $y++) {
        for ($x = 0; $x -lt $source.Width; $x++) {
            if ($source.GetPixel($x, $y).A -le $alphaThreshold) {
                continue
            }
            $minX = [Math]::Min($minX, $x)
            $minY = [Math]::Min($minY, $y)
            $maxX = [Math]::Max($maxX, $x)
            $maxY = [Math]::Max($maxY, $y)
        }
    }

    if ($maxX -lt $minX -or $maxY -lt $minY) {
        throw "The logo source has no visible pixels."
    }

    $contentWidth = $maxX - $minX + 1
    $contentHeight = $maxY - $minY + 1
    $targetSize = [Math]::Round($canvasSize * $targetCoverage)
    $scale = [Math]::Min($targetSize / $contentWidth, $targetSize / $contentHeight)
    $drawWidth = [Math]::Round($contentWidth * $scale)
    $drawHeight = [Math]::Round($contentHeight * $scale)
    $drawX = [Math]::Round(($canvasSize - $drawWidth) / 2)
    $drawY = [Math]::Round(($canvasSize - $drawHeight) / 2)

    $canvas = New-Object System.Drawing.Bitmap(
        $canvasSize,
        $canvasSize,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($canvas)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $destination = New-Object System.Drawing.Rectangle($drawX, $drawY, $drawWidth, $drawHeight)
            $graphics.DrawImage(
                $source,
                $destination,
                $minX,
                $minY,
                $contentWidth,
                $contentHeight,
                [System.Drawing.GraphicsUnit]::Pixel
            )
        }
        finally {
            $graphics.Dispose()
        }
        $canvas.Save($preparedPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $canvas.Dispose()
    }
}
finally {
    $source.Dispose()
}

Copy-Item -LiteralPath $preparedPath -Destination $publicPath -Force
Push-Location $projectRoot
try {
    & pnpm tauri icon $preparedPath --output $iconRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri icon generation failed."
    }

    $windowsIconPath = Join-Path $iconRoot "icon.ico"
    & cargo run --quiet --manifest-path "src-tauri/Cargo.toml" --example windows_icon_compat -- $windowsIconPath $windowsIconPath
    if ($LASTEXITCODE -ne 0) {
        throw "Windows-compatible ICO conversion failed."
    }
}
finally {
    Pop-Location
}

Write-Host "Generated transparent Aletheia icons with bitmap ICO frames and an 87.5% mark footprint."
