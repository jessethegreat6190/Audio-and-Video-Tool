/* Audio and Video Tool — native Android API shim.
 * Loaded only inside the Capacitor WebView. Implements the same endpoints as
 * api/*.php and server.js using on-device storage and the FFmpeg bridge.
 * No network, no cloud: everything stays on the phone.
 */
(function () {
    'use strict';

    var Cap = window.Capacitor;
    if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;

    var FS = Cap.Plugins.Filesystem;
    var FF = Cap.Plugins.Ffmpegkit;
    if (!FS || !FF) return;

    var ROOT = 'avt';
    var DIRS = { uploads: ROOT + '/uploads', outputs: ROOT + '/outputs', logs: ROOT + '/logs' };
    var LS = { jobs: 'avt_jobs', presets: 'avt_presets', watchers: 'avt_watchers' };

    // ---------- storage helpers ----------
    function uid(prefix) {
        return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2, 10);
    }

    function load(key) {
        try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
    }

    function save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    async function ensureDirs() {
        for (var key in DIRS) {
            if (Object.prototype.hasOwnProperty.call(DIRS, key)) {
                try { await FS.mkdir({ path: DIRS[key], directory: 'DATA', recursive: true }); } catch (e) { /* exists */ }
            }
        }
    }

    async function fileExists(path) {
        try { await FS.stat({ path: path, directory: 'DATA' }); return true; } catch (e) { return false; }
    }

    async function readText(path) {
        try {
            var r = await FS.readFile({ path: path, directory: 'DATA', encoding: 'utf8' });
            return r.data;
        } catch (e) { return ''; }
    }

    async function writeText(path, text) {
        await FS.writeFile({ path: path, directory: 'DATA', encoding: 'utf8', data: text });
    }

    async function removeFile(path) {
        try { await FS.deleteFile({ path: path, directory: 'DATA' }); } catch (e) { /* ignore */ }
    }

    async function getUri(path) {
        var r = await FS.getUri({ path: path, directory: 'DATA' });
        return r.uri;
    }

    function b64ToBytes(b64) {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    function bytesToB64(bytes) {
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    // FFmpeg needs a plain path; file:// URIs are accepted by ffmpeg-kit.
    function q(path) { return '"' + String(path).replace(/"/g, '\\"') + '"'; }

    function log(jobId, text) {
        var line = '[' + new Date().toTimeString().slice(0, 8) + '] ' + text + '\n';
        writeText(DIRS.logs + '/' + jobId + '.log', line).catch(function () {});
    }

    function jobLog(jobId) {
        return readText(DIRS.logs + '/' + jobId + '.log');
    }

    function patchJob(id, changes) {
        var jobs = load(LS.jobs);
        for (var i = 0; i < jobs.length; i++) {
            if (jobs[i].id === id) { Object.assign(jobs[i], changes); break; }
        }
        save(LS.jobs, jobs);
    }

    function getJob(id) {
        return load(LS.jobs).find(function (j) { return j.id === id; }) || null;
    }

    // ---------- FFmpeg execution ----------
    var activeSessions = {};

    function runFfmpeg(job, args, duration) {
        return new Promise(function (resolve) {
            var id = job.id;
            var name = uid('f');
            var command = args.map(function (a) {
                var s = String(a);
                // Builders already quote paths; never quote twice.
                if (s.charAt(0) === '"' || s.charAt(0) === '-' || !/\s/.test(s)) return s;
                return q(s);
            }).join(' ');

            activeSessions[id] = name;
            patchJob(id, { progress: 0, speed: '' });
            log(id, 'Starting: ' + command);

            var streamRef = FF.addListener('stream', function (ev) {
                if (ev.name !== name || !duration) return;
                var pct = Math.min(99, Math.floor((Number(ev.time) || 0) / (duration * 1000) * 100));
                var current = getJob(id);
                if (current && pct > (current.progress || 0)) {
                    patchJob(id, { progress: pct, speed: ev.speed ? String(ev.speed) + 'x' : '' });
                }
            });

            var logRef = FF.addListener('log', function (ev) {
                if (ev.name === name && ev.log) log(id, String(ev.log).slice(0, 500));
            });

            FF.exec({ command: command, name: name }).then(function (result) {
                streamRef.remove();
                logRef.remove();
                delete activeSessions[id];
                var ok = Number(result.returnCode) === 0;
                patchJob(id, { progress: ok ? 100 : (getJob(id) || {}).progress || 0, speed: '' });
                log(id, (ok ? 'SUCCESS' : 'FAILED') + ' returnCode=' + result.returnCode);
                resolve({ ok: ok, output: result.output || '' });
            }).catch(function (err) {
                streamRef.remove();
                logRef.remove();
                delete activeSessions[id];
                log(id, 'ERROR: ' + String(err && err.message ? err.message : err));
                resolve({ ok: false, output: '' });
            });
        });
    }

    // ---------- command builders (same logic as lib/encoder.js) ----------
    function timeSeconds(v) {
        v = String(v || '').trim();
        if (!v) return 0;
        if (v.indexOf(':') !== -1) {
            return v.split(':').reverse().reduce(function (s, p, i) { return s + (parseFloat(p) || 0) * Math.pow(60, i); }, 0);
        }
        return parseFloat(v) || 0;
    }

    function targetBitrate(job, duration) {
        var o = job.options || {};
        var mb = Math.max(1, parseFloat(o.target) || 8);
        var audioK = Math.max(0, parseInt(o.abitrate, 10) || 0);
        var totalK = Math.floor(mb * 8 * 1000 / Math.max(duration || 1, 1));
        return Math.max(80, totalK - audioK);
    }

    function buildVideoArgs(job, outputUri, bitrate) {
        var o = job.options || {};
        var input = job.files[0].uri || job.files[0].stored;
        var args = [];
        if (o.start) args.push('-ss', String(o.start));
        args.push('-i', q(input));
        if (o.end && !o.start) args.push('-to', String(o.end));
        else if (o.end && o.start) args.push('-t', String(Math.max(0, timeSeconds(o.end) - timeSeconds(o.start))));

        var filters = [];
        var w = parseInt(o.width, 10) || 0;
        var h = parseInt(o.height, 10) || 0;
        if (w || h) filters.push('scale=' + (w || -1) + ':' + (h || -1) + ':force_original_aspect_ratio=decrease');
        if (o.filter) filters.push(String(o.filter));
        if (filters.length) args.push('-vf', q(filters.join(',')));

        args.push('-c:v', String(o.codec || 'libx264'));
        if ((o.rate || 'target') === 'crf') args.push('-crf', String(parseInt(o.crf, 10) || 23));
        else args.push('-b:v', (bitrate || parseInt(o.vbitrate, 10) || 1500) + 'k');
        if (o.speed) args.push('-preset', String(o.speed));

        var acodec = o.acodec || 'aac';
        if (acodec === 'copy') args.push('-c:a', 'copy');
        else {
            args.push('-c:a', acodec, '-b:a', ((parseInt(o.abitrate, 10) || 128) + 'k'));
            if (o.channels && o.channels !== 'copy') args.push('-ac', String(parseInt(o.channels, 10) || 0));
        }
        if (o.faststart && ['mp4', 'mov'].indexOf(o.container) !== -1) args.push('-movflags', '+faststart');
        args.push('-y', q(outputUri));
        return args;
    }

    function buildAudioArgs(job, outputUri) {
        var o = job.options || {};
        var input = job.files[0].uri || job.files[0].stored;
        var codecMap = { mp3: 'libmp3lame', m4a: 'aac', flac: 'flac', opus: 'libopus', wav: 'pcm_s16le' };
        var format = o.format || 'mp3';
        var args = ['-i', q(input), '-vn', '-c:a', codecMap[format] || 'libmp3lame'];
        if (codecMap[format] !== 'flac' && codecMap[format] !== 'pcm_s16le') {
            args.push('-b:a', ((parseInt(o.bitrate, 10) || 192) + 'k'));
        }
        if (o.rate) args.push('-ar', String(parseInt(o.rate, 10) || 0));
        if (o.channels) args.push('-ac', String(parseInt(o.channels, 10) || 0));
        if (o.normalize) args.push('-af', 'loudnorm');
        args.push('-y', q(outputUri));
        return args;
    }

    // ---------- worker ----------
    var workerBusy = false;

    async function durationOf(job) {
        // Captured from the browser's media element at upload time.
        return Number((job.options && job.options.duration) || (job.files[0] && job.files[0].duration) || 0);
    }

    // Read a media file's length in the browser so the progress bar can show a
    // real percentage while FFmpegKit encodes on the device.
    function probeDuration(file) {
        return new Promise(function (resolve) {
            try {
                var url = URL.createObjectURL(file);
                var isAudio = file.type && file.type.indexOf('audio/') === 0;
                var media = document.createElement(isAudio ? 'audio' : 'video');
                var done = false;
                function finish(value) {
                    if (done) return;
                    done = true;
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    resolve(value || 0);
                }
                media.preload = 'metadata';
                media.onloadedmetadata = function () {
                    finish(media.duration && isFinite(media.duration) ? media.duration : 0);
                };
                media.onerror = function () { finish(0); };
                media.src = url;
                setTimeout(function () { finish(0); }, 5000);
            } catch (e) { resolve(0); }
        });
    }

    async function pump() {
        if (workerBusy) return;
        var job = load(LS.jobs).find(function (j) { return j.state === 'queued'; });
        if (!job) return;
        workerBusy = true;
        patchJob(job.id, { state: 'running', started_at: new Date().toISOString(), progress: 0 });

        try {
            var ext = (job.options && job.options.container) || (job.type === 'audio' ? (job.options.format || 'mp3') : 'mp4');
            var outName = job.id + '_' + String(job.files[0].name || 'output').replace(/\.[^.]+$/, '') + '.' + ext;
            var outPath = DIRS.outputs + '/' + outName;
            var outUri = await getUri(outPath);
            var duration = await durationOf(job);
            var rate = (job.options || {}).rate || 'target';
            var bitrate = (job.type === 'video' && rate === 'target')
                ? targetBitrate(job, duration) : 0;
            var args = job.type === 'audio' ? buildAudioArgs(job, outUri) : buildVideoArgs(job, outUri, bitrate);
            if (job.type === 'custom') {
                args = ['-i', q(job.files[0].uri || job.files[0].stored)].concat(String((job.options || {}).command || '').split(/\s+/), ['-y', q(outUri)]);
            }
            var result = await runFfmpeg(job, args, duration);
            patchJob(job.id, {
                state: result.ok ? 'done' : 'error',
                message: result.ok ? 'Done' : 'Could not finish this file',
                output: result.ok ? outName : null,
                finished_at: new Date().toISOString()
            });
        } catch (e) {
            patchJob(job.id, { state: 'error', message: String(e && e.message ? e.message : e), finished_at: new Date().toISOString() });
        }
        workerBusy = false;
        setTimeout(pump, 100);
    }

    setInterval(pump, 700);

    // ---------- endpoint router ----------
    function response(status, body) { return Promise.resolve({ status: status, body: body }); }
    function err(msg, status) { return response(status || 400, { error: msg }); }

    async function handle(path, options) {
        var parts = path.split('?');
        var pathname = parts[0];
        var q = new URLSearchParams(parts[1] || '');
        var method = (options.method || 'GET').toUpperCase();
        var body = {};
        if (options.body) {
            if (typeof options.body === 'string') {
                try { body = JSON.parse(options.body); } catch (e) { body = {}; }
            }
        }

        if (pathname === 'api/status.php') {
            return response(200, {
                app: 'Audio and Video Tool', version: '0.3.0 (Android)',
                php: 'On-device', php_binary: 'native',
                ffmpeg: true, ffprobe: false, ffmpeg_version: 'FFmpegKit (bundled)',
                ytdlp: false,
                encoders: {}, gpu: { nvenc: false, qsv: false, amf: false },
                directories: DIRS
            });
        }

        if (pathname === 'api/upload.php' && options.body instanceof FormData) {
            var files = [];
            var errors = [];
            var entries = options.body.getAll('files');
            for (var i = 0; i < entries.length; i++) {
                var f = entries[i];
                if (!f || typeof f.arrayBuffer !== 'function') continue;
                var name = String(f.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
                var stored = DIRS.uploads + '/' + uid('up') + '_' + name;
                try {
                    var bytes = new Uint8Array(await f.arrayBuffer());
                    await FS.writeFile({ path: stored, directory: 'DATA', data: bytesToB64(bytes) });
                    var uri = await getUri(stored);
                    var duration = Number(f.duration || 0) || await probeDuration(f);
                    files.push({ name: f.name, stored: stored, uri: uri, size: bytes.length, duration: duration });
                } catch (e) {
                    errors.push(f.name + ': could not save');
                }
            }
            return response(files.length ? 200 : 400, { files: files, errors: errors });
        }

        if (pathname === 'api/jobs.php') {
            if (method === 'GET') return response(200, { jobs: load(LS.jobs) });
            if (method === 'DELETE') { save(LS.jobs, []); return response(200, { ok: true }); }
            if (method === 'POST') {
                if (body.type === 'social') {
                    return err('Link downloading is not available in the phone app yet. Use the Windows app or the web app on a computer.');
                }
                if (!body.files || !body.files.length) return err('At least one file is required');
                var job = Object.assign({
                    id: uid('job'), state: 'queued', progress: 0, speed: '',
                    created_at: new Date().toISOString(), started_at: null, finished_at: null,
                    message: '', output: null, options: {}, type: body.type, files: body.files
                }, {});
                var jobs = load(LS.jobs);
                jobs.push(job);
                save(LS.jobs, jobs);
                setTimeout(pump, 50);
                return response(201, { job: job });
            }
        }

        if (pathname === 'api/job.php') {
            var id = q.get('id') || '';
            var job = getJob(id);
            if (!job) return err('Job not found', 404);
            if (method === 'GET') return response(200, { job: job, log: await jobLog(id) });
            if (method === 'DELETE') {
                save(LS.jobs, load(LS.jobs).filter(function (j) { return j.id !== id; }));
                return response(200, { ok: true });
            }
            if (method === 'POST' && q.get('action') === 'cancel') {
                patchJob(id, { state: 'canceled', message: 'Cancelled by user', finished_at: new Date().toISOString() });
                return response(200, { job: getJob(id) });
            }
        }

        if (pathname === 'api/presets.php') {
            var presets = load(LS.presets);
            if (method === 'GET') return response(200, { presets: presets });
            if (method === 'POST') {
                var pid = body.id || uid('preset');
                var found = presets.find(function (p) { return p.id === pid; });
                var entry = { id: pid, name: body.name || 'Untitled preset', type: body.type || 'video', options: body.options || {}, updated_at: new Date().toISOString() };
                if (found) Object.assign(found, entry);
                else { entry.created_at = entry.updated_at; presets.push(entry); }
                save(LS.presets, presets);
                return response(201, { ok: true, id: pid });
            }
            if (method === 'DELETE') {
                save(LS.presets, presets.filter(function (p) { return p.id !== q.get('id'); }));
                return response(200, { ok: true });
            }
        }

        if (pathname === 'api/watchers.php') {
            var watchers = load(LS.watchers);
            if (method === 'GET') return response(200, { watchers: watchers });
            if (method === 'POST') {
                // Folder watching is not available in the mobile sandbox.
                return err('Folder watching is not available on Android', 400);
            }
            if (method === 'DELETE') {
                save(LS.watchers, watchers.filter(function (w) { return w.id !== q.get('id'); }));
                return response(200, { ok: true });
            }
        }

        if (pathname === 'api/download.php' && method === 'GET') {
            var file = q.get('file') || '';
            var full = DIRS.outputs + '/' + file.replace(/[^a-zA-Z0-9._-]/g, '_');
            if (!await fileExists(full)) return err('File not found', 404);
            var uri = await getUri(full);
            // Open the finished file with the system viewer/share sheet.
            if (Cap.Plugins.FileOpener) {
                try {
                    var mime = 'application/octet-stream';
                    if (/\.mp3$/i.test(file)) mime = 'audio/mpeg';
                    else if (/\.(m4a|aac)$/i.test(file)) mime = 'audio/mp4';
                    else if (/\.flac$/i.test(file)) mime = 'audio/flac';
                    else if (/\.wav$/i.test(file)) mime = 'audio/wav';
                    else if (/\.opus$/i.test(file)) mime = 'audio/opus';
                    else if (/\.mp4$/i.test(file)) mime = 'video/mp4';
                    else if (/\.mkv$/i.test(file)) mime = 'video/x-matroska';
                    else if (/\.webm$/i.test(file)) mime = 'video/webm';
                    await Cap.Plugins.FileOpener.open({ filePath: uri, contentType: mime });
                    return response(200, { opened: true });
                } catch (e) { /* fall through */ }
            }
            return response(200, { path: uri });
        }

        return err('Not found', 404);
    }

    // Plain <a href="api/download.php?..."> links do not go through fetch().
    // Intercept them so the finished file opens on the device instead of
    // navigating the WebView away from the app.
    document.addEventListener('click', function (e) {
        var link = e.target && e.target.closest ? e.target.closest('a[href^="api/download.php"]') : null;
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        window.AVT_API.fetch(link.getAttribute('href'), { method: 'GET' }).then(function (r) {
            if (r.body && r.body.opened) return;
            if (r.body && r.body.path) {
                alert('Saved to:\n' + r.body.path);
            } else {
                alert(r.body && r.body.error ? r.body.error : 'Could not open the file.');
            }
        });
    }, true);

    ensureDirs().catch(function () {});

    window.AVT_API = {
        fetch: function (path, options) {
            return handle(path, options || {});
        }
    };
})();
