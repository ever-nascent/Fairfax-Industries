const { isAllowedGuild } = require('../utils/guildLock');
const { getMenu, emojiKey } = require('../utils/reactionRoles');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
    if (!reaction.message.guild || !isAllowedGuild(reaction.message.guild.id)) return;

    const menu = await getMenu(reaction.message.id);
    if (!menu) return;

    const roleId = menu.roles[emojiKey(reaction.emoji)];
    if (!roleId) return;

    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (menu.mode === 'single') {
      const message = await reaction.message.fetch().catch(() => null);
      if (message) {
        for (const otherReaction of message.reactions.cache.values()) {
          const otherRoleId = menu.roles[emojiKey(otherReaction.emoji)];
          if (!otherRoleId || otherRoleId === roleId) continue;
          await otherReaction.users.remove(user.id).catch(() => null);
          if (member.roles.cache.has(otherRoleId)) await member.roles.remove(otherRoleId).catch(() => null);
        }
      }
    }

    await member.roles
      .add(roleId)
      .catch((error) => console.error('[reactionRoles] Failed to add role:', error.message));
  },
};
