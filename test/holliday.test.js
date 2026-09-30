// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { changeSouls, getUser } = require('../src/utils/xp');
const { getStore } = require('../src/storage');
const hk = require('../src/utils/holliday');

test('multiplier: 1x at the start, 10x when the fuse hits the keg, x2 at about 6 s', () => {
  assert.strictEqual(hk.multiplierAt(0), 1);
  assert.strictEqual(hk.multiplierAt(hk.FUSE_MS), 10);
  assert.strictEqual(hk.multiplierAt(hk.FUSE_MS * 2), 10);
  assert.strictEqual(hk.multiplierAt(hk.msUntil(2)), 2);
  assert.ok(Math.abs(hk.msUntil(2) - 6021) < 1);
});

test('crash point: 5% blow at 1.00x, half last to 1.90x, capped at 10x, 95% return at any cash out', () => {
  assert.strictEqual(hk.crashPoint(0), 1);
  assert.strictEqual(hk.crashPoint(0.049), 1);
  assert.strictEqual(hk.crashPoint(0.5), 1.9);
  assert.strictEqual(hk.crashPoint(0.999999), 10);
  // cashing out at m wins when the keg lasts past m: about 95% / m of the time, so m x chance = 0.95
  const n = 200_000;
  for (const m of [1.5, 2, 5]) {
    let wins = 0;
    for (let i = 0; i < n; i++) if (hk.crashPoint((i + 0.5) / n) > m) wins++;
    assert.ok(Math.abs((m * wins) / n - 0.95) < 0.005, `m=${m}: ${(m * wins) / n}`);
  }
});

test('the fuse is a GIF that plays once, made once per bet; the end pictures are PNGs', async () => {
  const gif = await hk.renderFuse(100);
  assert.strictEqual(gif.subarray(0, 6).toString(), 'GIF89a');
  assert.ok(!gif.includes(Buffer.from('NETSCAPE2.0'))); // no loop block: plays once
  assert.ok(gif.length < 8 * 1024 * 1024, `${gif.length} bytes`);
  assert.strictEqual(await hk.renderFuse(100), gif);
  assert.notStrictEqual(await hk.renderFuse(250), gif); // the souls on the plate differ
  for (const game of [{ lost: false, cashedAt: 2.35, ms: 11000 }, { lost: true, crash: 1.62, ms: 6000 }]) {
    const png = await hk.renderEnd(game);
    assert.ok(png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  }
});

// Starts a game and "posts" it (the fuse starts); returns its id.
async function started(user, crash) {
  const start = await hk.startGame(user, 'Tester', 100, crash);
  const id = start.components[0].components[0].data.custom_id.split(':')[1];
  await getStore('kegGames').update(id, (g) => ({ ...g, startedAt: 1_000_000 })); // what posted() does, without the timer
  return { id, start };
}

test('a game: bet taken, Cash Out pays once at the multiplier, only the player, too late = loss, the keg blows', async () => {
  const user = { id: 'test-keg' };
  await getStore('xp').delete(user.id);
  assert.ok((await hk.startGame(user, 'Tester', 5)).error);
  assert.ok((await hk.startGame(user, 'Tester', 100)).error);
  await changeSouls(user.id, 1000);

  // cash out at x2.00 with the keg set for x3.10
  const { id, start } = await started(user, 3.1);
  assert.strictEqual((await getUser(user.id)).souls, 900);
  assert.strictEqual(start.embeds[0].toJSON().author.icon_url, 'attachment://powder_keg.png');
  assert.ok(start.files.some((f) => f.name === `fuse_${id}.gif`));
  const at = 1_000_000 + Math.ceil(hk.msUntil(2));
  assert.ok((await hk.cashOut(id, 'someone-else', at)).error);
  const [a, b] = await Promise.all([hk.cashOut(id, user.id, at), hk.cashOut(id, user.id, at)]);
  const result = a ?? b;
  assert.ok(result && !(a && b)); // a double click pays once
  const embed = result.embeds[0].toJSON();
  assert.match(embed.description, /2\.00×/);
  assert.match(embed.description, /3\.10×/);
  assert.strictEqual(embed.thumbnail.url, 'attachment://holliday_injured.png');
  assert.ok(hk.WIN_LINES.includes(embed.footer.text.slice(1, -1)));
  assert.strictEqual((await getUser(user.id)).souls, 1100);
  assert.strictEqual(await hk.games().get(id), null);

  // Cash Out after the keg's moment (its timer hasn't run yet): a loss
  const late = await started(user, 1.5);
  const lost = await hk.cashOut(late.id, user.id, 1_000_000 + hk.msUntil(1.5) + 1);
  assert.strictEqual(lost.embeds[0].toJSON().thumbnail.url, 'attachment://holliday_gloat.png');
  assert.strictEqual((await getUser(user.id)).souls, 1000);

  // the keg blows on its timer; a Cash Out after that is a stale click
  const boom = await started(user, 1);
  const edits = [];
  await hk.blow(boom.id, async (payload) => edits.push(payload));
  assert.strictEqual(edits.length, 1);
  assert.match(edits[0].embeds[0].toJSON().description, /BOOM!.*1\.00×/);
  assert.strictEqual(await hk.cashOut(boom.id, user.id, 1_000_000), null);
  await hk.blow(boom.id, async (payload) => edits.push(payload));
  assert.strictEqual(edits.length, 1);
  assert.strictEqual((await getUser(user.id)).souls, 900);
});

test('posted() starts the fuse; nothing can be cashed out before that', async () => {
  const user = { id: 'test-keg-posted' };
  await changeSouls(user.id, 1000);
  const start = await hk.startGame(user, 'Tester', 100, 10);
  const id = start.components[0].components[0].data.custom_id.split(':')[1];
  assert.strictEqual(await hk.cashOut(id, user.id), null); // not posted yet
  const edits = [];
  await hk.posted(id, { edit: async (p) => edits.push(p) });
  const { startedAt } = await hk.games().get(id);
  assert.ok(startedAt > Date.now() + 500); // the fuse starts about when the GIF shows up, ~1 s later
  const back = await hk.cashOut(id, user.id); // before the fuse starts: x1.00, the bet back
  assert.match(back.embeds[0].toJSON().description, /1\.00×/);
  assert.strictEqual((await getUser(user.id)).souls, 1000);
});
