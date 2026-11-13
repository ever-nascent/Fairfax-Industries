// /jackpot's Buy buttons. Button routes: each route has `matches` (is this click mine? by the customId prefix) and `execute`. components/index.js lists every route file.
// The rules: utils/economy/jackpot.js; the screen: commands/xp/jackpot.js.
const { MessageFlags } = require('discord.js');
const { BUY_ID, jackpotView, receipt } = require('../commands/xp/jackpot');
const { buyTickets } = require('../utils/economy/jackpot');
const { replyEmbed } = require('../utils/embeds');

module.exports = [
  {
    name: 'jackpot',
    label: 'Jackpot buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${BUY_ID}:`),
    // Buys the Tickets, redraws the screen, then tells the buyer privately.
    async execute(interaction) {
      const [, ownerId, count] = interaction.customId.split(':');
      if (interaction.user.id !== ownerId) return interaction.reply({ content: 'Open your own with `/jackpot`.', flags: MessageFlags.Ephemeral });
      await interaction.deferUpdate();
      const result = await buyTickets(interaction.guildId, ownerId, Number(count));
      await interaction.editReply(await jackpotView(interaction.member));
      return interaction.followUp({ embeds: [replyEmbed(receipt(result))], flags: MessageFlags.Ephemeral });
    },
  },
];
