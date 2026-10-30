// Permission gates for staff commands: `requirePermission(interaction, flag)` answers "you can't" and returns false when the member lacks it.
// The owner (OWNER_ID in config.js) passes every gate in the home server only (GUILD_ID), never in someone else's.
// `requireOwner` is for switches that reach every server (the owner can use it anywhere).
const { MessageFlags } = require('discord.js');

const { OWNER_ID, GUILD_ID } = require('../config');

async function requirePermission(interaction, permissionFlag) {
  if ((interaction.user.id === OWNER_ID && interaction.guildId === GUILD_ID) || interaction.memberPermissions?.has(permissionFlag)) return true;
  await interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
  return false;
}

// Only the bot's owner. Answers "you can't" and returns false for anyone else.
async function requireOwner(interaction) {
  if (interaction.user.id === OWNER_ID) return true;
  await interaction.reply({ content: 'Only the bot owner can use this command.', flags: MessageFlags.Ephemeral });
  return false;
}

module.exports = { requirePermission, requireOwner };
