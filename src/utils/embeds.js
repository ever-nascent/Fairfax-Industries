const { EmbedBuilder } = require('discord.js');
const { BRAND_COLOR, REPLY_COLOR } = require('../config');

// The bot-wide one-liner reply embed: brand color + description. Chain extra
// builder calls (setTitle, addFields, …) onto the result where needed.
function brandEmbed(description) {
  return new EmbedBuilder().setColor(BRAND_COLOR).setDescription(description);
}

// A short reply in the green reply colour.
function replyEmbed(description) {
  return new EmbedBuilder().setColor(REPLY_COLOR).setDescription(description);
}

module.exports = { brandEmbed, replyEmbed };
