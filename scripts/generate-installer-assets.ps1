$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "src-tauri\icons\app-icon-source.png"
$outputRoot = Join-Path $projectRoot "src-tauri\windows"
$sidebarPath = Join-Path $outputRoot "installer-sidebar.bmp"
$headerPath = Join-Path $outputRoot "installer-header.bmp"

function New-Canvas([int]$width, [int]$height) {
  return [System.Drawing.Bitmap]::new(
    $width,
    $height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
}

function New-Graphics([System.Drawing.Bitmap]$bitmap) {
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  return $graphics
}

$logo = [System.Drawing.Image]::FromFile($sourcePath)

try {
  $sidebar = New-Canvas 164 314
  $sidebarGraphics = New-Graphics $sidebar
  try {
    $bounds = [System.Drawing.Rectangle]::new(0, 0, 164, 314)
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      $bounds,
      [System.Drawing.Color]::FromArgb(255, 7, 8, 10),
      [System.Drawing.Color]::FromArgb(255, 18, 20, 24),
      90.0
    )
    $sidebarGraphics.FillRectangle($background, $bounds)
    $background.Dispose()

    $accent = [System.Drawing.SolidBrush]::new(
      [System.Drawing.Color]::FromArgb(255, 37, 215, 194)
    )
    $mutedAccent = [System.Drawing.SolidBrush]::new(
      [System.Drawing.Color]::FromArgb(35, 37, 215, 194)
    )
    $sidebarGraphics.FillEllipse($mutedAccent, 106, -30, 105, 105)
    $sidebarGraphics.FillRectangle($accent, 26, 236, 28, 3)

    $sidebarGraphics.DrawImage($logo, 41, 44, 82, 82)

    $titleFont = [System.Drawing.Font]::new("Segoe UI Semibold", 13.0)
    $captionFont = [System.Drawing.Font]::new("Segoe UI", 7.5)
    $detailFont = [System.Drawing.Font]::new("Segoe UI", 8.0)
    $white = [System.Drawing.SolidBrush]::new(
      [System.Drawing.Color]::FromArgb(255, 248, 250, 252)
    )
    $muted = [System.Drawing.SolidBrush]::new(
      [System.Drawing.Color]::FromArgb(255, 156, 163, 175)
    )
    $sidebarGraphics.DrawString("ALETHEIA", $titleFont, $white, 25, 150)
    $sidebarGraphics.DrawString("LOCAL EVIDENCE", $captionFont, $muted, 27, 177)
    $sidebarGraphics.DrawString("Private by design", $detailFont, $white, 25, 248)
    $sidebarGraphics.DrawString("Indexed on your device", $captionFont, $muted, 25, 267)

    $sidebar.Save($sidebarPath, [System.Drawing.Imaging.ImageFormat]::Bmp)

    $accent.Dispose()
    $mutedAccent.Dispose()
    $titleFont.Dispose()
    $captionFont.Dispose()
    $detailFont.Dispose()
    $white.Dispose()
    $muted.Dispose()
  }
  finally {
    $sidebarGraphics.Dispose()
    $sidebar.Dispose()
  }

  $header = New-Canvas 150 57
  $headerGraphics = New-Graphics $header
  try {
    $headerBounds = [System.Drawing.Rectangle]::new(0, 0, 150, 57)
    $headerBackground = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      $headerBounds,
      [System.Drawing.Color]::FromArgb(255, 7, 8, 10),
      [System.Drawing.Color]::FromArgb(255, 20, 22, 27),
      0.0
    )
    $headerGraphics.FillRectangle($headerBackground, $headerBounds)
    $headerBackground.Dispose()
    $headerGraphics.DrawImage($logo, 11, 10, 37, 37)

    $headerTitleFont = [System.Drawing.Font]::new("Segoe UI Semibold", 10.5)
    $headerCaptionFont = [System.Drawing.Font]::new("Segoe UI", 6.5)
    $headerWhite = [System.Drawing.SolidBrush]::new(
      [System.Drawing.Color]::FromArgb(255, 248, 250, 252)
    )
    $headerMuted = [System.Drawing.SolidBrush]::new(
      [System.Drawing.Color]::FromArgb(255, 156, 163, 175)
    )
    $headerGraphics.DrawString("Aletheia", $headerTitleFont, $headerWhite, 54, 12)
    $headerGraphics.DrawString("LOCAL WORKSPACE", $headerCaptionFont, $headerMuted, 55, 31)
    $header.Save($headerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)

    $headerTitleFont.Dispose()
    $headerCaptionFont.Dispose()
    $headerWhite.Dispose()
    $headerMuted.Dispose()
  }
  finally {
    $headerGraphics.Dispose()
    $header.Dispose()
  }
}
finally {
  $logo.Dispose()
}

Write-Host "Generated branded NSIS installer assets."
