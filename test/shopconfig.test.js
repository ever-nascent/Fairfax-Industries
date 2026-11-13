// Run: node --test. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser, BOOST_PRICE } = require('../src/utils/economy/xp');
const { shopConfig, updateShopConfig, ITEMS } = require('../src/utils/shop/shopSettings');
const { parseColor, buyColorRole } = require('../src/utils/shop/colorRole');
const routes = require('../src/components/shop');

const route = (name) => routes.find((r) => r.name === name);
const give = (id, user) => getStore('xp').set(id, { xp: 0, level: 0, souls: 0, cards: [], rejuvs: 0, boostUntil: 0, ...user });

test('defaults, then a changed price and a section turned off', async () => {
  let cfg = await shopConfig('g1');
  assert.strictEqual(cfg.price('boost'), BOOST_PRICE);
  assert.ok(cfg.on('color-role'));
  await updateShopConfig('g1', (s) => ({ ...s, prices: { boost: 5 }, off: ['rejuv'] }));
  cfg = await shopConfig('g1');
  assert.strictEqual(cfg.price('boost'), 5);
  assert.ok(!cfg.on('rejuv'));
  assert.strictEqual((await shopConfig('g2')).price('boost'), BOOST_PRICE); // another server is untouched
});

test('hex colors', () => {
  assert.strictEqual(parseColor('#E39A3B'), 0xe39a3b);
  assert.strictEqual(parseColor('e39a3b'), 0xe39a3b);
  assert.strictEqual(parseColor('#000000'), 1); // 0 would mean "no color" to Discord
  assert.strictEqual(parseColor('red'), null);
  assert.strictEqual(parseColor('#fff'), null);
});

test('Soul Boost sells at the server price and not when its section is off', async () => {
  const GUILD = require('../src/config').GUILD_ID;
  await updateShopConfig(GUILD, (s) => ({ ...s, prices: { boost: 7 } }));
  await give('c1', { souls: 10 });
  const press = (customId, userId) => {
    const followUp = [];
    const guild = { id: GUILD, roles: { everyone: { id: 'everyone' } }, members: { me: { id: 'bot' } }, emojis: { cache: { find: () => undefined, get: () => undefined } }, channels: { cache: new Map() } };
    return {
      followUp,
      interaction: {
        customId, user: { id: userId }, member: { id: userId, displayName: 'T', guild, user: { tag: 't' } },
        deferUpdate: async () => {}, editReply: async () => {}, reply: async () => {}, followUp: async (r) => followUp.push(r.embeds[0].data.description),
      },
    };
  };
  let p = press('shop_boost:c1', 'c1');
  await route('shop-boost').execute(p.interaction);
  assert.match(p.followUp[0], /Soul Boost bought/);
  assert.strictEqual((await getUser('c1')).souls, 3);

  await updateShopConfig(GUILD, (s) => ({ ...s, off: ['soul-boost'] }));
  p = press('shop_boost:c1', 'c1');
  await route('shop-boost').execute(p.interaction);
  assert.match(p.followUp[0], /not for sale/);
  assert.strictEqual((await getUser('c1')).souls, 3);
});

// A server that can make one role, enough for the Color Role.
function fakeMember(id) {
  const roles = new Map();
  const made = [];
  const guild = {
    id: 'cg', roles: { cache: Object.assign(new Map(), { }), create: async (o) => { const r = { id: `r${made.length}`, ...o, editable: true, edit: async (e) => Object.assign(r, e) }; made.push(r); guild.roles.cache.set(r.id, r); return r; } },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } } },
  };
  return { id, guild, user: { tag: 't' }, roles: { cache: roles, add: async (r) => roles.set(r.id, r) }, made };
}

test('Color Role: buy, then recolor for the lower price; a bad color costs nothing', async () => {
  await give('m1', { souls: 100 });
  const cfg = { price: (k) => ({ color: 60, recolor: 20 })[k], colorBelow: null };
  const member = fakeMember('m1');
  let r = await buyColorRole(member, 'The Don', 'nope', cfg);
  assert.deepStrictEqual(r, { ok: false, reason: 'color' });
  assert.strictEqual((await getUser('m1')).souls, 100);

  r = await buyColorRole(member, 'The Don', '#e39a3b', cfg);
  assert.ok(r.ok && !r.recolor);
  assert.strictEqual(member.made[0].color, 0xe39a3b);
  assert.strictEqual((await getUser('m1')).souls, 40);

  r = await buyColorRole(member, 'The Don', '#112233', cfg);
  assert.ok(r.ok && r.recolor);
  assert.strictEqual(member.made.length, 1);
  assert.strictEqual(member.made[0].color, 0x112233);
  assert.strictEqual((await getUser('m1')).souls, 20);

  r = await buyColorRole(member, 'The Don', '#445566', { ...cfg, price: () => 999 });
  assert.deepStrictEqual(r, { ok: false, reason: 'souls' });
  assert.ok(ITEMS.color.price > ITEMS.recolor.price);
});

test('the Color Role page draws, and an off section sends people to the first screen', async () => {
  const { SECTION_VIEWS } = require('../src/utils/shop/shop');
  const guild = { id: 'vg', roles: { cache: new Map() }, emojis: { cache: { find: () => undefined, get: () => undefined } } };
  const member = { id: 'v1', displayName: 'Viewer', guild };
  await give('v1', { souls: 5 });
  let page = await SECTION_VIEWS['color-role'](member);
  assert.match(page.components.at(-1).components[0].data.label, /^Buy \(/);
  await updateShopConfig('vg', (s) => ({ ...s, off: ['color-role'] }));
  page = await SECTION_VIEWS['color-role'](member);
  assert.ok(!page.components.at(-1).components[0].data.label?.startsWith('Buy'));
  assert.ok(!JSON.stringify(page.components).includes('color-role'));
});
