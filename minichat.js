// Клиент локального WebSocket MiniChat (по умолчанию ws://localhost:4848/Chat).
// Формат сообщений: { Type: "Live" | "Message", Data: { Service, Type, UserName, ... } }.
// Поля суммы доната MiniChat официально не документирует, поэтому все сырые
// сообщения пишутся в logs/minichat-raw.log, а сумма ищется по нескольким именам.
const WebSocket = require('ws');

const TYPE_MAP = {
  donation: 'donation',
  follow: 'follow',
  subscription: 'subscription',
  giftsubscription: 'subscription',
  resubscription: 'subscription',
  sponsor: 'subscription',      // YouTube «спонсорство»
  raid: 'raid',
  reward: 'reward',
  superchat: 'donation',        // YouTube Super Chat
  supersticker: 'donation',
  bits: 'bits',
  cheer: 'bits',
};

function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
}

function normalize(msg) {
  if (!msg || msg.Type !== 'Live' || !msg.Data) return null;
  const d = msg.Data;
  const rawType = String(d.Type || '');
  const type = TYPE_MAP[rawType.toLowerCase()] || rawType.toLowerCase();
  const text = pick(d, ['Message', 'Text', 'Comment']) ??
    (Array.isArray(d.MessageKit) ? d.MessageKit.filter((m) => m.Type === 'Text').map((m) => m.Data?.Text).join(' ') : '');
  return {
    type,
    service: d.Service || '',
    user: pick(d, ['UserName', 'Name', 'User']) || 'Аноним',
    amount: Number(pick(d, ['Amount', 'Sum', 'Price', 'Value', 'Count']) || 0),
    currency: String(pick(d, ['Currency', 'CurrencyType']) || 'RUB').toUpperCase(),
    message: text || '',
    viewers: Number(pick(d, ['Viewers', 'ViewersCount', 'Count']) || 0),
  };
}

function connectMiniChat(url, { onRaw, onEvent, onStatus }) {
  let delay = 1000;
  const open = () => {
    const ws = new WebSocket(url);
    ws.on('open', () => { delay = 1000; onStatus('подключено'); });
    ws.on('message', (buf) => {
      const text = buf.toString('utf8');
      onRaw(text);
      try {
        const ev = normalize(JSON.parse(text));
        if (ev) onEvent(ev);
      } catch { /* не JSON — игнорируем */ }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      onStatus(`нет связи, повтор через ${Math.round(delay / 1000)} с`);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 30000);
    });
  };
  open();
}

module.exports = { connectMiniChat, normalize };
