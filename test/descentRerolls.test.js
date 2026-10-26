process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-dreroll-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/utils/farm/descent');
const { buildHero } = require('../src/utils/farm/hero');
const { POOL, SLOTS, countItems } = require('../src/utils/farm/levels');

const itemSpec = (d, room = 1) => {
  for (let seed = d.seed; seed < d.seed + 1000; seed++) {
    const spec = D.roomSpec(seed, room, d.hero);
    if (spec.kind === 'fight') { d.seed = seed; return spec; }
  }
  throw new Error('no fight room');
};

test('three seeded item rerolls per floor never go below zero and boss rewards cannot reroll', () => {
  const a = D.newRun('Haze', 17);
  const spec = itemSpec(a);
  a.phase = 'offer';
  a.offer = D.rollOffer(a, spec);
  const b = structuredClone(a);
  for (let n = 0; n < 3; n++) {
    assert.deepEqual(D.rerollChoice(a), { ok: true });
    assert.deepEqual(D.rerollChoice(b), { ok: true });
    assert.deepEqual(a.offer, b.offer, 'the same run and reroll count produce the same row');
  }
  assert.equal(a.rerolls, 0);
  assert.deepEqual(D.rerollChoice(a), { error: 'empty' });
  assert.equal(a.rerolls, 0);

  a.rerolls = 2;
  a.offer = { kind: 'buffs', choices: ['maxHealth'], room: 5 };
  assert.deepEqual(D.rerollChoice(a), { error: 'none' });
  assert.equal(a.rerolls, 2);
});

test('rerolls reset to three after each floor boss', () => {
  const d = D.newRun('Haze', 3);
  d.room = 5;
  d.rerolls = 0;
  D.afterWin(d, { spec: D.roomSpec(d.seed, 5, d.hero), health: 0.5, rejuvsUsed: 0, kept: {} });
  assert.equal(d.room, 6);
  assert.equal(d.rerolls, 3);
});

test('Enhanced pity rises three points after a row with none and resets only when one is picked', () => {
  const d = D.newRun('Haze', 1);
  const spec = itemSpec(d);
  d.enhancedChance = 0;
  const plain = D.rollOffer(d, spec);
  assert.deepEqual(plain.enhanced, []);
  assert.equal(d.enhancedChance, 0.03);

  d.enhancedChance = 1;
  d.phase = 'offer';
  d.offer = D.rollOffer(d, spec, 1);
  assert.equal(d.offer.enhanced.length, d.offer.choices.length);
  const picked = d.offer.choices[0];
  assert.equal(D.takeChoice(d, 0).ok, true);
  assert.ok(d.enhanced.includes(picked));
  assert.equal(d.enhancedChance, 0.10);
});

test('Enhanced wiki PropertyUpgrades change the item in a real build', () => {
  const normal = buildHero('Haze', { items: ['Extra Health'] });
  const enhanced = buildHero('Haze', { items: ['Extra Health'], enhanced: ['Extra Health'] });
  assert.equal(enhanced.stats.maxHealth - normal.stats.maxHealth, 115);
});

test('taking an upgrade also gives its shown lower-tier BONUS item, including with a full build', () => {
  const d = D.newRun('Haze', 1);
  d.items.vitality = ['Extra Health'];
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Fortitude'], bonuses: { 0: 'Extra Regen' }, enhanced: [], room: 1 };
  const result = D.takeChoice(d, 0);
  assert.equal(result.bonus, 'Extra Regen');
  assert.deepEqual(d.items.vitality.sort(), ['Extra Regen', 'Fortitude'].sort());

  const full = D.newRun('Haze', 2);
  full.items.vitality = ['Extra Health'];
  const extras = SLOTS.flatMap((s) => POOL[s]).filter((n) => n !== 'Extra Health' && n !== 'Fortitude' && n !== 'Extra Regen').slice(0, 11);
  for (const name of extras) full.items[SLOTS.find((s) => POOL[s].includes(name))].push(name);
  full.phase = 'offer';
  full.offer = { kind: 'items', choices: ['Fortitude'], bonuses: { 0: 'Extra Regen' }, enhanced: [], room: 1 };
  assert.deepEqual(D.takeChoice(full, 0), { error: 'full' });
  assert.equal(countItems(full.items), 12, 'a failed choice changes nothing');
  const replaced = extras[0];
  assert.equal(D.takeChoice(full, 0, replaced).ok, true);
  assert.equal(countItems(full.items), 12);
  assert.ok(SLOTS.flatMap((s) => full.items[s]).includes('Extra Regen'));
  assert.ok(!SLOTS.flatMap((s) => full.items[s]).includes(replaced));
});
