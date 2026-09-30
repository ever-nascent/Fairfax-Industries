// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { expireGames, TIME_LIMIT_MINUTES } = require('../src/utils/casino');
const { changeSouls, getUser } = require('../src/utils/xp');
const silver = require('../src/utils/silver');

const { games, startGame, move, fire, play, loadShells, count, winnings, SILVER } = silver;
const souls = async (id) => (await getUser(id)).souls;
const idOf = (m) => m.components[0].components[0].data.custom_id.split(':')[1];
const base = (shells, turn = 'a') => ({ players: ['a', 'b'], charges: { a: 3, b: 3 }, shells, turn, log: [], name: 'A', opponentName: 'B', userId: 'a', opponentId: 'b' });

test('shells: 2-8, at least one live and one blank', () => {
  for (let i = 0; i < 200; i++) {
    const { live, blank } = count(loadShells());
    assert.ok(live >= 1 && live <= 3 && blank >= 1 && live + blank <= 8 && live + blank >= 2);
  }
});

test('shots: live hurts, blank on self keeps the turn, blank on the other passes it, empty chamber reloads', () => {
  let g = fire(base(['live', 'blank', 'blank']), false);
  assert.strictEqual(g.charges.b, 2);
  assert.strictEqual(g.turn, 'b');
  g = fire(base(['blank', 'live']), true);
  assert.strictEqual(g.turn, 'a');
  assert.strictEqual(g.charges.a, 3);
  g = fire(base(['blank', 'live']), false);
  assert.strictEqual(g.turn, 'b');
  g = fire(base(['live', 'live']), true);
  assert.strictEqual(g.charges.a, 2);
  assert.strictEqual(g.turn, 'b');
  g = fire(base(['blank']), false);
  assert.ok(g.event.reloaded && g.shells.length >= 2);
  g = fire({ ...base(['live']), charges: { a: 3, b: 1 } }, false);
  assert.strictEqual(g.winner, 'a');
});

test('Silver: shoots herself only when no live shell is left', () => {
  assert.strictEqual(silver.silverShoots(base(['blank', 'blank'])), true);
  assert.strictEqual(silver.silverShoots(base(['blank', 'blank', 'live'])), false);
});

test('play: Silver answers automatically and hands the turn back', () => {
  const g = play({ ...base(['blank', 'live', 'live', 'blank', 'blank']), players: ['a', SILVER], charges: { a: 3, [SILVER]: 3 }, opponentId: null, opponentName: 'Silver' }, false);
  assert.ok(g.turn === 'a' || g.winner);
  assert.ok(g.log.length >= 2);
});

test('fairness: mirroring Silver wins 45-60% of the time, always shooting her is no better (1.85x pays about 95% back)', () => {
  for (const strategy of [(c) => c.live === 0, () => false]) {
    let wins = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
      let g = { ...base(loadShells()), players: ['a', SILVER], charges: { a: 3, [SILVER]: 3 }, opponentId: null, opponentName: 'Silver' };
      while (!g.winner) g = play(g, strategy(count(g.shells)));
      if (g.winner === 'a') wins++;
    }
    assert.ok(wins / N > 0.45 && wins / N < 0.6, `win rate ${wins / N}`);
  }
});

test('against Silver: bet taken, only the player shoots, win pays 1.85x, loss pays nothing', async () => {
  const user = { id: 'rou-solo' };
  assert.ok((await startGame(user, 'Solo', 100)).error);
  await changeSouls(user.id, 100000);
  for (let i = 0; i < 20; i++) {
    const before = await souls(user.id);
    const start = await startGame(user, 'Solo', 100);
    assert.strictEqual(await souls(user.id), before - 100);
    const id = idOf(start);
    assert.ok((await move(id, 'other', ['other'])).error);
    let result = start;
    while ((await games().get(id))) {
      const g = await games().get(id);
      const { live, blank } = count(g.shells);
      result = await move(id, user.id, [blank > live ? 'self' : 'other']);
    }
    const embed = result.embeds[0].toJSON();
    const won = embed.color === 0x248046;
    assert.strictEqual(await souls(user.id), before - 100 + (won ? winnings(100) : 0));
  }
});

test('member vs member: challenge, accept, turns, winner takes the pot; timeout refunds both', async () => {
  const a = { id: 'rou-a' }, b = { id: 'rou-b', username: 'B' };
  await changeSouls(a.id, 1000);
  await changeSouls(b.id, 1000);
  const start = await startGame(a, 'A', 100, b);
  const id = idOf(start);
  assert.strictEqual(await souls(a.id), 900);
  assert.ok((await move(id, a.id, ['accept'])).error);
  await move(id, b.id, ['accept']);
  assert.strictEqual(await souls(b.id), 900);
  assert.ok((await move(id, b.id, ['other'])).error); // not b's turn
  let last;
  for (let i = 0; i < 100 && (await games().get(id)); i++) {
    const g = await games().get(id);
    last = await move(id, g.turn, ['other']);
  }
  assert.strictEqual((await souls(a.id)) + (await souls(b.id)), 2000 - 0);
  assert.ok(last.embeds);

  const again = await startGame(a, 'A', 100, b);
  const id2 = idOf(again);
  await move(id2, b.id, ['accept']);
  const before = [await souls(a.id), await souls(b.id)];
  await games().update(id2, (g) => ({ ...g, at: Date.now() - (TIME_LIMIT_MINUTES + 1) * 60_000 }));
  await expireGames({ channels: { fetch: async () => null } }, [silver]);
  assert.strictEqual(await souls(a.id), before[0] + 100);
  assert.strictEqual(await souls(b.id), before[1] + 100);
});
