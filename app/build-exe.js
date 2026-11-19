'use strict';

/**
 * Build both Windows installers with distinct names (electron-builder otherwise
 * gives both targets the same filename and the second overwrites the first).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const pkgPath = path.join(__dirname, 'package.json');
const original = fs.readFileSync(pkgPath, 'utf8');

function build(target, suffix) {
    const cfg = JSON.parse(original);
    cfg.build.win.target = [target];
    cfg.build.win.artifactName = 'Audio-and-Video-Tool-${version}-' + suffix + '-${arch}.${ext}';
    fs.writeFileSync(pkgPath, JSON.stringify(cfg, null, 2));
    console.log('\n=== Building ' + target + ' ===');
    const r = spawnSync('npx', ['electron-builder', '--win', '--x64', '--publish', 'never'], {
        cwd: __dirname, stdio: 'inherit', shell: true,
    });
    if (r.status !== 0) throw new Error(target + ' build failed');
}

try {
    const only = process.argv[2];
    if (only === 'nsis' || only === 'portable') {
        build(only, only === 'nsis' ? 'Setup' : 'Portable');
    } else {
        build('nsis', 'Setup');
        build('portable', 'Portable');
    }
    console.log('\n=== Artifacts ===');
    const dist = path.join(__dirname, 'dist');
    for (const f of fs.readdirSync(dist)) {
        if (f.endsWith('.exe')) console.log(f, (fs.statSync(path.join(dist, f)).size / 1048576).toFixed(1) + ' MB');
    }
} finally {
    fs.writeFileSync(pkgPath, original);
}
