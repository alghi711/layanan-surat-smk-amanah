Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-LocalBackupRoot {
    $backupRoot = Join-Path $dataDir 'backups'
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    return $backupRoot
}

function Get-LocalBackupMetadata([string]$backupId) {
    if ($backupId -notmatch '^amanah-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$') { throw 'Backup tidak ditemukan.' }
    $backupRoot = Get-LocalBackupRoot
    $metaPath = Join-Path $backupRoot ($backupId + '.json')
    $zipPath = Join-Path $backupRoot ($backupId + '.zip')
    if (-not (Test-Path -LiteralPath $metaPath) -or -not (Test-Path -LiteralPath $zipPath)) { throw 'Backup tidak ditemukan.' }
    return [IO.File]::ReadAllText($metaPath) | ConvertFrom-Json
}

function Get-LocalBackupList {
    $backupRoot = Get-LocalBackupRoot
    $backups = @(Get-ChildItem -LiteralPath $backupRoot -File -Filter '*.json' | Where-Object { $_.BaseName -match '^amanah-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$' } | Sort-Object Name -Descending | Select-Object -First 20 | ForEach-Object { Get-LocalBackupMetadata $_.BaseName })
    return $backups
}

function Add-LocalBackupEntry($archive, [string]$name, [string]$filePath) {
    $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Fastest)
    $output = $entry.Open()
    $input = [IO.File]::OpenRead($filePath)
    try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
    return @{ path = $name; size = ([IO.FileInfo]$filePath).Length; sha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() }
}

function New-LocalBackup {
    $backupRoot = Get-LocalBackupRoot
    $backupId = 'amanah-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + ([Guid]::NewGuid().ToString('N').Substring(0,8))
    $partial = Join-Path $backupRoot ('.' + $backupId + '.partial')
    $snapshot = Join-Path $backupRoot ('.' + $backupId + '.jsonl.tmp')
    $archive = $null
    try {
        $records = @(Read-Database)
        $lines = foreach ($record in $records) {
            $submitted = [DateTimeOffset]::Parse($record.submittedAt).UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss.ffffff')
            $updated = if ($record.updatedAt) { [DateTimeOffset]::Parse($record.updatedAt).UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss.ffffff') } else { $submitted }
            @{ tracking_code = $record.code; record = $record; submitted_at = $submitted; updated_at = $updated } | ConvertTo-Json -Depth 40 -Compress
        }
        [IO.File]::WriteAllText($snapshot, (($lines -join "`n") + $(if ($records.Count) { "`n" } else { '' })), $utf8)
        $archive = [IO.Compression.ZipFile]::Open($partial, [IO.Compression.ZipArchiveMode]::Create)
        $entries = @(Add-LocalBackupEntry $archive 'applications.jsonl' $snapshot)
        $entries += Add-LocalBackupEntry $archive 'schema.sql' (Join-Path $root 'wasmer-edge\schema.sql')
        $uploads = @{}
        foreach ($record in $records) {
            foreach ($mapping in @(@('documentPath','documents'),@('letterPath','letters'),@('originalLetterPath','letters'))) {
                $name = [string]$record.($mapping[0])
                if (-not $name) { continue }
                if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Referensi dokumen backup tidak valid.' }
                $path = Join-Path (Join-Path $dataDir $mapping[1]) $name
                if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Ada dokumen yang hilang; backup lengkap belum dapat dibuat.' }
                $uploads['uploads/' + $mapping[1] + '/' + $name] = $path
            }
        }
        foreach ($name in ($uploads.Keys | Sort-Object)) { $entries += Add-LocalBackupEntry $archive $name $uploads[$name] }
        $createdAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        $manifest = @{ format = 'smk-amanah-backup'; version = 1; createdAt = $createdAt; applicationCount = $records.Count; documentCount = $uploads.Count; snapshotRevision = ''; files = $entries }
        $manifestEntry = $archive.CreateEntry('manifest.json')
        $writer = [IO.StreamWriter]::new($manifestEntry.Open(), $utf8)
        try { $writer.Write(($manifest | ConvertTo-Json -Depth 40)) } finally { $writer.Dispose() }
        $archive.Dispose(); $archive = $null
        $zipPath = Join-Path $backupRoot ($backupId + '.zip')
        [IO.File]::Move($partial, $zipPath)
        $metadata = @{ id = $backupId; createdAt = $createdAt; applicationCount = $records.Count; documentCount = $uploads.Count; bytes = ([IO.FileInfo]$zipPath).Length; sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() }
        [IO.File]::WriteAllText((Join-Path $backupRoot ($backupId + '.json')), ($metadata | ConvertTo-Json -Compress), $utf8)
        return $metadata
    } finally {
        if ($archive) { $archive.Dispose() }
        foreach ($temporary in @($partial,$snapshot)) { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    }
}
