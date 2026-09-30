// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { expireGames, TIME_LIMIT_MINUTES } = require('../src/utils/casino');
const { changeSouls, getUser } = require('../src/utils/xp');
const yamato = require('../src/utils/yamato');

const { games, startGame, play, versus, winnings, staked, timeoutView } = yamato;
const souls = async (id) => (await getUser(id)).souls;
const idOf = (message) => message.components[0].components[0].data.custom_id.split(':')[1];
const text = (message) => message.embeds[0].toJSON().description;
const buttons = (message) => message.components.flatMap((r) => r.components.map((b) => b.data.custom_id.split(':').slice(2).join(':')));
const rich = async (...ids) => { for (const id of ids) await changeSouls(id, 1000); };

test('stances: each beats one and loses to one', () => {
  assert.strictEqual(versus('power', 'flying'), 1);
  assert.strictEqual(versus('flying', 'crimson'), 1);
  assert.strictEqual(versus('crimson', 'power'), 1);
  assert.strictEqual(versus('flying', 'power'), -1);
  assert.strictEqual(versus('crimson', 'crimson'), 0);
  assert.strictEqual(winnings(200), 370);
});

test('against Yamato: bet taken, win pays 1.85x, tie refunds, loss pays nothing, only the player plays', async () => {
  const user = { id: 'duel-solo' };
  assert.ok((await startGame(user, 'Solo', 100)).error); // can't afford it
  await rich(user.id);
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const before = await souls(user.id);
    const start = await startGame(user, 'Solo', 100);
    assert.strictEqual(await souls(user.id), before - 100);
    assert.deepStrictEqual(buttons(start), ['power', 'flying', 'crimson']);
    const id = idOf(start);
    const { yamato: his } = await games().get(id);
    assert.ok((await play(id, 'someone-else', ['power'])).error);
    const result = await play(id, user.id, ['power']);
    const embed = result.embeds[0].toJSON();
    const outcome = versus('power', his);
    seen.add(outcome);
    assert.strictEqual(await souls(user.id), before - 100 + (outcome > 0 ? 185 : outcome === 0 ? 100 : 0));
    assert.strictEqual(embed.thumbnail.url, `attachment://yamato_${outcome > 0 ? 'injured' : outcome === 0 ? 'portrait' : 'gloat'}.png`);
    assert.deepStrictEqual(embed.fields.map((f) => f.name), ['Bet', 'Won', 'Balance']);
    assert.strictEqual(await play(id, user.id, ['flying']), null); // double click does nothing
    assert.strictEqual(await games().get(id), null);
  }
  assert.strictEqual(seen.size, 3);
});

test('duel: bad challenges are refused without taking souls', async () => {
  const a = { id: 'duel-a' };
  await rich(a.id);
  assert.match((await startGame(a, 'A', 100, { id: 'x', bot: true })).error, /Bots/);
  assert.match((await startGame(a, 'A', 100, a)).error, /yourself/);
  assert.strictEqual(await souls(a.id), 1000);
});

test('duel: accept takes the second bet, picks are secret, the winner takes the pot', async () => {
  const a = { id: 'duel-1', username: 'A' };
  const b = { id: 'duel-2', username: 'B' };
  await rich(a.id, b.id);
  const invite = await startGame(a, 'A', 200, b);
  assert.strictEqual(invite.content, `<@${b.id}>`); // pings the challenged member
  assert.deepStrictEqual(buttons(invite), ['accept', 'decline']);
  const id = idOf(invite);
  assert.strictEqual(await souls(a.id), 800);
  assert.strictEqual(await play(id, a.id, ['power']), null); // no picking before it's accepted

  assert.ok((await play(id, a.id, ['accept'])).error); // the challenger can't accept
  assert.ok((await play(id, 'third', ['accept'])).error);
  assert.ok((await play(id, 'third', ['decline'])).error);
  const picking = await play(id, b.id, ['accept']);
  assert.strictEqual(picking.content, '');
  assert.strictEqual(await souls(b.id), 800);
  assert.strictEqual(await play(id, b.id, ['accept']), null); // second accept ignored

  assert.ok((await play(id, 'third', ['power'])).error);
  const first = await play(id, a.id, ['power']);
  assert.match(first.private, /Power Slash/);
  assert.match(text(first.update), /A:\*\* ready/);
  assert.match(text(first.update), /B:\*\* choosing/);
  assert.ok(!text(first.update).includes('Power')); // nobody sees the pick
  assert.ok((await play(id, a.id, ['flying'])).error); // no changing it

  const result = await play(id, b.id, ['flying']); // Power beats Flying: A wins
  assert.match(text(result), new RegExp(`<@${a.id}> wins`));
  assert.strictEqual(await souls(a.id), 1200);
  assert.strictEqual(await souls(b.id), 800);
  assert.strictEqual(result.components[0].components[0].data.custom_id, `${yamato.AGAIN_ID}:200:${a.id}:${b.id}`);
  assert.strictEqual(await games().get(id), null);
});

test('duel: a tie gives both bets back', async () => {
  const a = { id: 'duel-3' };
  const b = { id: 'duel-4' };
  await rich(a.id, b.id);
  const id = idOf(await startGame(a, 'A', 100, b));
  await play(id, b.id, ['accept']);
  await play(id, b.id, ['crimson']);
  const result = await play(id, a.id, ['crimson']);
  assert.match(text(result), /A draw/);
  assert.strictEqual(await souls(a.id), 1000);
  assert.strictEqual(await souls(b.id), 1000);
});

test('duel: declining refunds the challenger; a broke opponent cannot accept', async () => {
  const a = { id: 'duel-5' };
  const b = { id: 'duel-6' };
  await rich(a.id);
  const id = idOf(await startGame(a, 'A', 300, b));
  assert.match((await play(id, b.id, ['accept'])).error, /don't have/);
  assert.ok(await games().get(id)); // still open
  const declined = await play(id, b.id, ['decline']);
  assert.match(text(declined), /turned down/);
  assert.strictEqual(await souls(a.id), 1000);
  assert.strictEqual(await games().get(id), null);
});

test('duel: no answer for the time limit refunds everyone who staked', async () => {
  const now = Date.now() + TIME_LIMIT_MINUTES * 60_000 + 1000;
  const a = { id: 'duel-7' };
  const b = { id: 'duel-8' };
  await rich(a.id, b.id);
  const invited = idOf(await startGame(a, 'A', 100, b)); // never accepted
  const picking = idOf(await startGame(a, 'A', 100, b));
  await play(picking, b.id, ['accept']); // accepted, nobody picks
  const alone = idOf(await startGame(a, 'A', 100)); // against Yamato, no pick
  assert.strictEqual(await souls(a.id), 700);
  assert.strictEqual(await souls(b.id), 900);
  assert.strictEqual(staked(await games().get(picking)), 200);
  assert.strictEqual(staked(await games().get(invited)), 100);

  const edits = [];
  for (const id of [invited, picking, alone]) await games().update(id, (g) => ({ ...g, channelId: 'c', messageId: id }));
  const client = { channels: { fetch: async () => ({ messages: { edit: async (id, payload) => edits.push([id, payload]) } }) } };
  await expireGames(client, [yamato], now);
  assert.strictEqual(await souls(a.id), 1000);
  assert.strictEqual(await souls(b.id), 1000);
  assert.strictEqual(edits.length, 3);
  for (const [, p] of edits) assert.ok(yamato.TIMEOUT_LINES.some((l) => p.embeds[0].toJSON().footer.text.includes(l)));
  assert.deepStrictEqual(Object.keys(await games().all()), []);
  const view = await timeoutView('x', { userId: a.id, opponentId: b.id, bet: 5, phase: 'invite' }, 0);
  assert.strictEqual(view.content, '');
});
