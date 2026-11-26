# Audio and Video Tool — Project Plan & Build Log

**Project name:** Audio and Video Tool
**Working codename:** VidCrunch (optional brand name)
**Location:** `C:\xampp\htdocs\audio-and-video-tool`
**Local URL:** `http://localhost/audio-and-video-tool/`
**Current status:** Steps 1–22 complete and tested. Web app (PHP) + Windows EXE + Android APK all built from the same UI.

---

## 1. Goal

Build **one local tool** that combines the useful parts of the four GitHub projects we examined:

| Project | What we take from it |
|---|---|
| `JMS1717/8mb.local` | Target file-size compression, GPU encoding (NVENC/QSV/AMF/VAAPI), queue, job history, trimming, auto re-encode when over target |
| `dinoosauro/ffmpeg-web` | Audio extract/convert, filters, merge, metadata editing, image-to-video, custom FFmpeg command, offline UI |
| `alfg/ffmpeg-commander` | Preset picker, shareable settings via URL, light/dark theme |
| `HaveAGitGat/HBBatchBeast` | Batch conversion, recursive folder scans, folder watching, multiple workers, health check, benchmark |

We write **our own implementation**. We may borrow UI ideas and layout patterns, but we will not copy source files wholesale — the four projects have different licenses. Sources are credited in `CREDITS.md`.

## 2. Deliberately NOT building

- Cloud storage integration (Drive / Dropbox / OneDrive / S3)
- iOS or other mobile apps
- Login, accounts, or multi-user permissions
- Encrypted / password-protected output files
- Managed cloud fallback

Everything runs locally and binds to `localhost` by default.

## 3. Stack decision

| Layer | Choice | Why |
|---|---|---|
| Backend | PHP (`C:\xampp\php\php.exe`) | Already installed, no build step, easy to edit inside XAMPP |
| Frontend | Plain HTML + **separate CSS** + **separate JS** | Easy for us to edit "here and there"; no framework build |
| Engine | FFmpeg / FFprobe | Same engine all four projects use |
| Storage | Files + JSON for presets/history first, SQLite later | Simple to start |

## 4. Environment findings

- PHP is installed at `C:\xampp\php\php.exe`, but `php` is **not on PATH**.
- Apache is installed at `C:\xampp\apache\bin\httpd.exe`.
- `ffmpeg` was **not on PATH** and no copy existed on `C:\`. Step 2 downloaded a static Windows GPL build into `bin/` and pointed `config.php` at it. Verified encoders: libx264, libx265, libaom-av1, libvpx-vp9, NVENC, QSV, AMF, libmp3lame, libopus.

## 5. File layout

```
audio-and-video-tool/
├── PROJECT_PLAN.md        <- this living document
├── README.md
├── CREDITS.md
├── index.php              <- UI shell (6 tabs + queue)
├── worker.php             <- queue worker + watcher scanner (flock-protected)
├── Dockerfile             <- headless Docker build
├── .dockerignore
├── includes/
│   ├── config.php         <- paths and constants
│   ├── functions.php      <- shared helpers (run, probe, encoders, log)
│   ├── jobs.php           <- JSON job store
│   ├── encoder.php        <- FFmpeg command builders + job runner
│   └── watchers.php       <- recursive folder scan + job creation
├── api/
│   ├── status.php         <- capabilities (version, encoders, GPU flags)
│   ├── upload.php         <- multipart upload
│   ├── jobs.php           <- list / create / clear jobs
│   ├── job.php            <- single job: status, log, cancel, delete
│   ├── presets.php        <- saved presets
│   ├── watchers.php       <- folder watchers
│   └── download.php       <- serve finished outputs
├── assets/
│   ├── css/
│   │   └── style.css      <- ALL CSS here
│   └── js/
│       └── app.js         <- ALL JavaScript here
├── bin/                   <- bundled ffmpeg.exe / ffprobe.exe (gitignored)
├── uploads/               <- runtime (gitignored)
├── outputs/               <- runtime (gitignored)
├── jobs/                  <- job JSON files (gitignored)
├── logs/                  <- logs + pass logs (gitignored)
├── presets.json           <- saved presets
└── watchers.json          <- folder watchers
```

## 6. Feature scope

**MVP (first working release)**
- Target-size video compression with auto re-encode if output exceeds target
- H.264 / HEVC / AV1 output, MP4/MKV container
- Trimming (start/end), resolution control, audio bitrate
- Queue with progress and live FFmpeg logs, cancel/clear jobs
- Job history
- **Audio extract, strip and format conversion** (MP3, M4A/AAC, FLAC, Opus, WAV…)
- Local status/capabilities endpoint
- Docker build for headless use

**Phase 2**
- Preset picker with shareable URL settings, custom command entry
- Batch folder watching, recursive scans, multiple workers, skip existing files
- Light/dark theme polish

**Phase 3**
- Filters, merge, metadata editing, image-to-video
- Corrupt-file health check and basic h265 benchmark

> All three phases are now implemented. See the build log below.

## 7. Build log (updated after every step)

| Step | Task | Status | Notes |
|---|---|---|---|
| 1 | Write plan + scaffold folder, separate CSS/JS, status stub | **DONE** | Verified 19 Nov 2026: PHP 8.2.12 at `C:\xampp\php\php.exe`; all 3 PHP files pass `php -l`; UI renders at `http://127.0.0.1:8080/`; `api/status.php` returns JSON (`ffmpeg: false`, `ffprobe: false`, dirs created). No encode logic yet. |
| 2 | Configure PHP runtime + install/point to FFmpeg | **DONE** | Downloaded BtbN win64-gpl static build (205 MB) to `bin/`, extracted `ffmpeg.exe` (172 MB) + `ffprobe.exe` (172 MB), deleted archive/extract dir, set `FFMPEG_BINARY`/`FFPROBE_BINARY` in `config.php`. `ffmpeg -version` and encoder list verified. `api/status.php` now reports `ffmpeg: true`, `ffprobe: true`. |
| 3 | Finish UI shell: tabs, drop zone, presets, advanced options | **DONE** | Added advanced options (rate control, CRF, bitrate, speed, hardware, audio codec/channels, 2-pass, faststart), audio sample-rate/channels/normalize, batch workers/skip-existing, file size summaries, file-type validation, preset-driven field changes, queue rows with progress bars and remove. Reloaded in browser: no console errors; status chip reads "Engine ready". |
| 4 | Implement capabilities/status endpoint fully | **DONE** | `api/status.php` reports PHP/FFmpeg versions, directories, GPU flags and availability of 19 encoders. UI disables NVENC/QSV/AMF options that are unavailable. Fixed encoder regex (flags include D/F/X/B) and hyphenated names like `libaom-av1`. |
| 5 | Implement upload + job queue storage | **DONE** | `api/upload.php` (multipart, 4 GB cap, sanitised names), `includes/jobs.php` JSON store, `api/jobs.php` create/list/clear. Uploaded files stay in `uploads/`. |
| 6 | Implement video encode worker | **DONE** | `worker.php` + `includes/encoder.php`. Target-size mode computes bitrate from duration, re-encodes up to 3 times at 85% if over target, optional 2-pass. Encoder validation runs a real 1-frame test — "auto" fell back to CPU on this Intel laptop because NVENC has no GPU. Fixed 2-pass audio log error. Verified: 3 s sample → valid MP4. |
| 7 | Implement audio extract/convert worker | **DONE** | Extract/convert/strip with MP3, M4A/AAC, FLAC, Opus, WAV; bitrate, sample rate, channels, loudnorm. Verified: MP3 extract produced a 48 KB file. |
| 8 | Presets + custom command execution | **DONE** | `api/presets.php`, save/load/delete presets, URL share link via `#preset=`. Custom FFmpeg arguments job supported. Both verified. |
| 9 | Batch / folder watching + workers | **DONE** | `api/watchers.php` + `includes/watchers.php`: recursive scan, skip existing, optional continuous polling (10 s), copy finished output to destination, flock-protected single worker. Verified: watched file converted and copied. |
| 10 | Job history, progress streaming, logs | **DONE** | `api/job.php` (status/log/cancel/delete), 1.5 s UI polling, progress bars, speed, per-job logs, cancel/remove/clear, `api/download.php` for outputs. Download verified (HTTP 200). |
| 11 | Filters, merge, metadata, image-to-video | **DONE** | Media tools panel: filter, concat merge, metadata edit, image (optional audio) → video. Filter job verified. |
| 12 | Health check + benchmark | **DONE** | Health check probes streams and remux-repairs corrupt files; 10 s H.265 benchmark reports speed. Both verified. |
| 13 | Docker build + final README | **DONE** | `Dockerfile` (php:8.2-cli-alpine + ffmpeg), `.dockerignore`, final `README.md`. All 14 PHP files pass `php -l`; UI reloaded with no console errors. |
| 14 | Netflix colours + fonts | **DONE** | CSS-only change in `assets/css/style.css`: Netflix red `#e50914` accent, near-black `#000/#141414/#181818` surfaces, white/`#b3b3b3` type, Netflix green `#46d369` for success, sharper 4 px corners, red header top bar, red active-tab edge, red progress/glow, bold Helvetica Neue stack (closest local match to proprietary Netflix Sans). Light theme keeps the red accent. |
| 15 | Add project logo | **DONE** | Copied `download (10).jpg` (736×736) from Downloads to `assets/images/logo.jpg`, generated a 256×256 `logo.png`. Header now shows the logo beside the app name; PNG used as favicon; README shows the logo at the top. All CSS changes stayed in `style.css`. |
| 16 | Client-friendly wording | **DONE** | Status chip now says "Ready to convert" / "Needs setup" / "Can't check right now" with a coloured dot; the FFmpeg version moved into a hover tooltip for technical users. Tagline simplified to plain English. |
| 17 | Large conversion progress bar | **DONE** | Added a prominent `#active-progress` card above the queue with a big percentage, thick red animated bar, file name and speed. Plain-language states: "Waiting to start" / "Converting now" / "Finished" / "Needs attention". CSS in `style.css`, logic in `app.js`. **Bug fixed:** FFmpeg progress and stderr came through `proc_open` pipes. On Windows the pipe buffer is tiny and `stream_set_blocking(false)` is unreliable — `fgets()` blocked on a half-written line, the buffer filled and long encodes froze (reproduced at 9%, then 0%). Progress and stderr now write to files (`logs/<job>.progress`, `logs/<job>.log`) and the worker polls them, so deadlocks are impossible. Verified: a 120 s sample advanced 0→10→…→100% and finished in 16 s; browser card showed 14% mid-encode then hid on completion. Audio, custom, media and health jobs now pass probed duration so their bars also move. |

## 9. Native apps — Windows EXE + Android APK

**Published downloads:** https://github.com/jessethegreat6190/Audio-and-Video-Tool/releases/latest — all three installers are attached to the `v0.3.0` GitHub Release. Release assets can be up to 2 GB each, unlike files committed into the repo (100 MB limit), so users can download the apps directly from there.

**Built files** (generated locally, not committed into the repo):
- `app/dist/Audio-and-Video-Tool-0.3.0-Setup-x64.exe` — Windows installer
- `app/dist/Audio-and-Video-Tool-0.3.0-Portable-x64.exe` — Windows portable
- `app/dist/Audio-and-Video-Tool-0.3.0.apk` — signed Android release APK

Rebuild with `npm install && npm run dist:exe` (Windows) and `npm run cap:sync`, then `cd android && gradlew assembleRelease` (Android). See README for details.

**Decision (19 Nov 2026):** build a single JavaScript backend so the same UI and job logic power both packages.
- Windows: Electron shell starts the local Node server on `127.0.0.1` and shows it in a window. electron-builder produces an NSIS installer and a portable `.exe`. PHP is no longer needed at runtime.
- Android: Capacitor WebView loads the same UI; a browser-side API shim uses Capacitor Filesystem for storage and a native FFmpeg plugin for encoding. Folder watching is limited on Android (no background daemon), but all encode/extract/filter tools work.
- Keeps the current PHP version untouched as a working reference; the JS implementation lives under `app/`.

| Step | Task | Status | Notes |
|---|---|---|---|
| 18 | Port backend to Node.js with API parity | **DONE** | `app/server.js` + `app/lib/*` (config, util, store, encoder, watchers). Same endpoints and JSON job format as PHP. Progress + stderr written to files, so no pipe deadlocks. Smoke test: upload → job `job_20261119084334_8844aa1e` reached `state=done`, `progress=100%`, speed 24.2x; output was valid H.264 320x240. |
| 19 | Static frontend copy + native API shim | **DONE** | `app/copy-web.js` builds `app/www/` from `index.php` + `assets/`, strips PHP tags, copies `native/avt-api.js`, and injects a `fetch()` shim into the copied `app.js`. On Android the shim implements every API endpoint on-device with Capacitor Filesystem + FFmpegKit; upload captures media duration so the percentage bar works. |
| 20 | Windows EXE build | **DONE** | Electron main process starts the Node server on a free `127.0.0.1` port with data in `%APPDATA%/Audio and Video Tool/data`. electron-builder produces **NSIS Setup** and **portable** EXEs with `bin/ffmpeg.exe` + `ffprobe.exe` bundled. `npm run dist:exe` builds both with distinct filenames (see `app/build-exe.js`). Smoke tested the portable build: valid H.264 output, 100% progress. |
| 21 | Android APK build | **DONE** | Capacitor 5 + `@capacitor/filesystem`, patched `capacitor-ffmpeg-kit` (promise resolution + time-based progress) and `@capacitor-community/file-opener`. FFmpegKit 6.0.LTS comes from a public mirror because Maven Central removed it. Android SDK cmdline-tools + platform 33 + build-tools 33.0.2 installed locally; signed release APK built and verified (FFmpeg `.so` libs for arm64-v8a + armeabi-v7a present, signature valid). Folder watching is intentionally unavailable in the mobile sandbox. |
| 22 | Social Video downloader | **DONE** | Added free yt-dlp 2026.11.23 to `bin/` (23.6 MB). New "Social Video" tab: paste link, choose best / 720p / 480p / audio-only MP3; same big progress bar and queue; output saved in `outputs/`. Visible rule: only download your own videos or videos you are allowed to save. Added `includes/social.php` (PHP worker) and `runSocial()` in `app/lib/encoder.js` (Node worker) with file-based progress parsing so Windows cannot deadlock. Status endpoint reports `ytdlp`. EXE packaging includes `yt-dlp.exe`; Android shim rejects social jobs with a clear message. Tested end-to-end in PHP and Node with a CC0 sample link: job `state=done`, `progress=100%`, valid MP4 saved. Live TikTok check succeeded: yt-dlp solved TikTok's JS challenge and reached the video feed (the test used a whole profile page, so it was stopped after 23 pages). Single-video links should work; some sites may still ask for your own login cookie. |

### Bugs found and fixed during testing
1. **Encoder detection** matched only QSV encoders (flag class missed `D`, `F`, `X`, `B`; legend line captured `=`). Fixed regex + name validation.
2. **Hardware "auto" picked NVENC without a GPU** → invalid argument. Added real 1-frame encoder initialisation test with CPU fallback.
3. **2-pass target encode failed** because pass 1 used `-an`, so FFmpeg never wrote the audio pass log. Pass 1 now keeps audio.
4. **Trim end with `00:00:xx`** was cast to float `0`. Added `avt_time_seconds()` parser.

## 8. Editing rules

- **All CSS goes in `assets/css/*.css`** — no inline `style` attributes.
- **All JavaScript goes in `assets/js/*.js`** — no inline `<script>` blocks.
- PHP logic goes in `api/` and `includes/`.
- Update this document after each step: mark the step DONE and set the next step to NEXT.
- Keep changes small and reversible so we can edit "here and there".

## 10. Live streaming support log

| Date | Task | Status | Notes |
|---|---|---|---|
| 26 Nov 2026 | Reset OBS NDI source to clean defaults | **DONE** | Reset the DistroAV input `NDI® Source 2` while OBS stayed open. Kept the sender name `TOKOIVAN24 (FreeShow NDI - LIVE)`, cleared the extra `DistroAV - Fix alpha blending` filter, and set both Preview and Program to scene `MAIN`. The OBS log confirms defaults: Bandwidth `0` (Highest), Behaviour `2`, Sync `2`, Colour range `1`, Colour space `2`, Latency `0`, no alpha filter. No account password or stream key was changed. |
| 26 Nov 2026 | Diagnose striped NDI lyrics | **DONE** | A source capture showed the FreeShow NDI sender is only delivering **178 × 100** pixels, so OBS is stretching a tiny image and producing horizontal stripes. Switched OBS back from the duplicate `TOKOIVAN24 (FreeShow NDI - LIVE 1)` name to `TOKOIVAN24 (FreeShow NDI - LIVE)`. The real fix is on the FreeShow PC: set the NDI output size to 1920×1080 or 1280×720 (or resize the invisible output window) and keep 25/30 fps. |
| 26 Nov 2026 | OBS full video back to TOKOIVAN | **DONE** | Documented the return path: enable **Tools → DistroAV NDI Settings → Main Output**, name it `AVT-OBS-FULL`, then receive it on TOKOIVAN with **NDI Studio Monitor** and make that window fullscreen on the church display. Both PCs must stay on the same LAN/subnet. |
| 26 Nov 2026 | NDI source listed on TOKOIVAN but no video | **IN PROGRESS** | OBS `NDI Main Output` verified active with 15,000+ delivered frames and locally visible as `FUTURE (AVT-OBS-FULL) (720/25p)`. TOKOIVAN discovers the name but cannot receive video, so the likely cause is NDI choosing one of the OBS PC's virtual adapters instead of Wi‑Fi `172.24.189.28`. Fix: choose Wi‑Fi as the dedicated NDI send interface in NDI Access Manager, or temporarily disable `vEthernet (WSL…)`, `vEthernet (Default Switch)` and `Ethernet 2` (VirtualBox), then restart OBS. |
