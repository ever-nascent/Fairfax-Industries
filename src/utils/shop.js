// The Shop. For now: the hero card section, where members preview any hero's card (with their own
// level and souls) from a dropdown before buying. Rules are in server-plan.md ("The Shop").
const { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getUser, progress, soulsIcon, MAX_LEVEL } = require('./xp');
const { renderRankCard, CARD_COLOR, cardColor } = require('./rankCard');
const { HEROES, getHero, heroArt, heroEmoji } = require('./heroes');

const HERO_CARD_PRICE = 3200;
const SELECT_ID = 'shop_heroes'; // custom id: shop_heroes:<userId>:<menu index>
// 38 heroes, but a dropdown holds at most 25 options: two menus, split in half.
const MENUS = [HEROES.slice(0, 19), HEROES.slice(19)];
const fmt = (n) => n.toLocaleString('en-US');

// The hero card section for `member`, previewing `slug` (null = their current plain card).
// Returns a message payload (embeds, files, components).
async function heroCardsView(member, slug = null) {
  const hero = slug && getHero(slug);
  const art = hero ? await heroArt(hero.slug) : null;
  const user = await getUser(member.id);
  const { level, into, need } = progress(user.xp);
  const png = await renderRankCard({ name: member.displayName, level, into, need, souls: user.souls, maxLevel: MAX_LEVEL, hero: art });
  const file = `card_${hero ? hero.slug : 'plain'}.png`; // a new name per hero so Discord doesn't reuse the old image

  // Placeholder wording (not yet approved, no Shopkeeper voice yet).
  const embed = new EmbedBuilder()
    .setColor(art ? cardColor(art.color) : CARD_COLOR)
    .setTitle(hero ? `Hero Cards: ${hero.name}` : 'Hero Cards')
    .setDescription(hero ? `Preview of the **${hero.name}** card.` : 'Pick a hero to preview their card.')
    .addFields(
      { name: 'Price', value: `${soulsIcon()}${fmt(HERO_CARD_PRICE)} souls`, inline: true },
      { name: 'Your balance', value: `${soulsIcon()}${fmt(user.souls)} souls`, inline: true },
    )
    .setImage(`attachment://${file}`);

  const components = MENUS.map((heroes, i) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${SELECT_ID}:${member.id}:${i}`)
        .setPlaceholder(`Heroes: ${heroes[0].name} – ${heroes[heroes.length - 1].name}`)
        .addOptions(
          heroes.map((h) => ({
            label: h.name,
            value: h.slug,
            emoji: heroEmoji(member.guild, h.slug),
            default: h.slug === hero?.slug,
          })),
        ),
    ),
  );
  return { embeds: [embed], files: [new AttachmentBuilder(png, { name: file })], components };
}

module.exports = { heroCardsView, HERO_CARD_PRICE, SELECT_ID, MENUS };
