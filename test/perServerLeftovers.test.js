// Run: node --test (npm test). The in-memory rules that used to be one for the whole bot are now one per server,
// and the owner's override only works in the home server.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { runInGuild } = require('../src/utils/guildContext');
const { shouldDrop } = require('../src/utils/economy/soulBag');
const { chatCounts } = require('../src/utils/economy/xp');
const { requirePermission, requireOwner } = require('../src/utils/permissions');
const { OWNER_ID, GUILD_ID } = require('../src/config');

test('a Soul Bag cooldown belongs to one server: a bag in A does not hold back B', () => {
  const HOUR = 3_600_000;
  const s = { bagCooldownMinutes: 60, bagChance: 100 };
  assert.strictEqual(runInGuild('A', () => shouldDrop(s, HOUR * 10, 0)), true);
  assert.strictEqual(runInGuild('A', () => shouldDrop(s, HOUR * 10 + 1_000, 0)), false);
  assert.strictEqual(runInGuild('B', () => shouldDrop(s, HOUR * 10 + 1_000, 0)), true);
});

test('repeating yourself earns nothing in a server, but the same words in another server count', () => {
  const settings = { ignoredChannelIds: [], minLength: 0 };
  const say = (text) => ({ content: text, author: { id: 'talker' }, channel: { id: 'c' } });
  assert.strictEqual(runInGuild('A', () => chatCounts(say('gg'), settings)), true);
  assert.strictEqual(runInGuild('A', () => chatCounts(say('gg'), settings)), false);
  assert.strictEqual(runInGuild('B', () => chatCounts(say('gg'), settings)), true);
});

test("the owner passes staff gates in the home server only; /farm-config's gate is the owner anywhere", async () => {
  const fake = (userId, guildId, perms = false) => {
    const replies = [];
    return { user: { id: userId }, guildId, memberPermissions: { has: () => perms }, reply: async (p) => replies.push(p), replies };
  };
  assert.strictEqual(await requirePermission(fake(OWNER_ID, GUILD_ID), 1n), true);
  const away = fake(OWNER_ID, 'someone-elses-server');
  assert.strictEqual(await requirePermission(away, 1n), false);
  assert.match(away.replies[0].content, /permission/);
  assert.strictEqual(await requirePermission(fake(OWNER_ID, 'someone-elses-server', true), 1n), true); // with the permission, like anyone
  assert.strictEqual(await requirePermission(fake('admin', 'someone-elses-server', true), 1n), true);

  assert.strictEqual(await requireOwner(fake(OWNER_ID, 'someone-elses-server')), true);
  const admin = fake('admin', GUILD_ID, true);
  assert.strictEqual(await requireOwner(admin), false); // Manage Server is not enough
  assert.match(admin.replies[0].content, /bot owner/);
});
