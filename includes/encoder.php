<?php
/** FFmpeg command building and job execution. */

require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/jobs.php';

/** Actually initialise an encoder on a 1-frame test. A listed encoder can still fail without a GPU/driver. */
function avt_encoder_works($encoder)
{
    static $cache = array();
    if (isset($cache[$encoder])) {
        return $cache[$encoder];
    }
    $result = avt_run(FFMPEG_BINARY, array(
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=1', '-frames:v', '1',
        '-c:v', $encoder, '-pix_fmt', 'yuv420p',
        IS_WINDOWS ? 'NUL' : '/dev/null'
    ), 20);
    $cache[$encoder] = $result[0];
    return $result[0];
}

function avt_encoder_name($codec, $hw, $available)
{
    $map = array(
        'libx264'    => array('nvenc' => 'h264_nvenc', 'qsv' => 'h264_qsv', 'amf' => 'h264_amf', 'cpu' => 'libx264'),
        'libx265'    => array('nvenc' => 'hevc_nvenc', 'qsv' => 'hevc_qsv', 'amf' => 'hevc_amf', 'cpu' => 'libx265'),
        'libaom-av1' => array('nvenc' => 'av1_nvenc', 'qsv' => 'av1_qsv', 'amf' => 'av1_amf', 'cpu' => 'libaom-av1'),
        'libvpx-vp9' => array('qsv' => 'vp9_qsv', 'cpu' => 'libvpx-vp9'),
    );

    $options = isset($map[$codec]) ? $map[$codec] : array('cpu' => $codec);
    if ($hw === 'auto') {
        $wanted = array('nvenc', 'qsv', 'amf', 'cpu');
    } elseif (isset($options[$hw])) {
        $wanted = array($hw, 'cpu');
    } else {
        $wanted = array('cpu');
    }

    foreach ($wanted as $key) {
        if (!isset($options[$key]) || !in_array($options[$key], $available, true)) {
            continue;
        }
        if (avt_encoder_works($options[$key])) {
            return $options[$key];
        }
    }
    return isset($options['cpu']) ? $options['cpu'] : $codec;
}

function avt_target_bitrate($job, $duration)
{
    $o = $job['options'];
    $mb = max(1, (float) ($o['target'] ?? 8));
    $audioK = max(0, (int) ($o['abitrate'] ?? 128));
    $totalK = floor($mb * 8 * 1000 / max($duration, 1));
    return max(80, $totalK - $audioK);
}

function avt_output_path($job, $extension)
{
    $o = $job['options'];
    $base = pathinfo($job['files'][0]['name'] ?? 'output', PATHINFO_FILENAME);
    return OUTPUT_DIR . DIRECTORY_SEPARATOR . $job['id'] . '_' . $base . '.' . ltrim($extension, '.');
}

function avt_split_args($string)
{
    return str_getcsv(trim($string), ' ', '"');
}

function avt_video_args($job, $encoder, $bitrate, $output, $pass)
{
    $o = $job['options'];
    $input = $job['files'][0]['stored'];
    $args = array();

    if (!empty($o['start'])) {
        $args[] = '-ss';
        $args[] = avt_clean($o['start'], 30);
    }
    $args[] = '-i';
    $args[] = $input;
    if (!empty($o['end']) && empty($o['start'])) {
        $args[] = '-to';
        $args[] = avt_clean($o['end'], 30);
    } elseif (!empty($o['end']) && !empty($o['start'])) {
        $args[] = '-t';
        $args[] = avt_clean((string) max(0, avt_time_seconds($o['end']) - avt_time_seconds($o['start'])), 30);
    }

    $filters = array();
    $w = (int) ($o['width'] ?? 0);
    $h = (int) ($o['height'] ?? 0);
    if ($w > 0 || $h > 0) {
        $filters[] = 'scale=' . ($w ?: -1) . ':' . ($h ?: -1) . ':force_original_aspect_ratio=decrease';
    }
    if (!empty($o['filter'])) {
        $filters[] = avt_clean($o['filter'], 500);
    }
    if ($filters) {
        $args[] = '-vf';
        $args[] = implode(',', $filters);
    }

    $args[] = '-c:v';
    $args[] = $encoder;
    $rate = $o['rate'] ?? 'target';
    if ($rate === 'crf' && strpos($encoder, 'nvenc') === false) {
        $args[] = '-crf';
        $args[] = (string) (int) ($o['crf'] ?? 23);
    } else {
        $args[] = '-b:v';
        $args[] = $bitrate . 'k';
    }
    if (!empty($o['twopass']) && $rate !== 'crf' && strpos($encoder, 'lib') === 0) {
        $args[] = '-pass';
        $args[] = (string) $pass;
        $args[] = '-passlogfile';
        $args[] = PASS_DIR . DIRECTORY_SEPARATOR . $job['id'];
    }
    if (!empty($o['speed']) && strpos($encoder, 'nvenc') === false) {
        $args[] = '-preset';
        $args[] = avt_clean($o['speed'], 20);
    }

    $acodec = $o['acodec'] ?? 'aac';
    if ($acodec === 'copy') {
        $args[] = '-c:a';
        $args[] = 'copy';
    } else {
        $args[] = '-c:a';
        $args[] = $acodec;
        $args[] = '-b:a';
        $args[] = ((int) ($o['abitrate'] ?? 128)) . 'k';
        if (!empty($o['channels']) && $o['channels'] !== 'copy') {
            $args[] = '-ac';
            $args[] = (string) (int) $o['channels'];
        }
    }

    if (!empty($o['metadata']) && is_array($o['metadata'])) {
        foreach ($o['metadata'] as $key => $value) {
            $args[] = '-metadata';
            $args[] = preg_replace('/[^a-zA-Z0-9_]/', '', (string) $key) . '=' . avt_clean($value, 200);
        }
    }
    if (!empty($o['faststart']) && in_array($o['container'], array('mp4', 'mov'), true)) {
        $args[] = '-movflags';
        $args[] = '+faststart';
    }

    if ($pass === 1) {
        // Keep audio in pass 1 so FFmpeg writes pass logs for both streams.
        $args[] = '-f';
        $args[] = 'null';
        $args[] = IS_WINDOWS ? 'NUL' : '/dev/null';
    } else {
        $args[] = $output;
    }
    return $args;
}

/**
 * Parse FFmpeg's -progress output (one key=value per line, repeated every 0.5 s).
 * Returns the parsed variables and the byte offset of the last complete line.
 */
function avt_parse_progress($text, $from, $duration, &$maxProgress, &$speed)
{
    $lines = explode("\n", substr($text, $from));
    foreach ($lines as $line) {
        $line = trim($line);
        if (strpos($line, 'out_time_ms=') === 0 && $duration > 0) {
            $us = (float) substr($line, 12);
            $pct = min(99, (int) floor($us / ($duration * 1000000) * 100));
            if ($pct > $maxProgress) {
                $maxProgress = $pct;
            }
        } elseif (strpos($line, 'speed=') === 0) {
            $speed = substr($line, 6);
        } elseif (strpos($line, 'progress=end') === 0) {
            $maxProgress = 100;
        }
    }
    return strlen($text);
}

/**
 * Run FFmpeg with progress parsing and log capture.
 *
 * Progress and stderr go to files, NOT pipes. On Windows the pipe buffer is
 * tiny and stream_set_blocking(false) is not reliable for proc_open pipes:
 * fgets() can block on a half-written line, the buffer fills, FFmpeg stalls
 * and the job freezes at a low percentage. Files cannot deadlock.
 */
function avt_run_process($job, $args, $duration)
{
    $logPath = LOG_DIR . DIRECTORY_SEPARATOR . $job['id'] . '.log';
    $progressPath = LOG_DIR . DIRECTORY_SEPARATOR . $job['id'] . '.progress';
    $stdoutPath = LOG_DIR . DIRECTORY_SEPARATOR . $job['id'] . '.stdout';
    @unlink($progressPath);
    @unlink($stdoutPath);

    $cmd = array_merge(array(FFMPEG_BINARY, '-y', '-hide_banner', '-nostats', '-progress', $progressPath), $args);
    $descriptors = array(
        0 => array('pipe', 'r'),
        1 => array('file', $stdoutPath, 'w'),
        2 => array('file', $logPath, 'a'),
    );
    $pipes = array();
    $proc = @proc_open($cmd, $descriptors, $pipes, BASE_PATH);
    if (!is_resource($proc)) {
        return array(false, 'Could not start FFmpeg');
    }
    fclose($pipes[0]);

    $lastUpdate = 0;
    $maxProgress = 0;
    $speed = '';
    $parsed = 0;

    while (true) {
        $status = proc_get_status($proc);

        // Only parse complete lines; keep a partial final line for the next poll.
        $raw = @file_get_contents($progressPath);
        if ($raw !== false && strlen($raw) > $parsed) {
            $lastNl = strrpos(substr($raw, $parsed), "\n");
            if ($lastNl !== false) {
                $end = $parsed + $lastNl + 1;
                $parsed = avt_parse_progress(substr($raw, 0, $end), $parsed, $duration, $maxProgress, $speed);
            }
        }

        if (microtime(true) - $lastUpdate > 0.5) {
            avt_jobs_update($job['id'], array('progress' => $maxProgress, 'speed' => $speed));
            $lastUpdate = microtime(true);
        }

        if (!$status['running']) {
            break;
        }
        usleep(100000);
    }

    // Final parse, then collect the FFmpeg error output from the log file.
    $raw = @file_get_contents($progressPath);
    if ($raw !== false && strlen($raw) > $parsed) {
        avt_parse_progress($raw, $parsed, $duration, $maxProgress, $speed);
    }
    $code = proc_close($proc);
    $stderr = (string) @file_get_contents($logPath);
    @unlink($progressPath);
    @unlink($stdoutPath);

    avt_jobs_update($job['id'], array('progress' => $code === 0 ? 100 : $maxProgress, 'speed' => $speed));
    return array($code === 0, trim($stderr));
}

function avt_encode_video($job, $encoders)
{
    $o = $job['options'];
    $container = $o['container'] ?? 'mp4';
    $output = avt_output_path($job, $container);
    $duration = avt_duration($job['files'][0]['stored']);
    $encoder = avt_encoder_name($o['codec'] ?? 'libx264', $o['hw'] ?? 'auto', $encoders);
    $rate = $o['rate'] ?? 'target';

    if ($rate === 'target') {
        $bitrate = avt_target_bitrate($job, $duration);
        $targetBytes = ((float) ($o['target'] ?? 8)) * 1024 * 1024;
        $twoPass = !empty($o['twopass']) && strpos($encoder, 'lib') === 0;
        for ($attempt = 0; $attempt < 3; $attempt++) {
            avt_log($job['id'], 'Target-size attempt ' . ($attempt + 1) . ' at ' . $bitrate . 'k using ' . $encoder . ($twoPass ? ' (2-pass)' : ' (1-pass)'));
            if ($twoPass) {
                $pass1 = avt_video_args($job, $encoder, $bitrate, $output, 1);
                $r1 = avt_run_process($job, $pass1, $duration);
                if (!$r1[0]) {
                    return array(false, 'First pass failed: ' . substr($r1[1], -500), null);
                }
            }
            $pass2 = avt_video_args($job, $encoder, $bitrate, $output, 2);
            $r2 = avt_run_process($job, $pass2, $duration);
            if (!$r2[0]) {
                return array(false, ($twoPass ? 'Second' : 'Encode') . ' pass failed: ' . substr($r2[1], -500), null);
            }
            $size = is_file($output) ? filesize($output) : 0;
            avt_log($job['id'], 'Output size: ' . $size . ' bytes / target ' . $targetBytes);
            if ($size <= $targetBytes * 1.02) {
                return array(true, 'Done', $output);
            }
            $bitrate = max(80, (int) floor($bitrate * 0.85));
            @unlink($output);
        }
        return array(true, 'Finished after 3 attempts; output may slightly exceed target', $output);
    }

    $bitrate = $rate === 'bitrate' ? (int) ($o['vbitrate'] ?? 1500) : (int) ($o['crf'] ?? 23);
    $args = avt_video_args($job, $encoder, $bitrate, $output, 2);
    $r = avt_run_process($job, $args, $duration);
    return $r[0] ? array(true, 'Done', $output) : array(false, substr($r[1], -500), null);
}

function avt_encode_audio($job)
{
    $o = $job['options'];
    $mode = $o['mode'] ?? 'extract';
    $format = $o['format'] ?? 'mp3';
    $codecMap = array('mp3' => 'libmp3lame', 'm4a' => 'aac', 'flac' => 'flac', 'opus' => 'libopus', 'wav' => 'pcm_s16le');

    if ($mode === 'strip') {
        $output = avt_output_path($job, pathinfo($job['files'][0]['name'], PATHINFO_EXTENSION) ?: 'mp4');
        $args = array('-i', $job['files'][0]['stored'], '-c', 'copy', '-an', $output);
    } else {
        $output = avt_output_path($job, $format);
        $codec = $codecMap[$format] ?? 'libmp3lame';
        $args = array('-i', $job['files'][0]['stored'], '-vn', '-c:a', $codec);
        if ($codec !== 'flac' && $codec !== 'pcm_s16le') {
            $args[] = '-b:a';
            $args[] = ((int) ($o['bitrate'] ?? 192)) . 'k';
        }
        if (!empty($o['rate'])) {
            $args[] = '-ar';
            $args[] = (string) (int) $o['rate'];
        }
        if (!empty($o['channels'])) {
            $args[] = '-ac';
            $args[] = (string) (int) $o['channels'];
        }
        if (!empty($o['normalize'])) {
            $args[] = '-af';
            $args[] = 'loudnorm';
        }
        $args[] = $output;
    }
    $duration = avt_duration($job['files'][0]['stored']);
    $r = avt_run_process($job, $args, $duration);
    return $r[0] ? array(true, 'Done', $output) : array(false, substr($r[1], -500), null);
}

function avt_custom_job($job)
{
    $o = $job['options'];
    $input = $job['files'][0]['stored'];
    $output = avt_output_path($job, $o['container'] ?? 'mp4');
    $template = avt_clean($o['command'] ?? '', 2000);
    $extra = avt_split_args($template);
    $args = array_merge(array('-i', $input), $extra, array($output));
    $r = avt_run_process($job, $args, avt_duration($input));
    return $r[0] ? array(true, 'Done', $output) : array(false, substr($r[1], -500), null);
}

function avt_health_job($job)
{
    $info = avt_probe($job['files'][0]['stored']);
    if ($info) {
        $streams = count($info['streams'] ?? array());
        return array(true, 'File is healthy. Streams: ' . $streams, null);
    }
    $output = avt_output_path($job, 'mkv');
    $args = array('-i', $job['files'][0]['stored'], '-c', 'copy', $output);
    $r = avt_run_process($job, $args, avt_duration($job['files'][0]['stored']));
    return $r[0] ? array(true, 'Repaired by remux', $output) : array(false, 'Corrupt and repair failed: ' . substr($r[1], -400), null);
}

function avt_benchmark_job($job)
{
    $input = $job['files'][0]['stored'];
    $output = avt_output_path($job, 'mkv');
    $args = array('-i', $input, '-t', '10', '-c:v', 'libx265', '-crf', '28', '-preset', 'fast', '-an', $output);
    $r = avt_run_process($job, $args, 10);
    return $r[0] ? array(true, 'Benchmark complete (10s sample). Speed: ' . ($job['speed'] ?? 'n/a'), $output) : array(false, substr($r[1], -500), null);
}

function avt_media_job($job, $encoders)
{
    $o = $job['options'];
    $kind = $o['kind'] ?? 'filter';
    $inputs = array();
    foreach ($job['files'] as $file) {
        $inputs[] = $file['stored'];
    }
    $output = avt_output_path($job, $o['container'] ?? 'mp4');

    if ($kind === 'merge') {
        $args = array();
        foreach ($inputs as $input) {
            $args[] = '-i';
            $args[] = $input;
        }
        $vparts = array();
        $aparts = array();
        for ($i = 0; $i < count($inputs); $i++) {
            $vparts[] = '[' . $i . ':v]';
            $aparts[] = '[' . $i . ':a]';
        }
        $args[] = '-filter_complex';
        $args[] = implode('', $vparts) . implode('', $aparts) . 'concat=n=' . count($inputs) . ':v=1:a=1[outv][outa]';
        $args[] = '-map';
        $args[] = '[outv]';
        $args[] = '-map';
        $args[] = '[outa]';
        $args[] = '-c:v';
        $args[] = avt_encoder_name($o['codec'] ?? 'libx264', 'cpu', $encoders);
        $args[] = $output;
    } elseif ($kind === 'metadata') {
        $args = array('-i', $inputs[0], '-c', 'copy');
        foreach (($o['metadata'] ?? array()) as $key => $value) {
            $args[] = '-metadata';
            $args[] = preg_replace('/[^a-zA-Z0-9_]/', '', (string) $key) . '=' . avt_clean($value, 200);
        }
        $args[] = $output;
    } elseif ($kind === 'image-to-video') {
        $args = array('-loop', '1', '-i', $inputs[0]);
        if (isset($inputs[1])) {
            $args[] = '-i';
            $args[] = $inputs[1];
        }
        $args[] = '-c:v';
        $args[] = avt_encoder_name('libx264', 'cpu', $encoders);
        $args[] = '-t';
        $args[] = (string) (int) ($o['seconds'] ?? 10);
        $args[] = '-pix_fmt';
        $args[] = 'yuv420p';
        if (isset($inputs[1])) {
            $args[] = '-c:a';
            $args[] = 'aac';
            $args[] = '-shortest';
        }
        $args[] = $output;
    } else {
        $args = array('-i', $inputs[0], '-vf', avt_clean($o['filter'] ?? 'eq=contrast=1.1', 500));
        $args[] = '-c:v';
        $args[] = avt_encoder_name($o['codec'] ?? 'libx264', 'cpu', $encoders);
        $args[] = '-c:a';
        $args[] = 'copy';
        $args[] = $output;
    }
    $r = avt_run_process($job, $args, avt_duration($inputs[0]));
    return $r[0] ? array(true, 'Done', $output) : array(false, substr($r[1], -500), null);
}

function avt_run_job($job)
{
    $encoders = avt_encoders();
    $type = $job['type'];
    avt_log($job['id'], 'Starting job type: ' . $type);

    if ($type === 'video') {
        $result = avt_encode_video($job, $encoders);
    } elseif ($type === 'audio') {
        $result = avt_encode_audio($job);
    } elseif ($type === 'custom') {
        $result = avt_custom_job($job);
    } elseif ($type === 'health') {
        $result = avt_health_job($job);
    } elseif ($type === 'benchmark') {
        $result = avt_benchmark_job($job);
    } elseif ($type === 'media') {
        $result = avt_media_job($job, $encoders);
    } else {
        $result = array(false, 'Unknown job type', null);
    }

    if ($result[0] && !empty($job['options']['dest'])) {
        if (avt_copy_to_dest($result[2], $job['options']['dest'])) {
            $result[1] .= ' · Copied to destination folder';
            avt_log($job['id'], 'Copied output to ' . $job['options']['dest']);
        }
    }

    avt_jobs_update($job['id'], array(
        'state' => $result[0] ? 'done' : 'error',
        'message' => $result[1],
        'output' => $result[2] ? basename($result[2]) : null,
        'finished_at' => date('c'),
    ));
    avt_log($job['id'], $result[0] ? 'SUCCESS: ' . $result[1] : 'ERROR: ' . $result[1]);
    return $result;
}
