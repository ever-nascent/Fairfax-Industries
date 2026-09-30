const { ourGuild } = require('../utils/guild');
const { ensureMemberRoles } = require('../utils/memberRoles');

// On startup: create the Don / Shrine Keeper / Base Guardian / Citizen roles if missing, hand out Citizen.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (guild) await ensureMemberRoles(guild).catch((e) => console.error('[roles] Member roles failed:', e));
  },
};
