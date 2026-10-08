// Run: node --test. A game nobody clicks for 5 minutes is finished for the player, not refunded (his call, Oct 5),
// unless nothing had been revealed yet. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/xp');
const { expireGames } = require('../src/utils/casino');
const { history } = require('../src/utils/soulsLedger');
const doorman = require('../src/utils/doorman');
const bj = require('../src/utils/blackjack');
const bebop = require('../src/utils/bebop');
const paradox = require('../src/utils/paradox');
const pocket = require('../src/utils/pocket');
const silver = require('../src/utils/silver');
const yamato = require('../src/utils/yamato');
const sinclair = require('../src/utils/sinclair');

const BET = 100;
const START = 1000;
const fund = (id) => getStore('xp').set(id, { xp: 0, level: 0, souls: START });
const souls = async (id) => (await getUser(id)).souls;
const idOf = (payload) => payload.components[0].components[0].data.custom_id.split(':')[1];
// Makes every open game of `game` look 5 minutes old and in a message, runs the timeout sweep, returns the edits.
async function timeOut(game) {
  const edits = [];
  for (const id of Object.keys(await game.games().all())) await game.games().update(id, (g) => ({ ...g, at: 0, channelId: 'c', messageId: 'm' }));
  await expireGames({ channels: { fetch: async () => ({ messages: { edit: async (_id, payload) => edits.push(payload) } }) } }, [game]);
  assert.deepStrictEqual(await game.games().all(), {});
  return edits;
}
const text = (edit) => edit.embeds[0].toJSON().description;
const FINISHED = /^\*\*Time ran out, so the game was finished\.\*\*/;

test('Blackjack: a timed-out hand stands (16 against 19 loses the bet, no refund)', async () => {
  const user = { id: 't-bj' };
  await fund(user.id);
  const deck = [...'2C 3C 4C 5C 6C 7C 2D 3D 4D'.split(' '), ...['10H', '10S', '6H', '9S'].reverse()]; // you 10 6, Wraith 10 9
  await bj.startGame(user, 'Tester', BET, deck);
  const [edit] = await timeOut(bj);
  assert.match(text(edit), FINISHED);
  assert.match(text(edit), /Wraith beats your 16/);
  assert.strictEqual(await souls(user.id), START - BET);
});

test('Guess the Door: before a pick the bet comes back; after the Doorman opens a room it is a Stay', async () => {
  const user = { id: 't-door' };
  await fund(user.id);
  await doorman.startGame(user, 'Tester', BET);
  let [edit] = await timeOut(doorman);
  assert.doesNotMatch(text(edit), FINISHED);
  assert.strictEqual(await souls(user.id), START);

  const id = idOf(await doorman.startGame(user, 'Tester', BET));
  await doorman.pickRoom(id, user.id, 0);
  const { prize } = await doorman.games().get(id);
  [edit] = await timeOut(doorman);
  assert.match(text(edit), FINISHED);
  assert.match(text(edit), /You stayed in Room/);
  assert.strictEqual(await souls(user.id), START - BET + (prize === 0 ? doorman.winnings(BET) : 0));
});

test("Bebop's Bombs and Borrowed Time: a banked prize is cashed out, with nothing banked the bet comes back", async () => {
  const user = { id: 't-bank' };
  await fund(user.id);
  let id = idOf(await bebop.startGame(user, 'Tester', BET, [0, 1, 2, 3]));
  await timeOut(bebop);
  assert.strictEqual(await souls(user.id), START); // no tile picked
  id = idOf(await bebop.startGame(user, 'Tester', BET, [0, 1, 2, 3]));
  await bebop.move(id, user.id, '4');
  let [edit] = await timeOut(bebop);
  assert.match(text(edit), FINISHED);
  assert.strictEqual(await souls(user.id), START - BET + bebop.prizeFor(BET, 1));

  await fund(user.id);
  await paradox.startGame(user, 'Tester', BET, 9);
  await timeOut(paradox);
  assert.strictEqual(await souls(user.id), START); // no call made
  id = idOf(await paradox.startGame(user, 'Tester', BET, 9));
  await paradox.move(id, user.id, 'lower', () => 3);
  const { prize } = await paradox.games().get(id);
  assert.ok(prize > BET);
  [edit] = await timeOut(paradox);
  assert.match(text(edit), /You cashed out/);
  assert.strictEqual(await souls(user.id), START - BET + prize);
});

test('Deal or No Deal: before a case is picked the bet comes back; after, the game ends on the kept case', async () => {
  const user = { id: 't-case' };
  await fund(user.id);
  await pocket.startGame(user, 'Tester', BET);
  await timeOut(pocket);
  assert.strictEqual(await souls(user.id), START);
  const id = idOf(await pocket.startGame(user, 'Tester', BET));
  await pocket.move(id, user.id, '0'); // keep case 1
  await pocket.move(id, user.id, '1'); // open one
  const { values } = await pocket.games().get(id);
  const [edit] = await timeOut(pocket);
  assert.match(text(edit), FINISHED);
  assert.strictEqual(await souls(user.id), START - BET + Math.floor(BET * values[0]));
});

test('Shotgun Roulette: once a shot is fired, whoever stalls forfeits (to Silver, or the pot to the other member)', async () => {
  const [a, b] = [{ id: 't-sr-a' }, { id: 't-sr-b' }];
  await fund(a.id);
  await fund(b.id);
  let id = idOf(await silver.startGame(a, 'A', BET));
  await silver.move(id, a.id, ['other']);
  const [edit] = await timeOut(silver);
  assert.match(text(edit), FINISHED);
  assert.match(text(edit), /ran out of time/);
  assert.strictEqual(await souls(a.id), START - BET);

  await fund(a.id);
  id = idOf(await silver.startGame(a, 'A', BET, { id: b.id, bot: false, username: 'B', displayName: 'B' }));
  await silver.move(id, b.id, ['accept']);
  const first = (await silver.games().get(id)).turn;
  await silver.move(id, first, ['other']); // the turn passes to the other one, who then stalls
  const staller = (await silver.games().get(id)).turn;
  assert.notStrictEqual(staller, first);
  await timeOut(silver);
  assert.strictEqual(await souls(first), START + BET);
  assert.strictEqual(await souls(staller), START - BET);
  assert.strictEqual(history(first, 1)[0].w, staller); // the ledger remembers who lost the pot
});

test('Duel of Stances: with one stance chosen the one who never drew forfeits; with none both get their bet back', async () => {
  const [a, b] = [{ id: 't-du-a' }, { id: 't-du-b' }];
  await fund(a.id);
  await fund(b.id);
  const opponent = { id: b.id, bot: false, username: 'B', displayName: 'B' };
  let id = idOf(await yamato.startGame(a, 'A', BET, opponent));
  await yamato.play(id, b.id, ['accept']);
  await timeOut(yamato);
  assert.deepStrictEqual([await souls(a.id), await souls(b.id)], [START, START]);

  id = idOf(await yamato.startGame(a, 'A', BET, opponent));
  await yamato.play(id, b.id, ['accept']);
  await yamato.play(id, b.id, ['power']);
  const [edit] = await timeOut(yamato);
  assert.match(text(edit), /never drew/);
  assert.deepStrictEqual([await souls(a.id), await souls(b.id)], [START - BET, START + BET]);
});

test('Rabbit in the Hat: nothing is revealed before the pick, so a timeout still gives the bet back', async () => {
  const user = { id: 't-hat' };
  await fund(user.id);
  await sinclair.startGame(user, 'Tester', BET);
  const [edit] = await timeOut(sinclair);
  assert.doesNotMatch(text(edit), FINISHED);
  assert.strictEqual(await souls(user.id), START);
});
