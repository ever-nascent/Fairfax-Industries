// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadImage } = require('@napi-rs/canvas');
const { HEROES, heroArt } = require('../src/utils/heroes');
const { renderRankCard } = require('../src/utils/rankCard');
const { MENUS } = require('../src/utils/shop');

const ASSETS = path.join(__dirname, '..', 'assets');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('hero list matches setup.py and the hero icons', () => {
  const setupNames = fs.readFileSync(path.join(__dirname, '..', 'setup.py'), 'utf8').match(/HEROES = \[([\s\S]*?)\]/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual(HEROES.map((h) => h.name), setupNames);
  const icons = fs.readdirSync(path.join(ASSETS, 'heroes')).map((f) => f.replace('.png', '')).sort();
  assert.deepStrictEqual(HEROES.map((h) => h.slug).sort(), icons);
  assert.strictEqual(HEROES.length, 38);
});

test('shop dropdowns hold every hero, 25 max each', () => {
  assert.deepStrictEqual(MENUS.flat(), HEROES);
  for (const menu of MENUS) assert.ok(menu.length <= 25);
});

test('every hero has a colour and renders a card', async () => {
  const card = { name: 'Test', level: 12, into: 420, need: 1420, souls: 3650, maxLevel: 99 };
  for (const h of HEROES) {
    const art = await heroArt(h.slug);
    assert.match(art.color, /^#[0-9a-f]{6}$/, h.slug);
    assert.ok((await renderRankCard({ ...card, hero: art })).subarray(0, 4).equals(PNG), h.slug);
  }
  // Full-render layout (any tall image stands in for a hero render).
  const image = await loadImage(path.join(ASSETS, 'card', 'soul_urn_render.png'));
  assert.ok((await renderRankCard({ ...card, hero: { image, isRender: true, color: '#20a8b8' } })).subarray(0, 4).equals(PNG));
});
