// Run: node --test test/enemycc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');

const control = (id, tags, verb = `${id}ed`) => ({ id, every: 0.2, duration: 1, tags, verb });
function setup(controls, items = []) {
  const hero = buildHero('Haze', { items });
  hero.health = hero.stats.maxHealth = 100000;
  hero.stats.healthRegen = 0;
  hero.stats.fireRate = 0;
  for (const ability of hero.abilities) ability.cdLeft = Infinity;
  hero.meleeAt = Infinity;
  hero.stamina = hero.stats.stamina = 0;
  hero.nextSlide = Infinity;
  const foe = enemy('Controller', { maxHealth: 100000, dps: 0, controls });
  return { hero, foe, fight: new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.99 }) };
}

test('enemy controls apply stun, sleep, silence and grapple through Fight.cc and log them', () => {
  for (const [id, tags, verb] of [
    ['stun', ['stun'], 'stunned'],
    ['sleep', ['sleep'], 'slept'],
    ['silence', ['silence'], 'silenced'],
    ['grapple', ['stun', 'immobilize'], 'grappled'],
  ]) {
    const { hero, fight } = setup([control(id, tags, verb)]);
    fight.run(0.6);
    for (const tag of tags) assert.ok(hero.has(tag), `${id} applies ${tag}`);
    assert.ok(fight.log.some((line) => line.cc && line.what === verb), `${id} is logged`);
  }
});

test('a blast uses its own CC tags instead of always sleeping', () => {
  const { hero, fight } = setup([]);
  fight.enemies[0].stats.blast = { every: 0.2, damage: 0, maxHealthPct: 0, curse: 1, what: 'silence', tags: ['silence'] };
  fight.run(0.6);
  assert.ok(hero.has('silence'));
  assert.equal(hero.has('sleep'), false);
});

test('Unstoppable anticipates enemy controls and blocks them', () => {
  const { hero, fight } = setup([{ id: 'stun', every: 2, duration: 1, tags: ['stun'], verb: 'stunned' }], ['Unstoppable']);
  fight.run(2.2);
  assert.ok(fight.log.some((line) => line.who === 'Haze' && line.what === 'Unstoppable'));
  assert.equal(hero.has('stun'), false);
  assert.equal(fight.log.some((line) => line.cc), false, 'blocked control is not reported as landed');
});

test('status resistance shortens enemy controls', () => {
  const { hero, fight } = setup([control('silence', ['silence'], 'silenced')]);
  hero.stats.statusResist = 0.5;
  fight.run(0.6);
  const status = hero.statuses.find((s) => s.id === 'enemy:silence');
  assert.ok(status.until - fight.time < 0.6 && status.until - fight.time > 0.3);
});

test('a rival hero CC status goes through the same gate', () => {
  const { hero, fight } = setup([]);
  const rival = buildHero('Abrams', {});
  fight.addStatus(hero, { id: 'test_unstoppable', duration: 2, tags: ['unstoppable'] });
  fight.as({ unit: rival }, () => fight.addStatus(hero, { id: 'rival_stun', duration: 1, tags: ['stun'], debuff: true }));
  assert.equal(hero.has('stun'), false);
});
