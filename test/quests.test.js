// Run: node --test. Throwaway data folder, never the live data/.
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { track, activeQuests, weekOf, questsEmbed, DAILY_SOULS } = require('../src/utils/economy/quests');
const { changeSouls, getUser, resetAllSouls, totalSouls } = require('../src/utils/economy/xp');
const { history } = require('../src/utils/economy/soulsLedger');

const MON = new Date('2026-10-26T10:00:00Z'); // a Monday
const WED = new Date('2026-10-28T23:59:00Z');

test('3 dailies and 2 weeklies, the same all day and all week, new ones the next day', () => {
  const a = activeQuests(MON);
  assert.deepStrictEqual(a.map((q) => q.period), ['daily', 'daily', 'daily', 'weekly', 'weekly']);
  assert.deepStrictEqual(activeQuests(WED).filter((q) => q.period === 'weekly'), a.filter((q) => q.period === 'weekly')); // same week
  assert.deepStrictEqual(activeQuests(new Date(MON.getTime() + 3600_000)).map((q) => q.id), a.map((q) => q.id));
  assert.strictEqual(weekOf(WED), '2026-10-26');
  assert.strictEqual(weekOf(new Date('2026-11-01T12:00:00Z')), '2026-10-26'); // Sunday
});

test('a quest pays once when its goal is reached, and counts nothing after', async () => {
  const id = 'quest-a';
  const q = activeQuests(MON).find((x) => x.period === 'daily');
  assert.deepStrictEqual(await track(id, q.kind, q.goal - 1, MON), []);
  assert.strictEqual((await getUser(id)).souls, 0);
  assert.deepStrictEqual((await track(id, q.kind, 1, MON)).map((x) => x.id), [q.id]); // weekly goals are all bigger than 1
  assert.strictEqual((await getUser(id)).souls, DAILY_SOULS);
  const more = await track(id, q.kind, 5, MON);
  assert.ok(more.every((x) => x.period === 'weekly')); // the daily is not paid again; a weekly of the same kind may finish
  assert.strictEqual(history(id, 10).filter((r) => r.r === 'quest' && r.d === DAILY_SOULS).length, 1);
});

test("yesterday's progress is gone the next day, and a kind with no running quest counts nothing", async () => {
  const id = 'quest-b';
  const q = activeQuests(MON).find((x) => x.period === 'daily');
  await track(id, q.kind, q.goal - 1, MON);
  const tomorrow = new Date(MON.getTime() + 86_400_000);
  const same = activeQuests(tomorrow).find((x) => x.id === q.id);
  if (same) assert.deepStrictEqual(await track(id, q.kind, 1, tomorrow), same.goal === 1 ? [same] : []); // starts again from 0
  const unused = ['chat', 'game', 'fight', 'descend', 'trivia', 'urn', 'lockle'].find((k) => !activeQuests(MON).some((x) => x.kind === k));
  if (unused) assert.deepStrictEqual(await track(id, unused, 99, MON), []);
});

test('/quests shows the progress', async () => {
  const id = 'quest-c';
  const q = activeQuests(new Date()).find((x) => x.period === 'daily' && x.goal > 1);
  if (!q) return;
  await track(id, q.kind, 1);
  const text = (await questsEmbed(id)).data.fields.map((f) => f.value).join('\n');
  assert.ok(text.includes(`**1/${q.goal}** ${q.text}`));
});

test('reset-all takes every server balance to 0 with one ledger line each', async () => {
  await changeSouls('reset-a', 500, 'staff');
  await changeSouls('reset-b', 700, 'staff');
  const before = await totalSouls();
  assert.ok(before.members >= 2);
  const taken = await resetAllSouls();
  assert.deepStrictEqual(taken, before);
  assert.strictEqual((await getUser('reset-a')).souls, 0);
  assert.strictEqual((await getUser('reset-b')).souls, 0);
  assert.deepStrictEqual(history('reset-b', 1).map((r) => [r.r, r.d, r.b]), [['staff', -700, 0]]);
  assert.deepStrictEqual(await totalSouls(), { members: 0, souls: 0 });
});
