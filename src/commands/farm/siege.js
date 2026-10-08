const { SlashCommandBuilder } = require('discord.js');
const { openTarget } = require('../../utils/farm/commands');

module.exports = {
  data: new SlashCommandBuilder().setName('siege').setDescription('Besiege the enemy base: Base Guardians, both Shrines and the Patron in one go'),
  execute: (interaction) => openTarget(interaction, 'siege'),
};
