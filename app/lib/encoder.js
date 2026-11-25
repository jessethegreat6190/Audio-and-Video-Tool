'use strict';

/** FFmpeg command builders and job execution. Ported from includes/encoder.php. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const C = require('./config');
const U = require('./util');
const S = require('./store');

const encoderCache = new Map();

function encoderWorks(encoder) {
    if (encoderCache.has(encoder)) return encoderCache.get(encoder);
    const r = U.run(C.FFMPEG_BINARY, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=1', '-frames:v', '1',
        '-c:v', encoder, '-pix_fmt', 'yuv420p',
        C.IS_WINDOWS ? 'NUL' : '/dev/null',
    ], 20);
    encoderCache.set(encoder, r.ok);
    return r.ok;
}

function encoderName(codec, hw, available) {
    const map = {
        libx264: { nvenc: 'h264_nvenc', qsv: 'h264_qsv', amf: 'h264_amf', cpu: 'libx264' },
        libx265: { nvenc: 'hevc_nvenc', qsv: 'hevc_qsv', amf: 'hevc_amf', cpu: 'libx265' },
        'libaom-av1': { nvenc: 'av1_nvenc', qsv: 'av1_qsv', amf: 'av1_amf', cpu: 'libaom-av1' },
        'libvpx-vp9': { qsv: 'vp9_qsv', cpu: 'libvpx-vp9' },
    };
    const options = map[codec] || { cpu: codec };
    let wanted;
    if (hw === 'auto') wanted = ['nvenc', 'qsv', 'amf', 'cpu'];
    else if (options[hw]) wanted = [hw, 'cpu'];
    else wanted = ['cpu'];

    for (const key of wanted) {
        const name = options[key];
        if (!name || !available.includes(name)) continue;
        if (encoderWorks(name)) return name;
    }
    return options.cpu || codec;
}

function videoArgs(job, encoder, bitrate, output, pass) {
    const o = job.options || {};
    const input = job.files[0].stored;
    const args = [];

    if (o.start) { args.push('-ss', U.clean(o.start, 30)); }
    args.push('-i', input);
    if (o.end && !o.start) {
        args.push('-to', U.clean(o.end, 30));
    } else if (o.end && o.start) {
        const seconds = Math.max(0, U.timeSeconds(o.end) - U.timeSeconds(o.start));
        args.push('-t', U.clean(String(seconds), 30));
    }

    const filters = [];
    const w = parseInt(o.width, 10) || 0;
    const h = parseInt(o.height, 10) || 0;
    if (w > 0 || h > 0) {
        filters.push('scale=' + (w || -1) + ':' + (h || -1) + ':force_original_aspect_ratio=decrease');
    }
    if (o.filter) filters.push(U.clean(o.filter, 500));
    if (filters.length) args.push('-vf', filters.join(','));

    args.push('-c:v', encoder);
    const rate = o.rate || 'target';
    if (rate === 'crf' && encoder.indexOf('nvenc') === -1) {
        args.push('-crf', String(parseInt(o.crf, 10) || 23));
    } else {
        args.push('-b:v', bitrate + 'k');
    }
    if (o.twopass && rate !== 'crf' && encoder.indexOf('lib') === 0) {
        args.push('-pass', String(pass), '-passlogfile', path.join(C.PASS_DIR, job.id));
    }
    if (o.speed && encoder.indexOf('nvenc') === -1) {
        args.push('-preset', U.clean(o.speed, 20));
    }

    const acodec = o.acodec || 'aac';
    if (acodec === 'copy') {
        args.push('-c:a', 'copy');
    } else {
        args.push('-c:a', acodec, '-b:a', ((parseInt(o.abitrate, 10) || 128) + 'k'));
        if (o.channels && o.channels !== 'copy') args.push('-ac', String(parseInt(o.channels, 10) || 0));
    }

    if (o.metadata && typeof o.metadata === 'object') {
        for (const key of Object.keys(o.metadata)) {
            args.push('-metadata', key.replace(/[^a-zA-Z0-9_]/g, '') + '=' + U.clean(o.metadata[key], 200));
        }
    }
    if (o.faststart && ['mp4', 'mov'].includes(o.container)) args.push('-movflags', '+faststart');

    if (pass === 1) {
        args.push('-f', 'null', C.IS_WINDOWS ? 'NUL' : '/dev/null');
    } else {
        args.push(output);
    }
    return args;
}

/** Parse one FFmpeg -progress block; returns the consumed byte offset. */
function parseProgress(text, from, duration, state) {
    const lines = String(text).slice(from).split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.indexOf('out_time_ms=') === 0 && duration > 0) {
            const us = parseFloat(trimmed.slice(12)) || 0;
            const pct = Math.min(99, Math.floor(us / (duration * 1000000) * 100));
            if (pct > state.progress) state.progress = pct;
        } else if (trimmed.indexOf('speed=') === 0) {
            state.speed = trimmed.slice(6);
        } else if (trimmed.indexOf('progress=end') === 0) {
            state.progress = 100;
        }
    }
    return String(text).length;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run FFmpeg. Progress and stderr go to files, never pipes — pipes deadlock on
 * Windows when the buffer fills. Same fix as the PHP worker (Step 17).
 */
async function runProcess(job, args, duration) {
    const logPath = path.join(C.LOG_DIR, path.basename(job.id) + '.log');
    const progressPath = path.join(C.LOG_DIR, path.basename(job.id) + '.progress');
    try { fs.unlinkSync(progressPath); } catch (e) { /* ignore */ }

    const logFd = fs.openSync(logPath, 'a');
    const cmd = [C.FFMPEG_BINARY, '-y', '-hide_banner', '-nostats', '-progress', progressPath].concat(args);
    let child;
    try {
        child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'ignore', logFd], windowsHide: true });
    } catch (e) {
        fs.closeSync(logFd);
        return { ok: false, stderr: 'Could not start FFmpeg: ' + e.message };
    }

    const state = { progress: 0, speed: '' };
    let parsed = 0;
    let lastUpdate = 0;

    await new Promise(resolve => {
        child.on('error', () => resolve());
        child.on('close', () => resolve());
        const timer = setInterval(() => {
            let raw = '';
            try { raw = fs.readFileSync(progressPath, 'utf8'); } catch (e) { /* not written yet */ }
            if (raw.length > parsed) {
                const tail = raw.slice(parsed);
                const lastNl = tail.lastIndexOf('\n');
                if (lastNl !== -1) {
                    const end = parsed + lastNl + 1;
                    parsed = parseProgress(raw.slice(0, end), parsed, duration, state);
                }
            }
            if (Date.now() - lastUpdate > 500) {
                S.jobsUpdate(job.id, { progress: state.progress, speed: state.speed });
                lastUpdate = Date.now();
            }
            if (child.exitCode !== null || child.signalCode !== null) {
                clearInterval(timer);
                resolve();
            }
        }, 100);
    });

    try {
        const raw = fs.readFileSync(progressPath, 'utf8');
        if (raw.length > parsed) parseProgress(raw, parsed, duration, state);
    } catch (e) { /* ignore */ }
    fs.closeSync(logFd);

    const code = child.exitCode;
    let stderr = '';
    try { stderr = fs.readFileSync(logPath, 'utf8'); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(progressPath); } catch (e) { /* ignore */ }

    S.jobsUpdate(job.id, { progress: code === 0 ? 100 : state.progress, speed: state.speed });
    return { ok: code === 0, stderr: stderr };
}

/** Social Video: download a link with the free yt-dlp tool. */
function socialFormatArgs(quality) {
    if (quality === 'audio') {
        return ['-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K'];
    }
    if (quality === '720') {
        return ['-f', 'best[height<=720][ext=mp4]/best[height<=720]/best', '--merge-output-format', 'mp4'];
    }
    if (quality === '480') {
        return ['-f', 'best[height<=480][ext=mp4]/best[height<=480]/best', '--merge-output-format', 'mp4'];
    }
    return ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4'];
}

function findSocialOutput(jobId) {
    const wanted = ['mp4', 'mkv', 'webm', 'mov', 'mp3', 'm4a', 'flac', 'opus', 'wav'];
    let names = [];
    try { names = fs.readdirSync(C.OUTPUT_DIR); } catch (e) { return null; }
    for (const name of names) {
        if (!name.startsWith(jobId + '_')) continue;
        const ext = path.extname(name).toLowerCase().replace('.', '');
        if (!wanted.includes(ext)) continue;
        const full = path.join(C.OUTPUT_DIR, name);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

async function runSocial(job) {
    const options = job.options || {};
    const url = U.clean(options.url || '', 2000);
    if (!/^https?:\/\/[^\/?#]+/i.test(url)) {
        return { ok: false, message: 'Enter a valid link starting with http:// or https://', output: null };
    }
    const quality = U.clean(options.quality || 'best', 20);
    const template = path.join(C.OUTPUT_DIR, job.id + '_%(title)s.%(ext)s');
    const cmd = [C.YTDLP_BINARY,
        '--no-playlist', '--newline', '--no-colors', '--restrict-filenames',
        '--socket-timeout', '20', '--retries', '2'];
    if (C.IS_WINDOWS && fs.existsSync(C.FFMPEG_BINARY)) {
        cmd.push('--ffmpeg-location', path.dirname(C.FFMPEG_BINARY));
    }
    cmd.push(...socialFormatArgs(quality), '-o', template, url);

    const logPath = path.join(C.LOG_DIR, path.basename(job.id) + '.log');
    const logFd = fs.openSync(logPath, 'a');
    let child;
    try {
        child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', logFd, logFd], windowsHide: true });
    } catch (e) {
        fs.closeSync(logFd);
        return { ok: false, message: 'Could not start the downloader. Is yt-dlp.exe in the bin folder?', output: null };
    }
    U.log(job.id, 'Downloading link: ' + url);
    U.log(job.id, 'Quality: ' + quality);

    let maxPercent = 0;
    let lastUpdate = 0;
    await new Promise(resolve => {
        child.on('error', () => resolve());
        child.on('close', () => resolve());
        const timer = setInterval(() => {
            let raw = '';
            try { raw = fs.readFileSync(logPath, 'utf8'); } catch (e) { /* not written yet */ }
            const re = /\[download\]\s+(\d+(?:\.\d+)?)%/g;
            let match;
            while ((match = re.exec(raw)) !== null) {
                const value = parseFloat(match[1]);
                if (value > maxPercent) maxPercent = value;
            }
            if (Date.now() - lastUpdate > 500) {
                S.jobsUpdate(job.id, { progress: maxPercent > 0 ? Math.min(99, Math.floor(maxPercent)) : 1 });
                lastUpdate = Date.now();
            }
            if (child.exitCode !== null || child.signalCode !== null) {
                clearInterval(timer);
                resolve();
            }
        }, 200);
    });

    fs.closeSync(logFd);
    const code = child.exitCode;
    const output = findSocialOutput(job.id);
    if (code !== 0 || !output) {
        let log = '';
        try { log = fs.readFileSync(logPath, 'utf8').trim().slice(-700).replace(/\s+/g, ' '); } catch (e) { /* ignore */ }
        return { ok: false, message: 'Download did not finish. ' + (log || 'Check the job log.'), output: null };
    }
    S.jobsUpdate(job.id, { progress: 100 });
    return { ok: true, message: 'Saved ' + path.basename(output), output };
}

async function encodeVideo(job, available) {
    const o = job.options || {};
    const container = o.container || 'mp4';
    const output = U.outputPath(job, container);
    const duration = U.duration(job.files[0].stored);
    const encoder = encoderName(o.codec || 'libx264', o.hw || 'auto', available);
    const rate = o.rate || 'target';

    if (rate === 'target') {
        let bitrate = U.targetBitrate(job, duration);
        const targetBytes = (parseFloat(o.target) || 8) * 1024 * 1024;
        const twoPass = !!o.twopass && encoder.indexOf('lib') === 0;
        for (let attempt = 0; attempt < 3; attempt++) {
            U.log(job.id, 'Target-size attempt ' + (attempt + 1) + ' at ' + bitrate + 'k using ' + encoder + (twoPass ? ' (2-pass)' : ' (1-pass)'));
            if (twoPass) {
                const r1 = await runProcess(job, videoArgs(job, encoder, bitrate, output, 1), duration);
                if (!r1.ok) return { ok: false, message: 'First pass failed: ' + r1.stderr.slice(-500), output: null };
            }
            const r2 = await runProcess(job, videoArgs(job, encoder, bitrate, output, 2), duration);
            if (!r2.ok) return { ok: false, message: (twoPass ? 'Second' : 'Encode') + ' pass failed: ' + r2.stderr.slice(-500), output: null };
            const size = fs.existsSync(output) ? fs.statSync(output).size : 0;
            U.log(job.id, 'Output size: ' + size + ' bytes / target ' + targetBytes);
            if (size <= targetBytes * 1.02) return { ok: true, message: 'Done', output };
            bitrate = Math.max(80, Math.floor(bitrate * 0.85));
            try { fs.unlinkSync(output); } catch (e) { /* ignore */ }
        }
        return { ok: true, message: 'Finished after 3 attempts; output may slightly exceed target', output };
    }

    const bitrate = rate === 'bitrate' ? (parseInt(o.vbitrate, 10) || 1500) : (parseInt(o.crf, 10) || 23);
    const r = await runProcess(job, videoArgs(job, encoder, bitrate, output, 2), duration);
    return r.ok ? { ok: true, message: 'Done', output } : { ok: false, message: r.stderr.slice(-500), output: null };
}

async function encodeAudio(job) {
    const o = job.options || {};
    const mode = o.mode || 'extract';
    const format = o.format || 'mp3';
    const codecMap = { mp3: 'libmp3lame', m4a: 'aac', flac: 'flac', opus: 'libopus', wav: 'pcm_s16le' };
    let output, args;

    if (mode === 'strip') {
        const ext = path.extname(job.files[0].name) || '.mp4';
        output = U.outputPath(job, ext.replace('.', ''));
        args = ['-i', job.files[0].stored, '-c', 'copy', '-an', output];
    } else {
        output = U.outputPath(job, format);
        const codec = codecMap[format] || 'libmp3lame';
        args = ['-i', job.files[0].stored, '-vn', '-c:a', codec];
        if (codec !== 'flac' && codec !== 'pcm_s16le') {
            args.push('-b:a', ((parseInt(o.bitrate, 10) || 192) + 'k'));
        }
        if (o.rate) args.push('-ar', String(parseInt(o.rate, 10) || 0));
        if (o.channels) args.push('-ac', String(parseInt(o.channels, 10) || 0));
        if (o.normalize) args.push('-af', 'loudnorm');
        args.push(output);
    }
    const r = await runProcess(job, args, U.duration(job.files[0].stored));
    return r.ok ? { ok: true, message: 'Done', output } : { ok: false, message: r.stderr.slice(-500), output: null };
}

async function customJob(job) {
    const o = job.options || {};
    const input = job.files[0].stored;
    const output = U.outputPath(job, o.container || 'mp4');
    const args = ['-i', input].concat(U.splitArgs(o.command || ''), [output]);
    const r = await runProcess(job, args, U.duration(input));
    return r.ok ? { ok: true, message: 'Done', output } : { ok: false, message: r.stderr.slice(-500), output: null };
}

async function healthJob(job) {
    const info = U.probe(job.files[0].stored);
    if (info) {
        return { ok: true, message: 'File is healthy. Streams: ' + (info.streams || []).length, output: null };
    }
    const output = U.outputPath(job, 'mkv');
    const r = await runProcess(job, ['-i', job.files[0].stored, '-c', 'copy', output], U.duration(job.files[0].stored));
    return r.ok ? { ok: true, message: 'Repaired by remux', output } : { ok: false, message: 'Corrupt and repair failed: ' + r.stderr.slice(-400), output: null };
}

async function benchmarkJob(job) {
    const input = job.files[0].stored;
    const output = U.outputPath(job, 'mkv');
    const args = ['-i', input, '-t', '10', '-c:v', 'libx265', '-crf', '28', '-preset', 'fast', '-an', output];
    const r = await runProcess(job, args, 10);
    const jobNow = S.jobsGet(job.id) || job;
    return r.ok ? { ok: true, message: 'Benchmark complete (10s sample). Speed: ' + (jobNow.speed || 'n/a'), output } : { ok: false, message: r.stderr.slice(-500), output: null };
}

async function mediaJob(job, available) {
    const o = job.options || {};
    const kind = o.kind || 'filter';
    const inputs = job.files.map(f => f.stored);
    const output = U.outputPath(job, o.container || 'mp4');
    let args;

    if (kind === 'merge') {
        args = [];
        for (const input of inputs) args.push('-i', input);
        const vparts = inputs.map((_, i) => '[' + i + ':v]').join('');
        const aparts = inputs.map((_, i) => '[' + i + ':a]').join('');
        args.push('-filter_complex', vparts + aparts + 'concat=n=' + inputs.length + ':v=1:a=1[outv][outa]', '-map', '[outv]', '-map', '[outa]', '-c:v', encoderName(o.codec || 'libx264', 'cpu', available), output);
    } else if (kind === 'metadata') {
        args = ['-i', inputs[0], '-c', 'copy'];
        for (const key of Object.keys(o.metadata || {})) {
            args.push('-metadata', key.replace(/[^a-zA-Z0-9_]/g, '') + '=' + U.clean(o.metadata[key], 200));
        }
        args.push(output);
    } else if (kind === 'image-to-video') {
        args = ['-loop', '1', '-i', inputs[0]];
        if (inputs[1]) args.push('-i', inputs[1]);
        args.push('-c:v', encoderName('libx264', 'cpu', available), '-t', String(parseInt(o.seconds, 10) || 10), '-pix_fmt', 'yuv420p');
        if (inputs[1]) args.push('-c:a', 'aac', '-shortest');
        args.push(output);
    } else {
        args = ['-i', inputs[0], '-vf', U.clean(o.filter || 'eq=contrast=1.1', 500), '-c:v', encoderName(o.codec || 'libx264', 'cpu', available), '-c:a', 'copy', output];
    }
    const r = await runProcess(job, args, U.duration(inputs[0]));
    return r.ok ? { ok: true, message: 'Done', output } : { ok: false, message: r.stderr.slice(-500), output: null };
}

async function runJob(job) {
    U.log(job.id, 'Starting job type: ' + job.type);
    let result;
    try {
        if (job.type === 'social') {
            result = await runSocial(job);
        } else {
            const available = U.encoders();
            if (job.type === 'video') result = await encodeVideo(job, available);
            else if (job.type === 'audio') result = await encodeAudio(job);
            else if (job.type === 'custom') result = await customJob(job);
            else if (job.type === 'health') result = await healthJob(job);
            else if (job.type === 'benchmark') result = await benchmarkJob(job);
            else if (job.type === 'media') result = await mediaJob(job, available);
            else result = { ok: false, message: 'Unknown job type', output: null };
        }
    } catch (e) {
        result = { ok: false, message: String(e.message || e), output: null };
    }

    if (result.ok && job.options && job.options.dest) {
        if (U.copyToDest(result.output, job.options.dest)) {
            result.message += ' · Copied to destination folder';
            U.log(job.id, 'Copied output to ' + job.options.dest);
        }
    }

    S.jobsUpdate(job.id, {
        state: result.ok ? 'done' : 'error',
        message: result.message,
        output: result.output ? path.basename(result.output) : null,
        finished_at: new Date().toISOString(),
    });
    U.log(job.id, (result.ok ? 'SUCCESS: ' : 'ERROR: ') + result.message);
    return result;
}

module.exports = { runJob, runProcess, encoderName, encoderWorks };
