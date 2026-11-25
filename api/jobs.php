<?php
/** Job queue: list, create, clear. */
require __DIR__ . '/../includes/jobs.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    avt_json(array('jobs' => avt_jobs_all()));
}

if ($method === 'POST') {
    $body = avt_json_body();
    $type = avt_clean($body['type'] ?? '', 40);
    $allowed = array('video', 'audio', 'custom', 'health', 'benchmark', 'media', 'social');
    if (!in_array($type, $allowed, true)) {
        avt_json(array('error' => 'Unknown job type'), 400);
    }
    $files = array();
    foreach (($body['files'] ?? array()) as $file) {
        // A social job has no uploaded file; its "name" is just the link for display.
        if ($type === 'social') {
            $files[] = array(
                'name' => avt_clean($file['name'] ?? 'Video link', 300),
                'stored' => '',
                'size' => 0,
            );
            continue;
        }
        if (empty($file['stored']) || !avt_path_inside($file['stored'], UPLOAD_DIR)) {
            avt_json(array('error' => 'Invalid uploaded file path'), 400);
        }
        $files[] = array(
            'name' => avt_clean($file['name'] ?? basename($file['stored']), 300),
            'stored' => $file['stored'],
            'size' => (int) ($file['size'] ?? 0),
        );
    }
    if (!$files) {
        avt_json(array('error' => 'At least one file is required'), 400);
    }
    $options = is_array($body['options'] ?? null) ? $body['options'] : array();
    $job = avt_jobs_create(array(
        'type' => $type,
        'files' => $files,
        'options' => $options,
    ));
    avt_start_worker();
    avt_json(array('job' => $job), 201);
}

if ($method === 'DELETE') {
    avt_jobs_clear();
    avt_json(array('ok' => true));
}

avt_json(array('error' => 'Method not allowed'), 405);
