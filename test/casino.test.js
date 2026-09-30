// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { MessageFlags } = require('discord.js');
const { takeBet, betCommand, gameButtons, expireGames, MIN_BET, TIME_LIMIT_MINUTES } = require('../src/utils/casino');
const { getStore } = require('../src/storage');
const { changeSouls, getUser } = require('../src/utils/xp');

// A fake interaction that records which reply calls the handler made.
function fakeInteraction({ bet, game: choice, customId } = {}) {
  const calls = [];
  const record = (name) => async (arg) => calls.push([name, arg]);
  return {
    calls,
    user: { id: 'casino-user' },
    member: { displayName: 'Tester' },
    customId,
    options: { getInteger: () => bet, getString: () => choice, getUser: () => null },
    isButton: () => true,
    reply: record('reply'),
    deferReply: record('deferReply'),
    editReply: record('editReply'),
    deleteReply: record('deleteReply'),
    followUp: record('followUp'),
    update: record('update'),
    deferUpdate: record('deferUpdate'),
  };
}
const game = { content: 'the game' };
const startGame = async (_user, _name, bet) => (bet > 100 ? { error: 'too rich' } : game);
const names = (i) => i.calls.map(([name]) => name);
// A stand-in game module (see casino.js for what a game module gives).
const fakeGame = { BUTTON_ID: 'g', AGAIN_ID: 'g_again', startGame, games: () => getStore('fakeGames') };

test('takeBet: minimum bet, balance check, takes the souls', async () => {
  await changeSouls('casino-bettor', 50);
  assert.match(await takeBet('casino-bettor', MIN_BET - 1), /minimum bet/);
  assert.match(await takeBet('casino-bettor', 60), /don't have/);
  assert.strictEqual(await takeBet('casino-bettor', 50), null);
  assert.strictEqual((await getUser('casino-bettor')).souls, 0);
});

test('bet command: posts the game in public, or a private error; slow games defer first', async () => {
  const cmd = betCommand('mini', 'd', { fast: { label: 'Fast', game: fakeGame }, slow: { label: 'Slow', game: fakeGame, slow: true } });
  const [gameOpt, betOpt] = cmd.data.toJSON().options;
  assert.deepStrictEqual(gameOpt.choices.map((c) => c.value), ['fast', 'slow']);
  assert.strictEqual(betOpt.min_value, MIN_BET);

  let i = fakeInteraction({ game: 'fast', bet: 50 });
  await cmd.execute(i);
  assert.deepStrictEqual(i.calls, [['reply', { ...game, withResponse: true }]]);
  i = fakeInteraction({ game: 'fast', bet: 500 });
  await cmd.execute(i);
  assert.deepStrictEqual(i.calls, [['reply', { content: 'too rich', flags: MessageFlags.Ephemeral }]]);

  i = fakeInteraction({ game: 'slow', bet: 50 });
  await cmd.execute(i);
  assert.deepStrictEqual(names(i), ['deferReply', 'editReply']);
  i = fakeInteraction({ game: 'slow', bet: 500 });
  await cmd.execute(i);
  assert.deepStrictEqual(names(i), ['deferReply', 'deleteReply', 'followUp']);
});

test('a solo game gets no 4th argument (null would replace its default deck / race / bombs)', async () => {
  const args = [];
  const spy = { ...fakeGame, startGame: async (...a) => (args.push(a.length), game) };
  const cmd = betCommand('mini', 'd', { spy: { label: 'Spy', game: spy } });
  await cmd.execute(fakeInteraction({ game: 'spy', bet: 50 }));
  assert.deepStrictEqual(args, [3]);
});

test('game buttons: route by prefix, pass the args, handle stale clicks, errors and updates', async () => {
  const seen = [];
  const play = async (id, userId, args) => {
    seen.push([id, userId, args]);
    return { stale: null, error: { error: 'not yours' }, ok: game }[args[0]];
  };
  const [button, again] = gameButtons('g', fakeGame, { play });
  assert.ok(button.matches(fakeInteraction({ customId: 'g:abc:ok' })));
  assert.ok(!button.matches(fakeInteraction({ customId: 'g_again:50:casino-user' })));
  assert.ok(again.matches(fakeInteraction({ customId: 'g_again:50:casino-user' })));

  let i = fakeInteraction({ customId: 'g:abc:ok:2' });
  await button.execute(i);
  assert.deepStrictEqual(seen.at(-1), ['abc', 'casino-user', ['ok', '2']]);
  assert.deepStrictEqual(i.calls, [['update', { ...game, attachments: [] }]]);
  i = fakeInteraction({ customId: 'g:abc:stale' });
  await button.execute(i);
  assert.deepStrictEqual(names(i), ['deferUpdate']);
  i = fakeInteraction({ customId: 'g:abc:error' });
  await button.execute(i);
  assert.deepStrictEqual(i.calls, [['reply', { content: 'not yours', flags: MessageFlags.Ephemeral }]]);

  // a secret pick: private reply to the clicker, the game's message edited
  const edited = [];
  const secret = gameButtons('g', fakeGame, { play: async () => ({ private: 'You chose', update: game }) })[0];
  i = fakeInteraction({ customId: 'g:abc:x' });
  i.message = { edit: async (payload) => edited.push(payload) };
  await secret.execute(i);
  assert.deepStrictEqual(names(i), ['reply']);
  assert.deepStrictEqual(edited, [{ ...game, attachments: [] }]);

  // Play Again: only the player it belongs to
  i = fakeInteraction({ customId: 'g_again:50:casino-user' });
  await again.execute(i);
  assert.deepStrictEqual(i.calls, [['reply', { ...game, withResponse: true }]]);
  i = fakeInteraction({ customId: 'g_again:50:someone-else' });
  await again.execute(i);
  assert.match(i.calls[0][1].embeds[0].toJSON().description, /Only the player/);
});

test('games with no click for the time limit are called off: everything staked comes back, the message is edited', async () => {
  const now = Date.now();
  const limit = TIME_LIMIT_MINUTES * 60_000;
  const store = fakeGame.games();
  await store.set('old', { userId: 'timeout-user', stake: 70, at: now - limit, channelId: 'c', messageId: 'm' });
  await store.set('fresh', { userId: 'timeout-user', stake: 70, at: now - limit + 1000 });
  await store.set('paying', { userId: 'timeout-user', stake: 70, at: now - limit, done: true }); // being paid out: leave it
  const edits = [];
  const client = { channels: { fetch: async () => ({ messages: { edit: async (id, payload) => edits.push([id, payload]) } }) } };
  const module_ = { ...fakeGame, staked: (g) => g.stake, timeoutView: async (id, g, balance) => ({ content: `${id} ${balance}` }) };

  await expireGames(client, [module_], now);
  assert.strictEqual((await getUser('timeout-user')).souls, 70);
  assert.deepStrictEqual(edits, [['m', { content: 'old 70', attachments: [] }]]);
  assert.deepStrictEqual(Object.keys(await store.all()).sort(), ['fresh', 'paying']);

  await expireGames(client, [module_], now); // nothing left to call off
  assert.strictEqual((await getUser('timeout-user')).souls, 70);
});

test("each game's time's-up message: the host gloats with a time's-up line, the bet is shown as returned", async () => {
  const user = { id: 'timeout-real' };
  await changeSouls(user.id, 10_000);
  for (const name of ['doorman', 'blackjack', 'sinclair', 'paradox', 'bebop']) {
    const game = require(`../src/utils/${name}`);
    const start = await game.startGame(user, 'Tester', 100);
    const id = start.components[0].components[0].data.custom_id.split(':')[1];
    const saved = await game.games().get(id);
    if (!saved) continue; // blackjack dealt a natural: over at once
    assert.ok(Math.abs(saved.at - Date.now()) < 5000, `${name} saves its start time`);
    const view = await game.timeoutView(id, saved, 1234);
    const embed = view.embeds[0].toJSON();
    assert.match(embed.thumbnail.url, /_gloat\.png$/, name);
    assert.ok(game.TIMEOUT_LINES.some((l) => embed.footer.text.includes(l)), name);
    assert.deepStrictEqual(embed.fields.map((f) => f.name), ['Bet', 'Returned', 'Balance']);
    assert.strictEqual(game.staked(saved), 100);
    assert.strictEqual(view.components[0].components[0].data.custom_id, `${game.AGAIN_ID}:100:${user.id}`);
  }
});
