const { EmbedBuilder } = require('discord.js');
const { ourGuild } = require('../utils/guild');
const rr = require('../utils/reactionRoles');

// On startup: a #roles menu whose emoji was replaced in the server (the startup check does that when a hero's wiki icon changes) points at
// an emoji id that no longer exists. Read its name from the menu text, find the emoji now in the server, and fix the text, the saved menu and
// the bot's reaction. The new reaction lands at the end of the row (his call, Oct 23). Normally nothing is stale and nothing is requested.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (!guild) return;
    const live = new Set(guild.emojis.cache.keys());
    for (const [messageId, menu] of await rr.listMenus(guild.id)) {
      const stale = rr.staleKeys(menu, live);
      if (!stale.length) continue;
      try {
        const message = await (await guild.channels.fetch(menu.channelId)).messages.fetch(messageId);
        const embed = message.embeds[0];
        const names = rr.emojiNames(embed?.description ?? '');
        const swaps = new Map();
        for (const id of stale) {
          const now = names.has(id) && guild.emojis.cache.find((e) => e.name === names.get(id));
          if (now) swaps.set(id, now.id);
          else console.log(`[roles] Menu ${messageId}: emoji ${id} (${names.get(id) ?? 'unknown name'}) is gone and has no replacement, left alone`);
        }
        if (!swaps.size) continue;
        const fixed = rr.swapEmojis(menu, embed.description, swaps);
        await message.edit({ embeds: [EmbedBuilder.from(embed).setDescription(fixed.text)] });
        await rr.saveMenuRoles(messageId, menu, fixed.roles);
        for (const id of swaps.values()) await message.react(guild.emojis.cache.get(id)).catch((e) => console.error(`[roles] Reaction ${id} failed:`, e.message));
        console.log(`[roles] Repaired menu ${messageId}: ${[...swaps.keys()].map((id) => names.get(id)).join(', ')}`);
      } catch (e) {
        console.error(`[roles] Repairing menu ${messageId} failed:`, e.message);
      }
    }
  },
};
