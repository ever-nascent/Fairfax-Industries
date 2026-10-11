// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { getStore } = require('../src/storage');
const { SCALE, migrate, moveToHeroes } = require('../src/utils/economy');

test('raising the souls scale grows balances and hero progress once, after a backup', async () => {
  await getStore('xp').set('m1', { xp: 5, souls: 123 });
  await getStore('xp').set('m2', { xp: 1, souls: 0 });
  await getStore('farm').set('m1', { hero: 'Haze', earned: 40 });
  await getStore('farm').set('m2', { hero: 'Haze', heroes: { Haze: { earned: 7 }, Abrams: { earned: 3 } } });
  assert.strictEqual(await migrate(), true);
  assert.deepStrictEqual((await getStore('farm').get('m2')).heroes, { Haze: { earned: 7 * SCALE }, Abrams: { earned: 3 * SCALE } });
  assert.strictEqual((await getStore('xp').get('m1')).souls, 123 * SCALE);
  assert.strictEqual((await getStore('xp').get('m2')).souls, 0);
  assert.strictEqual((await getStore('farm').get('m1')).earned, 40 * SCALE);
  assert.strictEqual((await getStore('xp').get('m1')).xp, 5, 'only souls change');
  const backups = fs.readdirSync(path.join(process.env.DATA_DIR, 'economy-backup'));
  assert.ok(backups.some((f) => f.endsWith('xp.json')) && backups.some((f) => f.endsWith('farm.json')));
  assert.strictEqual(await migrate(), false, 'a second start changes nothing');
  assert.strictEqual((await getStore('xp').get('m1')).souls, 123 * SCALE);
});

test('a fresh server (no data yet) just records the scale', async () => {
  const before = await getStore('economy').get('scale');
  assert.strictEqual(before, SCALE);
});

test('once (Oct 11): the server balance, buffs, Rejuvs, growth and cooldowns go to Haze, or the current hero without Haze', async () => {
  const { history } = require('../src/utils/soulsLedger');
  const { getFarmUser } = require('../src/utils/farm/play');
  const xp = getStore('xp');
  const farm = getStore('farm');
  await xp.set('h1', { xp: 5, souls: 5000 });
  await farm.set('h1', { hero: 'Abrams', heroes: { Haze: { earned: 900, tiers: {}, items: {} }, Abrams: { earned: 10, tiers: {}, items: {} } }, buffs: { fireRate: 3 }, rejuvs: 2, clears: { guardian: 4 }, cooldowns: { roam: 9 }, bestWave: 6, tokens: 1 });
  await xp.set('h2', { xp: 5, souls: 300 });
  await farm.set('h2', { hero: 'Abrams', heroes: { Abrams: { earned: 10, tiers: {}, items: {} } }, rejuvs: 1 });
  await xp.set('h3', { xp: 5, souls: 99 });
  await farm.set('h3', { hero: null, heroes: {} }); // opened /base, never picked
  await xp.set('h4', { xp: 5, souls: 77 }); // never farmed
  assert.strictEqual(await moveToHeroes(), true);
  const raw = await farm.get('h1');
  assert.deepStrictEqual(raw.heroes.Haze, { souls: 5000, earned: 900, tiers: {}, items: { weapon: [], vitality: [], spirit: [] }, cooldowns: { roam: 9 }, clears: { guardian: 4 }, rejuvs: 2, buffs: { fireRate: 3 } });
  assert.deepStrictEqual([raw.hero, raw.heroes.Abrams.souls, raw.heroes.Abrams.rejuvs, raw.bestWave, raw.tokens], ['Abrams', undefined, undefined, 6, 1], 'Abrams starts empty; the best wave and tokens stay the member\'s');
  for (const k of ['buffs', 'rejuvs', 'clears', 'cooldowns']) assert.ok(!(k in raw), `${k} is no longer on the member`);
  assert.strictEqual((await xp.get('h1')).souls, 0);
  assert.deepStrictEqual(history('h1', 5).map((e) => [e.r, e.d, e.b, e.h]), [['farm-move', 5000, 5000, 'Haze'], ['farm-move', -5000, 0, undefined]], 'both sides are in the ledger');
  assert.deepStrictEqual([(await getFarmUser('h2')).souls, (await getFarmUser('h2')).rejuvs, (await xp.get('h2')).souls], [300, 1, 0], 'no Haze: the current hero');
  assert.deepStrictEqual([(await xp.get('h3')).souls, (await xp.get('h4')).souls], [99, 77], 'no hero, nothing moves');
  assert.ok(fs.readdirSync(path.join(process.env.DATA_DIR, 'economy-backup')).some((f) => f.endsWith('-hero-souls-xp.json')));
  await xp.update('h1', (u) => ({ ...u, souls: 40 }));
  assert.strictEqual(await moveToHeroes(), false, 'a second start changes nothing');
  assert.deepStrictEqual([(await xp.get('h1')).souls, (await farm.get('h1')).heroes.Haze.souls], [40, 5000]);
});
