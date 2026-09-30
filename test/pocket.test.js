// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { changeSouls, getUser } = require('../src/utils/xp');
const pocket = require('../src/utils/pocket');

const USER = { id: 'u1' };
const grid = (payload) => payload.components.flatMap((r) => r.components.map((c) => c.data));
const idOf = (payload) => grid(payload)[0].custom_id.split(':')[1];

test('cases average 0.95 of the bet, 18 open in rounds, offers stay under the average', () => {
  assert.strictEqual(pocket.VALUES.length, pocket.CASES);
  assert.ok(Math.abs(pocket.VALUES.reduce((a, b) => a + b) / 20 - 0.95) < 1e-9);
  assert.strictEqual(pocket.ROUNDS.reduce((a, b) => a + b), 18);
  assert.ok(pocket.OFFER_SHARE.every((s) => s < 1));
});

test('play through: pick, open, no deal all the way, keep pays the case', async () => {
  await changeSouls(USER.id, 1000);
  const before = (await getUser(USER.id)).souls;
  const values = [...pocket.VALUES];
  let msg = await pocket.startGame(USER, 'u', 100, values);
  const id = idOf(msg);
  assert.strictEqual(grid(msg).length, 20);
  msg = await pocket.move(id, USER.id, '0'); // keep case 1 (0.05)
  for (const n of pocket.ROUNDS) {
    for (let i = 0; i < n; i++) {
      const open = grid(msg).find((b) => !b.disabled);
      msg = await pocket.move(id, USER.id, open.custom_id.split(':')[2]);
    }
    if (n === 1) break;
    msg = await pocket.move(id, USER.id, 'nodeal');
  }
  const last = await pocket.games().get(id);
  assert.strictEqual(last.phase, 'offer');
  msg = await pocket.move(id, USER.id, 'nodeal');
  assert.strictEqual((await pocket.games().get(id)).phase, 'final');
  msg = await pocket.move(id, USER.id, 'keep');
  assert.ok(!(await pocket.games().get(id)));
  assert.strictEqual((await getUser(USER.id)).souls, before - 100 + 5);
});

test('deal pays the offer; another player cannot click; stale click ignored', async () => {
  const values = [...pocket.VALUES];
  let msg = await pocket.startGame(USER, 'u', 100, values);
  const id = idOf(msg);
  assert.ok((await pocket.move(id, 'other', '0')).error);
  await pocket.move(id, USER.id, '19'); // keep the 6x case
  for (let i = 0; i < 5; i++) await pocket.move(id, USER.id, String(i)); // open 0..4
  const game = await pocket.games().get(id);
  assert.strictEqual(game.phase, 'offer');
  const before = (await getUser(USER.id)).souls;
  await pocket.move(id, USER.id, 'deal');
  assert.strictEqual((await getUser(USER.id)).souls, before + game.offer);
  assert.strictEqual(await pocket.move(id, USER.id, 'deal'), null);
});
