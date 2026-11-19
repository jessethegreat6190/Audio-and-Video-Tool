<?php
/**
 * Queue worker. Scans watchers, then processes queued jobs.
 * A lock file ensures only one worker runs at a time.
 * If a watcher is in continuous mode this process stays alive and polls.
 */

require_once __DIR__ . '/includes/encoder.php';
require_once __DIR__ . '/includes/watchers.php';

set_time_limit(0);
ignore_user_abort(true);

$lockPath = LOG_DIR . DIRECTORY_SEPARATOR . 'worker.lock';
$lock = fopen($lockPath, 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    exit(0); // Another worker is already active.
}

function avt_has_continuous_watcher()
{
    foreach (avt_watchers_load() as $watcher) {
        if (!empty($watcher['watch'])) {
            return true;
        }
    }
    return false;
}

avt_log('worker', 'Worker started');
$persistent = avt_has_continuous_watcher();

do {
    avt_watcher_scan();
    $processed = 0;
    while ($processed < 100 && ($job = avt_jobs_next_queued())) {
        $job = avt_jobs_update($job['id'], array(
            'state' => 'running',
            'started_at' => date('c'),
            'message' => 'Starting...',
            'progress' => 0,
        ));
        avt_log($job['id'], 'Claimed by worker');
        avt_run_job($job);
        $processed++;
    }
    if ($persistent) {
        sleep(10);
    }
} while ($persistent);

avt_log('worker', 'Worker finished');
flock($lock, LOCK_UN);
fclose($lock);
