// Run: node --test. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.NO_QUESTS = '1';
const test = require('./group')(__filename);
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/economy/xp');
const { shopConfig, updateShopConfig } = require('../src/utils/shop/shopSettings');
const { DEAL_OFF, dealOf, buyDeal } = require('../src/utils/shop/dailyDeal');
const { dealView, SECTIONS } = require('../src/utils/shop/shop');
const routes = require('../src/components/shop');

const DAY = 86_400_000;
const START = Date.parse('2026-11-13T12:00:00Z');
const give = (id, user) => getStore('xp').set(id, { xp: 0, level: 0, souls: 0, cards: [], rejuvs: 0, boostUntil: 0, ...user });
// the first day from START whose deal in server `g` is `key`
const dayWith = (cfg, g, key) => { for (let i = 0; i < 400; i++) if (dealOf(cfg, g, START + i * DAY).key === key) return START + i * DAY; throw new Error(`no ${key} day`); };

test('one deal a day per server, from the date: every kind turns up, at the discount, never from a section that is off', async () => {
  const cfg = await shopConfig('d1');
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const now = START + i * DAY;
    const deal = dealOf(cfg, 'd1', now);
    assert.deepStrictEqual(deal, dealOf(cfg, 'd1', now + 3600_000), 'the same all day');
    assert.strictEqual(deal.price, Math.round(cfg.price(deal.key) * (1 - DEAL_OFF)));
    assert.strictEqual(deal.endsAt, Date.parse(deal.day) + DAY);
    assert.strictEqual(!!deal.slug, deal.key === 'icon' || deal.key === 'portrait', 'only a Hero Card names a hero');
    seen.add(deal.key);
  }
  assert.deepStrictEqual([...seen].sort(), ['boost', 'icon', 'portrait', 'rejuv']);
  const thing = (g, i) => { const d = dealOf(cfg, g, START + i * DAY); return `${d.key}:${d.slug}`; };
  assert.ok(Array.from({ length: 30 }, (_, i) => i).some((i) => thing('d1', i) !== thing('d2', i)), 'another server has its own');

  await updateShopConfig('d3', (s) => ({ ...s, off: ['hero-cards', 'rejuv'], prices: { boost: 1000 } }));
  const some = await shopConfig('d3');
  for (let i = 0; i < 30; i++) assert.deepStrictEqual([dealOf(some, 'd3', START + i * DAY).key, dealOf(some, 'd3', START + i * DAY).price], ['boost', 750], "the server's own price");
  await updateShopConfig('d3', (s) => ({ ...s, off: ['hero-cards', 'rejuv', 'soul-boost'] }));
  assert.strictEqual(dealOf(await shopConfig('d3'), 'd3', START), null, 'nothing it could be');
});

test('buying: the deal price, once a day; a buy that fails gives the day back', async () => {
  const cfg = await shopConfig('d1');
  const now = dayWith(cfg, 'd1', 'boost');
  const deal = dealOf(cfg, 'd1', now);
  await give('b1', { souls: deal.price - 1 });
  assert.deepStrictEqual(await buyDeal('b1', deal, now), { ok: false, reason: 'souls' });
  assert.strictEqual((await getUser('b1')).dealDay, null, 'not used up by a buy they could not afford');
  await give('b1', { souls: deal.price * 2 });
  const [a, b] = await Promise.all([buyDeal('b1', deal, now), buyDeal('b1', deal, now)]); // two clicks at once
  assert.ok(a.ok && b.reason === 'used');
  assert.strictEqual((await getUser('b1')).souls, deal.price);
  assert.ok((await getUser('b1')).boostUntil > now);
  const tomorrow = dealOf(cfg, 'd1', dayWith(cfg, 'd1', 'rejuv'));
  assert.ok(tomorrow.day !== deal.day && (await buyDeal('b1', tomorrow)).ok === (deal.price >= tomorrow.price), 'another day is another deal');

  const cardDay = dayWith(cfg, 'd1', 'icon');
  const card = dealOf(cfg, 'd1', cardDay);
  await give('b2', { souls: 1e6, cards: [`${card.slug}:icon`] });
  assert.strictEqual((await buyDeal('b2', card)).reason, 'owned');
  assert.strictEqual((await getUser('b2')).souls, 1e6);
  await give('b3', { souls: card.price });
  assert.ok((await buyDeal('b3', card)).ok);
  assert.deepStrictEqual([(await getUser('b3')).souls, (await getUser('b3')).card], [0, `${card.slug}:icon`]);
});

test('the screen and the button: each kind has a page, the receipt names the deal price, the button greys out once taken', async () => {
  const GUILD = require('../src/config').GUILD_ID;
  const guild = { id: GUILD, roles: { everyone: { id: 'everyone' } }, members: { me: { id: 'bot' } }, emojis: { cache: { find: () => undefined, get: () => undefined } }, channels: { cache: new Map() } };
  const member = (id) => ({ id, displayName: 'T', guild, user: { tag: 't' } });
  const cfg = await shopConfig(GUILD);
  assert.strictEqual(SECTIONS[0].value, 'daily-deal');
  await give('s1', { souls: 1e6 });
  for (const key of ['icon', 'portrait', 'boost', 'rejuv']) {
    const now = dayWith(cfg, GUILD, key);
    const deal = dealOf(cfg, GUILD, now);
    const page = await dealView(member('s1'), now);
    const embed = page.embeds[0].toJSON();
    assert.ok(embed.description.includes(`<t:${deal.endsAt / 1000}:R>`) && embed.description.length < 4096, key);
    assert.ok(page.files.some((f) => embed.image.url === `attachment://${f.name}`), 'the picture is attached');
    const [menu, buttons] = page.components.map((r) => r.toJSON().components);
    assert.strictEqual(menu[0].options.find((o) => o.default).value, 'daily-deal');
    assert.deepStrictEqual([buttons[0].custom_id, buttons[0].disabled], ['shop_deal:s1', false]);
    assert.ok(buttons[0].label.includes(deal.price.toLocaleString('en-US')), `${key}: the button shows the deal price`);
  }

  // today's deal through the button
  const today = dealOf(cfg, GUILD);
  const followUp = [];
  const interaction = { customId: 'shop_deal:s1', user: { id: 's1' }, member: member('s1'), isButton: () => true, deferUpdate: async () => {}, editReply: async () => {}, reply: async () => {}, followUp: async (r) => followUp.push(r.embeds[0].data.description) };
  const route = routes.find((r) => r.name === 'shop-deal');
  assert.ok(route.matches(interaction));
  await route.execute(interaction);
  assert.match(followUp[0], /bought/i);
  assert.strictEqual((await getUser('s1')).souls, 1e6 - today.price);
  await route.execute(interaction);
  assert.match(followUp[1], /already took today's deal/);
  assert.strictEqual((await getUser('s1')).souls, 1e6 - today.price);
  const after = await dealView(member('s1'));
  assert.ok(after.components[1].toJSON().components[0].disabled && /You took today's deal/.test(after.embeds[0].toJSON().description));

  await updateShopConfig(GUILD, (s) => ({ ...s, off: ['daily-deal'] }));
  await give('s2', { souls: 1e6 });
  await route.execute({ ...interaction, customId: 'shop_deal:s2', user: { id: 's2' }, member: member('s2') });
  assert.match(followUp[2], /not for sale/);
  assert.strictEqual((await getUser('s2')).souls, 1e6);
});
