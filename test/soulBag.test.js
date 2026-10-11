// Run: node --test
// Uses a throwaway data folder so the bot's real souls are never touched.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { shouldDrop, rollSouls, onGrab, BAG_MIN, BAG_MAX } = require('../src/utils/soulBag');
const { getUser, buyBoost, BOOST_PRICE } = require('../src/utils/xp');
const { getStore } = require('../src/storage');

const s = { bagChance: 2, bagCooldownMinutes: 60 };
const HOUR = 60 * 60 * 1000;

test('a bag drops on the chance, then not again until the cooldown is over', () => {
  const t = Date.now();
  assert.strictEqual(shouldDrop(s, t, 0.5), false); // rolled over the chance
  assert.strictEqual(shouldDrop({ ...s, bagChance: 0 }, t, 0), false); // off
  assert.strictEqual(shouldDrop(s, t, 0.019), true);
  assert.strictEqual(shouldDrop(s, t + HOUR - 1, 0), false); // on cooldown
  assert.strictEqual(shouldDrop(s, t + HOUR, 0), true);
});

test('a bag holds between BAG_MIN and BAG_MAX', () => {
  for (let i = 0; i < 1000; i++) {
    const souls = rollSouls();
    assert.ok(souls >= BAG_MIN && souls <= BAG_MAX);
  }
});

// A stand-in for a button press on the bag `messageId`.
const press = (userId, messageId) => {
  const sent = {};
  return { sent, message: { id: messageId }, user: { id: userId, toString: () => `<@${userId}>` }, reply: (m) => (sent.reply = m), update: (m) => (sent.update = m) };
};

test('only the first press gets the bag; a Soul Boost doubles it', async () => {
  const [a, b] = ['test-bag-a', 'test-bag-b'];
  for (const id of [a, b]) await getStore('xp').delete(id);

  const first = press(a, 'bag-1');
  const second = press(b, 'bag-1');
  await Promise.all([onGrab(first), onGrab(second)]); // both at once
  const got = (await getUser(a)).souls;
  assert.ok(got >= BAG_MIN && got <= BAG_MAX);
  assert.deepStrictEqual(first.sent.update.components, []);
  assert.strictEqual((await getUser(b)).souls, 0);
  assert.ok(second.sent.reply && !second.sent.update);

  await getStore('xp').set(b, { souls: BOOST_PRICE });
  await buyBoost(b);
  await onGrab(press(b, 'bag-2'));
  const boosted = (await getUser(b)).souls;
  assert.ok(boosted >= BAG_MIN * 2 && boosted <= BAG_MAX * 2);
  for (const id of [a, b]) await getStore('xp').delete(id);
});
