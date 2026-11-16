// Go-live alerts: once a minute, ask Twitch and TikTok if each server's streamer is live and post in that server's alerts channel
// (/stream-config: channel, Twitch and TikTok names, ping, description; Fairfax's start from config.js).
// Twitch needs TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET in .env (setup.py twitch saves them).
// TikTok has no public API: this reads the same endpoint tiktok.com's own live page uses. Unofficial,
// so TikTok can change or block it without warning.
const { EmbedBuilder } = require('discord.js');
const { getStore } = require('../../storage');
const { TWITCH_LOGIN, TIKTOK_LOGIN, STREAM_CHANNEL_ID } = require('../../config');
const { isHomeGuild } = require('../guild');

const TIMEOUT = () => AbortSignal.timeout(15_000); // a hung request would stall that platform's checks for good
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
        signal: TIMEOUT(),
      });
      if (!r.ok) throw new Error(`Twitch login failed (${r.status}). Run setup.py twitch again.`);
      token = (await r.json()).access_token;
    }
    const r = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { 'Client-Id': id, Authorization: `Bearer ${token}` }, signal: TIMEOUT() });
    if (r.status === 401) { token = null; continue; } // token expired: get a new one, retry once
    if (!r.ok) throw new Error(`Twitch ${path} -> ${r.status}`);
    return (await r.json()).data;
  }
  throw new Error('Twitch rejected a fresh token');
}

// Each platform returns null (offline) or { id, name, title, url, avatar, game?, image? }.
async function twitchLive(login) {
  const [s] = await helix(`streams?user_login=${login}`);
  if (!s) return null;
  const [user] = await helix(`users?login=${login}`);
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

async function tiktokLive(login) {
  const r = await fetch(`https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${login}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' },
    signal: TIMEOUT(),
  });
  if (!r.ok) throw new Error(`TikTok -> ${r.status}`);
  const { data, message } = await r.json();
  if (!data?.user) throw new Error(`TikTok: ${message || 'no data'}`);
  if (data.liveRoom?.status !== 2) return null; // 2 = live, 4 = ended
  return {
    id: data.user.roomId,
    name: data.user.nickname || login,
    title: data.liveRoom.title,
    url: `https://www.tiktok.com/@${login}/live`,
    avatar: data.user.avatarThumb,
  };
}

// storeKey: Twitch keeps the key it had before TikTok was added.
const PLATFORMS = {
  twitch: { label: 'Twitch', color: 0x9146ff, storeKey: 'last', fetchLive: twitchLive, enabled: () => !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) },
  tiktok: { label: 'TikTok', color: 0xfe2c55, storeKey: 'lastTiktok', fetchLive: tiktokLive, enabled: () => true },
};

// ---- Settings: one set per server ----
// Fairfax's start from config.js and keep the keys it used before the bot went public ('last', 'lastTiktok', 'description' in the
// 'twitch' store); every other server starts with nothing set, so nothing is posted until staff run /stream-config.
const settingsStore = () => getStore('streamSettings'); // guild id -> { channelId, twitch, tiktok, ping }
const defaults = (guildId) => (isHomeGuild(guildId) ? { channelId: STREAM_CHANNEL_ID, twitch: TWITCH_LOGIN, tiktok: TIKTOK_LOGIN } : { channelId: null, twitch: null, tiktok: null });
const stateKey = (guildId, key) => (isHomeGuild(guildId) ? key : `${key}:${guildId}`);

async function getConfig(guildId) {
  return { ping: 'everyone', ...defaults(guildId), ...(await settingsStore().get(guildId)), description: await getDescription(guildId) };
}
const updateConfig = (guildId, patch) => settingsStore().update(guildId, (saved) => ({ ...defaults(guildId), ...saved, ...patch }));
const getDescription = async (guildId) => (await store().get(stateKey(guildId, 'description'))) || '';
const setDescription = (guildId, text) => store().set(stateKey(guildId, 'description'), text);
// A new name starts the first-check-stays-quiet rule over, so switching an alert on mid-stream doesn't ping.
const forgetStream = (guildId, platform) => store().delete(stateKey(guildId, PLATFORMS[platform].storeKey));

// What an alert starts with: @everyone, @here, a role id, or nothing ('none').
function pingOf(ping) {
  if (ping === 'none') return { text: '', allowedMentions: { parse: [] } };
  if (ping === 'here') return { text: '@here ', allowedMentions: { parse: ['everyone'] } };
  if (/^\d+$/.test(ping)) return { text: `<@&${ping}> `, allowedMentions: { roles: [ping] } };
  return { text: '@everyone ', allowedMentions: { parse: ['everyone'] } };
}

// description: staff-set text under the title (/stream-config description), or empty.
function liveMessage(platform, stream, description, ping = 'everyone') {
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
  const { text, allowedMentions } = pingOf(ping);
  return { content: `${text}${stream.name} is live on ${label}! ${stream.url}`, embeds: [embed], allowedMentions };
}

// One check of one platform for one server. `target` = { guildId, login, channel, description, ping, fetchLive? } (fetchLive lets a
// caller share one lookup between servers that follow the same streamer). Pings once per broadcast: a new stream id after at
// least RECONNECT_GRACE_MS offline.
async function checkLive(platform, target, now = Date.now()) {
  const stream = await (target.fetchLive ?? PLATFORMS[platform].fetchLive)(target.login);
  const key = stateKey(target.guildId, PLATFORMS[platform].storeKey);
  const last = await store().get(key);
  if (!last) {
    // Very first check for this platform (e.g. just switched on mid-stream): remember it, don't ping.
    await store().set(key, { streamId: stream?.id ?? null, seenLiveAt: stream ? now : 0 });
    return false;
  }
  if (!stream) return false;
  const announce = stream.id !== last.streamId && now - (last.seenLiveAt || 0) > RECONNECT_GRACE_MS;
  if (announce) {
    await target.channel.send(liveMessage(platform, stream, target.description, target.ping));
    console.log(`[streams] Announced ${PLATFORMS[platform].label} stream ${stream.id} (server ${target.guildId})`);
  }
  await store().set(key, { streamId: stream.id, seenLiveAt: now });
  return announce;
}

module.exports = { PLATFORMS, checkLive, liveMessage, getConfig, updateConfig, getDescription, setDescription, forgetStream };
