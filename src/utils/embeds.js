const { EmbedBuilder, MessageFlags } = require('discord.js');
const { REPLY_COLOR } = require('../config');

// A short reply in the green reply colour. Chain extra builder calls
// (setTitle, addFields, …) onto the result where needed.
function replyEmbed(description) {
  return new EmbedBuilder().setColor(REPLY_COLOR).setDescription(description);
}

// Replies with `text` in a green embed only the person who used the command sees.
const privateReply = (interaction, text) => interaction.reply({ embeds: [replyEmbed(text)], flags: MessageFlags.Ephemeral });

module.exports = { replyEmbed, privateReply };
