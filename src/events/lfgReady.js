const { isAllowedGuild } = require('../utils/guildLock');
const { ensureInfrastructure, reconcile } = require('../utils/lfg');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    for (const guild of client.guilds.cache.values()) {
      if (!isAllowedGuild(guild.id)) continue;
      await ensureInfrastructure(guild).catch((e) => console.error('[lfg] Setup failed:', e));
    }
    await reconcile(client).catch((e) => console.error('[lfg] Reconcile failed:', e));
  },
};
