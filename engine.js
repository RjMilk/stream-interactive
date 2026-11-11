// Подбор реакции по правилам активного профиля и очередь эффектов.
// Эффект — это либо помеха на экране (уходит в оверлей), либо действие в игре (keys / rcon / mod).
const ACTION_TYPES = new Set(['keys', 'rcon', 'mod']);

// Ник попадает в команды игры, поэтому оставляем только буквы, цифры, пробел, _ и -
const safeName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 24) || 'Аноним';

class Engine {
  constructor({ getConfig, profiles, actions, broadcast, log }) {
    this.getConfig = getConfig;
    this.profiles = profiles;
    this.actions = actions;
    this.broadcast = broadcast;
    this.log = log;
    this.enabled = true;
    this.queue = [];
    this.active = 0;
    this.lastFired = {};
    this.timers = new Set();
    this.reverts = new Map();   // timer -> функция отката игрового действия
  }

  toRub(amount, currency) {
    const rate = this.getConfig().currencyToRub[currency] ?? 1;
    return Math.round(amount * rate);
  }

  // Сначала свои правила варианта, потом общие наборы. В каждом списке берётся
  // правило с самым большим min, который не превышает сумму.
  findRule(ev, rub) {
    for (const list of this.profiles.ruleLists()) {
      const rules = list.filter((r) => r.event === ev.type && (r.min ?? 0) <= rub);
      rules.sort((a, b) => (b.min ?? 0) - (a.min ?? 0));
      if (rules[0]) return rules[0];
    }
    return null;
  }

  handleEvent(ev) {
    const rub = ev.type === 'donation' ? this.toRub(Number(ev.amount) || 0, ev.currency || 'RUB') : Number(ev.amount) || 0;
    const sum = ev.type === 'donation' ? ` ${ev.amount} ${ev.currency || 'RUB'} (≈${rub}₽)` : '';
    this.log(`Событие: ${ev.type} от ${ev.user}${sum} [${ev.service}] ${ev.message ? '«' + ev.message + '»' : ''}`);
    this.broadcast({ kind: 'event', event: ev });

    if (!this.enabled) { this.log('  помехи на паузе — пропуск'); return; }
    const rule = this.findRule(ev, rub);
    if (!rule) return;

    const key = `${rule.event}:${rule.min ?? 0}`;
    const now = Date.now();
    if (rule.cooldown && now - (this.lastFired[key] || 0) < rule.cooldown * 1000) {
      this.log('  кулдаун правила — пропуск');
      return;
    }
    this.lastFired[key] = now;
    this.playRule(rule, { ...ev, rub });
  }

  playRule(rule, ev) {
    const effects = rule.random ? [rule.effects[Math.floor(Math.random() * rule.effects.length)]] : rule.effects;
    this.playEffects(effects, ev);
  }

  // Эффекты одного события запускаются вместе, события — по очереди (maxConcurrent)
  playEffects(effects, ev) {
    this.queue.push({ effects, ev });
    this.pump();
  }

  pump() {
    const max = this.getConfig().maxConcurrent || 3;
    while (this.active < max && this.queue.length) {
      const { effects, ev } = this.queue.shift();
      const longest = Math.max(...effects.map((e) => e.duration || 5));
      this.active++;
      for (const effect of effects) this.run(effect, ev);
      this.log(`  ▶ ${effects.map((e) => e.label || e.type).join(' + ')} (${longest} с)`);
      const t = setTimeout(() => { this.timers.delete(t); this.active--; this.pump(); }, longest * 1000);
      this.timers.add(t);
    }
  }

  // {user} {amount} {rub} {n} в командах; n = сумма / per, от 1 до max
  vars(effect, ev) {
    const rub = Number(ev.rub) || 0;
    const n = effect.per ? Math.max(1, Math.min(effect.max || 10, Math.floor(rub / effect.per))) : 1;
    return { user: safeName(ev.user), amount: String(Number(ev.amount) || 0), rub: String(rub), n: String(n) };
  }

  run(effect, ev) {
    if (!ACTION_TYPES.has(effect.type)) {
      this.broadcast({ kind: 'effect', effect, ev, n: Number(this.vars(effect, ev).n) });
      return;
    }
    const profile = this.profiles.active();
    const vars = this.vars(effect, ev);
    const fill = (s) => String(s).replace(/\{(user|amount|rub|n)\}/g, (_, k) => vars[k]);
    const act = this.actions[effect.type];
    const report = (what) => (res) => this.log(`  ${what}: ${res}`);
    const fail = (e) => this.log(`  ✖ ${effect.type}: ${e.message || e}`);

    act(effect, { profile, fill, n: Number(vars.n), revert: false }).then(report(effect.type), fail);
    if (effect.label) {
      this.broadcast({ kind: 'effect', effect: { type: 'toast', text: fill(effect.label), duration: Math.min(effect.duration || 5, 6) }, ev });
    }
    if (effect.revert) {
      const undo = () => act(effect, { profile, fill, n: Number(vars.n), revert: true }).then(report('откат'), fail);
      const t = setTimeout(() => { this.reverts.delete(t); undo(); }, (effect.duration || 5) * 1000);
      this.reverts.set(t, undo);
    }
  }

  clear() {
    this.queue = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    // Игровые эффекты с откатом возвращаем в норму сразу
    for (const [t, undo] of this.reverts) { clearTimeout(t); undo(); }
    this.reverts.clear();
    this.active = 0;
    this.broadcast({ kind: 'clear' });
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.clear();
    this.log(v ? 'Помехи ВКЛЮЧЕНЫ' : 'Помехи на ПАУЗЕ');
    this.broadcast({ kind: 'state', enabled: v });
  }
}

module.exports = { Engine, safeName };
