// The Hideout control panel (pinned in the owner's text channel): member pickers, buttons and their pop-ups.
// Only the owner can use them. Custom ids: hideout:<owner id>:<action>.
const { MessageFlags } = require('discord.js');
const { replyEmbed } = require('../utils/embeds');
const hideout = require('../utils/hideout');

const reply = (interaction, text) => interaction.reply({ embeds: [replyEmbed(text)], flags: MessageFlags.Ephemeral });

async function onPanel(interaction) {
  const [, ownerId, action] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) return reply(interaction, "This isn't your Hideout. Only its owner can use the panel.");
  const { guild } = interaction;
  const h = await hideout.getHideout(ownerId);
  if (!h || h.pending) return reply(interaction, "This Hideout isn't set up anymore.");

  if (action === 'rename' || action === 'limit') return interaction.showModal(hideout.panelModal(action, ownerId, h, guild));

  if (action === 'rename_modal') {
    const name = interaction.fields.getTextInputValue('name').trim();
    const error = await hideout.rename(guild, ownerId, name);
    return reply(interaction, error ?? `Renamed to **${name}**.`);
  }
  if (action === 'limit_modal') {
    const limit = Number(interaction.fields.getTextInputValue('limit'));
    if (!Number.isInteger(limit) || limit < 0 || limit > 99) return reply(interaction, 'Pick a number from 0 to 99 (0 = no limit).');
    await hideout.setLimit(guild, ownerId, limit);
    return reply(interaction, limit ? `Voice limit set to **${limit}**.` : 'Voice limit removed.');
  }
  // The pickers on the panel: changing access takes a moment, so acknowledge first; the panel redraws itself
  // (which also clears the picks), then only the owner sees the answer.
  if (action === 'add_pick') {
    await interaction.deferUpdate();
    const added = await hideout.addMembers(guild, ownerId, [...interaction.users.values()]);
    const text = added.length ? `Let in: ${added.map((id) => `<@${id}>`).join(', ')}` : 'Nobody new to let in.';
    return interaction.followUp({ embeds: [replyEmbed(text)], flags: MessageFlags.Ephemeral });
  }
  if (action === 'remove_pick') {
    await interaction.deferUpdate();
    await hideout.removeMembers(guild, ownerId, interaction.values);
    return interaction.followUp({ embeds: [replyEmbed(`Removed: ${interaction.values.map((id) => `<@${id}>`).join(', ')}`)], flags: MessageFlags.Ephemeral });
  }
}

module.exports = [
  {
    name: 'hideout',
    label: 'Hideout panel',
    matches: (interaction) => typeof interaction.customId === 'string' && interaction.customId.startsWith(`${hideout.PANEL_ID}:`),
    execute: onPanel,
  },
];
