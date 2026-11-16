// Event handler: messageReactionAdd.
// Reacting on a menu gives the role. Single-choice menus also take back the member's other choice.

const { menuReaction, emojiKey, SELF_PICKED } = require('../utils/server/reactionRoles');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    const found = await menuReaction(reaction, user);
    if (!found) return;
    const { menu, roleId, member, message } = found;

    if (menu.mode === 'single') {
      const full = await message.fetch().catch(() => null);
      for (const other of full?.reactions.cache.values() ?? []) {
        const otherRoleId = menu.roles[emojiKey(other.emoji)];
        if (!otherRoleId || otherRoleId === roleId) continue;
        await other.users.remove(user.id).catch(() => null);
        if (member.roles.cache.has(otherRoleId)) await member.roles.remove(otherRoleId, SELF_PICKED).catch(() => null);
      }
    }

    await member.roles.add(roleId, SELF_PICKED).catch((error) => console.error('[reactionRoles] Failed to add role:', error.message));
    // A menu staff made as a gate also gives the role that opens the server. Picking again or un-picking never takes it back.
    if (menu.unlockRoleId && !member.roles.cache.has(menu.unlockRoleId)) {
      await member.roles.add(menu.unlockRoleId, SELF_PICKED).catch((error) => console.error('[reactionRoles] Failed to add the unlock role:', error.message));
    }
  },
};
