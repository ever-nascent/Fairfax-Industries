const { MessageFlags } = require('discord.js');
const { heroCardsView, SECTION_VIEWS, STYLES, SECTION_ID, SELECT_ID, STYLE_ID, BUY_ID, EQUIP_ID, BOOST_ID, REJUV_ID, HIDEOUT_BUY_ID } = require('../utils/shop');
const { buyCard, equipCard, buyBoost, buyRejuv } = require('../utils/xp');
const { buyHideout } = require('../utils/hideout');

// /shop's dropdowns and buttons redraw the Shop message with `view(member)`.
// Only the person who opened the Shop can use them.
// `before` runs after the owner check (e.g. the purchase), then the Shop is redrawn.
async function redraw(interaction, view, before) {
  const [, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Open your own with `/shop`.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  if (before) await before();
  // attachments: [] drops the previous card image so only the new one is attached.
  await interaction.editReply({ ...(await view(interaction.member)), attachments: [] });
}

module.exports = [
  {
    name: 'shop-section',
    label: 'Shop section select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${SECTION_ID}:`),
    execute: (interaction) => redraw(interaction, SECTION_VIEWS[interaction.values[0]]),
  },
  {
    name: 'shop',
    label: 'Hero card select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${SELECT_ID}:`),
    // Picking a hero keeps the style on screen (last part of the id).
    execute: (interaction) => redraw(interaction, (m) => heroCardsView(m, interaction.values[0], interaction.customId.split(':')[3])),
  },
  {
    name: 'shop-style',
    label: 'Hero card style',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${STYLE_ID}:`),
    execute: (interaction) => {
      const [, , slug, style] = interaction.customId.split(':');
      return redraw(interaction, (m) => heroCardsView(m, slug, style));
    },
  },
  {
    name: 'shop-buy',
    label: 'Hero card buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${BUY_ID}:`),
    // The redraw shows the result (Equipped, or Buy still greyed out if they couldn't afford it).
    execute: (interaction) => {
      const [, , slug, style] = interaction.customId.split(':');
      if (!STYLES[style]) return;
      return redraw(interaction, (m) => heroCardsView(m, slug, style), () => buyCard(interaction.user.id, `${slug}:${style}`, STYLES[style].price));
    },
  },
  {
    name: 'shop-equip',
    label: 'Hero card equip',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${EQUIP_ID}:`),
    execute: (interaction) => {
      const [, , slug, style] = interaction.customId.split(':');
      const key = slug === 'plain' ? null : `${slug}:${style}`;
      return redraw(interaction, (m) => heroCardsView(m, slug === 'plain' ? null : slug, style), () => equipCard(interaction.user.id, key));
    },
  },
  {
    name: 'shop-boost',
    label: 'Soul Boost buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${BOOST_ID}:`),
    // The redraw shows the result (time left, or Buy greyed out if they couldn't afford it).
    execute: (interaction) => redraw(interaction, SECTION_VIEWS['soul-boost'], () => buyBoost(interaction.user.id)),
  },
  {
    name: 'shop-rejuv',
    label: 'Rejuv buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${REJUV_ID}:`),
    // The redraw shows the result (carrying one more, or Buy greyed out).
    execute: (interaction) => redraw(interaction, SECTION_VIEWS.rejuv, () => buyRejuv(interaction.user.id)),
  },
  {
    name: 'shop-hideout',
    label: 'Hideout buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${HIDEOUT_BUY_ID}:`),
    // Makes the channels, then the redraw shows Owned + a link to them.
    execute: (interaction) => redraw(interaction, SECTION_VIEWS.hideout, () => buyHideout(interaction.member)),
  },
];
