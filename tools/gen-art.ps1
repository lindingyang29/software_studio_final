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

# ---- player2.png : 40x40 orange runner cube (P2) ----
$bmp, $g = New-Canvas 40 40
$body = New-Object System.Drawing.SolidBrush (C 255 255 150 50)
$g.FillRectangle($body, 3, 3, 34, 34)
$edge = New-Object System.Drawing.Pen (C 255 255 220 150), 3
$g.DrawRectangle($edge, 3, 3, 34, 34)
$visor = New-Object System.Drawing.SolidBrush (C 255 255 250 230)
$g.FillRectangle($visor, 18, 10, 14, 7)
$dark = New-Object System.Drawing.SolidBrush (C 255 110 50 10)
$g.FillRectangle($dark, 8, 24, 24, 8)
$g.Dispose(); $bmp.Save("$out\player2.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- drone.png : 36x36 red patrol drone (cross blades + core) ----
$bmp, $g = New-Canvas 36 36
$blade = New-Object System.Drawing.SolidBrush (C 255 255 80 80)
$g.FillRectangle($blade, 15, 1, 6, 34)
$g.FillRectangle($blade, 1, 15, 34, 6)
$rot = New-Object System.Drawing.Drawing2D.Matrix
$rot.RotateAt(45, (New-Object System.Drawing.PointF 18, 18))
$g.Transform = $rot
$blade2 = New-Object System.Drawing.SolidBrush (C 200 255 120 90)
$g.FillRectangle($blade2, 15, 3, 6, 30)
$g.FillRectangle($blade2, 3, 15, 30, 6)
$g.ResetTransform()
$core = New-Object System.Drawing.SolidBrush (C 255 120 10 30)
$g.FillEllipse($core, 9, 9, 18, 18)
$corePen = New-Object System.Drawing.Pen (C 255 255 200 200), 2
$g.DrawEllipse($corePen, 9, 9, 18, 18)
$g.Dispose(); $bmp.Save("$out\drone.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- shield.png : 54x54 cyan ring (also the on-player effect) ----
$bmp, $g = New-Canvas 54 54
$pen = New-Object System.Drawing.Pen (C 230 120 220 255), 4
$g.DrawEllipse($pen, 4, 4, 46, 46)
$pen2 = New-Object System.Drawing.Pen (C 120 200 240 255), 2
$g.DrawEllipse($pen2, 9, 9, 36, 36)
$g.Dispose(); $bmp.Save("$out\shield.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- slow.png : 34x34 purple hourglass ----
$bmp, $g = New-Canvas 34 34
$fill = New-Object System.Drawing.SolidBrush (C 255 170 140 255)
$top = @(
    (New-Object System.Drawing.PointF 5, 3),
    (New-Object System.Drawing.PointF 29, 3),
    (New-Object System.Drawing.PointF 17, 17)
)
$bot = @(
    (New-Object System.Drawing.PointF 17, 17),
    (New-Object System.Drawing.PointF 5, 31),
    (New-Object System.Drawing.PointF 29, 31)
)
$g.FillPolygon($fill, $top)
$g.FillPolygon($fill, $bot)
$pen = New-Object System.Drawing.Pen (C 255 240 230 255), 2
$g.DrawPolygon($pen, $top)
$g.DrawPolygon($pen, $bot)
$g.Dispose(); $bmp.Save("$out\slow.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- magnet.png : 34x34 yellow U-magnet ----
$bmp, $g = New-Canvas 34 34
$pen = New-Object System.Drawing.Pen (C 255 255 230 110), 8
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Flat
$g.DrawArc($pen, 6, 6, 22, 22, 180, 180)
$g.DrawLine($pen, 7, 17, 7, 28)
$g.DrawLine($pen, 27, 17, 27, 28)
$tip = New-Object System.Drawing.SolidBrush (C 255 240 240 250)
$g.FillRectangle($tip, 3, 26, 9, 6)
$g.FillRectangle($tip, 23, 26, 9, 6)
$g.Dispose(); $bmp.Save("$out\magnet.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# ---- tport.png : 52x52 swirl (teleporter) ----
$bmp, $g = New-Canvas 52 52
$pen = New-Object System.Drawing.Pen (C 255 255 255 255), 5
$g.DrawArc($pen, 4, 4, 44, 44, 0, 250)
$pen2 = New-Object System.Drawing.Pen (C 220 255 255 255), 3
$g.DrawArc($pen2, 13, 13, 26, 26, 120, 250)
$core = New-Object System.Drawing.SolidBrush (C 255 255 255 255)
$g.FillEllipse($core, 22, 22, 8, 8)
$g.Dispose(); $bmp.Save("$out\tport.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

Write-Output "art done"
Get-ChildItem $out -Filter *.png | Select-Object Name, Length
