<?php
/** Shared helpers for Audio and Video Tool. */

require_once __DIR__ . '/config.php';

function avt_json($data, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

function avt_json_body()
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : array();
}

function avt_uid($prefix = 'job')
{
    return $prefix . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4));
}

function avt_clean($value, $max = 500)
{
    return trim(substr((string) $value, 0, $max));
}

function avt_path_inside($path, $base)
{
    $real = realpath($path);
    $baseReal = realpath($base);
    return $real !== false && $baseReal !== false && strpos($real, $baseReal) === 0;
}

/** Run a command and return trimmed stdout. */
function avt_run($binary, $args, $timeout = 60)
{
    $cmd = array_merge(array($binary), $args);
    $descriptors = array(
        0 => array('pipe', 'r'),
        1 => array('pipe', 'w'),
        2 => array('pipe', 'w'),
    );
    $pipes = array();
    $proc = @proc_open($cmd, $descriptors, $pipes, BASE_PATH);
    if (!is_resource($proc)) {
        return array(false, '', 'Failed to start process');
    }
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($proc);
    return array($code === 0, $stdout, $stderr);
}

function avt_probe($file)
{
    $ok = avt_run(FFPROBE_BINARY, array(
        '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', $file
    ), 60);
    if (!$ok[0]) {
        return null;
    }
    $data = json_decode($ok[1], true);
    return is_array($data) ? $data : null;
}

function avt_duration($file)
{
    $info = avt_probe($file);
    if (!$info || empty($info['format']['duration'])) {
        return 0;
    }
    return (float) $info['format']['duration'];
}

/** Parse 00:00:12 or 12.5 into seconds. */
function avt_time_seconds($value)
{
    $value = trim((string) $value);
    if ($value === '') {
        return 0;
    }
    if (strpos($value, ':') !== false) {
        $parts = array_reverse(explode(':', $value));
        $seconds = 0;
        foreach ($parts as $i => $part) {
            $seconds += ((float) $part) * pow(60, $i);
        }
        return $seconds;
    }
    return (float) $value;
}

function avt_encoders()
{
    $ok = avt_run(FFMPEG_BINARY, array('-hide_banner', '-encoders'), 30);
    $found = array();
    foreach (explode("\n", $ok[1]) as $line) {
        if (preg_match('/^\s*[A-Z.]{6}\s+(\S+)/', $line, $m) && preg_match('/^[a-z0-9_-]+$/i', $m[1])) {
            $found[$m[1]] = true;
        }
    }
    return array_keys($found);
}

function avt_ffmpeg_version()
{
    $ok = avt_run(FFMPEG_BINARY, array('-version'), 20);
    $first = trim(explode("\n", $ok[1])[0]);
    return $first ?: 'unknown';
}

function avt_log($jobId, $text)
{
    $line = '[' . date('H:i:s') . '] ' . trim($text) . PHP_EOL;
    @file_put_contents(LOG_DIR . DIRECTORY_SEPARATOR . $jobId . '.log', $line, FILE_APPEND);
}

/** Copy a finished output into a watcher's destination folder. */
function avt_copy_to_dest($output, $destination)
{
    $destination = avt_clean($destination, 1000);
    if (!$output || !$destination || !is_file($output)) {
        return false;
    }
    if (!is_dir($destination)) {
        @mkdir($destination, 0755, true);
    }
    $target = rtrim($destination, '\\/') . DIRECTORY_SEPARATOR . basename($output);
    return @copy($output, $target);
}

function avt_start_worker()
{
    $php = PHP_BINARY;
    $worker = BASE_PATH . DIRECTORY_SEPARATOR . 'worker.php';
    if (IS_WINDOWS) {
        $cmd = 'start /B "" "' . $php . '" "' . $worker . '" > NUL 2>&1';
        pclose(popen($cmd, 'r'));
    } else {
        exec('"' . $php . '" ' . escapeshellarg($worker) . ' > /dev/null 2>&1 &');
    }
}
