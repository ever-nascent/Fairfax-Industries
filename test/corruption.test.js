// Run: node --test. Corrupted items: the bonuses (from deadlock-api.com's labels) and the drawback, as the Hero screen shows them.
// The sample below is deadlock-api.com's item data for 4 items, cut down to the fields corruption.js reads (Oct 22, 2026).
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const corruption = require('../src/utils/farm/corruption');
const { DRAWBACKS } = require('../src/utils/farm/stats');

const tip = (...sections) => sections.map(([section_type, a]) => ({ section_type, section_attributes: [a] }));
const SAMPLE = [
  {
    name: 'Tesla Bullets', shopable: true,
    corrupted_info: { property_upgrades: [{ name: 'DamagePerChain', bonus: '47' }, { name: 'BonusPerChain', bonus: '47' }, { name: 'ProcChance', bonus: '5' }, { name: 'ProcCooldown', bonus: '-0.03' }, { name: 'ChainCount', bonus: '4', round_corrupted_bonus: true }, { name: 'ChainRadius', bonus: '7m' }] },
    properties: { DamagePerChain: { label: 'Shock Damage', value: '33', tooltip_section: 'passive' }, BonusPerChain: { label: 'Damage on Jump', value: '33' }, ProcChance: { label: 'Proc Chance', postfix: '%', value: '15', tooltip_section: 'passive' }, ProcCooldown: { label: 'Max Frequency', postfix: 's', value: '0.2', tooltip_section: 'passive' }, ChainCount: { label: 'Max Jumps', value: '4', tooltip_section: 'passive' }, ChainRadius: { label: 'Jump Radius', postfix: 'm', value: '8m', tooltip_section: 'passive' } },
    tooltip_sections: tip(['passive', { properties: ['ProcCooldown', 'ChainCount', 'ChainRadius'], important_properties: ['DamagePerChain', 'ProcChance'] }]),
  },
  {
    name: 'Counterspell', shopable: true,
    corrupted_info: { property_upgrades: [{ name: 'BonusHealth', bonus: '200' }, { name: 'SpiritPowerInnate', bonus: '17' }, { name: 'SpiritPower', bonus: '20' }, { name: 'AbilityCooldown', bonus: '-10' }] },
    properties: { BonusHealth: { label: 'Bonus Health', prefix: '{s:sign}', value: '50', tooltip_section: 'innate' }, SpiritPowerInnate: { label: 'Spirit Power', prefix: '{s:sign}', value: '5', tooltip_section: 'innate' }, SpiritPower: { label: 'Spirit Power', prefix: '+', value: '20', tooltip_section: 'passive' }, AbilityCooldown: { label: 'Cooldown', postfix: 's', value: 23, tooltip_section: 'passive' } },
    tooltip_sections: tip(['innate', { properties: ['BonusHealth', 'SpiritPowerInnate'] }], ['passive', { properties: ['AbilityCooldown'], important_properties: ['SpiritPower'] }]),
  },
  {
    name: 'Frenzy', shopable: true,
    corrupted_info: { property_upgrades: [{ name: 'BonusFireRate', bonus: '10' }, { name: 'FervorMovespeed', bonus: '2m' }, { name: 'FervorFireRate', bonus: '25' }] },
    properties: { BonusFireRate: { label: 'Fire Rate', postfix: '%', prefix: '{s:sign}', value: '15', tooltip_section: 'innate' }, FervorMovespeed: { label: 'Move Speed', postfix: ' m/s', value: '4m', tooltip_section: 'passive' }, FervorFireRate: { label: 'Fire Rate', postfix: '%', value: '40', tooltip_section: 'passive' } },
    tooltip_sections: tip(['innate', { properties: ['BonusFireRate'] }], ['passive', { important_properties: ['FervorMovespeed', 'FervorFireRate'] }]),
  },
  { name: 'Not Sold', shopable: false, corrupted_info: { property_upgrades: [{ name: 'X', bonus: '1' }] } },
];

test('labels: only shop items with corrupted upgrades are kept', () => {
  const labels = corruption.fromApi(SAMPLE);
  assert.deepStrictEqual(Object.keys(labels), ['Tesla Bullets', 'Counterspell', 'Frenzy']);
  corruption.setLabels(labels);
});

test('bonuses read like the game: label, base -> after; hidden stats left out; whole numbers rounded', () => {
  assert.deepStrictEqual(corruption.bonusLines('Tesla Bullets'), ['Shock Damage 33 → 80', 'Proc Chance 15% → 20%', 'Max Frequency 0.2s → 0.17s', 'Max Jumps 4 → 8', 'Jump Radius 8m → 15m']);
});

test('two stats with one label: the second is named by its section', () => {
  assert.deepStrictEqual(corruption.bonusLines('Counterspell'), ['Bonus Health +50 → +250', 'Spirit Power +5 → +22', 'Spirit Power (Passive) +20 → +40', 'Cooldown 23s → 13s']);
  assert.deepStrictEqual(corruption.bonusLines('Frenzy'), ['Fire Rate +15% → +25%', 'Move Speed 4 m/s → 6 m/s', 'Fire Rate (Passive) 40% → 65%']);
});

test('the block: Bonuses, a blank line, then Drawback', () => {
  const drawback = Object.keys(DRAWBACKS)[0];
  const block = corruption.corruptionBlock({ name: 'Frenzy', drawback, amount: 2.1 });
  assert.strictEqual(block, `**Bonuses**\nFire Rate +15% → +25%\nMove Speed 4 m/s → 6 m/s\nFire Rate (Passive) 40% → 65%\n\n**Drawback**\n${DRAWBACKS[drawback].name} -2.1${DRAWBACKS[drawback].unit}`);
  assert.ok(block.length <= 1024);
});

test('without labels an item still lists its bonuses from the item card', () => {
  corruption.setLabels({});
  const lines = corruption.bonusLines('Frenzy');
  assert.ok(Array.isArray(lines));
  for (const l of lines) assert.doesNotMatch(l, /undefined|NaN/, l);
});

test('startup: a failed download never throws', async () => {
  const out = await corruption.loadCorruptionLabels({ fetchImpl: async () => ({ ok: false, status: 503 }), now: Date.now() + 365 * 864e5 });
  assert.strictEqual(typeof out, 'object');
});
