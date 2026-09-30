const { MessageFlags } = require('discord.js');

// Optional: a user id that passes every permission gate. Unset = nobody bypasses.
const OWNER_OVERRIDE_ID = process.env.OWNER_OVERRIDE_ID || null;

function hasPermission(interaction, permissionFlag) {
  if (OWNER_OVERRIDE_ID && interaction.user.id === OWNER_OVERRIDE_ID) return true;
  return interaction.memberPermissions?.has(permissionFlag) ?? false;
}

async function requirePermission(interaction, permissionFlag) {
  if (hasPermission(interaction, permissionFlag)) return true;
  await interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
  return false;
}

module.exports = { requirePermission };
