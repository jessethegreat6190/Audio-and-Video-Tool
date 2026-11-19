<?php
/** JSON-file job store. */

require_once __DIR__ . '/functions.php';

function avt_job_path($id)
{
    return JOBS_DIR . DIRECTORY_SEPARATOR . basename($id) . '.json';
}

function avt_jobs_all()
{
    $jobs = array();
    foreach (glob(JOBS_DIR . DIRECTORY_SEPARATOR . '*.json') as $file) {
        $data = json_decode(file_get_contents($file), true);
        if (is_array($data)) {
            $jobs[] = $data;
        }
    }
    usort($jobs, function ($a, $b) {
        return strcmp($b['created_at'] ?? '', $a['created_at'] ?? '');
    });
    return $jobs;
}

function avt_jobs_get($id)
{
    $path = avt_job_path($id);
    if (!is_file($path)) {
        return null;
    }
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

function avt_jobs_create($data)
{
    $id = avt_uid('job');
    $job = array_merge(array(
        'id' => $id,
        'state' => 'queued',
        'progress' => 0,
        'speed' => '',
        'created_at' => date('c'),
        'started_at' => null,
        'finished_at' => null,
        'message' => '',
        'output' => null,
        'options' => array(),
        'files' => array(),
    ), $data);
    file_put_contents(avt_job_path($id), json_encode($job, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    return $job;
}

function avt_jobs_update($id, $changes)
{
    $job = avt_jobs_get($id);
    if (!$job) {
        return null;
    }
    $job = array_merge($job, $changes);
    file_put_contents(avt_job_path($id), json_encode($job, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    return $job;
}

function avt_jobs_next_queued()
{
    foreach (avt_jobs_all() as $job) {
        if ($job['state'] === 'queued') {
            return $job;
        }
    }
    return null;
}

function avt_jobs_delete($id)
{
    $path = avt_job_path($id);
    if (is_file($path)) {
        unlink($path);
    }
    $log = LOG_DIR . DIRECTORY_SEPARATOR . basename($id) . '.log';
    if (is_file($log)) {
        unlink($log);
    }
    return true;
}

function avt_jobs_clear()
{
    foreach (glob(JOBS_DIR . DIRECTORY_SEPARATOR . '*.json') as $file) {
        unlink($file);
    }
    return true;
}
