// Run: node --test
// Rebirth (rebirth.js, his idea Oct 30): ranks from the highest /descend ascension a hero cleared after winning a siege; +2% a rank in fights.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
const test = require('./group')(__filename);
const assert = require('node:assert');
const D = require('../src/utils/farm/descent');
const { getFarmUser, chooseHero, updateFarmUser } = require('../src/utils/farm/play');
const { buildHero } = require('../src/utils/farm/hero');
const { rankOf, statMult, RANKS, rankText } = require('../src/utils/farm/rebirth');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
// Clears the run's last room with enemies that can't win (the clear itself is what is tested).
async function clearAt(id, ascension) {
  await D.startRun(id, 'Haze', 9, ascension);
  await updateFarmUser(id, (r) => { r.descent.room = D.LAST_ROOM; });
  const saved = { ...D.TUNE };
  Object.assign(D.TUNE, { health: 1e-4, dps: 0 });
  try { return (await D.fight(id, { rng: seeded(3) })).run; } finally { Object.assign(D.TUNE, saved); }
}
async function member(id, { sieged = true } = {}) {
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => { r.descentAscension = D.MAX_ASCENSION; r.sieged = sieged; });
}

test('ten ranks, Seeker at Ascension 11 to Eternus at 20, +2% each', () => {
  assert.strictEqual(RANKS.length, 10);
  assert.deepStrictEqual([0, 10, 11, 12, 20].map(rankOf), [0, 0, 1, 2, 10]);
  assert.strictEqual(RANKS[rankOf(20) - 1], 'Eternus');
  assert.strictEqual(statMult(10), 1.2);
  assert.strictEqual(rankText(null, 1), 'Seeker');
});

test('a reborn hero has 2% more health, weapon damage and spirit power per rank', () => {
  const [a, b] = [buildHero('Haze', { items: ['Extra Spirit'] }), buildHero('Haze', { items: ['Extra Spirit'], rebirth: 10 })];
  assert.ok(Math.abs(b.stats.maxHealth / a.stats.maxHealth - 1.2) < 1e-9);
  assert.ok(Math.abs(b.stats.weaponDamageMult / a.stats.weaponDamageMult - 1.2) < 1e-9);
  assert.ok(Math.abs(b.stats.spirit / a.stats.spirit - 1.2) < 1e-9);
});

test('a clear counts only after that hero won a siege, only above its best, and the rank follows the highest ascension', async () => {
  await member('rb1', { sieged: false });
  const locked = await clearAt('rb1', 11);
  assert.deepStrictEqual(locked.complete.reborn, { locked: true });
  assert.strictEqual(rankOf((await getFarmUser('rb1')).rebirth), 0);

  await updateFarmUser('rb1', (r) => { r.sieged = true; });
  assert.deepStrictEqual((await clearAt('rb1', 11)).complete.reborn, { from: 0, to: 1 }); // Seeker
  assert.strictEqual((await clearAt('rb1', 11)).complete.reborn, undefined); // the same ascension again: nothing
  assert.deepStrictEqual((await clearAt('rb1', 13)).complete.reborn, { from: 1, to: 3 }); // skipping ahead is fine
  assert.strictEqual((await clearAt('rb1', 12)).complete.reborn, undefined); // lower: nothing
  assert.strictEqual(rankOf((await getFarmUser('rb1')).rebirth), 3);
});

test('a first clear on Ascension 20 is Eternus at once, and the next run carries the bonus', async () => {
  await member('rb2');
  assert.deepStrictEqual((await clearAt('rb2', 20)).complete.reborn, { from: 0, to: 10 });
  await D.startRun('rb2', 'Haze', 1, 0);
  const d = await D.getRun('rb2');
  assert.strictEqual(d.rebirth, 10);
  assert.strictEqual(D.runKit(d).rebirth, 10);
});

test('Ascension 10 and below never count', async () => {
  await member('rb3');
  assert.strictEqual((await clearAt('rb3', 10)).complete.reborn, undefined);
  assert.strictEqual((await getFarmUser('rb3')).rebirth, 0);
});

test('the Descent Cleared screen and the hero screen show the rank', async () => {
  const dviews = require('../src/utils/farm/descentViews');
  const views = require('../src/utils/farm/views');
  const m = (id) => ({ id, guild: { emojis: { cache: { find: () => undefined } } }, toString: () => `<@${id}>` });
  await member('rb4');
  const run = await clearAt('rb4', 15);
  const fields = (await dviews.completeView(m('rb4'), run)).embeds[0].toJSON().fields;
  assert.match(fields.find((f) => f.name === 'Reborn').value, /Ritualist.*\+10%/);
  assert.match((await views.heroView(m('rb4'), await getFarmUser('rb4'))).embeds[0].toJSON().description, /Rebirth: Ritualist.*\+10%/);
});

test('the Descend leaderboard names the best run hero\'s rank', async () => {
  const dviews = require('../src/utils/farm/descentViews');
  await member('rb5');
  await clearAt('rb5', 12);
  const rows = (await D.leaderboard()).filter((r) => r.id === 'rb5');
  assert.strictEqual(rows[0].rebirth, 2);
  const m = { id: 'rb5', guild: { emojis: { cache: { find: () => undefined } } } };
  assert.match(dviews.leaderboardView(m, rows, await getFarmUser('rb5')).embeds[0].toJSON().description, /Haze {2}-  Acolyte/);
});
