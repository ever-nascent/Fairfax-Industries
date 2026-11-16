// The tournaments' clock (utils/server/tournamentPlay.js `sweep`): on startup, then every minute, each running tournament gets its sign-ups
// closed on time, its match pings with Check In, its no-show flags and its scrim pings. Anything missed while the bot was off happens at the next start.
const T = require('../utils/server/tournaments');
const { sweep } = require('../utils/server/tournamentPlay');
const { runInGuild } = require('../utils/guildContext');

const CHECK_MS = 60_000;

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const tick = async () => {
      for (const t of await T.allRunning()) {
        const guild = client.guilds.cache.get(t.guildId);
        if (guild) await runInGuild(t.guildId, () => sweep(guild, t.id)).catch((e) => console.error(`[tournament] Sweep of "${t.name}" failed:`, e));
      }
    };
    await tick().catch((e) => console.error('[tournament] Sweep failed:', e));
    setInterval(() => tick().catch((e) => console.error('[tournament] Sweep failed:', e)), CHECK_MS).unref();
  },
};
