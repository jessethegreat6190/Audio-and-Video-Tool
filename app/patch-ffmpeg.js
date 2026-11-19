'use strict';

/** Apply the patched FFmpeg bridge to the installed plugin (runs after npm install). */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'patches', 'FfmpegkitPlugin.java');
const dest = path.join(
    __dirname, 'node_modules', 'capacitor-ffmpeg-kit', 'android', 'src', 'main', 'java', 'com', 'capacitor', 'ffmpeg', 'kit', 'FfmpegkitPlugin.java'
);

if (!fs.existsSync(src)) {
    console.error('Patch source missing:', src);
    process.exit(1);
}
if (!fs.existsSync(path.dirname(dest))) {
    console.log('FFmpeg plugin not installed; skipping patch.');
    process.exit(0);
}
fs.copyFileSync(src, dest);

const gradleSrc = path.join(__dirname, 'patches', 'ffmpegkit-build.gradle');
const gradleDest = path.join(
    __dirname, 'node_modules', 'capacitor-ffmpeg-kit', 'android', 'build.gradle'
);
if (fs.existsSync(gradleSrc) && fs.existsSync(gradleDest)) {
    fs.copyFileSync(gradleSrc, gradleDest);
    console.log('Patched FFmpeg Gradle dependency installed.');
}

console.log('Patched FFmpeg bridge installed.');
