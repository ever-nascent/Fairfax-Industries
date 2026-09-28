// Run: node --test
// Uses a throwaway data folder so the bot's real XP is never touched.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { progress, xpToNext, soulsFor, addXp, claimUrn, getUser, MAX_LEVEL } = require('../src/utils/xp');
const { getStore } = require('../src/storage');

test('level curve', () => {
  assert.deepStrictEqual(progress(0), { level: 0, into: 0, need: 100 });
  assert.deepStrictEqual(progress(100), { level: 1, into: 0, need: 155 });
  assert.strictEqual(progress(4675).level, 10);
  assert.strictEqual(progress(1e12).level, MAX_LEVEL);
  assert.strictEqual(xpToNext(0), 100);
  assert.deepStrictEqual([soulsFor(1), soulsFor(10), soulsFor(99)], [25, 791, 24626]);
});

test('addXp pays souls per level and respects cooldown', async () => {
  const id = 'test-user-xp';
  await getStore('xp').delete(id);
  const r = await addXp(id, 255, { fromChat: true, cooldownSeconds: 60 }); // level 0 -> 2
  assert.deepStrictEqual(r.gained, [1, 2]);
  assert.strictEqual(r.souls, soulsFor(1) + soulsFor(2));
  assert.strictEqual(await addXp(id, 50, { fromChat: true, cooldownSeconds: 60 }), null); // on cooldown
  assert.strictEqual((await getUser(id)).xp, 255);
  await getStore('xp').delete(id);
});

test('urn streak grows, caps at 7 days, resets after a missed day', async () => {
  const id = 'test-user-urn';
  await getStore('xp').delete(id);
  const day = (n) => new Date(Date.UTC(2026, 0, n, 12));
  const got = [];
  for (let d = 1; d <= 9; d++) got.push((await claimUrn(id, day(d))).souls);
  assert.deepStrictEqual(got, [100, 120, 140, 160, 180, 200, 220, 220, 220]);
  assert.strictEqual((await claimUrn(id, day(9))).claimed, false); // twice in one day
  assert.strictEqual((await claimUrn(id, day(11))).souls, 100); // skipped day 10
  await getStore('xp').delete(id);
});
