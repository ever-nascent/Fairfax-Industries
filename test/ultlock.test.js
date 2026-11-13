// Run: node --test test/ultlock.test.js
const test = require('./group')(__filename);
const assert = require('node:assert/strict');
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');

// Haze at 60% health facing a dummy: Bullet Dance goes first, everything else is ready too.
function setup(controls = []) {
  const hero = buildHero('Haze');
  hero.stats.maxHealth = 100000;
  hero.health = 50000;
  hero.stats.healthRegen = 0;
  const foe = enemy('Dummy', { maxHealth: 1e9, dps: 0, controls });
  return { hero, fight: new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.99 }) };
}

test('a lasting ultimate (Bullet Dance) holds every other cast until it ends', () => {
  const { hero, fight } = setup();
  const ult = hero.abilities.find((a) => a.slot === 4);
  for (const a of hero.abilities) if (a !== ult) a.cdLeft = 0.3; // ready just after the ult goes off
  fight.run(8);
  const casts = fight.log.filter((l) => l.who === 'Haze' && hero.abilities.some((a) => a.name === l.what));
  assert.equal(casts[0].what, 'Bullet Dance');
  const ends = casts[0].t + ult.castDelay + ult.lockout;
  assert.ok(ult.lockout >= 3.5, `locks for its duration (${ult.lockout})`);
  const early = casts.slice(1).filter((l) => l.t < ends - 0.11);
  assert.deepEqual(early, [], 'nothing else is cast during Bullet Dance');
  assert.ok(casts.length > 1, 'the other abilities come once it ends');
});

test('a stun interrupts the ultimate: its effects on the hero end with the lock', () => {
  const { hero, fight } = setup([{ id: 'stun', every: 1.5, duration: 0.5, tags: ['stun'], verb: 'stunned' }]);
  for (const a of hero.abilities) if (a.slot !== 4) a.cdLeft = Infinity;
  fight.run(1.2);
  const dancing = () => hero.statuses.some((s) => s.id === 'bullet_dance');
  assert.ok(dancing(), 'dancing before the stun');
  fight.run(0.6);
  assert.ok(hero.has('stun'));
  assert.ok(!dancing(), 'the stun ended it');
  assert.equal(hero.lockedUntil, 0);
  assert.ok(fight.log.some((l) => l.interrupted && l.what === 'Bullet Dance'));
});

test('the ultimate\'s own void does not interrupt it (Return to Shadows)', () => {
  const hero = buildHero('Calico');
  const foe = enemy('Dummy', { maxHealth: 1e9, dps: 0 });
  const fight = new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.99 });
  const ult = hero.abilities.find((a) => a.slot === 4);
  for (const a of hero.abilities) if (a !== ult) a.cdLeft = Infinity;
  fight.cast(ult);
  fight.run(ult.castDelay + 1);
  assert.ok(hero.lockedUntil > fight.time);
});

test('only ultimates with the game flags lock, and the 9999 s channels never do', () => {
  const lock = (name) => buildHero(name).abilities.find((a) => a.slot === 4).lockout;
  assert.ok(lock('McGinnis') > 0 && lock('Warden') > 0 && lock('Seven') > 0 && lock('Dynamo') > 0);
  assert.equal(lock('Celeste'), 0);
  assert.equal(lock('Apollo'), 0);
  assert.equal(lock('Grey Talon'), 0);
  assert.equal(buildHero('Haze').abilities.find((a) => a.slot === 1).lockout, 0);
});
