<?php
declare(strict_types=1);

// Portable ZIP writer (stored entries and data descriptors); no ZIP extension required.
final class SchoolBackupZip
{
    private $stream;
    private int $position = 0;
    private array $entries = [];

    public function __construct(string $path)
    {
        $this->stream = fopen($path, 'xb');
        if (!$this->stream) throw new RuntimeException('Tidak dapat membuat arsip backup.');
    }

    private function write(string $bytes): void
    {
        $length = strlen($bytes);
        if ($this->position + $length > 1500000000) throw new RuntimeException('Backup melebihi batas arsip 1,5 GB.');
        $offset = 0;
        while ($offset < $length) {
            $written = fwrite($this->stream, substr($bytes, $offset));
            if ($written === false || $written === 0) throw new RuntimeException('Penyimpanan backup gagal.');
            $offset += $written;
            $this->position += $written;
        }
    }

    public function addFile(string $name, string $path): array
    {
        $input = fopen($path, 'rb');
        if (!$input) throw new RuntimeException('Berkas backup tidak dapat dibaca.');
        try { return $this->addStream($name, $input); } finally { fclose($input); }
    }

    public function addText(string $name, string $text): array
    {
        $input = fopen('php://temp', 'w+b');
        if (!$input) throw new RuntimeException('Buffer backup tidak tersedia.');
        try {
            if (fwrite($input, $text) !== strlen($text)) throw new RuntimeException('Buffer backup tidak lengkap.');
            rewind($input);
            return $this->addStream($name, $input);
        } finally { fclose($input); }
    }

    private function addStream(string $name, $input): array
    {
        if (count($this->entries) >= 60000 || !preg_match('~\A(?:applications\.jsonl|schema\.sql|manifest\.json|uploads/(?:documents|letters)/[A-Za-z0-9][A-Za-z0-9._-]*)\z~D', $name)) {
            throw new RuntimeException('Nama atau jumlah berkas backup tidak valid.');
        }
        $offset = $this->position;
        $year = max(1980, (int)gmdate('Y'));
        $date = (($year - 1980) << 9) | ((int)gmdate('n') << 5) | (int)gmdate('j');
        $time = ((int)gmdate('G') << 11) | ((int)gmdate('i') << 5) | intdiv((int)gmdate('s'), 2);
        $flags = 0x0808; // UTF-8 filenames and streamed CRC/size descriptor.
        $this->write(pack('VvvvvvVVVvv', 0x04034b50, 20, $flags, 0, $time, $date, 0, 0, 0, strlen($name), 0) . $name);
        $crc = hash_init('crc32b');
        $sha = hash_init('sha256');
        $size = 0;
        while (!feof($input)) {
            $chunk = fread($input, 65536);
            if ($chunk === false) throw new RuntimeException('Pembacaan dokumen backup gagal.');
            if ($chunk === '') {
                if (!feof($input)) throw new RuntimeException('Dokumen backup terhenti saat dibaca.');
                break;
            }
            $size += strlen($chunk);
            hash_update($crc, $chunk);
            hash_update($sha, $chunk);
            $this->write($chunk);
        }
        $crcBytes = strrev(hash_final($crc, true));
        $this->write(pack('V', 0x08074b50) . $crcBytes . pack('VV', $size, $size));
        $this->entries[] = compact('name', 'offset', 'time', 'date', 'flags', 'crcBytes', 'size');
        return ['path' => $name, 'size' => $size, 'sha256' => hash_final($sha)];
    }

    public function finish(): void
    {
        $centralStart = $this->position;
        foreach ($this->entries as $entry) {
            $this->write(pack('Vvvvvvv', 0x02014b50, 20, 20, $entry['flags'], 0, $entry['time'], $entry['date'])
                . $entry['crcBytes'] . pack('VVvvvvvVV', $entry['size'], $entry['size'], strlen($entry['name']), 0, 0, 0, 0, 0, $entry['offset']) . $entry['name']);
        }
        $count = count($this->entries);
        $this->write(pack('VvvvvVVv', 0x06054b50, 0, 0, $count, $count, $this->position - $centralStart, $centralStart, 0));
        if (!fflush($this->stream)) throw new RuntimeException('Arsip backup belum tersimpan lengkap.');
        fclose($this->stream);
        $this->stream = null;
    }

    public function __destruct()
    {
        if (is_resource($this->stream)) fclose($this->stream);
    }
}

function school_backup_root(): string
{
    return rtrim((string)(getenv('AMANA_BACKUP_DIR') ?: '/data/backups'), '/');
}

function school_backup_metadata(string $id): array
{
    if (!preg_match('/\Aamanah-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}\z/D', $id)) api_error(404, 'Backup tidak ditemukan.');
    $root = school_backup_root();
    $path = $root . '/' . $id . '.json';
    if (!is_file($path) || !is_file($root . '/' . $id . '.zip')) api_error(404, 'Backup tidak ditemukan.');
    $meta = json_decode((string)file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($meta) || ($meta['id'] ?? '') !== $id) throw new RuntimeException('Metadata backup tidak valid.');
    return $meta;
}

function school_backup_list(): array
{
    $root = school_backup_root();
    if (!is_dir($root)) return [];
    $names = scandir($root, SCANDIR_SORT_DESCENDING);
    if ($names === false) throw new RuntimeException('Daftar backup tidak dapat dibaca.');
    $backups = [];
    foreach ($names as $name) {
        if (!preg_match('/\A(amanah-[0-9]{8}-[0-9]{6}-[a-f0-9]{8})\.json\z/D', $name, $match)) continue;
        $backups[] = school_backup_metadata($match[1]);
        if (count($backups) >= 20) break;
    }
    return $backups;
}

function school_backup_create(): array
{
    $root = school_backup_root();
    $remote = supabase_enabled();
    $connection = $remote ? null : db();
    $lockDirectory = $root . '/.supabase-backup.lock';
    if ($remote) {
        if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) throw new RuntimeException('Penyimpanan backup tidak tersedia.');
        if (!@mkdir($lockDirectory, 0700)) api_error(409, 'Backup lain sedang dibuat atau tertunda. Hubungi administrator jika status tidak berubah.');
    } else {
        $lock = $connection->query("SELECT GET_LOCK('amanah_complete_backup', 0) AS acquired")->fetch_assoc();
        if ((int)($lock['acquired'] ?? 0) !== 1) api_error(409, 'Backup lain sedang dibuat. Tunggu sebentar lalu muat ulang daftar backup.');
    }
    $id = 'amanah-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4));
    $partial = $root . '/.' . $id . '.partial';
    $snapshot = false;
    $zip = null;
    $jsonl = null;
    $transaction = false;
    $result = null;
    try {
        @set_time_limit(180);
        if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) throw new RuntimeException('Penyimpanan backup tidak tersedia.');
        $snapshot = tempnam(sys_get_temp_dir(), 'amanah-records-');
        if ($snapshot === false) throw new RuntimeException('Snapshot backup tidak tersedia.');
        $jsonl = fopen($snapshot, 'wb');
        if (!$jsonl) throw new RuntimeException('Snapshot backup gagal dibuat.');
        if (!$remote) {
            $connection->begin_transaction(MYSQLI_TRANS_START_WITH_CONSISTENT_SNAPSHOT | MYSQLI_TRANS_START_READ_ONLY);
            $transaction = true;
        }
        $createdAt = gmdate('Y-m-d\TH:i:s\Z');
        if ($remote) {
            $remoteSnapshot = supabase_rpc('snapshot');
            $remoteRows = $remoteSnapshot['rows'];
            $rowIndex = 0;
        } else {
            $result = $connection->query('SELECT tracking_code, record_json, submitted_at, updated_at FROM applications ORDER BY tracking_code', MYSQLI_USE_RESULT);
        }
        $uploads = [];
        $count = 0;
        $uploadRoot = rtrim((string)(getenv('AMANA_DATA_DIR') ?: '/data/uploads'), '/');
        while ($row = ($remote ? ($remoteRows[$rowIndex++] ?? null) : $result->fetch_assoc())) {
            $record = $remote ? $row['record_json'] : json_decode_record($row['record_json']);
            if ($remote) {
                foreach (['submitted_at', 'updated_at'] as $field) {
                    $row[$field] = (new DateTimeImmutable($row[$field]))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
                }
            }
            $line = json_encode(['tracking_code' => $row['tracking_code'], 'record' => $record,
                'submitted_at' => $row['submitted_at'], 'updated_at' => $row['updated_at']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
            if (fwrite($jsonl, $line) !== strlen($line)) throw new RuntimeException('Snapshot data tidak lengkap.');
            $count++;
            foreach (['documentPath' => 'documents', 'letterPath' => 'letters', 'originalLetterPath' => 'letters'] as $field => $folder) {
                $name = (string)($record[$field] ?? '');
                if ($name === '') continue;
                if (!preg_match('/\A[A-Za-z0-9][A-Za-z0-9._-]*\z/D', $name)) throw new RuntimeException('Referensi dokumen backup tidak valid.');
                $path = $remote ? read_upload_file($folder, $name)[0] : $uploadRoot . '/' . $folder . '/' . $name;
                if (!is_file($path) || !is_readable($path) || is_link($path)) throw new RuntimeException('Ada dokumen yang hilang atau tidak dapat dibaca; backup lengkap belum dapat dibuat.');
                $uploads['uploads/' . $folder . '/' . $name] = $path;
            }
        }
        if ($result) $result->free();
        $result = null;
        $revision = $remote ? ['revision' => $remoteSnapshot['revision']] : $connection->query('SELECT revision FROM application_sync WHERE id = 1')->fetch_assoc();
        $connection?->commit();
        $transaction = false;
        fclose($jsonl);
        $jsonl = null;
        $zip = new SchoolBackupZip($partial);
        $entries = [$zip->addFile('applications.jsonl', $snapshot)];
        $schema = $remote ? (is_file('/config/schema-supabase.sql') ? '/config/schema-supabase.sql' : dirname(__DIR__) . '/config/schema-supabase.sql')
            : (is_file('/config/schema.sql') ? '/config/schema.sql' : dirname(__DIR__) . '/schema.sql');
        $entries[] = $zip->addFile('schema.sql', $schema);
        foreach ($uploads as $name => $path) $entries[] = $zip->addFile($name, $path);
        $manifest = ['format' => 'smk-amanah-backup', 'version' => 1, 'createdAt' => $createdAt,
            'applicationCount' => $count, 'documentCount' => count($uploads),
            'snapshotRevision' => (string)$revision['revision'], 'databaseProvider' => $remote ? 'supabase' : 'mysql', 'files' => $entries];
        $zip->addText('manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        $zip->finish();
        $zip = null;
        $metadata = ['id' => $id, 'createdAt' => $createdAt, 'applicationCount' => $count,
            'documentCount' => count($uploads), 'bytes' => filesize($partial), 'sha256' => hash_file('sha256', $partial)];
        $metadataJson = json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (file_put_contents($partial . '.json', $metadataJson, LOCK_EX) !== strlen($metadataJson)) throw new RuntimeException('Metadata backup belum tersimpan lengkap.');
        if (!rename($partial, $root . '/' . $id . '.zip') || !rename($partial . '.json', $root . '/' . $id . '.json')) throw new RuntimeException('Backup belum dapat dipublikasikan.');
        return $metadata;
    } finally {
        if ($result instanceof mysqli_result) $result->free();
        if ($transaction) $connection->rollback();
        if (is_resource($jsonl)) fclose($jsonl);
        $zip = null;
        if (is_string($snapshot) && is_file($snapshot)) @unlink($snapshot);
        if (is_file($partial)) @unlink($partial);
        if (is_file($partial . '.json')) @unlink($partial . '.json');
        if ($remote) @rmdir($lockDirectory);
        else $connection->query("SELECT RELEASE_LOCK('amanah_complete_backup')");
    }
}

function school_backup_download(string $id): never
{
    $meta = school_backup_metadata($id);
    $path = school_backup_root() . '/' . $id . '.zip';
    if (filesize($path) !== (int)$meta['bytes']) throw new RuntimeException('Arsip backup tidak lengkap.');
    header('Content-Type: application/zip');
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: attachment; filename="' . $id . '.zip"');
    header('X-Backup-SHA256: ' . $meta['sha256']);
    readfile($path);
    exit;
}
