const { PermissionFlagsBits } = require('discord.js');
const { isAllowedGuild } = require('../utils/guild');
const { replyEmbed } = require('../utils/embeds');
const { pickRandom } = require('../utils/random');
const { WARN_LINES, findPhrase, getPhrases } = require('../utils/censor');

const WARNING_LIFETIME_MS = 15_000; // the warning cleans itself up so it doesn't clutter the channel

// Deletes messages containing a censored phrase and warns the author. Staff (Manage Messages) are exempt.
module.exports = [
  {
    name: 'messageCreate',
    async execute(message) {
      if (message.author.bot || !message.guild || !isAllowedGuild(message.guild.id)) return;
      if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      if (!findPhrase(message.content, await getPhrases(message.guild.id))) return;
      await message.delete().catch(() => {}); // already gone, or the bot lacks Manage Messages
      const warning = await message.channel
        .send({ content: `${message.author}`, embeds: [replyEmbed(pickRandom(WARN_LINES))], allowedMentions: { users: [message.author.id] } })
        .catch(() => null);
      if (warning) setTimeout(() => warning.delete().catch(() => {}), WARNING_LIFETIME_MS);
    },
  },
  {
    // An edit can't be used to sneak a phrase past the filter.
    name: 'messageUpdate',
    async execute(_old, message) {
      if (message.partial || !message.content) return;
      return module.exports[0].execute(message);
    },
  },
];
