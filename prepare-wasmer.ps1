$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$target = Join-Path $projectRoot 'wasmer-edge\app'
New-Item -ItemType Directory -Force -Path $target | Out-Null

$extensions = @('.html', '.css', '.js')
Get-ChildItem -LiteralPath $projectRoot -File | Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Force
}

$assetSource = Join-Path $projectRoot 'assets'
if (Test-Path -LiteralPath $assetSource) {
    $assetTarget = Join-Path $target 'assets'
    New-Item -ItemType Directory -Force -Path $assetTarget | Out-Null
    Copy-Item -Path (Join-Path $assetSource '*') -Destination $assetTarget -Recurse -Force
}

Write-Host "Aset halaman tersinkron ke $target"
$signingSource = Join-Path $projectRoot 'private\signing'
if (Test-Path -LiteralPath $signingSource) {
    $signingTarget = Join-Path $projectRoot 'wasmer-edge\config\authorization'
    New-Item -ItemType Directory -Force -Path $signingTarget | Out-Null
    Copy-Item -LiteralPath (Join-Path $signingSource 'signature.png'), (Join-Path $signingSource 'stamp.png') -Destination $signingTarget -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'wasmer-edge\schema.sql') -Destination (Join-Path $projectRoot 'wasmer-edge\config\schema.sql') -Force
$supabaseSchema = [IO.File]::ReadAllText((Join-Path $projectRoot 'supabase\schema.sql')) + "`n" + [IO.File]::ReadAllText((Join-Path $projectRoot 'supabase\backend.sql'))
[IO.File]::WriteAllText((Join-Path $projectRoot 'wasmer-edge\config\schema-supabase.sql'), $supabaseSchema, [Text.UTF8Encoding]::new($false))
Write-Host 'Folder data lokal tidak disalin ke paket Wasmer.'
