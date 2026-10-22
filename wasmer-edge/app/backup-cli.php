<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
define('AMANA_API_LIBRARY', true);
require __DIR__ . '/api.php';
require __DIR__ . '/backup.php';
try {
    echo json_encode(['ok' => true, 'backup' => school_backup_create()], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'Backup gagal: ' . $error->getMessage() . "\n");
    exit(1);
}
