// The "Rename the role too?" buttons after /lfg-config region-rename. Rename Role opens a pop-up to type the new name; Keep Role Name closes the question.
// Only the staff member who ran the command can answer. Region settings: utils/server/lfg.js.
const { ActionRowBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } = require('discord.js');
const { OWNER_ID, GUILD_ID } = require('../config');
const { replyEmbed } = require('../utils/embeds');
const { getSettings } = require('../utils/server/lfg');

const BUTTON = 'lfg_role:';
const MODAL = 'lfg_role_name:';

const say = (interaction, text) => interaction.reply({ embeds: [replyEmbed(text)], flags: MessageFlags.Ephemeral });
const canRename = (interaction) => (interaction.user.id === OWNER_ID && interaction.guildId === GUILD_ID) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);

// The region's linked role, or null (unlinked, or the role is gone).
async function regionRole(interaction, key) {
  const region = (await getSettings(interaction.guildId))?.regions?.[key];
  return region?.roleId ? interaction.guild.roles.cache.get(region.roleId) ?? null : null;
}

async function handleButton(interaction) {
  const [, action, userId, key] = interaction.customId.split(':');
  if (interaction.user.id !== userId) return say(interaction, 'Only the person who ran the rename can answer this.');
  if (action === 'keep') return interaction.update({ embeds: [replyEmbed('Left the role as it is.')], components: [] });
  if (!canRename(interaction)) return say(interaction, "You need Manage Roles to rename a role.");
  const role = await regionRole(interaction, key);
  if (!role) return interaction.update({ embeds: [replyEmbed("That region's role is gone, so there is nothing to rename.")], components: [] });
  const modal = new ModalBuilder().setCustomId(`${MODAL}${key}`).setTitle('Rename the Role').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('name').setLabel('New role name').setStyle(TextInputStyle.Short).setMaxLength(100).setValue(role.name.slice(0, 100)).setRequired(true),
    ),
  );
  return interaction.showModal(modal);
}

async function handleModal(interaction) {
  const role = await regionRole(interaction, interaction.customId.slice(MODAL.length));
  const name = interaction.fields.getTextInputValue('name').trim();
  if (!role) return say(interaction, "That region's role is gone, so there is nothing to rename.");
  const before = role.name;
  const failed = await role.setName(name, `LFG region role renamed by ${interaction.user.tag}`).then(() => null, (e) => e.message);
  if (failed) return say(interaction, `I couldn't rename ${role}: ${failed}`);
  // The same message the buttons were on: swap the question for the answer.
  return interaction.update({ embeds: [replyEmbed(`Renamed the role **${before}** to ${role}.`)], components: [] });
}

module.exports = [
  {
    name: 'lfgRegions',
    label: 'Rename role buttons',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(BUTTON),
    execute: handleButton,
  },
  {
    name: 'lfgRegions',
    label: 'Rename role pop-up',
    matches: (interaction) => interaction.isModalSubmit() && interaction.customId.startsWith(MODAL),
    execute: handleModal,
  },
];
