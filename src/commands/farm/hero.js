// /hero view: the hero card (level, abilities, stats, items). /hero unlock: the Unlock Hero screen (spend a Character Unlock Token; his ask Nov 4).
// A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Shared with the other farm commands: utils/farm/commands.js.
const { SlashCommandBuilder } = require('discord.js');
const { openHero, openUnlock } = require('../../utils/farm/commands');

module.exports = {
  data: new SlashCommandBuilder().setName('hero').setDescription('Your Hero Farming hero')
    .addSubcommand((s) => s.setName('view').setDescription("Your hero's level, abilities, stats and items"))
    .addSubcommand((s) => s.setName('unlock').setDescription('Unlock another hero with a Character Unlock Token')),
  execute: (interaction) => (interaction.options.getSubcommand() === 'unlock' ? openUnlock(interaction) : openHero(interaction)),
};
