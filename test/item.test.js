// Run: node --test. /item: the search behind the autocomplete, the item views and the enhanced labels. No network (pictures are already saved).
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { search, choices, resolve, itemView, builtFrom, upgradesInto } = require('../src/utils/farm/itemInfo');
const { ITEMS, LEGENDARIES } = require('../src/utils/farm/stats');
const corruption = require('../src/utils/farm/corruption');

test('search: exact, partial, word order, typos and missing letters all find the item', () => {
  assert.strictEqual(search('toxic bullets')[0].Name, 'Toxic Bullets');
  assert.strictEqual(search('tox')[0].Name, 'Toxic Bullets');
  assert.strictEqual(search('bullets tox')[0].Name, 'Toxic Bullets');
  assert.strictEqual(search('toxci bulets')[0].Name, 'Toxic Bullets');
  assert.ok(search('tbul').some((i) => i.Name === 'Toxic Bullets'));
  assert.strictEqual(search('SILENCER')[0].Name, 'Silencer');
  assert.deepStrictEqual(search('xyzzyqq'), []);
});

test('search: nothing typed lists the first items; the autocomplete fits Discord (25 choices, names under 100 characters)', () => {
  assert.strictEqual(search('').length, 25);
  for (const text of ['', 'a', 'mystic', 'spirit']) {
    const list = choices(text);
    assert.ok(list.length <= 25);
    assert.ok(list.every((c) => c.name.length <= 100 && resolve(c.value)?.Name === c.value));
  }
});

test('resolve: an exact name, a good match, and no match', () => {
  assert.strictEqual(resolve('toxic bullets').Name, 'Toxic Bullets');
  assert.strictEqual(resolve('toxci bulets').Name, 'Toxic Bullets');
  assert.strictEqual(resolve('xyzzyqq'), null);
});

test('every shop item and legendary has a page, in every view it offers', async () => {
  for (const card of [...ITEMS, ...LEGENDARIES]) {
    for (const view of ['details', 'enhanced', 'corrupted']) {
      const { embeds, files, components } = await itemView(card, view, '1');
      const json = embeds[0].toJSON();
      assert.ok(json.title.startsWith(card.Name), card.Name);
      assert.ok(json.description.length > 0 && json.description.length <= 4000, `${card.Name} ${view}`);
      assert.ok(json.fields.every((f) => f.value.length > 0 && f.value.length <= 1024), `${card.Name} ${view}`);
      assert.ok(embeds.length === 1 && !json.image && components[0].components.length === 3, card.Name); // no upgrade pictures in the embed
      assert.strictEqual(components.length, builtFrom(card).length + upgradesInto(card).length ? 2 : 1, card.Name); // the tree dropdown only with a tree
      const sent = new Set(files.map((f) => f.name));
      if (json.thumbnail) assert.ok(sent.has(json.thumbnail.url.replace('attachment://', '')), `${card.Name} ${view}`);
    }
  }
});

test('family: what an item is built from and upgrades into', () => {
  const magazine = resolve('Extended Magazine');
  assert.deepStrictEqual(upgradesInto(magazine).map((i) => i.Name).sort(), ['Escalating Resilience', 'Titanic Magazine']);
  for (const up of upgradesInto(magazine)) assert.ok(builtFrom(up).some((i) => i.Name === 'Extended Magazine'));
});

test('upgrade tree dropdown: lists the parts and upgrades, by name', async () => {
  const { components } = await itemView(resolve('Extended Magazine'), 'details', '7');
  const menu = components[1].components[0].toJSON();
  assert.strictEqual(menu.placeholder, 'View Upgrade Tree');
  assert.ok(menu.custom_id.startsWith('itemtree:7'));
  assert.deepStrictEqual(menu.options.map((o) => o.value), ['Escalating Resilience', 'Titanic Magazine']);
});

test('buttons: the open view is greyed out, a view the item has no data for is disabled', async () => {
  const { components } = await itemView(resolve('Extended Magazine'), 'enhanced', '1');
  const [details, enhanced, corrupted] = components[0].components.map((b) => b.toJSON());
  assert.ok(!details.disabled && enhanced.disabled);
  assert.ok(corrupted.disabled === !resolve('Extended Magazine').CorruptedUpgrades);
});

test('enhanced labels come from the API item list like the corrupted ones', () => {
  const api = [{ name: 'Toxic Bullets', shopable: true, upgrades: [{ property_upgrades: [{ name: 'DotHealthPercent', bonus: '0.7' }] }],
    properties: { DotHealthPercent: { label: 'Bleed Damage', postfix: '%', value: '1.9', tooltip_section: 'passive' } },
    tooltip_sections: [{ section_type: 'passive', section_attributes: [{ important_properties: ['DotHealthPercent'] }] }] }];
  corruption.setLabels(corruption.fromApi(api, 'enhanced'), 'enhanced');
  assert.deepStrictEqual(corruption.bonusLines('Toxic Bullets', 'enhanced'), ['Bleed Damage 1.9% → 2.6%']);
});
