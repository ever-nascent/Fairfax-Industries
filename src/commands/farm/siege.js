// /siege: the Base Siege details screen. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
const { SlashCommandBuilder } = require('discord.js');
const { openTarget } = require('../../utils/farm/commands');

module.exports = {
  data: new SlashCommandBuilder().setName('siege').setDescription('Besiege the enemy base: Base Guardians, both Shrines and the Patron in one go'),
  execute: (interaction) => openTarget(interaction, 'siege'),
};
