// Run: node --test. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { MessageFlags } = require('discord.js');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/xp');
const { BOOST_PRICE, REJUV_PRICE, REJUV_MAX } = require('../src/utils/xp');
const { STYLES } = require('../src/utils/shop');
const { HIDEOUT_PRICE } = require('../src/utils/hideout');
const routes = require('../src/components/shop');

const route = (name) => routes.find((r) => r.name === name);
const give = (id, user) => getStore('xp').set(id, { xp: 0, level: 0, souls: 0, cards: [], rejuvs: 0, boostUntil: 0, ...user });

// A member in a server that only knows enough for the Shop to draw (and, for the Hideout, to fail making channels).
function press(customId, userId, { createFails = false } = {}) {
  const calls = { followUp: [], reply: [], edits: 0 };
  const guild = {
    id: 'g', roles: { everyone: { id: 'everyone' } }, members: { me: { id: 'bot' } },
    emojis: { cache: { find: () => undefined, get: () => undefined } },
    channels: { cache: new Map(), create: async () => { if (createFails) throw new Error('Missing Permissions'); throw new Error('unused'); } },
  };
  const interaction = {
    customId, user: { id: userId, tag: 't' }, member: { id: userId, displayName: 'Tester', guild, user: { tag: 't', username: 'tester' } },
    deferUpdate: async () => {}, editReply: async () => { calls.edits++; },
    reply: async (r) => calls.reply.push(r), followUp: async (r) => calls.followUp.push(r),
  };
  return { interaction, calls };
}
const text = (calls) => calls.followUp.map((f) => f.embeds[0].data.description).join('\n');

test('hero card: receipt on a buy, an explanation when they cannot afford it, and when they own it already', async () => {
  const price = STYLES.icon.price;
  await give('b1', { souls: price - 1 });
  let p = press('shop_buy:b1:haze:icon', 'b1');
  await route('shop-buy').execute(p.interaction);
  assert.match(text(p.calls), /costs .*and you don't have that much/);
  assert.strictEqual(p.calls.edits, 1); // the Shop was still redrawn
  assert.strictEqual(p.calls.followUp[0].flags, MessageFlags.Ephemeral);

  await give('b1', { souls: price });
  p = press('shop_buy:b1:haze:icon', 'b1');
  await route('shop-buy').execute(p.interaction);
  assert.match(text(p.calls), /You bought the \*\*Haze\*\* card \(Icon\) for .*on your `\/rank` now/);
  assert.strictEqual((await getUser('b1')).souls, 0);

  p = press('shop_buy:b1:haze:icon', 'b1');
  await route('shop-buy').execute(p.interaction);
  assert.match(text(p.calls), /You already own the \*\*Haze\*\* card/);
});

test('Soul Boost and Rejuv receipts, including the carrying limit', async () => {
  await give('b2', { souls: BOOST_PRICE + REJUV_PRICE * 5 });
  let p = press('shop_boost:b2', 'b2');
  await route('shop-boost').execute(p.interaction);
  assert.match(text(p.calls), /Soul Boost bought .* runs out <t:\d+:R>/);
  for (let i = 1; i <= REJUV_MAX; i++) {
    p = press('shop_rejuv:b2', 'b2');
    await route('shop-rejuv').execute(p.interaction);
    assert.match(text(p.calls), new RegExp(`carrying ${i} / ${REJUV_MAX}`));
  }
  p = press('shop_rejuv:b2', 'b2');
  await route('shop-rejuv').execute(p.interaction);
  assert.match(text(p.calls), /already carrying the max/);
  await give('b3', { souls: 1 });
  p = press('shop_boost:b3', 'b3');
  await route('shop-boost').execute(p.interaction);
  assert.match(text(p.calls), /you don't have that much/);
});

test('Hideout: why not (level, souls) and a thrown error is explained, with the Souls returned', async () => {
  await give('h1', { level: 5, souls: HIDEOUT_PRICE });
  let p = press('shop_hideout:h1', 'h1');
  await route('shop-hideout').execute(p.interaction);
  assert.match(text(p.calls), /needs level 20/);
  await give('h2', { xp: 1e6, level: 30, souls: 1 });
  p = press('shop_hideout:h2', 'h2');
  await route('shop-hideout').execute(p.interaction);
  assert.match(text(p.calls), /costs .*you don't have that much/);

  await give('h3', { xp: 1e6, level: 30, souls: HIDEOUT_PRICE });
  p = press('shop_hideout:h3', 'h3', { createFails: true });
  const logged = console.error;
  console.error = () => {}; // the failure is logged on purpose
  await route('shop-hideout').execute(p.interaction);
  console.error = logged;
  assert.match(text(p.calls), /Something went wrong making your Hideout, and any Souls taken were returned/);
  assert.strictEqual((await getUser('h3')).souls, HIDEOUT_PRICE);
  assert.strictEqual(await getStore('hideouts').get('h3'), null);
});

test("someone else's Shop: told to open their own, nothing bought, no receipt", async () => {
  await give('o1', { souls: BOOST_PRICE });
  const p = press('shop_boost:o1', 'intruder');
  await route('shop-boost').execute(p.interaction);
  assert.strictEqual(p.calls.followUp.length, 0);
  assert.match(p.calls.reply[0].content, /Open your own/);
  assert.strictEqual((await getUser('o1')).souls, BOOST_PRICE);
});
