'use strict';

/** Shared helpers. Mirrors includes/functions.php from the PHP version. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const C = require('./config');

function uid(prefix) {
    return prefix + '_' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/\..*/, '') + '_' + crypto.randomBytes(4).toString('hex');
}

function clean(value, max) {
    return String(value === undefined || value === null ? '' : value).trim().slice(0, max || 500);
}

function isInside(target, base) {
    const t = path.resolve(target);
    const b = path.resolve(base) + path.sep;
    return t.startsWith(b);
}

/** Run a short command and return { ok, stdout, stderr }. */
function run(binary, args, timeout) {
    try {
        const r = spawnSync(binary, args, {
            encoding: 'utf8',
            timeout: (timeout || 60) * 1000,
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
        });
        if (r.error) return { ok: false, stdout: '', stderr: String(r.error.message) };
        return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
    } catch (e) {
        return { ok: false, stdout: '', stderr: String(e.message) };
    }
}

function probe(file) {
    const r = run(C.FFPROBE_BINARY, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], 60);
    if (!r.ok) return null;
    try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

function duration(file) {
    const info = probe(file);
    return info && info.format && info.format.duration ? parseFloat(info.format.duration) : 0;
}

function timeSeconds(value) {
    const v = clean(value, 30);
    if (!v) return 0;
    if (v.indexOf(':') !== -1) {
        const parts = v.split(':').reverse();
        return parts.reduce((sum, part, i) => sum + (parseFloat(part) || 0) * Math.pow(60, i), 0);
    }
    return parseFloat(v) || 0;
}

function encoders() {
    const r = run(C.FFMPEG_BINARY, ['-hide_banner', '-encoders'], 30);
    const found = new Set();
    for (const line of r.stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*[A-Z.]{6}\s+(\S+)/);
        if (m && /^[a-z0-9_-]+$/i.test(m[1])) found.add(m[1]);
    }
    return Array.from(found);
}

function ffmpegVersion() {
    const r = run(C.FFMPEG_BINARY, ['-version'], 20);
    return (r.stdout.split(/\r?\n/)[0] || '').trim() || 'unknown';
}

function log(jobId, text) {
    const line = '[' + new Date().toTimeString().slice(0, 8) + '] ' + String(text).trim() + '\n';
    try { fs.appendFileSync(path.join(C.LOG_DIR, path.basename(jobId) + '.log'), line); } catch (e) { /* ignore */ }
}

function copyToDest(output, destination) {
    try {
        if (!output || !destination || !fs.existsSync(output)) return false;
        const dest = clean(destination, 1000);
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(output, path.join(dest, path.basename(output)));
        return true;
    } catch (e) {
        return false;
    }
}

function targetBitrate(job, durationSeconds) {
    const o = job.options || {};
    const mb = Math.max(1, parseFloat(o.target) || 8);
    const audioK = Math.max(0, parseInt(o.abitrate, 10) || 0);
    const totalK = Math.floor(mb * 8 * 1000 / Math.max(durationSeconds, 1));
    return Math.max(80, totalK - audioK);
}

function outputPath(job, extension) {
    const names = job.files || [];
    const base = path.basename((names[0] && names[0].name) || 'output', path.extname((names[0] && names[0].name) || 'output'));
    return path.join(C.OUTPUT_DIR, job.id + '_' + base + '.' + String(extension).replace(/^\./, ''));
}

function splitArgs(text) {
    // Small shell-style splitter supporting quoted values.
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
    }
    return out;
}

module.exports = {
    uid, clean, isInside, run, probe, duration, timeSeconds, encoders,
    ffmpegVersion, log, copyToDest, targetBitrate, outputPath, splitArgs,
};
