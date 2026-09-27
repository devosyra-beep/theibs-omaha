$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
$stageRoot = Join-Path $project '.release-webapp'
$stage = Join-Path $stageRoot 'THEIBS-WebApp'
$zip = Join-Path (Split-Path -Parent $project) "THEIBS-WebApp-$version.zip"

$projectFull = [IO.Path]::GetFullPath($project).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$stageFull = [IO.Path]::GetFullPath($stageRoot)
if (-not $stageFull.StartsWith($projectFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Diretório temporário fora do projeto.' }
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($directory in @('public', 'src', 'data', 'supabase')) { Copy-Item -LiteralPath (Join-Path $project $directory) -Destination $stage -Recurse }
foreach ($file in @('server.js', 'webapp.js', 'package.json', 'Iniciar-THEIBS-WebApp.cmd', 'LEIA-ME-WEBAPP.md', 'DEPLOY-SAAS.md', '.env.example')) {
  Copy-Item -LiteralPath (Join-Path $project $file) -Destination $stage
}
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
Write-Output $zip
