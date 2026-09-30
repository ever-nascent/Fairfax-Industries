const { ourGuild } = require('../utils/guild');
const { ensureInfrastructure, reconcile } = require('../utils/lfg');

// On startup: create any missing LFG roles/channels, then tidy up lobbies left from before the restart.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (guild) await ensureInfrastructure(guild).catch((e) => console.error('[lfg] Setup failed:', e));
    await reconcile(client).catch((e) => console.error('[lfg] Reconcile failed:', e));
  },
};
