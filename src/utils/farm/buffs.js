// Hero Farming: permanent buffs (the wiki's "Permanent Buffs": what Golden Statues, Sinner's Sacrifices and the Mid-Boss give).
// A member's record keeps how many of each they hold (`buffs: { fireRate: 2, ... }`); heroStats() adds them to the hero.
// The wiki's three levels depend on match minute (L1 at 0 min, L2 after 10, L3 after 30); there is no match clock here, so every
// buff is level 1 for now. ponytail: placeholder, he hasn't said how levels should work.
//   amount  what one buff gives, in the wiki's units (percent, or flat for Max Health / Spirit Power / Move Speed)
//   odds    the wiki's drop rate out of 100 (Health 20, Move Speed and Ability Range 5, the rest 10)
//   apply   how a total of those units changes the stat sheet
// Resists multiply, they don't add (his call, Oct 2, like the game): 30% and 30% make 51%, so stacking them is worth less each time.
const stackResist = (resist, more) => 1 - (1 - resist) * (1 - more);
const BUFFS = {
  fireRate: { name: 'Fire Rate', odds: 10, amount: 1.5, unit: '%', apply: (s, v) => { s.fireRate *= 1 + v / 100; } },
  maxAmmo: { name: 'Max Ammo', odds: 10, amount: 3, unit: '%', apply: (s, v) => { s.clip *= 1 + v / 100; } },
  cooldownReduction: { name: 'Cooldown Reduction', odds: 10, amount: 0.5, unit: '%', apply: (s, v) => { s.cdr += v / 100; } },
  weaponDamage: { name: 'Weapon Damage', odds: 10, amount: 3, unit: '%', apply: (s, v) => { s.weaponDamageMult += v / 100; } },
  maxHealth: { name: 'Max Health', odds: 20, amount: 15, unit: '', apply: (s, v) => { s.maxHealth += v; } },
  spiritPower: { name: 'Spirit Power', odds: 10, amount: 2, unit: '', apply: (s, v) => { s.spirit += v; } },
  bulletResist: { name: 'Bullet Resist', odds: 10, amount: 0.5, unit: '%', apply: (s, v) => { s.bulletResist = stackResist(s.bulletResist, v / 100); } },
  spiritResist: { name: 'Spirit Resist', odds: 10, amount: 0.5, unit: '%', apply: (s, v) => { s.spiritResist = stackResist(s.spiritResist, v / 100); } },
  moveSpeed: { name: 'Move Speed', odds: 5, amount: 0.1, unit: ' m/s', apply: (s, v) => { s.moveSpeed += v; } },
  abilityRange: { name: 'Ability Range', odds: 5, amount: 0.25, unit: '%', apply: (s, v) => { s.rangeMult += v / 100; } },
};

// "+3% Weapon Damage" for `count` buffs of `key` (one buff: count 1).
const buffText = (key, count = 1) => {
  const b = BUFFS[key];
  return `+${+(b.amount * count).toFixed(2)}${b.unit} ${b.name}`;
};

// Adds a member's buffs ({ key: count }) to a stat sheet.
function applyBuffs(stats, buffs = {}) {
  for (const [key, count] of Object.entries(buffs)) BUFFS[key]?.apply(stats, BUFFS[key].amount * count);
}

// The buffs on the map today (his idea: they rotate every day). A UTC date picks DAILY_BUFFS of the 10 types, the same for everyone.
// ponytail: how many are on the map, and whether the rotation should work differently, are placeholders.
const DAILY_BUFFS = 4;
function dailyBuffs(day) {
  let seed = [...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7) || 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const keys = Object.keys(BUFFS);
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  return keys.slice(0, DAILY_BUFFS);
}

// One buff from `pool`, weighted by the wiki's drop rates among them.
function pickBuff(pool, rng = Math.random) {
  let roll = rng() * pool.reduce((sum, k) => sum + BUFFS[k].odds, 0);
  for (const k of pool) { roll -= BUFFS[k].odds; if (roll < 0) return k; }
  return pool[pool.length - 1];
}
// One buff drop from today's buffs (a roam).
const rollBuff = (day, rng = Math.random) => pickBuff(dailyBuffs(day), rng);
// One of all ten (Eternal Gift, a hatched Golden Goose Egg: their own tables are these, with the same odds).
const rollAnyBuff = (rng = Math.random) => pickBuff(Object.keys(BUFFS), rng);

// Bridge buffs (the wiki's "Powerups"): temporary, four types, one on the map each UTC hour (the same for everyone). A roam may find the
// current one (roam.js); the member holds it until their next fight, which uses it up. At most one per type. Early (level 1) values.
// ponytail: the wiki's 160 s timer isn't used (a fight is shorter), and Movement's stamina isn't simulated (its sprint speed counts as move speed).
const BRIDGE = {
  casting: { name: 'Casting', text: '+15 Spirit Power, +12% Cooldown Reduction', apply: (s) => { s.spirit += 15; s.cdr += 0.12; } },
  gun: { name: 'Gun', text: '+12% Fire Rate, +35% Max Ammo', apply: (s) => { s.fireRate *= 1.12; s.clip *= 1.35; } },
  movement: { name: 'Movement', text: '+2 Stamina, +1.5 m/s Sprint Speed', apply: (s) => { s.moveSpeed += 1.5; } },
  survival: { name: 'Survival', text: '+200 Max Health, +4 Health Regen', apply: (s) => { s.maxHealth += 200; s.healthRegen += 4; } },
};
const HOUR = 3600 * 1000;
const bridgeNow = (now = Date.now()) => Object.keys(BRIDGE)[Math.floor(now / HOUR) % 4];

module.exports = { stackResist, BUFFS, BRIDGE, DAILY_BUFFS, buffText, applyBuffs, dailyBuffs, rollBuff, rollAnyBuff, bridgeNow };
