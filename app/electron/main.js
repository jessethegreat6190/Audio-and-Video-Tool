'use strict';

/**
 * Electron shell for Audio and Video Tool.
 * Starts the local Node server on a free loopback port and shows it in a window.
 * No data is written into Program Files — all runtime files go to userData.
 */

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const isPackaged = app.isPackaged;
const resources = process.resourcesPath || path.resolve(__dirname, '..');

// FFmpeg binaries: bundled via extraResources in the packaged app, ../bin in dev.
const binDir = isPackaged
    ? path.join(resources, 'bin')
    : path.resolve(__dirname, '..', '..', 'bin');
process.env.FFMPEG_BINARY = path.join(binDir, 'ffmpeg.exe');
process.env.FFPROBE_BINARY = path.join(binDir, 'ffprobe.exe');

// Keep all user data next to the app's userData folder, never inside Program Files.
process.env.AVT_DATA_DIR = path.join(app.getPath('userData'), 'data');
process.env.AVT_PORT = '0'; // pick a free port

let mainWindow = null;
let backend = null;

function openExternal(event, url) {
    // Only allow http(s) links to open in the system browser.
    if (/^https?:\/\//i.test(url)) {
        event.preventDefault();
        shell.openExternal(url);
    }
}

async function start() {
    backend = require('../server');
    const port = await backend.start(0, '127.0.0.1');
    const url = 'http://127.0.0.1:' + port + '/';

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 700,
        title: 'Audio and Video Tool',
        backgroundColor: '#141414',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            spellcheck: false,
        },
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(url);
    mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
        if (/^https?:\/\//i.test(target)) shell.openExternal(target);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', openExternal);

    // Expose the chosen URL for the "Open app folder" / support menu.
    ipcMain.handle('avt-info', () => ({
        url,
        dataDir: process.env.AVT_DATA_DIR,
        version: app.getVersion(),
    }));

    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
    start().catch((err) => {
        dialog.showErrorBox(
            'Audio and Video Tool could not start',
            String(err && err.message ? err.message : err)
        );
        app.quit();
    });
});

app.on('window-all-closed', () => {
    // Keep the tray-less app alive on Windows only while a window exists.
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) start().catch(() => {});
});
