<?php
/**
 * Audio and Video Tool — configuration.
 * Keep paths and constants here so edits stay in one place.
 */

define('APP_NAME', 'Audio and Video Tool');
define('APP_VERSION', '0.2.0');

define('BASE_PATH', dirname(__DIR__));
define('IS_WINDOWS', strtoupper(substr(PHP_OS, 0, 3)) === 'WIN');

define('UPLOAD_DIR',  BASE_PATH . DIRECTORY_SEPARATOR . 'uploads');
define('OUTPUT_DIR',  BASE_PATH . DIRECTORY_SEPARATOR . 'outputs');
define('LOG_DIR',     BASE_PATH . DIRECTORY_SEPARATOR . 'logs');
define('JOBS_DIR',    BASE_PATH . DIRECTORY_SEPARATOR . 'jobs');
define('PASS_DIR',    BASE_PATH . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'pass');

define('PRESETS_FILE', BASE_PATH . DIRECTORY_SEPARATOR . 'presets.json');
define('WATCHERS_FILE', BASE_PATH . DIRECTORY_SEPARATOR . 'watchers.json');

// Bundled static FFmpeg on Windows; PATH-based FFmpeg elsewhere (Docker/Linux).
$defaultFfmpeg = IS_WINDOWS
    ? BASE_PATH . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'ffmpeg.exe'
    : 'ffmpeg';
$defaultFfprobe = IS_WINDOWS
    ? BASE_PATH . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'ffprobe.exe'
    : 'ffprobe';

define('FFMPEG_BINARY', getenv('FFMPEG_BINARY') ?: $defaultFfmpeg);
define('FFPROBE_BINARY', getenv('FFPROBE_BINARY') ?: $defaultFfprobe);

// Free, open-source downloader used by the Social Video tab.
$defaultYtdlp = IS_WINDOWS
    ? BASE_PATH . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'yt-dlp.exe'
    : 'yt-dlp';
define('YTDLP_BINARY', getenv('YTDLP_BINARY') ?: $defaultYtdlp);
define('YTDLP_DIR', dirname(YTDLP_BINARY));

foreach (array(UPLOAD_DIR, OUTPUT_DIR, LOG_DIR, JOBS_DIR, PASS_DIR) as $dir) {
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
}
