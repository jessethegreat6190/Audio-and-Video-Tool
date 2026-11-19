'use strict';

/** Folder watchers: scan source folders and queue jobs. Ported from includes/watchers.php. */
const fs = require('fs');
const path = require('path');
const C = require('./config');
const U = require('./util');
const S = require('./store');

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'flv'];
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'];

const PRESET_OPTIONS = {
    'target-size': { rate: 'target', codec: 'libx264', container: 'mp4', target: 8, abitrate: 128, faststart: true },
    web: { rate: 'crf', codec: 'libx264', container: 'mp4', crf: 23, abitrate: 128, faststart: true },
    archive: { rate: 'crf', codec: 'libx265', container: 'mkv', crf: 18, abitrate: 192 },
    social: { rate: 'crf', codec: 'libx264', container: 'mp4', crf: 23, width: 1080, height: 1920, faststart: true },
};

function list() {
    return S.watchersLoad();
}

function add(body) {
    const source = U.clean(body.source, 1000);
    const dest = U.clean(body.dest, 1000);
    if (!source || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) return null;
    if (!dest) return null;
    try { fs.mkdirSync(dest, { recursive: true }); } catch (e) { /* ignore */ }
    const watchers = S.watchersLoad();
    const watcher = {
        id: U.uid('watch'),
        source,
        dest,
        preset: U.clean(body.preset || 'target-size', 40),
        workers: Math.max(1, Math.min(16, parseInt(body.workers, 10) || 4)),
        watch: !!body.watch,
        skip: body.skip === undefined ? true : !!body.skip,
        created_at: new Date().toISOString(),
        last_scan: null,
    };
    watchers.push(watcher);
    S.watchersSave(watchers);
    return watcher;
}

function remove(id) {
    S.watchersSave(S.watchersLoad().filter(w => w.id !== id));
    return true;
}

function scanFolder(folder, extensions) {
    const found = [];
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return found;
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch (e) { return found; }
    for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            found.push(...scanFolder(full, extensions));
        } else if (entry.isFile() && extensions.includes(path.extname(entry.name).slice(1).toLowerCase())) {
            found.push(full);
        }
    }
    return found;
}

function scan() {
    const watchers = S.watchersLoad();
    if (!watchers.length) return 0;

    const known = new Set();
    for (const job of S.jobsAll()) {
        if (job.options && job.options.source_file) known.add(job.options.source_file);
    }

    let created = 0;
    for (const watcher of watchers) {
        if (!watcher.watch && watcher.last_scan !== null) continue;
        const files = scanFolder(watcher.source, VIDEO_EXT).concat(scanFolder(watcher.source, AUDIO_EXT));
        for (const file of files) {
            if (known.has(file)) continue;
            const name = path.basename(file);
            if (watcher.skip && fs.existsSync(path.join(watcher.dest, name))) continue;
            const options = Object.assign({}, PRESET_OPTIONS[watcher.preset] || PRESET_OPTIONS.web);
            options.source_file = file;
            options.dest = watcher.dest;
            const ext = path.extname(file).slice(1).toLowerCase();
            const type = AUDIO_EXT.includes(ext) ? 'audio' : 'video';
            S.jobsCreate({
                type,
                files: [{ name, stored: file, size: fs.existsSync(file) ? fs.statSync(file).size : 0 }],
                options,
            });
            known.add(file);
            created++;
        }
        watcher.last_scan = new Date().toISOString();
    }
    S.watchersSave(watchers);
    return created;
}

function startWatcherPolling(onNewJobs) {
    setInterval(() => {
        try {
            const anyWatching = S.watchersLoad().some(w => w.watch);
            if (!anyWatching) return;
            const created = scan();
            if (created > 0 && onNewJobs) onNewJobs();
        } catch (e) {
            console.error('Watcher scan error:', e.message);
        }
    }, 10000);
}

module.exports = { list, add, remove, scan, startWatcherPolling };
