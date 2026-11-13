#!/usr/bin/env pwsh
# Odrezy z animovanej cesty (kollar.html) cez headless Edge.
# Použitie: powershell -ExecutionPolicy Bypass -File tools/kollar_shots.ps1
param(
  [string[]]$U = @("0.06", "0.20", "0.46", "0.58", "0.80", "0.95"),
  [int]$Cam = 0,
  [int]$Budget = 4000,
  [string]$Out = "$env:TEMP\kollar_shots",
  [int]$Size = 1200
)

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { "Edge sa nenašiel"; exit 1 }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$i = 0
foreach ($u in $U) {
  $i++
  $tag = ($u -replace '\.', '_')
  $png = Join-Path $Out "u$tag.png"
  $profile = "$env:TEMP\edge_kollar_$i"
  $url = "http://127.0.0.1:8811/kollar.html?start=1&pause=1&shot=1&u=$u&cam=$Cam&t=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  Remove-Item $png -Force -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $edge -ArgumentList '--headless=new','--disable-gpu','--enable-unsafe-swiftshader',
    '--hide-scrollbars',"--window-size=$Size,700","--screenshot=$png","--virtual-time-budget=$Budget",
    "--user-data-dir=$profile", $url -PassThru -RedirectStandardOutput "$Out\edge$i.log" -RedirectStandardError "$Out\edge$i.err"
  $p.WaitForExit(240000) | Out-Null
  $sw.Stop()
  if (Test-Path $png) { "OK  u=$u cam=$Cam -> $((Get-Item $png).Length) B  [$([int]$sw.Elapsed.TotalSeconds) s]" } else { "FAIL u=$u cam=$Cam [$([int]$sw.Elapsed.TotalSeconds) s]" }
  Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
}
