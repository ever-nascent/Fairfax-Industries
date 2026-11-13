process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-dreroll-'));
const test = require('./group')(__filename);
const assert = require('node:assert/strict');
const D = require('../src/utils/farm/descent');
const { buildHero } = require('../src/utils/farm/hero');
const { POOL, SLOTS, countItems, priceFor } = require('../src/utils/farm/levels');
const { itemByName } = require('../src/utils/farm/stats');

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

test('taking an upgrade also gives its shown lower-tier BONUS item, but only when the build has room for it', () => {
  const d = D.newRun('Haze', 1);
  d.items.vitality = ['Extra Health'];
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Fortitude'], bonuses: { 0: 'Extra Regen' }, enhanced: [], room: 1 };
  const result = D.takeChoice(d, 0);
  assert.equal(result.bonus, 'Extra Regen');
  assert.deepEqual(d.items.vitality.sort(), ['Extra Regen', 'Fortitude'].sort());

  // his call Oct 26: a BONUS only comes with room for it once the upgrade is in, and nothing ever asks which item to give up for one
  const build = (seed, size) => {
    const run = D.newRun('Haze', seed);
    run.items.vitality = ['Extra Health'];
    const extras = SLOTS.flatMap((s) => POOL[s]).filter((n) => n !== 'Extra Health' && n !== 'Fortitude' && n !== 'Extra Regen' && itemByName(n).Tier === 1).slice(0, size - 1);
    for (const name of extras) run.items[SLOTS.find((s) => POOL[s].includes(name))].push(name);
    run.phase = 'offer';
    run.offer = { kind: 'items', choices: ['Fortitude'], bonuses: { 0: 'Extra Regen' }, enhanced: [], room: 1 };
    return run;
  };
  const heldIn = (run) => SLOTS.flatMap((s) => run.items[s]);

  const roomy = build(2, 11); // 11 items: the upgrade keeps it at 11, so the BONUS fits as the 12th
  const took = D.takeChoice(roomy, 0);
  assert.ok(took.ok && took.bonus === 'Extra Regen');
  assert.equal(countItems(roomy.items), 12);
  assert.equal(roomy.phase, 'ready');

  const full = build(3, 12); // a stale offer made before the rule: the upgrade is taken, the BONUS dropped, nothing asked
  const before = heldIn(full).filter((n) => n !== 'Extra Health');
  const upgraded = D.takeChoice(full, 0);
  assert.ok(upgraded.ok && !upgraded.bonus && !upgraded.bonusPending);
  assert.equal(full.phase, 'ready');
  assert.equal(full.pendingBonus, undefined);
  assert.equal(countItems(full.items), 12);
  assert.ok(heldIn(full).includes('Fortitude') && !heldIn(full).includes('Extra Health') && !heldIn(full).includes('Extra Regen'));
  assert.ok(before.every((n) => heldIn(full).includes(n)), 'no other item was given up');

  // and an offer made for a full build carries no BONUS at all
  for (let seed = 1; seed <= 40; seed++) {
    const run = build(seed, 12);
    const offer = D.itemOffer(run, D.dice(seed, 'bonus-check'));
    for (const [i, name] of offer.choices.entries()) {
      const used = priceFor(itemByName(name), run.items).used.length;
      if (countItems(run.items) - used + 1 >= 12) assert.equal(offer.bonuses[i], undefined, `${name} at seed ${seed}`);
    }
  }
});
