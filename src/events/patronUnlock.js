const { isAllowedGuild } = require('../utils/guild');
const { giveCitizen, isUnlocked } = require('../utils/memberRoles');

// Picking a Patron in #roles makes a new member a Citizen, which unlocks the rest of the server.
module.exports = {
  name: 'guildMemberUpdate',
  async execute(_old, member) {
    if (!isAllowedGuild(member.guild.id) || !isUnlocked(member)) return;
    await giveCitizen(member, 'Picked a Patron').catch((e) => console.error('[roles] Citizen role failed:', e.message));
  },
};
