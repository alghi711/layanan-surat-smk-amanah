<?php
declare(strict_types=1);

function supabase_enabled(): bool
{
    $backend = (string)(getenv('AMANA_BACKEND') ?: 'mysql');
    if (!in_array($backend, ['mysql', 'supabase'], true)) throw new RuntimeException('Backend tidak valid.');
    return $backend === 'supabase';
}

function supabase_request(string $method, string $path, ?string $body = null, string $mime = 'application/json'): string
{
    $url = rtrim((string)getenv('SUPABASE_URL'), '/');
    $key = (string)getenv('SUPABASE_SECRET_KEY');
    if (!preg_match('~\Ahttps://[a-z0-9-]+\.supabase\.co\z~D', $url) || !preg_match('/\Asb_secret_[A-Za-z0-9_-]+\z/D', $key)) {
        api_error(503, 'Konfigurasi Supabase belum lengkap.');
    }
    $headers = ['apikey: ' . $key, 'User-Agent: AmanahServer/1.0', 'Accept: application/json', 'Content-Type: ' . $mime];
    $started = microtime(true);
    $limit = 24 * 1024 * 1024;
    $status = 0;
    // Reuse the TLS connection within this request when the runtime provides cURL.
    if (function_exists('curl_init')) {
        static $client = null;
        $client ??= curl_init();
        $response = '';
        curl_setopt_array($client, [CURLOPT_URL => $url . $path, CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => $body, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 25, CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_ENCODING => '', CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$response, $limit): int {
                if (strlen($response) + strlen($chunk) > $limit) return 0;
                $response .= $chunk;
                return strlen($chunk);
            }]);
        $ok = curl_exec($client);
        $status = (int)curl_getinfo($client, CURLINFO_RESPONSE_CODE);
        if ($ok === false) $response = false;
    } else {
        $context = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers),
            'content' => $body ?? '', 'timeout' => 25, 'ignore_errors' => true, 'follow_location' => 0],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $response = @file_get_contents($url . $path, false, $context, 0, $limit + 1);
        foreach ($http_response_header ?? [] as $header) {
            if (preg_match('~^HTTP/\S+\s+(\d+)~', $header, $match)) $status = (int)$match[1];
        }
    }
    header('Server-Timing: supabase;dur=' . round((microtime(true) - $started) * 1000, 2), false);
    if ($response === false || $status < 200 || $status >= 300) {
        // Never log credentials, request bodies, or database responses containing pupil data.
        error_log('Supabase request failed: HTTP ' . $status . ' ' . $method . ' ' . strtok($path, '?'));
        api_error(503, 'Layanan data atau dokumen belum dapat dihubungi. Muat ulang untuk memeriksa status sebelum mencoba kembali.');
    }
    // shortcut: lists/snapshots are bounded at 24 MB; paginate them before the dataset reaches this size.
    if (strlen($response) > $limit) api_error(503, 'Data melebihi batas respons server; hubungi administrator.');
    return $response;
}

function supabase_rpc(string $action, array $data = []): mixed
{
    $result = json_decode(supabase_request('POST', '/rest/v1/rpc/amanah_backend',
        json_encode(['p_action' => $action, 'p_data' => (object)$data], JSON_THROW_ON_ERROR)), true, 64, JSON_THROW_ON_ERROR);
    if (is_array($result) && isset($result['httpStatus'])) {
        $status = (int)$result['httpStatus'];
        $message = (string)($result['error'] ?? 'Permintaan gagal.');
        unset($result['httpStatus'], $result['error']);
        throw new ApiException($status, $message, $result);
    }
    return $result;
}

function supabase_storage_path(string $folder, string $name): string
{
    $bucket = (string)(getenv('SUPABASE_STORAGE_BUCKET') ?: 'amanah-documents');
    if (!preg_match('/\A[a-z0-9_-]+\z/D', $bucket) || !in_array($folder, ['letters', 'documents'], true)
        || !preg_match('/\A[A-Za-z0-9][A-Za-z0-9._-]*\z/D', $name)) api_error(404, 'File tidak ditemukan.');
    return '/storage/v1/object/' . rawurlencode($bucket) . '/' . $folder . '/' . rawurlencode($name);
}

function supabase_mime(string $name): string
{
    return match (strtolower(pathinfo($name, PATHINFO_EXTENSION))) {
        'pdf' => 'application/pdf', 'jpg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
        default => 'application/octet-stream',
    };
}

function supabase_upload(array $upload, string $folder, string $code): string
{
    $name = $code . '-' . bin2hex(random_bytes(8)) . '.' . $upload['extension'];
    // POST without upsert preserves the original and already signed files.
    supabase_request('POST', supabase_storage_path($folder, $name), $upload['bytes'], supabase_mime($name));
    return $name;
}

function supabase_read_upload(string $folder, string $name): array
{
    $bytes = supabase_request('GET', supabase_storage_path($folder, $name));
    $path = tempnam(sys_get_temp_dir(), 'amanah-doc-');
    if ($path === false) throw new RuntimeException('Buffer dokumen tidak tersedia.');
    register_shutdown_function(static fn() => @unlink($path));
    if (file_put_contents($path, $bytes) !== strlen($bytes)) throw new RuntimeException('Dokumen belum terbaca lengkap.');
    return [$path, supabase_mime($name)];
}

function supabase_create_application(array $fields, ?array $upload): never
{
    $code = 'SA-' . gmdate('Ym') . '-' . bin2hex(random_bytes(16));
    $now = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM);
    $record = array_merge($fields, ['code' => $code, 'className' => $fields['className'] . ' ' . $fields['major'],
        'documentName' => $upload['name'] ?? '', 'documentPath' => '', 'status' => 'Menunggu konfirmasi TU',
        'note' => '', 'principalNote' => '', 'submittedAt' => $now, 'updatedAt' => $now,
        'history' => [['status' => 'Menunggu konfirmasi TU', 'at' => $now, 'note' => '']]]);
    if ($upload) $record['documentPath'] = supabase_upload($upload, 'documents', $code);
    // Keep an upload on an ambiguous RPC failure: the transaction may already have committed.
    supabase_rpc('create', ['record' => $record, 'identity' => duplicate_student_id($fields['nis']), 'phone' => duplicate_phone($fields['phone'])]);
    json_response(['code' => $code, 'status' => $record['status']], 201);
}

function supabase_health(): array
{
    $health = supabase_rpc('health');
    $bucket = (string)(getenv('SUPABASE_STORAGE_BUCKET') ?: 'amanah-documents');
    if (!preg_match('/\A[a-z0-9_-]+\z/D', $bucket)) api_error(503, 'Bucket tidak valid.');
    $storage = json_decode(supabase_request('GET', '/storage/v1/bucket/' . rawurlencode($bucket)), true, 32, JSON_THROW_ON_ERROR);
    if (($health['version'] ?? 0) < 1 || ($storage['public'] ?? true) !== false) api_error(503, 'Konfigurasi database atau bucket privat belum siap.');
    return ['ok' => true, 'storage' => 'supabase-postgres-and-private-storage'];
}
