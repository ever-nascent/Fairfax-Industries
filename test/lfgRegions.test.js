// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { regionKey, regionChannelName, regionForChannel } = require('../src/utils/server/lfg');
const { splitMenuText, withIntro } = require('../src/utils/server/reactionRoles');

test('a region key comes from its name and is numbered when taken', () => {
  assert.strictEqual(regionKey('North America', {}), 'north-america');
  assert.strictEqual(regionKey('Europe', { europe: {} }), 'europe-2');
  assert.strictEqual(regionKey('Europe', { europe: {}, 'europe-2': {} }), 'europe-3');
  assert.strictEqual(regionKey('!!!', {}), 'region');
  assert.strictEqual(regionChannelName('Global'), 'lfg-global');
});

test('regionForChannel finds a region by its channel, whatever the channel is called', () => {
  const cfg = { regions: { na: { label: 'NA', channelId: '1' }, all: { label: 'Everyone', channelId: '2' } } };
  assert.deepStrictEqual(regionForChannel(cfg, '2'), { key: 'all', label: 'Everyone', channelId: '2' });
  assert.strictEqual(regionForChannel(cfg, '3'), null);
  assert.strictEqual(regionForChannel({}, '1'), null);
});

const MENU = 'Select your Region:\n\n> 🇪🇺 `-` <@&111111111111111111>\n> 🇺🇸 `-` <@&222222222222222222>';

test('a menu text splits into its intro and its option lines', () => {
  const { intro, options } = splitMenuText(MENU);
  assert.strictEqual(intro, 'Select your Region:');
  assert.strictEqual(options.length, 2);
  assert.deepStrictEqual(splitMenuText('> 🔥 `-` <@&1>'), { intro: '', options: ['> 🔥 `-` <@&1>'] });
});

test('changing a menu intro keeps the option lines; an empty intro removes it', () => {
  assert.strictEqual(withIntro(MENU, 'Pick one:'), `Pick one:\n\n${splitMenuText(MENU).options.join('\n')}`);
  assert.strictEqual(withIntro(MENU, ''), splitMenuText(MENU).options.join('\n'));
  assert.strictEqual(withIntro('Only an intro', ''), null);
  assert.strictEqual(withIntro('> 🔥 `-` <@&1>', 'New intro'), 'New intro\n\n> 🔥 `-` <@&1>');
});

test('the first start seeds the region list from the old seven, keeps their channels, and a removed region stays removed', async () => {
  const { Collection, ChannelType } = require('discord.js');
  const { ensureInfrastructure, getSettings, updateSettings } = require('../src/utils/server/lfg');
  const { getStore } = require('../src/storage');
  const channels = new Collection();
  const roles = new Collection();
  let next = 1000;
  const make = (cache) => async (options) => {
    const made = { id: String(next++), ...options };
    cache.set(made.id, made);
    return made;
  };
  const guild = {
    id: 'g',
    roles: { cache: roles, fetch: async () => {}, create: make(roles) },
    channels: { cache: channels, fetch: async () => {}, create: make(channels) },
  };
  // The old layout: seven fixed channels saved under regionChannels.
  const old = { id: 'old-na', name: 'lfg-na', type: ChannelType.GuildText };
  channels.set(old.id, old);
  await getStore('lfgSettings').set('g', { roles: {}, regionChannels: { na: old.id } });

  const first = await ensureInfrastructure(guild);
  assert.strictEqual(Object.keys(first.regions).length, 7);
  assert.strictEqual(first.regions.na.channelId, 'old-na');
  assert.strictEqual(first.regionChannels, undefined);

  // Remove all but one region, restart: they do not come back.
  await updateSettings('g', (s) => (s.regions = { na: s.regions.na }));
  const again = await ensureInfrastructure(guild);
  assert.deepStrictEqual(Object.keys(again.regions), ['na']);
  assert.strictEqual((await getSettings('g')).regions.na.channelId, 'old-na');
});
