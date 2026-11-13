// Куда программа кладёт файлы.
//  APP_DIR  — сама программа (код, public, mods, исходные профили). Только чтение.
//  DATA_DIR — то, что правит пользователь и что программа пишет: config.json, profiles/, state.json, logs/.
//
// Из исходников (npm start) обе папки совпадают с папкой проекта.
// В установленной версии DATA_DIR — %APPDATA%\Stream Interactive: переустановка и обновление не стирают настройки.
// Для тестов папку можно подменить переменной окружения SI_DATA_DIR.
const fs = require('fs');
const path = require('path');

let app = null;
try { app = require('electron').app || null; } catch { /* обычный node без Electron */ }

const APP_DIR = __dirname;
const installed = !!(app && app.isPackaged);
const DATA_DIR = process.env.SI_DATA_DIR || (installed ? app.getPath('userData') : APP_DIR);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Дописывает в target то, чего там нет (рекурсивно по объектам). Значения пользователя не трогает.
// Возвращает true, если что-то добавлено.
function mergeMissing(target, defaults) {
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in target)) { target[key] = value; changed = true; }
    else if (isObj(value) && isObj(target[key])) changed = mergeMissing(target[key], value) || changed;
  }
  return changed;
}

// Переносит один JSON-файл из программы в папку данных: нет файла — копирует, есть — дописывает новые ключи.
// Файл с ошибкой в JSON не трогает.
function syncJson(from, to) {
  if (!fs.existsSync(to)) { fs.copyFileSync(from, to); return; }
  let current;
  try { current = readJson(to); } catch { return; }
  if (mergeMissing(current, readJson(from))) fs.writeFileSync(to, JSON.stringify(current, null, 2) + '\n');
}

// Готовит папку данных. Вызывается при запуске; работает, только если DATA_DIR отличается от APP_DIR.
// Новая версия программы добавляет в настройки новые варианты и ключи (например, новую игру или вариант «Физкульт»),
// а пароли, пути и правки пользователя остаются как есть. Работа выполняется один раз на версию.
function ensureData() {
  if (DATA_DIR === APP_DIR) return;
  const version = readJson(path.join(APP_DIR, 'package.json')).version;
  const marker = path.join(DATA_DIR, 'version.txt');
  let seen = '';
  try { seen = fs.readFileSync(marker, 'utf8').trim(); } catch { /* первый запуск */ }
  if (seen === version) return;

  fs.mkdirSync(path.join(DATA_DIR, 'profiles'), { recursive: true });
  syncJson(path.join(APP_DIR, 'config.json'), path.join(DATA_DIR, 'config.json'));
  for (const f of fs.readdirSync(path.join(APP_DIR, 'profiles'))) {
    if (f.endsWith('.json')) syncJson(path.join(APP_DIR, 'profiles', f), path.join(DATA_DIR, 'profiles', f));
  }
  fs.writeFileSync(marker, version);
}

module.exports = { APP_DIR, DATA_DIR, installed, ensureData, mergeMissing };
