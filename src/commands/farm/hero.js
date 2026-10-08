const { SlashCommandBuilder } = require('discord.js');
const { openHero } = require('../../utils/farm/commands');

module.exports = {
  data: new SlashCommandBuilder().setName('hero').setDescription("Your hero's level, abilities, stats and items"),
  execute: openHero,
};
