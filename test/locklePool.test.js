// Run: node --test. Lockle when deadlock-api.com is down, the hidden match number, and the practice cap.
// The API is faked (global fetch); throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const L = require('../src/utils/lockle');

const ITEMS = [{ id: 7, type: 'upgrade', shopable: true, name: 'Healbane', shop_image: 'u', cost: 1600, description: 'far more than a build needs' }];
const HEROES = [{ id: 12, name: 'Kelvin' }];
const MATCHES = [{
  match_id: 99, duration_s: 1800, extra: 'x'.repeat(500),
  players: [{ hero_id: 12, net_worth: 30000, player_rank_initial_display_rank: 104, account_id: 5, items: Array.from({ length: L.MIN_ITEMS }, (_, i) => ({ item_id: 7, game_time_s: i * 60, sold_time_s: 0, flags: 1 })) }],
}];
const realFetch = global.fetch;
let calls = 0;
const api = (up) => {
  global.fetch = async (url) => {
    calls++;
    if (!up) throw new Error('connect ETIMEDOUT');
    const body = url.includes('/assets/items') ? ITEMS : url.includes('/assets/heroes') ? HEROES : MATCHES;
    return { ok: true, json: async () => body };
  };
};
const quiet = async (run) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await run(); } finally { console.warn = warn; }
};
test.after(() => { global.fetch = realFetch; });

test('a good download is saved, slimmed to what a build needs', async () => {
  api(true);
  L.forget();
  const build = await L.randomBuild();
  assert.strictEqual(build.hero, 'kelvin');
  const saved = getStore('locklePool');
  const [match] = await saved.get('matches');
  assert.deepStrictEqual(Object.keys(match), ['match_id', 'duration_s', 'players']);
  assert.deepStrictEqual(Object.keys(match.players[0].items[0]), ['item_id', 'game_time_s', 'sold_time_s']);
  assert.deepStrictEqual((await saved.get('assets')).items[0], [7, { name: 'Healbane', shop_image: 'u', cost: 1600 }]);
});

test('with the API down after a restart, the saved copy still makes a build, and the API is left alone for a while', async () => {
  api(false);
  L.forget(); // "restart": nothing in memory
  const build = await quiet(() => L.randomBuild());
  assert.strictEqual(build.matchId, 99);
  assert.strictEqual(build.items.length, L.MIN_ITEMS);
  const before = calls;
  await quiet(() => L.randomBuild());
  assert.strictEqual(calls, before); // no second wait on a dead API
});

test('with the API down and nothing saved, starting a game fails (the command says try again)', async () => {
  api(false);
  L.forget();
  await getStore('locklePool').delete('matches');
  await getStore('locklePool').delete('assets');
  await assert.rejects(quiet(() => L.randomBuild()));
});

test('the match number is hidden until the game is over', async () => {
  const item = (n) => ({ name: `Item ${n}`, art: 'x', cost: 800, time: n * 60, sold: 0 });
  const build = { matchId: 424242, hero: 'kelvin', rank: 104, souls: 30000, duration: 1800, items: Array.from({ length: 14 }, (_, i) => item(i)) };
  const guild = { emojis: { cache: { find: () => undefined, get: () => undefined } } };
  const quietErrors = console.error;
  console.error = () => {}; // the fake items have no art to download
  api(false);
  const open = await L.view({ id: 'p1', userId: 'u', build, guesses: [], over: false, won: false }, guild);
  const done = await L.view({ id: 'p1', userId: 'u', build, guesses: ['kelvin'], over: true, won: true }, guild);
  console.error = quietErrors;
  assert.ok(!JSON.stringify(open.embeds[0].toJSON()).includes('424242'));
  assert.match(done.embeds[0].toJSON().footer.text, /Match 424242/);
});

test('practice games in memory are capped: the oldest is dropped', async () => {
  api(true);
  L.forget();
  L.practice.clear();
  const first = await L.startPractice('u');
  for (let i = 0; i < L.MAX_PRACTICE; i++) await L.startPractice('u');
  assert.strictEqual(L.practice.size, L.MAX_PRACTICE);
  assert.ok(!L.practice.has(first.id));
});
