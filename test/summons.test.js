// The Patron's troopers: a summoner calls in waves on its schedule, up to its cap, and can't be hurt while one stands.
const test = require('./group')(__filename);
const assert = require('node:assert');
const { Fight, Unit, enemy, guarded } = require('../src/utils/farm/engine');
const { PATRON_SUMMON, SIEGE } = require('../src/utils/farm/targets');

const target = () => new Unit({ name: 'Hero', team: 'hero', stats: { maxHealth: 1e9, fireRate: 0, clip: 0 } });

test('summons: waves on time, capped, sized off the summoner, and the summoner is guarded while one stands', () => {
  const patron = enemy('Patron', { maxHealth: 10000, dps: 100 });
  patron.stats.summon = { first: 2, every: 5, cap: 4, wave: [{ name: 'Trooper', health: 0.1, dps: 0.2 }, { name: 'Trooper', health: 0.1, dps: 0.2 }, { name: 'Medic Trooper', health: 0.1, dps: 0.05 }] };
  const hero = target();
  const fight = new Fight({ heroes: [hero], enemies: [patron], rng: () => 0.5 });
  fight.run(1.9);
  assert.strictEqual(fight.enemies.length, 1, 'nothing before `first`');
  fight.run(0.2);
  assert.strictEqual(fight.enemies.length, 4, 'a wave of 3 at `first`');
  const [trooper] = patron.summons;
  assert.strictEqual(trooper.stats.maxHealth, 1000);
  assert.strictEqual(trooper.stats.dps, 20);
  assert.ok(guarded(patron));
  assert.ok(!fight.foes.includes(patron), 'out of reach behind its troopers');
  assert.strictEqual(fight.damage(hero, patron, 500, 'bullet'), 0, 'no damage while a trooper stands');
  fight.run(5);
  assert.strictEqual(patron.summons.filter((u) => u.alive).length, 4, 'the next wave only fills up to the cap');
  for (const u of patron.summons) u.health = 0;
  assert.ok(!guarded(patron));
  assert.ok(fight.damage(hero, patron, 500, 'bullet') > 0, 'hurt again once they are down');
});

test('summons: both siege Patron forms carry the troopers', () => {
  for (const stage of SIEGE.stages.slice(3)) assert.strictEqual(stage.enemies()[0].stats.summon, PATRON_SUMMON, stage.name);
  for (const stage of SIEGE.stages.slice(0, 3)) assert.ok(!stage.enemies()[0].stats.summon, stage.name);
});
