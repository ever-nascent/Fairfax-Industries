// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { checkLive, liveMessage, setDescription, getDescription } = require('../src/utils/streams');

// Fake Twitch + TikTok: `live[platform]` is the current stream id (or null). First Twitch token is "expired".
const live = { twitch: null, tiktok: null };
let tokens = 0;
global.fetch = async (url, opts = {}) => {
  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  if (url.includes('oauth2/token')) return json({ access_token: `t${++tokens}` });
  if (url.includes('tiktok.com')) {
    const user = { roomId: live.tiktok || '', nickname: 'charmed.dl', avatarThumb: 'https://x/pfp.jpg' };
    return json({ data: { user, liveRoom: { status: live.tiktok ? 2 : 4, title: 'RANKED | DEADLOCK' } } });
  }
  if (opts.headers.Authorization === 'Bearer t1') return json({}, 401);
  if (url.includes('/streams')) return json({ data: live.twitch ? [{ id: live.twitch, user_login: 'charmedvt', user_name: 'CharmedVT', title: 'Deadlock ranked', game_name: 'Deadlock', thumbnail_url: 'https://x/live_{width}x{height}.jpg' }] : [] });
  if (url.includes('/users')) return json({ data: [{ profile_image_url: 'https://x/pfp.png' }] });
  throw new Error(url);
};
process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_SECRET = 'x';
const sent = [];
const channel = { send: async (m) => sent.push(m) };
const MIN = 60_000;
const T0 = Date.now();

for (const platform of ['twitch', 'tiktok']) {
  test(`${platform}: pings @everyone once per broadcast, not on a quick reconnect`, async () => {
    sent.length = 0;
    live[platform] = null;
    assert.strictEqual(await checkLive(platform, channel, T0), false); // first check, offline
    live[platform] = 'a';
    assert.strictEqual(await checkLive(platform, channel, T0 + 1 * MIN), true); // went live (Twitch: after an expired-token retry)
    assert.strictEqual(await checkLive(platform, channel, T0 + 2 * MIN), false); // still the same stream (or a bot restart)
    live[platform] = null;
    await checkLive(platform, channel, T0 + 3 * MIN);
    live[platform] = 'b';
    assert.strictEqual(await checkLive(platform, channel, T0 + 6 * MIN), false); // dropped 3 min, back: no second ping
    live[platform] = 'c';
    assert.strictEqual(await checkLive(platform, channel, T0 + 30 * MIN), true); // new stream after 24 min off
    assert.strictEqual(sent.length, 2);
    assert.deepStrictEqual(sent[0].allowedMentions, { parse: ['everyone'] });
    live[platform] = null;
  });
}

test('the very first check stays quiet even if already live (e.g. TikTok switched on mid-stream)', async () => {
  await require('../src/storage').getStore('twitch').delete('lastTiktok'); // as if TikTok alerts were just added
  sent.length = 0;
  live.tiktok = 'x';
  assert.strictEqual(await checkLive('tiktok', channel, T0), false);
  assert.strictEqual(await checkLive('tiktok', channel, T0 + MIN), false); // same stream: still quiet
  assert.strictEqual(sent.length, 0);
});

test('the messages link the stream; Twitch shows a thumbnail, TikTok the profile picture', () => {
  const tw = liveMessage('twitch', { name: 'CharmedVT', title: 't', url: 'https://www.twitch.tv/charmedvt', game: 'Deadlock', image: 'https://x/i.jpg' }).embeds[0].toJSON();
  assert.strictEqual(tw.url, 'https://www.twitch.tv/charmedvt');
  assert.strictEqual(tw.image.url, 'https://x/i.jpg');
  assert.strictEqual(tw.fields[0].value, 'Deadlock');
  const tt = liveMessage('tiktok', { name: 'charmed.dl', title: 't', url: 'https://www.tiktok.com/@charmed.dl/live', avatar: 'https://x/pfp.jpg' });
  assert.match(tt.content, /is live on TikTok/);
  assert.strictEqual(tt.embeds[0].toJSON().thumbnail.url, 'https://x/pfp.jpg');
});

test('the saved description goes under the title; empty means none', async () => {
  assert.strictEqual(await getDescription(), '');
  await setDescription('Come hang out!');
  const s = { name: 'n', title: 't', url: 'https://x' };
  assert.strictEqual(liveMessage('tiktok', s, await getDescription()).embeds[0].toJSON().description, 'Come hang out!');
  assert.strictEqual(liveMessage('tiktok', s, '').embeds[0].toJSON().description, undefined);
});
