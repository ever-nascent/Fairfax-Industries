// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { PermissionFlagsBits: P } = require('discord.js');
const { getStore } = require('../src/storage');
const { changeSouls } = require('../src/utils/xp');
const hideout = require('../src/utils/hideout');

const guild = { roles: { everyone: { id: 'everyone' } }, members: { me: { id: 'bot' } } };

test('text channel names follow the voice name', () => {
  assert.strictEqual(hideout.textName("Zechariah's Hideout"), 'zechariahs-hideout');
  assert.strictEqual(hideout.textName('  The Den!! '), 'the-den');
  assert.strictEqual(hideout.textName('!!!'), 'hideout');
});

test('only the owner and their members get in, and nobody while the owner is gone', () => {
  const h = { members: ['friend'] };
  const ids = (list) => list.filter((o) => o.allow?.includes(P.ViewChannel)).map((o) => o.id);
  const present = hideout.overwrites(guild, 'owner', h);
  assert.ok(present.find((o) => o.id === 'everyone').deny.includes(P.ViewChannel));
  assert.deepStrictEqual(ids(present), ['bot', 'owner', 'friend']);
  assert.deepStrictEqual(ids(hideout.overwrites(guild, 'owner', h, false)), ['bot']);
});

// A server that records the channels the bot makes and deletes.
function fakeServer() {
  let next = 100;
  const cache = new Map();
  const made = [];
  const access = {}; // channel name -> ids let in by the last permission change
  const g = {
    ...guild,
    emojis: { cache: { find: () => undefined } },
    members: { me: { id: 'bot' }, cache: new Map(), fetch: async (id) => (id === 'gone' ? Promise.reject(new Error('left')) : { id }) },
    channels: {
      cache,
      create: async (opts) => {
        const id = String(next++);
        const channel = {
          id, ...opts,
          permissionOverwrites: { list: opts.permissionOverwrites, set: async (list) => (access[opts.name] = list.map((o) => o.id)) },
          send: async () => ({ id: `msg${id}`, pin: async () => {} }),
          delete: async () => cache.delete(id),
        };
        cache.set(id, channel);
        made.push(channel);
        return channel;
      },
    },
  };
  return { g, made, access };
}

test('a Hideout channel deleted by hand is made again (same name, members, a new pinned panel); remove ends it for good', async () => {
  const { g, made } = fakeServer();
  const store = getStore('hideouts');
  const h = await hideout.makeChannels(g, 'owner', { name: "Zechariah's Hideout", members: ['friend'], renamedAt: 0 });
  await store.set('owner', h);
  assert.deepStrictEqual(made.map((c) => c.name), ["Zechariah's Hideout", 'zechariahs-hideout']);

  g.channels.cache.delete(h.textId); // staff deleted the text channel
  await hideout.channelDeleted(g, h.textId);
  const after = await store.get('owner');
  assert.strictEqual(after.voiceId, h.voiceId); // the voice channel was left alone
  assert.notStrictEqual(after.textId, h.textId);
  assert.strictEqual(made.at(-1).name, 'zechariahs-hideout');
  assert.ok(made.at(-1).permissionOverwrites.list.some((o) => o.id === 'friend'));

  assert.ok(await hideout.removeHideout(g, 'owner'));
  assert.strictEqual(await store.get('owner'), null);
  assert.strictEqual(g.channels.cache.size, 0);
  await hideout.channelDeleted(g, after.voiceId); // the delete events that follow don't remake anything
  assert.strictEqual(g.channels.cache.size, 0);
  assert.strictEqual(await hideout.removeHideout(g, 'owner'), false);
});

test('startup catches up: a missing channel is remade, an owner who left is hidden', async () => {
  const { g, access } = fakeServer();
  const store = getStore('hideouts');
  for (const owner of ['gone', 'here']) {
    const h = await hideout.makeChannels(g, owner, { name: `${owner}'s Hideout`, members: [], renamedAt: 0 });
    await store.set(owner, h);
  }
  g.channels.cache.delete((await store.get('here')).voiceId); // deleted while the bot was off
  await hideout.reconcile(g);
  assert.ok(g.channels.cache.has((await store.get('here')).voiceId));
  assert.ok(!access['gones-hideout'].includes('gone')); // owner left: hidden
  assert.ok(access['heres-hideout'].includes('here'));
  await store.delete('gone');
  await store.delete('here');
});

test('buying: level 20 needed, souls needed, one per member', async () => {
  const member = { id: 'buyer', guild };
  assert.strictEqual(await hideout.buyHideout(member), 'level');
  await getStore('xp').set('buyer', { xp: 1e6, level: 30, souls: 100 });
  assert.strictEqual(await hideout.buyHideout(member), 'souls');
  assert.strictEqual(await hideout.getHideout('buyer'), null); // the held spot is let go
  await getStore('hideouts').set('buyer', { voiceId: 'v', textId: 't', members: [], renamedAt: 0 });
  await changeSouls('buyer', 10_000);
  assert.strictEqual(await hideout.buyHideout(member), 'owned');
});
