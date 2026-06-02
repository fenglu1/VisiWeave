param(
  [switch]$Detached,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path -LiteralPath ".env") -and (Test-Path -LiteralPath ".env.example")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Created .env from .env.example. Fill local secrets there if needed."
}

docker compose config --quiet --no-env-resolution

$composeArgs = @("compose", "up")
if (-not $SkipBuild) {
  $composeArgs += "--build"
}
if ($Detached) {
  $composeArgs += "-d"
}

& docker @composeArgs
