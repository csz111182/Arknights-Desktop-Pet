const { app, BrowserWindow, globalShortcut, ipcMain, screen, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { CodexService } = require('./codex-service');

// 桌宠的本地角色原声允许在待机事件中自动播放，无需先点击窗口。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null;
let ignoringMouse = true;
let petHitRegion = null;
let uiHitRegions = [];
let petMoving = false;
let forceMouseCapture = false;
let keyboardCapture = false;
let lastCursorPoint = null;
let lastCursorMovedAt = 0;
const codexService = new CodexService();

function applyMouseIgnore(value) {
  const next = !!value;
  if (!win || win.isDestroyed() || next === ignoringMouse) return;
  if (!keyboardCapture) win.setFocusable(false);
  ignoringMouse = next;
  win.setIgnoreMouseEvents(next, { forward: true });
}

function pointInRect(x, y, rect) {
  return !!rect && x >= rect.x && x <= rect.x + rect.width &&
    y >= rect.y && y <= rect.y + rect.height;
}

function updateNativeHitTest() {
  if (!win || win.isDestroyed()) return;
  if (forceMouseCapture) {
    applyMouseIgnore(false);
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  if (!lastCursorPoint || cursor.x !== lastCursorPoint.x || cursor.y !== lastCursorPoint.y) {
    lastCursorPoint = { x: cursor.x, y: cursor.y };
    lastCursorMovedAt = Date.now();
  }
  const bounds = win.getBounds();
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  const uiHit = uiHitRegions.some((rect) => pointInRect(x, y, rect));
  // 自动移动的角色扫过静止鼠标时继续穿透；主动追着角色移动鼠标时仍可点击。
  const recentPointerIntent = Date.now() - lastCursorMovedAt < 350;
  const petHit = pointInRect(x, y, petHitRegion) && (!petMoving || recentPointerIntent);
  const hit = uiHit || petHit;
  applyMouseIgnore(!hit);
}

function deepSeekConfigPath() {
  return path.join(app.getPath('userData'), 'deepseek-config.json');
}

function readDeepSeekConfig() {
  const defaults = { model: 'deepseek-flash', encryptedKey: '' };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(deepSeekConfigPath(), 'utf8')) };
  } catch (error) {
    return defaults;
  }
}

function readDeepSeekKey(config) {
  if (!config.encryptedKey) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法安全读取 DeepSeek API Key');
  return safeStorage.decryptString(Buffer.from(config.encryptedKey, 'base64'));
}

function publicDeepSeekConfig() {
  const config = readDeepSeekConfig();
  return { model: config.model || 'deepseek-flash', hasKey: !!config.encryptedKey };
}

function saveDeepSeekConfig(payload) {
  const previous = readDeepSeekConfig();
  const next = {
    model: ['deepseek-flash', 'deepseek-v4-pro'].includes(payload.model) ? payload.model : 'deepseek-flash',
    encryptedKey: previous.encryptedKey || ''
  };
  const apiKey = String(payload.apiKey || '').trim();
  if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全保存 API Key');
    next.encryptedKey = safeStorage.encryptString(apiKey).toString('base64');
  }
  fs.mkdirSync(path.dirname(deepSeekConfigPath()), { recursive: true });
  fs.writeFileSync(deepSeekConfigPath(), JSON.stringify(next, null, 2), 'utf8');
  return publicDeepSeekConfig();
}

app.setName('明日方舟桌宠');
app.setAppUserModelId('com.local.arknights-desktop-pet');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) win.showInactive();
  });
}

function createWindow() {
  const bounds = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setFocusable(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoringMouse = true;
  const query = {};
  if (process.argv.includes('--show-settings')) query.settings = '1';
  const characterIndex = process.argv.indexOf('--character');
  if (characterIndex !== -1 && process.argv[characterIndex + 1]) query.character = process.argv[characterIndex + 1];
  const skinIndex = process.argv.indexOf('--skin');
  if (skinIndex !== -1 && process.argv[skinIndex + 1]) query.skin = process.argv[skinIndex + 1];
  const loadOptions = Object.keys(query).length ? { query } : undefined;
  win.loadFile(path.join(__dirname, 'src', 'pet.html'), loadOptions);
  win.once('ready-to-show', () => win.showInactive());

  const shotIndex = process.argv.indexOf('--screenshot');
  if (shotIndex !== -1) {
    const delay = parseInt(process.argv[shotIndex + 1] || '3500', 10) || 3500;
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, 'shot.png'), image.toPNG());
      app.quit();
    }, delay);
  }
}

app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+Alt+Shift+A', () => app.quit());
  const hitTestTimer = setInterval(updateNativeHitTest, 25);
  hitTestTimer.unref();
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('set-mouse-ignore', (_event, value) => {
    applyMouseIgnore(value);
  });
  ipcMain.on('set-hit-regions', (_event, payload) => {
    const incoming = payload && Array.isArray(payload.uiRegions) ? payload.uiRegions : [];
    uiHitRegions = incoming.slice(0, 8).filter((rect) => rect &&
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
    ).map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
    const incomingPet = payload && payload.petRegion;
    petHitRegion = incomingPet && [incomingPet.x, incomingPet.y, incomingPet.width, incomingPet.height].every(Number.isFinite) &&
      incomingPet.width > 0 && incomingPet.height > 0
      ? { x: incomingPet.x, y: incomingPet.y, width: incomingPet.width, height: incomingPet.height }
      : null;
    petMoving = !!(payload && payload.petMoving);
    forceMouseCapture = !!(payload && payload.capture);
    updateNativeHitTest();
  });
  ipcMain.on('set-focusable', (_event, value) => {
    if (!win || win.isDestroyed()) return;
    keyboardCapture = !!value;
    win.setFocusable(keyboardCapture);
    if (keyboardCapture) win.focus();
  });
  ipcMain.handle('codex-reset', () => {
    codexService.reset();
    return { ok: true };
  });
  ipcMain.handle('codex-run', async (_event, payload) => {
    try {
      const request = { ...(payload || {}) };
      if (!request.workingDirectory) {
        request.workingDirectory = path.join(app.getPath('userData'), 'codex-workspace');
        fs.mkdirSync(request.workingDirectory, { recursive: true });
      }
      return await codexService.run(request);
    } catch (error) {
      const raw = String((error && error.message) || error || '未知错误');
      return {
        ok: false,
        error: /login|auth|credential|unauthorized|401/i.test(raw)
          ? 'Codex 尚未登录，请先打开 Codex 应用并使用 ChatGPT 账号登录。'
          : raw
      };
    }
  });
  ipcMain.handle('deepseek-config-get', () => publicDeepSeekConfig());
  ipcMain.handle('deepseek-config-save', (_event, payload) => {
    try {
      return { ok: true, ...saveDeepSeekConfig(payload || {}) };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });
  ipcMain.handle('deepseek-config-clear', () => {
    try { fs.rmSync(deepSeekConfigPath(), { force: true }); } catch (error) { /* already absent */ }
    return { ok: true, ...publicDeepSeekConfig() };
  });
  ipcMain.handle('deepseek-run', async (_event, payload) => {
    try {
      const config = readDeepSeekConfig();
      const apiKey = readDeepSeekKey(config);
      if (!apiKey) return { ok: false, error: '请先在 AI 对话设置中填写 DeepSeek API Key' };
      const history = Array.isArray(payload && payload.messages) ? payload.messages.slice(-20) : [];
      const messages = history
        .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
        .map((item) => ({ role: item.role, content: item.content.slice(0, 12000) }));
      const systemPrompt = String((payload && payload.systemPrompt) || '').trim();
      if (systemPrompt) messages.unshift({ role: 'system', content: systemPrompt.slice(0, 30000) });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      let response;
      try {
        response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: config.model || 'deepseek-flash',
            messages,
            stream: false
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data && data.error && data.error.message) || `DeepSeek 请求失败（${response.status}）`);
      }
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('DeepSeek 没有返回文本');
      return { ok: true, content: String(content).trim(), model: data.model || config.model };
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'DeepSeek 响应超时，请稍后重试'
        : String((error && error.message) || error || 'DeepSeek 请求失败');
      return { ok: false, error: message };
    }
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
