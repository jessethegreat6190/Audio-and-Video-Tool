<?php
/** Folder watcher scanning and job creation. */

require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/jobs.php';

function avt_watchers_load()
{
    if (!is_file(WATCHERS_FILE)) {
        return array();
    }
    $data = json_decode(file_get_contents(WATCHERS_FILE), true);
    return is_array($data) ? $data : array();
}

function avt_watchers_save($data)
{
    file_put_contents(WATCHERS_FILE, json_encode(array_values($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

function avt_preset_options($preset)
{
    $map = array(
        'target-size' => array('rate' => 'target', 'codec' => 'libx264', 'container' => 'mp4', 'target' => 8, 'abitrate' => 128, 'faststart' => true),
        'web' => array('rate' => 'crf', 'codec' => 'libx264', 'container' => 'mp4', 'crf' => 23, 'abitrate' => 128, 'faststart' => true),
        'archive' => array('rate' => 'crf', 'codec' => 'libx265', 'container' => 'mkv', 'crf' => 18, 'abitrate' => 192),
        'social' => array('rate' => 'crf', 'codec' => 'libx264', 'container' => 'mp4', 'crf' => 23, 'width' => 1080, 'height' => 1920, 'faststart' => true),
    );
    return isset($map[$preset]) ? $map[$preset] : $map['web'];
}

function avt_scan_folder($folder, $extensions)
{
    $found = array();
    if (!is_dir($folder)) {
        return $found;
    }
    $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($folder, FilesystemIterator::SKIP_DOTS));
    foreach ($items as $item) {
        if ($item->isFile() && in_array(strtolower($item->getExtension()), $extensions, true)) {
            $found[] = $item->getPathname();
        }
    }
    return $found;
}

function avt_watcher_scan()
{
    $watchers = avt_watchers_load();
    if (!$watchers) {
        return 0;
    }

    // Paths already queued or finished, so we do not re-add them.
    $known = array();
    foreach (avt_jobs_all() as $job) {
        if (!empty($job['options']['source_file'])) {
            $known[$job['options']['source_file']] = true;
        }
    }

    $videoExt = array('mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'flv');
    $audioExt = array('mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus');
    $created = 0;

    foreach ($watchers as &$watcher) {
        if (!$watcher['watch'] && $watcher['last_scan'] !== null) {
            continue;
        }
        $files = array_merge(avt_scan_folder($watcher['source'], $videoExt), avt_scan_folder($watcher['source'], $audioExt));
        foreach ($files as $path) {
            if (isset($known[$path])) {
                continue;
            }
            $name = basename($path);
            if (!empty($watcher['skip']) && is_file(rtrim($watcher['dest'], '\\/') . DIRECTORY_SEPARATOR . $name)) {
                continue;
            }
            $options = avt_preset_options($watcher['preset']);
            $options['source_file'] = $path;
            $options['dest'] = $watcher['dest'];
            $type = in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), $audioExt, true) ? 'audio' : 'video';
            avt_jobs_create(array(
                'type' => $type,
                'files' => array(array('name' => $name, 'stored' => $path, 'size' => filesize($path))),
                'options' => $options,
            ));
            $known[$path] = true;
            $created++;
        }
        $watcher['last_scan'] = date('c');
    }
    unset($watcher);
    avt_watchers_save($watchers);
    return $created;
}
