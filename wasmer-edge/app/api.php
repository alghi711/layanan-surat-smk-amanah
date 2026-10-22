<?php
declare(strict_types=1);

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
require_once __DIR__ . '/principal.php';
require_once __DIR__ . '/supabase.php';

final class ApiException extends RuntimeException
{
    public function __construct(public readonly int $httpStatus, string $message, public readonly array $details = [])
    {
        parent::__construct($message);
    }
}

function api_error(int $status, string $message): never
{
    throw new ApiException($status, $message);
}

function json_response(array $payload, int $status = 200, array $headers = []): never
{
    header('Server-Timing: app;dur=' . round((microtime(true) - (float)($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true))) * 1000, 2), false);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    foreach ($headers as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function db(): mysqli
{
    $startedAt = microtime(true);
    static $connection = null;
    static $schemaReady = false;
    if ($connection instanceof mysqli && $schemaReady) {
        return $connection;
    }

    foreach (['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD'] as $key) {
        if (getenv($key) === false || getenv($key) === '') {
            throw new RuntimeException('Database Wasmer belum dikonfigurasi.');
        }
    }

    $connection = mysqli_init();
    if (!$connection) {
        throw new RuntimeException('Koneksi database tidak dapat dimulai.');
    }
    $connection->options(MYSQLI_OPT_CONNECT_TIMEOUT, 5);
    $connection->options(MYSQLI_SET_CHARSET_NAME, 'utf8mb4');
    $connection->ssl_set(null, null, null, null, null);
    $sslFlags = MYSQLI_CLIENT_SSL;
    if (defined('MYSQLI_CLIENT_SSL_DONT_VERIFY_SERVER_CERT')) {
        $sslFlags |= constant('MYSQLI_CLIENT_SSL_DONT_VERIFY_SERVER_CERT');
    }
    $connection->real_connect(
        (getenv('AMANA_DB_PERSISTENT') === '0' ? '' : 'p:') . (string)getenv('DB_HOST'),
        (string)getenv('DB_USERNAME'),
        (string)getenv('DB_PASSWORD'),
        (string)getenv('DB_NAME'),
        (int)getenv('DB_PORT'),
        null,
        $sslFlags
    );
    $connection->query("SET time_zone = '+00:00'");

    // PHP resets userland statics for each HTTP request. Bootstrap only once
    // per instance/database/schema version, rather than running DDL on every poll.
    $schemaMarker = sys_get_temp_dir() . '/amanah-schema-v2-' . hash('sha256',
        (string)getenv('DB_HOST') . '|' . (string)getenv('DB_PORT') . '|' . (string)getenv('DB_NAME'));
    if (!is_file($schemaMarker)) {
        $connection->query("CREATE TABLE IF NOT EXISTS applications (
            tracking_code VARCHAR(80) NOT NULL PRIMARY KEY,
            record_json JSON NOT NULL,
            submitted_at DATETIME(6) NOT NULL,
            updated_at DATETIME(6) NOT NULL,
            INDEX applications_submitted_idx (submitted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $connection->query("CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash CHAR(64) NOT NULL PRIMARY KEY,
            username VARCHAR(120) NOT NULL,
            role VARCHAR(16) NOT NULL DEFAULT '',
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX sessions_expiry_idx (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $connection->query("CREATE TABLE IF NOT EXISTS login_attempts (
            bucket CHAR(64) NOT NULL PRIMARY KEY,
            failures INT NOT NULL DEFAULT 0,
            window_started DATETIME NOT NULL,
            locked_until DATETIME NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $connection->query("CREATE TABLE IF NOT EXISTS application_sync (
            id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
            revision BIGINT UNSIGNED NOT NULL DEFAULT 0
        ) ENGINE=InnoDB");
        $connection->query('INSERT IGNORE INTO application_sync (id, revision) VALUES (1, 0)');
        // A read-only temp directory only disables this optimization.
        @file_put_contents($schemaMarker, 'ready', LOCK_EX);
    }
    $schemaReady = true;
    header('Server-Timing: db;dur=' . round((microtime(true) - $startedAt) * 1000, 2), false);
    return $connection;
}

function advance_application_revision(mysqli $connection): void
{
    // Run within the same transaction as the application write, so a dashboard
    // never acknowledges a new revision before its application is committed.
    $connection->query('UPDATE application_sync SET revision = revision + 1 WHERE id = 1');
}

function request_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        api_error(400, 'Isi permintaan tidak valid.');
    }
    try {
        $payload = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        api_error(400, 'Format data tidak valid.');
    }
    if (!is_array($payload)) {
        api_error(400, 'Format data tidak valid.');
    }
    return $payload;
}

function staff_accounts(): array
{
    static $accounts = null;
    if ($accounts !== null) return $accounts;
    $configured = [];
    foreach (['tu' => 'AMANA_TU', 'principal' => 'AMANA_PRINCIPAL'] as $role => $prefix) {
        $username = trim((string)getenv($prefix . '_USER'));
        $password = (string)getenv($prefix . '_PASSWORD');
        if (getenv('AMANA_ENV') !== 'production') {
            $username = $username !== '' ? $username : ($role === 'tu' ? 'tu' : 'kepsek');
            $password = $password !== '' ? $password : ($role === 'tu' ? 'TU-local-amanah123!' : 'Kepsek-local-amanah123!');
        }
        if ($username === '' || mb_strlen($username, 'UTF-8') > 80 || strlen($password) < 16) {
            api_error(503, 'Akun TU dan Kepala Sekolah belum lengkap. Atur username serta password minimal 16 karakter untuk kedua akun di Wasmer.');
        }
        $configured[$role] = ['username' => $username, 'password' => $password];
    }
    if (mb_strtolower($configured['tu']['username'], 'UTF-8') === mb_strtolower($configured['principal']['username'], 'UTF-8')
        || hash_equals($configured['tu']['password'], $configured['principal']['password'])) {
        api_error(503, 'Username dan password TU harus berbeda dari akun Kepala Sekolah.');
    }
    return $accounts = $configured;
}

function validate_runtime_config(): void
{
    staff_accounts();
}

function session_cookie(string $token, int $maxAge = 28800): string
{
    return 'amanah_session=' . $token . '; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=' . $maxAge;
}

function session_token_hash(string $token): string
{
    // Separate-account credentials invalidate every session created by the shared admin login.
    $key = hash('sha256', 'staff-accounts-v1:' . json_encode(staff_accounts(), JSON_THROW_ON_ERROR), true);
    return hash_hmac('sha256', $token, $key);
}

function current_session(): ?array
{
    $token = (string)($_COOKIE['amanah_session'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{40,60}$/', $token)) {
        return null;
    }
    $hash = session_token_hash($token);
    if (supabase_enabled()) return supabase_rpc('session', ['hash' => $hash]);
    $stmt = db()->prepare('SELECT username, role, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()');
    $stmt->bind_param('s', $hash);
    $stmt->execute();
    $stmt->bind_result($username, $role, $expiresAt);
    $row = $stmt->fetch() ? ['username' => $username, 'role' => $role, 'expires_at' => $expiresAt] : null;
    $stmt->close();
    return $row ?: null;
}

function require_staff(): array
{
    try {
        $session = current_session();
    } catch (Throwable $error) {
        error_log('Database session check failed: ' . $error->getMessage());
        api_error(503, 'Layanan petugas sementara tidak tersedia.');
    }
    if (!$session || !in_array($session['role'], ['tu', 'principal'], true)) {
        api_error(401, 'Login petugas diperlukan.');
    }
    return $session;
}

function request_ip(): string
{
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : 'unknown';
}

function check_login_rate(string $username): array
{
    $bucket = hash('sha256', request_ip() . '|' . mb_strtolower($username, 'UTF-8'));
    if (supabase_enabled()) {
        $row = supabase_rpc('login_rate', ['bucket' => $bucket]);
        if (!empty($row['locked_until']) && strtotime($row['locked_until']) > time()) api_error(429, 'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.');
        return [$bucket, !empty($row['window_started']) && strtotime($row['window_started']) > time() - 900 ? (int)$row['failures'] : 0];
    }
    $db = db();
    $stmt = $db->prepare('SELECT failures, window_started, locked_until FROM login_attempts WHERE bucket = ?');
    $stmt->bind_param('s', $bucket);
    $stmt->execute();
    $stmt->bind_result($failuresValue, $windowStarted, $lockedUntil);
    $row = $stmt->fetch() ? ['failures' => $failuresValue, 'window_started' => $windowStarted, 'locked_until' => $lockedUntil] : null;
    $stmt->close();
    if ($row && $row['locked_until'] && strtotime($row['locked_until'] . ' UTC') > time()) {
        api_error(429, 'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.');
    }
    if (!$row || strtotime($row['window_started'] . ' UTC') < time() - 900) {
        return [$bucket, 0];
    }
    return [$bucket, (int)$row['failures']];
}

function record_login_failure(string $bucket, int $failures): never
{
    if (supabase_enabled()) {
        $row = supabase_rpc('login_failure', ['bucket' => $bucket]);
        if ((int)$row['failures'] >= 8) api_error(429, 'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.');
        api_error(401, 'Username atau password salah.');
    }
    $db = db();
    $lockedUntil = $failures >= 8 ? gmdate('Y-m-d H:i:s', time() + 900) : null;
    $stmt = $db->prepare("INSERT INTO login_attempts (bucket, failures, window_started, locked_until)
        VALUES (?, ?, UTC_TIMESTAMP(), ?)
        ON DUPLICATE KEY UPDATE failures = VALUES(failures),
            window_started = IF(window_started < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), UTC_TIMESTAMP(), window_started),
            locked_until = VALUES(locked_until)");
    $stmt->bind_param('sis', $bucket, $failures, $lockedUntil);
    $stmt->execute();
    $stmt->close();
    if ($failures >= 8) {
        api_error(429, 'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.');
    }
    api_error(401, 'Username atau password salah.');
}

function json_decode_record(string $value): array
{
    $record = json_decode($value, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($record)) {
        throw new RuntimeException('Record pengajuan tidak valid.');
    }
    return $record;
}

function fetch_record(string $code, bool $forUpdate = false): ?array
{
    if (supabase_enabled()) return supabase_rpc('record', ['code' => $code]);
    $sql = 'SELECT record_json FROM applications WHERE tracking_code = ?' . ($forUpdate ? ' FOR UPDATE' : '');
    $stmt = db()->prepare($sql);
    $stmt->bind_param('s', $code);
    $stmt->execute();
    $stmt->bind_result($recordJson);
    $row = $stmt->fetch() ? ['record_json' => $recordJson] : null;
    $stmt->close();
    return $row ? json_decode_record($row['record_json']) : null;
}

function text_field(array $payload, string $key, int $max, bool $required = true): string
{
    $value = trim((string)($payload[$key] ?? ''));
    if ($required && $value === '') {
        api_error(400, 'Field ' . $key . ' wajib diisi.');
    }
    if (mb_strlen($value, 'UTF-8') > $max) {
        api_error(400, 'Field ' . $key . ' terlalu panjang.');
    }
    return $value;
}

function decode_upload(array $payload, string $nameKey, string $dataKey, int $maxBytes): ?array
{
    $encoded = (string)($payload[$dataKey] ?? '');
    if ($encoded === '') {
        return null;
    }
    if (strlen($encoded) > (int)ceil($maxBytes * 4 / 3) + 8) {
        api_error(400, 'Ukuran file melebihi batas.');
    }
    $bytes = base64_decode($encoded, true);
    if ($bytes === false || $bytes === '' || strlen($bytes) > $maxBytes) {
        api_error(400, 'File tidak valid atau melebihi batas ukuran.');
    }
    $name = basename(str_replace('\\', '/', (string)($payload[$nameKey] ?? 'file')));
    $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $signatureOk = match ($extension) {
        'pdf' => str_starts_with($bytes, '%PDF-'),
        'jpg', 'jpeg' => strlen($bytes) >= 3 && substr($bytes, 0, 3) === "\xFF\xD8\xFF",
        'png' => strlen($bytes) >= 8 && substr($bytes, 0, 8) === "\x89PNG\r\n\x1A\n",
        default => false,
    };
    if (!$signatureOk) {
        api_error(400, 'Format file harus PDF, JPG, atau PNG yang valid.');
    }
    return ['name' => $name, 'extension' => $extension === 'jpeg' ? 'jpg' : $extension, 'bytes' => $bytes];
}

function save_upload(array $upload, string $folder, string $code): string
{
    if (supabase_enabled()) return supabase_upload($upload, $folder, $code);
    $base = getenv('AMANA_DATA_DIR');
    if (!$base) {
        $base = getenv('AMANA_ENV') === 'production' ? '/data/uploads' : dirname(__DIR__, 2) . '/data/uploads';
    }
    $directory = rtrim($base, '/') . '/' . $folder;
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
        throw new RuntimeException('Penyimpanan dokumen tidak tersedia.');
    }
    // Immutable filenames keep snapshot backups consistent while new files arrive.
    $storedName = $code . '-' . bin2hex(random_bytes(8)) . '.' . $upload['extension'];
    $target = $directory . '/' . $storedName;
    $temp = $target . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($temp, $upload['bytes'], LOCK_EX) !== strlen($upload['bytes']) || !rename($temp, $target)) {
        @unlink($temp);
        throw new RuntimeException('File gagal disimpan.');
    }
    return $storedName;
}

function read_upload_file(string $folder, string $storedName): array
{
    if (supabase_enabled()) return supabase_read_upload($folder, $storedName);
    if ($storedName === '' || basename($storedName) !== $storedName) {
        api_error(404, 'File tidak ditemukan.');
    }
    $base = getenv('AMANA_DATA_DIR');
    if (!$base) {
        $base = getenv('AMANA_ENV') === 'production' ? '/data/uploads' : dirname(__DIR__, 2) . '/data/uploads';
    }
    $path = rtrim($base, '/') . '/' . $folder . '/' . $storedName;
    if (!is_file($path) || !is_readable($path)) {
        api_error(404, 'File tidak ditemukan.');
    }
    $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $mime = match ($extension) {
        'pdf' => 'application/pdf',
        'jpg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        default => 'application/octet-stream',
    };
    return [$path, $mime];
}

function file_response(array $record, string $kind, bool $previewData = false): never
{
    $isLetter = $kind === 'letter';
    $storedName = (string)($record[$isLetter ? 'letterPath' : 'documentPath'] ?? '');
    $displayName = basename((string)($record[$isLetter ? 'letterName' : 'documentName'] ?? $storedName));
    [$path, $mime] = read_upload_file($isLetter ? 'letters' : 'documents', $storedName);
    if ($previewData) {
        json_response(['mime' => $mime, 'base64' => base64_encode(file_get_contents($path))]);
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $displayName) . '"; filename*=UTF-8\'\'' . rawurlencode($displayName));
    readfile($path);
    exit;
}

function duplicate_student_id(string $value): string
{
    return mb_strtoupper((string)preg_replace('/[\s.\-]+/u', '', trim($value)), 'UTF-8');
}

function duplicate_phone(string $value): string
{
    $digits = (string)preg_replace('/\D/', '', $value);
    if (str_starts_with($digits, '00')) return substr($digits, 2);
    if (str_starts_with($digits, '0')) return '62' . substr($digits, 1);
    if (str_starts_with($digits, '8')) return '62' . $digits;
    return $digits;
}

function api(): never
{
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (getenv('AMANA_MIGRATING') === '1' && $method === 'POST' && in_array($path, ['/api/applications', '/api/admin/update', '/api/admin/letter-draft'], true)) {
        api_error(503, 'Pemindahan penyimpanan sedang berlangsung. Tunggu sebentar lalu coba kembali; data yang sudah tersimpan tetap tersedia.');
    }
    $db = supabase_enabled() ? null : db();
    if ($method === 'GET' && $path === '/api/admin/signing-asset') principal_signing_asset((string)($_GET['kind'] ?? ''));
    if ($method === 'GET' && $path === '/api/admin/supabase-health') {
        require_staff();
        json_response(supabase_health());
    }

    if (in_array($path, ['/api/admin/backups', '/api/admin/backups/download'], true)) {
        require_staff();
        require_once __DIR__ . '/backup.php';
        if ($path === '/api/admin/backups' && $method === 'GET') {
            json_response(['backups' => school_backup_list(), 'schedule' => '24h']);
        }
        if ($path === '/api/admin/backups' && $method === 'POST') {
            json_response(['ok' => true, 'backup' => school_backup_create()], 201);
        }
        if ($path === '/api/admin/backups/download' && $method === 'GET') {
            school_backup_download((string)($_GET['id'] ?? ''));
        }
        api_error(405, 'Metode backup tidak didukung.');
    }

    if ($method === 'GET' && $path === '/api/health') {
        if (supabase_enabled()) json_response(supabase_health());
        $db->query('SELECT 1');
        $base = getenv('AMANA_DATA_DIR') ?: (getenv('AMANA_ENV') === 'production' ? '/data/uploads' : dirname(__DIR__, 2) . '/data/uploads');
        foreach ([$base . '/documents', $base . '/letters'] as $directory) {
            if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
                api_error(503, 'Penyimpanan file belum tersedia.');
            }
        }
        json_response(['ok' => true, 'storage' => 'mysql-and-private-volume']);
    }

    if ($method === 'POST' && $path === '/api/login') {
        validate_runtime_config();
        $payload = request_json();
        $username = trim((string)($payload['username'] ?? ''));
        $password = (string)($payload['password'] ?? '');
        [$bucket, $failures] = check_login_rate($username);
        $accountRole = '';
        $expectedUser = '';
        foreach (staff_accounts() as $role => $account) {
            $matchesUser = hash_equals(mb_strtolower($account['username'], 'UTF-8'), mb_strtolower($username, 'UTF-8'));
            $matchesPassword = hash_equals($account['password'], $password);
            if ($matchesUser && $matchesPassword) { $accountRole = $role; $expectedUser = $account['username']; }
        }
        if ($accountRole === '') {
            record_login_failure($bucket, $failures + 1);
        }
        if (supabase_enabled()) {
            $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
            $previousToken = (string)($_COOKIE['amanah_session'] ?? '');
            supabase_rpc('login_success', ['hash' => session_token_hash($token), 'username' => $expectedUser,
                'previousHash' => preg_match('/^[A-Za-z0-9_-]{40,60}$/', $previousToken) ? session_token_hash($previousToken) : '', 'bucket' => $bucket]);
            // The cookie is issued only after the server has assigned the credential's fixed role.
            supabase_rpc('role', ['hash' => session_token_hash($token), 'role' => $accountRole]);
            json_response(['ok' => true, 'role' => $accountRole], 200, ['Set-Cookie' => session_cookie($token)]);
        }
        $db->query('DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP()');
        $db->query('DELETE FROM login_attempts WHERE window_started < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)');
        $stmt = $db->prepare('DELETE FROM login_attempts WHERE bucket = ?');
        $stmt->bind_param('s', $bucket);
        $stmt->execute();
        $stmt->close();
        $previousToken = (string)($_COOKIE['amanah_session'] ?? '');
        if (preg_match('/^[A-Za-z0-9_-]{40,60}$/', $previousToken)) {
            $previousHash = session_token_hash($previousToken);
            $stmt = $db->prepare('DELETE FROM admin_sessions WHERE token_hash = ?');
            $stmt->bind_param('s', $previousHash);
            $stmt->execute();
            $stmt->close();
        }
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $hash = session_token_hash($token);
        $stmt = $db->prepare('INSERT INTO admin_sessions (token_hash, username, role, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))');
        $stmt->bind_param('sss', $hash, $expectedUser, $accountRole);
        $stmt->execute();
        $stmt->close();
        json_response(['ok' => true, 'role' => $accountRole], 200, ['Set-Cookie' => session_cookie($token)]);
    }

    if ($method === 'GET' && $path === '/api/session') {
        $session = current_session();
        json_response(['authenticated' => (bool)$session, 'role' => $session['role'] ?? '']);
    }

    if ($method === 'POST' && $path === '/api/logout') {
        $token = (string)($_COOKIE['amanah_session'] ?? '');
        if (preg_match('/^[A-Za-z0-9_-]{40,60}$/', $token)) {
            $hash = session_token_hash($token);
            if (supabase_enabled()) {
                supabase_rpc('logout', ['hash' => $hash]);
                json_response(['ok' => true], 200, ['Set-Cookie' => session_cookie('', 0)]);
            }
            $stmt = $db->prepare('DELETE FROM admin_sessions WHERE token_hash = ?');
            $stmt->bind_param('s', $hash);
            $stmt->execute();
            $stmt->close();
        }
        json_response(['ok' => true], 200, ['Set-Cookie' => session_cookie('', 0)]);
    }

    if ($method === 'POST' && $path === '/api/select-role') {
        try {
            $session = current_session();
        } catch (Throwable $error) {
            error_log('Database role check failed: ' . $error->getMessage());
            api_error(503, 'Layanan petugas sementara tidak tersedia.');
        }
        if (!$session) {
            api_error(401, 'Silakan login kembali.');
        }
        $payload = request_json();
        $role = (string)($payload['role'] ?? '');
        if (!in_array($role, ['tu', 'principal'], true)) {
            api_error(400, 'Peran tidak valid.');
        }
        if ($role !== $session['role']) api_error(403, 'Akun ini tidak dapat berganti peran. Login dengan akun petugas yang sesuai.');
        json_response(['ok' => true, 'role' => $role]);
    }

    if ($method === 'GET' && $path === '/api/track') {
        $code = strtoupper(trim((string)($_GET['code'] ?? '')));
        if ($code === '' || strlen($code) > 80) {
            api_error(404, 'Nomor pelacakan tidak ditemukan.');
        }
        $record = fetch_record($code);
        if (!$record) {
            api_error(404, 'Nomor pelacakan tidak ditemukan.');
        }
        $publicNote = ($record['status'] ?? '') === 'Ditolak Kepala Sekolah'
            ? (string)($record['principalNote'] ?? '')
            : (string)($record['note'] ?? '');
        json_response([
            'code' => $record['code'], 'student' => $record['student'] ?? '',
            'className' => $record['className'] ?? '', 'type' => $record['type'] ?? '',
            'purpose' => $record['purpose'] ?? '', 'status' => $record['status'] ?? '',
            'note' => $publicNote, 'hasLetter' => !empty($record['letterPath']),
            'letterName' => $record['letterName'] ?? '', 'submittedAt' => $record['submittedAt'] ?? '',
            'updatedAt' => $record['updatedAt'] ?? '', 'history' => array_values(array_filter($record['history'] ?? [], static fn($event) => is_array($event) && !empty($event['status']) && !empty($event['at'])))
        ]);
    }

    if ($method === 'GET' && $path === '/api/admin/applications') {
        if (supabase_enabled() && getenv('AMANA_DASHBOARD_BATCH') === '1') {
            $token = (string)($_COOKIE['amanah_session'] ?? '');
            if (!preg_match('/^[A-Za-z0-9_-]{40,60}$/', $token)) api_error(401, 'Login petugas diperlukan.');
            $dashboard = supabase_rpc('dashboard', ['hash' => session_token_hash($token), 'etag' => trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''))]);
            $etag = '"applications-v5-supabase-' . (string)$dashboard['revision'] . '"';
            header('ETag: ' . $etag);
            if ($dashboard['records'] === null) { http_response_code(304); exit; }
            json_response($dashboard['records']);
        }
        require_staff();
        if (supabase_enabled()) {
            $records = supabase_rpc('list');
            $etag = '"applications-v4-supabase-' . hash('sha256', json_encode($records, JSON_THROW_ON_ERROR)) . '"';
        } else {
            $sync = $db->query('SELECT revision FROM application_sync WHERE id = 1')->fetch_assoc();
            $etag = '"applications-v3-mysql-' . (string)$sync['revision'] . '"';
        }
        header('ETag: ' . $etag);
        if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
            header('Server-Timing: app;dur=' . round((microtime(true) - (float)($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true))) * 1000, 2), false);
            http_response_code(304);
            exit;
        }
        if (supabase_enabled()) json_response($records);
        $result = $db->query('SELECT record_json FROM applications ORDER BY submitted_at DESC');
        $records = [];
        while ($row = $result->fetch_assoc()) {
            $records[] = json_decode_record($row['record_json']);
        }
        json_response($records);
    }

    if ($method === 'GET' && in_array($path, ['/api/admin/document', '/api/letter'], true)) {
        $kind = $path === '/api/letter' ? 'letter' : (string)($_GET['kind'] ?? '');
        if ($path === '/api/admin/document') {
            require_staff();
            if (!in_array($kind, ['support', 'letter'], true)) {
                api_error(400, 'Jenis dokumen tidak valid.');
            }
        }
        $code = strtoupper(trim((string)($_GET['code'] ?? '')));
        $record = $code !== '' ? fetch_record($code) : null;
        if (!$record) {
            api_error(404, 'File tidak ditemukan.');
        }
        if ($path === '/api/letter' && ($record['status'] ?? '') !== 'Selesai') {
            api_error(404, 'Surat belum tersedia.');
        }
        file_response($record, $kind === 'support' ? 'document' : 'letter', $path === '/api/admin/document' && ($_GET['format'] ?? '') === 'base64');
    }

    if ($method === 'POST' && $path === '/api/applications') {
        $payload = request_json();
        $fields = [
            'parent' => text_field($payload, 'parent', 80),
            'phone' => text_field($payload, 'phone', 20),
            'email' => text_field($payload, 'email', 120, false),
            'relation' => text_field($payload, 'relation', 20),
            'student' => text_field($payload, 'student', 80),
            'nis' => text_field($payload, 'nis', 20),
            'className' => text_field($payload, 'className', 4),
            'major' => text_field($payload, 'major', 5),
            'type' => text_field($payload, 'type', 80),
            'purpose' => text_field($payload, 'purpose', 500),
        ];
        if ($fields['email'] !== '' && !filter_var($fields['email'], FILTER_VALIDATE_EMAIL)) {
            api_error(400, 'Format email tidak valid.');
        }
        if (!in_array($fields['className'], ['X', 'XI', 'XII'], true) || !in_array($fields['major'], ['TKJ 1', 'TKJ 2', 'TKR 1', 'TKR 2', 'MP', 'TKJ', 'TKR'], true)) {
            api_error(400, 'Kelas atau jurusan tidak valid.');
        }
        if (!in_array($fields['relation'], ['Ayah', 'Ibu', 'Wali'], true)) {
            api_error(400, 'Hubungan dengan siswa tidak valid.');
        }
        $types = ['Surat keterangan siswa', 'Surat keterangan aktif sekolah', 'Surat pengantar', 'Surat izin', 'Surat rekomendasi', 'Lainnya'];
        if (!in_array($fields['type'], $types, true) || mb_strlen($fields['purpose'], 'UTF-8') < 10) {
            api_error(400, 'Jenis surat atau keperluan tidak valid.');
        }
        $upload = decode_upload($payload, 'documentName', 'documentBase64', 5 * 1024 * 1024);
        $identity = duplicate_student_id($fields['nis']);
        if ($identity === '') api_error(400, 'NIS / NISN tidak valid.');
        if (supabase_enabled()) supabase_create_application($fields, $upload);
        $lockName = 'request:' . substr(hash('sha256', $identity . '|' . $fields['type']), 0, 56);
        $lock = $db->prepare('SELECT GET_LOCK(?, 5) AS acquired');
        $lock->bind_param('s', $lockName);
        $lock->execute();
        $acquired = (int)($lock->get_result()->fetch_assoc()['acquired'] ?? 0);
        $lock->close();
        if ($acquired !== 1) api_error(409, 'Pengajuan untuk siswa ini sedang disimpan. Tunggu sebentar lalu coba kembali.');
        $transactionStarted = false;
        $storedName = '';
        try {
            $db->begin_transaction();
            $transactionStarted = true;
            $pending = $db->query("SELECT record_json FROM applications WHERE JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.status')) IN ('Menunggu konfirmasi TU', 'Disetujui Tata Usaha', 'Menunggu persetujuan Kepala Sekolah') ORDER BY submitted_at DESC");
            while ($row = $pending->fetch_assoc()) {
                $existing = json_decode_record($row['record_json']);
                if (duplicate_student_id((string)($existing['nis'] ?? '')) !== $identity || ($existing['type'] ?? '') !== $fields['type']) continue;
                $details = ['duplicate' => true];
                $message = 'Siswa dengan NIS / NISN ini masih memiliki pengajuan jenis surat yang sama dalam proses. Silakan hubungi Tata Usaha jika membutuhkan bantuan.';
                if (duplicate_phone($fields['phone']) !== '' && duplicate_phone($fields['phone']) === duplicate_phone((string)($existing['phone'] ?? ''))) {
                    $details['code'] = (string)$existing['code'];
                    $details['status'] = (string)$existing['status'];
                    $message = 'Pengajuan jenis surat ini masih diproses untuk siswa tersebut. Gunakan nomor pelacakan yang sudah ada.';
                }
                $pending->free();
                throw new ApiException(409, $message, $details);
            }
            $pending->free();
            do {
                $code = 'SA-' . gmdate('Ym') . '-' . bin2hex(random_bytes(16));
            } while (fetch_record($code, true));
            $now = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM);
            $record = array_merge($fields, [
                'code' => $code,
                'className' => $fields['className'] . ' ' . $fields['major'],
                'documentName' => $upload['name'] ?? '', 'documentPath' => '',
                'status' => 'Menunggu konfirmasi TU', 'note' => '', 'principalNote' => '',
                'submittedAt' => $now, 'updatedAt' => $now,
                'history' => [['status' => 'Menunggu konfirmasi TU', 'at' => $now, 'note' => '']],
            ]);
            if ($upload) {
                $storedName = save_upload($upload, 'documents', $code);
                $record['documentPath'] = $storedName;
            }
            $json = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $submittedAt = (new DateTimeImmutable($now))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
            $stmt = $db->prepare('INSERT INTO applications (tracking_code, record_json, submitted_at, updated_at) VALUES (?, ?, ?, ?)');
            $stmt->bind_param('ssss', $code, $json, $submittedAt, $submittedAt);
            $stmt->execute();
            $stmt->close();
            advance_application_revision($db);
            $db->commit();
            $transactionStarted = false;
        } catch (Throwable $error) {
            if ($transactionStarted) $db->rollback();
            if ($storedName !== '') {
                $base = getenv('AMANA_DATA_DIR') ?: (getenv('AMANA_ENV') === 'production' ? '/data/uploads' : dirname(__DIR__, 2) . '/data/uploads');
                @unlink(rtrim($base, '/') . '/documents/' . $storedName);
            }
            throw $error;
        } finally {
            try {
                $release = $db->prepare('SELECT RELEASE_LOCK(?)');
                $release->bind_param('s', $lockName);
                $release->execute();
                $release->close();
            } catch (Throwable $releaseError) {
                error_log('Application lock release failed.');
            }
        }
        json_response(['code' => $code, 'status' => $record['status']], 201);
    }

    if (in_array($method, ['GET','POST'], true) && $path === '/api/admin/letter-draft') {
        $session = require_staff();
        if ($session['role'] !== 'tu') api_error(403, 'Draf surat hanya dapat disimpan Tata Usaha.');
        if ($method === 'GET') {
            $code = strtoupper(trim((string)($_GET['code'] ?? '')));
            if ($code === '' || strlen($code) > 80) api_error(404, 'Pengajuan tidak ditemukan.');
            $record = fetch_record($code);
            if (!$record) api_error(404, 'Pengajuan tidak ditemukan.');
            json_response(['draft'=>$record['letterDraft'] ?? null,'status'=>$record['status']]);
        }
        $payload = request_json();
        $code = text_field($payload, 'code', 80);
        $expectedVersion = $payload['version'] ?? null;
        if (!is_int($expectedVersion) || $expectedVersion < 0) api_error(400, 'Versi draf tidak valid.');
        $incoming = $payload['fields'] ?? null;
        if (!is_array($incoming)) api_error(400, 'Isian draf tidak valid.');
        $limits = ['title'=>140,'number'=>70,'recipient'=>300,'opening'=>500,'studentName'=>80,'studentId'=>20,'studentClass'=>50,'year'=>20,'body'=>2500,'closing'=>500,'city'=>45,'date'=>10,'position'=>100,'principal'=>90,'nip'=>30];
        $fields = [];
        foreach ($limits as $name => $limit) {
            if (isset($incoming[$name]) && !is_string($incoming[$name])) api_error(400, 'Isian draf tidak valid.');
            $fields[$name] = text_field($incoming, $name, $limit, false);
        }
        if (isset($incoming['includeStudent']) && !is_bool($incoming['includeStudent'])) api_error(400, 'Pilihan identitas siswa tidak valid.');
        $fields['includeStudent'] = $incoming['includeStudent'] ?? true;
        $fields['principal'] = AMANAH_PRINCIPAL_NAME;
        if ($fields['date'] !== '') {
            $date = DateTimeImmutable::createFromFormat('!Y-m-d', $fields['date']);
            if (!$date || $date->format('Y-m-d') !== $fields['date']) api_error(400, 'Tanggal draf tidak valid.');
        }
        $db?->begin_transaction();
        try {
            $record = fetch_record($code, true);
            if (!$record) api_error(404, 'Pengajuan tidak ditemukan.');
            $expectedRecord = $record;
            if (($record['status'] ?? '') !== 'Disetujui Tata Usaha') api_error(409, 'Status pengajuan berubah. Draf hanya dapat diedit sebelum dikirim ke kepala sekolah.');
            $version = (int)($record['letterDraft']['version'] ?? 0);
            if ($version !== $expectedVersion) throw new ApiException(409, 'Draf sudah diperbarui dari perangkat lain. Muat draf terbaru sebelum menyimpan.', ['draftConflict'=>true]);
            $record['letterDraft'] = ['version'=>$version + 1,'savedAt'=>(new DateTimeImmutable('now',new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM),'fields'=>$fields];
            $json = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            if (supabase_enabled()) {
                supabase_rpc('save', ['expected' => $expectedRecord, 'record' => $record]);
            } else {
                $stmt = $db->prepare('UPDATE applications SET record_json = ?, updated_at = UTC_TIMESTAMP(6) WHERE tracking_code = ?');
                $stmt->bind_param('ss', $json, $code);
                $stmt->execute(); $stmt->close();
                advance_application_revision($db);
                $db->commit();
            }
        } catch (Throwable $error) { $db?->rollback(); throw $error; }
        json_response(['ok'=>true,'draft'=>$record['letterDraft']]);
    }

    if ($method === 'POST' && $path === '/api/admin/update') {
        $session = require_staff();
        $payload = request_json();
        $code = strtoupper(trim((string)($payload['code'] ?? '')));
        if ($code === '' || strlen($code) > 80) {
            api_error(404, 'Pengajuan tidak ditemukan.');
        }
        if ((string)($payload['role'] ?? '') !== $session['role']) {
            api_error(400, 'Peran aktif tidak sesuai. Pilih ulang menu petugas.');
        }
        $status = (string)($payload['status'] ?? '');
        $note = trim((string)($payload['note'] ?? ''));
        if (mb_strlen($note, 'UTF-8') > 500) {
            api_error(400, 'Catatan maksimal 500 karakter.');
        }
        if (in_array($status, ['Ditolak oleh TU', 'Ditolak Kepala Sekolah'], true) && $note === '') {
            api_error(400, 'Catatan penolakan wajib diisi.');
        }
        $allowedStatuses = $session['role'] === 'principal'
            ? ['Selesai', 'Ditolak Kepala Sekolah']
            : ['Disetujui Tata Usaha', 'Ditolak oleh TU', 'Menunggu persetujuan Kepala Sekolah'];
        if (!in_array($status, $allowedStatuses, true)) {
            api_error(400, 'Status pengajuan tidak valid.');
        }
        $letter = decode_upload($payload, 'letterName', 'letterBase64', 10 * 1024 * 1024);
        if ($letter && !(($session['role'] === 'tu' && $status === 'Menunggu persetujuan Kepala Sekolah') || ($session['role'] === 'principal' && $status === 'Selesai'))) {
            api_error(400, 'File surat hanya dapat diunggah Tata Usaha saat meneruskan surat.');
        }
        if ($status === 'Menunggu persetujuan Kepala Sekolah' && !$letter) {
            $existing = fetch_record($code);
            if (!$existing || empty($existing['letterPath'])) {
                api_error(400, 'Unggah file surat terlebih dahulu.');
            }
        }

        $db?->begin_transaction();
        $storedName = '';
        try {
            $record = fetch_record($code, true);
            if (!$record) {
                api_error(404, 'Pengajuan tidak ditemukan.');
            }
            $expectedRecord = $record;
            if ($status === 'Menunggu persetujuan Kepala Sekolah' && array_key_exists('letterDraftVersion', $payload)) {
                if (!is_int($payload['letterDraftVersion']) || $payload['letterDraftVersion'] !== (int)($record['letterDraft']['version'] ?? 0)) {
                    throw new ApiException(409, 'Draf sudah berubah dari perangkat lain. Muat draf terbaru dan periksa ulang PDF sebelum mengirim.', ['draftConflict'=>true]);
                }
            }
            $allowedFrom = [
                'Disetujui Tata Usaha' => ['Menunggu konfirmasi TU'],
                'Ditolak oleh TU' => ['Menunggu konfirmasi TU'],
                'Menunggu persetujuan Kepala Sekolah' => ['Disetujui Tata Usaha'],
                'Selesai' => ['Menunggu persetujuan Kepala Sekolah'],
                'Ditolak Kepala Sekolah' => ['Menunggu persetujuan Kepala Sekolah'],
            ];
            if (!in_array($record['status'] ?? '', $allowedFrom[$status] ?? [], true)) {
                api_error(400, 'Tahap pengajuan sudah berubah atau tidak sesuai alur.');
            }
            if ($session['role'] === 'principal' && empty($record['letterPath'])) {
                api_error(400, 'Surat belum diunggah oleh Tata Usaha.');
            }
            if ($session['role'] === 'principal' && $status === 'Selesai') {
                $record['principalAuthorization'] = validate_principal_authorization($payload, $record, $letter);
                $record['originalLetterPath'] = $record['letterPath'];
            }
            if ($letter) {
                $storedName = save_upload($letter, 'letters', $code);
                $record['letterName'] = $letter['name'];
                $record['letterPath'] = $storedName;
            }
            $record['status'] = $status;
            if ($session['role'] === 'principal') {
                $record['principalNote'] = $note;
            } else {
                $record['note'] = $note;
            }
            $record['updatedAt'] = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM);
            if ($session['role'] === 'principal' && $status === 'Selesai') $record['principalAuthorization']['signedAt'] = $record['updatedAt'];
            $record['history'] = is_array($record['history'] ?? null) ? $record['history'] : [];
            $record['history'][] = ['status' => $status, 'at' => $record['updatedAt'], 'note' => $note];
            $json = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $updatedAt = (new DateTimeImmutable($record['updatedAt']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
            if (supabase_enabled()) {
                supabase_rpc('save', ['expected' => $expectedRecord, 'record' => $record]);
            } else {
                $stmt = $db->prepare('UPDATE applications SET record_json = ?, updated_at = ? WHERE tracking_code = ?');
                $stmt->bind_param('sss', $json, $updatedAt, $code);
                $stmt->execute();
                $stmt->close();
                advance_application_revision($db);
                $db->commit();
            }
        } catch (Throwable $error) {
            $db?->rollback();
            if ($storedName !== '' && !supabase_enabled()) {
                $base = getenv('AMANA_DATA_DIR') ?: (getenv('AMANA_ENV') === 'production' ? '/data/uploads' : dirname(__DIR__, 2) . '/data/uploads');
                @unlink(rtrim($base, '/') . '/letters/' . $storedName);
            }
            throw $error;
        }
        json_response(['ok' => true, 'code' => $code, 'status' => $status, 'record' => $record]);
    }

    api_error(404, 'Endpoint tidak ditemukan.');
}

// The HTTP router also uses these helpers to protect the dashboard HTML itself.
if (defined('AMANA_API_LIBRARY') && AMANA_API_LIBRARY) {
    return;
}

try {
    api();
} catch (ApiException $error) {
    json_response(array_merge(['error' => $error->getMessage()], $error->details), $error->httpStatus);
} catch (Throwable $error) {
    error_log('API request failed: ' . $error->getMessage());
    json_response(['error' => 'Terjadi gangguan pada layanan. Coba lagi beberapa saat.'], 500);
}
