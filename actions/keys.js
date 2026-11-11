// Эмуляция клавиатуры через фоновый PowerShell (actions/keysender.ps1).
// Клавиши отправляются только в окно игры из профиля (profile.window).
const { spawn } = require('child_process');
const path = require('path');

const SCAN = { esc: 0x01, enter: 0x1c, space: 0x39, grave: 0x29, slash: 0x35 };
'1234567890'.split('').forEach((c, i) => (SCAN[c] = 0x02 + i));
'qwertyuiop'.split('').forEach((c, i) => (SCAN[c] = 0x10 + i));
'asdfghjkl'.split('').forEach((c, i) => (SCAN[c] = 0x1e + i));
'zxcvbnm'.split('').forEach((c, i) => (SCAN[c] = 0x2c + i));

const scanText = (text) => [...text.toLowerCase()].map((c) => {
  if (!(c in SCAN)) throw new Error(`keys: символ «${c}» нельзя набрать скан-кодами`);
  return ['s', SCAN[c]];
});

// Готовые последовательности под игры
const PRESETS = {
  // GTA 5: ~ открывает строку чит-кода (нужна английская раскладка)
  'gta5-cheat': (text) => [['s', SCAN.grave], ['w', 450], ...scanText(text), ['w', 150], ['s', SCAN.enter]],
  // Minecraft: / открывает чат с уже набранной косой чертой
  'mc-command': (text) => [['s', SCAN.slash], ['w', 300], ['u', text.replace(/^\//, '')], ['w', 100], ['s', SCAN.enter]],
};

let proc = null, ready = null, pending = [], chain = Promise.resolve();

function start() {
  if (proc) return ready;
  proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'keysender.ps1')], { windowsHide: true });
  let buf = '';
  ready = new Promise((resolve) => pending.push(resolve));
  proc.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const cb = pending.shift();
      if (cb) cb(line);
    }
  });
  proc.on('exit', () => { proc = null; pending.splice(0).forEach((cb) => cb('err:keysender остановился')); });
  return ready;
}

// Не-ASCII уходит как \uXXXX, чтобы не зависеть от кодировки stdin
const toAscii = (s) => s.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function send(window, ops) {
  chain = chain.catch(() => {}).then(async () => {
    await start();
    const res = await new Promise((resolve) => {
      pending.push(resolve);
      proc.stdin.write(toAscii(JSON.stringify({ window, ops })) + '\n');
    });
    if (res === 'ok') return 'нажато';
    if (res.startsWith('skip:')) throw new Error(`окно игры не активно (сейчас: «${res.slice(5) || '—'}»)`);
    throw new Error(res);
  });
  return chain;
}

async function keysAction(effect, { profile, fill, n, revert }) {
  if (!profile.allowInput) throw new Error('в этом профиле нажатия клавиш запрещены');
  if (!profile.window) throw new Error('в профиле не задано окно игры (window)');
  const text = fill(revert ? effect.revert : effect.text);
  const build = PRESETS[effect.preset];
  if (!build) throw new Error(`keys: неизвестный preset «${effect.preset}»`);
  const once = build(text);
  const times = revert ? 1 : effect.repeat === '{n}' ? n : Number(effect.repeat) || 1;
  const ops = [];
  for (let i = 0; i < times; i++) ops.push(...once, ['w', 350]);
  return send(profile.window, ops);
}

function stop() { if (proc) proc.kill(); }

module.exports = { keysAction, send, stop, PRESETS };
