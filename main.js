// Electron: прозрачный оверлей поверх игры + локальный сервер (панель, OBS-источник, WebSocket)
const { app, BrowserWindow, screen, globalShortcut, desktopCapturer, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { connectMiniChat } = require('./minichat');
const { Engine } = require('./engine');
const { Profiles } = require('./profiles');
const actions = require('./actions');
const { rconExec } = require('./actions/rcon');
const { modPlan, installMod, uninstallMod } = require('./actions/modbridge');
const keys = require('./actions/keys');

const { APP_DIR, DATA_DIR, ensureData } = require('./paths');

// Вторая копия программы не нужна: порт занят, а оверлей один. Просто показываем окно первой.
let panelWin = null;
if (!app.requestSingleInstanceLock()) { app.exit(0); return; }
app.on('second-instance', () => {
  if (!panelWin || panelWin.isDestroyed()) return;
  if (panelWin.isMinimized()) panelWin.restore();
  panelWin.focus();
});

ensureData();
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const PUBLIC = path.join(APP_DIR, 'public');
const LOG_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

let config = loadConfig();
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
const profiles = new Profiles();

// ---------- WebSocket-хаб: оверлеи и панель подписываются сюда ----------
const clients = new Set();
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
}
function log(text) {
  const line = `[${new Date().toLocaleTimeString('ru-RU')}] ${text}`;
  console.log(line);
  broadcast({ kind: 'log', text: line });
}

const engine = new Engine({ getConfig: () => config, profiles, actions, broadcast, log });
const state = () => ({ kind: 'state', enabled: engine.enabled, minichat: miniChatState, camera: config.camera || '', ...profiles.summary() });

// ---------- Физические челленджи ----------
// Состояние ведёт окно оверлея (public/exercise.js) и присылает сюда; сервер раздаёт его источнику OBS и панели.
const EX_WORDS = { pushups: 'отжимания', squats: 'приседания' };
let exState = { cur: null, debt: {} };
function setExerciseState(next) {
  const text = (s) => [s.cur ? `${EX_WORDS[s.cur.kind]} ${s.cur.done}/${s.cur.total}` : 'нет',
    ...Object.entries(s.debt || {}).filter(([, n]) => n > 0).map(([k, n]) => `долг: ${n} ${EX_WORDS[k]}`)].join(', ');
  if (text(next) !== text(exState)) log(`Упражнение: ${text(next)}`);
  exState = next;
  broadcast({ kind: 'exstate', state: exState });
}
// rep = +1 повтор вручную, skip = снять текущий челлендж, start = начать отработку долга, forgive = списать долг
function exerciseCommand(cmd) {
  broadcast({ kind: 'exercise', cmd });
}

// ---------- Захват экрана для фильтров (screenfx) ----------
// Пока идёт захват, оверлей исключён из записи экрана, иначе он снимал бы сам себя.
let overlayWin = null, captureUsers = 0;
async function setCapture(on) {
  captureUsers = Math.max(0, captureUsers + (on ? 1 : -1));
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setContentProtection(captureUsers > 0);
  if (!on) return {};
  const display = screen.getAllDisplays()[config.overlayDisplay] || screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  return { sourceId: src.id, width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor };
}

// ---------- HTTP: статика + API для панели ----------
const VENDOR_URL = '/vendor/mediapipe/';
const VENDOR_DIR = path.join(APP_DIR, 'node_modules', '@mediapipe', 'tasks-vision');
const MIME = { '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.png': 'image/png', '.gif': 'image/gif', '.webm': 'video/webm' };

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

async function api(pathname, body) {
  switch (pathname) {
    case '/api/simulate': engine.handleEvent({ service: 'Test', ...body }); return {};
    case '/api/effect': engine.playEffects([body], { user: 'Тест', amount: 0 }); return {};
    case '/api/rule-test': {
      const rule = profiles.flatRules()[body.i];
      if (!rule) throw new Error('нет такого правила');
      log(`Тест правила: ${rule.event} от ${rule.min ?? 0}`);
      engine.playRule(rule, { type: rule.event, user: 'Тест', amount: rule.min || 0, currency: 'RUB', rub: rule.min || 0 });
      return {};
    }
    case '/api/clear': engine.clear(); return {};
    case '/api/toggle': engine.setEnabled(!engine.enabled); return {};
    case '/api/reload':
      config = loadConfig();
      profiles.load();
      log('config.json и профили перечитаны');
      broadcast(state());
      return {};
    case '/api/select':
      engine.clear();
      profiles.select(body.profile, body.variant);
      log(`Игра: ${profiles.active().name} — вариант «${profiles.variant().title}»`);
      broadcast(state());
      return {};
    case '/api/test-rcon': {
      const out = await rconExec(profiles.active().connection?.rcon || {}, [profiles.active().connection?.rconTest || 'help']);
      log(`RCON работает: ${String(out[0]).slice(0, 120) || 'ok'}`);
      return {};
    }
    case '/api/mod-plan': {
      const plan = modPlan(profiles.active(), APP_DIR);
      for (const p of plan) {
        const status = p.missing ? `нельзя: нет ${p.missing} (${profiles.active().mod.requiresName})`
          : p.current ? 'уже установлен, актуален' : p.installed ? 'установлен, будет обновлён' : 'будет скопирован';
        log(`Мод: ${p.to} — ${status}`);
      }
      log('Это только предпросмотр, на диске ничего не изменено');
      return { plan };
    }
    case '/api/uninstall-mod': {
      const files = uninstallMod(profiles.active());
      log(files.length ? `Мод удалён: ${files.join(', ')}` : 'Мод не был установлен');
      return {};
    }
    case '/api/install-mod': {
      const files = installMod(profiles.active(), APP_DIR);
      files.forEach((f) => log(`Мод скопирован: ${f}`));
      return {};
    }
    case '/api/capture': return setCapture(!!body.on);
    case '/api/open-data': shell.openPath(DATA_DIR); return { dir: DATA_DIR };   // папка с config.json и profiles/
    case '/api/exercise': exerciseCommand(String(body.cmd)); return {};
    case '/api/exercise-state': setExerciseState({ cur: body.state?.cur || null, debt: body.state?.debt || {} }); return {};
    case '/api/camera':
      // Без label — только чтение. С label — запомнить выбранную камеру (часть её названия).
      if (typeof body.label === 'string') {
        config.camera = body.label;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
        log(`Камера для упражнений: ${body.label || 'по умолчанию'}`);
        broadcast(state());
      }
      return { camera: config.camera || '' };
    default: return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST') {
    let out, code = 200;
    try {
      out = await api(url.pathname, await readBody(req));
      if (out === null) { res.writeHead(404).end(); return; }
      out = { ok: true, enabled: engine.enabled, ...out };
    } catch (e) {
      log(`✖ ${e.message}`);
      code = 500;
      out = { ok: false, error: e.message };
    }
    res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
    return;
  }
  // /vendor/mediapipe/* отдаётся из node_modules (распознавание позы), остальное — из public
  const vendor = url.pathname.startsWith(VENDOR_URL);
  const base = vendor ? VENDOR_DIR : PUBLIC;
  const rel = vendor ? url.pathname.slice(VENDOR_URL.length) : url.pathname === '/' ? 'panel.html' : url.pathname;
  const file = path.join(base, path.normalize(rel));
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(state()));
  ws.send(JSON.stringify({ kind: 'exstate', state: exState }));
  ws.on('close', () => clients.delete(ws));
});

// ---------- MiniChat ----------
let miniChatState = 'нет связи';
const rawLog = fs.createWriteStream(path.join(LOG_DIR, 'minichat-raw.log'), { flags: 'a' });
connectMiniChat(config.minichatUrl, {
  onRaw: (text) => rawLog.write(`${new Date().toISOString()} ${text}\n`),
  onEvent: (ev) => engine.handleEvent(ev),
  onStatus: (s) => {
    const connected = s === 'подключено';
    if (connected || miniChatState === 'подключено') log(`MiniChat: ${s}`);
    miniChatState = connected ? s : 'нет связи';
    broadcast(state());
  },
});

// ---------- Окна ----------
function createOverlay() {
  const displays = screen.getAllDisplays();
  const d = displays[config.overlayDisplay] || screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    ...d.bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false },
  });
  win.setIgnoreMouseEvents(true);              // мышь проходит сквозь окно в игру
  win.setAlwaysOnTop(true, 'screen-saver');    // выше полноэкранных окон без рамки
  win.setVisibleOnAllWorkspaces(true);
  win.loadURL(`http://127.0.0.1:${config.port}/overlay.html?mode=screen`);
  win.showInactive();
  // Игры иногда перехватывают «поверх всех» — периодически возвращаем себе верх
  setInterval(() => { if (!win.isDestroyed()) win.moveTop(); }, 3000);
  overlayWin = win;
}

function createPanel() {
  const win = new BrowserWindow({ width: 1040, height: 900, title: 'Stream Interactive — панель', autoHideMenuBar: true });
  win.loadURL(`http://127.0.0.1:${config.port}/panel.html`);
  panelWin = win;
  win.on('closed', () => app.quit());
}

app.whenReady().then(() => {
  server.listen(config.port, '127.0.0.1', () => {
    log(`Сервер: http://127.0.0.1:${config.port}  |  OBS-источник: http://127.0.0.1:${config.port}/overlay.html?mode=obs`);
    log(`Игра: ${profiles.active().name} — вариант «${profiles.variant().title}»`);
    createOverlay();
    if (!process.argv.includes('--no-panel')) createPanel();
  });
  globalShortcut.register(config.hotkeys.panic, () => { engine.clear(); log('ПАНИКА: все помехи убраны'); });
  globalShortcut.register(config.hotkeys.toggle, () => engine.setEnabled(!engine.enabled));
  globalShortcut.register(config.hotkeys.exerciseRep || 'CommandOrControl+Shift+F10', () => exerciseCommand('rep'));
  globalShortcut.register(config.hotkeys.exerciseStart || 'CommandOrControl+Shift+F9', () => exerciseCommand('start'));
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); keys.stop(); });
