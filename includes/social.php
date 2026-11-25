<?php
/** Social Video downloader — uses the free yt-dlp tool. */

require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/jobs.php';

/** Turn the simple quality choice into yt-dlp format options. */
function avt_social_format_args($quality)
{
    if ($quality === 'audio') {
        return array('-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K');
    }
    if ($quality === '720') {
        return array('-f', 'best[height<=720][ext=mp4]/best[height<=720]/best', '--merge-output-format', 'mp4');
    }
    if ($quality === '480') {
        return array('-f', 'best[height<=480][ext=mp4]/best[height<=480]/best', '--merge-output-format', 'mp4');
    }
    return array('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4');
}

/** Find the file yt-dlp wrote for this job. */
function avt_social_find_output($jobId)
{
    $wanted = array('mp4', 'mkv', 'webm', 'mov', 'mp3', 'm4a', 'flac', 'opus', 'wav');
    foreach (glob(OUTPUT_DIR . DIRECTORY_SEPARATOR . $jobId . '_*') as $candidate) {
        if (!is_file($candidate)) {
            continue;
        }
        $ext = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
        if (in_array($ext, $wanted, true)) {
            return $candidate;
        }
    }
    return null;
}

/**
 * Download one video link.
 * Output and progress go to files, not pipes, so the job cannot freeze on Windows.
 */
function avt_social_job($job)
{
    $url = avt_clean($job['options']['url'] ?? '', 2000);
    $parts = wp_parse_url_safe($url);
    if (!$parts || !in_array($parts['scheme'] ?? '', array('http', 'https'), true) || empty($parts['host'])) {
        return array(false, 'Enter a valid video link starting with http:// or https://', null);
    }

    $quality = avt_clean($job['options']['quality'] ?? 'best', 20);
    $outTemplate = OUTPUT_DIR . DIRECTORY_SEPARATOR . $job['id'] . '_%(title)s.%(ext)s';

    $cmd = array(
        YTDLP_BINARY,
        '--no-playlist',
        '--newline',
        '--no-colors',
        '--restrict-filenames',
        '--socket-timeout', '20',
        '--retries', '2',
    );
    if (IS_WINDOWS && is_file(FFMPEG_BINARY)) {
        $cmd[] = '--ffmpeg-location';
        $cmd[] = dirname(FFMPEG_BINARY);
    }
    $cmd = array_merge($cmd, avt_social_format_args($quality));
    $cmd[] = '-o';
    $cmd[] = $outTemplate;
    $cmd[] = $url;

    $logPath = LOG_DIR . DIRECTORY_SEPARATOR . $job['id'] . '.log';
    $log = @fopen($logPath, 'a');
    if (!$log) {
        return array(false, 'Could not open the job log file', null);
    }
    $descriptors = array(
        0 => array('pipe', 'r'),
        1 => $log,
        2 => $log,
    );
    $pipes = array();
    $proc = @proc_open($cmd, $descriptors, $pipes, BASE_PATH);
    if (!is_resource($proc)) {
        fclose($log);
        return array(false, 'Could not start the downloader. Is yt-dlp.exe in the bin folder?', null);
    }
    fclose($pipes[0]);

    avt_log($job['id'], 'Downloading link: ' . $url);
    avt_log($job['id'], 'Quality: ' . $quality);

    $lastUpdate = 0;
    $maxPercent = 0;
    while (true) {
        $status = proc_get_status($proc);

        // yt-dlp writes "[download]  42.5% of ..." lines; --newline keeps them separate.
        $raw = (string) @file_get_contents($logPath);
        if (preg_match_all('/\[download\]\s+(\d+(?:\.\d+)?)%/', $raw, $matches)) {
            foreach ($matches[1] as $value) {
                $value = (float) $value;
                if ($value > $maxPercent) {
                    $maxPercent = $value;
                }
            }
        }
        // Hold at 99% while yt-dlp finishes merging formats.
        $shown = $maxPercent > 0 ? min(99, (int) floor($maxPercent)) : 1;
        if (microtime(true) - $lastUpdate > 0.5) {
            avt_jobs_update($job['id'], array('progress' => $shown));
            $lastUpdate = microtime(true);
        }
        if (!$status['running']) {
            break;
        }
        usleep(200000);
    }

    $code = proc_close($proc);
    fclose($log);
    $output = avt_social_find_output($job['id']);

    if ($code !== 0 || !$output) {
        $tail = substr(trim((string) @file_get_contents($logPath)), -700);
        $tail = preg_replace('/\s+/', ' ', $tail);
        return array(false, 'Download did not finish. ' . ($tail ?: 'Check the job log.'), null);
    }

    avt_jobs_update($job['id'], array('progress' => 100));
    return array(true, 'Saved ' . basename($output), $output);
}

/** Tiny URL parser so we do not depend on an extension being installed. */
function wp_parse_url_safe($url)
{
    if (!preg_match('/^(https?):\/\/([^\/?#]+)([^#]*)/i', $url, $m)) {
        return null;
    }
    return array('scheme' => strtolower($m[1]), 'host' => $m[2]);
}
