const { isAllowedGuild } = require('../utils/guildLock');
const { getMenu, emojiKey } = require('../utils/reactionRoles');

module.exports = {
  name: 'messageReactionRemove',
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

    await member.roles
      .remove(roleId)
      .catch((error) => console.error('[reactionRoles] Failed to remove role:', error.message));
  },
};
