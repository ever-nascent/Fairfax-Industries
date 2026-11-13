const { drawAndAnnounce, servers } = require('../utils/economy/jackpot');
const { runInGuild } = require('../utils/guildContext');

const CHECK_MS = 5 * 60_000;

// The Weekly Jackpot's draw (utils/economy/jackpot.js): on startup, then every 5 minutes, every server whose week has turned gets its
// winner drawn, paid and announced. A draw missed while the bot was off happens at the next start.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const sweep = async () => {
      for (const guildId of await servers()) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) await runInGuild(guildId, () => drawAndAnnounce(guild)).catch((e) => console.error(`[jackpot] Draw in "${guild.name}" failed:`, e));
      }
    };
    await sweep().catch((e) => console.error('[jackpot] Draw check failed:', e));
    setInterval(() => sweep().catch((e) => console.error('[jackpot] Draw check failed:', e)), CHECK_MS).unref();
  },
};
