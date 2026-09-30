// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { changeSouls, getUser } = require('../src/utils/xp');
const { games, startGame, pickRoom, finishGame, roomToOpen, otherRoom, winnings, renderRooms, WIN_LINES, LOSE_LINES } = require('../src/utils/doorman');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('the Doorman only opens an empty room that is not yours', () => {
  for (let prize = 0; prize < 3; prize++) {
    for (let pick = 0; pick < 3; pick++) {
      for (const r of [0, 0.5, 0.99]) {
        const opened = roomToOpen(prize, pick, () => r);
        assert.ok(opened !== prize && opened !== pick, `prize ${prize} pick ${pick}`);
        assert.ok(![pick, opened].includes(otherRoom(pick, opened)));
      }
    }
  }
  assert.strictEqual(winnings(100), 150);
  assert.strictEqual(winnings(15), 22); // rounds down
});

test('changeSouls never goes below zero', async () => {
  const id = 'test-souls';
  await getStore('xp').delete(id);
  assert.strictEqual(await changeSouls(id, -10), null);
  assert.strictEqual((await changeSouls(id, 50)).souls, 50);
  assert.strictEqual(await changeSouls(id, -51), null);
  assert.strictEqual((await changeSouls(id, -50)).souls, 0);
});

test('a full game: bet taken, win pays 1.5x once, only the owner can play', async () => {
  const user = { id: 'test-doorman' };
  await getStore('xp').delete(user.id);
  assert.ok((await startGame(user, 'Tester', 5)).error); // under the minimum
  assert.ok((await startGame(user, 'Tester', 100)).error); // can't afford it
  await changeSouls(user.id, 1000);

  for (const choice of ['stay', 'switch']) {
    const before = (await getUser(user.id)).souls;
    const start = await startGame(user, 'Tester', 100);
    assert.ok(start.embeds && start.files.length === 3);
    assert.strictEqual(start.embeds[0].toJSON().author.icon_url, 'attachment://hotel_guest.png');
    assert.strictEqual((await getUser(user.id)).souls, before - 100);
    const id = start.components[0].components[0].data.custom_id.split(':')[1];

    assert.ok((await pickRoom(id, 'someone-else', 0)).error);
    assert.ok(await pickRoom(id, user.id, 0));
    assert.strictEqual(await pickRoom(id, user.id, 1), null); // second pick ignored
    const game = await games().get(id);

    const result = await finishGame(id, user.id, choice);
    const embed = result.embeds[0].toJSON();
    const final_ = choice === 'switch' ? otherRoom(game.pick, game.opened) : game.pick;
    // he gloats when you lose, he's hurt when you win
    assert.strictEqual(embed.thumbnail.url, `attachment://doorman_${final_ === game.prize ? 'injured' : 'gloat'}.png`);
    assert.ok([...WIN_LINES, ...LOSE_LINES].includes(embed.footer.text.slice(1, -1)));
    assert.strictEqual(await finishGame(id, user.id, choice), null); // double click pays nothing
    const final = choice === 'switch' ? otherRoom(game.pick, game.opened) : game.pick;
    const expected = before - 100 + (final === game.prize ? 150 : 0);
    assert.strictEqual((await getUser(user.id)).souls, expected);
    assert.strictEqual(await games().get(id), null);
  }
});

test('room images render', async () => {
  for (const rooms of [[{}, {}, {}], [{ mine: true }, {}, { open: true }], [{ open: true }, { open: true, prize: true, mine: true }, { open: true }]]) {
    assert.ok((await renderRooms(rooms)).subarray(0, 4).equals(PNG));
  }
});
