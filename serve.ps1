$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$configuredDataDir = [Environment]::GetEnvironmentVariable('AMANA_DATA_DIR')
$dataDir = if ([string]::IsNullOrWhiteSpace($configuredDataDir)) { Join-Path $root 'data' } else { $configuredDataDir }
$dataDir = [System.IO.Path]::GetFullPath($dataDir)
$documentsDir = Join-Path $dataDir 'documents'
$lettersDir = Join-Path $dataDir 'letters'
$databasePath = Join-Path $dataDir 'applications.json'
New-Item -ItemType Directory -Force -Path $documentsDir | Out-Null
New-Item -ItemType Directory -Force -Path $lettersDir | Out-Null
if (-not (Test-Path -LiteralPath $databasePath)) {
    [System.IO.File]::WriteAllText($databasePath, "[]`n", [System.Text.UTF8Encoding]::new($false))
}

$environment = [Environment]::GetEnvironmentVariable('AMANA_ENV')
$staffAccounts = @{}
foreach ($accountSpec in @(@('tu','AMANA_TU','tu','TU-local-amanah123!'),@('principal','AMANA_PRINCIPAL','kepsek','Kepsek-local-amanah123!'))) {
    $accountUser = ([string][Environment]::GetEnvironmentVariable($accountSpec[1] + '_USER')).Trim()
    $accountPassword = [string][Environment]::GetEnvironmentVariable($accountSpec[1] + '_PASSWORD')
    if ($environment -ne 'production') {
        if (-not $accountUser) { $accountUser = $accountSpec[2] }
        if (-not $accountPassword) { $accountPassword = $accountSpec[3] }
    }
    if (-not $accountUser -or $accountUser.Length -gt 80 -or $accountPassword.Length -lt 16) { throw 'Atur AMANA_TU_USER, AMANA_TU_PASSWORD, AMANA_PRINCIPAL_USER dan AMANA_PRINCIPAL_PASSWORD. Password minimal 16 karakter.' }
    $staffAccounts[$accountSpec[0]] = @{ Username=$accountUser; Password=$accountPassword }
}
if ($staffAccounts.tu.Username -ieq $staffAccounts.principal.Username -or $staffAccounts.tu.Password -ceq $staffAccounts.principal.Password) { throw 'Username dan password kedua akun harus berbeda.' }
$cookieSecure = [Environment]::GetEnvironmentVariable('AMANA_COOKIE_SECURE') -eq '1'
if ($environment -eq 'production' -and -not $cookieSecure) { throw 'Set AMANA_COOKIE_SECURE=1 agar cookie sesi hanya dikirim melalui HTTPS.' }
$bindAddress = [Environment]::GetEnvironmentVariable('AMANA_BIND_ADDRESS')
if ([string]::IsNullOrWhiteSpace($bindAddress)) { $bindAddress = '127.0.0.1' }
$portValue = [Environment]::GetEnvironmentVariable('AMANA_PORT')
$port = if ([string]::IsNullOrWhiteSpace($portValue)) { 8001 } else { [int]$portValue }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($bindAddress), $port)
$listener.Start()
$script:sessions = @{}
$script:loginAttempts = @{}
$types = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
    '.jpeg' = 'image/jpeg'; '.pdf' = 'application/pdf'; '.ico' = 'image/x-icon'
}
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Send-Response($stream, [string]$status, [string]$contentType, [byte[]]$body, [string]$downloadName = '', [string]$extraHeader = '') {
    $downloadHeader = if ($downloadName) { "Content-Disposition: attachment; filename=`"$downloadName`"`r`n" } else { '' }
    $header = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`n$downloadHeader$extraHeader`Cache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nX-Frame-Options: DENY`r`nReferrer-Policy: same-origin`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}

function Send-Json($stream, [string]$status, $value, [string]$extraHeader = '') {
    if ($value -is [array]) {
        $items = foreach ($item in $value) { ConvertTo-Json -InputObject $item -Depth 10 -Compress }
        $json = '[' + ($items -join ',') + ']'
    } else {
        $json = ConvertTo-Json -InputObject $value -Depth 10 -Compress
    }
    Send-Response $stream $status 'application/json; charset=utf-8' ($utf8.GetBytes($json)) '' $extraHeader
}

function Get-Session($request) {
    $cookie = [string]$request.Headers['cookie']
    $match = [regex]::Match($cookie, '(?:^|;\s*)amanah_session=([A-Za-z0-9_-]+)')
    if (-not $match.Success) { return $null }
    $token = $match.Groups[1].Value
    if (-not $script:sessions.ContainsKey($token)) { return $null }
    $session = $script:sessions[$token]
    if ([DateTime]::UtcNow -ge $session.ExpiresAt) { $script:sessions.Remove($token); return $null }
    return $session
}

function New-SessionToken {
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bytes = [byte[]]::new(32)
        $random.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    } finally { $random.Dispose() }
}

function New-SessionCookie([string]$value, [int]$maxAge = 28800) {
    $secureFlag = if ($cookieSecure) { '; Secure' } else { '' }
    return "Set-Cookie: amanah_session=$value; Path=/; HttpOnly; SameSite=Strict; Max-Age=$maxAge$secureFlag`r`n"
}

function Read-HttpRequest($stream) {
    $headerBuffer = [System.Collections.Generic.List[byte]]::new()
    $last = ''
    while ($headerBuffer.Count -lt 32768) {
        $value = $stream.ReadByte()
        if ($value -lt 0) { throw 'Request header ended unexpectedly.' }
        $headerBuffer.Add([byte]$value)
        $last += [char]$value
        if ($last.Length -gt 4) { $last = $last.Substring($last.Length - 4) }
        if ($last -eq "`r`n`r`n") { break }
    }
    $headerText = [System.Text.Encoding]::ASCII.GetString($headerBuffer.ToArray())
    $lines = $headerText -split "`r`n"
    $request = $lines[0] -split ' '
    $headers = @{}
    foreach ($line in $lines | Select-Object -Skip 1) {
        if ($line -match '^([^:]+):\s*(.*)$') { $headers[$matches[1].ToLowerInvariant()] = $matches[2] }
    }
    $length = 0
    if ($headers.ContainsKey('content-length')) { $length = [int]$headers['content-length'] }
    if ($length -gt 16MB) { throw 'Request body exceeds 16 MB.' }
    $body = [byte[]]::new($length)
    $offset = 0
    while ($offset -lt $length) {
        $read = $stream.Read($body, $offset, $length - $offset)
        if ($read -le 0) { throw 'Request body ended unexpectedly.' }
        $offset += $read
    }
    return [pscustomobject]@{ Method = $request[0]; Target = $request[1]; Headers = $headers; Body = $body }
}

function Add-DatabaseRecords($node, $list) {
    if ($null -eq $node) { return }
    if ($node -is [array]) {
        foreach ($item in $node) { Add-DatabaseRecords $item $list }
        return
    }
    $propertyNames = @($node.PSObject.Properties.Name)
    if ($propertyNames -contains 'code') {
        if (-not ($list | Where-Object { $_.code -eq $node.code })) { $list.Add($node) | Out-Null }
        return
    }
    if ($propertyNames -contains 'value') { Add-DatabaseRecords $node.value $list }
}

function Read-Database {
    $raw = [System.IO.File]::ReadAllText($databasePath, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    $parsed = ConvertFrom-Json -InputObject $raw
    $list = [System.Collections.Generic.List[object]]::new()
    Add-DatabaseRecords $parsed $list
    return $list.ToArray()
}

function Write-Database($records) {
    $items = foreach ($item in @($records)) { ConvertTo-Json -InputObject $item -Depth 10 -Compress }
    $json = '[' + ($items -join ',') + ']'
    $tempPath = "$databasePath.tmp"
    [System.IO.File]::WriteAllText($tempPath, $json, $utf8)
    Move-Item -LiteralPath $tempPath -Destination $databasePath -Force
}

Write-Host "Layanan Surat siap di http://$bindAddress`:$port"
. (Join-Path $root 'backup-local.ps1')
. (Join-Path $root 'principal-local.ps1')
Write-Host "Database lokal: $databasePath"
while ($true) {
    $client = $listener.AcceptTcpClient()
    # A half-open browser connection must not block every request behind it.
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 10000
    try {
        $stream = $client.GetStream()
        $request = Read-HttpRequest $stream
        $uri = [Uri]::new("http://localhost$($request.Target)")
        $path = [Uri]::UnescapeDataString($uri.AbsolutePath)
        if ($request.Method -eq 'GET' -and $path -eq '/api/admin/signing-asset') {
            $assetSession = Get-Session $request
            if (-not $assetSession -or -not $assetSession.Role) { Send-Json $stream '401 Unauthorized' @{error='Login petugas diperlukan.'}; continue }
            if ($assetSession.Role -ne 'principal') { Send-Json $stream '403 Forbidden' @{error='Aset pengesahan hanya tersedia pada menu Kepala Sekolah.'}; continue }
            $assetQuery = @($uri.Query.TrimStart('?').Split('&'))
            $assetKindPart = $assetQuery | Where-Object { $_ -like 'kind=*' } | Select-Object -First 1
            $kind = if ($assetKindPart) { [Uri]::UnescapeDataString($assetKindPart.Substring(5)) } else { '' }
            if ($kind -cnotin @('signature','stamp')) { Send-Json $stream '404 Not Found' @{error='Aset tidak ditemukan.'}; continue }
            $assetFile = Join-Path (Join-Path $root 'private\signing') ($kind + '.png')
            if ($assetQuery -contains 'format=base64') {
                Send-Json $stream '200 OK' @{mime='image/png';base64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($assetFile))}
                continue
            }
            Send-Response $stream '200 OK' 'image/png' ([IO.File]::ReadAllBytes($assetFile))
            continue
        }

        if ($path -in @('/api/admin/backups','/api/admin/backups/download')) {
            $backupSession = Get-Session $request
            if (-not $backupSession -or $backupSession.Role -notin @('tu','principal')) { Send-Json $stream '401 Unauthorized' @{ error = 'Login petugas diperlukan.' }; continue }
            if ($path -eq '/api/admin/backups' -and $request.Method -eq 'GET') {
                Send-Json $stream '200 OK' @{ backups = @(Get-LocalBackupList); schedule = 'manual' }
            } elseif ($path -eq '/api/admin/backups' -and $request.Method -eq 'POST') {
                Send-Json $stream '201 Created' @{ ok = $true; backup = (New-LocalBackup) }
            } elseif ($path -eq '/api/admin/backups/download' -and $request.Method -eq 'GET') {
                $idMatch = [regex]::Match($uri.Query, '(?:^\?|&)id=([^&]*)')
                $backupId = [Uri]::UnescapeDataString($idMatch.Groups[1].Value)
                $metadata = Get-LocalBackupMetadata $backupId
                $zipPath = Join-Path (Get-LocalBackupRoot) ($backupId + '.zip')
                Send-Response $stream '200 OK' 'application/zip' ([IO.File]::ReadAllBytes($zipPath)) ($backupId + '.zip') ("X-Backup-SHA256: " + $metadata.sha256 + "`r`n")
            } else { Send-Json $stream '405 Method Not Allowed' @{ error = 'Metode backup tidak didukung.' } }
        } elseif ($request.Method -eq 'GET' -and $path -eq '/api/health') {
            Send-Json $stream '200 OK' @{ ok = $true; storage = 'local-file-database' }
        } elseif ($request.Method -eq 'POST' -and $path -eq '/api/login') {
            $payload = [System.Text.Encoding]::UTF8.GetString($request.Body) | ConvertFrom-Json
            $loginKey = '{0}|{1}' -f $client.Client.RemoteEndPoint.Address, ([string]$payload.username).Trim().ToLowerInvariant()
            $attempt = $script:loginAttempts[$loginKey]
            $loginRole = ''
            foreach ($accountRole in @('tu','principal')) {
                if (([string]$payload.username).Trim() -ieq $staffAccounts[$accountRole].Username -and [string]$payload.password -ceq $staffAccounts[$accountRole].Password) { $loginRole = $accountRole }
            }
            if ($attempt -and $attempt.LockedUntil -and [DateTime]::UtcNow -lt $attempt.LockedUntil) {
                Send-Json $stream '429 Too Many Requests' @{ error = 'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.' }
            } elseif (-not $loginRole) {
                $failures = if ($attempt -and $attempt.WindowStart -gt [DateTime]::UtcNow.AddMinutes(-15)) { $attempt.Failures + 1 } else { 1 }
                $lockedUntil = if ($failures -ge 8) { [DateTime]::UtcNow.AddMinutes(15) } else { $null }
                $script:loginAttempts[$loginKey] = @{ Failures = $failures; WindowStart = [DateTime]::UtcNow; LockedUntil = $lockedUntil }
                $status = if ($lockedUntil) { '429 Too Many Requests' } else { '401 Unauthorized' }
                $message = if ($lockedUntil) { 'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.' } else { 'Username atau password salah.' }
                Send-Json $stream $status @{ error = $message }
            } else {
                $script:loginAttempts.Remove($loginKey)
                $token = New-SessionToken
                $script:sessions[$token] = @{ Role = $loginRole; Username = $staffAccounts[$loginRole].Username; ExpiresAt = [DateTime]::UtcNow.AddHours(8) }
                Send-Json $stream '200 OK' @{ ok = $true; role = $loginRole } (New-SessionCookie $token)
            }
        } elseif ($request.Method -eq 'GET' -and $path -eq '/api/session') {
            $session = Get-Session $request
            if ($session) { Send-Json $stream '200 OK' @{ authenticated = $true; role = $session.Role } }
            else { Send-Json $stream '200 OK' @{ authenticated = $false; role = '' } }
        } elseif ($request.Method -eq 'POST' -and $path -eq '/api/select-role') {
            $session = Get-Session $request
            if (-not $session) { Send-Json $stream '401 Unauthorized' @{ error = 'Silakan login kembali.' } }
            else {
                $payload = [System.Text.Encoding]::UTF8.GetString($request.Body) | ConvertFrom-Json
                if ([string]$payload.role -notin @('tu', 'principal')) { Send-Json $stream '400 Bad Request' @{ error = 'Peran tidak valid.' } }
                elseif ([string]$payload.role -ne $session.Role) { Send-Json $stream '403 Forbidden' @{error='Akun ini tidak dapat berganti peran. Login dengan akun petugas yang sesuai.'} }
                else { Send-Json $stream '200 OK' @{ ok = $true; role = $session.Role } }
            }
        } elseif ($request.Method -eq 'POST' -and $path -eq '/api/logout') {
            $session = Get-Session $request
            if ($session) {
                $cookie = [string]$request.Headers['cookie']
                $match = [regex]::Match($cookie, '(?:^|;\s*)amanah_session=([A-Za-z0-9_-]+)')
                if ($match.Success) { $script:sessions.Remove($match.Groups[1].Value) }
            }
            Send-Json $stream '200 OK' @{ ok = $true } (New-SessionCookie '' 0)
        } elseif ($request.Method -eq 'GET' -and $path -eq '/api/track') {
            $code = $uri.Query -replace '^\?code=', ''
            $code = [Uri]::UnescapeDataString($code).Trim().ToUpperInvariant()
            $record = (Read-Database) | Where-Object { $_.code -eq $code } | Select-Object -First 1
            if ($record) {
                $publicNote = $record.note
                if ($record.status -eq 'Ditolak Kepala Sekolah') { $publicNote = $record.principalNote }
                $publicRecord = [ordered]@{
                    code = $record.code; student = $record.student; className = $record.className
                    type = $record.type; purpose = $record.purpose; status = $record.status
                    note = $publicNote
                    hasLetter = [bool]$record.letterPath; letterName = $record.letterName
                    submittedAt = $record.submittedAt; updatedAt = $record.updatedAt
                    history = @($record.history | Where-Object { $_ -and $_.status -and $_.at } | ForEach-Object { [ordered]@{ status = $_.status; at = $_.at; note = $_.note } })
                }
                Send-Json $stream '200 OK' $publicRecord
            } else {
                Send-Json $stream '404 Not Found' @{ error = 'Nomor pelacakan tidak ditemukan.' }
            }
        } elseif ($request.Method -eq 'GET' -and $path -eq '/api/admin/applications') {
            $session = Get-Session $request
            if (-not $session -or -not $session.Role) { Send-Json $stream '401 Unauthorized' @{ error = 'Login petugas diperlukan.' } }
            else { $records = @(Read-Database | Sort-Object submittedAt -Descending); Send-Json $stream '200 OK' $records }
        } elseif ($request.Method -in @('GET','POST') -and $path -eq '/api/admin/letter-draft') {
            $session = Get-Session $request
            if (-not $session -or -not $session.Role) { Send-Json $stream '401 Unauthorized' @{ error = 'Login petugas diperlukan.' }; continue }
            if ($session.Role -ne 'tu') { Send-Json $stream '403 Forbidden' @{ error = 'Draf surat hanya dapat disimpan Tata Usaha.' }; continue }
            if ($request.Method -eq 'GET') {
                $draftCode = [Uri]::UnescapeDataString(($uri.Query -replace '^\?code=', '')).Trim().ToUpperInvariant()
                $record = (Read-Database) | Where-Object { $_.code -ceq $draftCode } | Select-Object -First 1
                if (-not $record) { Send-Json $stream '404 Not Found' @{error='Pengajuan tidak ditemukan.'}; continue }
                Send-Json $stream '200 OK' @{draft=$record.letterDraft;status=$record.status}
                continue
            }
            $payload = [Text.Encoding]::UTF8.GetString($request.Body) | ConvertFrom-Json
            if (($payload.version -isnot [int] -and $payload.version -isnot [long]) -or $payload.version -lt 0) { throw 'Versi draf tidak valid.' }
            if (-not $payload.fields -or $payload.fields -isnot [pscustomobject]) { throw 'Isian draf tidak valid.' }
            $limits = @{title=140;number=70;recipient=300;opening=500;studentName=80;studentId=20;studentClass=50;year=20;body=2500;closing=500;city=45;date=10;position=100;principal=90;nip=30}
            $fields = @{}
            foreach ($name in $limits.Keys) {
                $value = $payload.fields.$name
                if ($null -ne $value -and $value -isnot [string]) { throw 'Isian draf tidak valid.' }
                $fields[$name] = ([string]$value).Trim()
                if ($fields[$name].Length -gt $limits[$name]) { throw 'Isian draf melebihi batas panjang.' }
            }
            if ($null -ne $payload.fields.includeStudent -and $payload.fields.includeStudent -isnot [bool]) { throw 'Pilihan identitas siswa tidak valid.' }
            $fields.includeStudent = if ($null -eq $payload.fields.includeStudent) { $true } else { $payload.fields.includeStudent }
            $fields.principal = $principalName
            $parsedDate = [datetime]::MinValue
            if ($fields.date -and -not [datetime]::TryParseExact($fields.date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedDate)) { throw 'Tanggal draf tidak valid.' }
            $records = @(Read-Database)
            $record = $records | Where-Object { $_.code -ceq [string]$payload.code } | Select-Object -First 1
            if (-not $record) { Send-Json $stream '404 Not Found' @{ error = 'Pengajuan tidak ditemukan.' }; continue }
            if ($record.status -ne 'Disetujui Tata Usaha') { Send-Json $stream '409 Conflict' @{ error = 'Status pengajuan berubah. Draf hanya dapat diedit sebelum dikirim ke kepala sekolah.' }; continue }
            $version = if ($record.letterDraft) { [long]$record.letterDraft.version } else { 0 }
            if ($version -ne [long]$payload.version) { Send-Json $stream '409 Conflict' @{error='Draf sudah diperbarui dari perangkat lain. Muat draf terbaru sebelum menyimpan.';draftConflict=$true}; continue }
            $draft = [pscustomobject]@{version=($version+1);savedAt=[datetime]::UtcNow.ToString('o');fields=[pscustomobject]$fields}
            $record | Add-Member -NotePropertyName letterDraft -NotePropertyValue $draft -Force
            Write-Database $records
            Send-Json $stream '200 OK' @{ok=$true;draft=$draft}
        } elseif ($request.Method -eq 'POST' -and $path -eq '/api/admin/update') {
            $session = Get-Session $request
            if (-not $session -or -not $session.Role) { Send-Json $stream '401 Unauthorized' @{ error = 'Login petugas diperlukan.' }; continue }
            $payload = [System.Text.Encoding]::UTF8.GetString($request.Body) | ConvertFrom-Json
            $records = @(Read-Database)
            $record = $records | Where-Object { $_.code -eq ([string]$payload.code).ToUpperInvariant() } | Select-Object -First 1
            if (-not $record) { throw 'Pengajuan tidak ditemukan.' }
            $role = [string]$session.Role
            if ([string]$payload.role -ne $role) { throw 'Peran aktif tidak sesuai. Pilih ulang menu petugas.' }
            $allowedStatuses = if ($role -eq 'principal') { @('Selesai', 'Ditolak Kepala Sekolah') } else { @('Disetujui Tata Usaha', 'Ditolak oleh TU', 'Menunggu persetujuan Kepala Sekolah') }
            if ([string]$payload.status -notin $allowedStatuses) { throw 'Status pengajuan tidak valid.' }
            $allowedFrom = @{
                'Disetujui Tata Usaha' = @('Menunggu konfirmasi TU')
                'Ditolak oleh TU' = @('Menunggu konfirmasi TU')
                'Menunggu persetujuan Kepala Sekolah' = @('Disetujui Tata Usaha')
                'Selesai' = @('Menunggu persetujuan Kepala Sekolah')
                'Ditolak Kepala Sekolah' = @('Menunggu persetujuan Kepala Sekolah')
            }
            if ($record.status -notin $allowedFrom[[string]$payload.status]) { throw 'Tahap pengajuan sudah berubah atau tidak sesuai alur.' }
            if ($payload.status -eq 'Menunggu persetujuan Kepala Sekolah' -and $payload.PSObject.Properties.Name -contains 'letterDraftVersion') {
                $version = if ($record.letterDraft) { [long]$record.letterDraft.version } else { 0 }
                if (($payload.letterDraftVersion -isnot [int] -and $payload.letterDraftVersion -isnot [long]) -or $payload.letterDraftVersion -ne $version) { Send-Json $stream '409 Conflict' @{error='Draf sudah berubah dari perangkat lain. Muat draf terbaru sebelum mengirim.';draftConflict=$true}; continue }
            }
            if ($payload.status -in @('Ditolak oleh TU', 'Ditolak Kepala Sekolah') -and [string]::IsNullOrWhiteSpace([string]$payload.note)) { throw 'Catatan penolakan wajib diisi.' }
            $decisionNote = [string]$payload.note
            if ($decisionNote.Length -gt 500) { throw 'Catatan maksimal 500 karakter.' }
            if ($payload.status -eq 'Menunggu persetujuan Kepala Sekolah' -and -not $payload.letterBase64) { throw 'Unggah file surat terlebih dahulu.' }
            if ($role -eq 'principal' -and -not $record.letterPath) { throw 'Surat belum diunggah oleh Tata Usaha.' }
            if ($payload.letterBase64) {
                $letterBytes = [Convert]::FromBase64String([string]$payload.letterBase64)
                if ($letterBytes.Length -gt 10MB) { throw 'Ukuran surat maksimal 10 MB.' }
                $letterName = [System.IO.Path]::GetFileName([string]$payload.letterName)
                $letterExtension = [System.IO.Path]::GetExtension($letterName).ToLowerInvariant()
                if ($role -eq 'principal' -and $payload.status -eq 'Selesai') {
                    if ($letterExtension -ne '.pdf') { Throw-PrincipalError 400 'Surat pengesahan harus PDF.' }
                    $authorization = Get-PrincipalAuthorization $payload $record $letterBytes
                    $record | Add-Member -NotePropertyName originalLetterPath -NotePropertyValue $record.letterPath -Force
                    $record | Add-Member -NotePropertyName principalAuthorization -NotePropertyValue $authorization -Force
                } elseif ($role -ne 'tu' -or $payload.status -ne 'Menunggu persetujuan Kepala Sekolah') { Throw-PrincipalError 400 'Unggah surat tidak sesuai tahap pengajuan.' }
                if ($letterExtension -notin @('.pdf', '.jpg', '.jpeg', '.png')) { throw 'Format surat harus PDF, JPG, atau PNG.' }
                $storedLetterName = "$($record.code)-$([Guid]::NewGuid().ToString('N'))$letterExtension"
                [System.IO.File]::WriteAllBytes((Join-Path $lettersDir $storedLetterName), $letterBytes)
                $record | Add-Member -NotePropertyName letterName -NotePropertyValue $letterName -Force
                $record | Add-Member -NotePropertyName letterPath -NotePropertyValue $storedLetterName -Force
            }
            if ($role -eq 'principal' -and $payload.status -eq 'Selesai' -and -not $payload.letterBase64) { Throw-PrincipalError 400 'Atur tanda tangan dan stempel lalu kirim PDF pengesahan.' }
            $record.status = [string]$payload.status
            if ($role -eq 'principal') { $record | Add-Member -NotePropertyName principalNote -NotePropertyValue $decisionNote -Force }
            else { $record.note = $decisionNote }
            $record.updatedAt = [DateTime]::UtcNow.ToString('o')
            if ($role -eq 'principal' -and $payload.status -eq 'Selesai') { $record.principalAuthorization | Add-Member -NotePropertyName signedAt -NotePropertyValue $record.updatedAt -Force }
            $history = @($record.history)
            $history += [pscustomobject]@{ status = [string]$payload.status; at = $record.updatedAt; note = $decisionNote }
            $record | Add-Member -NotePropertyName history -NotePropertyValue $history -Force
            Write-Database $records
            Send-Json $stream '200 OK' @{ ok = $true; code = $record.code; status = $record.status; record = $record }
        } elseif ($request.Method -eq 'GET' -and $path -in @('/api/admin/document', '/api/letter')) {
            if ($path -eq '/api/admin/document') {
                $session = Get-Session $request
                if (-not $session -or -not $session.Role) { Send-Json $stream '401 Unauthorized' @{ error = 'Login petugas diperlukan.' }; continue }
            }
            $queryParts = @($uri.Query.TrimStart('?').Split('&'))
            $codePart = $queryParts | Where-Object { $_ -like 'code=*' } | Select-Object -First 1
            $kindPart = $queryParts | Where-Object { $_ -like 'kind=*' } | Select-Object -First 1
            $code = if ($codePart) { [Uri]::UnescapeDataString(($codePart.Substring(5))).Trim().ToUpperInvariant() } else { '' }
            $kind = if ($kindPart) { [Uri]::UnescapeDataString(($kindPart.Substring(5))).ToLowerInvariant() } else { '' }
            $record = (Read-Database) | Where-Object { $_.code -eq $code } | Select-Object -First 1
            if ($path -eq '/api/letter') { $kind = 'letter' }
            if ($path -eq '/api/letter' -and $record.status -ne 'Selesai') { Send-Json $stream '404 Not Found' @{error='Surat belum tersedia.'}; continue }
            $storedName = if ($kind -eq 'letter') { $record.letterPath } else { $record.documentPath }
            $folder = if ($kind -eq 'letter') { $lettersDir } else { $documentsDir }
            if ($record -and $storedName) {
                $filePath = Join-Path $folder ([System.IO.Path]::GetFileName([string]$storedName))
                if (Test-Path -LiteralPath $filePath -PathType Leaf) {
                    $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
                    $contentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
                    $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
                    if ($path -eq '/api/admin/document' -and $queryParts -contains 'format=base64') {
                        Send-Json $stream '200 OK' @{mime=$contentType;base64=[Convert]::ToBase64String($fileBytes)}
                        continue
                    }
                    if ($path -eq '/api/letter') {
                        $downloadName = [System.IO.Path]::GetFileName([string]$record.letterName)
                        $asciiName = [System.Text.RegularExpressions.Regex]::Replace($downloadName, '[^A-Za-z0-9._-]', '_')
                        Send-Response $stream '200 OK' $contentType $fileBytes $asciiName
                    } else { Send-Response $stream '200 OK' $contentType $fileBytes }
                } else { Send-Json $stream '404 Not Found' @{ error = 'File tidak ditemukan.' } }
            } else { Send-Json $stream '404 Not Found' @{ error = 'File tidak ditemukan.' } }
        } elseif ($request.Method -eq 'POST' -and $path -eq '/api/applications') {
            $payload = [System.Text.Encoding]::UTF8.GetString($request.Body) | ConvertFrom-Json
            foreach ($field in @('parent', 'phone', 'student', 'nis', 'className', 'major', 'relation', 'type', 'purpose')) {
                if ([string]::IsNullOrWhiteSpace([string]$payload.$field)) { throw "Field $field wajib diisi." }
            }
            $purpose = [string]$payload.purpose
            if ([string]$payload.className -notin @('X', 'XI', 'XII') -or [string]$payload.major -notin @('TKJ 1', 'TKJ 2', 'TKR 1', 'TKR 2', 'MP', 'TKJ', 'TKR')) { throw 'Kelas atau jurusan tidak valid.' }
            if ($purpose.Length -gt 500) { throw 'Keperluan maksimal 500 karakter.' }
            $records = @(Read-Database)
            $datePrefix = Get-Date -Format 'yyyyMM'
            $studentIdentity = ([regex]::Replace(([string]$payload.nis).Trim(), '[\s.\-]+', '')).ToUpperInvariant()
            if (-not $studentIdentity) { throw 'NIS / NISN tidak valid.' }
            $duplicate = $records | Where-Object {
                $_.status -in @('Menunggu konfirmasi TU', 'Disetujui Tata Usaha', 'Menunggu persetujuan Kepala Sekolah') -and
                ([regex]::Replace(([string]$_.nis).Trim(), '[\s.\-]+', '')).ToUpperInvariant() -ceq $studentIdentity -and
                [string]$_.type -ceq [string]$payload.type
            } | Sort-Object submittedAt -Descending | Select-Object -First 1
            if ($duplicate) {
                $normalizeDuplicatePhone = {
                    param([string]$value)
                    $digits = [regex]::Replace($value, '\D', '')
                    if ($digits.StartsWith('00')) { return $digits.Substring(2) }
                    if ($digits.StartsWith('0')) { return '62' + $digits.Substring(1) }
                    if ($digits.StartsWith('8')) { return '62' + $digits }
                    return $digits
                }
                $responseData = @{ duplicate = $true; error = 'Siswa dengan NIS / NISN ini masih memiliki pengajuan jenis surat yang sama dalam proses. Silakan hubungi Tata Usaha jika membutuhkan bantuan.' }
                $incomingPhone = & $normalizeDuplicatePhone ([string]$payload.phone)
                if ($incomingPhone -and $incomingPhone -ceq (& $normalizeDuplicatePhone ([string]$duplicate.phone))) {
                    $responseData.code = $duplicate.code
                    $responseData.status = $duplicate.status
                    $responseData.error = 'Pengajuan jenis surat ini masih diproses untuk siswa tersebut. Gunakan nomor pelacakan yang sudah ada.'
                }
                Send-Json $stream '409 Conflict' $responseData
                continue
            }
            do {
                $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
                try { $tokenBytes = [byte[]]::new(16); $random.GetBytes($tokenBytes) }
                finally { $random.Dispose() }
                $token = ([BitConverter]::ToString($tokenBytes) -replace '-', '').ToLowerInvariant()
                $code = 'SA-{0}-{1}' -f $datePrefix, $token
            } while ($records | Where-Object { $_.code -eq $code })
            $documentName = ''
            if ($payload.documentBase64) {
                $bytes = [Convert]::FromBase64String([string]$payload.documentBase64)
                if ($bytes.Length -gt 5MB) { throw 'Dokumen melebihi batas 5 MB.' }
                $safeName = [System.IO.Path]::GetFileName([string]$payload.documentName)
                $extension = [System.IO.Path]::GetExtension($safeName).ToLowerInvariant()
                if ($extension -notin @('.pdf', '.jpg', '.jpeg', '.png')) { throw 'Format dokumen harus PDF, JPG, atau PNG.' }
                $storedName = "$code$extension"
                [System.IO.File]::WriteAllBytes((Join-Path $documentsDir $storedName), $bytes)
                $documentName = $safeName
            }
            $now = [DateTime]::UtcNow.ToString('o')
            $studentClass = "{0} {1}" -f [string]$payload.className, [string]$payload.major
            $initialHistory = @([pscustomobject]@{ status = 'Menunggu konfirmasi TU'; at = $now; note = '' })
            $record = [ordered]@{
                code = $code; parent = [string]$payload.parent; phone = [string]$payload.phone
                email = [string]$payload.email; relation = [string]$payload.relation
                student = [string]$payload.student; nis = [string]$payload.nis
                className = $studentClass.Trim()
                major = [string]$payload.major; type = [string]$payload.type
                purpose = [string]$payload.purpose; documentName = $documentName
                documentPath = if ($documentName) { $storedName } else { '' }
                status = 'Menunggu konfirmasi TU'; note = ''; submittedAt = $now; updatedAt = $now; history = $initialHistory
            }
            $records += [pscustomobject]$record
            Write-Database $records
            Send-Json $stream '201 Created' @{ code = $code; status = $record.status }
        } elseif ($request.Method -eq 'GET') {
            if ($path -eq '/') { $path = '/index.html' }
            if ($path -in @('/tu.html', '/rekap.html')) {
                $pageSession = Get-Session $request
                if (-not $pageSession -or $pageSession.Role -notin @('tu', 'principal')) {
                    Send-Response $stream '302 Found' 'text/plain; charset=utf-8' ([byte[]]@()) '' "Location: /admin.html`r`n"
                    continue
                }
            }
            if ($path -eq '/data' -or $path.StartsWith('/data/') -or $path -eq '/backups' -or $path.StartsWith('/backups/') -or $path -eq '/restore-check' -or $path.StartsWith('/restore-check/')) {
                Send-Response $stream '404 Not Found' 'text/plain; charset=utf-8' ($utf8.GetBytes('Not found'))
                continue
            }
            $relative = $path.TrimStart('/') -replace '/', [System.IO.Path]::DirectorySeparatorChar
            $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
            $rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
            $privateFile = $false
            foreach ($privateDirectory in @($dataDir, (Join-Path $root 'backups'), (Join-Path $root 'restore-check'), (Join-Path $root 'private'), (Join-Path $root 'wasmer-edge'))) {
                $privatePath = [System.IO.Path]::GetFullPath($privateDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
                if ($filePath.Equals($privatePath, [System.StringComparison]::OrdinalIgnoreCase) -or $filePath.StartsWith($privatePath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $privateFile = $true
                    break
                }
            }
            if (-not $filePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-Response $stream '403 Forbidden' 'text/plain; charset=utf-8' ($utf8.GetBytes('Forbidden'))
            } elseif ($privateFile) {
                Send-Response $stream '404 Not Found' 'text/plain; charset=utf-8' ($utf8.GetBytes('Not found'))
            } elseif (Test-Path -LiteralPath $filePath -PathType Leaf) {
                $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
                $contentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
                Send-Response $stream '200 OK' $contentType ([System.IO.File]::ReadAllBytes($filePath))
            } else {
                Send-Response $stream '404 Not Found' 'text/plain; charset=utf-8' ($utf8.GetBytes('Not found'))
            }
        } else {
            Send-Json $stream '405 Method Not Allowed' @{ error = 'Method not allowed.' }
        }
    } catch {
        try {
            $message = $_.Exception.Message
            $status = if ($message -match 'wajib|maksimal|melebihi|Format dokumen|tidak valid|tidak sesuai|tidak ditemukan|Unggah file|harus PDF|Tahap|Request body exceeds') { '400 Bad Request' } else { '500 Internal Server Error' }
            if ($_.Exception.Data['HttpStatus']) {
                $statusCode = [int]$_.Exception.Data['HttpStatus']
                $status = switch ($statusCode) {400 {'400 Bad Request'} 403 {'403 Forbidden'} 404 {'404 Not Found'} 409 {'409 Conflict'} default {'500 Internal Server Error'}}
            }
            Send-Json $stream $status @{ error = $message }
        } catch {}
        Write-Host "Permintaan gagal: $($_.Exception.Message)"
    } finally {
        if ($client) { $client.Close() }
    }
}
