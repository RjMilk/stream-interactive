// Профили игр (profiles/*.json). У профиля несколько вариантов исполнения,
// у варианта — свои правила плюс общие наборы из profiles/_shared.json.
const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./paths');

const DIR = path.join(DATA_DIR, 'profiles');
const STATE = path.join(DATA_DIR, 'state.json');

class Profiles {
  constructor() {
    this.load();
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* первого запуска ещё не было */ }
    this.select(saved.profile, saved.variant, false);
  }

  load() {
    const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    this.shared = read('_shared.json');
    this.all = {};
    for (const f of fs.readdirSync(DIR)) {
      if (f.endsWith('.json') && !f.startsWith('_')) this.all[path.basename(f, '.json')] = read(f);
    }
    if (this.profileId) this.select(this.profileId, this.variantId, false);
  }

  select(profileId, variantId, save = true) {
    this.profileId = this.all[profileId] ? profileId : Object.keys(this.all)[0];
    const variants = this.all[this.profileId].variants;
    this.variantId = variants[variantId] ? variantId : Object.keys(variants)[0];
    if (save) fs.writeFileSync(STATE, JSON.stringify({ profile: this.profileId, variant: this.variantId }));
  }

  active() { return this.all[this.profileId]; }
  variant() { return this.active().variants[this.variantId]; }

  ruleLists() {
    const v = this.variant();
    return [v.rules || [], ...(v.use || []).map((name) => this.shared[name] || [])];
  }

  // Плоский список правил активного варианта — для панели и кнопок «тест»
  flatRules() { return this.ruleLists().flat(); }

  summary() {
    return {
      profile: this.profileId,
      variant: this.variantId,
      profiles: Object.entries(this.all).map(([id, p]) => ({
        id, name: p.name, note: p.note || '', allowInput: !!p.allowInput, mod: !!p.mod, rcon: !!p.connection?.rcon,
        variants: Object.entries(p.variants).map(([vid, v]) => ({ id: vid, title: v.title, description: v.description || '' })),
      })),
      rules: this.flatRules().map((r, i) => ({
        i, event: r.event, min: r.min ?? 0, random: !!r.random,
        effects: r.effects.map((e) => e.label || `${e.type}${e.mode || e.exercise ? ':' + (e.mode || e.exercise) : ''}${e.deferred ? ' (в долг)' : ''}`),
      })),
    };
  }
}

module.exports = { Profiles };
