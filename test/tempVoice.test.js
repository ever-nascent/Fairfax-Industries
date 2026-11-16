// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const tv = require('../src/utils/server/tempVoice');

const guild = { id: 'g', roles: { everyone: { id: 'everyone' } }, members: { me: { id: 'bot' }, cache: new Map() }, maximumBitrate: 96000 };
const sets = [];
const ch = (id, members) => ({ id, guild, members: new Map(members.map((m) => [m, { user: {}, voice: { setChannel: async () => null } }])), setUserLimit: async () => null, permissionOverwrites: { set: async (o) => sets.push(o) } });
const who = (id, channel) => ({ id, guild, displayName: id, voice: { channel } });
const rec = (extra = {}) => ({ guildId: 'g', ownerId: 'owner', trusted: [], blocked: [], invited: [], locked: false, hidden: false, ...extra });

test('only the owner controls a channel; lock, trust and block change who gets in', async () => {
  const room = ch('r1', ['owner', 'guest']);
  await tv.rooms().set('r1', rec());
  assert.match(await tv.act(who('guest', room), 'lock'), /Only the owner/);
  assert.match(await tv.act(who('stranger', null), 'lock'), /Join your temporary/);
  assert.match(await tv.act(who('owner', room), 'lock'), /Locked/);
  assert.ok((await tv.rooms().get('r1')).locked);
  await tv.act(who('owner', room), 'trust', ['friend']);
  await tv.act(who('owner', room), 'block', ['guest']);
  const saved = await tv.rooms().get('r1');
  assert.deepStrictEqual([saved.trusted, saved.blocked], [['friend'], ['guest']]);
  const last = sets.at(-1);
  assert.ok(last.find((o) => o.id === 'everyone').deny.length === 1); // Connect denied while locked
  assert.ok(last.find((o) => o.id === 'friend').allow.length === 2);
  assert.ok(last.find((o) => o.id === 'guest').deny.length === 2);
  assert.match(await tv.act(who('owner', room), 'limit', 120), /0.*99/);
});

test('claim needs the owner to be gone, and transfer hands the channel over', async () => {
  const room = ch('r2', ['owner', 'guest']);
  await tv.rooms().set('r2', rec());
  assert.match(await tv.act(who('guest', room), 'claim'), /still in the channel/);
  await tv.act(who('owner', room), 'transfer', ['guest']);
  assert.strictEqual((await tv.rooms().get('r2')).ownerId, 'guest');
  room.members.delete('guest');
  assert.match(await tv.act(who('owner', ch('r2', ['owner'])), 'claim'), /own this channel/);
});
