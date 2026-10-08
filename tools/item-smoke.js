// Hero Farming: every shop item and legendary in fights, with each hero that has ability logic. Two checks (`node tools/item-smoke.js [item name]`,
// never touches data/):
//   1. it fights without throwing, hanging or breaking a number;
//   2. its effect does something: the same fights with the item's effect taken off (its stats kept) must come out different. An item whose
//      effect changes nothing in any of the fights below is listed, so a dead rule can't hide.
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero, roster } = require('../src/utils/farm/hero');
const { ITEM_POOL, LEGENDARY_NAMES } = require('../src/utils/farm/levels');
const { FX } = require('../src/utils/farm/items');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
// Fights that give every kind of effect something to work on: a boss that blasts (curse) and mixes damage, casters, gunners, a crowd; the hero
// starts hurt, at level 20 with every ability at tier 3.
const SCENES = [
  () => [
    enemy('Boss', { maxHealth: 6000, dps: 25, damageType: 'mixed', blast: { every: 5, damage: 120, maxHealthPct: 0.05, curse: 1.5 }, souls: 50 }),
    enemy('Caster', { maxHealth: 900, dps: 12, damageType: 'spirit', healthRegen: 8, souls: 30 }),
    enemy('Gunner', { maxHealth: 900, dps: 12, souls: 30 }),
  ],
  () => Array.from({ length: 5 }, (_, i) => enemy(`Haunt ${i + 1}`, { maxHealth: 500, dps: 6, distance: 10, souls: 41 })),
  () => [enemy('Tank', { maxHealth: 20000, dps: 35, distance: 20, healthRegen: 15, blast: { every: 6, damage: 300, maxHealthPct: 0.1, curse: 2, type: 'spirit', what: 'stomp' }, damageType: 'spirit' })],
  // a long, hard one with a Rejuv: heavy weapon hits, frequent blasts, a death (Eternal Gift's shorter wait), time for big ability hits
  Object.assign(() => [enemy('Brute', { maxHealth: 60000, dps: 300, distance: 8, blast: { every: 3, damage: 50, maxHealthPct: 0, curse: 0.5 } })], { rejuvs: 1, boons: 35 }),
];

function fight(heroName, name, scene, withEffect) {
  const h = buildHero(heroName, { items: [name], boons: scene.boons ?? 20, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 } });
  h.rejuvs = scene.rejuvs ?? 0;
  if (!withEffect) { h.items = []; for (const a of h.abilities) a.imbues = []; } // the same hero and stats, no effect
  const foes = scene();
  const f = new Fight({ heroes: [h], enemies: foes, rng: seeded(7) });
  h.health *= 0.6;
  const t = Date.now();
  let steps = 0;
  while (f.time < 90 && h.alive && foes.some((e) => e.alive)) { f.step(); if (++steps > 2000 || Date.now() - t > 3000) throw new Error('hangs'); }
  for (const x of [h, ...foes]) if (!Number.isFinite(x.health) || !Number.isFinite(x.stats.maxHealth)) throw new Error(`health is not a number on ${x.name}`);
  return [f.time.toFixed(1), h.health.toFixed(1), ...foes.map((e) => e.health.toFixed(1)), f.bonusSouls.toFixed(2), f.log.length].join(' ');
}

const only = process.argv[2];
const errors = [];
const idle = [];
for (const name of [...ITEM_POOL, ...LEGENDARY_NAMES].filter((n) => !only || n === only)) {
  let changed = !FX[name]; // plain stat items have nothing to check
  for (const hero of roster()) {
    for (const scene of SCENES) {
      try {
        const a = fight(hero, name, scene, true);
        if (!changed && a !== fight(hero, name, scene, false)) changed = true;
      } catch (e) { errors.push(`${name} (${hero}): ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
    }
  }
  if (!changed) idle.push(name);
}
const total = only ? 1 : ITEM_POOL.length + LEGENDARY_NAMES.length;
console.log(errors.length ? `Errors:\n${errors.join('\n')}` : `All ${total} items fight without errors.`);
console.log(idle.length ? `Effect changed nothing in any fight: ${idle.join(', ')}` : 'Every item effect changes its fights.');
process.exitCode = errors.length || idle.length ? 1 : 0;
