// In-memory per-(guild, user) draft holder for multi-step builders (reaction
// role menus, giveaways). Drafts are intentionally volatile: a restart simply
// asks the user to start over.
function createDraftStore() {
  const drafts = new Map();
  const key = (guildId, userId) => `${guildId}_${userId}`;

  return {
    start(guildId, userId, draft) {
      drafts.set(key(guildId, userId), draft);
      return draft;
    },
    get(guildId, userId) {
      return drafts.get(key(guildId, userId));
    },
    clear(guildId, userId) {
      drafts.delete(key(guildId, userId));
    },
  };
}

module.exports = { createDraftStore };
