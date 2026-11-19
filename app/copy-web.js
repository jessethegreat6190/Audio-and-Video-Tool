'use strict';

/**
 * Build app/www/ from the PHP frontend:
 *  - index.php  -> index.html (PHP echo tags replaced with plain text)
 *  - assets/    copied verbatim, with the Capacitor API hook injected into app.js
 * Run before electron-builder or cap sync.
 */

const fs = require('fs');
const path = require('path');
const C = require('./lib/config');

const ROOT = C.PROJECT_ROOT;
const WWW = C.WWW_DIR;

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(from, to);
        else fs.copyFileSync(from, to);
    }
}

function build() {
    fs.mkdirSync(WWW, { recursive: true });

    // 1. index.php -> index.html
    let html = fs.readFileSync(path.join(ROOT, 'index.php'), 'utf8');
    // Replace the known echo tags first, then strip any remaining PHP blocks.
    html = html.replace(/<\?php\s*echo\s+htmlspecialchars\(APP_NAME\);\s*\?>/g, 'Audio and Video Tool');
    html = html.replace(/<\?php\s*echo\s+htmlspecialchars\(APP_VERSION\);\s*\?>/g, '0.3.0');
    html = html.replace(/<\?php[\s\S]*?\?>/g, ''); // strip remaining PHP blocks (e.g. header includes)
    html = html.replace(/<\?=[\s\S]*?\?>/g, '');
    // Native Android shim must load before the app so window.AVT_API exists.
    html = html.replace(/<script src="assets\/js\/app\.js"><\/script>/,
        '<script src="native/avt-api.js"></script>\n    <script src="assets/js/app.js"></script>');
    fs.writeFileSync(path.join(WWW, 'index.html'), html);

    // 2. copy assets/ and native/
    copyDir(path.join(ROOT, 'assets'), path.join(WWW, 'assets'));
    copyDir(path.join(__dirname, 'native'), path.join(WWW, 'native'));

    // 3. inject Capacitor API shim into the copied app.js (the original stays untouched)
    const appPath = path.join(WWW, 'assets', 'js', 'app.js');
    let js = fs.readFileSync(appPath, 'utf8');
    const hook = `/* Capacitor/native shim: route API calls through window.AVT_API when present. */
    var _origFetch = window.fetch.bind(window);
    window.fetch = function (input, options) {
        if (window.AVT_API && typeof input === 'string' && input.indexOf('api/') === 0) {
            return Promise.resolve(window.AVT_API.fetch(input, options || {})).then(function (r) {
                return {
                    ok: r.status >= 200 && r.status < 300,
                    status: r.status,
                    json: function () { return Promise.resolve(r.body); }
                };
            });
        }
        return _origFetch(input, options);
    };
`;
    // Insert after the IIFE opening and 'use strict'.
    js = js.replace(/('use strict';\s*)/, '$1\n    ' + hook);
    fs.writeFileSync(appPath, js);

    console.log('Built static web app at ' + WWW);
}

build();
