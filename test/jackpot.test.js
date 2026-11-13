// Run: node --test. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.NO_QUESTS = '1';
const test = require('./group')(__filename);
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/economy/xp');
const J = require('../src/utils/economy/jackpot');
const { jackpotView, receipt } = require('../src/commands/xp/jackpot');
const routes = require('../src/components/jackpot');

const MON = Date.parse('2026-11-09T00:00:00Z'); // a Monday
const WEEK = 7 * 86_400_000;
const give = (id, souls) => getStore('xp').set(id, { xp: 0, level: 0, souls, cards: [], rejuvs: 0, boostUntil: 0 });

test('tickets: paid for, counted, limited to 20 a week; the pot is 90% of what they cost', async () => {
  await give('a', 50 * J.TICKET);
  assert.deepStrictEqual(await J.status('g1', 'a', MON), { pot: 0, sold: 0, mine: 0, left: J.MAX_TICKETS, drawAt: MON + WEEK, last: null, channelId: null });
  const r = await J.buyTickets('g1', 'a', 5, MON);
  assert.ok(r.ok && r.cost === 5 * J.TICKET && r.user.souls === 45 * J.TICKET);
  assert.strictEqual((await J.status('g1', 'a', MON)).pot, 5 * J.TICKET * 0.9);
  assert.deepStrictEqual(await J.buyTickets('g1', 'a', 16, MON), { ok: false, reason: 'limit' });
  assert.deepStrictEqual(await J.buyTickets('g1', 'a', 0, MON), { ok: false, reason: 'limit' });
  const many = await Promise.all(Array.from({ length: 6 }, () => J.buyTickets('g1', 'a', 5, MON))); // fast clicks: only 15 more fit
  assert.strictEqual(many.filter((x) => x.ok).length, 3);
  assert.strictEqual((await getUser('a')).souls, 30 * J.TICKET);
  await give('poor', J.TICKET - 1);
  assert.deepStrictEqual(await J.buyTickets('g1', 'poor', 1, MON), { ok: false, reason: 'souls' });
  const s = await J.status('g1', 'poor', MON);
  assert.deepStrictEqual([s.sold, s.mine, s.left], [20, 0, 20], 'a buy that could not be paid leaves no ticket');
  assert.strictEqual((await J.status('g2', 'a', MON)).sold, 0, 'another server has its own jackpot');
});

test('the draw: once, when the week turns, by ticket; the winner is paid the pot and it starts over', async () => {
  await give('b', 10 * J.TICKET);
  await J.buyTickets('g1', 'b', 5, MON + 1000); // a: 20 tickets, b: 5
  assert.strictEqual(await J.settle('g1', MON + WEEK - 1), null, 'not before Monday');
  const drawn = await J.settle('g1', MON + WEEK, () => 22); // ticket 22 of 25 is b's
  assert.deepStrictEqual(drawn, { week: '2026-11-09', winner: 'b', pot: 25 * J.TICKET * 0.9, mine: 5, sold: 25 });
  assert.strictEqual((await getUser('b')).souls, 5 * J.TICKET + drawn.pot);
  assert.strictEqual(await J.settle('g1', MON + WEEK), null, 'only once');
  const s = await J.status('g1', 'a', MON + WEEK);
  assert.deepStrictEqual([s.pot, s.sold, s.mine, s.drawAt], [0, 0, 0, MON + 2 * WEEK]);
  assert.deepStrictEqual(s.last, drawn);
  assert.strictEqual((await J.settle('g1', MON + 2 * WEEK)), null, 'a week with no tickets has no winner');
  assert.deepStrictEqual((await J.status('g1', 'a', MON + 2 * WEEK)).last, drawn, 'and keeps the last one');
  // every ticket has the same chance
  for (const [at, who] of [[0, 'a'], [19, 'a'], [20, 'b'], [24, 'b']]) {
    await getStore('jackpot').set('odds', { week: '2026-11-09', tickets: { a: 20, b: 5 }, last: null, channelId: null });
    assert.strictEqual((await J.settle('odds', MON + WEEK, () => at)).winner, who);
  }
});

test('the screen, the Buy button and the announcement', async () => {
  const guild = { id: 'g3', name: 'Test', channels: { fetch: async (id) => (id === 'c1' ? { send: async (m) => sent.push(m) } : null) } };
  const sent = [];
  const member = (id) => ({ id, guild });
  await give('c', 6 * J.TICKET);
  const now = Date.now();
  let view = await jackpotView(member('c'), now);
  let embed = view.embeds[0].toJSON();
  assert.ok(embed.description.includes('**90%**') && embed.fields.find((f) => f.name === 'Last Week').value === 'Nobody has won yet.');
  assert.deepStrictEqual(view.components[0].toJSON().components.map((b) => [b.custom_id, b.disabled]), [['jackpot_buy:c:1', false], ['jackpot_buy:c:5', false]]);

  const said = [];
  const interaction = { customId: 'jackpot_buy:c:5', guildId: 'g3', user: { id: 'c' }, member: member('c'), isButton: () => true, deferUpdate: async () => {}, editReply: async (v) => { view = v; }, reply: async (r) => said.push(r.content), followUp: async (r) => said.push(r.embeds[0].data.description) };
  const route = routes[0];
  assert.ok(route.matches(interaction));
  await route.execute(interaction);
  assert.match(said[0], /You bought \*\*5\*\* Tickets for .*\*\*5,000 Souls\*\*/);
  embed = view.embeds[0].toJSON();
  assert.strictEqual(embed.fields.find((f) => f.name === 'Your Tickets').value, `**5** / ${J.MAX_TICKETS}`);
  assert.deepStrictEqual(view.components[0].toJSON().components.map((b) => b.disabled), [false, true], 'one more fits the balance, five do not');
  await route.execute({ ...interaction, user: { id: 'someone-else' } });
  assert.match(said[1], /Open your own/);
  assert.strictEqual(receipt({ ok: false, reason: 'limit' }), `You can hold **${J.MAX_TICKETS}** Tickets a week.`);
  assert.strictEqual(receipt({ ok: true, count: 1, cost: J.TICKET }).includes('**1** Ticket for'), true);

  // next week: drawn, paid, posted in the channel staff set, shown on the screen
  await J.setChannel('g3', 'c1');
  const drawn = await J.drawAndAnnounce(guild, now + WEEK);
  assert.deepStrictEqual([drawn.winner, drawn.pot], ['c', 5 * J.TICKET * 0.9]);
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].content === '<@c>' && sent[0].allowedMentions.users[0] === 'c' && sent[0].embeds[0].toJSON().description.includes('<@c> won'));
  assert.strictEqual((await getUser('c')).souls, J.TICKET + drawn.pot);
  assert.strictEqual(await J.drawAndAnnounce(guild, now + WEEK), null);
  view = await jackpotView(member('c'), now + WEEK);
  assert.match(view.embeds[0].toJSON().fields.find((f) => f.name === 'Last Week').value, /<@c> won .*with \*\*5\*\* of \*\*5\*\* Tickets\./);
  assert.deepStrictEqual(await J.servers().then((s) => s.includes('g3')), true);
});
