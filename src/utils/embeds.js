const { EmbedBuilder } = require('discord.js');
const { REPLY_COLOR } = require('../config');

// A short reply in the green reply colour. Chain extra builder calls
// (setTitle, addFields, …) onto the result where needed.
function replyEmbed(description) {
  return new EmbedBuilder().setColor(REPLY_COLOR).setDescription(description);
}

module.exports = { replyEmbed };
