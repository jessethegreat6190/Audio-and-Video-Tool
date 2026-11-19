<?php
/** Single job status, log tail, cancel and delete. */
require __DIR__ . '/../includes/jobs.php';

$id = avt_clean($_GET['id'] ?? '', 100);
$job = avt_jobs_get($id);
if (!$job) {
    avt_json(array('error' => 'Job not found'), 404);
}

$method = $_SERVER['REQUEST_METHOD'];
$action = avt_clean($_GET['action'] ?? '', 30);

if ($method === 'GET') {
    $logPath = LOG_DIR . DIRECTORY_SEPARATOR . basename($id) . '.log';
    $log = is_file($logPath) ? implode('', array_slice(file($logPath), -60)) : '';
    avt_json(array('job' => $job, 'log' => $log));
}

if ($method === 'POST' && $action === 'cancel') {
    if (!in_array($job['state'], array('queued', 'running'), true)) {
        avt_json(array('error' => 'Job cannot be cancelled'), 400);
    }
    $job = avt_jobs_update($id, array(
        'state' => 'canceled',
        'message' => 'Cancelled by user',
        'finished_at' => date('c'),
    ));
    avt_json(array('job' => $job));
}

if ($method === 'DELETE') {
    avt_jobs_delete($id);
    avt_json(array('ok' => true));
}

avt_json(array('error' => 'Method not allowed'), 405);
