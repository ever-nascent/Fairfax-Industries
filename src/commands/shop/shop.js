// /shop: The Curiosity Shop's first screen. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Pages and buying: utils/shop/shop.js; the dropdown and buttons: components/shop.js.
const { SlashCommandBuilder } = require('discord.js');
const { shopView } = require('../../utils/shop/shop');

module.exports = {
  data: new SlashCommandBuilder().setName('shop').setDescription('Browse the Shop'),

  // Public; only the runner can use its buttons.
  async execute(interaction) {
    await interaction.deferReply();
    await interaction.editReply(await shopView(interaction.member));
  },
};
