// The LFG Pings dropdown in #roles: pick any LFG ping roles; the picks replace the ones you had.
const { ActionRowBuilder, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const { BRAND_COLOR } = require('../config');
const { PING_ROLES } = require('../utils/lfg');
const { replyEmbed } = require('../utils/embeds');

const ID = 'lfg_pings';
const NONE = 'none';

// The #roles post. Posted once by hand (like the reaction-role menus); the bot only answers the dropdown.
function pingMenuMessage() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ID)
    .setPlaceholder('Choose your LFG pings')
    .setMinValues(1)
    .setMaxValues(PING_ROLES.length + 1)
    .addOptions(
      { label: 'No Pings', value: NONE, description: 'Remove all your LFG pings' },
      ...PING_ROLES.map((name) => ({ label: name, value: name })),
    );
  return {
    embeds: [new EmbedBuilder().setTitle('LFG Pings').setDescription("Select which LFG pings you'd like to be notified for:").setColor(BRAND_COLOR)],
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

async function handlePick(interaction) {
  const { member, guild } = interaction;
  const picked = interaction.values.includes(NONE) ? [] : interaction.values;
  const roles = PING_ROLES.map((name) => guild.roles.cache.find((r) => r.name === name)).filter(Boolean);
  const want = roles.filter((r) => picked.includes(r.name));
  const remove = roles.filter((r) => !want.includes(r) && member.roles.cache.has(r.id));
  const add = want.filter((r) => !member.roles.cache.has(r.id));
  if (remove.length) await member.roles.remove(remove, 'Self-picked from the LFG Pings dropdown');
  if (add.length) await member.roles.add(add, 'Self-picked from the LFG Pings dropdown');

  // Re-sending the same components clears the picks from the shared dropdown, then only the picker sees the answer.
  await interaction.update({ components: interaction.message.components });
  const text = want.length ? `Your LFG pings: ${want.join(', ')}` : 'You have no LFG pings.';
  await interaction.followUp({ embeds: [replyEmbed(text)], flags: MessageFlags.Ephemeral });
}

module.exports = [
  {
    name: 'lfgPings',
    label: 'LFG Pings dropdown',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId === ID,
    execute: handlePick,
  },
];
module.exports.pingMenuMessage = pingMenuMessage;
