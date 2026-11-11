const { rconExec } = require('./rcon');
const { keysAction } = require('./keys');
const { modAction } = require('./modbridge');

async function rconAction(effect, { profile, fill, revert }) {
  const commands = (revert ? effect.revert : effect.commands).map(fill);
  const out = await rconExec(profile.connection?.rcon || {}, commands);
  return out.filter(Boolean).join(' / ') || 'ok';
}

module.exports = { keys: keysAction, rcon: rconAction, mod: modAction };
