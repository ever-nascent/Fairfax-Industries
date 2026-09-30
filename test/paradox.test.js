// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { changeSouls, getUser } = require('../src/utils/xp');
const px = require('../src/utils/paradox');

const game = (hour, prize = 100) => ({ bet: 100, prize, hour, history: [[hour]], done: false, lost: false, version: 0 });
const to = (h) => () => h; // the hand lands on h

test('the hand never lands on the same hour twice, and every other hour can come up', () => {
  for (let hour = 1; hour <= 12; hour++) {
    const seen = new Set();
    for (let r = 0; r < 11; r++) seen.add(px.nextHour(hour, () => r));
    assert.strictEqual(seen.size, 11, `hour ${hour}`);
    assert.ok(!seen.has(hour));
  }
});

test('multipliers: fair odds minus a 5% cut; nothing to call at I or XII', () => {
  assert.strictEqual(px.multiplier(9, 'higher'), 3.48); // 3 of 11 hours are higher
  assert.strictEqual(px.multiplier(9, 'lower'), 1.3); // 8 of 11 are lower
  assert.strictEqual(px.multiplier(2, 'lower'), 10.45); // only I is lower
  for (let h = 2; h <= 11; h++) for (const c of ['higher', 'lower']) assert.ok(px.multiplier(h, c) > 1);
  assert.deepStrictEqual(px.moves(game(1)), ['spin']);
  assert.deepStrictEqual(px.moves(game(12)), ['spin']);
  assert.deepStrictEqual(px.moves(game(6)), ['higher', 'lower']); // no Cash Out before a right call
  assert.deepStrictEqual(px.moves(game(6, 150)), ['higher', 'lower', 'cash']);
});

test('right call grows the prize, wrong call ends it, spin changes nothing but the hour', () => {
  let g = px.play(game(9), 'higher', to(11));
  assert.strictEqual(g.prize, 348);
  assert.ok(!g.done);
  g = px.play(g, 'lower', to(12));
  assert.ok(g.done && g.lost);
  g = px.play(game(12, 150), 'spin', to(4));
  assert.deepStrictEqual([g.hour, g.prize, g.done], [4, 150, false]);
  g = px.play(game(4, 150), 'cash');
  assert.ok(g.done && !g.lost);
});

test('a full game with souls: bet, a right call, cash out once, only the owner plays', async () => {
  const user = { id: 'test-clock' };
  await getStore('xp').delete(user.id);
  assert.ok((await px.startGame(user, 'Tester', 5)).error);
  assert.ok((await px.startGame(user, 'Tester', 100)).error);
  await changeSouls(user.id, 1000);

  const start = await px.startGame(user, 'Tester', 100, 9);
  assert.strictEqual((await getUser(user.id)).souls, 900);
  assert.strictEqual(start.embeds[0].toJSON().author.icon_url, 'attachment://pulse_grenade.png');
  const id = start.components[0].components[0].data.custom_id.split(':')[1];
  assert.ok((await px.move(id, 'someone-else', 'lower')).error);
  assert.ok(await px.move(id, user.id, 'lower', to(3))); // 9 -> III, prize 130
  const [a, b] = await Promise.all([px.move(id, user.id, 'cash'), px.move(id, user.id, 'cash')]);
  const result = a ?? b;
  assert.ok(result && !(a && b)); // a double click pays once
  const embed = result.embeds[0].toJSON();
  assert.strictEqual(embed.thumbnail.url, 'attachment://paradox_injured.png');
  assert.ok(px.WIN_LINES.includes(embed.footer.text.slice(1, -1)));
  assert.strictEqual((await getUser(user.id)).souls, 900 + 130);
  assert.strictEqual(await px.games().get(id), null);
});

test('the clock animates as a GIF (spin, lose, cash out without a spin)', async () => {
  const long = { ...game(7, 999), history: Array.from({ length: 12 }, (_, i) => [(i % 12) + 1, i % 3 ? true : null]) };
  for (const [g, from] of [[game(9), 12], [{ ...game(11), lost: true, done: true }, 3], [long, null]]) {
    const gif = await px.renderClock(g, from);
    assert.strictEqual(gif.subarray(0, 6).toString(), 'GIF89a');
    assert.ok(gif.length < 8 * 1024 * 1024);
  }
});
