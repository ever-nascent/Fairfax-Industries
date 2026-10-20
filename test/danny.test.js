// Run: node --test. Danny's Drop Zone, Deadman Danny's Connect Four. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/xp');
const { expireGames } = require('../src/utils/casino');
const danny = require('../src/utils/danny');

const { games, startGame, play, dropAt, newBoard, drop, landing, fourAt, bestMove, place, COLS, ROWS } = danny;
const BET = 100;
const START = 1000;
const fund = (id) => getStore('xp').set(id, { xp: 0, level: 0, souls: START });
const souls = async (id) => (await getUser(id)).souls;
const idOf = (message) => message.components[0].components[0].data.custom_id.split(':')[1];
const text = (message) => message.embeds[0].toJSON().description;
const buttons = (message) => message.components.flatMap((r) => r.components.map((b) => b.data.custom_id.split(':')[2]));
const opponent = (id) => ({ id, bot: false, username: id });
const board = (moves) => moves.reduce((b, [col, piece]) => drop(b, col, piece), newBoard());
async function timeOut() {
  const edits = [];
  for (const id of Object.keys(await games().all())) await games().update(id, (g) => ({ ...g, at: 0, channelId: 'c', messageId: 'm' }));
  await expireGames({ channels: { fetch: async () => ({ messages: { edit: async (_id, payload) => edits.push(payload) } }) } }, [danny]);
  assert.deepStrictEqual(await games().all(), {});
  return edits;
}

test('four in a row: across, up, both diagonals; three is not enough', () => {
  let b = board([[0, 'r'], [1, 'r'], [2, 'r']]);
  assert.ok(!fourAt(b, 2, 0));
  b = drop(b, 3, 'r');
  assert.ok(fourAt(b, 3, 0));
  b = board([[5, 'y'], [5, 'y'], [5, 'y'], [5, 'y']]);
  assert.ok(fourAt(b, 5, 3));
  // rising diagonal from column 0
  b = board([[0, 'r'], [1, 'y'], [1, 'r'], [2, 'y'], [2, 'y'], [2, 'r'], [3, 'y'], [3, 'y'], [3, 'y'], [3, 'r']]);
  assert.ok(fourAt(b, 3, 3));
  // falling diagonal ending in column 6
  b = board([[6, 'r'], [5, 'y'], [5, 'r'], [4, 'y'], [4, 'y'], [4, 'r'], [3, 'y'], [3, 'y'], [3, 'y'], [3, 'r']]);
  assert.ok(fourAt(b, 3, 3));
  assert.strictEqual(landing(board([[2, 'r'], [2, 'y'], [2, 'r'], [2, 'y'], [2, 'r'], [2, 'y']]), 2), -1); // full column
});

test('Danny takes a win, blocks yours, and opens in the middle', () => {
  assert.strictEqual(bestMove(board([[0, 'y'], [6, 'r'], [0, 'y'], [6, 'r'], [0, 'y'], [5, 'r']])), 0); // his own four
  assert.strictEqual(bestMove(board([[1, 'r'], [0, 'y'], [2, 'r'], [6, 'y'], [3, 'r']])), 4); // blocks three across
  assert.strictEqual(bestMove(board([[0, 'r'], [5, 'y'], [0, 'r'], [6, 'y'], [0, 'r']])), 0); // blocks three up
  assert.strictEqual(bestMove(board([[3, 'r']])), 3);
});

test('against Danny: he answers in the same click, a win pays 2x, a loss nothing, only the player moves', async () => {
  const user = { id: 'drop-solo' };
  assert.ok((await startGame(user, 'Solo', BET)).error); // can't afford it
  await fund(user.id);
  const start = await startGame(user, 'Solo', BET);
  assert.strictEqual(await souls(user.id), START - BET);
  assert.deepStrictEqual(buttons(start), ['0', '1', '2', '3', '4', '5', '6']);
  let id = idOf(start);
  assert.ok((await dropAt(id, 'someone-else', 0)).error);
  for (let i = 0; i < 3; i++) await dropAt(id, user.id, 0, () => 6); // Danny stacks column 7
  assert.match(text(await dropAt(id, user.id, 0, () => 6)), /Four in a row! You win/);
  assert.strictEqual(await souls(user.id), START - BET + BET * 2);
  assert.deepStrictEqual(await games().all(), {});

  id = idOf(await startGame(user, 'Solo', BET));
  for (let i = 0; i < 3; i++) await dropAt(id, user.id, i, () => 6);
  const lost = await dropAt(id, user.id, 5, () => 6); // his fourth in column 7
  assert.match(text(lost), /Danny gets four in a row/);
  assert.strictEqual(await souls(user.id), START + BET - BET);
});

test('a full board with no four is a draw and gives the bet back', async () => {
  // rows of r r y y r r y (A) and y y r r y y r (B) in this order have no four anywhere
  const A = 'rryyrry', B = 'yyrryyr';
  const rows = [B, B, A, B, A, A];
  let full = rows.join('');
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) assert.ok(!fourAt(full, col, row));
  const last = full.lastIndexOf('y');
  const before = full.slice(0, last) + '.' + full.slice(last + 1);
  const game = place({ board: before, version: 0 }, last % COLS, 'y');
  assert.deepStrictEqual([game.done, game.winner], [true, null]);

  const user = { id: 'drop-draw' };
  await fund(user.id);
  const id = idOf(await startGame(user, 'Draw', BET));
  // one red move from full
  const lastR = full.lastIndexOf('r');
  await games().update(id, (g) => ({ ...g, board: full.slice(0, lastR) + '.' + full.slice(lastR + 1), turn: 'r' }));
  const result = await dropAt(id, user.id, lastR % COLS);
  assert.match(text(result), /A draw/);
  assert.strictEqual(await souls(user.id), START);
});

test('against a member: accept stakes the bet, turns alternate, the winner takes the pot', async () => {
  const [a, b] = [{ id: 'drop-a' }, { id: 'drop-b' }];
  await fund(a.id);
  await fund(b.id);
  assert.ok((await startGame(a, 'A', BET, a)).error); // not yourself
  assert.ok((await startGame(a, 'A', BET, { ...opponent('bot'), bot: true })).error);
  let id = idOf(await startGame(a, 'A', BET, opponent(b.id)));
  assert.ok((await play(id, a.id, ['accept'])).error); // only the challenged answers
  assert.deepStrictEqual(buttons(await play(id, b.id, ['accept'])), ['0', '1', '2', '3', '4', '5', '6']);
  assert.strictEqual(await souls(b.id), START - BET);
  assert.ok((await play(id, b.id, ['3'])).error); // red (the challenger) goes first
  for (let i = 0; i < 3; i++) {
    await play(id, a.id, ['0']);
    assert.ok((await play(id, a.id, ['0'])).error); // not your turn
    await play(id, b.id, ['6']);
  }
  const view = await play(id, a.id, ['0']);
  assert.match(text(view), new RegExp(`<@${a.id}> wins`));
  assert.strictEqual(await souls(a.id), START + BET);
  assert.strictEqual(await souls(b.id), START - BET);

  id = idOf(await startGame(a, 'A', BET, opponent(b.id))); // declined: the bet goes back
  await play(id, b.id, ['decline']);
  assert.strictEqual(await souls(a.id), START + BET);
});

test('time limit: before a move everything goes back; after one, whoever had to move forfeits', async () => {
  const [a, b] = [{ id: 'drop-ta' }, { id: 'drop-tb' }];
  await fund(a.id);
  await fund(b.id);
  await startGame(a, 'A', BET); // no move made
  let [edit] = await timeOut();
  assert.doesNotMatch(text(edit), /Time ran out/);
  assert.strictEqual(await souls(a.id), START);

  const id1 = idOf(await startGame(a, 'A', BET));
  await dropAt(id1, a.id, 3, () => 3);
  [edit] = await timeOut();
  assert.match(text(edit), /Time ran out, so the game was finished/);
  assert.strictEqual(await souls(a.id), START - BET);

  await fund(a.id);
  const id2 = idOf(await startGame(a, 'A', BET, opponent(b.id)));
  await play(id2, b.id, ['accept']);
  await play(id2, a.id, ['3']); // now b stalls
  [edit] = await timeOut();
  assert.match(text(edit), new RegExp(`<@${b.id}> ran out of time`));
  assert.strictEqual(await souls(a.id), START + BET);
  assert.strictEqual(await souls(b.id), START - BET);

  await fund(a.id);
  await fund(b.id);
  const id3 = idOf(await startGame(a, 'A', BET, opponent(b.id))); // accepted, no move: both refunded
  await play(id3, b.id, ['accept']);
  [edit] = await timeOut();
  assert.match(text(edit), /never made the first move/);
  assert.strictEqual(await souls(a.id), START);
  assert.strictEqual(await souls(b.id), START);
});
