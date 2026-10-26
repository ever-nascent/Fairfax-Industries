const test = require('node:test');
const assert = require('node:assert/strict');
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');

const steps = (fight, count) => { for (let i = 0; i < count; i++) fight.step(); };
function setup(items = []) {
  const hero = buildHero('Haze', { items });
  hero.abilities = [];
  hero.meleeAt = Infinity;
  hero.stamina = hero.stats.stamina = 0;
  hero.nextSlide = Infinity;
  hero.health = hero.stats.maxHealth = 100000;
  hero.stats.healthRegen = 0;
  if (!items.length) hero.stats.fireRate = 0;
  const foe = enemy('Attacker', { maxHealth: 1e6, dps: 100 });
  const fight = new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.99 });
  return { hero, foe, fight };
}
const slow = (fight, foe, share, id = 'slow', duration = 30) => fight.addStatus(foe, { id, duration, mods: { slow: share } });

test('a 24% slow makes an enemy hit seven times instead of ten over ten seconds, at the same damage per hit', () => {
  for (const damageType of ['bullet', 'spirit', 'mixed']) {
    for (const [share, hits] of [[0, 10], [0.24, 7]]) {
      const { hero, foe, fight } = setup();
      foe.stats.damageType = damageType;
      slow(fight, foe, share);
      steps(fight, 100);
      assert.equal(fight.dealt.get(foe), hits * 100, `${damageType}, slow ${share}`);
      assert.equal(hero.stats.maxHealth - hero.health, hits * 100);
    }
  }
});

test('slows stack, respect slow resistance, and cannot reverse or stop the attack timer', () => {
  for (const [shares, resist, hits] of [
    [[0.3, 0.2], 0, 5],
    [[0.5], 0.5, 7],
    [[0.8, 0.8], 0, 1],
    [[-0.5], 0, 10],
  ]) {
    const { foe, fight } = setup();
    foe.stats.slowResist = resist;
    shares.forEach((share, i) => slow(fight, foe, share, `slow-${i}`));
    steps(fight, 100);
    assert.equal(fight.dealt.get(foe), hits * 100, `slows ${shares}, resistance ${resist}`);
  }
});

test('a slow arriving mid-attack preserves progress, and expiration restores the normal rate without catching up', () => {
  const { foe, fight } = setup();
  steps(fight, 5);
  slow(fight, foe, 0.5, 'brief', 1.01);
  steps(fight, 9);
  assert.equal(fight.dealt.get(foe) ?? 0, 0);
  steps(fight, 1);
  assert.equal(fight.dealt.get(foe), 100, 'first hit at 1.5 seconds');
  steps(fight, 9);
  assert.equal(foe.mod('slow'), 0, 'the slow expired');
  assert.equal(fight.dealt.get(foe), 100, 'no catch-up hit');
  steps(fight, 1);
  assert.equal(fight.dealt.get(foe), 200, 'next hit one second later');
});

for (const name of ['Slowing Bullets', 'Weighted Shots']) test(`${name} builds up from real gunfire and reduces incoming damage over a fixed time`, () => {
  const active = setup([name]);
  const inactive = setup([name]);
  inactive.hero.items = []; // retain the same item stats, remove only its effect
  steps(active.fight, 200);
  steps(inactive.fight, 200);
  assert.ok(active.foe.mod('slow') > 0, 'real bullets built up the slow');
  assert.ok(active.fight.dealt.get(active.foe) < inactive.fight.dealt.get(inactive.foe));
  assert.ok(active.hero.health > inactive.hero.health);
});

test('a slowed rival hero fires fewer bullets too', () => {
  const shots = (share) => {
    const hero = buildHero('Haze', {});
    const rival = buildHero('Haze', {});
    for (const unit of [hero, rival]) {
      unit.abilities = [];
      unit.health = unit.stats.maxHealth = 100000;
      unit.stats.healthRegen = 0;
      unit.meleeAt = Infinity;
      unit.stamina = unit.stats.stamina = 0;
      unit.nextSlide = Infinity;
    }
    hero.stats.fireRate = 0;
    const fight = new Fight({ heroes: [hero], enemies: [rival], rng: () => 0.99 });
    slow(fight, rival, share);
    steps(fight, 100);
    return fight.dealt.get(rival) ?? 0;
  };
  assert.ok(shots(0.5) < shots(0));
});
