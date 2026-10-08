const { SlashCommandBuilder } = require('discord.js');
const { openTarget, runRoam } = require('../../utils/farm/commands');

const CAMPS = { 1: 'small-camp', 2: 'medium-camp', 3: 'large-camp' };

module.exports = {
  data: new SlashCommandBuilder().setName('jungle').setDescription('Send your hero into the jungle')
    .addSubcommand((s) => s.setName('camp').setDescription('Take on a camp of Haunts')
      .addIntegerOption((o) => o.setName('tier').setDescription('How tough the camp is').setRequired(true)
        .addChoices({ name: 'Tier 1', value: 1 }, { name: 'Tier 2', value: 2 }, { name: 'Tier 3', value: 3 })))
    .addSubcommand((s) => s.setName('roam').setDescription("Roam for Crates, Sinner's Sacrifices and buffs that make your hero stronger for good"))
    .addSubcommand((s) => s.setName('midboss').setDescription('Take on the Mid-Boss for a Rejuv')),

  execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'roam') return runRoam(interaction);
    return openTarget(interaction, sub === 'camp' ? CAMPS[interaction.options.getInteger('tier')] : 'mid-boss');
  },
};
