// Run: node --test (npm test). Player data is per server: the same member in two servers has two separate records.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.NO_QUESTS = '1';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('./group')(__filename);
const assert = require('node:assert');
const { getStore, getRawStore } = require('../src/storage');
const { runInGuild } = require('../src/utils/guildContext');
const { getUser, changeSouls, leaderboard, standing } = require('../src/utils/economy/xp');
const { history, report } = require('../src/utils/economy/soulsLedger');
const { migratePerServer } = require('../src/utils/economy/perServer');
const { expireGames } = require('../src/utils/games/casino');
const { GUILD_ID } = require('../src/config');

test('the same member has separate souls, XP, ledger and ranking in each server', async () => {
  await runInGuild('A', () => changeSouls('u1', 500, 'staff'));
  await runInGuild('B', () => changeSouls('u1', 70, 'staff'));
  await runInGuild('B', () => changeSouls('u2', 900, 'staff'));
  assert.strictEqual(await runInGuild('A', async () => (await getUser('u1')).souls), 500);
  assert.strictEqual(await runInGuild('B', async () => (await getUser('u1')).souls), 70);
  assert.strictEqual(await runInGuild('C', async () => (await getUser('u1')).souls), 0);
  // a server's list only holds its own members, with plain user ids
  assert.deepStrictEqual(await runInGuild('A', async () => Object.keys(await getStore('xp').all())), ['u1']);
  assert.deepStrictEqual(await runInGuild('B', async () => Object.keys(await getStore('xp').all()).sort()), ['u1', 'u2']);
  const board = await runInGuild('A', () => leaderboard(10, 'souls'));
  assert.deepStrictEqual(board.map((e) => e.userId ?? e.id), ['u1']);
  assert.strictEqual((await runInGuild('A', () => standing('u1', 'souls'))).total, 1);
  // the ledger is per server too
  assert.deepStrictEqual(runInGuild('A', () => history('u1', 5)).map((e) => e.d), [500]);
  assert.deepStrictEqual(runInGuild('B', () => history('u1', 5)).map((e) => e.d), [70]);
  assert.strictEqual(runInGuild('A', () => report(0)).rows[0].in, 500);
});

test('work with no server set fails loudly instead of touching someone', () => {
  const code = "require('./src/utils/economy/xp').getUser('u1').then(() => process.exit(0), (e) => { console.log(e.message); process.exit(3); })";
  assert.throws(() => execFileSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env }, stdio: 'pipe' }), (e) => e.status === 3 && /no server set/.test(String(e.stdout)));
});

test('the one-time move: backs up, rekeys to Fairfax, keeps the shared Lockle build, stamps open games, runs once', async () => {
  const dir = process.env.DATA_DIR;
  await getRawStore('xp').set('111', { xp: 5, souls: 123 });
  await getRawStore('farm').set('111', { hero: 'Haze' });
  await getRawStore('quests').set('111', { day: '2026-10-30', p: {} });
  await getRawStore('lockle').set('daily', { day: '2026-10-30', build: {} });
  await getRawStore('lockle').set('111', { day: '2026-10-30', over: true });
  await getRawStore('hideouts').set('111', { voiceId: 'v' });
  await getRawStore('doormanGames').set('g1', { userId: '111', bet: 100 });
  fs.writeFileSync(path.join(dir, 'soulsLedger.jsonl'), `${JSON.stringify({ t: 1, u: '111', d: 5, b: 5, r: 'urn' })}\n`);

  assert.strictEqual(await migratePerServer(), true);
  const xpKeys = Object.keys(await getRawStore('xp').all());
  assert.ok(xpKeys.includes(`${GUILD_ID}:111`) && !xpKeys.includes('111')); // the bare id is gone; other servers' entries are untouched
  assert.deepStrictEqual(Object.keys(await getRawStore('lockle').all()).sort(), ['daily', `${GUILD_ID}:111`].sort());
  assert.strictEqual((await getRawStore('doormanGames').get('g1')).guildId, GUILD_ID);
  const backups = fs.readdirSync(path.join(dir, 'pre-per-server-backup'));
  assert.strictEqual(backups.length, 1);
  assert.ok('111' in JSON.parse(fs.readFileSync(path.join(dir, 'pre-per-server-backup', backups[0], 'xp.json'), 'utf8'))); // the backup has the old keys

  // Fairfax sees its members and its old ledger line; another server sees nothing
  assert.strictEqual(await runInGuild(GUILD_ID, async () => (await getUser('111')).souls), 123);
  assert.strictEqual(runInGuild(GUILD_ID, () => history('111', 5)).length, 1);
  assert.strictEqual(await runInGuild('other', async () => (await getUser('111')).souls), 0);
  assert.strictEqual(runInGuild('other', () => history('111', 5)).length, 0);

  assert.strictEqual(await migratePerServer(), false); // once
  assert.strictEqual(fs.readdirSync(path.join(dir, 'pre-per-server-backup')).length, 1);
});

test("a timed-out game is paid back in the server it was played in, whichever server the sweep runs for", async () => {
  await runInGuild('A', () => changeSouls('sweep-user', 300, 'staff'));
  await runInGuild('B', () => changeSouls('sweep-user', 300, 'staff'));
  const game = { BUTTON_ID: 'hat', games: () => getStore('sweepGames'), staked: (g) => g.bet, timeoutView: async () => ({}) };
  await game.games().set('x', { userId: 'sweep-user', bet: 100, at: 0, done: false, guildId: 'B' });
  await expireGames({ channels: { cache: new Map() } }, [game]);
  assert.strictEqual(await runInGuild('A', async () => (await getUser('sweep-user')).souls), 300);
  assert.strictEqual(await runInGuild('B', async () => (await getUser('sweep-user')).souls), 400);
});
