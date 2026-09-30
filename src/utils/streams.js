// Go-live alerts: once a minute, ask Twitch and TikTok if Zechariah is live and post in #streams-and-uploads.
// Twitch needs TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET in .env (setup.py twitch saves them).
// TikTok has no public API: this reads the same endpoint tiktok.com's own live page uses. Unofficial,
// so TikTok can change or block it without warning.
const { EmbedBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { TWITCH_LOGIN, TIKTOK_LOGIN, STREAM_CHANNEL_ID } = require('../config');

const RECONNECT_GRACE_MS = 10 * 60_000; // a drop + reconnect within this doesn't ping again
const store = () => getStore('twitch'); // named before TikTok was added; holds both platforms
let token = null;

async function helix(path) {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      const r = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
      });
      if (!r.ok) throw new Error(`Twitch login failed (${r.status}). Run setup.py twitch again.`);
      token = (await r.json()).access_token;
    }
    const r = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { 'Client-Id': id, Authorization: `Bearer ${token}` } });
    if (r.status === 401) { token = null; continue; } // token expired: get a new one, retry once
    if (!r.ok) throw new Error(`Twitch ${path} -> ${r.status}`);
    return (await r.json()).data;
  }
  throw new Error('Twitch rejected a fresh token');
}

// Each platform returns null (offline) or { id, name, title, url, avatar, game?, image? }.
async function twitchLive() {
  const [s] = await helix(`streams?user_login=${TWITCH_LOGIN}`);
  if (!s) return null;
  const [user] = await helix(`users?login=${TWITCH_LOGIN}`);
  return {
    id: s.id,
    name: s.user_name,
    title: s.title,
    url: `https://www.twitch.tv/${s.user_login}`,
    avatar: user?.profile_image_url,
    game: s.game_name,
    // ?t= stops Discord showing an old cached thumbnail.
    image: `${s.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?t=${Date.now()}`,
  };
}

async function tiktokLive() {
  const r = await fetch(`https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${TIKTOK_LOGIN}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' },
  });
  if (!r.ok) throw new Error(`TikTok -> ${r.status}`);
  const { data, message } = await r.json();
  if (!data?.user) throw new Error(`TikTok: ${message || 'no data'}`);
  if (data.liveRoom?.status !== 2) return null; // 2 = live, 4 = ended
  return {
    id: data.user.roomId,
    name: data.user.nickname || TIKTOK_LOGIN,
    title: data.liveRoom.title,
    url: `https://www.tiktok.com/@${TIKTOK_LOGIN}/live`,
    avatar: data.user.avatarThumb,
  };
}

// storeKey: Twitch keeps the key it had before TikTok was added.
const PLATFORMS = {
  twitch: { label: 'Twitch', color: 0x9146ff, storeKey: 'last', fetchLive: twitchLive, enabled: () => !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) },
  tiktok: { label: 'TikTok', color: 0xfe2c55, storeKey: 'lastTiktok', fetchLive: tiktokLive, enabled: () => true },
};

// The alerts channel: STREAM_CHANNEL_ID in config.js.
async function ensureChannel(guild) {
  const channel = await guild.channels.fetch(STREAM_CHANNEL_ID).catch(() => null);
  if (!channel) throw new Error(`No channel with id ${STREAM_CHANNEL_ID} (STREAM_CHANNEL_ID in src/config.js)`);
  return channel;
}

// description: staff-set text under the title (/stream-config description), or empty.
function liveMessage(platform, stream, description) {
  const { label, color } = PLATFORMS[platform];
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${stream.name} is live on ${label}`, iconURL: stream.avatar, url: stream.url })
    .setTitle(stream.title || stream.url)
    .setURL(stream.url)
    .setDescription(description || null);
  if (stream.game) embed.addFields({ name: 'Playing', value: stream.game });
  if (stream.image) embed.setImage(stream.image);
  else if (stream.avatar) embed.setThumbnail(stream.avatar); // TikTok gives no stream preview
  return { content: `@everyone ${stream.name} is live on ${label}! ${stream.url}`, embeds: [embed], allowedMentions: { parse: ['everyone'] } };
}

// One check of one platform. Pings once per broadcast: a new stream id after at least RECONNECT_GRACE_MS offline.
async function checkLive(platform, channel, now = Date.now()) {
  const stream = await PLATFORMS[platform].fetchLive();
  const key = PLATFORMS[platform].storeKey;
  const last = await store().get(key);
  if (!last) {
    // Very first check for this platform (e.g. just switched on mid-stream): remember it, don't ping.
    await store().set(key, { streamId: stream?.id ?? null, seenLiveAt: stream ? now : 0 });
    return false;
  }
  if (!stream) return false;
  const announce = stream.id !== last.streamId && now - (last.seenLiveAt || 0) > RECONNECT_GRACE_MS;
  if (announce) {
    await channel.send(liveMessage(platform, stream, await getDescription()));
    console.log(`[streams] Announced ${PLATFORMS[platform].label} stream ${stream.id}`);
  }
  await store().set(key, { streamId: stream.id, seenLiveAt: now });
  return announce;
}

const getDescription = async () => (await store().get('description')) || '';
const setDescription = (text) => store().set('description', text);

module.exports = { PLATFORMS, ensureChannel, checkLive, liveMessage, getDescription, setDescription };
