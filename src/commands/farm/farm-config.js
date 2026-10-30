// /farm-config cooldowns (bot owner only): turn farm cooldowns off for testing, for every server (back on after a restart). A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireOwner } = require('../../utils/permissions');
const { privateReply } = require('../../utils/embeds');
const { setCooldowns } = require('../../utils/farm/play');

module.exports = {
  homeOnly: true, // registered in the Fairfax server only (deploy-commands.js)
  data: new SlashCommandBuilder()
    .setName('farm-config')
    .setDescription('Bot owner: testing switches for Hero Farming')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('cooldowns').setDescription('Turn Hero Farming cooldowns off for testing (back on after a restart)')
      .addBooleanOption((o) => o.setName('on').setDescription('True = normal cooldowns, false = no cooldowns').setRequired(true))),

  async execute(interaction) {
    if (!(await requireOwner(interaction))) return;
    const on = interaction.options.getBoolean('on');
    setCooldowns(on);
    return privateReply(interaction, on ? 'Hero Farming cooldowns are **on**.' : 'Hero Farming cooldowns are **off**: every target is always Ready. They turn back on when the bot restarts.');
  },
};
