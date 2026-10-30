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

test('curse is separate from sleep, disables everything and cannot be cleansed', () => {
  const { hero, fight } = setup([]);
  fight.cc(hero, { id: 'curse', duration: 2, tags: ['curse'] });
  assert.ok(hero.has('curse') && hero.cantAct);
  assert.equal(hero.has('sleep'), false);
  fight.cleanse(hero);
  assert.ok(hero.has('curse'), 'a cleanse cannot remove or shorten curse');
});

test('a stun interrupts a cast in progress', () => {
  const { hero, fight } = setup([]);
  let landed = false;
  fight.cast({ unit: hero, name: 'Slow Cast', castDelay: 0.3, use() {}, cast() { landed = true; } });
  fight.cc(hero, { id: 'stun', duration: 1, tags: ['stun'] });
  assert.ok(hero.cantAct);
  fight.run(0.5);
  assert.equal(landed, false);
});

test('light and heavy melees identify themselves in the Battle Log', () => {
  const { hero, foe, fight } = setup([]);
  fight.melee(hero, foe, 'light');
  fight.melee(hero, foe, 'heavy');
  assert.deepStrictEqual(fight.log.map((line) => line.what), ['Light Melee', 'Heavy Melee']);
  assert.ok(fight.log.every((line) => line.melee && line.target === 'Controller'));
});

test('the Battle Log bolds the effect an enemy lands on the hero', () => {
  const { simulate } = require('../src/utils/farm/play');
  let s = 7;
  const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const run = simulate('Haze', 'guardian', { rng, boons: 6 });
  const line = run.log.find(([, text]) => /\*\*Stunned\*\*/.test(text));
  assert.ok(line, `no stun line in: ${run.log.map(([, t]) => t).join(' | ')}`);
  assert.match(line[1], /^Guardian \*\*Stunned\*\* Haze$/);
});

test('a disarm stops the hero shooting', () => {
  const { hero, fight } = setup([{ id: 'disarm', every: 0.2, duration: 5, tags: ['disarm'], verb: 'disarmed' }]);
  hero.stats.fireRate = 1;
  const clip = hero.weapon?.clip;
  fight.run(2);
  assert.ok(hero.has('disarm'));
  assert.ok(fight.log.some((line) => line.cc && line.what === 'disarmed'));
  assert.equal(fight.enemies[0].health, fight.enemies[0].stats.maxHealth, 'no damage dealt while disarmed');
  if (clip != null) assert.equal(hero.weapon.clip, clip);
});

test('Dispel Magic is used through a stun and removes it, but never on a curse', () => {
  const { hero, fight } = setup([{ id: 'stun', every: 1, duration: 3, tags: ['stun'], verb: 'stunned' }], ['Dispel Magic']);
  fight.run(1.5);
  assert.ok(fight.log.some((line) => line.who === 'Haze' && line.what === 'Dispel Magic'));
  assert.equal(hero.has('stun'), false);

  const cursed = setup([], ['Dispel Magic']);
  cursed.fight.enemies[0].stats.blast = { every: 0.2, damage: 0, maxHealthPct: 0, curse: 3, tags: ['curse'] };
  cursed.fight.run(1);
  assert.ok(cursed.hero.has('curse'));
  assert.equal(cursed.fight.log.some((line) => line.what === 'Dispel Magic'), false);
});

test('Counterspell parries other crowd control by chance, then goes on cooldown; never a curse', () => {
  const stun = { id: 'stun', every: 1, duration: 0.5, tags: ['stun'], verb: 'stunned' };
  const lucky = setup([stun], ['Counterspell']);
  lucky.fight.rng = () => 0.1;
  lucky.fight.run(1.2);
  assert.equal(lucky.hero.has('stun'), false);
  assert.ok(lucky.fight.log.some((line) => line.ccBlocked === 'Counterspell'));
  const item = lucky.hero.items.find((i) => i.name === 'Counterspell');
  assert.ok(item.cdLeft > 0, 'on cooldown after the parry');
  lucky.fight.run(1.2);
  assert.ok(lucky.fight.log.some((line) => line.cc && line.what === 'stunned'), 'the next stun lands while it cools down');

  const unlucky = setup([stun], ['Counterspell']); // rng 0.99: the parry is mistimed
  unlucky.fight.run(1.2);
  assert.ok(unlucky.hero.has('stun'));
  assert.equal(unlucky.hero.items.find((i) => i.name === 'Counterspell').cdLeft, 0);

  const curse = setup([{ id: 'curse', every: 1, duration: 0.5, tags: ['curse'], verb: 'cursed' }], ['Counterspell']);
  curse.fight.rng = () => 0.1;
  curse.fight.run(1.2);
  assert.ok(curse.hero.has('curse'));
});
