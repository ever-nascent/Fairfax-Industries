// The Shop. `/shop` opens on the first screen (banner + a section dropdown); the Hero Cards section lets
// members preview any hero's card (with their own level and souls) before buying, in either style.
// Rules are in server-plan.md ("The Shop").
const path = require('node:path');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getUser, progress, MAX_LEVEL, BOOST_PRICE, REJUV_PRICE, REJUV_MAX } = require('./xp');
const { getHideout, HIDEOUT_PRICE, HIDEOUT_LEVEL } = require('./hideout');
const { renderRankCard, CARD_COLOR, cardColor } = require('./rankCard');
const { renderShopBanner, renderItemPage } = require('./shopBanner');
const { HEROES, getHero, heroArt, heroEmoji } = require('./heroes');
const { fmt, soulsIcon, soulsText } = require('./format');
const { pickRandom } = require('./random');
const { ASSETS } = require('./art');

// The two card styles, sold separately (priced like in-game item tiers).
const STYLES = {
  icon: { label: 'Icon', price: 800 },
  portrait: { label: 'Full Portrait', price: 3200 },
};
const SECTION_ID = 'shop_section'; // custom id: shop_section:<userId>
const BOOST_ID = 'shop_boost'; // custom id: shop_boost:<userId>
const REJUV_ID = 'shop_rejuv'; // custom id: shop_rejuv:<userId>
const HIDEOUT_BUY_ID = 'shop_hideout'; // custom id: shop_hideout:<userId>
const SELECT_ID = 'shop_heroes'; // custom id: shop_heroes:<userId>:<menu index>:<style>
const STYLE_ID = 'shop_style'; // custom id: shop_style:<userId>:<hero slug>:<style>
const BUY_ID = 'shop_buy'; // custom id: shop_buy:<userId>:<hero slug>:<style>
const EQUIP_ID = 'shop_equip'; // custom id: shop_equip:<userId>:<hero slug, or 'plain'>:<style>
// 38 heroes, but a dropdown holds at most 25 options: two menus, split in half.
const MENUS = [HEROES.slice(0, 19), HEROES.slice(19)];
const SHOP_COLOR = 0xe39a3b; // the Curiosity Shop sign's glow
const SHOP_ICON = path.join(ASSETS, 'shop', 'art', 'shop_icon.png'); // deadlock.wiki minimap shop icon

// The Shopkeeper greets you on the first screen with one of these.
const GREETINGS = [
  "Come on in! Everything on the shelf's got a price, and I only take Souls. No IOUs.",
  'Finest merchandise this side of the river. You touch it, you bought it.',
  "Browse all you want, pal. Just don't fog up the glass.",
  "Back again? I knew you had taste. Let's see what's burnin' a hole in your pocket.",
];

// The Shop's sections, in shelf order. `emoji` is the name of a server emoji (null = none yet).
const SECTIONS = [
  { value: 'hero-cards', label: 'Hero Cards', description: 'Put a hero on your /rank card. 800 or 3,200 Souls', emoji: null },
  { value: 'soul-boost', label: 'Soul Boost', description: '2× XP and Souls for 1 hour. 1,600 Souls', emoji: 'souls' },
  { value: 'rejuv', label: 'Rejuv', description: 'Saves a broken /urn streak. 3,200 Souls, carry up to 3', emoji: 'rejuv' },
  { value: 'hideout', label: 'Hideout', description: 'Your own private VC + text channel. 6,400 Souls, level 20+', emoji: 'hideout' },
];

// The section dropdown, on top of every Shop page. `current` = the section on screen (null on the first screen).
function sectionRow(member, current, heroSlug) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${SECTION_ID}:${member.id}`)
      .setPlaceholder('Pick a section')
      .addOptions(
        SECTIONS.map((s) => ({
          label: s.label,
          value: s.value,
          description: s.description,
          // Hero Cards shows the member's equipped hero
          emoji: heroEmoji(member.guild, s.value === 'hero-cards' ? heroSlug : s.emoji),
          default: s.value === current,
        })),
      ),
  );
}

// The equipped hero ('<slug>:<style>' -> slug), or Haze when they have none.
const equippedHero = (user) => user.card?.split(':')[0] ?? 'haze';

// A Curiosity Shop page: the Shopkeeper's words, the page image (`<file>.png`), the section dropdown
// (`section` on screen, null on the first screen) and an optional row of `buttons`.
function shopPage(member, user, { section, file, text, png, buttons }) {
  const embed = new EmbedBuilder()
    .setColor(SHOP_COLOR)
    .setAuthor({ name: 'The Curiosity Shop', iconURL: 'attachment://shop_icon.png' })
    .setDescription(text)
    .setImage(`attachment://${file}.png`);
  const components = [sectionRow(member, section, equippedHero(user))];
  if (buttons) components.push(new ActionRowBuilder().addComponents(buttons));
  return {
    embeds: [embed],
    files: [new AttachmentBuilder(png, { name: `${file}.png` }), new AttachmentBuilder(SHOP_ICON, { name: 'shop_icon.png' })],
    components,
  };
}

// The Shop's first screen: a Shopkeeper greeting, the banner, the section dropdown.
async function shopView(member) {
  const user = await getUser(member.id);
  const { level, into, need } = progress(user.xp);
  const png = await renderShopBanner({ name: member.displayName, level, fill: need ? into / need : 1, souls: user.souls, heroSlug: equippedHero(user) });
  return shopPage(member, user, { section: null, file: 'shop', text: pickRandom(GREETINGS), png });
}

// The hero card section for `member`, previewing `slug` (null = their current plain card) in `style`.
// Returns a message payload (embeds, files, components).
async function heroCardsView(member, slug = null, style = 'portrait') {
  if (!STYLES[style]) style = 'portrait';
  const hero = slug && getHero(slug);
  const art = hero ? await heroArt(hero.slug, style) : null;
  const user = await getUser(member.id);
  const { level, into, need } = progress(user.xp);
  const png = await renderRankCard({ name: member.displayName, level, into, need, souls: user.souls, maxLevel: MAX_LEVEL, hero: art });
  const key = hero ? `${hero.slug}:${style}` : null;
  const owned = key && user.cards.includes(key);
  const equipped = key === user.card;
  const file = `card_${hero ? `${hero.slug}_${style}` : 'plain'}.png`; // a new name per card so Discord doesn't reuse the old image

  // The Shopkeeper's words (awaiting his OK, Sept 28).
  const card = hero && `**${hero.name}** card (${STYLES[style].label})`;
  const embed = new EmbedBuilder()
    .setColor(art ? cardColor(art.color) : CARD_COLOR)
    .setTitle(hero ? `Hero Cards: ${hero.name}` : 'Hero Cards')
    .setDescription(
      !hero
        ? 'Pick a face, any face. Every hero in the city, framed and ready for your `/rank`.'
        : equipped
          ? `Your ${card} is on your \`/rank\`. Wearin' it well, pal.`
          : owned
            ? `You already own the ${card}. Hit Equip and show it off.`
            : `The ${card}. Looks good on ya. Want it?`,
    )
    .addFields(
      {
        name: 'Price',
        value: owned
          ? 'Owned'
          : hero
          ? soulsText(STYLES[style].price)
          : Object.values(STYLES).map((s) => `${s.label}: ${soulsIcon()}${fmt(s.price)}`).join('\n'),
        inline: true,
      },
      { name: 'Your Balance', value: soulsText(user.souls), inline: true },
    )
    .setImage(`attachment://${file}`);

  const components = [sectionRow(member, 'hero-cards', equippedHero(user)), ...MENUS.map((heroes, i) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${SELECT_ID}:${member.id}:${i}:${style}`)
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
  )];
  // Style buttons under the card (the one on screen is highlighted and disabled), then Buy / Equip.
  if (hero) {
    const price = STYLES[style].price;
    const action = new ButtonBuilder().setStyle(ButtonStyle.Success);
    if (equipped) action.setCustomId(`${EQUIP_ID}:${member.id}:${hero.slug}:${style}`).setLabel('Equipped').setDisabled(true);
    else if (owned) action.setCustomId(`${EQUIP_ID}:${member.id}:${hero.slug}:${style}`).setLabel('Equip');
    else action.setCustomId(`${BUY_ID}:${member.id}:${hero.slug}:${style}`).setLabel(`Buy (${fmt(price)})`).setDisabled(user.souls < price);
    components.push(
      new ActionRowBuilder().addComponents(
        ...Object.entries(STYLES).map(([k, s]) =>
          new ButtonBuilder()
            .setCustomId(`${STYLE_ID}:${member.id}:${hero.slug}:${k}`)
            .setLabel(s.label)
            .setStyle(k === style ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(k === style),
        ),
        action,
      ),
    );
  } else if (user.card) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${EQUIP_ID}:${member.id}:plain:${style}`).setLabel('Use Plain Card').setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return { embeds: [embed], files: [new AttachmentBuilder(png, { name: file })], components };
}

// Soul Boost: 2x XP and souls for an hour (rules in xp.js). Buying while one runs adds an hour.
async function soulBoostView(member, now = Date.now()) {
  const user = await getUser(member.id);
  const active = user.boostUntil > now;
  const png = await renderItemPage({
    item: 'soulBoost',
    tier: 2,
    price: '1600',
    title: 'SOUL BOOST',
    subtitle: 'DOUBLE EVERYTHING FOR AN HOUR',
    lines: [
      '2× XP from chat and voice',
      '2× Souls from level-ups, /urn and /trivia',
      'Lasts 1 hour from when you buy it',
      'Buy another while it runs to add an hour',
      "Doesn't double game winnings",
    ],
    cells: [
      { kind: 'souls', label: 'YOUR SOULS', value: fmt(user.souls), sub: `OF ${fmt(BOOST_PRICE)}`, ok: user.souls >= BOOST_PRICE },
      { kind: 'text', label: 'BOOST', value: active ? `${Math.ceil((user.boostUntil - now) / 60000)} MIN LEFT` : 'NOT ACTIVE' },
    ],
  });
  const line = "One hour, double everything. Don't waste it standin' around admirin' yourself.";
  return shopPage(member, user, {
    section: 'soul-boost',
    file: 'soul-boost',
    text: active ? `${line}\n\nYour boost runs out <t:${Math.floor(user.boostUntil / 1000)}:R>.` : line,
    png,
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${BOOST_ID}:${member.id}`)
        .setLabel(`${active ? 'Add an Hour' : 'Buy'} (${fmt(BOOST_PRICE)})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(user.souls < BOOST_PRICE),
    ],
  });
}

// Rejuv: saves a broken /urn streak (rules in xp.js claimUrn). Carry up to 3.
async function rejuvView(member) {
  const user = await getUser(member.id);
  const full = user.rejuvs >= REJUV_MAX;
  const png = await renderItemPage({
    item: 'rejuv',
    tier: 3,
    price: String(REJUV_PRICE),
    title: 'REJUV',
    subtitle: 'A SECOND LIFE FOR YOUR STREAK',
    lines: [
      ['Saves a broken ', '/urn', ' streak'],
      'One Rejuv saves it, however many days you missed',
      '/urn asks first: Use Rejuv or Start Over',
      ['Carry up to ', String(REJUV_MAX), ' at a time'],
    ],
    cells: [
      { kind: 'souls', label: 'YOUR SOULS', value: fmt(user.souls), sub: `OF ${fmt(REJUV_PRICE)}`, ok: user.souls >= REJUV_PRICE },
      { kind: 'text', label: 'CARRYING', value: `${user.rejuvs} / ${REJUV_MAX}`, ok: !full },
    ],
  });
  const line = "Miss a day, lose the streak. Unless you got one of these in your pocket. Call it insurance, pal.";
  return shopPage(member, user, {
    section: 'rejuv',
    file: 'rejuv',
    text: full ? `${line}\n\nYou're carrying the max. Use one before you buy another.` : line,
    png,
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${REJUV_ID}:${member.id}`)
        .setLabel(`Buy (${fmt(REJUV_PRICE)})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(full || user.souls < REJUV_PRICE),
    ],
  });
}

// Hideout: a private voice + text channel of your own (hideout.js). Level 20+, one per member, kept for good.
async function hideoutView(member) {
  const user = await getUser(member.id);
  const owned = await getHideout(member.id);
  const { level, into, need } = progress(user.xp);
  const png = await renderItemPage({
    item: 'hideout',
    tier: 4,
    price: String(HIDEOUT_PRICE),
    title: 'HIDEOUT',
    subtitle: 'A PLACE TO LAY LOW',
    lines: [
      'A private voice channel + a matching text channel',
      ['Named ', `"${member.displayName}'s Hideout"`, ' (rename once a day)'],
      'Only you, staff and members you add get in',
      'Control panel pinned in your text channel',
      'Yours for good, even if you leave and come back',
    ],
    cells: [
      { kind: 'level', label: 'LEVEL NEEDED', value: String(HIDEOUT_LEVEL), ok: level >= HIDEOUT_LEVEL },
      { kind: 'souls', label: 'YOUR SOULS', value: fmt(user.souls), sub: `OF ${fmt(HIDEOUT_PRICE)}`, ok: user.souls >= HIDEOUT_PRICE },
    ],
    level,
    fill: need ? into / need : 1,
  });
  const buy = new ButtonBuilder().setStyle(ButtonStyle.Success);
  const buttons = [buy];
  if (owned) {
    buy.setCustomId(`${HIDEOUT_BUY_ID}:${member.id}`).setLabel('Owned').setDisabled(true);
    if (owned.textId) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Go to Your Hideout').setURL(`https://discord.com/channels/${member.guild.id}/${owned.textId}`));
  } else {
    buy.setCustomId(`${HIDEOUT_BUY_ID}:${member.id}`).setLabel(`Buy (${fmt(HIDEOUT_PRICE)})`).setDisabled(level < HIDEOUT_LEVEL || user.souls < HIDEOUT_PRICE);
  }
  return shopPage(member, user, {
    section: 'hideout',
    file: 'hideout',
    text: 'Every regular needs a place to lay low. Four walls, a lock, and nobody gets in unless you say so.',
    png,
    buttons,
  });
}

// Each section's page.
const SECTION_VIEWS = {
  'hero-cards': (member) => heroCardsView(member),
  'soul-boost': (member) => soulBoostView(member),
  rejuv: (member) => rejuvView(member),
  hideout: (member) => hideoutView(member),
};

module.exports = {
  shopView, heroCardsView, SECTION_VIEWS, SECTIONS, STYLES, SECTION_ID, SELECT_ID, STYLE_ID, BUY_ID, EQUIP_ID, BOOST_ID, REJUV_ID, HIDEOUT_BUY_ID, MENUS,
};
