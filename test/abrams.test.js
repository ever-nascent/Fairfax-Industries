// Run: node --test. Abrams' Interrogation: the question data, a solo case, a duel, timeouts and the odds.
// Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/xp');
const { expireGames } = require('../src/utils/casino');
const { HEROES } = require('../src/utils/heroes');
const { QUESTIONS, ANSWERS, answer } = require('../src/utils/abramsCase');
const abrams = require('../src/utils/abrams');

const START = 100_000;
const BET = 1000;
const fund = (id) => getStore('xp').set(id, { xp: 0, level: 0, souls: START });
const souls = async (id) => (await getUser(id)).souls;
const idOf = (payload) => payload.components[0].components[0].data.custom_id.split(':')[1];
const first = (n) => 0 * n; // a "random" int that always picks the first: Abrams (the first hero) is the culprit

test('every hero has an answer to every question, and no two heroes answer alike', () => {
  assert.ok(QUESTIONS.length >= 25, 'at least 25 questions (his call)');
  assert.deepStrictEqual(Object.keys(ANSWERS).sort(), HEROES.map((h) => h.name).sort());
  for (const [hero, row] of Object.entries(ANSWERS)) assert.match(row, new RegExp(`^[YN]{${QUESTIONS.length}}$`), hero);
  const seen = new Map();
  for (const [hero, row] of Object.entries(ANSWERS)) {
    assert.ok(!seen.has(row), `${hero} and ${seen.get(row)} answer every question the same`);
    seen.set(row, hero);
  }
  for (const q of QUESTIONS) assert.ok(q.label.length <= 100 && !q.label.includes('*'), q.label);
});

test('a hand only holds questions that still rule someone out', () => {
  const suspects = ['Paradox', 'Seven', 'Haze'];
  for (const q of abrams.useful(suspects)) {
    const yes = suspects.filter((h) => answer(h, q)).length;
    assert.ok(yes > 0 && yes < suspects.length);
  }
  assert.deepStrictEqual(abrams.useful(['Seven']), []);
});

test('solo: each question crosses off the right suspects; a right accusation pays by questions asked', async () => {
  await fund('s1');
  const id = idOf(await abrams.startGame({ id: 's1' }, 'Tester', BET, null, first));
  let game = await abrams.games().get(id);
  assert.strictEqual(game.culprit, 'Abrams');
  assert.strictEqual(await souls('s1'), START - BET);
  const q = game.hunts.s1.hand[0];
  assert.deepStrictEqual(await abrams.play(id, 'x', ['ask', String(q)]), { error: "That's Tester's case. Start your own with `/mini-game`." });
  await abrams.play(id, 's1', ['ask', String(q)]);
  game = await abrams.games().get(id);
  assert.ok(game.hunts.s1.suspects.every((h) => answer(h, q) === answer('Abrams', q)));
  assert.ok(game.hunts.s1.suspects.includes('Abrams'));
  assert.strictEqual(await abrams.play(id, 's1', ['ask', String(q)]), null, 'an old dropdown does nothing');
  await abrams.play(id, 's1', ['accuse']);
  const end = await abrams.play(id, 's1', ['name', '0', 'Abrams']);
  assert.match(end.embeds[0].toJSON().description, /Case closed\. It was Abrams\./);
  assert.strictEqual(await souls('s1'), START - BET + abrams.winnings(BET, 1));
  assert.ok(!(await abrams.games().get(id)), 'the case is closed');
});

test('solo: a wrong name loses the bet; after MAX_QUESTIONS only an accusation is left', async () => {
  await fund('s2');
  const id = idOf(await abrams.startGame({ id: 's2' }, 'Tester', BET, null, first));
  for (let i = 0; i < abrams.MAX_QUESTIONS; i++) {
    const g = await abrams.games().get(id);
    if (!g.hunts.s2.hand.length) break;
    await abrams.play(id, 's2', ['ask', String(g.hunts.s2.hand[0])]);
  }
  const game = await abrams.games().get(id);
  if (game.hunts.s2.asked.length === abrams.MAX_QUESTIONS) {
    assert.strictEqual(game.mode, 'accuse');
    assert.strictEqual(await abrams.play(id, 's2', ['back']), null, 'no going back once the questions are spent');
  } else await abrams.play(id, 's2', ['accuse']);
  const wrong = (await abrams.games().get(id)).hunts.s2.suspects.find((h) => h !== 'Abrams');
  if (!wrong) return; // narrowed to Abrams alone: nobody wrong left to accuse
  const end = await abrams.play(id, 's2', ['name', '0', wrong]);
  assert.match(end.embeds[0].toJSON().description, new RegExp(`You accused ${wrong}\\. It was Abrams\\.`));
  assert.strictEqual(await souls('s2'), START - BET);
});

test('duel: both stake, secrets are private, turns alternate, a wrong accusation hands over the pot', async () => {
  await fund('d1');
  await fund('d2');
  const id = idOf(await abrams.startGame({ id: 'd1' }, 'One', BET, { id: 'd2', username: 'Two' }));
  assert.deepStrictEqual(await abrams.play(id, 'd1', ['accept']), { error: 'Wait for Two to answer.' });
  await abrams.play(id, 'd2', ['accept']);
  assert.strictEqual(await souls('d2'), START - BET);
  const pick = await abrams.play(id, 'd1', ['pick', '0', 'Seven']);
  assert.match(pick.private, /Your secret hero is \*\*Seven\*\*/);
  assert.doesNotMatch(JSON.stringify(pick.update.embeds), /Seven/, 'the secret stays out of the public message');
  await abrams.play(id, 'd2', ['pick', '1', 'Paige']);
  let game = await abrams.games().get(id);
  assert.strictEqual(game.turn, 'd1');
  assert.deepStrictEqual(await abrams.play(id, 'd2', ['accuse']), { error: "It's One's turn." });
  await abrams.play(id, 'd1', ['ask', String(game.hunts.d1.hand[0])]);
  game = await abrams.games().get(id);
  assert.strictEqual(game.turn, 'd2');
  assert.ok(game.hunts.d1.suspects.includes('Paige'), "One hunts Two's secret");
  await abrams.play(id, 'd2', ['accuse']);
  const end = await abrams.play(id, 'd2', ['name', '1', game.hunts.d2.suspects.find((h) => h !== 'Seven')]);
  assert.match(end.embeds[0].toJSON().description, /<@d1> takes the pot/);
  assert.strictEqual(await souls('d1'), START + BET);
  assert.strictEqual(await souls('d2'), START - BET);
});

// Makes every open case look 5 minutes old and in a message, runs the timeout sweep, returns the edits.
async function timeOut() {
  const edits = [];
  for (const id of Object.keys(await abrams.games().all())) await abrams.games().update(id, (g) => ({ ...g, at: 0, channelId: 'c', messageId: 'm' }));
  await expireGames({ channels: { fetch: async () => ({ messages: { edit: async (_id, payload) => edits.push(payload) } }) } }, [abrams]);
  assert.deepStrictEqual(await abrams.games().all(), {});
  return edits;
}

test('timeouts: no question asked = bet back; a question asked = the case goes cold; a duel forfeits whoever was up', async () => {
  await fund('t1');
  await abrams.startGame({ id: 't1' }, 'Tester', BET, null, first);
  await timeOut();
  assert.strictEqual(await souls('t1'), START);

  const id = idOf(await abrams.startGame({ id: 't1' }, 'Tester', BET, null, first));
  await abrams.play(id, 't1', ['ask', String((await abrams.games().get(id)).hunts.t1.hand[0])]);
  const [edit] = await timeOut();
  assert.match(edit.embeds[0].toJSON().description, /The case went cold\. It was Abrams\./);
  assert.strictEqual(await souls('t1'), START - BET);

  await fund('t2');
  await fund('t3');
  const d = idOf(await abrams.startGame({ id: 't2' }, 'One', BET, { id: 't3', username: 'Two' }));
  await abrams.play(d, 't3', ['accept']);
  await abrams.play(d, 't2', ['pick', '0', 'Haze']);
  await abrams.play(d, 't3', ['pick', '0', 'Abrams']);
  await timeOut(); // One's turn, never asked
  assert.strictEqual(await souls('t2'), START - BET);
  assert.strictEqual(await souls('t3'), START + BET);
});

test('odds: always asking the most even split returns under 100% (tools/interrogation-rtp.js has the full check)', () => {
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const int = (n) => Math.floor(rnd() * n);
  let back = 0;
  const GAMES = 3000;
  for (let i = 0; i < GAMES; i++) {
    const culprit = abrams.NAMES[int(abrams.NAMES.length)];
    let S = [...abrams.NAMES];
    let asked = 0;
    while (asked < abrams.MAX_QUESTIONS && S.length > 1) {
      const U = abrams.useful(S);
      const hand = [];
      while (hand.length < Math.min(abrams.HAND, U.length)) hand.push(U.splice(int(U.length), 1)[0]);
      const even = (q) => Math.abs(S.filter((h) => answer(h, q)).length - S.length / 2);
      const q = hand.reduce((a, b) => (even(b) < even(a) ? b : a));
      S = S.filter((h) => answer(h, q) === answer(culprit, q));
      asked++;
    }
    if (S[int(S.length)] === culprit) back += abrams.PAYOUT[asked];
  }
  const rtp = back / GAMES;
  assert.ok(rtp > 0.85 && rtp < 1, `returns ${(rtp * 100).toFixed(1)}%`);
});
