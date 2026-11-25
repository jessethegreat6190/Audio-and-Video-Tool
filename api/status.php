<?php
/** Capabilities endpoint. */
require __DIR__ . '/../includes/functions.php';

$encoders = avt_encoders();
$watch = array(
    'libx264', 'libx265', 'libaom-av1', 'libvpx-vp9',
    'h264_nvenc', 'hevc_nvenc', 'av1_nvenc',
    'h264_qsv', 'hevc_qsv', 'av1_qsv', 'vp9_qsv',
    'h264_amf', 'hevc_amf', 'av1_amf',
    'libmp3lame', 'aac', 'libopus', 'flac', 'pcm_s16le',
);
$available = array();
foreach ($watch as $name) {
    $available[$name] = in_array($name, $encoders, true);
}

avt_json(array(
    'app' => APP_NAME,
    'version' => APP_VERSION,
    'php' => PHP_VERSION,
    'php_binary' => PHP_BINARY,
    'ffmpeg' => is_file(FFMPEG_BINARY),
    'ffprobe' => is_file(FFPROBE_BINARY),
    'ffmpeg_version' => avt_ffmpeg_version(),
    'ytdlp' => is_file(YTDLP_BINARY) || (bool) avt_run(YTDLP_BINARY, array('--version'), 20)[0],
    'encoders' => $available,
    'gpu' => array(
        'nvenc' => $available['h264_nvenc'] || $available['hevc_nvenc'],
        'qsv' => $available['h264_qsv'] || $available['hevc_qsv'],
        'amf' => $available['h264_amf'] || $available['hevc_amf'],
    ),
    'directories' => array(
        'uploads' => is_dir(UPLOAD_DIR),
        'outputs' => is_dir(OUTPUT_DIR),
        'logs' => is_dir(LOG_DIR),
        'jobs' => is_dir(JOBS_DIR),
    ),
    'stage' => 'backend',
));
