const { SlashCommandBuilder } = require('discord.js');
const { openBase } = require('../../utils/farm/commands');

module.exports = {
  data: new SlashCommandBuilder().setName('base').setDescription('Your hero and your base: pick a hero, see your cooldowns, send them out'),
  execute: openBase,
};
