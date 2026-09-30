// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/xp');
const L = require('../src/utils/lockle');

const item = (n) => ({ name: `Item ${n}`, slot: 'weapon', tier: 1, image: 'x', time: n * 60, sold: 0 });
const build = { matchId: 1, hero: 'kelvin', souls: 30000, duration: 1800, items: Array.from({ length: 14 }, (_, i) => item(i)) };
const now = new Date('2026-09-28T12:00:00Z');

test('toBuild keeps shop items in buy order and skips short builds or unknown heroes', () => {
  const assets = { items: new Map([[7, { name: 'Healbane', item_slot_type: 'vitality', item_tier: 2, image: 'u' }]]), heroes: new Map([[12, 'kelvin']]) };
  const player = (heroId, count) => ({ hero_id: heroId, net_worth: 5, items: [{ item_id: 99, game_time_s: 1 }, ...Array.from({ length: count }, (_, i) => ({ item_id: 7, game_time_s: i, sold_time_s: 0 }))] });
  const b = L.toBuild({ match_id: 3, duration_s: 9 }, player(12, L.MIN_ITEMS), assets);
  assert.strictEqual(b.hero, 'kelvin');
  assert.strictEqual(b.items.length, L.MIN_ITEMS); // item 99 (an ability) is dropped
  assert.strictEqual(L.toBuild({ match_id: 3 }, player(12, L.MIN_ITEMS - 1), assets), null);
  assert.strictEqual(L.toBuild({ match_id: 3 }, player(55, L.MIN_ITEMS), assets), null);
});

test('daily: same build for everyone, pays by guess once, survives a restart, no replays', async () => {
  await getStore('lockle').set('daily', { day: '2026-09-28', build });
  const game = await L.startDaily('a', now);
  assert.deepStrictEqual(game.guesses, []);
  assert.strictEqual((await L.guess('daily', 'a', 'abrams', now)).game.over, false);
  assert.ok((await L.guess('daily', 'a', 'abrams', now)).game.guesses.length === 1); // same hero twice doesn't cost a guess
  const won = (await L.guess('daily', 'a', 'kelvin', now)).game;
  assert.ok(won.won && won.over);
  assert.strictEqual(won.souls, L.DAILY_PAY[1]);
  await L.guess('daily', 'a', 'kelvin', now); // a double pick pays nothing more
  assert.strictEqual((await getUser('a')).souls, 170);
  const again = await L.startDaily('a', now); // "restart": comes back from the file, still over
  assert.ok(again.over && again.won);
  assert.strictEqual((await L.guess('daily', 'b', 'kelvin', now)).reply, 'Run `/lockle daily` first.');
  assert.match((await L.guess('daily', 'a', 'kelvin', new Date('2026-09-29T00:00:01Z'))).reply, /yesterday/);
});

test('daily: 6 wrong guesses lose, no souls', async () => {
  await L.startDaily('c', now);
  let last;
  for (const s of ['abrams', 'bebop', 'billy', 'calico', 'celeste', 'dynamo']) last = (await L.guess('daily', 'c', s, now)).game;
  assert.ok(last.over && !last.won);
  assert.strictEqual((await getUser('c')).souls, 0);
});
