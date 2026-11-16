// Event handler: clientReady.
// Once a minute, for every server that set up alerts (/stream-config; Fairfax's start set up): check each streamer's Twitch and
// TikTok once, even if several servers follow the same one, and post in that server's alerts channel.

const { PLATFORMS, checkLive, getConfig } = require('../utils/server/streams');

const warned = new Set(); // server ids already complained about, so a broken setup isn't logged every minute

async function tick(client) {
  const lookups = new Map(); // "platform:login" -> one lookup shared by every server following that streamer
  const lookup = (platform, login) => {
    const key = `${platform}:${login.toLowerCase()}`;
    if (!lookups.has(key)) lookups.set(key, PLATFORMS[platform].fetchLive(login));
    return lookups.get(key);
  };
  for (const guild of client.guilds.cache.values()) {
    const cfg = await getConfig(guild.id);
    if (!cfg.channelId) continue;
    const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      if (!warned.has(guild.id)) console.warn(`[streams] "${guild.name}": no alerts channel ${cfg.channelId}: set one with /stream-config channel.`);
      warned.add(guild.id);
      continue;
    }
    for (const platform of Object.keys(PLATFORMS)) {
      const login = cfg[platform];
      if (!login || !PLATFORMS[platform].enabled()) continue;
      const target = { guildId: guild.id, login, channel, description: cfg.description, ping: cfg.ping, fetchLive: (l) => lookup(platform, l) };
      await checkLive(platform, target).catch((e) => console.error(`[streams] ${PLATFORMS[platform].label} in "${guild.name}":`, e.message));
    }
  }
}

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    if (!PLATFORMS.twitch.enabled()) console.log('[streams] Twitch alerts off: no Twitch keys in .env (run setup.py twitch).');
    const run = () => tick(client).catch((e) => console.error('[streams] Check failed:', e.message));
    run();
    setInterval(run, 60_000);
  },
};
