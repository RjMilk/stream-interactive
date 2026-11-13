# Рисует иконку программы build/icon.ico (256x256, PNG внутри ICO). Запуск: powershell -File build/make-icon.ps1
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)

# Скруглённый квадрат с розово-фиолетовым градиентом, как плашки в оверлее
$r = 56
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
$path.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $size - $r - 1, $r, $r, 90, 90)
$path.CloseFigure()
$rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 255, 40, 120)), ([System.Drawing.Color]::FromArgb(255, 120, 40, 255)), 45
$g.FillPath($brush, $path)

# Прицел и молния: «помеха поверх игры»
$white = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 14
$g.DrawEllipse($white, 48, 48, 160, 160)
$g.DrawLine($white, 128, 24, 128, 72); $g.DrawLine($white, 128, 184, 128, 232)
$g.DrawLine($white, 24, 128, 72, 128); $g.DrawLine($white, 184, 128, 232, 128)
$bolt = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 142, 70), (New-Object System.Drawing.Point 98, 138), (New-Object System.Drawing.Point 126, 138),
  (New-Object System.Drawing.Point 112, 190), (New-Object System.Drawing.Point 160, 116), (New-Object System.Drawing.Point 132, 116))
$g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 233, 74))), $bolt)
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()

# ICO: заголовок (6 байт) + одна запись каталога (16 байт) + PNG
$out = Join-Path $PSScriptRoot 'icon.ico'
$fs = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
$w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0)
$w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
$w.Write($png)
$w.Close()
$bmp.Save((Join-Path $PSScriptRoot 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
"icon.ico: $($png.Length + 22) байт"
