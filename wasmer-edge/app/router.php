<?php
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('Cache-Control: private, no-store, max-age=0');
header('Pragma: no-cache');
header('Vary: Cookie');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
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
