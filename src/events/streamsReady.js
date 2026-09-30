const { ourGuild } = require('../utils/guild');
const { PLATFORMS, ensureChannel, checkLive } = require('../utils/streams');

// On startup: find the alerts channel (STREAM_CHANNEL_ID in config.js), then check Twitch and TikTok once a minute.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const platforms = Object.keys(PLATFORMS).filter((p) => PLATFORMS[p].enabled());
    if (!PLATFORMS.twitch.enabled()) console.log('[streams] Twitch alerts off: no Twitch keys in .env (run setup.py twitch).');
    const guild = ourGuild(client);
    if (!guild) return;
    const channel = await ensureChannel(guild).catch((e) => console.error('[streams] Channel setup failed:', e.message));
    if (!channel) return;
    const tick = () => {
      for (const p of platforms) checkLive(p, channel).catch((e) => console.error(`[streams] ${PLATFORMS[p].label}:`, e.message));
    };
    tick();
    setInterval(tick, 60_000);
  },
};
