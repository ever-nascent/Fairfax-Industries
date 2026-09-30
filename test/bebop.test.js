// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { changeSouls, getUser } = require('../src/utils/xp');
const bb = require('../src/utils/bebop');

const BOMBS = [0, 1, 2, 3]; // the whole top-left corner row, so tiles 4-19 are safe
const tile = (payload, i) => payload.components[Math.floor(i / 5)].components[i % 5].data;

test('the prize: 95% of the fair odds, rounded down', () => {
  assert.deepStrictEqual([1, 2, 3].map(bb.multiplier), [1.18, 1.5, 1.93]);
  assert.strictEqual(bb.multiplier(bb.TILES - bb.BOMBS), 4602.75); // the whole board
  assert.strictEqual(bb.prizeFor(100, 2), 150);
  const bombs = bb.placeBombs();
  assert.strictEqual(new Set(bombs).size, bb.BOMBS);
  assert.ok(bombs.every((b) => b >= 0 && b < bb.TILES));
});

test('a game: safe picks raise the prize, cash out pays once, only the owner plays', async () => {
  const user = { id: 'bebop-player' };
  await getStore('xp').delete(user.id);
  assert.ok((await bb.startGame(user, 'Tester', 100)).error); // can't afford it
  await changeSouls(user.id, 1000);
  const start = await bb.startGame(user, 'Tester', 100, BOMBS);
  assert.strictEqual((await getUser(user.id)).souls, 900);
  assert.strictEqual(start.components.length, 5); // 4 rows of tiles + Cash Out
  assert.strictEqual(tile(start, 7).custom_id.split(':')[2], '7');
  assert.ok(start.components[4].components[0].data.disabled); // nothing to cash out yet
  const id = tile(start, 0).custom_id.split(':')[1];

  assert.ok((await bb.move(id, 'someone-else', '5')).error);
  const one = await bb.move(id, user.id, '5');
  assert.strictEqual(tile(one, 5).style, 3); // green, disabled
  assert.ok(tile(one, 5).disabled);
  assert.strictEqual(await bb.move(id, user.id, '5'), null); // already picked
  await bb.move(id, user.id, '6');
  const cash = await bb.move(id, user.id, 'cash');
  assert.match(cash.embeds[0].toJSON().description, /You win/);
  assert.match(cash.embeds[0].toJSON().thumbnail.url, /_injured\.png$/);
  assert.strictEqual((await getUser(user.id)).souls, 900 + 150);
  assert.strictEqual(await bb.move(id, user.id, 'cash'), null); // double click pays nothing
  assert.strictEqual(cash.components[4].components[0].data.custom_id, `${bb.AGAIN_ID}:100:${user.id}`);
});

test('a bomb loses the bet and shows the board', async () => {
  const user = { id: 'bebop-loser' };
  await getStore('xp').delete(user.id);
  await changeSouls(user.id, 100);
  const start = await bb.startGame(user, 'Tester', 100, BOMBS);
  const id = tile(start, 0).custom_id.split(':')[1];
  await bb.move(id, user.id, '10');
  const boom = await bb.move(id, user.id, '2');
  assert.match(boom.embeds[0].toJSON().description, /Sticky Bomb/);
  assert.match(boom.embeds[0].toJSON().thumbnail.url, /_gloat\.png$/);
  assert.strictEqual(tile(boom, 2).style, 4); // red: the one they hit
  assert.ok([0, 1, 3].every((i) => tile(boom, i).disabled && tile(boom, i).emoji));
  assert.strictEqual((await getUser(user.id)).souls, 0);
  assert.strictEqual(await bb.games().get(id), null);
});

test('clearing every safe tile cashes out for them', async () => {
  const user = { id: 'bebop-sweeper' };
  await getStore('xp').delete(user.id);
  await changeSouls(user.id, 10);
  const start = await bb.startGame(user, 'Tester', 10, BOMBS);
  const id = tile(start, 0).custom_id.split(':')[1];
  let last;
  for (let i = 4; i < bb.TILES; i++) last = await bb.move(id, user.id, String(i));
  assert.match(last.embeds[0].toJSON().description, /cleared the whole board/);
  assert.strictEqual((await getUser(user.id)).souls, bb.prizeFor(10, 16));
});
