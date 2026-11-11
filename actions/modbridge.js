// Мост к модам: команды пишутся в текстовый файл в папке игры, мод его опрашивает.
// Строка: id|команда|аргумент|ник|;   (хвост «|;» — признак, что строка дописана целиком)
const fs = require('fs');
const path = require('path');

const KEEP = 30;
const recent = new Map();   // файл -> последние строки
let lastId = 0;

const clean = (s) => String(s ?? '').replace(/[|\r\n]/g, ' ').trim();

function bridgeFile(profile) {
  const dir = profile.connection?.gameDir;
  if (!dir || !profile.mod) throw new Error('мод не настроен: укажи gameDir в профиле и нажми «Установить мод»');
  return path.join(dir, profile.mod.bridge);
}

function write(file, command, arg, user) {
  if (!fs.existsSync(path.dirname(file))) throw new Error(`мод не установлен (нет папки ${path.dirname(file)})`);
  lastId = Math.max(Date.now(), lastId + 1);
  const lines = recent.get(file) || [];
  lines.push(`${lastId}|${clean(command)}|${clean(arg)}|${clean(user)}|;`);
  while (lines.length > KEEP) lines.shift();
  recent.set(file, lines);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

async function modAction(effect, { profile, fill, revert }) {
  const src = revert ? effect.revert : effect;
  write(bridgeFile(profile), src.command, fill(src.arg ?? ''), fill('{user}'));
  return `${src.command} ${fill(src.arg ?? '')}`.trim();
}

function gameDir(profile) {
  const dir = profile.connection?.gameDir;
  if (!dir || !fs.existsSync(dir)) throw new Error('папка игры не найдена — проверь connection.gameDir в профиле');
  return dir;
}

// Что и куда будет скопировано. Ничего не меняет на диске.
function modPlan(profile, root) {
  const dir = gameDir(profile);
  return profile.mod.files.map((f) => {
    const to = path.join(dir, f.to);
    const from = path.join(root, f.from);
    const installed = fs.existsSync(to);
    return {
      from, to, installed,
      current: installed && fs.readFileSync(to).equals(fs.readFileSync(from)),
      missing: f.requires && !fs.existsSync(path.join(dir, f.requires)) ? f.requires : null,
    };
  });
}

// Копирует файлы мода в папку игры
function installMod(profile, root) {
  const plan = modPlan(profile, root);
  const blocked = plan.find((p) => p.missing);
  if (blocked) throw new Error(`сначала установи ${profile.mod.requiresName} (нет ${blocked.missing})`);
  for (const p of plan) {
    fs.mkdirSync(path.dirname(p.to), { recursive: true });
    fs.copyFileSync(p.from, p.to);
  }
  return plan.map((p) => p.to);
}

// Удаляет только свои файлы: мод и файл команд
function uninstallMod(profile) {
  const dir = gameDir(profile);
  const removed = [];
  for (const rel of [...profile.mod.files.map((f) => f.to), profile.mod.bridge]) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) { fs.unlinkSync(file); removed.push(file); }
  }
  if (profile.mod.ownDir) {
    const own = path.join(dir, profile.mod.ownDir);
    if (fs.existsSync(own) && !fs.readdirSync(own).length) fs.rmdirSync(own);
  }
  return removed;
}

module.exports = { modAction, modPlan, installMod, uninstallMod, write };
