'use strict';

/** Paths and runtime configuration for the JavaScript backend. */
const path = require('path');
const fs = require('fs');

const APP_ROOT = __dirname.replace(/[\\/]lib$/, '');
const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
const IS_WINDOWS = process.platform === 'win32';

// Packaged apps keep their data next to the executable so nothing is written
// into Program Files. The Electron main process sets AVT_DATA_DIR for us.
const DATA_ROOT = process.env.AVT_DATA_DIR || path.join(PROJECT_ROOT, 'runtime-js');

const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
const OUTPUT_DIR = path.join(DATA_ROOT, 'outputs');
const LOG_DIR = path.join(DATA_ROOT, 'logs');
const JOBS_DIR = path.join(DATA_ROOT, 'jobs');
const PASS_DIR = path.join(LOG_DIR, 'pass');

const PRESETS_FILE = path.join(DATA_ROOT, 'presets.json');
const WATCHERS_FILE = path.join(DATA_ROOT, 'watchers.json');
const WWW_DIR = path.join(APP_ROOT, 'www');

const FFMPEG_BINARY = process.env.FFMPEG_BINARY ||
    (IS_WINDOWS ? path.join(PROJECT_ROOT, 'bin', 'ffmpeg.exe') : 'ffmpeg');
const FFPROBE_BINARY = process.env.FFPROBE_BINARY ||
    (IS_WINDOWS ? path.join(PROJECT_ROOT, 'bin', 'ffprobe.exe') : 'ffprobe');

for (const dir of [DATA_ROOT, UPLOAD_DIR, OUTPUT_DIR, LOG_DIR, JOBS_DIR, PASS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
    APP_NAME: 'Audio and Video Tool',
    APP_VERSION: '0.3.0',
    APP_ROOT,
    PROJECT_ROOT,
    DATA_ROOT,
    IS_WINDOWS,
    UPLOAD_DIR,
    OUTPUT_DIR,
    LOG_DIR,
    JOBS_DIR,
    PASS_DIR,
    PRESETS_FILE,
    WATCHERS_FILE,
    WWW_DIR,
    FFMPEG_BINARY,
    FFPROBE_BINARY,
};
