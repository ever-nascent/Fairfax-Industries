// /lane guardian|walker|wave lane:<lane>. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// The lanes are LANES in utils/farm/targets.js.
const { SlashCommandBuilder } = require('discord.js');
const { openTarget } = require('../../utils/farm/commands');
const { LANES } = require('../../utils/farm/targets');

// every lane has its own Guardian and Walker
const lane = (o) => o.setName('lane').setDescription('Which lane').setRequired(true).addChoices(...Object.entries(LANES).map(([value, l]) => ({ name: `${l.name} (${l.color})`, value })));

module.exports = {
  data: new SlashCommandBuilder().setName('lane').setDescription('Send your hero down a lane')
    .addSubcommand((s) => s.setName('guardian').setDescription('Take on a lane Guardian').addStringOption(lane))
    .addSubcommand((s) => s.setName('walker').setDescription('Take on a Walker (its lane Guardian must be down)').addStringOption(lane))
    .addSubcommand((s) => s.setName('wave').setDescription('Hold a lane against wave after wave of troopers').addStringOption(lane)),

  // `/lane wave` is the 'waves' target (an endless run, once a day per lane)
  execute: (interaction) => openTarget(interaction, interaction.options.getSubcommand() === 'wave' ? 'waves' : interaction.options.getSubcommand(), interaction.options.getString('lane')),
};
