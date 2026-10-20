const { MessageFlags } = require('discord.js');

// The owner (config.js) passes every permission gate.
const { OWNER_ID } = require('../config');

async function requirePermission(interaction, permissionFlag) {
  if (interaction.user.id === OWNER_ID || interaction.memberPermissions?.has(permissionFlag)) return true;
  await interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
  return false;
}

module.exports = { requirePermission };
