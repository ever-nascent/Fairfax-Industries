const { isAllowedGuild, ourGuild } = require('../utils/guild');
const { ensureCategory, ownerLeftOrReturned, channelDeleted, reconcile } = require('../utils/hideout');

// Hideouts: make the category on startup; remake a Hideout channel deleted by hand; hide a Hideout while its owner
// is gone, open it again when they're back.
module.exports = [
  {
    name: 'clientReady',
    once: true,
    async execute(client) {
      const guild = ourGuild(client);
      if (!guild) return;
      await ensureCategory(guild).catch((e) => console.error('[hideout] Category setup failed:', e));
      await reconcile(guild); // catch up on leaves, rejoins and deleted channels from while the bot was off
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      if (!isAllowedGuild(member.guild.id)) return;
      await ownerLeftOrReturned(member, false).catch((e) => console.error('[hideout] Hiding failed:', e.message));
    },
  },
  {
    name: 'channelDelete',
    async execute(channel) {
      if (!channel.guild || !isAllowedGuild(channel.guild.id)) return;
      await channelDeleted(channel.guild, channel.id).catch((e) => console.error('[hideout] Remaking a channel failed:', e.message));
    },
  },
  {
    name: 'guildMemberAdd',
    async execute(member) {
      if (!isAllowedGuild(member.guild.id)) return;
      await ownerLeftOrReturned(member, true).catch((e) => console.error('[hideout] Reopening failed:', e.message));
    },
  },
];
