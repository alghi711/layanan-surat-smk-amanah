$principalName = 'MARTIN EKA SUPIANTI., S.T.'

function Throw-PrincipalError([int]$status, [string]$message) {
    $failure = [System.Exception]::new($message)
    $failure.Data['HttpStatus'] = $status
    throw $failure
}

function Get-PrincipalAuthorization($payload, $record, [byte[]]$signedBytes) {
    if (-not $signedBytes -or [Text.Encoding]::ASCII.GetString($signedBytes,0,[Math]::Min(5,$signedBytes.Length)) -ne '%PDF-') { Throw-PrincipalError 400 'Atur tanda tangan dan stempel lalu kirim PDF pengesahan.' }
    $inputData = $payload.authorization
    if (-not $inputData -or [string]$inputData.sourceLetterPath -cne [string]$record.letterPath) { Throw-PrincipalError 409 'Surat sumber berubah. Buka ulang pengesahan dari surat terbaru.' }
    $name = [string]$record.letterPath
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { Throw-PrincipalError 400 'Referensi surat tidak valid.' }
    $sourceFile = Join-Path $lettersDir $name
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { Throw-PrincipalError 404 'Surat sumber tidak ditemukan.' }
    $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ([string]$inputData.sourceSha256 -cne $sourceHash) { Throw-PrincipalError 409 'Surat sumber berubah. Buka ulang pengesahan dari surat terbaru.' }
    if (($inputData.pageCount -isnot [int] -and $inputData.pageCount -isnot [long]) -or $inputData.pageCount -lt 1 -or $inputData.pageCount -gt 300) { Throw-PrincipalError 400 'Jumlah halaman pengesahan tidak valid.' }
    if (@($inputData.placements).Count -ne 2) { Throw-PrincipalError 400 'Tempatkan tanda tangan dan stempel pada surat.' }
    $safe = @(); $seen = @{}
    foreach ($placement in $inputData.placements) {
        $kind = [string]$placement.kind
        if ($kind -cnotin @('signature','stamp') -or $seen.ContainsKey($kind)) { Throw-PrincipalError 400 'Penempatan pengesahan tidak valid.' }
        if (($placement.page -isnot [int] -and $placement.page -isnot [long]) -or $placement.page -lt 1 -or $placement.page -gt $inputData.pageCount) { Throw-PrincipalError 400 'Halaman pengesahan tidak valid.' }
        $item = [ordered]@{kind=$kind;page=$placement.page}
        foreach ($axis in @('x','y','width','height')) {
            $value = $placement.$axis
            if (($value -isnot [int] -and $value -isnot [long] -and $value -isnot [double] -and $value -isnot [decimal]) -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or $value -lt 0 -or $value -gt 1) { Throw-PrincipalError 400 'Posisi pengesahan tidak valid.' }
            $item[$axis] = [double]$value
        }
        if ($item.width -le 0 -or $item.height -le 0 -or $item.x + $item.width -gt 1.000001 -or $item.y + $item.height -gt 1.000001) { Throw-PrincipalError 400 'Tanda tangan atau stempel keluar dari kertas.' }
        $seen[$kind] = $true; $safe += [pscustomobject]$item
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $signedHash = ([BitConverter]::ToString($sha.ComputeHash($signedBytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    return [pscustomobject]@{principalName=$principalName;sourceLetterPath=$name;sourceSha256=$sourceHash;pageCount=$inputData.pageCount;placements=$safe;signedFileSha256=$signedHash}
}
