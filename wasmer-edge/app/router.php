<?php
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('Cache-Control: private, no-store, max-age=0');
header('Pragma: no-cache');
header('Vary: Cookie');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (getenv('AMANA_MAINTENANCE') === '1') {
    http_response_code(503);
    header('Retry-After: 3600');
    if ($path === '/api' || str_starts_with($path, '/api/')) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Website sedang dalam pemeliharaan. Silakan coba kembali nanti.']);
    } else {
        header('Content-Type: text/html; charset=utf-8');
        echo <<<'HTML'
<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance - SMK Amanah</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#eef6fd;color:#12345f;font-family:system-ui,sans-serif}main{max-width:520px;text-align:center;background:white;border:1px solid #dce6f1;border-radius:22px;padding:44px 30px}small{font-weight:700;letter-spacing:.12em;color:#1765e9}h1{font-size:30px;line-height:1.25}p{color:#526987;line-height:1.7}</style></head><body><main><small>SMK AMANAH</small><h1>Website sedang dalam pemeliharaan</h1><p>Layanan surat sementara tidak tersedia. Silakan kunjungi kembali setelah pemeliharaan selesai.</p><p>Terima kasih atas kesabaran Anda.</p></main></body></html>
HTML;
    }
    exit;
}

if ($path === '/api' || str_starts_with($path, '/api/')) {
    require __DIR__ . '/api.php';
    exit;
}

if (in_array(rawurldecode($path), ['/tu.html', '/rekap.html'], true)) {
    define('AMANA_API_LIBRARY', true);
    require __DIR__ . '/api.php';
    try {
        $session = current_session();
    } catch (Throwable $error) {
        error_log('Dashboard session check failed: ' . $error->getMessage());
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Layanan petugas sementara tidak tersedia. Silakan coba kembali.';
        exit;
    }
    if (!$session || !in_array($session['role'], ['tu', 'principal'], true)) {
        header('Location: /admin.html', true, 302);
        exit;
    }
    header('Content-Type: text/html; charset=utf-8');
    $html = file_get_contents(__DIR__ . rawurldecode($path));
    if ($html === false) {
        http_response_code(503);
        exit;
    }
    $roleMeta = '<meta name="amanah-staff-role" content="' . htmlspecialchars($session['role'], ENT_QUOTES, 'UTF-8') . '">';
    $otherRole = $session['role'] === 'tu' ? 'principal' : 'tu';
    $roleMeta .= '<style>[data-mode="' . $otherRole . '"]{display:none!important}</style>';
    if ($session['role'] === 'principal') $roleMeta .= '<style>[data-tu-only]{display:none!important}</style>';
    echo str_replace('</head>', $roleMeta . "\n</head>", $html);
    exit;
}

// Let PHP's built-in HTTP server safely serve the existing static pages/assets.
if (str_starts_with($path, '/assets/') && !str_contains(rawurldecode($path), '..')) {
    header('Cache-Control: public, max-age=3600');
    header_remove('Pragma');
    header_remove('Vary');
}
return false;
