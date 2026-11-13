// /shop's section dropdown and buy buttons. Button / dropdown / pop-up routes: each route has `matches` (is this click mine? usually by the customId prefix) and `execute`. components/index.js lists every route file.
// What each buy does: utils/shop/shop.js.
const { MessageFlags } = require('discord.js');
const { heroCardsView, SECTION_VIEWS, STYLES, SECTION_ID, SELECT_ID, STYLE_ID, BUY_ID, EQUIP_ID, BOOST_ID, REJUV_ID, HIDEOUT_BUY_ID, COLOR_ID, DEAL_ID, receipts, FAILED } = require('../utils/shop/shop');
const { buyCard, equipCard, buyBoost, buyRejuv } = require('../utils/economy/xp');
const { buyHideout, getHideout } = require('../utils/shop/hideout');
const { shopConfig } = require('../utils/shop/shopSettings');
const { MODAL_ID, getColorRole, colorModal, buyColorRole } = require('../utils/shop/colorRole');
const { dealOf, buyDeal } = require('../utils/shop/dailyDeal');
const { replyEmbed } = require('../utils/embeds');

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

// A purchase from Shop section `section`: `buy(cfg)` runs after the owner check (`cfg` = this server's Shop settings,
// prices included), the Shop is redrawn, then the buyer privately gets the Shopkeeper's receipt (`receipt(result, cfg)`),
// or `failed` if the purchase threw (it's logged). A section staff turned off sells nothing.
async function purchase(interaction, section, view, buy, receipt, failed = FAILED.card) {
  let text;
  await redraw(interaction, view, async () => {
    try {
      const cfg = await shopConfig(interaction.member.guild.id);
      if (!cfg.on(section)) {
        text = "That's not for sale here anymore.";
        return;
      }
      text = await receipt(await buy(cfg), cfg);
    } catch (error) {
      console.error(`[shop] ${interaction.customId.split(':')[0]} failed:`, error);
      text = failed;
    }
  });
  if (text) await interaction.followUp({ embeds: [replyEmbed(text)], flags: MessageFlags.Ephemeral });
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
      return purchase(
        interaction,
        'hero-cards',
        (m) => heroCardsView(m, slug, style),
        (cfg) => buyCard(interaction.user.id, `${slug}:${style}`, cfg.price(style)),
        (r, cfg) => receipts.card(r, slug, style, cfg.price(style)),
      );
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
    execute: (interaction) =>
      purchase(
        interaction,
        'soul-boost',
        SECTION_VIEWS['soul-boost'],
        (cfg) => buyBoost(interaction.user.id, Date.now(), cfg.price('boost')),
        (r, cfg) => receipts.boost(r, cfg.price('boost')),
      ),
  },
  {
    name: 'shop-rejuv',
    label: 'Rejuv buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${REJUV_ID}:`),
    // The redraw shows the result (carrying one more, or Buy greyed out).
    execute: (interaction) =>
      purchase(
        interaction,
        'rejuv',
        SECTION_VIEWS.rejuv,
        (cfg) => buyRejuv(interaction.user.id, cfg.price('rejuv')),
        (r, cfg) => receipts.rejuv(r, cfg.price('rejuv')),
      ),
  },
  {
    name: 'shop-hideout',
    label: 'Hideout buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${HIDEOUT_BUY_ID}:`),
    // Makes the channels, then the redraw shows Owned + a link to them.
    execute: (interaction) =>
      purchase(
        interaction,
        'hideout',
        SECTION_VIEWS.hideout,
        (cfg) => buyHideout(interaction.member, cfg.price('hideout'), cfg.hideoutLevel),
        async (result, cfg) => receipts.hideout(result, result ? null : await getHideout(interaction.user.id), cfg.price('hideout'), cfg.hideoutLevel),
        FAILED.hideout,
      ),
  },
  {
    name: 'shop-deal',
    label: 'Daily Deal buy',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${DEAL_ID}:`),
    // Buys today's deal (worked out again at the click, so a screen left open past midnight sells today's, at today's price).
    execute: (interaction) => {
      let deal;
      return purchase(
        interaction,
        'daily-deal',
        SECTION_VIEWS['daily-deal'],
        async (cfg) => {
          deal = dealOf(cfg, interaction.member.guild.id);
          return deal ? buyDeal(interaction.user.id, deal) : { ok: false };
        },
        (r) => receipts.deal(r, deal),
      );
    },
  },
  {
    name: 'shop-color',
    label: 'Color Role button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${COLOR_ID}:`),
    // Opens the pop-up (name + hex colour), filled in with the role they have now.
    async execute(interaction) {
      const [, ownerId] = interaction.customId.split(':');
      if (interaction.user.id !== ownerId) return interaction.reply({ content: 'Open your own with `/shop`.', flags: MessageFlags.Ephemeral });
      if (!(await shopConfig(interaction.member.guild.id)).on('color-role')) {
        return interaction.reply({ embeds: [replyEmbed("That's not for sale here anymore.")], flags: MessageFlags.Ephemeral });
      }
      return interaction.showModal(colorModal(ownerId, await getColorRole(interaction.member.guild, ownerId)));
    },
  },
  {
    name: 'shop-color-modal',
    label: 'Color Role pop-up',
    matches: (interaction) => interaction.isModalSubmit() && interaction.customId.startsWith(`${MODAL_ID}:`),
    // Makes or recolors the role, then the Shop is redrawn and the buyer gets a private receipt.
    execute: (interaction) => {
      let price;
      return purchase(
        interaction,
        'color-role',
        SECTION_VIEWS['color-role'],
        async (cfg) => {
          price = cfg.price((await getColorRole(interaction.member.guild, interaction.user.id)) ? 'recolor' : 'color');
          return buyColorRole(interaction.member, interaction.fields.getTextInputValue('name'), interaction.fields.getTextInputValue('color'), cfg);
        },
        (r) => receipts.color(r, price),
        FAILED.color,
      );
    },
  },
];
