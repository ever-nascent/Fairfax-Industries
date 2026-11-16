// Tickets (utils/server/tickets.js): staff, blacklist, panels, the permission overwrites, and the commands' shape.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const K = require('../src/utils/server/tickets');
const ticket = require('../src/commands/general/ticket');
const config = require('../src/commands/admin/ticket-config');
const routes = require('../src/components/tickets');

const member = (id, roles = []) => ({ id, roles: { cache: new Map(roles.map((r) => [r, true])) } });

test('staff lists change per server and the blacklist toggles', async () => {
  assert.deepStrictEqual(await K.toggleIn('g1', 'supportRoles', 'r1', true), ['r1']);
  assert.deepStrictEqual(await K.toggleIn('g1', 'supportRoles', 'r1', true), ['r1']);
  assert.deepStrictEqual((await K.getSettings('g2')).supportRoles, []);
  await K.toggleIn('g1', 'adminRoles', 'r9', true);
  await K.toggleIn('g1', 'blacklist', 'bad', true);
  const s = await K.getSettings('g1');
  assert.ok(K.isStaff(s, member('a', ['r1']), new PermissionsBitField()));
  assert.ok(!K.isStaff(s, member('a', ['r2']), new PermissionsBitField()));
  assert.ok(K.isAdmin(s, member('a', ['r9']), new PermissionsBitField()));
  assert.ok(!K.isAdmin(s, member('a', ['r1']), new PermissionsBitField()));
  assert.ok(K.isAdmin(s, member('a'), new PermissionsBitField([PermissionFlagsBits.ManageGuild])));
  assert.ok(K.isBlacklisted(s, member('bad')));
  assert.ok(!K.isBlacklisted(s, member('good')));
  await K.toggleIn('g1', 'blacklist', 'bad', false);
  assert.ok(!K.isBlacklisted(await K.getSettings('g1'), member('bad')));
});

test('a panel with its own support role overrides the server list', async () => {
  const s = await K.getSettings('g1');
  const panel = await K.createPanel('g1', { name: 'Help', channelId: 'c1', supportRoles: ['rp'] });
  assert.ok(K.isStaff(s, member('a', ['rp']), new PermissionsBitField(), panel));
  assert.ok(!K.isStaff(s, member('a', ['r1']), new PermissionsBitField(), panel));
  assert.deepStrictEqual((await K.guildPanels('g1')).map((p) => p.name), ['Help']);
  assert.deepStrictEqual(await K.guildPanels('g2'), []);
  assert.strictEqual(K.panelMessage(panel).components[0].toJSON().components[0].custom_id, `ticket_open:${panel.id}`);
});

test('overwrites hide the channel, let the opener and staff in, and mute other staff on a claim', () => {
  const base = { guildId: 'g', botId: 'bot', openerId: 'op', roleIds: ['s1', 's2'], userIds: ['x'] };
  const ids = (list) => list.map((o) => o.id);
  const open = K.overwrites(base);
  assert.deepStrictEqual(ids(open), ['g', 'bot', 'op', 's1', 's2', 'x']);
  assert.ok(open[0].deny.includes(PermissionFlagsBits.ViewChannel));
  const claimed = K.overwrites({ ...base, claimedBy: 'me', claimerRoleIds: ['s1'] });
  assert.ok(!ids(claimed).slice(3, 4).includes('s1'), 'the claimer\'s own role is not muted');
  const s2 = claimed.find((o) => o.id === 's2');
  assert.ok(s2.deny.includes(PermissionFlagsBits.SendMessages));
  assert.ok(claimed.find((o) => o.id === 'me').allow.includes(PermissionFlagsBits.SendMessages));
  assert.strictEqual(K.channelName(7), 'ticket-0007');
});

test('forms: 1 to 5 questions of up to 45 characters, one pop-up input each', async () => {
  const panel = await K.createPanel('g3', { name: 'Apply', channelId: 'c' });
  assert.strictEqual(await K.setForm(panel.id, ''), null);
  assert.strictEqual(await K.setForm(panel.id, 'a\nb\nc\nd\ne\nf'), null, 'six is too many');
  assert.strictEqual(await K.setForm(panel.id, 'x'.repeat(46)), null, 'too long for a pop-up label');
  assert.deepStrictEqual(await K.setForm(panel.id, 'Your rank?\r\n\r\nYour hero?'), ['Your rank?', 'Your hero?']);
  const saved = await K.getPanel(panel.id);
  assert.strictEqual(K.formModal(saved).toJSON().components.length, 2);
  const fields = { getTextInputValue: (id) => `answer ${id}` };
  assert.deepStrictEqual(K.answersOf(saved, fields), [{ q: 'Your rank?', a: 'answer q0' }, { q: 'Your hero?', a: 'answer q1' }]);
  await K.clearForm(panel.id);
  assert.deepStrictEqual((await K.getPanel(panel.id)).form, []);
});

test('close requests: one at a time, only an overdue one is swept', async () => {
  const sent = [];
  const channel = { id: 'ch1', send: async (m) => sent.push(m) };
  const ticket = { id: 'ch1', guildId: 'g4', number: 1, openerId: 'op', panelId: 'p', users: [], claimedBy: null };
  const { getStore } = require('../src/storage');
  await getStore('tickets').set('ch1', ticket);
  assert.deepStrictEqual(await K.requestClose(channel, ticket, { id: 'st' }, { delayHours: 2, reason: 'Done' }), { ok: true });
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].components[0].toJSON().components.map((c) => c.custom_id).every((id) => id.startsWith('ticket_creq:ch1:')));
  const saved = await K.getTicket('ch1');
  assert.ok(saved.closeRequest.closeAt > Date.now());
  assert.strictEqual((await K.requestClose(channel, saved, { id: 'st' })).reason, 'pending');

  const gone = { guilds: { cache: new Map([['g4', { channels: { fetch: async () => null } }]]) }, user: { username: 'bot' } };
  await K.sweep(gone, Date.now()); // not due yet
  assert.ok(await K.getTicket('ch1'), 'kept while the request is still open');
  await K.sweep(gone, saved.closeRequest.closeAt + 1); // due, but its channel is gone: the record is dropped
  assert.ok(!(await K.getTicket('ch1')));
  await K.clearRequest('ch1');
});

test('commands and routes are well formed', () => {
  assert.deepStrictEqual(ticket.data.toJSON().options.map((o) => o.name),
    ['open', 'close', 'closerequest', 'add', 'remove', 'rename', 'reopen', 'on-call', 'autoclose-exclude', 'claim', 'unclaim', 'transfer', 'switchpanel']);
  assert.ok(config.data.toJSON().options.length <= 25);
  const click = (id) => ({ isButton: () => true, isModalSubmit: () => false, customId: `${id}:abc` });
  const submit = (id) => ({ isButton: () => false, isModalSubmit: () => true, customId: `${id}:abc` });
  for (const id of ['ticket_open', 'ticket_close', 'ticket_claim', 'ticket_creq', 'ticket_fb']) assert.strictEqual(routes.filter((r) => r.matches(click(id))).length, 1, id);
  for (const id of ['ticket_form', 'ticket_formset', 'ticket_fbc', 'ticket_tagset']) assert.strictEqual(routes.filter((r) => r.matches(submit(id))).length, 1, id);
});

test('auto-close: inactivity, no staff answer, an excluded ticket', () => {
  const H = 3_600_000;
  const t = { createdAt: 0, lastMessageAt: 5 * H, firstResponseAt: null };
  assert.strictEqual(K.autocloseWhy({ inactiveHours: 0, noResponseHours: 0 }, t, 100 * H), null, 'off');
  assert.strictEqual(K.autocloseWhy(null, t, 100 * H), null);
  assert.ok(K.autocloseWhy({ inactiveHours: 24, noResponseHours: 0 }, t, 29 * H));
  assert.strictEqual(K.autocloseWhy({ inactiveHours: 24, noResponseHours: 0 }, t, 29 * H - 1), null, 'one hour short of 24 since the last message');
  assert.ok(K.autocloseWhy({ inactiveHours: 0, noResponseHours: 12 }, t, 12 * H));
  assert.strictEqual(K.autocloseWhy({ inactiveHours: 0, noResponseHours: 12 }, { ...t, firstResponseAt: H }, 99 * H), null, 'staff answered');
  assert.strictEqual(K.autocloseWhy({ inactiveHours: 1, noResponseHours: 1 }, { ...t, noAutoclose: true }, 99 * H), null, 'excluded');
});

test('feedback: only the opener rates, the rating and comment are kept', async () => {
  const { getStore } = require('../src/storage');
  await getStore('ticketFeedback').set('g5:7', { guildId: 'g5', number: 7, openerId: 'op', claimedBy: null, rating: null, comment: null, at: null });
  assert.strictEqual(await K.saveFeedback('g5', 7, 'someone', { rating: 5 }), null);
  assert.strictEqual(await K.saveFeedback('g5', 8, 'op', { rating: 5 }), null, 'no such ticket');
  assert.strictEqual((await K.saveFeedback('g5', 7, 'op', { rating: 4 })).rating, 4);
  const done = await K.saveFeedback('g5', 7, 'op', { comment: 'Quick help' });
  assert.deepStrictEqual([done.rating, done.comment], [4, 'Quick help']);
  assert.strictEqual((await K.getSettings('g5')).feedback, true, 'on by default');
});

test('tags: saved per server, ids are lowercase, limits hold', async () => {
  assert.strictEqual((await K.saveTag('g6', 'Bad id!', 'x')).reason, 'tagId');
  assert.strictEqual((await K.saveTag('g6', 'ok', '  ')).reason, 'tagText');
  assert.strictEqual((await K.saveTag('g6', 'ok', 'x'.repeat(2001))).reason, 'tagText');
  assert.ok((await K.saveTag('g6', 'Rules', 'Read #rules')).ok);
  assert.strictEqual((await K.getTag('g6', ' RULES ')).content, 'Read #rules');
  await K.saveTag('g6', 'rules', 'New text');
  assert.deepStrictEqual((await K.guildTags('g6')).map((t) => t.content), ['New text'], 'same id replaces');
  assert.deepStrictEqual(await K.guildTags('g7'), []);
  assert.strictEqual(await K.deleteTag('g6', 'rules'), true);
  assert.strictEqual(await K.deleteTag('g6', 'rules'), false);
  for (let i = 0; i < 100; i++) await K.saveTag('g8', `t${i}`, 'x');
  assert.strictEqual((await K.saveTag('g8', 'one-more', 'x')).reason, 'tagFull');
  assert.ok((await K.saveTag('g8', 't5', 'changed')).ok, 'changing one at the limit is fine');
});

test('stats: averages, claim counts, own numbers', () => {
  const H = 3_600_000;
  const history = [
    { openerId: 'a', claimedBy: 's1', createdAt: 0, firstResponseAt: H, firstResponseBy: 's1', closedAt: 4 * H },
    { openerId: 'b', claimedBy: 's1', createdAt: 0, firstResponseAt: 3 * H, firstResponseBy: 's2', closedAt: 2 * H },
    { openerId: 'a', claimedBy: 's2', createdAt: 0, firstResponseAt: null, firstResponseBy: null, closedAt: 6 * H },
  ];
  const feedback = [{ claimedBy: 's1', rating: 5 }, { claimedBy: 's1', rating: 4 }, { claimedBy: 's2', rating: null }];
  const server = K.serverStats(history, feedback, [{ openerId: 'c' }]);
  assert.deepStrictEqual([server.opened, server.open, server.closed], [4, 1, 3]);
  assert.strictEqual(server.response, 2 * H);
  assert.strictEqual(server.length, 4 * H);
  assert.deepStrictEqual(server.ratings, [5, 4]);
  assert.deepStrictEqual(server.top, [['s1', 2], ['s2', 1]]);
  const user = K.userStats('s1', history, feedback, [{ openerId: 's1', claimedBy: null }]);
  assert.deepStrictEqual([user.opened, user.claimed, user.response, user.ratings], [1, 2, H, [5, 4]]);
  assert.strictEqual(K.duration(null), 'None');
  assert.strictEqual(K.duration(90 * 60_000), '**1** h **30** min');
  assert.strictEqual(K.stars([]), 'None');
  assert.strictEqual(K.stars([5, 4]), '**4.5** out of **5** (**2** ratings)');
});

test('thread mode: no Claim button, on-call toggles, a closed thread ticket reopens by number', async () => {
  const ids = (row) => row.toJSON().components.map((c) => c.custom_id.split(':')[0]);
  assert.deepStrictEqual(ids(K.ticketButtons('c', false, true)), ['ticket_close']);
  assert.deepStrictEqual(ids(K.ticketButtons('c', false)), ['ticket_close', 'ticket_claim']);

  assert.strictEqual(await K.toggleOnCall('g9', 'u1'), true);
  assert.strictEqual(await K.toggleOnCall('g9', 'u2'), true);
  assert.strictEqual(await K.toggleOnCall('g9', 'u1'), false);
  assert.deepStrictEqual((await K.getSettings('g9')).onCall, ['u2']);

  const panel = await K.createPanel('g9', { name: 'Threads', channelId: 'c1', thread: true });
  assert.strictEqual((await K.getPanel(panel.id)).thread, true);
  await K.setPanelMode(panel.id, false);
  assert.strictEqual((await K.getPanel(panel.id)).thread, false);

  const { getStore } = require('../src/storage');
  const edits = [];
  const sent = [];
  const thread = { id: 't1', edit: async (o) => edits.push(o), send: async (m) => sent.push(m), toString: () => '<#t1>' };
  const guild = { id: 'g9', channels: { fetch: async (id) => (id === 't1' ? thread : null) } };
  await getStore('tickets').set('t1', { id: 't1', guildId: 'g9', number: 7, thread: true, closed: true, openerId: 'op', panelId: panel.id });
  await getStore('tickets').set('c2', { id: 'c2', guildId: 'g9', number: 8, thread: false, closed: false, openerId: 'op', panelId: panel.id });
  assert.strictEqual((await K.openTickets('g9')).length, 1, 'a closed thread ticket is not open');
  assert.strictEqual((await K.reopenTicket(guild, 8)).reason, 'noClosed', 'a channel ticket cannot be reopened');
  assert.strictEqual((await K.reopenTicket(guild, 99)).reason, 'noClosed');
  assert.strictEqual((await K.reopenTicket(guild, 7)).ok, true);
  assert.deepStrictEqual([edits[0].locked, edits[0].archived], [false, false]);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual((await K.getTicket('t1')).closed, false);
  assert.strictEqual((await K.openTickets('g9')).length, 2);
});
