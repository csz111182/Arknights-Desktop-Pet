const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const assetRoot = path.join(__dirname, 'assets');

function readImage(relativePath) {
  const buffer = fs.readFileSync(path.join(assetRoot, relativePath));
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function readAudio(relativePath) {
  const buffer = fs.readFileSync(path.join(assetRoot, relativePath));
  return `data:audio/ogg;base64,${buffer.toString('base64')}`;
}

contextBridge.exposeInMainWorld('deskpet', {
  readText: (relativePath) => fs.readFileSync(path.join(assetRoot, relativePath), 'utf8'),
  readBinary: (relativePath) => {
    const buffer = fs.readFileSync(path.join(assetRoot, relativePath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
  readImage,
  readAudio,
  codexRun: (payload) => ipcRenderer.invoke('codex-run', payload),
  codexReset: () => ipcRenderer.invoke('codex-reset'),
  deepSeekConfigGet: () => ipcRenderer.invoke('deepseek-config-get'),
  deepSeekConfigSave: (payload) => ipcRenderer.invoke('deepseek-config-save', payload),
  deepSeekConfigClear: () => ipcRenderer.invoke('deepseek-config-clear'),
  deepSeekRun: (payload) => ipcRenderer.invoke('deepseek-run', payload),
  setFocusable: (value) => ipcRenderer.send('set-focusable', !!value),
  setMouseIgnore: (value) => ipcRenderer.send('set-mouse-ignore', !!value),
  setHitRegions: (payload) => ipcRenderer.send('set-hit-regions', payload),
  quit: () => ipcRenderer.send('quit')
});
