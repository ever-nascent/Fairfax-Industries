// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { expireGames, TIME_LIMIT_MINUTES } = require('../src/utils/casino');
const { changeSouls, getUser } = require('../src/utils/xp');
const silver = require('../src/utils/silver');

const { games, startGame, move, fire, play, useItem, decide, liveChance, shown, deal, loadShells, count, winnings, SILVER, MAX_ITEMS } = silver;
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

test('Silver without items: shoots herself only on a sure blank, else shoots you', () => {
  assert.deepStrictEqual(decide(base(['blank', 'blank']), 'a'), { shoot: true });
  assert.deepStrictEqual(decide(base(['blank', 'blank', 'live']), 'a'), { shoot: false });
});

const withItems = (shells, items, extra = {}) => ({ ...base(shells), items: { a: items, b: [] }, known: {}, ...extra });

test('items: each does what it says and the turn stays', () => {
  let r = useItem(withItems(['live', 'blank'], ['glass']), 'glass');
  assert.match(r.secret, /Live/);
  assert.strictEqual(r.game.known.a, 'live');
  assert.strictEqual(r.game.turn, 'a');
  assert.deepStrictEqual(r.game.items.a, []);
  assert.strictEqual(liveChance(r.game, 'a'), 1);
  assert.strictEqual(liveChance(r.game, 'b'), 0.5); // only the user saw it

  r = useItem(withItems(['live', 'blank', 'live'], ['beer']), 'beer');
  assert.deepStrictEqual(r.game.shells, ['blank', 'live']);
  assert.match(r.game.log[0], /Racked Out A .* Live Shell/);
  r = useItem(withItems(['blank'], ['beer']), 'beer'); // the last shell: a reload, items dealt
  assert.ok(r.game.shells.length >= 2 && r.game.items.a.length === 2 && r.game.items.b.length === 2);

  r = useItem(withItems(['live', 'blank'], ['saw', 'saw']), 'saw');
  assert.ok(useItem(r.game, 'saw').error); // already sawed off
  let g = fire(r.game, false);
  assert.strictEqual(g.charges.b, 1);
  assert.strictEqual(g.saw, false);

  r = useItem(withItems(['blank', 'live', 'live'], ['cuffs', 'cuffs']), 'cuffs');
  g = fire(r.game, false); // blank on b: b is cuffed, so the turn comes back
  assert.strictEqual(g.turn, 'a');
  assert.strictEqual(g.event.skipped, 'b');
  assert.ok(useItem(g, 'cuffs').error); // b just skipped: not again yet
  g = fire(g, false); // live on b, the turn passes now
  assert.strictEqual(g.turn, 'b');

  r = useItem(withItems(['live'], ['smokes']), 'smokes');
  assert.ok(r.error); // full charges
  r = useItem({ ...withItems(['live'], ['smokes']), charges: { a: 1, b: 3 } }, 'smokes');
  assert.strictEqual(r.game.charges.a, 2);

  r = useItem(withItems(['blank', 'live', 'live'], ['inverter']), 'inverter');
  assert.deepStrictEqual(r.game.shells, ['live', 'live', 'live']);
  assert.deepStrictEqual(shown(r.game), { live: 2, blank: 1 }); // the flip doesn't show in the counts
  assert.ok(Math.abs(liveChance(r.game, 'b') - 1 / 3) < 1e-9); // 2 of 3 were live as loaded, flipped: 1 in 3

  assert.ok(useItem(withItems(['live'], []), 'glass').error);
});

test('items: a load deals 2 each, never more than the cap', () => {
  const players = ['a', 'b'];
  assert.strictEqual(deal({ players }).a.length, 2);
  assert.strictEqual(deal({ players, items: { a: Array(7).fill('beer'), b: [] } }).a.length, MAX_ITEMS);
});

test('Silver with items: heals, peeks, flips a blank, saws a likely live, cuffs before shooting', () => {
  const at = (shells, items, extra = {}) => decide(withItems(shells, items, extra), 'a');
  assert.deepStrictEqual(at(['live', 'blank'], ['smokes'], { charges: { a: 2, b: 3 } }), { item: 'smokes' });
  assert.deepStrictEqual(at(['live', 'blank'], ['glass']), { item: 'glass' });
  assert.deepStrictEqual(at(['blank', 'blank'], ['inverter']), { item: 'inverter' });
  assert.deepStrictEqual(at(['live', 'blank'], ['saw'], { known: { a: 'live' } }), { item: 'saw' });
  assert.deepStrictEqual(at(['live', 'blank'], ['cuffs'], { known: { a: 'live' } }), { item: 'cuffs' });
  assert.deepStrictEqual(at(['live', 'blank'], [], { known: { a: 'live' } }), { shoot: false });
  assert.deepStrictEqual(at(['live', 'blank'], [], { known: { a: 'blank' } }), { shoot: true });
});

test('play: Silver answers automatically and hands the turn back', () => {
  const g = play({ ...base(['blank', 'live', 'live', 'blank', 'blank']), players: ['a', SILVER], charges: { a: 3, [SILVER]: 3 }, opponentId: null, opponentName: 'Silver' }, false);
  assert.ok(g.turn === 'a' || g.winner);
  assert.ok(g.log.length >= 2);
});

test("fairness: playing by Silver's own rules wins 45-60%, ignoring the items far less", () => {
  const rate = (strategy, N = 8000) => {
    let wins = 0;
    for (let i = 0; i < N; i++) {
      const players = ['a', SILVER];
      let g = { ...base(loadShells()), players, charges: { a: 3, [SILVER]: 3 }, opponentId: null, opponentName: 'Silver', items: deal({ players }), known: {} };
      while (!g.winner) {
        const d = strategy(g);
        g = d.item ? { ...useItem(g, d.item).game, acted: true } : play(g, d.shoot);
      }
      if (g.winner === 'a') wins++;
    }
    return wins / N;
  };
  const mirror = rate((g) => decide(g, 'a'));
  assert.ok(mirror > 0.45 && mirror < 0.6, `win rate ${mirror}`);
  assert.ok(rate(() => ({ shoot: false })) < mirror, 'always shooting her should do worse');
});

test('the dropdown: an item through move, the Glass answers privately, the turn stays', async () => {
  const user = { id: 'rou-items' };
  await changeSouls(user.id, 1000);
  const start = await startGame(user, 'Items', 100);
  const id = idOf(start);
  assert.strictEqual(start.components[0].components[0].data.custom_id, `roulette:${id}:item`);
  await games().update(id, (g) => ({ ...g, shells: ['live', 'blank'], items: { [user.id]: ['glass', 'cuffs'], [SILVER]: [] } }));
  assert.ok((await move(id, 'someone', ['item', 'glass'])).error);
  const peek = await move(id, user.id, ['item', 'glass']);
  assert.match(peek.private, /Live/);
  assert.ok(peek.update.embeds[0].toJSON().description.includes('Magnifying Glass'));
  const g = await games().get(id);
  assert.strictEqual(g.turn, user.id);
  assert.deepStrictEqual(g.items[user.id], ['cuffs']);
  assert.ok((await move(id, user.id, ['item', 'glass'])).error); // used up
  const cuffed = await move(id, user.id, ['item', 'cuffs']);
  assert.ok(cuffed.embeds[0].toJSON().description.includes('Handcuffs'));
  await games().delete(id);
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
