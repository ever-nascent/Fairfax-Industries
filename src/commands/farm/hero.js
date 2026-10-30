// /hero: the hero card (level, abilities, stats, items). A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Shared with the other farm commands: utils/farm/commands.js.
const { SlashCommandBuilder } = require('discord.js');
const { openHero } = require('../../utils/farm/commands');

module.exports = {
  data: new SlashCommandBuilder().setName('hero').setDescription("Your hero's level, abilities, stats and items"),
  execute: openHero,
};
