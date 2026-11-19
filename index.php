<?php
require __DIR__ . '/includes/config.php';
?>
<!doctype html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?php echo htmlspecialchars(APP_NAME); ?></title>
    <link rel="icon" type="image/png" href="assets/images/logo.png">
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <header class="app-header">
        <div class="brand">
            <img src="assets/images/logo.jpg" alt="Audio and Video Tool logo" class="brand-logo">
            <div class="brand-text">
                <h1><?php echo htmlspecialchars(APP_NAME); ?></h1>
                <span class="tagline">Local video compression &amp; audio extraction workbench</span>
            </div>
        </div>
        <div class="header-actions">
            <span id="engine-status" class="status-chip status-loading">Checking engine…</span>
            <button type="button" id="theme-toggle" class="btn btn-ghost">Toggle theme</button>
        </div>
    </header>

    <main class="layout">
        <nav class="tabs" aria-label="Tool sections">
            <button type="button" class="tab active" data-tab="video">Video</button>
            <button type="button" class="tab" data-tab="audio">Audio</button>
            <button type="button" class="tab" data-tab="media">Media tools</button>
            <button type="button" class="tab" data-tab="batch">Batch / Watch</button>
            <button type="button" class="tab" data-tab="presets">Presets</button>
            <button type="button" class="tab" data-tab="tools">Tools</button>
        </nav>

        <div class="workspace">
            <div class="panels">
                <!-- VIDEO -->
                <section id="tab-video" class="panel active" data-panel="video">
                    <h2>Compress video</h2>
                    <div id="drop-zone" class="drop-zone" tabindex="0">
                        <strong>Drop video files here</strong>
                        <span>or click to browse</span>
                        <span id="video-file-summary" class="file-summary">No files selected</span>
                        <input type="file" id="video-files" accept="video/*" multiple hidden>
                    </div>
                    <ul id="video-file-list" class="file-list"></ul>

                    <form id="video-form" class="form-grid">
                        <label>Preset
                            <select id="v-preset" name="preset">
                                <option value="target-size">Target file size</option>
                                <option value="web">Web / streaming</option>
                                <option value="archive">Archive / quality</option>
                                <option value="social">Social 9:16</option>
                                <option value="custom">Custom</option>
                            </select>
                        </label>
                        <label>Target size (MB)
                            <input type="number" id="v-target" name="target" min="1" max="4096" value="8">
                        </label>
                        <label>Codec
                            <select id="v-codec" name="codec">
                                <option value="libx264">H.264</option>
                                <option value="libx265">HEVC / H.265</option>
                                <option value="libaom-av1">AV1</option>
                                <option value="libvpx-vp9">VP9 (WebM)</option>
                            </select>
                        </label>
                        <label>Container
                            <select id="v-container" name="container">
                                <option value="mp4">MP4</option>
                                <option value="mkv">MKV</option>
                                <option value="webm">WebM</option>
                            </select>
                        </label>
                        <label>Max width
                            <input type="number" id="v-width" name="width" min="0" value="1920">
                        </label>
                        <label>Max height
                            <input type="number" id="v-height" name="height" min="0" value="1080">
                        </label>
                        <label>Trim start
                            <input type="text" id="v-start" name="start" placeholder="00:00:00">
                        </label>
                        <label>Trim end
                            <input type="text" id="v-end" name="end" placeholder="00:00:00">
                        </label>

                        <details class="advanced" id="video-advanced">
                            <summary>Advanced options</summary>
                            <div class="form-grid advanced-grid">
                                <label>Rate control
                                    <select id="v-rate" name="rate">
                                        <option value="target">Target file size</option>
                                        <option value="crf">Constant quality (CRF)</option>
                                        <option value="bitrate">Average bitrate</option>
                                    </select>
                                </label>
                                <label>CRF (lower = better)
                                    <input type="number" id="v-crf" name="crf" min="0" max="63" value="23">
                                </label>
                                <label>Video bitrate (k)
                                    <input type="number" id="v-vbitrate" name="vbitrate" min="0" value="0">
                                </label>
                                <label>Speed preset
                                    <select id="v-speed" name="speed">
                                        <option value="ultrafast">Ultrafast</option>
                                        <option value="veryfast" selected>Very fast</option>
                                        <option value="fast">Fast</option>
                                        <option value="medium">Medium</option>
                                        <option value="slow">Slow</option>
                                    </select>
                                </label>
                                <label>Hardware
                                    <select id="v-hw" name="hw">
                                        <option value="auto">Auto detect</option>
                                        <option value="cpu">CPU only</option>
                                        <option value="nvenc">NVIDIA NVENC</option>
                                        <option value="qsv">Intel QSV</option>
                                        <option value="amf">AMD AMF</option>
                                    </select>
                                </label>
                                <label>Audio codec
                                    <select id="v-acodec" name="acodec">
                                        <option value="aac">AAC</option>
                                        <option value="libmp3lame">MP3</option>
                                        <option value="libopus">Opus</option>
                                        <option value="copy">Copy original</option>
                                    </select>
                                </label>
                                <label>Audio bitrate (k)
                                    <input type="number" id="v-abitrate" name="abitrate" min="0" value="128">
                                </label>
                                <label>Audio channels
                                    <select id="v-channels" name="channels">
                                        <option value="2">Stereo</option>
                                        <option value="6">5.1</option>
                                        <option value="copy">Copy original</option>
                                    </select>
                                </label>
                                <label class="check"><input type="checkbox" id="v-2pass" name="twopass"> Two-pass encode</label>
                                <label class="check"><input type="checkbox" id="v-faststart" name="faststart" checked> Web faststart</label>
                                <label class="wide">Filter string (optional)
                                    <input type="text" id="v-filter" name="filter" placeholder="eq=contrast=1.1: saturation=1.2">
                                </label>
                            </div>
                        </details>

                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">Add to queue</button>
                            <button type="reset" class="btn btn-ghost">Reset</button>
                        </div>
                    </form>
                    <p id="video-message" class="message" role="status"></p>
                </section>

                <!-- AUDIO -->
                <section id="tab-audio" class="panel" data-panel="audio">
                    <h2>Extract &amp; convert audio</h2>
                    <div id="audio-drop-zone" class="drop-zone" tabindex="0">
                        <strong>Drop video or audio files here</strong>
                        <span>or click to browse</span>
                        <span id="audio-file-summary" class="file-summary">No files selected</span>
                        <input type="file" id="audio-files" accept="video/*,audio/*" multiple hidden>
                    </div>
                    <ul id="audio-file-list" class="file-list"></ul>

                    <form id="audio-form" class="form-grid">
                        <label>Operation
                            <select id="a-mode" name="mode">
                                <option value="extract">Extract audio from video</option>
                                <option value="convert">Convert audio file</option>
                                <option value="strip">Strip audio from video</option>
                            </select>
                        </label>
                        <label>Output format
                            <select id="a-format" name="format">
                                <option value="mp3">MP3</option>
                                <option value="m4a">M4A / AAC</option>
                                <option value="flac">FLAC</option>
                                <option value="opus">Opus</option>
                                <option value="wav">WAV</option>
                            </select>
                        </label>
                        <label>Bitrate (k)
                            <input type="number" id="a-bitrate" name="bitrate" min="0" value="192">
                        </label>
                        <label>Sample rate
                            <select id="a-rate" name="rate">
                                <option value="48000">48 kHz</option>
                                <option value="44100">44.1 kHz</option>
                                <option value="0">Keep original</option>
                            </select>
                        </label>
                        <label>Channels
                            <select id="a-channels" name="channels">
                                <option value="2">Stereo</option>
                                <option value="1">Mono</option>
                                <option value="0">Keep original</option>
                            </select>
                        </label>
                        <label class="check"><input type="checkbox" id="a-normalize" name="normalize"> Normalize volume</label>
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">Add to queue</button>
                            <button type="reset" class="btn btn-ghost">Reset</button>
                        </div>
                    </form>
                    <p id="audio-message" class="message" role="status"></p>
                </section>

                <!-- MEDIA -->
                <section id="tab-media" class="panel" data-panel="media">
                    <h2>Media tools</h2>
                    <div id="media-drop-zone" class="drop-zone" tabindex="0">
                        <strong>Drop media files here</strong>
                        <span>or click to browse</span>
                        <span id="media-file-summary" class="file-summary">No files selected</span>
                        <input type="file" id="media-files" accept="video/*,audio/*,image/*" multiple hidden>
                    </div>
                    <ul id="media-file-list" class="file-list"></ul>
                    <form id="media-form" class="form-grid">
                        <label>Operation
                            <select id="m-kind" name="kind">
                                <option value="filter">Apply filter</option>
                                <option value="merge">Merge files</option>
                                <option value="metadata">Edit metadata</option>
                                <option value="image-to-video">Image → video</option>
                            </select>
                        </label>
                        <label>Container
                            <select id="m-container" name="container">
                                <option value="mp4">MP4</option>
                                <option value="mkv">MKV</option>
                                <option value="webm">WebM</option>
                            </select>
                        </label>
                        <label class="wide">Filter string
                            <input type="text" id="m-filter" name="filter" placeholder="eq=contrast=1.1, hflip">
                        </label>
                        <label>Seconds (image → video)
                            <input type="number" id="m-seconds" name="seconds" min="1" max="3600" value="10">
                        </label>
                        <label class="wide">Metadata (one per line, key=value)
                            <textarea id="m-metadata" name="metadata" rows="3" placeholder="title=My video&#10;comment=Local encode"></textarea>
                        </label>
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">Add to queue</button>
                        </div>
                    </form>
                    <p id="media-message" class="message" role="status"></p>
                </section>

                <!-- BATCH -->
                <section id="tab-batch" class="panel" data-panel="batch">
                    <h2>Batch &amp; folder watching</h2>
                    <form id="batch-form" class="form-grid">
                        <label class="wide">Source folder
                            <input type="text" id="b-source" placeholder="C:\\Videos\\Incoming">
                        </label>
                        <label class="wide">Destination folder
                            <input type="text" id="b-dest" placeholder="C:\\Videos\\Converted">
                        </label>
                        <label>Preset
                            <select id="b-preset">
                                <option value="target-size">Target file size</option>
                                <option value="web">Web / streaming</option>
                                <option value="archive">Archive / quality</option>
                            </select>
                        </label>
                        <label>Workers
                            <input type="number" id="b-workers" min="1" max="16" value="4">
                        </label>
                        <label class="check"><input type="checkbox" id="b-watch"> Watch folder continuously</label>
                        <label class="check"><input type="checkbox" id="b-skip" checked> Skip files already in destination</label>
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">Add watcher</button>
                        </div>
                    </form>
                    <h3>Watchers</h3>
                    <ul id="watcher-list" class="file-list"></ul>
                    <p id="batch-message" class="message" role="status"></p>
                </section>

                <!-- PRESETS -->
                <section id="tab-presets" class="panel" data-panel="presets">
                    <h2>Presets</h2>
                    <p class="hint">Save the current video settings, reuse them, or copy a share link.</p>
                    <form id="preset-form" class="form-grid">
                        <label class="wide">Preset name
                            <input type="text" id="p-name" placeholder="My 8 MB preset">
                        </label>
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">Save current video settings</button>
                            <button type="button" id="p-share" class="btn btn-ghost">Copy share link</button>
                        </div>
                    </form>
                    <ul id="preset-list" class="file-list"></ul>
                    <p id="preset-message" class="message" role="status"></p>
                </section>

                <!-- TOOLS -->
                <section id="tab-tools" class="panel" data-panel="tools">
                    <h2>Tools</h2>
                    <div id="tool-drop-zone" class="drop-zone" tabindex="0">
                        <strong>Drop a file for health check / benchmark / custom command</strong>
                        <span>or click to browse</span>
                        <span id="tool-file-summary" class="file-summary">No files selected</span>
                        <input type="file" id="tool-files" accept="video/*,audio/*" hidden>
                    </div>
                    <ul id="tool-file-list" class="file-list"></ul>
                    <form id="tool-form" class="form-grid">
                        <label>Task
                            <select id="t-task">
                                <option value="health">Health check / repair</option>
                                <option value="benchmark">H.265 benchmark (10s)</option>
                                <option value="custom">Custom FFmpeg arguments</option>
                            </select>
                        </label>
                        <label>Container (custom / benchmark)
                            <select id="t-container">
                                <option value="mkv">MKV</option>
                                <option value="mp4">MP4</option>
                            </select>
                        </label>
                        <label class="wide">Custom FFmpeg arguments
                            <input type="text" id="t-command" placeholder="-vf hflip -c:a copy">
                        </label>
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">Add to queue</button>
                        </div>
                    </form>
                    <p id="tool-message" class="message" role="status"></p>
                </section>
            </div>

            <aside class="queue">
                <div class="queue-head">
                    <h2>Queue</h2>
                    <button type="button" id="clear-queue" class="btn btn-ghost btn-small">Clear</button>
                </div>
                <ul id="queue-list" class="queue-list">
                    <li class="empty">No jobs yet.</li>
                </ul>
                <details id="log-details">
                    <summary>Job log</summary>
                    <pre id="job-log">Select a job to see its log.</pre>
                </details>
            </aside>
        </div>
    </main>

    <footer class="app-footer">
        <span>Version <?php echo htmlspecialchars(APP_VERSION); ?></span>
        <span>Local only — no cloud, no account.</span>
    </footer>

    <script src="assets/js/app.js"></script>
</body>
</html>
