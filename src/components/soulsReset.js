// The Reset Everyone / Cancel buttons under /souls reset-all (utils/economy/soulsReset.js). Only the staff member who ran it can press them.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { RESET_ID, saveCopy } = require('../utils/economy/soulsReset');
const { resetAllSouls } = require('../utils/economy/xp');
const { replyEmbed } = require('../utils/embeds');
const { fmt, boldSouls } = require('../utils/format');
const audit = require('../utils/audit/auditLog');

async function onPick(interaction) {
  const [, userId, choice] = interaction.customId.split(':');
  if (userId !== interaction.user.id) return interaction.reply({ content: 'That is not your reset.', flags: MessageFlags.Ephemeral });
  if (choice !== 'yes') return interaction.update({ embeds: [replyEmbed('Cancelled. Nobody lost anything.')], components: [] });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.update({ embeds: [replyEmbed('You need Manage Server for that.')], components: [] });
  await interaction.update({ embeds: [replyEmbed('Resetting...')], components: [] }); // answers at once; the reset can take a while
  const copy = `resetBackups/${require('node:path').basename(saveCopy())}`; // the folder's name only, never where the bot's files are
  const { members, souls } = await resetAllSouls();
  const embed = audit.entryEmbed({
    color: audit.COLOR.edit,
    title: 'Staff edit: souls reset for everyone',
    fields: [
      { name: 'Staff', value: audit.who(interaction.user), inline: true },
      { name: 'Members', value: fmt(members), inline: true },
      { name: 'Souls taken', value: fmt(souls), inline: true },
      { name: 'Copy saved as', value: `\`${copy}\`` },
    ],
  });
  await audit.log(interaction.guild, 'staff-edit', embed, { userIds: [interaction.user.id] });
  return interaction.editReply({ embeds: [replyEmbed(`Done. **${fmt(members)} members** are at 0 (${boldSouls(souls)} gone). A copy is in \`${copy}\`.`)] });
}

module.exports = [
  {
    name: 'soulsReset',
    label: 'Reset everyone button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${RESET_ID}:`),
    execute: onPick,
  },
];
