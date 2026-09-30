// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { changeSouls, getUser } = require('../src/utils/xp');
const rem = require('../src/utils/rem');

const text = (payload) => payload.embeds[0].toJSON().description;
const button = (payload, i) => payload.components[0].components[i].data;
const ODDS = [2.63, 3.65, 4.75, 8.63, 13.57];

test('odds: 95% / chance, rounded down', () => {
  assert.deepStrictEqual(rem.SHARES.map(rem.oddsFor), ODDS);
  assert.strictEqual(rem.prizeFor(100, 2.63), 263);
});

test('a race always ends with the chosen Remling alone at the finish', () => {
  for (let winner = 0; winner < 5; winner++) {
    const frames = rem.raceFor(winner);
    const last = frames[frames.length - 1];
    assert.deepStrictEqual(last.flatMap((p, i) => (p === rem.FINISH ? [i] : [])), [winner]);
    assert.ok(frames[0].every((p) => p === 0));
    assert.ok(frames.every((f, i) => i === 0 || f.every((p, k) => p >= frames[i - 1][k])));
  }
});

test('winners come up at the advertised chances', () => {
  const N = 20000;
  const wins = new Map();
  for (let i = 0; i < N; i++) {
    const race = rem.makeRace();
    assert.deepStrictEqual([...race.odds].sort((a, b) => a - b), ODDS);
    const odds = race.odds[race.winner];
    wins.set(odds, (wins.get(odds) ?? 0) + 1);
  }
  rem.SHARES.forEach((share) => {
    const seen = (wins.get(rem.oddsFor(share)) ?? 0) / N;
    assert.ok(Math.abs(seen - share / 100) < 0.03, `${share}% came up ${(seen * 100).toFixed(1)}%`);
  });
});

test('a game: pick once, only the owner plays, a win pays the odds', async () => {
  const user = { id: 'rem-winner' };
  await getStore('xp').delete(user.id);
  assert.ok((await rem.startGame(user, 'Tester', 100)).error); // can't afford it
  await changeSouls(user.id, 1000);
  const race = { odds: ODDS, winner: 2, frames: [[0, 0, 0, 0, 0], [1, 0, 2, 1, 0], [1, 1, 10, 2, 1]] };
  const start = await rem.startGame(user, 'Tester', 100, race);
  assert.strictEqual((await getUser(user.id)).souls, 900);
  assert.strictEqual(start.components[0].components.length, 5);
  assert.strictEqual(button(start, 2).label, '4.75×');
  const id = button(start, 0).custom_id.split(':')[1];

  assert.ok((await rem.pick(id, 'someone-else', 2)).error);
  assert.strictEqual(await rem.pick(id, user.id, 9), null); // no such lane
  const racing = await rem.pick(id, user.id, 2);
  assert.match(text(racing), /backs .* \*\*Green\*\* .* at \*\*4\.75×\*\*/);
  assert.strictEqual(racing.components.length, 0);
  assert.strictEqual(await rem.pick(id, user.id, 1), null); // already picked

  const edits = [];
  await rem.run(id, async (payload) => edits.push(payload), 0);
  assert.strictEqual(edits.length, 3); // 2 more frames, then the result
  assert.strictEqual(edits[0].files, undefined); // the pictures stay from the first one
  const end = edits[2];
  assert.match(text(end), /wins the race/);
  assert.match(text(end), /You win/);
  assert.match(end.embeds[0].toJSON().thumbnail.url, /_injured\.png$/);
  assert.strictEqual((await getUser(user.id)).souls, 900 + 475);
  assert.strictEqual(end.components[0].components[0].data.custom_id, `${rem.AGAIN_ID}:100:${user.id}`);
  await rem.run(id, async () => assert.fail('a finished race must not run again'), 0);
  assert.strictEqual((await getUser(user.id)).souls, 1375); // and pays nothing twice
});

test('a wrong pick loses the bet', async () => {
  const user = { id: 'rem-loser' };
  await getStore('xp').delete(user.id);
  await changeSouls(user.id, 100);
  const race = { odds: ODDS, winner: 0, frames: [[0, 0, 0, 0, 0], [10, 3, 2, 1, 0]] };
  const start = await rem.startGame(user, 'Tester', 100, race);
  const id = button(start, 0).custom_id.split(':')[1];
  await rem.pick(id, user.id, 3);
  const edits = [];
  await rem.run(id, async (payload) => edits.push(payload), 0);
  const end = edits[1];
  assert.match(text(end), /You lose/);
  assert.match(end.embeds[0].toJSON().thumbnail.url, /_gloat\.png$/);
  assert.strictEqual((await getUser(user.id)).souls, 0);
  assert.strictEqual(await rem.games().get(id), null);
});
