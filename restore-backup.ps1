param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [string]$ExpectedSha256 = '',
    [string]$ExtractTo = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedSha256 -and ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $archiveHash -cne $ExpectedSha256.ToLowerInvariant())) { throw 'Checksum arsip tidak cocok. Jangan pulihkan backup ini.' }
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)

function Read-EntryText($entry) {
    $reader = [IO.StreamReader]::new($entry.Open(), $utf8, $true)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Get-EntryDigest($entry, [long]$expectedSize) {
    $input = $entry.Open()
    $hash = [Security.Cryptography.SHA256]::Create()
    $buffer = New-Object byte[] 65536
    $total = [long]0
    try {
        while (($count = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt $expectedSize) { throw 'Ukuran isi backup melebihi manifest.' }
            [void]$hash.TransformBlock($buffer, 0, $count, $buffer, 0)
        }
        [void]$hash.TransformFinalBlock((New-Object byte[] 0), 0, 0)
        if ($total -ne $expectedSize) { throw 'Ukuran isi backup tidak sesuai manifest.' }
        return ([BitConverter]::ToString($hash.Hash)).Replace('-','').ToLowerInvariant()
    } finally { $input.Dispose(); $hash.Dispose() }
}

function Sql-Hex([string]$value) {
    return 'CONVERT(0x' + ([BitConverter]::ToString($utf8.GetBytes($value))).Replace('-','') + ' USING utf8mb4)'
}

try {
    if ($zip.Entries.Count -gt 60000) { throw 'Jumlah entri backup melebihi batas.' }
    $entryMap = [Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]]::new([StringComparer]::Ordinal)
    $windowsNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $totalBytes = [long]0
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        if ($name -cnotmatch '^(applications\.jsonl|manifest\.json|schema\.sql|uploads/(documents|letters)/[A-Za-z0-9][A-Za-z0-9._-]*)$' -or -not $windowsNames.Add($name)) { throw 'Arsip memuat nama berkas terlarang atau berulang.' }
        $leaf = ($name -split '/')[-1]
        if ($leaf.EndsWith('.') -or $leaf -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Arsip memuat nama perangkat Windows yang tidak aman.' }
        if ($entry.Length -gt 536870912 -or $entry.Length -lt 0) { throw 'Ukuran entri backup tidak didukung.' }
        $totalBytes += $entry.Length
        if ($totalBytes -gt 1500000000) { throw 'Total isi backup terlalu besar.' }
        $entryMap.Add($name,$entry)
    }
    foreach ($required in @('manifest.json','applications.jsonl','schema.sql')) { if (-not $entryMap.ContainsKey($required)) { throw "Backup tidak memiliki $required." } }
    if ($entryMap['manifest.json'].Length -gt 16777216) { throw 'Manifest terlalu besar.' }
    $manifest = (Read-EntryText $entryMap['manifest.json']) | ConvertFrom-Json
    if ($manifest.format -cne 'smk-amanah-backup' -or $manifest.version -ne 1) { throw 'Format backup tidak dikenali.' }
    $listed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($file in $manifest.files) {
        if ($file.path -eq 'manifest.json' -or -not $entryMap.ContainsKey([string]$file.path) -or -not $listed.Add([string]$file.path)) { throw 'Daftar berkas manifest tidak valid.' }
        if ($file.sha256 -cnotmatch '^[a-f0-9]{64}$' -or [long]$file.size -ne $entryMap[$file.path].Length) { throw 'Ukuran atau checksum manifest tidak valid.' }
        if ((Get-EntryDigest $entryMap[$file.path] ([long]$file.size)) -cne $file.sha256) { throw 'Checksum berkas di dalam arsip tidak cocok.' }
    }
    if ($listed.Count -ne $entryMap.Count - 1) { throw 'Ada berkas tanpa checksum dalam manifest.' }
    $seenCodes = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $referenced = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $reader = [IO.StreamReader]::new($entryMap['applications.jsonl'].Open(), $utf8, $true)
    $recordCount = 0
    try {
        while (($line = $reader.ReadLine()) -ne $null) {
            if (-not $line) { throw 'Ada baris snapshot kosong.' }
            $row = $line | ConvertFrom-Json
            if ($row.tracking_code -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' -or $row.record.code -cne $row.tracking_code -or -not $seenCodes.Add([string]$row.tracking_code)) { throw 'Identitas pengajuan snapshot tidak valid atau berulang.' }
            foreach ($field in @('submitted_at','updated_at')) {
                if ([string]$row.$field -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$') { throw 'Tanggal snapshot tidak valid.' }
            }
            foreach ($mapping in @(@('documentPath','documents'),@('letterPath','letters'),@('originalLetterPath','letters'))) {
                $stored = [string]$row.record.($mapping[0])
                if (-not $stored) { continue }
                $name = 'uploads/' + $mapping[1] + '/' + $stored
                if (-not $entryMap.ContainsKey($name) -or -not $listed.Contains($name)) { throw 'Dokumen pengajuan tidak lengkap.' }
                [void]$referenced.Add($name)
            }
            $recordCount++
        }
    } finally { $reader.Dispose() }
    if ($recordCount -ne $manifest.applicationCount -or $referenced.Count -ne $manifest.documentCount) { throw 'Jumlah pengajuan atau dokumen tidak sesuai manifest.' }
    $uploadCount = @($zip.Entries | Where-Object { $_.FullName.StartsWith('uploads/') }).Count
    if ($uploadCount -ne $referenced.Count) { throw 'Ada dokumen yang tidak dirujuk oleh data pengajuan.' }

    $destination = ''
    if ($ExtractTo) {
        $destination = [IO.Path]::GetFullPath($ExtractTo)
        if (Test-Path -LiteralPath $destination) { throw 'Folder tujuan harus baru dan belum ada, agar data lama tidak tertimpa.' }
        [IO.Directory]::CreateDirectory($destination) | Out-Null
        $rootPrefix = $destination.TrimEnd('\') + '\'
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -eq 'applications.jsonl') { continue }
            $relative = if ($entry.FullName.StartsWith('uploads/')) { 'data/' + $entry.FullName.Substring(8) } else { $entry.FullName }
            $target = [IO.Path]::GetFullPath((Join-Path $destination ($relative.Replace('/','\'))))
            if (-not $target.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Tujuan ekstraksi keluar dari folder pemulihan.' }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
        }
        $dataTarget = Join-Path $destination 'data'
        [IO.Directory]::CreateDirectory($dataTarget) | Out-Null
        foreach ($folder in @('documents','letters')) { [IO.Directory]::CreateDirectory((Join-Path $dataTarget $folder)) | Out-Null }
        $jsonWriter = [IO.StreamWriter]::new((Join-Path $dataTarget 'applications.json'),$false,$utf8)
        $sqlWriter = [IO.StreamWriter]::new((Join-Path $destination 'restore.sql'),$false,$utf8)
        $reader = [IO.StreamReader]::new($entryMap['applications.jsonl'].Open(),$utf8,$true)
        try {
            $jsonWriter.Write('[')
            $sqlWriter.WriteLine('-- Import only into an empty database initialized using schema.sql. No password or session is restored.')
            $isSupabase = $manifest.databaseProvider -eq 'supabase'
            if ($isSupabase) { $sqlWriter.WriteLine("SET standard_conforming_strings = on;`nSET TIME ZONE 'UTC';`nBEGIN;") }
            else { $sqlWriter.WriteLine("SET NAMES utf8mb4;`nSTART TRANSACTION;") }
            $index = 0
            while (($line = $reader.ReadLine()) -ne $null) {
                $row = $line | ConvertFrom-Json
                $recordJson = $row.record | ConvertTo-Json -Depth 60 -Compress
                if ($index -gt 0) { $jsonWriter.Write(',') }
                $jsonWriter.Write($recordJson)
                if ($isSupabase) {
                    $values = (@($row.tracking_code,$recordJson,$row.submitted_at,$row.updated_at) | ForEach-Object { "'" + ([string]$_).Replace("'", "''") + "'" }) -join ','
                } else {
                    $values = @((Sql-Hex $row.tracking_code),(Sql-Hex $recordJson),(Sql-Hex $row.submitted_at),(Sql-Hex $row.updated_at)) -join ','
                }
                $sqlWriter.WriteLine('INSERT INTO applications (tracking_code,record_json,submitted_at,updated_at) VALUES (' + $values + ');')
                $index++
            }
            $jsonWriter.Write(']')
            $sqlWriter.WriteLine("UPDATE application_sync SET revision = revision + 1 WHERE id = 1;`nCOMMIT;")
        } finally { $reader.Dispose(); $jsonWriter.Dispose(); $sqlWriter.Dispose() }
    }
    [pscustomobject]@{ Verified = $true; Applications = $recordCount; Documents = $referenced.Count; ArchiveSha256 = $archiveHash; ExtractedTo = $destination }
} finally { $zip.Dispose() }
