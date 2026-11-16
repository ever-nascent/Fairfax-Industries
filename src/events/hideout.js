const { ownerLeftOrReturned, channelDeleted, reconcile } = require('../utils/shop/hideout');
const { runInGuild } = require('../utils/guildContext');

// Hideouts: make the category on startup; remake a Hideout channel deleted by hand; hide a Hideout while its owner
// is gone, open it again when they're back.
module.exports = [
  {
    name: 'clientReady',
    once: true,
    async execute(client) {
      for (const guild of client.guilds.cache.values()) {
        // catch up on leaves, rejoins and deleted channels from while the bot was off (a server with no Hideouts does nothing)
        await runInGuild(guild.id, () => reconcile(guild)).catch((e) => console.error(`[hideout] Startup check in "${guild.name}" failed:`, e.message));
      }
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      await runInGuild(member.guild.id, () => ownerLeftOrReturned(member, false)).catch((e) => console.error('[hideout] Hiding failed:', e.message));
    },
  },
  {
    name: 'channelDelete',
    async execute(channel) {
      if (!channel.guild) return;
      await runInGuild(channel.guild.id, () => channelDeleted(channel.guild, channel.id)).catch((e) => console.error('[hideout] Remaking a channel failed:', e.message));
    },
  },
  {
    name: 'guildMemberAdd',
    async execute(member) {
      await runInGuild(member.guild.id, () => ownerLeftOrReturned(member, true)).catch((e) => console.error('[hideout] Reopening failed:', e.message));
    },
  },
];
