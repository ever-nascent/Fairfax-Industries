const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { shopView } = require('../../utils/shop');

module.exports = {
  data: new SlashCommandBuilder().setName('shop').setDescription('Browse the Shop'),

  // Only you see your Shop, so nobody else can flip through your previews.
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(await shopView(interaction.member));
  },
};
