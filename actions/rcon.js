// Клиент Source RCON (Factorio, сервер Minecraft). Одно соединение на пачку команд.
const net = require('net');

const AUTH = 3, EXEC = 2, AUTH_RESPONSE = 2, RESPONSE = 0;

function packet(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

function rconExec({ host = '127.0.0.1', port, password }, commands, timeout = 4000) {
  return new Promise((resolve, reject) => {
    if (!port || !password) return reject(new Error('RCON не настроен: укажи port и password в профиле игры'));
    const sock = net.connect({ host, port });
    const results = [];
    let buf = Buffer.alloc(0), authed = false, i = 0, cmdTimer = null;

    const finish = (err) => {
      clearTimeout(killer); clearTimeout(cmdTimer);
      sock.destroy();
      err ? reject(err) : resolve(results);
    };
    const killer = setTimeout(() => finish(new Error('RCON: нет ответа')), timeout + commands.length * 1500);

    const next = () => {
      clearTimeout(cmdTimer);
      if (i >= commands.length) return finish();
      sock.write(packet(100 + i, EXEC, commands[i]));
      // Некоторые команды ничего не отвечают — не ждём вечно
      cmdTimer = setTimeout(() => { results.push(''); i++; next(); }, 1500);
    };

    sock.on('connect', () => sock.write(packet(1, AUTH, password)));
    sock.on('error', (e) => finish(new Error(`RCON ${host}:${port}: ${e.code || e.message}`)));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const size = buf.readInt32LE(0);
        if (buf.length < 4 + size) break;
        const id = buf.readInt32LE(4), type = buf.readInt32LE(8);
        const body = buf.toString('utf8', 12, 4 + size - 2);
        buf = buf.subarray(4 + size);
        if (!authed) {
          if (type !== AUTH_RESPONSE) continue;   // Source шлёт пустой пакет перед ответом на авторизацию
          if (id === -1) return finish(new Error('RCON: неверный пароль'));
          authed = true;
          next();
        } else if (type === RESPONSE && id === 100 + i) {
          results.push(body.trim());
          i++;
          next();
        }
      }
    });
  });
}

module.exports = { rconExec, packet };
