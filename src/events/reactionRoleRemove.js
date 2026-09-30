const { menuReaction, SELF_PICKED } = require('../utils/reactionRoles');

// Removing a reaction from a menu takes the role back.
module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user) {
    const found = await menuReaction(reaction, user);
    if (!found) return;
    await found.member.roles.remove(found.roleId, SELF_PICKED).catch((error) => console.error('[reactionRoles] Failed to remove role:', error.message));
  },
};
