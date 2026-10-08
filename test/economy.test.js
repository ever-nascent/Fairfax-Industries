// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { getStore } = require('../src/storage');
const { SCALE, migrate } = require('../src/utils/economy');

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
