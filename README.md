# Audio and Video Tool

![Audio and Video Tool logo](assets/images/logo.png)

A **local-first** video compression and audio extraction workbench. One tool that combines the useful parts of 8mb.local, ffmpeg-web, ffmpeg-commander and HBBatchBeast — without cloud storage, accounts, iOS apps, encrypted output or cloud fallback.

**Status:** complete implementation, tested end-to-end on 19 Nov 2026 — as a PHP web app, a **Windows EXE**, and an **Android APK**. See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the full build log. Inspiration credits are in [CREDITS.md](CREDITS.md).

## Download the ready-made apps

**👉 [Download Windows installer, portable EXE, or Android APK](https://github.com/jessethegreat6190/Audio-and-Video-Tool/releases/latest)**

Each release has three files:

| Your device | File to download |
|---|---|
| Windows — install it | `Audio-and-Video-Tool-<version>-Setup-x64.exe` |
| Windows — just run it, no install | `Audio-and-Video-Tool-<version>-Portable-x64.exe` |
| Android phone or tablet | `Audio-and-Video-Tool-<version>.apk` |

The APK is signed with a self-signed development certificate. Android may ask you to allow "Install unknown apps" before installing it. To build from source instead, see the sections below.

## Desktop app (Windows) and Android app

The same UI powers three packages:

| Package | How it runs | Files |
|---|---|---|
| Web (XAMPP/Docker) | PHP backend + bundled FFmpeg | see below |
| Windows EXE | Electron starts a local Node server on `127.0.0.1` and shows the UI in a window | `app/dist/*Setup*.exe`, `app/dist/*Portable*.exe` |
| Android APK | Capacitor WebView + on-device API shim + FFmpegKit | `app/dist/*.apk` |

**No internet or account is needed in any version.** Files never leave the device.

### Build the Windows EXE

Requires Node.js 20+ and the FFmpeg binaries in `bin/`.

```bash
cd app
npm install
npm run dist:exe
```

Outputs go to `app/dist/`:
- `Audio-and-Video-Tool-<version>-Setup-x64.exe` — installer (choose install folder, desktop shortcut)
- `Audio-and-Video-Tool-<version>-Portable-x64.exe` — portable, no installation

Both bundle `ffmpeg.exe` / `ffprobe.exe`. App data lives in `%APPDATA%/Audio and Video Tool/data`.

### Build the Android APK

Requires Node.js 20+, Java 17, and the Android SDK (platform 33, build-tools 33.0.2). Set `ANDROID_HOME` / `ANDROID_SDK_ROOT` first.

```bash
cd app
npm install
npm run cap:sync
cd android
gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/app-release.apk`. It includes FFmpegKit for arm64-v8a and armeabi-v7a.

The self-signed development keystore is **not committed**. Before a release build, create one (or point `android/app/build.gradle` at your own key):

```bash
keytool -genkeypair -v -keystore android/app/avt-release.keystore -alias avt `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass avt2026release -keypass avt2026release `
  -dname "CN=Audio and Video Tool, OU=Local Tools, O=Audio and Video Tool, L=Local, ST=Local, C=US"
```

The passwords above match `android/app/build.gradle`. Change them for any public release. For a quick local test without signing, use `gradlew assembleDebug` instead.

**Android limitations:** folder watching is not available (mobile apps cannot run background folder daemons). Everything else — compression, extraction, filters, presets, progress, and opening finished files — works on-device.

### Why binaries are not in the repository

The EXE (~195 MB) exceeds GitHub's 100 MB file limit, and both EXE and APK are reproducible from source. Build outputs under `app/dist/`, `app/www/`, `node_modules/`, and `android/app/build/` are gitignored.

## What it does

### Video
- **Target file size** (e.g. 8 MB) with automatic re-encode at lower bitrates if the output overshoots
- Constant quality (CRF) and average bitrate modes, optional 2-pass
- **H.264, HEVC/H.265, AV1, VP9** → MP4 / MKV / WebM
- Resolution control, trimming by start/end time, filters, speed preset, faststart
- **GPU acceleration** with real encoder validation and automatic CPU fallback (NVENC, QSV, AMF)
- Encoders are checked by actually initialising them, so a listed-but-broken GPU encoder is skipped

### Audio
- **Extract audio from video**, convert audio files, and strip audio from video
- MP3, M4A/AAC, FLAC, Opus, WAV with bitrate, sample rate, channels and optional loudness normalisation

### Media tools
- Apply FFmpeg filter strings, merge files (concat), edit metadata, image (optional audio) → video

### Automation
- Batch queue with a **large percentage progress panel** while converting, plus per-job bars, live logs, speed, cancel/remove/clear and downloadable outputs
- **Folder watching**: recursive scan, skip existing files, optional continuous polling, different presets per watcher, finished files copied to a destination folder
- Saved presets with **shareable links** and custom FFmpeg argument jobs
- Health check / repair for corrupt files and a 10-second H.265 benchmark

## Quick start (XAMPP / local PHP)

1. Put the folder at `C:\xampp\htdocs\audio-and-video-tool`.
2. **FFmpeg setup:** the ~344 MB Windows binaries are intentionally **not committed**. Download a static Windows build and place `ffmpeg.exe` and `ffprobe.exe` in `bin/`, or set the `FFMPEG_BINARY` / `FFPROBE_BINARY` environment variables. On Docker/Linux, FFmpeg is installed by the package manager and found on `PATH`.
3. Start Apache, then open `http://localhost/audio-and-video-tool/`.
   - Or use the built-in server: `C:\xampp\php\php.exe -S 127.0.0.1:8080 -t C:\xampp\htdocs\audio-and-video-tool`
4. The status chip in the header must read **Engine ready**.

Nothing is uploaded anywhere — files stay under `uploads/`, outputs under `outputs/`, jobs under `jobs/`, logs under `logs/`.

## Docker (headless / server)

```bash
docker build -t audio-and-video-tool .
docker run -p 8080:8080 -v "$PWD/outputs:/app/outputs" audio-and-video-tool
```

Then open `http://localhost:8080/`. On Linux the image uses the `ffmpeg` from Alpine's package repo.

## Project layout

```
index.php          UI shell — 6 tabs + queue
worker.php         queue worker and watcher scanner
includes/          config, helpers, job store, encoder, watchers
api/               status, upload, jobs, job, presets, watchers, download
assets/css/        ALL CSS (separate file)
assets/js/         ALL JavaScript (separate file)
bin/               bundled FFmpeg binaries (Windows, gitignored)
```

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `api/status.php` | GET | Version, FFmpeg info, encoder/GPU capabilities |
| `api/upload.php` | POST | Multipart upload (`files[]`) |
| `api/jobs.php` | GET/POST/DELETE | List, create, clear jobs |
| `api/job.php?id=…` | GET/DELETE | Job status + log / delete |
| `api/job.php?action=cancel&id=…` | POST | Cancel a job |
| `api/presets.php` | GET/POST/DELETE | Saved presets |
| `api/watchers.php` | GET/POST/DELETE | Folder watchers |
| `api/download.php?file=…` | GET | Download an output |

## Editing rules

- CSS only in `assets/css/`, JavaScript only in `assets/js/`, PHP logic in `api/` and `includes/`.
- Update the build log in `PROJECT_PLAN.md` after every change.

Stack: PHP 8.2 + plain HTML/CSS/JS + FFmpeg. No build step, no framework, no account system.
