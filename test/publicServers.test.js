// Run: node --test (npm test). The bot works in any server: commands everywhere (Fairfax-only ones stay in Fairfax), the home
// server's emojis show in other servers, LFG is set up on request, and Hideouts stay a Fairfax feature.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { runInGuild } = require('../src/utils/guildContext');
const { GUILD_ID } = require('../src/config');
const { loadCommands } = require('../src/handlers/loadCommands');
const { commandBodies } = require('../src/deploy-commands');
const { emojiNamed } = require('../src/utils/guild');
const { heroEmoji } = require('../src/utils/heroes');
const lfg = require('../src/utils/server/lfg');
const { buyHideout } = require('../src/utils/shop/hideout');

class Coll extends Map {
  find(fn) { for (const v of this.values()) if (fn(v)) return v; return undefined; }
}
const guildWith = (id, emojiNames = [], client = {}) => ({
  id,
  client,
  emojis: { cache: new Coll(emojiNames.map((name, i) => [String(i), { id: String(i), name }])) },
});

test('commands go to every server, as server-only commands; the Fairfax-only ones go to Fairfax alone', () => {
  const { everywhere, home } = commandBodies(loadCommands());
  const names = (list) => list.map((c) => c.name);
  assert.deepStrictEqual(names(home).sort(), ['audit-log-config', 'farm-config', 'hideout-config', 'stream-config']);
  for (const name of ['rank', 'shop', 'lfg', 'lfg-config', 'mini-game', 'descend', 'souls', 'xp-config']) assert.ok(names(everywhere).includes(name), name);
  assert.ok(!names(everywhere).some((n) => names(home).includes(n)), 'nothing is registered twice');
  for (const c of [...everywhere, ...home]) {
    assert.deepStrictEqual(c.contexts, [0], `${c.name} works inside servers only`);
    assert.deepStrictEqual(c.integration_types, [0], `${c.name} is a server install`);
  }
});

test("the bot's emojis live in Fairfax and show in other servers; a server's own emoji wins", () => {
  const home = guildWith(GUILD_ID, ['haze', 'souls']);
  const client = { guilds: { cache: new Map([[GUILD_ID, home]]) } };
  const other = guildWith('other', ['souls'], client);
  assert.strictEqual(emojiNamed(other, 'haze').name, 'haze'); // from Fairfax
  assert.strictEqual(emojiNamed(other, 'souls'), other.emojis.cache.get('0')); // its own first
  assert.strictEqual(emojiNamed(other, 'nothing'), undefined);
  assert.deepStrictEqual(heroEmoji(other, 'haze'), { id: '0', name: 'haze' });
  assert.strictEqual(emojiNamed(guildWith('lonely'), 'haze'), undefined); // no client, no home: quietly nothing
});

test('LFG: the empty-lobby timeout is per server; a settings entry alone is not "set up"', async () => {
  assert.strictEqual(lfg.getTimeoutMinutes('a'), 5);
  await lfg.updateSettings('a', (s) => (s.timeoutMinutes = 20));
  await lfg.updateSettings('b', (s) => (s.timeoutMinutes = 2));
  assert.strictEqual(lfg.getTimeoutMinutes('a'), 20);
  assert.strictEqual(lfg.getTimeoutMinutes('b'), 2);
  assert.strictEqual(lfg.isSetUp(await lfg.getSettings('a')), false); // /lfg-config timeout made an entry, nothing else
  assert.strictEqual(lfg.isSetUp(null), false);
  assert.strictEqual(lfg.isSetUp({ lfgCategoryId: 'c', regions: { na: {} } }), true);
});

test('LFG setup in a new server makes the roles, the LFG category and one region channel, and can run twice', async () => {
  const created = { roles: [], channels: [] };
  let n = 0;
  const roles = new Coll();
  const channels = new Coll();
  const guild = {
    id: 'new-server',
    roles: { cache: roles, fetch: async () => {}, create: async ({ name }) => { const r = { id: `r${++n}`, name }; roles.set(r.id, r); created.roles.push(name); return r; } },
    channels: { cache: channels, fetch: async () => {}, create: async (o) => { const c = { id: `c${++n}`, ...o }; channels.set(c.id, c); created.channels.push(o.name); return c; } },
  };
  const cfg = await lfg.ensureInfrastructure(guild, { regions: { any: { label: 'Any', name: lfg.regionChannelName('Any') } } });
  assert.strictEqual(created.roles.length, lfg.RANKS.length + lfg.PING_ROLES.length);
  assert.deepStrictEqual(created.channels, ['LFG', 'lfg-any']);
  assert.deepStrictEqual(Object.keys(cfg.regions), ['any']);
  assert.strictEqual(lfg.isSetUp(await lfg.getSettings('new-server')), true);
  assert.strictEqual(lfg.getTimeoutMinutes('new-server'), 5);

  await lfg.ensureInfrastructure(guild); // again: finds everything, makes nothing
  assert.strictEqual(created.roles.length, lfg.RANKS.length + lfg.PING_ROLES.length);
  assert.strictEqual(created.channels.length, 2);
});

test('Hideouts are a Fairfax feature: buying one in another server is refused', async () => {
  const result = await runInGuild('other', () => buyHideout({ id: 'someone', guild: { id: 'other' } }));
  assert.strictEqual(result, 'away');
});
