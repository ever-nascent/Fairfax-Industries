// /base: Hero Farming's home screen (or the hero pick the first time). A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// All farm commands share utils/farm/commands.js; the buttons after it are components/farm.js.
const { SlashCommandBuilder } = require('discord.js');
const { openBase } = require('../../utils/farm/commands');

module.exports = {
  data: new SlashCommandBuilder().setName('base').setDescription('Your hero and your base: pick a hero, see your cooldowns, send them out'),
  execute: openBase,
};
