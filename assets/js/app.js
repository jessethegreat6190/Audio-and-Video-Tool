/* Audio and Video Tool — all JavaScript lives here. */

(function () {
    'use strict';

    var selectedJobId = null;
    var pollTimer = null;

    // ---------- helpers ----------
    function api(path, options) {
        return fetch(path, options).then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok) {
                    throw new Error(data.error || ('HTTP ' + response.status));
                }
                return data;
            });
        });
    }

    function formatBytes(bytes) {
        bytes = Number(bytes) || 0;
        if (!bytes) { return '0 B'; }
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
    }

    function setMessage(id, text, kind) {
        var el = document.getElementById(id);
        if (!el) { return; }
        el.textContent = text;
        el.className = 'message' + (kind ? ' ' + kind : '');
    }

    function val(id) { return document.getElementById(id); }

    // ---------- theme ----------
    var savedTheme = localStorage.getItem('avt-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
    val('theme-toggle').addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('avt-theme', next);
    });

    // ---------- tabs ----------
    var tabs = document.querySelectorAll('.tab');
    var panels = document.querySelectorAll('.panel');
    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (t) { t.classList.remove('active'); });
            panels.forEach(function (p) { p.classList.remove('active'); });
            tab.classList.add('active');
            var panel = document.querySelector('[data-panel="' + tab.dataset.tab + '"]');
            if (panel) { panel.classList.add('active'); }
        });
    });

    // ---------- drop zones ----------
    function setupDropZone(zoneId, inputId, listId, summaryId, acceptPattern) {
        var zone = val(zoneId);
        var input = val(inputId);
        var list = val(listId);
        var summary = val(summaryId);
        var store = { files: [] };

        function render() {
            list.innerHTML = '';
            var total = 0;
            store.files.forEach(function (file, index) {
                total += file.size;
                var li = document.createElement('li');
                var left = document.createElement('span');
                left.textContent = file.name;
                var size = document.createElement('span');
                size.className = 'size';
                size.textContent = formatBytes(file.size);
                var remove = document.createElement('span');
                remove.className = 'remove';
                remove.textContent = 'remove';
                remove.addEventListener('click', function (e) {
                    e.stopPropagation();
                    store.files.splice(index, 1);
                    render();
                });
                left.appendChild(size);
                li.appendChild(left);
                li.appendChild(remove);
                list.appendChild(li);
            });
            summary.textContent = store.files.length
                ? store.files.length + ' file(s) · ' + formatBytes(total)
                : 'No files selected';
        }

        function accept(fileList) {
            var rejected = 0;
            Array.prototype.forEach.call(fileList, function (file) {
                if (acceptPattern.test(file.type) || acceptPattern.test(file.name)) {
                    store.files.push(file);
                } else {
                    rejected++;
                }
            });
            if (rejected) {
                zone.classList.add('invalid');
                window.setTimeout(function () { zone.classList.remove('invalid'); }, 900);
            }
            render();
        }

        zone.addEventListener('click', function () { input.click(); });
        zone.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
        });
        input.addEventListener('change', function () { accept(input.files); input.value = ''; });
        ['dragenter', 'dragover'].forEach(function (event) {
            zone.addEventListener(event, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
        });
        ['dragleave', 'drop'].forEach(function (event) {
            zone.addEventListener(event, function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
        });
        zone.addEventListener('drop', function (e) { accept(e.dataTransfer.files); });

        return store;
    }

    var mediaPattern = /\.(mp4|mkv|mov|avi|webm|m4v|ts|flv|mp3|wav|flac|aac|m4a|ogg|opus|jpg|jpeg|png|webp|gif)$/i;
    var videoStore = setupDropZone('drop-zone', 'video-files', 'video-file-list', 'video-file-summary', /\.(mp4|mkv|mov|avi|webm|m4v|ts|flv)$/i);
    var audioStore = setupDropZone('audio-drop-zone', 'audio-files', 'audio-file-list', 'audio-file-summary', /\.(mp4|mkv|mov|avi|webm|m4v|mp3|wav|flac|aac|m4a|ogg|opus)$/i);
    var mediaStore = setupDropZone('media-drop-zone', 'media-files', 'media-file-list', 'media-file-summary', mediaPattern);
    var toolStore = setupDropZone('tool-drop-zone', 'tool-files', 'tool-file-list', 'tool-file-summary', /\.(mp4|mkv|mov|avi|webm|mp3|wav|flac|m4a)$/i);

    // ---------- job submission ----------
    function uploadFiles(store) {
        if (!store.files.length) {
            return Promise.reject(new Error('Add at least one file first.'));
        }
        var form = new FormData();
        store.files.forEach(function (file) { form.append('files[]', file, file.name); });
        return api('api/upload.php', { method: 'POST', body: form }).then(function (data) {
            if (data.errors && data.errors.length) {
                setMessage('video-message', data.errors.join(' · '), 'error');
            }
            return data.files;
        });
    }

    function createJob(type, files, options, messageId) {
        return api('api/jobs.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type, files: files, options: options })
        }).then(function (data) {
            setMessage(messageId, 'Job ' + data.job.id + ' added to the queue.', 'success');
            refreshQueue();
            return data.job;
        }).catch(function (error) {
            setMessage(messageId, error.message, 'error');
        });
    }

    function submitWithFiles(type, store, options, messageId) {
        setMessage(messageId, 'Uploading…');
        return uploadFiles(store).then(function (files) {
            return createJob(type, files, options, messageId);
        }).catch(function (error) {
            setMessage(messageId, error.message, 'error');
        });
    }

    function number(id, fallback) {
        var n = parseInt(val(id).value, 10);
        return isNaN(n) ? (fallback || 0) : n;
    }

    function collectVideoOptions() {
        return {
            preset: val('v-preset').value,
            target: number('v-target', 8),
            codec: val('v-codec').value,
            container: val('v-container').value,
            width: number('v-width', 0),
            height: number('v-height', 0),
            start: val('v-start').value,
            end: val('v-end').value,
            rate: val('v-rate').value,
            crf: number('v-crf', 23),
            vbitrate: number('v-vbitrate', 0),
            speed: val('v-speed').value,
            hw: val('v-hw').value,
            acodec: val('v-acodec').value,
            abitrate: number('v-abitrate', 128),
            channels: val('v-channels').value,
            twopass: val('v-2pass').checked,
            faststart: val('v-faststart').checked,
            filter: val('v-filter').value
        };
    }

    val('video-form').addEventListener('submit', function (e) {
        e.preventDefault();
        submitWithFiles('video', videoStore, collectVideoOptions(), 'video-message');
    });

    val('audio-form').addEventListener('submit', function (e) {
        e.preventDefault();
        submitWithFiles('audio', audioStore, {
            mode: val('a-mode').value,
            format: val('a-format').value,
            bitrate: number('a-bitrate', 192),
            rate: number('a-rate', 0),
            channels: number('a-channels', 0),
            normalize: val('a-normalize').checked
        }, 'audio-message');
    });

    val('social-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var url = val('s-url').value.trim();
        if (!/^https?:\/\//i.test(url)) {
            setMessage('social-message', 'Enter a link starting with http:// or https://', 'error');
            return;
        }
        setMessage('social-message', 'Adding to the queue…');
        createJob('social', [{ name: url }], {
            url: url,
            quality: val('s-quality').value
        }, 'social-message');
    });

    function parseMetadata(text) {
        var out = {};
        text.split(/\r?\n/).forEach(function (line) {
            var idx = line.indexOf('=');
            if (idx > 0) {
                out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        });
        return out;
    }

    val('media-form').addEventListener('submit', function (e) {
        e.preventDefault();
        submitWithFiles('media', mediaStore, {
            kind: val('m-kind').value,
            container: val('m-container').value,
            filter: val('m-filter').value,
            seconds: number('m-seconds', 10),
            metadata: parseMetadata(val('m-metadata').value)
        }, 'media-message');
    });

    val('tool-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var task = val('t-task').value;
        submitWithFiles(task, toolStore, {
            container: val('t-container').value,
            command: val('t-command').value
        }, 'tool-message');
    });

    // ---------- presets / behaviour ----------
    var presets = {
        'target-size': { rate: 'target', codec: 'libx264', container: 'mp4', faststart: true, crf: 23 },
        'web': { rate: 'crf', codec: 'libx264', container: 'mp4', faststart: true, crf: 23 },
        'archive': { rate: 'crf', codec: 'libx265', container: 'mkv', faststart: false, crf: 18 },
        'social': { rate: 'crf', codec: 'libx264', container: 'mp4', faststart: true, width: 1080, height: 1920, crf: 23 },
        'custom': {}
    };

    function syncRateControl() {
        var mode = val('v-rate').value;
        val('v-target').disabled = mode !== 'target';
        val('v-crf').disabled = mode !== 'crf';
        val('v-vbitrate').disabled = mode !== 'bitrate';
        val('v-2pass').disabled = mode === 'crf';
    }

    function applyOptions(options) {
        var map = {
            target: 'v-target', codec: 'v-codec', container: 'v-container', width: 'v-width', height: 'v-height',
            start: 'v-start', end: 'v-end', rate: 'v-rate', crf: 'v-crf', vbitrate: 'v-vbitrate',
            speed: 'v-speed', hw: 'v-hw', acodec: 'v-acodec', abitrate: 'v-abitrate',
            channels: 'v-channels', filter: 'v-filter'
        };
        Object.keys(map).forEach(function (key) {
            if (options[key] !== undefined && val(map[key])) { val(map[key]).value = options[key]; }
        });
        if (options.twopass !== undefined) { val('v-2pass').checked = !!options.twopass; }
        if (options.faststart !== undefined) { val('v-faststart').checked = !!options.faststart; }
        syncRateControl();
    }

    val('v-preset').addEventListener('change', function () {
        var p = presets[val('v-preset').value];
        if (!p) { return; }
        applyOptions(p);
    });
    val('v-rate').addEventListener('change', syncRateControl);
    val('v-codec').addEventListener('change', function () {
        if (val('v-codec').value === 'libvpx-vp9') { val('v-container').value = 'webm'; }
    });
    syncRateControl();

    function syncAudioMode() {
        var strip = val('a-mode').value === 'strip';
        ['a-format', 'a-bitrate', 'a-rate', 'a-channels', 'a-normalize'].forEach(function (id) {
            val(id).disabled = strip;
        });
    }
    val('a-mode').addEventListener('change', syncAudioMode);
    syncAudioMode();

    // ---------- queue ----------
    function stateClass(state) {
        if (state === 'done') { return 'state state-done'; }
        if (state === 'error') { return 'state state-error'; }
        if (state === 'running') { return 'state state-running'; }
        return 'state';
    }

    function friendlyState(state, type) {
        if (state === 'queued') { return 'Waiting to start'; }
        if (state === 'running') { return type === 'social' ? 'Downloading now' : 'Converting now'; }
        if (state === 'done') { return 'Finished'; }
        if (state === 'error') { return 'Needs attention'; }
        return state;
    }

    // Big, plain-language progress card for the job currently being worked on.
    function renderActiveProgress(jobs) {
        var card = val('active-progress');
        var active = null;
        for (var i = 0; i < jobs.length; i++) {
            if (jobs[i].state === 'running') { active = jobs[i]; break; }
        }
        if (!active) {
            for (var j = 0; j < jobs.length; j++) {
                if (jobs[j].state === 'queued') { active = jobs[j]; break; }
            }
        }
        if (!active) {
            card.hidden = true;
            return;
        }
        card.hidden = false;
        var pct = Math.max(0, Math.min(100, Number(active.progress) || 0));
        val('ap-label').textContent = friendlyState(active.state, active.type);
        val('ap-percent').textContent = pct + '%';
        val('ap-fill').style.width = pct + '%';
        card.setAttribute('aria-valuenow', String(pct));
        val('ap-file').textContent = (active.files && active.files[0]) ? active.files[0].name : active.id;
        val('ap-detail').textContent = active.speed
            ? 'Working at ' + active.speed
            : (active.state === 'queued' ? 'Waiting for a free worker…' : 'Getting everything ready…');
    }

    function renderQueue(jobs) {
        var list = val('queue-list');
        list.innerHTML = '';
        if (!jobs.length) {
            var empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = 'No jobs yet.';
            list.appendChild(empty);
            return;
        }
        jobs.forEach(function (job) {
            var li = document.createElement('li');
            li.className = 'queue-job' + (job.id === selectedJobId ? ' selected' : '');

            var row = document.createElement('div');
            row.className = 'row';
            var label = document.createElement('span');
            label.textContent = job.type.toUpperCase() + ': ' + (job.files[0] ? job.files[0].name : job.id);
            row.appendChild(label);

            var actions = document.createElement('span');
            actions.className = 'job-actions';
            if (job.output) {
                var dl = document.createElement('a');
                dl.className = 'action';
                dl.textContent = 'download';
                dl.href = 'api/download.php?file=' + encodeURIComponent(job.output);
                dl.addEventListener('click', function (e) { e.stopPropagation(); });
                actions.appendChild(dl);
            }
            if (job.state === 'queued' || job.state === 'running') {
                var cancel = document.createElement('span');
                cancel.className = 'action';
                cancel.textContent = 'cancel';
                cancel.addEventListener('click', function (e) {
                    e.stopPropagation();
                    api('api/job.php?action=cancel&id=' + encodeURIComponent(job.id), { method: 'POST' })
                        .then(refreshQueue).catch(function (err) { console.error(err); });
                });
                actions.appendChild(cancel);
            }
            var remove = document.createElement('span');
            remove.className = 'remove';
            remove.textContent = 'remove';
            remove.addEventListener('click', function (e) {
                e.stopPropagation();
                api('api/job.php?id=' + encodeURIComponent(job.id), { method: 'DELETE' })
                    .then(refreshQueue).catch(function (err) { console.error(err); });
            });
            actions.appendChild(remove);
            row.appendChild(actions);

            var meta = document.createElement('div');
            meta.className = 'row';
            var state = document.createElement('span');
            state.className = stateClass(job.state);
            state.textContent = friendlyState(job.state, job.type) + (job.speed ? ' · ' + job.speed : '');
            var pct = document.createElement('span');
            pct.className = 'pct';
            pct.textContent = (job.progress || 0) + '%';
            meta.appendChild(state);
            meta.appendChild(pct);

            var bar = document.createElement('div');
            bar.className = 'progress';
            var fill = document.createElement('span');
            fill.style.width = (job.progress || 0) + '%';
            bar.appendChild(fill);

            li.appendChild(row);
            li.appendChild(meta);
            li.appendChild(bar);
            if (job.message) {
                var msg = document.createElement('span');
                msg.className = 'job-message';
                msg.textContent = job.message;
                li.appendChild(msg);
            }
            li.addEventListener('click', function () {
                selectedJobId = job.id;
                val('log-details').open = true;
                loadLog(job.id);
                renderQueue(jobs);
            });
            list.appendChild(li);
        });
    }

    function loadLog(id) {
        api('api/job.php?id=' + encodeURIComponent(id)).then(function (data) {
            val('job-log').textContent = data.log || 'No log output yet.';
        }).catch(function () {});
    }

    function refreshQueue() {
        return api('api/jobs.php').then(function (data) {
            renderQueue(data.jobs);
            renderActiveProgress(data.jobs);
            if (selectedJobId) { loadLog(selectedJobId); }
        }).catch(function () {});
    }

    val('clear-queue').addEventListener('click', function () {
        if (!window.confirm('Clear all jobs from history?')) { return; }
        api('api/jobs.php', { method: 'DELETE' }).then(function () {
            selectedJobId = null;
            val('job-log').textContent = 'Select a job to see its log.';
            refreshQueue();
        }).catch(function () {});
    });

    // ---------- presets tab ----------
    function renderPresets(list) {
        var ul = val('preset-list');
        ul.innerHTML = '';
        if (!list.length) {
            var li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'No saved presets yet.';
            ul.appendChild(li);
            return;
        }
        list.forEach(function (presetItem) {
            var li = document.createElement('li');
            var name = document.createElement('span');
            name.textContent = presetItem.name;
            var actions = document.createElement('span');
            actions.className = 'job-actions';
            var load = document.createElement('span');
            load.className = 'action';
            load.textContent = 'load';
            load.addEventListener('click', function () {
                applyOptions(presetItem.options || {});
                setMessage('preset-message', 'Loaded "' + presetItem.name + '" into the video form.', 'success');
            });
            var del = document.createElement('span');
            del.className = 'remove';
            del.textContent = 'remove';
            del.addEventListener('click', function () {
                api('api/presets.php?id=' + encodeURIComponent(presetItem.id), { method: 'DELETE' })
                    .then(loadPresets).catch(function () {});
            });
            actions.appendChild(load);
            actions.appendChild(del);
            li.appendChild(name);
            li.appendChild(actions);
            ul.appendChild(li);
        });
    }

    function loadPresets() {
        api('api/presets.php').then(function (data) { renderPresets(data.presets); }).catch(function () {});
    }

    val('preset-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = val('p-name').value.trim() || 'Untitled preset';
        api('api/presets.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, type: 'video', options: collectVideoOptions() })
        }).then(function () {
            setMessage('preset-message', 'Saved "' + name + '".', 'success');
            val('p-name').value = '';
            loadPresets();
        }).catch(function (err) { setMessage('preset-message', err.message, 'error'); });
    });

    val('p-share').addEventListener('click', function () {
        var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(collectVideoOptions()))));
        var link = location.href.split('#')[0] + '#preset=' + encoded;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(link).then(function () {
                setMessage('preset-message', 'Share link copied to clipboard.', 'success');
            }).catch(function () {
                setMessage('preset-message', link, 'success');
            });
        } else {
            setMessage('preset-message', link, 'success');
        }
    });

    function applySharedPreset() {
        if (location.hash.indexOf('#preset=') !== 0) { return; }
        try {
            var json = decodeURIComponent(escape(atob(location.hash.slice(8))));
            applyOptions(JSON.parse(json));
            setMessage('preset-message', 'Loaded shared preset from link.', 'success');
        } catch (err) { /* ignore bad links */ }
    }

    // ---------- watchers tab ----------
    function renderWatchers(list) {
        var ul = val('watcher-list');
        ul.innerHTML = '';
        if (!list.length) {
            var li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'No watchers configured.';
            ul.appendChild(li);
            return;
        }
        list.forEach(function (watcher) {
            var li = document.createElement('li');
            var name = document.createElement('span');
            name.textContent = watcher.source + ' → ' + watcher.dest + (watcher.watch ? ' (watching)' : '');
            var remove = document.createElement('span');
            remove.className = 'remove';
            remove.textContent = 'remove';
            remove.addEventListener('click', function () {
                api('api/watchers.php?id=' + encodeURIComponent(watcher.id), { method: 'DELETE' })
                    .then(loadWatchers).catch(function () {});
            });
            li.appendChild(name);
            li.appendChild(remove);
            ul.appendChild(li);
        });
    }

    function loadWatchers() {
        api('api/watchers.php').then(function (data) { renderWatchers(data.watchers); }).catch(function () {});
    }

    val('batch-form').addEventListener('submit', function (e) {
        e.preventDefault();
        api('api/watchers.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: val('b-source').value,
                dest: val('b-dest').value,
                preset: val('b-preset').value,
                workers: number('b-workers', 4),
                watch: val('b-watch').checked,
                skip: val('b-skip').checked
            })
        }).then(function () {
            setMessage('batch-message', 'Watcher added.', 'success');
            loadWatchers();
            refreshQueue();
        }).catch(function (err) { setMessage('batch-message', err.message, 'error'); });
    });

    // ---------- engine capabilities ----------
    api('api/status.php').then(function (data) {
        var chip = val('engine-status');
        chip.classList.remove('status-loading');
        if (data.ffmpeg && data.ffprobe) {
            chip.textContent = 'Ready to convert';
            chip.title = 'All systems ready. Video engine: ' + data.ffmpeg_version.split(',')[0];
            chip.classList.add('status-ok');
        } else {
            chip.textContent = 'Needs setup';
            chip.title = 'The video engine was not found. Ask the person who set this up to install FFmpeg in the bin folder.';
            chip.classList.add('status-warn');
        }
        ['nvenc', 'qsv', 'amf'].forEach(function (gpu) {
            var option = val('v-hw').querySelector('option[value="' + gpu + '"]');
            if (option && data.gpu && !data.gpu[gpu]) {
                option.disabled = true;
                option.textContent += ' (not available)';
            }
        });
    }).catch(function () {
        var chip = val('engine-status');
        chip.textContent = "Can't check right now";
        chip.title = "We couldn't reach the local status check. Refresh the page and try again.";
        chip.classList.add('status-warn');
    });

    // ---------- boot ----------
    applySharedPreset();
    refreshQueue();
    loadPresets();
    loadWatchers();
    pollTimer = window.setInterval(refreshQueue, 1500);
})();
