const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply } = require('../../utils/embeds');
const { setCooldowns } = require('../../utils/farm/play');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('farm-config')
    .setDescription('Staff: testing switches for Hero Farming')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('cooldowns').setDescription('Turn Hero Farming cooldowns off for testing (back on after a restart)')
      .addBooleanOption((o) => o.setName('on').setDescription('True = normal cooldowns, false = no cooldowns').setRequired(true))),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const on = interaction.options.getBoolean('on');
    setCooldowns(on);
    return privateReply(interaction, on ? 'Hero Farming cooldowns are **on**.' : 'Hero Farming cooldowns are **off**: every target is always Ready. They turn back on when the bot restarts.');
  },
};
