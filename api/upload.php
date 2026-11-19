<?php
/** Accept uploaded files and move them into uploads/. */
require __DIR__ . '/../includes/functions.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    avt_json(array('error' => 'POST required'), 405);
}
if (empty($_FILES['files'])) {
    avt_json(array('error' => 'No files received'), 400);
}

$result = array();
$errors = array();
$list = $_FILES['files'];
$count = is_array($list['name']) ? count($list['name']) : 1;

for ($i = 0; $i < $count; $i++) {
    $name = is_array($list['name']) ? $list['name'][$i] : $list['name'];
    $tmp = is_array($list['tmp_name']) ? $list['tmp_name'][$i] : $list['tmp_name'];
    $size = is_array($list['size']) ? $list['size'][$i] : $list['size'];
    $error = is_array($list['error']) ? $list['error'][$i] : $list['error'];

    if ($error !== UPLOAD_ERR_OK || !is_uploaded_file($tmp)) {
        $errors[] = $name . ': upload failed (code ' . $error . ')';
        continue;
    }
    if ($size > 4 * 1024 * 1024 * 1024) {
        $errors[] = $name . ': larger than 4 GB limit';
        continue;
    }

    $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($name));
    $stored = UPLOAD_DIR . DIRECTORY_SEPARATOR . avt_uid('up') . '_' . $safe;
    if (!move_uploaded_file($tmp, $stored)) {
        $errors[] = $name . ': could not save';
        continue;
    }
    $result[] = array(
        'name' => basename($name),
        'stored' => $stored,
        'size' => (int) $size,
    );
}

avt_json(array('files' => $result, 'errors' => $errors), $result ? 200 : 400);
