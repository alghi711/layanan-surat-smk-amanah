<?php
declare(strict_types=1);
const AMANAH_PRINCIPAL_NAME = 'MARTIN EKA SUPIANTI., S.T.';

function principal_signing_asset(string $kind): never
{
    $session = require_staff();
    if ($session['role'] !== 'principal') api_error(403, 'Aset pengesahan hanya tersedia pada menu Kepala Sekolah.');
    if (!in_array($kind, ['signature','stamp'], true)) api_error(404, 'Aset tidak ditemukan.');
    $path = rtrim(dirname(__DIR__), '/\\') . '/config/authorization/' . $kind . '.png';
    if (!is_file($path)) api_error(503, 'Aset pengesahan belum tersedia.');
    if (($_GET['format'] ?? '') === 'base64') {
        json_response(['mime' => 'image/png', 'base64' => base64_encode(file_get_contents($path))]);
    }
    header('Cache-Control: private, no-store');
    header('Content-Type: image/png');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

function validate_principal_authorization(array $payload, array $record, ?array $letter): array
{
    if (!$letter || $letter['extension'] !== 'pdf') api_error(400, 'Atur tanda tangan dan stempel lalu kirim PDF pengesahan.');
    $input = $payload['authorization'] ?? null;
    if (!is_array($input) || ($input['sourceLetterPath'] ?? '') !== ($record['letterPath'] ?? '')) api_error(409, 'Surat sumber berubah. Buka ulang pengesahan dari surat terbaru.');
    [$sourcePath] = read_upload_file('letters', (string)$record['letterPath']);
    $sourceHash = (string)($input['sourceSha256'] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/D', $sourceHash) || !hash_equals(hash_file('sha256', $sourcePath), $sourceHash)) api_error(409, 'Surat sumber berubah. Buka ulang pengesahan dari surat terbaru.');
    $pageCount = $input['pageCount'] ?? null;
    if (!is_int($pageCount) || $pageCount < 1 || $pageCount > 300) api_error(400, 'Jumlah halaman pengesahan tidak valid.');
    $placements = $input['placements'] ?? null;
    if (!is_array($placements) || count($placements) !== 2) api_error(400, 'Tempatkan tanda tangan dan stempel pada surat.');
    $seen = []; $safe = [];
    foreach ($placements as $placement) {
        $kind = $placement['kind'] ?? '';
        if (!in_array($kind, ['signature','stamp'], true) || isset($seen[$kind])) api_error(400, 'Penempatan pengesahan tidak valid.');
        $page = $placement['page'] ?? null;
        if (!is_int($page) || $page < 1 || $page > $pageCount) api_error(400, 'Halaman pengesahan tidak valid.');
        $item = ['kind'=>$kind,'page'=>$page];
        foreach (['x','y','width','height'] as $axis) {
            $value = $placement[$axis] ?? null;
            if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) || $value < 0 || $value > 1) api_error(400, 'Posisi pengesahan tidak valid.');
            $item[$axis] = (float)$value;
        }
        if ($item['width'] <= 0 || $item['height'] <= 0 || $item['x'] + $item['width'] > 1.000001 || $item['y'] + $item['height'] > 1.000001) api_error(400, 'Tanda tangan atau stempel keluar dari kertas.');
        $safe[] = $item; $seen[$kind] = true;
    }
    return ['principalName'=>AMANAH_PRINCIPAL_NAME,'sourceLetterPath'=>$record['letterPath'],'sourceSha256'=>$sourceHash,'pageCount'=>$pageCount,'placements'=>$safe,'signedFileSha256'=>hash('sha256',$letter['bytes'])];
}
