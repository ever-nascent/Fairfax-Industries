// Hero Farming: `/jungle roam` (his design, Oct 1). Every 30 minutes the hero goes roaming and comes back with a list of what it picked up:
// Crates, Tough Crates ("heavy boxes"), Sinner's Sacrifices, and Golden Statues, which can drop a permanent buff from today's buffs
// (buffs.js: they rotate every day). Nothing fights back, so a roam can't fail.
// ponytail: placeholders, he hasn't set these yet: how many finds (4-7), how common each is, a Sinner's Sacrifice giving 1 buff.
//   wiki facts used: a Crate gives 23 souls (60% of the time), a Tough Crate 46, a Sinner's Sacrifice 155 (+ buffs), a Golden Statue
//   drops one buff 50% of the time.
const path = require('node:path');
const { ASSETS } = require('../art');
const { rollBuff, dailyBuffs, bridgeNow } = require('./buffs');
const { payout } = require('./targets');
const { npcs } = require(path.join(ASSETS, 'farm', 'npcs.json'));

const COOLDOWN = 30 * 60; // seconds
const FINDS = [
  { key: 'crate', name: 'Crate', plural: 'Crates', weight: 60 },
  { key: 'toughCrate', name: 'Tough Crate', plural: 'Tough Crates', weight: 15 },
  { key: 'statue', name: 'Golden Statue', plural: 'Golden Statues', weight: 15 },
  { key: 'sinner', name: "Sinner's Sacrifice", plural: "Sinner's Sacrifices", weight: 10 },
];
const CRATE_SOULS = 23;
const CRATE_DROP = 0.6;
const TOUGH_CRATE_SOULS = 46;
const SINNER_SOULS = npcs.neutral_sinners_sacrifice.GoldReward;
const STATUE_BUFF_CHANCE = 0.5;
const BRIDGE_CHANCE = 0.25; // a roam may find this hour's bridge buff (buffs.js); placeholder
const MIN_FINDS = 4;
const MAX_FINDS = 7;

// One roam. `day` is the UTC date ('2026-10-01') that picks today's buffs. Returns
//   { finds, buffs: [buff keys gained], today: [today's buff keys], souls, bridgeNow: this hour's bridge buff, bridge: it, or null if not found }
function roam(day, rng = Math.random, now = Date.now()) {
  const finds = Object.fromEntries(FINDS.map((f) => [f.key, 0]));
  const total = FINDS.reduce((s, f) => s + f.weight, 0);
  const buffs = [];
  let raw = 0;
  const count = MIN_FINDS + Math.floor(rng() * (MAX_FINDS - MIN_FINDS + 1));
  for (let i = 0; i < count; i++) {
    let roll = rng() * total;
    const find = FINDS.find((f) => (roll -= f.weight) < 0) ?? FINDS[0];
    finds[find.key]++;
    if (find.key === 'crate' && rng() < CRATE_DROP) raw += CRATE_SOULS;
    if (find.key === 'toughCrate') raw += TOUGH_CRATE_SOULS;
    if (find.key === 'sinner') { raw += SINNER_SOULS; buffs.push(rollBuff(day, rng)); }
    if (find.key === 'statue' && rng() < STATUE_BUFF_CHANCE) buffs.push(rollBuff(day, rng));
  }
  const hour = bridgeNow(now);
  return { finds, buffs, today: dailyBuffs(day), souls: payout(raw), bridgeNow: hour, bridge: rng() < BRIDGE_CHANCE ? hour : null };
}

module.exports = { COOLDOWN, FINDS, roam };
