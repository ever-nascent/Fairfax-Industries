// Run: node --test
// Uses a throwaway data folder so the bot's real XP is never touched.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { progress, xpToNext, soulsFor, addXp, claimUrn, getUser, applyEdit, editUser, MAX_LEVEL } = require('../src/utils/xp');
const { getStore } = require('../src/storage');

test('level curve', () => {
  assert.deepStrictEqual(progress(0), { level: 0, into: 0, need: 100 });
  assert.deepStrictEqual(progress(100), { level: 1, into: 0, need: 155 });
  assert.strictEqual(progress(4675).level, 10);
  assert.strictEqual(progress(1e12).level, MAX_LEVEL);
  assert.strictEqual(xpToNext(0), 100);
  assert.deepStrictEqual([soulsFor(1), soulsFor(10), soulsFor(99)], [25, 791, 24626]);
});

test('addXp pays souls per level and respects cooldown', async () => {
  const id = 'test-user-xp';
  await getStore('xp').delete(id);
  const r = await addXp(id, 255, { fromChat: true, cooldownSeconds: 60 }); // level 0 -> 2
  assert.deepStrictEqual(r.gained, [1, 2]);
  assert.strictEqual(r.souls, soulsFor(1) + soulsFor(2));
  assert.strictEqual(await addXp(id, 50, { fromChat: true, cooldownSeconds: 60 }), null); // on cooldown
  assert.strictEqual((await getUser(id)).xp, 255);
  await getStore('xp').delete(id);
});

test('urn streak grows, caps at 7 days, resets after a missed day', async () => {
  const id = 'test-user-urn';
  await getStore('xp').delete(id);
  const day = (n) => new Date(Date.UTC(2026, 0, n, 12));
  const got = [];
  for (let d = 1; d <= 9; d++) got.push((await claimUrn(id, day(d))).souls);
  assert.deepStrictEqual(got, [100, 120, 140, 160, 180, 200, 220, 220, 220]);
  assert.strictEqual((await claimUrn(id, day(9))).claimed, false); // twice in one day
  assert.strictEqual((await claimUrn(id, day(11))).souls, 100); // skipped day 10
  await getStore('xp').delete(id);
});

test('applyEdit: pure, level follows XP, no souls paid, floors at 0', () => {
  const start = Object.freeze({ xp: 100, level: 1, souls: 50 });
  assert.deepStrictEqual(applyEdit(start, { stat: 'xp', action: 'add', amount: 4575 }), { xp: 4675, level: 10, souls: 50 });
  assert.deepStrictEqual(applyEdit(start, { stat: 'xp', action: 'subtract', amount: 1e9 }), { xp: 0, level: 0, souls: 50 });
  assert.deepStrictEqual(applyEdit(start, { stat: 'souls', action: 'set', amount: 7 }), { xp: 100, level: 1, souls: 7 });
  assert.deepStrictEqual(applyEdit(start, { stat: 'souls', action: 'reset' }), { xp: 100, level: 1, souls: 0 });
  assert.deepStrictEqual(start, { xp: 100, level: 1, souls: 50 }); // input untouched
});

test('editUser saves the edit', async () => {
  const id = 'test-user-edit';
  await getStore('xp').delete(id);
  const u = await editUser(id, { stat: 'xp', action: 'add', amount: 255 });
  assert.deepStrictEqual([u.xp, u.level, u.souls], [255, 2, 0]);
  assert.strictEqual((await getUser(id)).xp, 255);
  await getStore('xp').delete(id);
});

test('buying and equipping hero cards', async () => {
  const { buyCard, equipCard, changeSouls } = require('../src/utils/xp');
  const id = 'test-user-cards';
  await getStore('xp').delete(id);
  await changeSouls(id, 1000);
  assert.deepStrictEqual(await buyCard(id, 'haze:portrait', 3200), { ok: false, reason: 'souls' });
  const r = await buyCard(id, 'haze:icon', 800);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([r.user.souls, r.user.cards, r.user.card], [200, ['haze:icon'], 'haze:icon']);
  assert.deepStrictEqual(await buyCard(id, 'haze:icon', 800), { ok: false, reason: 'owned' }); // no double charge
  assert.strictEqual(await equipCard(id, 'wraith:icon'), false); // not owned
  assert.strictEqual(await equipCard(id, null), true);
  assert.strictEqual((await getUser(id)).card, null);
  assert.strictEqual(await equipCard(id, 'haze:icon'), true);
  const u = await getUser(id);
  assert.deepStrictEqual([u.souls, u.card], [200, 'haze:icon']);
  await getStore('xp').delete(id);
});

test('Soul Boost: 1 hour per buy, stacks by adding time; doubles XP, level-up souls, urn and trivia souls', async () => {
  const { buyBoost, triviaAnswer, changeSouls, BOOST_PRICE, BOOST_MS } = require('../src/utils/xp');
  const id = 'test-user-boost';
  await getStore('xp').delete(id);
  assert.deepStrictEqual(await buyBoost(id), { ok: false, reason: 'souls' });
  await changeSouls(id, BOOST_PRICE * 2);
  const now = Date.now();
  const first = await buyBoost(id, now);
  assert.strictEqual(first.user.boostUntil, now + BOOST_MS);
  assert.strictEqual((await buyBoost(id, now + 1000)).user.boostUntil, now + 2 * BOOST_MS); // adds an hour
  assert.strictEqual((await getUser(id)).souls, 0);

  const r = await addXp(id, 50); // 100 XP with the boost: level 0 -> 1
  assert.deepStrictEqual([r.user.xp, r.gained, r.souls], [100, [1], soulsFor(1) * 2]);
  assert.strictEqual((await triviaAnswer(id, true, new Date(now))).souls, 50); // 25, doubled
  const urn = await claimUrn(id, new Date(now));
  assert.strictEqual(urn.souls, 200); // day 1 = 100, doubled

  await getStore('xp').update(id, (u) => ({ ...u, boostUntil: now - 1 })); // ran out
  assert.strictEqual((await triviaAnswer(id, true, new Date(now))).souls, 30); // 2 in a row
  await getStore('xp').delete(id);
});

test('Rejuv: max 3; a broken 2+ day urn streak asks first, then Use Rejuv saves it or Start Over keeps the Rejuv', async () => {
  const { buyRejuv, changeSouls, REJUV_PRICE } = require('../src/utils/xp');
  const id = 'test-user-rejuv';
  await getStore('xp').delete(id);
  assert.deepStrictEqual(await buyRejuv(id), { ok: false, reason: 'souls' });
  await changeSouls(id, REJUV_PRICE * 4);
  for (let i = 0; i < 3; i++) assert.ok((await buyRejuv(id)).ok);
  assert.deepStrictEqual(await buyRejuv(id), { ok: false, reason: 'full' });
  assert.strictEqual((await getUser(id)).souls, REJUV_PRICE);

  const day = (d) => new Date(`2026-09-${d}T12:00:00Z`);
  await claimUrn(id, day(10));
  await claimUrn(id, day(11)); // 2-day streak
  const ask = await claimUrn(id, day(14)); // missed 2 days
  assert.deepStrictEqual([ask.claimed, ask.ask], [false, true]);
  const saved = await claimUrn(id, day(14), { rejuv: true });
  assert.deepStrictEqual([saved.claimed, saved.rejuvUsed, saved.user.urnStreak, saved.user.rejuvs], [true, true, 3, 2]);
  assert.strictEqual((await claimUrn(id, day(14), { rejuv: true })).claimed, false); // already claimed today

  await claimUrn(id, day(20), { rejuv: false }); // start over: streak 1, Rejuv kept
  const u = await getUser(id);
  assert.deepStrictEqual([u.urnStreak, u.rejuvs], [1, 2]);
  assert.strictEqual((await claimUrn(id, day(22))).ask, undefined); // a 1-day streak isn't worth asking about
  await getStore('xp').delete(id);
});

test('trivia: a streak pays 25, 30 ... 70 (max 10), wrong resets it, 10 paid answers per UTC day', async () => {
  const { triviaAnswer, triviaOdds } = require('../src/utils/xp');
  const id = 'test-user-trivia';
  await getStore('xp').delete(id);
  const day1 = new Date('2026-09-28T12:00:00Z');
  const paid = [];
  for (let i = 0; i < 12; i++) paid.push((await triviaAnswer(id, true, day1)).souls);
  assert.deepStrictEqual(paid, [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 0, 0]); // 11th and 12th: today's 10 are used
  let user = await getUser(id);
  assert.strictEqual(user.triviaStreak, 10); // capped
  assert.deepStrictEqual(triviaOdds(user, day1), { left: 0, souls: 0 });

  const day2 = new Date('2026-09-29T00:00:01Z'); // new UTC day: pays again, streak carries over
  assert.deepStrictEqual(triviaOdds(user, day2), { left: 10, souls: 70 });
  assert.strictEqual((await triviaAnswer(id, true, day2)).souls, 70);
  const wrong = await triviaAnswer(id, false, day2);
  assert.deepStrictEqual([wrong.streak, wrong.souls], [0, 0]);
  assert.strictEqual((await triviaAnswer(id, true, day2)).souls, 25);
  assert.strictEqual((await getUser(id)).souls, 25 + 30 + 35 + 40 + 45 + 50 + 55 + 60 + 65 + 70 + 70 + 25);
  await getStore('xp').delete(id);
});
