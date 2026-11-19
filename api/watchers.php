<?php
/** Folder watchers stored in watchers.json. */
require __DIR__ . '/../includes/functions.php';

function avt_watchers_read()
{
    if (!is_file(WATCHERS_FILE)) {
        return array();
    }
    $data = json_decode(file_get_contents(WATCHERS_FILE), true);
    return is_array($data) ? $data : array();
}

function avt_watchers_write($data)
{
    file_put_contents(WATCHERS_FILE, json_encode(array_values($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    avt_json(array('watchers' => avt_watchers_read()));
}

if ($method === 'POST') {
    $body = avt_json_body();
    $source = avt_clean($body['source'] ?? '', 1000);
    $dest = avt_clean($body['dest'] ?? '', 1000);
    if (!$source || !is_dir($source)) {
        avt_json(array('error' => 'Source folder does not exist'), 400);
    }
    if (!$dest) {
        avt_json(array('error' => 'Destination folder is required'), 400);
    }
    if (!is_dir($dest)) {
        @mkdir($dest, 0755, true);
    }
    $watchers = avt_watchers_read();
    $watcher = array(
        'id' => avt_uid('watch'),
        'source' => $source,
        'dest' => $dest,
        'preset' => avt_clean($body['preset'] ?? 'target-size', 40),
        'workers' => max(1, min(16, (int) ($body['workers'] ?? 4))),
        'watch' => !empty($body['watch']),
        'skip' => isset($body['skip']) ? (bool) $body['skip'] : true,
        'created_at' => date('c'),
        'last_scan' => null,
    );
    $watchers[] = $watcher;
    avt_watchers_write($watchers);
    avt_start_worker();
    avt_json(array('watcher' => $watcher), 201);
}

if ($method === 'DELETE') {
    $id = avt_clean($_GET['id'] ?? '', 80);
    $watchers = avt_watchers_read();
    foreach ($watchers as $i => $w) {
        if ($w['id'] === $id) {
            unset($watchers[$i]);
            break;
        }
    }
    avt_watchers_write($watchers);
    avt_json(array('ok' => true));
}

avt_json(array('error' => 'Method not allowed'), 405);
