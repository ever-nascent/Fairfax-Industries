// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { changeSouls, getUser } = require('../src/utils/xp');
const sc = require('../src/utils/sinclair');

test('the shuffle is a GIF that plays once, the reveal a PNG', async () => {
  const gif = await sc.renderShuffle();
  assert.strictEqual(gif.subarray(0, 6).toString(), 'GIF89a');
  assert.ok(!gif.includes(Buffer.from('NETSCAPE2.0'))); // no loop block: plays once
  assert.ok(gif.length < 8 * 1024 * 1024); // well under Discord's upload limit
  assert.strictEqual(await sc.renderShuffle(), gif); // made once, reused
  const png = await sc.renderReveal(0, 2);
  assert.ok(png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
});

test('a full game: bet taken, a win pays 2.5x once, only the owner picks', async () => {
  const user = { id: 'test-hat' };
  await getStore('xp').delete(user.id);
  assert.ok((await sc.startGame(user, 'Tester', 5)).error);
  assert.ok((await sc.startGame(user, 'Tester', 100)).error);
  await changeSouls(user.id, 1000);

  for (const findIt of [true, false]) {
    const before = (await getUser(user.id)).souls;
    const start = await sc.startGame(user, 'Tester', 100);
    assert.strictEqual((await getUser(user.id)).souls, before - 100);
    assert.strictEqual(start.embeds[0].toJSON().author.icon_url, 'attachment://rabbit_hex.png');
    const id = start.components[0].components[0].data.custom_id.split(':')[1];
    const { rabbit } = await sc.games().get(id);
    const pick = findIt ? rabbit : (rabbit + 1) % 3;

    assert.ok((await sc.pickHat(id, 'someone-else', pick)).error);
    const [a, b] = await Promise.all([sc.pickHat(id, user.id, pick), sc.pickHat(id, user.id, pick)]);
    const result = a ?? b;
    assert.ok(result && !(a && b)); // a double click pays once
    const embed = result.embeds[0].toJSON();
    assert.strictEqual(embed.thumbnail.url, `attachment://sinclair_${findIt ? 'injured' : 'gloat'}.png`);
    assert.ok((findIt ? sc.WIN_LINES : sc.LOSE_LINES).includes(embed.footer.text));
    assert.strictEqual((await getUser(user.id)).souls, before - 100 + (findIt ? 250 : 0));
    assert.strictEqual(await sc.games().get(id), null);
  }
});
