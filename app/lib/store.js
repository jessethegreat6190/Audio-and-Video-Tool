'use strict';

/** JSON file stores for jobs, presets and watchers. Same format as the PHP version. */
const fs = require('fs');
const path = require('path');
const C = require('./config');
const U = require('./util');

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function jobPath(id) {
    return path.join(C.JOBS_DIR, path.basename(id) + '.json');
}

function jobsAll() {
    const jobs = [];
    let files = [];
    try { files = fs.readdirSync(C.JOBS_DIR); } catch (e) { return jobs; }
    for (const name of files) {
        if (!name.endsWith('.json')) continue;
        const data = readJson(path.join(C.JOBS_DIR, name), null);
        if (data && typeof data === 'object') jobs.push(data);
    }
    jobs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return jobs;
}

function jobsGet(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(id))) return null;
    return readJson(jobPath(id), null);
}

function jobsCreate(data) {
    const id = U.uid('job');
    const job = Object.assign({
        id,
        state: 'queued',
        progress: 0,
        speed: '',
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        message: '',
        output: null,
        options: {},
        files: [],
    }, data);
    writeJson(jobPath(id), job);
    return job;
}

function jobsUpdate(id, changes) {
    const job = jobsGet(id);
    if (!job) return null;
    Object.assign(job, changes);
    writeJson(jobPath(id), job);
    return job;
}

function jobsNextQueued() {
    return jobsAll().find(j => j.state === 'queued') || null;
}

function jobsDelete(id) {
    try { fs.unlinkSync(jobPath(id)); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(path.join(C.LOG_DIR, path.basename(id) + '.log')); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(path.join(C.LOG_DIR, path.basename(id) + '.progress')); } catch (e) { /* ignore */ }
    return true;
}

function jobsClear() {
    let files = [];
    try { files = fs.readdirSync(C.JOBS_DIR); } catch (e) { return true; }
    for (const name of files) {
        if (name.endsWith('.json')) {
            try { fs.unlinkSync(path.join(C.JOBS_DIR, name)); } catch (e) { /* ignore */ }
        }
    }
    return true;
}

function loadList(file) {
    const data = readJson(file, []);
    return Array.isArray(data) ? data : [];
}

function saveList(file, data) {
    writeJson(file, Array.isArray(data) ? data : []);
}

const presetsLoad = () => loadList(C.PRESETS_FILE);
const presetsSave = (data) => saveList(C.PRESETS_FILE, data);
const watchersLoad = () => loadList(C.WATCHERS_FILE);
const watchersSave = (data) => saveList(C.WATCHERS_FILE, data);

module.exports = {
    readJson, writeJson, jobsAll, jobsGet, jobsCreate, jobsUpdate,
    jobsNextQueued, jobsDelete, jobsClear, presetsLoad, presetsSave,
    watchersLoad, watchersSave,
};
