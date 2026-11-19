'use strict';

/**
 * Audio and Video Tool — local Node.js server.
 * Mirrors the PHP API exactly so the same frontend works unchanged.
 * Run: node server.js   (listens on 127.0.0.1 only — nothing leaves the machine)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const C = require('./lib/config');
const U = require('./lib/util');
const S = require('./lib/store');
const E = require('./lib/encoder');
const W = require('./lib/watchers');

const PORT = parseInt(process.env.AVT_PORT, 10) || 8765;
const HOST = process.env.AVT_HOST || '127.0.0.1';

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
};

function json(res, data, status) {
    const body = Buffer.from(JSON.stringify(data, null, 2));
    res.writeHead(status || 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(Buffer.alloc(0)));
    });
}

/** Minimal multipart/form-data parser (no external dependency). */
function parseMultipart(buffer, contentType) {
    const files = [];
    const m = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) return files;
    const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
    let start = buffer.indexOf(boundary);
    while (start !== -1) {
        let partStart = start + boundary.length;
        if (buffer.slice(partStart, partStart + 2).toString() === '--') break;
        if (buffer.slice(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
        let next = buffer.indexOf(boundary, partStart);
        if (next === -1) break;
        let partEnd = next;
        if (partEnd >= 2 && buffer.slice(partEnd - 2, partEnd).toString() === '\r\n') partEnd -= 2;
        const part = buffer.slice(partStart, partEnd);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            const headers = part.slice(0, headerEnd).toString();
            const data = part.slice(headerEnd + 4);
            const nameM = headers.match(/name="([^"]*)"/i);
            const fileM = headers.match(/filename="([^"]*)"/i);
            if (nameM && fileM && fileM[1]) {
                files.push({ field: nameM[1], name: path.basename(fileM[1]), data });
            }
        }
        start = next;
    }
    return files;
}

function serveStatic(res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = path.join(C.WWW_DIR, path.normalize(rel).replace(/^([\\/]|(\.\.)([\\/]|$))+/, ''));
    if (!U.isInside(full, C.WWW_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(full, (err, data) => {
        if (err) {
            // SPA-ish fallback to index.html for unknown non-API paths
            fs.readFile(path.join(C.WWW_DIR, 'index.html'), (e2, html) => {
                if (e2) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type': MIME['.html'] });
                res.end(html);
            });
            return;
        }
        const ext = path.extname(full).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
}

// ---------- background worker loop ----------
let workerBusy = false;

async function pumpJobs() {
    if (workerBusy) return;
    const job = S.jobsNextQueued();
    if (!job) return;
    workerBusy = true;
    S.jobsUpdate(job.id, { state: 'running', started_at: new Date().toISOString(), progress: 0 });
    try {
        await E.runJob(S.jobsGet(job.id) || job);
    } catch (e) {
        S.jobsUpdate(job.id, {
            state: 'error',
            message: 'Worker error: ' + String(e.message || e),
            finished_at: new Date().toISOString(),
        });
    } finally {
        workerBusy = false;
    }
    // Continue with the next queued job immediately.
    setImmediate(pumpJobs);
}

setInterval(pumpJobs, 700);
W.startWatcherPolling(pumpJobs);

// ---------- routing ----------
async function route(req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const method = req.method;
    const q = parsed.query;

    if (!pathname.startsWith('/api/')) {
        if (method === 'GET' || method === 'HEAD') serveStatic(res, pathname);
        else { res.writeHead(405); res.end(); }
        return;
    }

    // ---- status ----
    if (pathname === '/api/status.php' && method === 'GET') {
        const available = U.encoders();
        const has = (name) => available.includes(name);
        json(res, {
            app: C.APP_NAME,
            version: C.APP_VERSION,
            php: 'JavaScript (Node ' + process.version + ')',
            php_binary: process.execPath,
            ffmpeg: fs.existsSync(C.FFMPEG_BINARY),
            ffprobe: fs.existsSync(C.FFPROBE_BINARY),
            ffmpeg_version: U.ffmpegVersion(),
            encoders: {
                libx264: has('libx264'), libx265: has('libx265'),
                'libaom-av1': has('libaom-av1'), 'libvpx-vp9': has('libvpx-vp9'),
                h264_nvenc: has('h264_nvenc'), hevc_nvenc: has('hevc_nvenc'), av1_nvenc: has('av1_nvenc'),
                h264_qsv: has('h264_qsv'), hevc_qsv: has('hevc_qsv'), av1_qsv: has('av1_qsv'), vp9_qsv: has('vp9_qsv'),
                h264_amf: has('h264_amf'), hevc_amf: has('hevc_amf'), av1_amf: has('av1_amf'),
                libmp3lame: has('libmp3lame'), aac: has('aac'), libopus: has('libopus'),
                flac: has('flac'), pcm_s16le: has('pcm_s16le'),
            },
            gpu: {
                nvenc: has('h264_nvenc') || has('hevc_nvenc'),
                qsv: has('h264_qsv') || has('hevc_qsv'),
                amf: has('h264_amf') || has('hevc_amf'),
            },
            directories: { uploads: C.UPLOAD_DIR, outputs: C.OUTPUT_DIR, logs: C.LOG_DIR },
        });
        return;
    }

    // ---- upload ----
    if (pathname === '/api/upload.php' && method === 'POST') {
        const buffer = await readBody(req);
        const parts = parseMultipart(buffer, req.headers['content-type']);
        const result = [];
        const errors = [];
        for (const part of parts) {
            if (part.data.length > 4 * 1024 * 1024 * 1024) {
                errors.push(part.name + ': larger than 4 GB limit');
                continue;
            }
            const safe = part.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const stored = path.join(C.UPLOAD_DIR, U.uid('up') + '_' + safe);
            try {
                fs.writeFileSync(stored, part.data);
                result.push({ name: part.name, stored, size: part.data.length });
            } catch (e) {
                errors.push(part.name + ': could not save');
            }
        }
        json(res, { files: result, errors }, result.length ? 200 : 400);
        return;
    }

    // ---- jobs collection ----
    if (pathname === '/api/jobs.php') {
        if (method === 'GET') { json(res, { jobs: S.jobsAll() }); return; }
        if (method === 'DELETE') { S.jobsClear(); json(res, { ok: true }); return; }
        if (method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const type = U.clean(body.type, 40);
            if (!['video', 'audio', 'custom', 'health', 'benchmark', 'media'].includes(type)) {
                json(res, { error: 'Unknown job type' }, 400); return;
            }
            const files = [];
            for (const f of (body.files || [])) {
                if (!f.stored || !U.isInside(f.stored, C.UPLOAD_DIR)) {
                    json(res, { error: 'Invalid uploaded file path' }, 400); return;
                }
                files.push({
                    name: U.clean(f.name || path.basename(f.stored), 300),
                    stored: f.stored,
                    size: parseInt(f.size, 10) || 0,
                });
            }
            if (!files.length) { json(res, { error: 'At least one file is required' }, 400); return; }
            const job = S.jobsCreate({
                type,
                files,
                options: (body.options && typeof body.options === 'object') ? body.options : {},
            });
            setImmediate(pumpJobs);
            json(res, { job }, 201);
            return;
        }
    }

    // ---- single job ----
    if (pathname === '/api/job.php') {
        const id = U.clean(q.id, 100);
        const job = S.jobsGet(id);
        if (!job) { json(res, { error: 'Job not found' }, 404); return; }
        if (method === 'GET') {
            const logPath = path.join(C.LOG_DIR, path.basename(id) + '.log');
            let log = '';
            try { log = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-60).join('\n'); } catch (e) { /* ignore */ }
            json(res, { job, log });
            return;
        }
        if (method === 'POST' && q.action === 'cancel') {
            if (!['queued', 'running'].includes(job.state)) {
                json(res, { error: 'Job cannot be cancelled' }, 400); return;
            }
            const updated = S.jobsUpdate(id, {
                state: 'canceled', message: 'Cancelled by user', finished_at: new Date().toISOString(),
            });
            json(res, { job: updated });
            return;
        }
        if (method === 'DELETE') { S.jobsDelete(id); json(res, { ok: true }); return; }
    }

    // ---- presets ----
    if (pathname === '/api/presets.php') {
        if (method === 'GET') { json(res, { presets: S.presetsLoad() }); return; }
        if (method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const presets = S.presetsLoad();
            const id = U.clean(body.id, 80) || U.uid('preset');
            const now = new Date().toISOString();
            const entry = {
                id,
                name: U.clean(body.name || 'Untitled preset', 120),
                type: U.clean(body.type || 'video', 40),
                options: (body.options && typeof body.options === 'object') ? body.options : {},
            };
            const idx = presets.findIndex(p => p.id === id);
            if (idx !== -1) {
                presets[idx] = Object.assign(presets[idx], entry, { updated_at: now });
            } else {
                presets.push(Object.assign(entry, { created_at: now, updated_at: now }));
            }
            S.presetsSave(presets);
            json(res, { ok: true, id }, 201);
            return;
        }
        if (method === 'DELETE') {
            const id = U.clean(q.id, 80);
            S.presetsSave(S.presetsLoad().filter(p => p.id !== id));
            json(res, { ok: true });
            return;
        }
    }

    // ---- watchers ----
    if (pathname === '/api/watchers.php') {
        if (method === 'GET') { json(res, { watchers: W.list() }); return; }
        if (method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const watcher = W.add(body);
            if (!watcher) { json(res, { error: 'Source folder does not exist' }, 400); return; }
            json(res, { watcher }, 201);
            return;
        }
        if (method === 'DELETE') { W.remove(U.clean(q.id, 80)); json(res, { ok: true }); return; }
    }

    // ---- download ----
    if (pathname === '/api/download.php' && method === 'GET') {
        const file = U.clean(q.file, 300);
        const full = path.join(C.OUTPUT_DIR, path.basename(file));
        if (!file || !U.isInside(full, C.OUTPUT_DIR) || !fs.existsSync(full)) {
            json(res, { error: 'File not found' }, 404); return;
        }
        const ext = path.extname(full).toLowerCase();
        const types = {
            '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
            '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
            '.flac': 'audio/flac', '.opus': 'audio/ogg', '.wav': 'audio/wav',
        };
        res.writeHead(200, {
            'Content-Type': types[ext] || 'application/octet-stream',
            'Content-Length': fs.statSync(full).size,
            'Content-Disposition': 'attachment; filename="' + path.basename(full) + '"',
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(full).pipe(res);
        return;
    }

    json(res, { error: 'Not found' }, 404);
}

const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
        if (!res.headersSent) json(res, { error: String(e.message || e) }, 500);
        else res.end();
    });
});

/** Start listening. Resolves with the chosen port (0 = pick a free one). */
function start(port, host) {
    const listenPort = port === undefined ? PORT : port;
    const listenHost = host || HOST;
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, listenHost, () => {
            const actual = server.address().port;
            console.log(C.APP_NAME + ' running at http://' + listenHost + ':' + actual + '/');
            console.log('Data directory: ' + C.DATA_ROOT);
            console.log('FFmpeg: ' + C.FFMPEG_BINARY);
            resolve(actual);
        });
    });
}

module.exports = { server, start };

// Auto-start when run directly (node server.js), not when required by Electron.
if (require.main === module) {
    start().catch((e) => {
        console.error('Could not start server:', e.message);
        process.exit(1);
    });
}
