const { SlashCommandBuilder } = require('discord.js');
const { shopView } = require('../../utils/shop');

module.exports = {
  data: new SlashCommandBuilder().setName('shop').setDescription('Browse the Shop'),

  // Public (his call, Oct 4); only the runner can use its buttons.
  async execute(interaction) {
    await interaction.deferReply();
    await interaction.editReply(await shopView(interaction.member));
  },
};
