<?php
/** Saved presets stored in presets.json. */
require __DIR__ . '/../includes/functions.php';

function avt_presets_read()
{
    if (!is_file(PRESETS_FILE)) {
        return array();
    }
    $data = json_decode(file_get_contents(PRESETS_FILE), true);
    return is_array($data) ? $data : array();
}

function avt_presets_write($data)
{
    file_put_contents(PRESETS_FILE, json_encode(array_values($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    avt_json(array('presets' => avt_presets_read()));
}

if ($method === 'POST') {
    $body = avt_json_body();
    $presets = avt_presets_read();
    $id = avt_clean($body['id'] ?? '', 80) ?: avt_uid('preset');
    $found = false;
    foreach ($presets as &$p) {
        if ($p['id'] === $id) {
            $p['name'] = avt_clean($body['name'] ?? 'Untitled preset', 120);
            $p['type'] = avt_clean($body['type'] ?? 'video', 40);
            $p['options'] = is_array($body['options'] ?? null) ? $body['options'] : array();
            $p['updated_at'] = date('c');
            $found = true;
            break;
        }
    }
    unset($p);
    if (!$found) {
        $presets[] = array(
            'id' => $id,
            'name' => avt_clean($body['name'] ?? 'Untitled preset', 120),
            'type' => avt_clean($body['type'] ?? 'video', 40),
            'options' => is_array($body['options'] ?? null) ? $body['options'] : array(),
            'created_at' => date('c'),
            'updated_at' => date('c'),
        );
    }
    avt_presets_write($presets);
    avt_json(array('ok' => true, 'id' => $id), 201);
}

if ($method === 'DELETE') {
    $id = avt_clean($_GET['id'] ?? '', 80);
    $presets = avt_presets_read();
    foreach ($presets as $i => $p) {
        if ($p['id'] === $id) {
            unset($presets[$i]);
            break;
        }
    }
    avt_presets_write($presets);
    avt_json(array('ok' => true));
}

avt_json(array('error' => 'Method not allowed'), 405);
