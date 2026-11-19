<?php
/** Download a finished output file. */
require __DIR__ . '/../includes/functions.php';

$file = avt_clean($_GET['file'] ?? '', 300);
$path = OUTPUT_DIR . DIRECTORY_SEPARATOR . basename($file);
if (!$file || !is_file($path) || !avt_path_inside($path, OUTPUT_DIR)) {
    avt_json(array('error' => 'File not found'), 404);
}

$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$types = array(
    'mp4' => 'video/mp4', 'mkv' => 'video/x-matroska', 'webm' => 'video/webm',
    'mov' => 'video/quicktime', 'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4',
    'flac' => 'audio/flac', 'opus' => 'audio/ogg', 'wav' => 'audio/wav',
);
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('Content-Length: ' . filesize($path));
header('Content-Disposition: attachment; filename="' . basename($path) . '"');
header('Cache-Control: no-store');
readfile($path);
exit;
