// Run: node --test. Throwaway data folder, never the live data/.
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { changeSouls, addXp, claimUrn, editUser, buyBoost, BOOST_PRICE } = require('../src/utils/xp');
const { history, report, label, record } = require('../src/utils/soulsLedger');
const { forGame, takeBet, expireGames } = require('../src/utils/casino');
const { backupToday, KEEP_DAYS } = require('../src/utils/backup');
const { walletEmbed } = require('../src/commands/xp/wallet');
const { getStore } = require('../src/storage');

test('every souls change is recorded with its reason and the balance after', async () => {
  const id = 'ledger-a';
  await claimUrn(id); // urn
  await addXp(id, 100); // level 0 -> 1 pays souls
  await changeSouls(id, -50, 'farm-shop');
  assert.strictEqual(await changeSouls(id, -1e9, 'farm-shop'), null); // can't afford: nothing recorded
  await editUser(id, { stat: 'souls', action: 'set', amount: 500 });
  const rows = history(id, 10);
  assert.deepStrictEqual(rows.map((r) => r.r), ['staff', 'farm-shop', 'level-up', 'urn']); // newest first
  assert.strictEqual(rows[0].b, 500);
  assert.strictEqual(rows[1].d, -50);
  assert.strictEqual(rows[0].d, 500 - (rows[2].b - 50));
});

test('games are tagged by name, duel pots remember the loser, the report adds them up', async () => {
  const [a, b] = ['ledger-b', 'ledger-c'];
  await changeSouls(a, 1000, 'staff');
  await changeSouls(b, 1000, 'staff');
  const door = forGame('doorman');
  const duel = forGame('duel');
  assert.strictEqual(await door.takeBet(a, 100), null);
  await door.pay(a, 142);
  assert.strictEqual(await duel.takeBet(a, 100), null);
  assert.strictEqual(await duel.takeBet(b, 100), null);
  await duel.pay(a, 200, b);
  await duel.pay(a, 200, b);
  const mine = history(a, 20);
  assert.ok(mine.some((r) => r.r === 'game:doorman' && r.d === 142));
  assert.strictEqual(mine[0].w, b);
  assert.strictEqual(label('game:doorman'), 'Guess the Door');
  const { rows, pairs } = report(Date.now() - 60_000);
  assert.deepStrictEqual(rows.find((r) => r.reason === 'game:doorman'), { reason: 'game:doorman', in: 142, out: 100, count: 2 });
  assert.deepStrictEqual(pairs, [{ winner: a, loser: b, count: 2, souls: 200 }]);
});

test('a timed-out game refund is recorded under that game', async () => {
  const id = 'ledger-d';
  await changeSouls(id, 500, 'staff');
  const game = { BUTTON_ID: 'hat', games: () => getStore('ledgerTestGames'), staked: (g) => g.bet, timeoutView: async () => ({}) };
  assert.strictEqual(await forGame('hat').takeBet(id, 100), null);
  await game.games().set('g1', { userId: id, bet: 100, at: 0, done: false });
  await expireGames({}, [game]);
  assert.strictEqual(history(id, 1)[0].r, 'game:hat');
  assert.strictEqual(history(id, 1)[0].d, 100);
});

test('Soul Boost purchase is recorded', async () => {
  const id = 'ledger-e';
  await changeSouls(id, BOOST_PRICE, 'staff');
  await buyBoost(id);
  assert.deepStrictEqual([history(id, 1)[0].r, history(id, 1)[0].d], ['shop:boost', -BOOST_PRICE]);
});

test('daily backup: once a day, copies the souls files, keeps the newest 7 days', async () => {
  const dir = process.env.DATA_DIR;
  await getStore('xp').set('backup-user', { xp: 1, souls: 1 });
  for (let day = 1; day <= 9; day++) backupToday(new Date(Date.UTC(2026, 9, day)));
  assert.strictEqual(backupToday(new Date(Date.UTC(2026, 9, 9))), null); // already done that day
  const kept = fs.readdirSync(path.join(dir, 'backups')).sort();
  assert.strictEqual(kept.length, KEEP_DAYS);
  assert.strictEqual(kept[0], '2026-10-03');
  const copy = JSON.parse(fs.readFileSync(path.join(dir, 'backups', '2026-10-09', 'xp.json'), 'utf8'));
  assert.strictEqual(copy['backup-user'].souls, 1);
  assert.ok(fs.existsSync(path.join(dir, 'backups', '2026-10-09', 'soulsLedger.jsonl')));
});

test('wallet embed: balance, boost, urn, trivia and recent changes', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const user = { souls: 1234, boostUntil: now.getTime() + 3600_000, rejuvs: 2, urnDay: '2026-10-04', urnStreak: 3, triviaDay: '2026-10-04', triviaPaid: 4, triviaStreak: 0 };
  const e = walletEmbed({ displayName: 'Z' }, user, [{ d: 1000, r: 'urn', t: now.getTime() }, { d: -100, r: 'game:bj', t: now.getTime() }], now).toJSON();
  const text = JSON.stringify(e);
  assert.ok(e.description.includes('1,234'));
  assert.ok(text.includes('Claimed. Next') && text.includes('6 paid answers left') && text.includes('2 / 3'));
  assert.ok(text.includes('+1,000') && text.includes('Soul Urn') && text.includes('−100') && text.includes('Blackjack'));
});

test("a farm hero's own souls (Oct 11) are tagged with the hero; /wallet's list leaves them out", async () => {
  const { chooseHero, updateFarmUser, buyItem, sellItem } = require('../src/utils/farm/play');
  const id = 'ledger-hero';
  await changeSouls(id, 300, 'urn');
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => { r.souls = 1000; });
  assert.ok((await buyItem(id, 'Extra Health')).ok);
  assert.ok((await sellItem(id, 'Extra Health')).ok);
  record(id, 0, { reason: 'farm', hero: 'Haze' }, 1); // nothing moved: no line
  const rows = history(id, 10);
  assert.deepStrictEqual(rows.map((e) => [e.r, e.d, e.b, e.h]), [['farm-shop', 400, 600, 'Haze'], ['farm-shop', -800, 200, 'Haze'], ['urn', 300, 300, undefined]]);
  assert.deepStrictEqual(history(id, 10, { heroes: false }).map((e) => e.r), ['urn']);
  assert.strictEqual(label('farm-move'), 'Moved to hero souls');
});
