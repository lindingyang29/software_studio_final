# Generates neon-style placeholder art for GravityRunner into resources/textures.
Add-Type -AssemblyName System.Drawing

$out = "C:\Users\lindi\Desktop\claude_code_and_codex\software_final_project\GravityRunner\assets\resources\textures"
New-Item -ItemType Directory -Force $out | Out-Null

function New-Canvas([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    return @($bmp, $g)
}
function C([int]$a, [int]$r, [int]$g, [int]$b) { [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }

# ---- white.png : generic 8x8 tintable rect ----
$bmp, $g = New-Canvas 8 8
$g.Clear((C 255 255 255 255))
$g.Dispose(); $bmp.Save("$out\white.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- player.png : 40x40 cyan runner cube with visor ----
$bmp, $g = New-Canvas 40 40
$body = New-Object System.Drawing.SolidBrush (C 255 38 200 220)
$g.FillRectangle($body, 3, 3, 34, 34)
$edge = New-Object System.Drawing.Pen (C 255 150 250 255), 3
$g.DrawRectangle($edge, 3, 3, 34, 34)
$visor = New-Object System.Drawing.SolidBrush (C 255 240 255 255)
$g.FillRectangle($visor, 18, 10, 14, 7)
$dark = New-Object System.Drawing.SolidBrush (C 255 10 60 80)
$g.FillRectangle($dark, 8, 24, 24, 8)
$g.Dispose(); $bmp.Save("$out\player.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- spike.png : 48x40 magenta triangle (points up) ----
$bmp, $g = New-Canvas 48 40
$pts = @(
    (New-Object System.Drawing.PointF 24, 2),
    (New-Object System.Drawing.PointF 2, 38),
    (New-Object System.Drawing.PointF 46, 38)
)
$fill = New-Object System.Drawing.SolidBrush (C 255 255 59 141)
$g.FillPolygon($fill, $pts)
$pen = New-Object System.Drawing.Pen (C 255 255 154 196), 2
$g.DrawPolygon($pen, $pts)
$g.Dispose(); $bmp.Save("$out\spike.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- crystal.png : 32x32 cyan diamond ----
$bmp, $g = New-Canvas 32 32
$pts = @(
    (New-Object System.Drawing.PointF 16, 1),
    (New-Object System.Drawing.PointF 31, 16),
    (New-Object System.Drawing.PointF 16, 31),
    (New-Object System.Drawing.PointF 1, 16)
)
$fill = New-Object System.Drawing.SolidBrush (C 255 127 247 255)
$g.FillPolygon($fill, $pts)
$pen = New-Object System.Drawing.Pen (C 255 255 255 255), 2
$g.DrawPolygon($pen, $pts)
$inner = New-Object System.Drawing.SolidBrush (C 180 220 255 255)
$ipts = @(
    (New-Object System.Drawing.PointF 16, 8),
    (New-Object System.Drawing.PointF 24, 16),
    (New-Object System.Drawing.PointF 16, 24),
    (New-Object System.Drawing.PointF 8, 16)
)
$g.FillPolygon($inner, $ipts)
$g.Dispose(); $bmp.Save("$out\crystal.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- glow.png : 96x96 radial white glow ----
$bmp, $g = New-Canvas 96 96
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddEllipse(0, 0, 96, 96)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
$pgb.CenterColor = C 170 255 255 255
$pgb.SurroundColors = @((C 0 255 255 255))
$g.FillEllipse($pgb, 0, 0, 96, 96)
$g.Dispose(); $bmp.Save("$out\glow.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- portal.png : 96x160 orange ring ----
$bmp, $g = New-Canvas 96 160
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(4, 4, 88, 152)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
$pgb.CenterColor = C 90 255 200 120
$pgb.SurroundColors = @((C 0 255 181 74))
$g.FillEllipse($pgb, 4, 4, 88, 152)
$ring = New-Object System.Drawing.Pen (C 255 255 181 74), 7
$g.DrawEllipse($ring, 12, 10, 72, 140)
$ring2 = New-Object System.Drawing.Pen (C 255 255 226 176), 2
$g.DrawEllipse($ring2, 20, 18, 56, 124)
$g.Dispose(); $bmp.Save("$out\portal.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- bg.png : 960x640 dark gradient + grid + stars ----
$bmp, $g = New-Canvas 960 640
$rect = New-Object System.Drawing.Rectangle 0, 0, 960, 640
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (C 255 10 14 42), (C 255 34 16 64), 90.0)
$g.FillRectangle($grad, $rect)
$gridPen = New-Object System.Drawing.Pen (C 26 42 60 255), 1
for ($x = 0; $x -le 960; $x += 64) { $g.DrawLine($gridPen, $x, 0, $x, 640) }
for ($y = 0; $y -le 640; $y += 64) { $g.DrawLine($gridPen, 0, $y, 960, $y) }
$rand = New-Object System.Random(42)
for ($i = 0; $i -lt 90; $i++) {
    $sx = $rand.Next(0, 960); $sy = $rand.Next(0, 640)
    $alpha = $rand.Next(40, 160); $size = $rand.Next(1, 3)
    $star = New-Object System.Drawing.SolidBrush (C $alpha 220 235 255)
    $g.FillRectangle($star, $sx, $sy, $size, $size)
    $star.Dispose()
}
$g.Dispose(); $bmp.Save("$out\bg.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

Write-Output "art done"
Get-ChildItem $out -Filter *.png | Select-Object Name, Length
