$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixtureRoot = Join-Path ([IO.Path]::GetFullPath((Join-Path $root '..\.tools'))) ('backup-test-' + [Guid]::NewGuid().ToString('N'))
$dataDir = Join-Path $fixtureRoot 'data'
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($folder in @('documents','letters')) { New-Item -ItemType Directory -Force -Path (Join-Path $dataDir $folder) | Out-Null }
function Read-Database { return $script:backupFixtureRecords }
. (Join-Path $root 'backup-local.ps1')
function Assert-Backup($condition,[string]$label) { if (-not $condition) { throw ('FAIL: '+$label) }; Write-Output ('PASS: '+$label) }
$code = 'SA-202610-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$script:backupFixtureRecords = @([pscustomobject]@{
    code=$code;student='Siswa Uji';parent='Orang Tua Uji';purpose='Uji pemulihan é – Bahasa Indonesia';
    submittedAt='2026-10-19T01:00:00+00:00';updatedAt='2026-10-19T02:00:00+00:00';
    status='Selesai';documentPath=($code+'.png');letterPath=($code+'.pdf');history=@(@{status='Selesai';at='2026-10-19T02:00:00+00:00'})
})
[IO.File]::WriteAllBytes((Join-Path $dataDir ('documents\'+$code+'.png')),[byte[]]@(137,80,78,71,0,255,13,10))
[IO.File]::WriteAllText((Join-Path $dataDir ('letters\'+$code+'.pdf')),'%PDF-1.4 synthetic test only',$utf8)
$backup = New-LocalBackup
$archivePath = Join-Path (Get-LocalBackupRoot) ($backup.id+'.zip')
$restoreScript = Join-Path $root 'restore-backup.ps1'
$restoreTarget = Join-Path $fixtureRoot 'restored'
$report = & $restoreScript -Archive $archivePath -ExpectedSha256 $backup.sha256 -ExtractTo $restoreTarget
Assert-Backup ($report.Verified -and $report.Applications -eq 1 -and $report.Documents -eq 2) 'full archive and restored counts'
$restored = @([IO.File]::ReadAllText((Join-Path $restoreTarget 'data\applications.json')) | ConvertFrom-Json)
Assert-Backup ($restored[0].purpose -ceq $script:backupFixtureRecords[0].purpose) 'Unicode and record history survive restoration'
Assert-Backup ((Get-FileHash -LiteralPath (Join-Path $restoreTarget ('data\letters\'+$code+'.pdf'))).Hash -eq (Get-FileHash -LiteralPath (Join-Path $dataDir ('letters\'+$code+'.pdf'))).Hash) 'document bytes restored unchanged'
$refused = $false
try { & $restoreScript -Archive $archivePath -ExtractTo $restoreTarget | Out-Null } catch { $refused = $true }
Assert-Backup $refused 'existing destination is never overwritten'
$refused = $false
try { & $restoreScript -Archive $archivePath -ExpectedSha256 ('0'*64) | Out-Null } catch { $refused = $true }
Assert-Backup $refused 'wrong archive checksum is rejected'
$corruptPath = Join-Path $fixtureRoot 'changed-content.zip'
Copy-Item -LiteralPath $archivePath -Destination $corruptPath
$changed = [IO.Compression.ZipFile]::Open($corruptPath,[IO.Compression.ZipArchiveMode]::Update)
try {
    $entryName = 'uploads/letters/'+$code+'.pdf'
    $changed.GetEntry($entryName).Delete()
    $writer = [IO.StreamWriter]::new($changed.CreateEntry($entryName).Open(),$utf8)
    try { $writer.Write('modified test data') } finally { $writer.Dispose() }
} finally { $changed.Dispose() }
$refused = $false
try { & $restoreScript -Archive $corruptPath | Out-Null } catch { $refused = $true }
Assert-Backup $refused 'modified archive contents fail manifest verification'
$maliciousPath = Join-Path $fixtureRoot 'unsafe-path.zip'
$malicious = [IO.Compression.ZipFile]::Open($maliciousPath,[IO.Compression.ZipArchiveMode]::Create)
try { [void]$malicious.CreateEntry('../../escape.txt') } finally { $malicious.Dispose() }
$refused = $false
try { & $restoreScript -Archive $maliciousPath | Out-Null } catch { $refused = $true }
Assert-Backup $refused 'path traversal entries are rejected'
$before = @(Get-LocalBackupList).Count
$script:backupFixtureRecords[0].letterPath = 'missing.pdf'
$refused = $false
try { New-LocalBackup | Out-Null } catch { $refused = $true }
Assert-Backup ($refused -and @(Get-LocalBackupList).Count -eq $before) 'missing document cannot produce a completed backup'
$script:backupFixtureRecords = @()
$empty = New-LocalBackup
$emptyReport = & $restoreScript -Archive (Join-Path (Get-LocalBackupRoot) ($empty.id+'.zip'))
Assert-Backup ($emptyReport.Verified -and $emptyReport.Applications -eq 0 -and $emptyReport.Documents -eq 0) 'empty database backup is valid'
Write-Output ('Synthetic fixtures: '+$fixtureRoot)
