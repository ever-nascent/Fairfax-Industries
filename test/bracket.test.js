// Run: node --test. The tournament brackets (src/utils/server/bracket.js): no Discord, no data folder.
const test = require('./group')(__filename);
const assert = require('node:assert');
const B = require('../src/utils/server/bracket');

const teams = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
// Plays every ready match until none is left: the better seed wins unless `upset(id, a, b)` names the winner. Returns the ids played, in order.
function playOut(bracket, upset = () => null) {
  const played = [];
  for (let guard = 0; guard < 1000; guard++) {
    const now = B.resolve(bracket);
    const id = bracket.order.find((x) => now[x].state === 'ready');
    if (!id) return played;
    const { a, b } = now[id];
    const better = bracket.seeds.indexOf(a) < bracket.seeds.indexOf(b) ? a : b;
    assert.ok(B.setResult(bracket, id, upset(id, a, b) ?? better, [2, 0]).ok);
    played.push(id);
  }
  throw new Error('the bracket never finished');
}

test('seedOrder: 1 and 2 on opposite halves, 1 plays the last seed', () => {
  assert.deepStrictEqual(B.seedOrder(2), [1, 2]);
  assert.deepStrictEqual(B.seedOrder(4), [1, 4, 2, 3]);
  assert.deepStrictEqual(B.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('single elimination: byes go to the top seeds, the best seed wins, places by round', () => {
  const b = B.build('single', teams(6)); // 8 slots: seeds 1 and 2 get byes
  assert.deepStrictEqual(b.order, ['R1-1', 'R1-2', 'R1-3', 'R1-4', 'R2-1', 'R2-2', 'R3-1']);
  let now = B.resolve(b);
  assert.deepStrictEqual([now['R1-1'].state, now['R1-1'].winner, now['R1-3'].state, now['R1-3'].winner], ['bye', 't1', 'bye', 't2']);
  assert.deepStrictEqual([now['R1-2'].a, now['R1-2'].b, now['R1-2'].state], ['t4', 't5', 'ready']);
  assert.deepStrictEqual([now['R2-1'].a, now['R2-1'].b, now['R2-1'].state], ['t1', undefined, 'waiting']);
  assert.strictEqual(B.complete(b), false);
  assert.deepStrictEqual(B.standings(b), [{ place: null, teams: teams(6) }]);
  assert.deepStrictEqual(playOut(b), ['R1-2', 'R1-4', 'R2-1', 'R2-2', 'R3-1']);
  assert.ok(B.complete(b));
  assert.deepStrictEqual(B.standings(b), [{ place: 1, teams: ['t1'] }, { place: 2, teams: ['t2'] }, { place: 3, teams: ['t4', 't3'] }, { place: 5, teams: ['t5', 't6'] }]);
  assert.deepStrictEqual(['R1-1', 'R2-1', 'R3-1'].map((id) => B.roundName(b, b.matches[id])), ['Round 1', 'Semifinal', 'Final']);
});

test('results: refused when the match is not ready or the team is not in it; a correction clears what came after', () => {
  const b = B.build('single', teams(4));
  assert.strictEqual(B.setResult(b, 'R2-1', 't1').reason, 'notReady');
  assert.strictEqual(B.setResult(b, 'R9-9', 't1').reason, 'noMatch');
  assert.strictEqual(B.setResult(b, 'R1-1', 't2').reason, 'notInMatch');
  B.setResult(b, 'R1-1', 't1', [2, 1]);
  B.setResult(b, 'R1-2', 't2', [2, 0]);
  B.setResult(b, 'R2-1', 't1', [2, 0]);
  assert.ok(B.complete(b));
  const fixed = B.setResult(b, 'R1-1', 't4', [2, 1]); // t1 did not win after all
  assert.deepStrictEqual(fixed.cleared, ['R2-1'], 'the final t1 won is forgotten');
  const now = B.resolve(b);
  assert.deepStrictEqual([now['R2-1'].a, now['R2-1'].b, now['R2-1'].state], ['t4', 't2', 'ready']);
  assert.strictEqual(B.complete(b), false);
});

test('double elimination: every size plays out; a team is out after two losses; the lower bracket winner reaches the Grand Final', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 13, 16, 24, 32]) {
    const b = B.build('double', teams(n));
    const losses = new Map();
    const played = playOut(b);
    const now = B.resolve(b);
    for (const id of played) losses.set(now[id].loser, (losses.get(now[id].loser) ?? 0) + 1);
    assert.ok(B.complete(b), `${n} teams finish`);
    assert.strictEqual(now.GF.winner, 't1', `${n} teams: the top seed wins`);
    for (const team of teams(n)) assert.strictEqual(losses.get(team) ?? 0, team === 't1' ? 0 : 2,`${n} teams: ${team}'s losses`);
    const places = B.standings(b);
    assert.deepStrictEqual(places.flatMap((p) => p.teams).sort(), teams(n).sort(), `${n} teams: everyone has a place`);
    assert.deepStrictEqual([places[0], places[1]], [{ place: 1, teams: ['t1'] }, { place: 2, teams: ['t2'] }]);
    assert.ok(places.every((p, i) => p.place === 1 + places.slice(0, i).reduce((sum, x) => sum + x.teams.length, 0)), `${n} teams: places count the teams above`);
  }
  // 4 teams: t1 loses its first match and comes back through the lower bracket.
  const b = B.build('double', teams(4));
  playOut(b, (id, a, b2) => (id === 'W1-1' ? [a, b2].find((t) => t !== 't1') : null));
  const now = B.resolve(b);
  assert.ok(now.GF.a !== 't1' && now.GF.b === 't1', 't1 is the lower bracket side of the Grand Final');
  assert.deepStrictEqual(['W1-1', 'W2-1', 'L1-1', 'L2-1', 'GF'].map((id) => B.roundName(b, b.matches[id])), ['Upper Semifinal', 'Upper Final', 'Lower Round 1', 'Lower Round 2', 'Grand Final']);
});

test('round robin: everyone plays everyone once, nobody twice a round; the table breaks ties by games', () => {
  for (const n of [2, 3, 4, 5, 8]) {
    const b = B.build('robin', teams(n));
    assert.strictEqual(b.order.length, (n * (n - 1)) / 2);
    const pairs = new Set(b.order.map((id) => [b.matches[id].a.team, b.matches[id].b.team].sort().join()));
    assert.strictEqual(pairs.size, b.order.length, `${n} teams: no pair twice`);
    const rounds = Map.groupBy(b.order.map((id) => b.matches[id]), (m) => m.round);
    for (const ms of rounds.values()) assert.strictEqual(new Set(ms.flatMap((m) => [m.a.team, m.b.team])).size, ms.length * 2, `${n} teams: one match a round each`);
  }
  const b = B.build('robin', teams(3));
  assert.strictEqual(B.complete(b), false);
  const id = (x, y) => b.order.find((m) => [b.matches[m].a.team, b.matches[m].b.team].sort().join() === [x, y].sort().join());
  B.setResult(b, id('t1', 't2'), 't2', [2, 1]);
  B.setResult(b, id('t2', 't3'), 't3', [2, 0]);
  B.setResult(b, id('t1', 't3'), 't1', [2, 0]);
  assert.ok(B.complete(b));
  assert.deepStrictEqual(B.table(b).map((r) => [r.team, r.wins, r.diff]), [['t1', 1, 1], ['t3', 1, 0], ['t2', 1, -1]]);
  assert.deepStrictEqual(B.standings(b).map((p) => [p.place, p.teams[0]]), [[1, 't1'], [2, 't3'], [3, 't2']]);
});
