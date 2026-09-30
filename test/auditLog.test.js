// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { AuditLogEvent: A, EmbedBuilder, Collection } = require('discord.js');
const audit = require('../src/utils/auditLog');
const { handleEntry, permDiff } = require('../src/utils/auditEntries');
const memory = require('../src/utils/auditMessages');

// A server with the log channel, #general inside a category, and a fake Discord audit log.
const sent = [];
let auditEntries = [];
const LOG = '1554246639760318524';
const guild = {
  id: 'g',
  name: 'Fairfax',
  channels: { cache: new Collection([[LOG, { id: LOG, send: async (m) => sent.push(m) }], ['general', { id: 'general', parentId: 'cat' }]]) },
  roles: { cache: new Collection() },
  emojis: { cache: new Collection() },
  client: { user: { id: 'bot' }, users: { fetch: async (id) => ({ id, username: `user${id}` }) } },
  fetchAuditLogs: async () => ({ entries: new Collection(auditEntries.map((e) => [e.id, e])) }),
};
const post = (event, opts) => audit.log(guild, event, new EmbedBuilder().setTitle(event), opts);
const lastText = () => JSON.stringify(sent.at(-1).embeds[0].data);

test('log posts, and skips events that are off, ignored members/channels (and their category), and the log channel', async () => {
  sent.length = 0;
  await post('message-edit', { channelId: 'general', userIds: ['u1'] });
  assert.strictEqual(sent.length, 1);

  await audit.updateSettings((s) => s.off.push('message-edit'));
  await post('message-edit', { channelId: 'general' });
  await audit.updateSettings((s) => (s.off = []));

  await audit.updateSettings((s) => s.ignoredMembers.push('u1'));
  await post('message-delete', { userIds: [null, 'u1'] });
  await audit.updateSettings((s) => (s.ignoredMembers = []));

  await audit.updateSettings((s) => s.ignoredChannels.push('cat'));
  await post('message-delete', { channelId: 'general' });
  await audit.updateSettings((s) => (s.ignoredChannels = []));

  await post('reaction-add', { channelId: LOG });
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].allowedMentions, { parse: [] }); // log entries never ping anyone
});

test('permission changes read as gained / lost names', () => {
  const send = 1n << 11n;
  const kick = 1n << 1n;
  assert.deepStrictEqual(permDiff(String(kick), String(send)), { granted: ['Send Messages'], revoked: ['Kick Members'] });
  assert.deepStrictEqual(permDiff(undefined, String(send | kick)), { granted: ['Kick Members', 'Send Messages'], revoked: [] });
});

const entry = (fields) => ({ changes: [], extra: null, reason: null, targetType: 'User', actionType: 'Delete', target: null, ...fields });

test("the bot's own work isn't logged, but roles members pick from its menus are, marked self-picked", async () => {
  sent.length = 0;
  await handleEntry(entry({ action: A.ChannelCreate, executorId: 'bot', targetType: 'Channel', actionType: 'Create' }), guild);
  await handleEntry(entry({ action: A.MemberRoleUpdate, executorId: 'bot', targetId: 'u2', reason: 'Joined the server', changes: [{ key: '$add', new: [{ id: 'r', name: 'Citizen' }] }] }), guild);
  assert.strictEqual(sent.length, 0);

  const picked = { key: '$add', new: [{ id: 'r1', name: 'Europe' }] };
  await handleEntry(entry({ action: A.MemberRoleUpdate, executorId: 'bot', targetId: 'u2', reason: 'Self-picked from a #roles menu', changes: [picked] }), guild);
  assert.strictEqual(sent.length, 1);
  const { title, fields, footer } = sent.at(-1).embeds[0].data;
  assert.strictEqual(title, 'Member Roles Updated (Self-Picked)');
  assert.deepStrictEqual(fields.map((f) => [f.name, f.value]), [
    ['Member', '<@u2> `useru2` (`u2`)'],
    ['Added', '<@&r1>'],
    ['How', 'Picked from a #roles menu'],
    ['By', 'Themselves'],
  ]);
  assert.strictEqual(footer.text, 'User ID: u2');
});

test('a kick with no reason shows it in red and goes into the member history', async () => {
  sent.length = 0;
  await handleEntry(entry({ action: A.MemberKick, executorId: 'mod', targetId: 'u3' }), guild);
  assert.match(lastText(), /Member Kicked/);
  assert.match(lastText(), /No reason given/);
  const [record] = await audit.getHistory('u3');
  assert.strictEqual(record.text, 'Kicked by <@mod> `usermod` (`mod`) (no reason given)');
});

test('a timeout logs its length and a nickname change logs before and after', async () => {
  sent.length = 0;
  const until = new Date(Date.now() + 3_600_000).toISOString();
  await handleEntry(entry({ action: A.MemberUpdate, executorId: 'mod', targetId: 'u4', reason: 'spam', actionType: 'Update', changes: [{ key: 'communication_disabled_until', new: until }, { key: 'nick', old: 'a', new: 'b' }] }), guild);
  assert.strictEqual(sent.length, 2);
  const fieldsOf = (i) => Object.fromEntries(sent[i].embeds[0].data.fields.map((f) => [f.name, f.value]));
  assert.strictEqual(sent[0].embeds[0].data.title, 'Member Timed Out');
  assert.match(fieldsOf(0).Length, /^(1h|59m)/);
  assert.strictEqual(fieldsOf(0).Reason, 'spam');
  assert.strictEqual(sent[1].embeds[0].data.title, 'Nickname Changed');
  assert.deepStrictEqual([fieldsOf(1).Before, fieldsOf(1).After, fieldsOf(1).By], ['a', 'b', '<@mod> `usermod` (`mod`)']);
  assert.strictEqual((await audit.getHistory('u4')).length, 2);
});

test('the deleter is only blamed for a new or grown Discord delete entry', async () => {
  const del = (id, count, targetId = 'author') => ({ id, targetId, executorId: 'mod', extra: { count, channel: { id: 'general' } } });
  auditEntries = [del('e1', 1)];
  await audit.findDeleter(guild); // startup: remembers e1
  assert.strictEqual(await audit.findDeleter(guild, 'author', 'general'), null); // e1 is old
  auditEntries = [del('e1', 2)];
  assert.strictEqual(await audit.findDeleter(guild, 'author', 'general'), 'mod'); // grew: the mod deleted another
  auditEntries = [del('e1', 2), del('e2', 1, 'someone-else')];
  assert.strictEqual(await audit.findDeleter(guild, 'author', 'general'), null);
});

test('message memory keeps text and mentions, and forgets messages older than 7 days', async () => {
  const users = new Collection([['pinged', {}], ['author', {}]]);
  const message = (id, at) => ({
    id,
    channelId: 'general',
    createdTimestamp: at,
    content: `hi ${id}`,
    author: { id: 'author', username: 'author' },
    client: { user: { id: 'bot' } },
    mentions: { users, roles: new Collection(), everyone: false },
    attachments: new Collection(),
    stickers: new Collection(),
  });
  await memory.remember(message('new', Date.now()));
  await memory.remember(message('old', Date.now() - 8 * 86_400_000));
  assert.deepStrictEqual(memory.get('new').mentions, { users: ['pinged'], roles: [], everyone: false });
  memory.save();
  assert.strictEqual(memory.get('old'), null);
  assert.strictEqual(memory.take('new').content, 'hi new');
  assert.strictEqual(memory.get('new'), null);
});
