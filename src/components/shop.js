const { MessageFlags } = require('discord.js');
const { heroCardsView, SELECT_ID } = require('../utils/shop');

// Picking a hero in /shop's dropdown: redraw the embed with that hero's card.
async function handleHeroSelect(interaction) {
  const [, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Open your own with `/shop`.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  // attachments: [] drops the previous card image so only the new one is attached.
  await interaction.editReply({ ...(await heroCardsView(interaction.member, interaction.values[0])), attachments: [] });
}

module.exports = [
  {
    name: 'shop',
    label: 'Hero card select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${SELECT_ID}:`),
    execute: handleHeroSelect,
  },
];
