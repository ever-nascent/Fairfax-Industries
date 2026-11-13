// Stacks the game keeps for good (his call, Oct 28): in Descend an ability's stacks last the run (the run's `kept`, by ability name), on the
// farm a fight starts without them; Glass Cannon's and Trophy Collector's are kept everywhere. The screens list them (views.js stackLines).
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { buildHero } = require('../src/utils/farm/hero');
const { abilityStacks } = require('../src/utils/farm/ability');
const { stackLines } = require('../src/utils/farm/views');

test('a hero built with a run\'s stacks has them, hands them back, and lists them; without any it starts at 0 and lists none', () => {
  const owl = buildHero('Grey Talon', { kept: { 'Guided Owl': 3 } });
  assert.deepStrictEqual(abilityStacks(owl), { 'Guided Owl': 3 });
  assert.deepStrictEqual(stackLines(owl), ['**Guided Owl:** 3 kills: +24 Spirit Power']);
  const fresh = buildHero('Grey Talon', {});
  assert.deepStrictEqual(abilityStacks(fresh), { 'Guided Owl': 0 });
  assert.deepStrictEqual(stackLines(fresh), []);
});

test('stacks that change the hero when it is built: Combo\'s max health, Still Life\'s health sketches, Leech Therapy\'s regen', () => {
  const combo = buildHero('Mo & Krill', { kept: { Combo: 2 } });
  assert.strictEqual(combo.stats.maxHealth - buildHero('Mo & Krill', {}).stats.maxHealth, 100);
  assert.strictEqual(combo.health, combo.stats.maxHealth);
  assert.strictEqual(buildHero('Violet', { kept: { 'Still Life': { health: 1 } } }).stats.maxHealth - buildHero('Violet', {}).stats.maxHealth, 20);
  const harrow = buildHero('Nurse Harrow', { kept: { 'Leech Therapy': 5 } });
  assert.ok(harrow.stats.healthRegen > buildHero('Nurse Harrow', {}).stats.healthRegen);
});

test('Vindicta\'s Assassinate keeps its kills for the run too', () => {
  const v = buildHero('Vindicta', { kept: { Assassinate: 2 } });
  assert.deepStrictEqual(abilityStacks(v), { Assassinate: 2 });
  assert.match(stackLines(v)[0], /^\*\*Assassinate:\*\* 2 kills: \+\d+(\.\d+)?% Weapon Damage$/);
});

test('item stacks are listed with what they give', () => {
  const haze = buildHero('Haze', { items: ['Glass Cannon'], kept: { 'Glass Cannon': 5 } });
  assert.deepStrictEqual(stackLines(haze), ['**Glass Cannon:** 5 / 8 kills: +35% Fire Rate']);
});
