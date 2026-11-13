// The Shop. `/shop` opens on the first screen (banner + a section dropdown); the Hero Cards section lets
// members preview any hero's card (with their own level and souls) before buying, in either style.
// Rules are in server-plan.md ("The Shop").
const path = require('node:path');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getUser, progress, MAX_LEVEL, REJUV_MAX } = require('../economy/xp');
const { SCALE } = require('../economy/economy');
const { getHideout } = require('./hideout');
const { shopConfig } = require('./shopSettings');
const { getColorRole } = require('./colorRole');
const { DEAL_OFF, dealOf } = require('./dailyDeal');
const { isHomeGuild } = require('../guild');
const { renderRankCard, CARD_COLOR, cardColor } = require('../economy/rankCard');
const { renderShopBanner, renderItemPage } = require('./shopBanner');
const { HEROES, getHero, heroArt, heroEmoji } = require('../heroes');
const { fmt, soulsIcon, soulsText, boldSouls, rejuvIcon } = require('../format');
const { pickRandom } = require('../random');
const { ASSETS, isJpeg } = require('../art');

// The two card styles, sold separately (priced like in-game item tiers). `price` is the default; a server's own
// price is `cfg.price(style)` (/shop-config).
const STYLES = {
  icon: { label: 'Icon', price: 800 * SCALE },
  portrait: { label: 'Full Portrait', price: 3200 * SCALE },
};
const SECTION_ID = 'shop_section'; // custom id: shop_section:<userId>
const BOOST_ID = 'shop_boost'; // custom id: shop_boost:<userId>
const REJUV_ID = 'shop_rejuv'; // custom id: shop_rejuv:<userId>
const HIDEOUT_BUY_ID = 'shop_hideout'; // custom id: shop_hideout:<userId>
const DEAL_ID = 'shop_deal'; // custom id: shop_deal:<userId> (buys today's Daily Deal, dailyDeal.js)
const COLOR_ID = 'shop_color'; // custom id: shop_color:<userId> (opens the pop-up; the pop-up's id is in colorRole.js)
const SELECT_ID = 'shop_heroes'; // custom id: shop_heroes:<userId>:<menu index>:<style>
const STYLE_ID = 'shop_style'; // custom id: shop_style:<userId>:<hero slug>:<style>
const BUY_ID = 'shop_buy'; // custom id: shop_buy:<userId>:<hero slug>:<style>
const EQUIP_ID = 'shop_equip'; // custom id: shop_equip:<userId>:<hero slug, or 'plain'>:<style>
// 44 heroes, but a dropdown holds at most 25 options: two menus, split in half.
const HALF = Math.ceil(HEROES.length / 2);
const MENUS = [HEROES.slice(0, HALF), HEROES.slice(HALF)];
const SHOP_COLOR = 0xe39a3b; // the Curiosity Shop sign's glow
const SHOP_ICON = path.join(ASSETS, 'shop', 'art', 'shop_icon.png'); // deadlock.wiki minimap shop icon

// The Shopkeeper greets you on the first screen with one of these.
const GREETINGS = [
  "Come on in! Everything on the shelf's got a price, and I only take Souls. No IOUs.",
  'Finest merchandise this side of the river. You touch it, you bought it.',
  "Browse all you want, pal. Just don't fog up the glass.",
  "Back again? I knew you had taste. Let's see what's burnin' a hole in your pocket.",
];

// The Shop's sections, in shelf order. `emoji` is the name of a server emoji (null = none yet). `description(cfg)`
// is the dropdown's line, with this server's prices.
const SECTIONS = [
  { value: 'daily-deal', label: 'Daily Deal', description: () => `One thing at ${Math.round(DEAL_OFF * 100)}% off. Changes at midnight UTC`, emoji: 'souls' },
  { value: 'hero-cards', label: 'Hero Cards', description: (c) => `Put a hero on your /rank card. ${fmt(c.price('icon'))} or ${fmt(c.price('portrait'))} Souls`, emoji: null },
  { value: 'soul-boost', label: 'Soul Boost', description: (c) => `2× XP and Souls for 1 hour. ${fmt(c.price('boost'))} Souls`, emoji: 'souls' },
  { value: 'rejuv', label: 'Rejuv', description: (c) => `Saves a broken /urn streak. ${fmt(c.price('rejuv'))} Souls, carry up to 3`, emoji: 'rejuv' },
  { value: 'hideout', label: 'Hideout', description: (c) => `Your own private VC + text channel. ${fmt(c.price('hideout'))} Souls, level ${c.hideoutLevel}+`, emoji: 'hideout' },
  { value: 'color-role', label: 'Color Role', description: (c) => `A role with your own name and color. ${fmt(c.price('color'))} Souls`, emoji: null },
];

// The sections on sale in `guildId`'s Shop: the ones staff left on (/shop-config); Hideouts only in Fairfax
// (they are built for its channels and category); the Daily Deal only while there is one (dailyDeal.js).
const onSale = (cfg, guildId) => SECTIONS.filter((s) => cfg.on(s.value) && (s.value !== 'hideout' || isHomeGuild(guildId)) && (s.value !== 'daily-deal' || dealOf(cfg, guildId)));

// The section dropdown, on top of every Shop page. `current` = the section on screen (null on the first screen).
function sectionRow(member, current, heroSlug, cfg) {
  if (!onSale(cfg, member.guild.id).length) return null; // a dropdown can't be empty
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${SECTION_ID}:${member.id}`)
      .setPlaceholder('Pick a section')
      .addOptions(
        onSale(cfg, member.guild.id).map((s) => ({
          label: s.label,
          value: s.value,
          description: s.description(cfg),
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
function shopPage(member, user, cfg, { section, file, text, png, buttons }) {
  const embed = new EmbedBuilder()
    .setColor(SHOP_COLOR)
    .setAuthor({ name: 'The Curiosity Shop', iconURL: 'attachment://shop_icon.png' })
    .setDescription(text)
    .setImage(`attachment://${file}.${isJpeg(png) ? 'jpg' : 'png'}`);
  const components = [sectionRow(member, section, equippedHero(user), cfg)].filter(Boolean);
  if (buttons) components.push(new ActionRowBuilder().addComponents(buttons));
  return {
    embeds: [embed],
    files: [new AttachmentBuilder(png, { name: `${file}.${isJpeg(png) ? 'jpg' : 'png'}` }), new AttachmentBuilder(SHOP_ICON, { name: 'shop_icon.png' })],
    components,
  };
}

// The Shop's first screen: a Shopkeeper greeting, the banner, the section dropdown.
async function shopView(member) {
  const user = await getUser(member.id);
  const cfg = await shopConfig(member.guild.id);
  const { level, into, need } = progress(user.xp);
  const png = await renderShopBanner({ name: member.displayName, level, fill: need ? into / need : 1, souls: user.souls, heroSlug: equippedHero(user) });
  const empty = onSale(cfg, member.guild.id).length ? '' : "\n\nShelves are bare right now. Staff haven't put anything out.";
  return shopPage(member, user, cfg, { section: null, file: 'shop', text: pickRandom(GREETINGS) + empty, png });
}

// The hero card section for `member`, previewing `slug` (null = their current plain card) in `style`.
// Returns a message payload (embeds, files, components).
async function heroCardsView(member, slug = null, style = 'portrait') {
  if (!STYLES[style]) style = 'portrait';
  const hero = slug && getHero(slug);
  const art = hero ? await heroArt(hero.slug, style) : null;
  const user = await getUser(member.id);
  const cfg = await shopConfig(member.guild.id);
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
          ? soulsText(cfg.price(style))
          : Object.entries(STYLES).map(([k, s]) => `${s.label}: ${soulsIcon()}${fmt(cfg.price(k))}`).join('\n'),
        inline: true,
      },
      { name: 'Your Balance', value: soulsText(user.souls), inline: true },
    )
    .setImage(`attachment://${file}`);

  const components = [sectionRow(member, 'hero-cards', equippedHero(user), cfg), ...MENUS.map((heroes, i) =>
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
  )].filter(Boolean);
  // Style buttons under the card (the one on screen is highlighted and disabled), then Buy / Equip.
  if (hero) {
    const price = cfg.price(style);
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
async function soulBoostView(member, now = Date.now(), deal = null) {
  const user = await getUser(member.id);
  const cfg = await shopConfig(member.guild.id);
  const price = deal?.price ?? cfg.price('boost');
  const sale = deal && onDeal(user, deal, 'a Soul Boost');
  const active = user.boostUntil > now;
  const png = await renderItemPage({
    item: 'soulBoost',
    tier: 2,
    price: String(price),
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
      { kind: 'souls', label: 'YOUR SOULS', value: fmt(user.souls), sub: `OF ${fmt(price)}`, ok: user.souls >= price },
      { kind: 'text', label: 'BOOST', value: active ? `${Math.ceil((user.boostUntil - now) / 60000)} MIN LEFT` : 'NOT ACTIVE' },
    ],
  });
  const line = "One hour, double everything. Don't waste it standin' around admirin' yourself.";
  return shopPage(member, user, cfg, {
    section: sale ? 'daily-deal' : 'soul-boost',
    file: 'soul-boost',
    text: sale?.text ?? (active ? `${line}\n\nYour boost runs out <t:${Math.floor(user.boostUntil / 1000)}:R>.` : line),
    png,
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${sale ? DEAL_ID : BOOST_ID}:${member.id}`)
        .setLabel(`${active ? 'Add an Hour' : 'Buy'} (${fmt(price)})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(user.souls < price || !!sale?.used),
    ],
  });
}

// Rejuv: saves a broken /urn streak (rules in xp.js claimUrn). Carry up to 3.
async function rejuvView(member, deal = null) {
  const user = await getUser(member.id);
  const cfg = await shopConfig(member.guild.id);
  const price = deal?.price ?? cfg.price('rejuv');
  const sale = deal && onDeal(user, deal, `a ${rejuvIcon()}Rejuv`);
  const full = user.rejuvs >= REJUV_MAX;
  const png = await renderItemPage({
    item: 'rejuv',
    tier: 3,
    price: String(price),
    title: 'REJUV',
    subtitle: 'A SECOND LIFE FOR YOUR STREAK',
    lines: [
      ['Saves a broken ', '/urn', ' streak'],
      'One Rejuv saves it, however many days you missed',
      '/urn asks first: Use Rejuv or Start Over',
      ['Carry up to ', String(REJUV_MAX), ' at a time'],
    ],
    cells: [
      { kind: 'souls', label: 'YOUR SOULS', value: fmt(user.souls), sub: `OF ${fmt(price)}`, ok: user.souls >= price },
      { kind: 'text', label: 'CARRYING', value: `${user.rejuvs} / ${REJUV_MAX}`, ok: !full },
    ],
  });
  const line = "Miss a day, lose the streak. Unless you got one of these in your pocket. Call it insurance, pal.";
  return shopPage(member, user, cfg, {
    section: sale ? 'daily-deal' : 'rejuv',
    file: 'rejuv',
    text: full ? `${sale?.text ?? line}\n\nYou're carrying the max. Use one before you buy another.` : sale?.text ?? line,
    png,
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${sale ? DEAL_ID : REJUV_ID}:${member.id}`)
        .setLabel(`Buy (${fmt(price)})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(full || user.souls < price || !!sale?.used),
    ],
  });
}

// Hideout: a private voice + text channel of your own (hideout.js). Level 20+, one per member, kept for good.
async function hideoutView(member) {
  const user = await getUser(member.id);
  const cfg = await shopConfig(member.guild.id);
  const price = cfg.price('hideout');
  const owned = await getHideout(member.id);
  const { level, into, need } = progress(user.xp);
  const png = await renderItemPage({
    item: 'hideout',
    tier: 4,
    price: String(price),
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
      { kind: 'level', label: 'LEVEL NEEDED', value: String(cfg.hideoutLevel), ok: level >= cfg.hideoutLevel },
      { kind: 'souls', label: 'YOUR SOULS', value: fmt(user.souls), sub: `OF ${fmt(price)}`, ok: user.souls >= price },
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
    buy.setCustomId(`${HIDEOUT_BUY_ID}:${member.id}`).setLabel(`Buy (${fmt(price)})`).setDisabled(level < cfg.hideoutLevel || user.souls < price);
  }
  return shopPage(member, user, cfg, {
    section: 'hideout',
    file: 'hideout',
    text: 'Every regular needs a place to lay low. Four walls, a lock, and nobody gets in unless you say so.',
    png,
    buttons,
  });
}

// Color Role: their own role, with a name and a hex colour they type into a pop-up (colorRole.js). Buying again recolors it.
async function colorRoleView(member) {
  const user = await getUser(member.id);
  const cfg = await shopConfig(member.guild.id);
  const role = await getColorRole(member.guild, member.id);
  const price = cfg.price(role ? 'recolor' : 'color');
  const png = await renderItemPage({
    item: 'colorRole',
    tier: 3,
    price: String(price),
    title: 'COLOR ROLE',
    subtitle: 'YOUR NAME IN YOUR COLOR',
    lines: [
      'A role of your own with the name you pick',
      'Any color you type in, as a hex code',
      ['Your name shows in ', 'your color', ' in chat'],
      ['Buy again to recolor it for ', fmt(cfg.price('recolor')), ' Souls'],
    ],
    cells: [
      { kind: 'souls', label: 'YOUR SOULS', value: fmt(user.souls), sub: `OF ${fmt(price)}`, ok: user.souls >= price },
      { kind: 'text', label: 'YOUR ROLE', value: role ? role.name.slice(0, 14) : 'NONE' },
    ],
    swatch: role ? role.hexColor : undefined,
  });
  return shopPage(member, user, cfg, {
    section: 'color-role',
    file: 'color-role',
    text: role
      ? `You've got **${role.name}**. Want a new look? Hit Recolor and tell me the name and the color.`
      : 'Pick a name and a color and I make you a role of your own. Hex code, like `#e39a3b`.',
    png,
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${COLOR_ID}:${member.id}`)
        .setLabel(role ? `Recolor (${fmt(price)})` : `Buy (${fmt(price)})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(user.souls < price),
    ],
  });
}

// Daily Deal (dailyDeal.js): what the Shopkeeper says about today's deal, and whether this member already took it.
// `what` is the thing as it reads in a sentence ("a Soul Boost").
function onDeal(user, deal, what) {
  const ends = `<t:${Math.floor(deal.endsAt / 1000)}:R>`;
  const used = user.dealDay === deal.day;
  return {
    used,
    text: used
      ? `You took today's deal. The next one is on the shelf ${ends}.`
      : `Today only, pal: ${what} for ${boldSouls(deal.price)}, down from ${boldSouls(deal.full)}. One per customer. It's gone ${ends}.`,
  };
}

// The Daily Deal's page: today's thing at its deal price. A Soul Boost or a Rejuv is its usual page with the deal's price and button;
// a Hero Card is the member's /rank card with that hero on it.
async function dealView(member, now = Date.now()) {
  const user = await getUser(member.id);
  const cfg = await shopConfig(member.guild.id);
  const deal = dealOf(cfg, member.guild.id, now);
  if (!deal) return shopView(member);
  if (deal.key === 'boost') return soulBoostView(member, now, deal);
  if (deal.key === 'rejuv') return rejuvView(member, deal);
  const hero = getHero(deal.slug);
  const { level, into, need } = progress(user.xp);
  const png = await renderRankCard({ name: member.displayName, level, into, need, souls: user.souls, maxLevel: MAX_LEVEL, hero: await heroArt(hero.slug, deal.key) });
  const card = `**${hero.name}** card (${STYLES[deal.key].label})`;
  const owned = user.cards.includes(`${hero.slug}:${deal.key}`);
  const sale = onDeal(user, deal, `the ${card}`);
  return shopPage(member, user, cfg, {
    section: 'daily-deal',
    file: `deal_${hero.slug}_${deal.key}`,
    text: owned && !sale.used ? `Today's deal is the ${card}, and you already own it. The next one is on the shelf <t:${Math.floor(deal.endsAt / 1000)}:R>.` : sale.text,
    png,
    buttons: [
      new ButtonBuilder()
        .setCustomId(`${DEAL_ID}:${member.id}`)
        .setLabel(owned ? 'Owned' : `Buy (${fmt(deal.price)})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(owned || sale.used || user.souls < deal.price),
    ],
  });
}

// Each section's page. A section staff turned off (a stale dropdown, an old message) shows the first screen instead.
const VIEWS = {
  'daily-deal': (member) => dealView(member),
  'hero-cards': (member) => heroCardsView(member),
  'soul-boost': (member) => soulBoostView(member),
  rejuv: (member) => rejuvView(member),
  hideout: (member) => hideoutView(member),
  'color-role': (member) => colorRoleView(member),
};
const SECTION_VIEWS = Object.fromEntries(
  Object.entries(VIEWS).map(([key, view]) => [key, async (member) => ((await shopConfig(member.guild.id)).on(key) ? view(member) : shopView(member))]),
);

// What the Shopkeeper tells the buyer (privately) once a purchase has been tried. `result` is what buyCard / buyBoost /
// buyRejuv gave ({ ok, user } or { ok: false, reason }) or what buyHideout gave (null, or 'level' | 'souls' | 'owned').
// `price` (and `level`) are this server's, from shopConfig.
const receipts = {
  card(result, slug, style, price) {
    const card = `**${getHero(slug)?.name ?? slug}** card (${STYLES[style].label})`;
    if (result.ok) return `You bought the ${card} for ${boldSouls(price)}. It's on your \`/rank\` now.`;
    return result.reason === 'owned' ? `You already own the ${card}.` : `The ${card} costs ${boldSouls(price)}, and you don't have that much.`;
  },
  boost(result, price) {
    if (result.ok) return `Soul Boost bought for ${boldSouls(price)}. It runs out <t:${Math.floor(result.user.boostUntil / 1000)}:R>.`;
    return `A Soul Boost costs ${boldSouls(price)}, and you don't have that much.`;
  },
  rejuv(result, price) {
    if (result.ok) return `${rejuvIcon()}Rejuv bought for ${boldSouls(price)}. You're carrying ${result.user.rejuvs} / ${REJUV_MAX}.`;
    return result.reason === 'full'
      ? `You're already carrying the max (${REJUV_MAX} ${rejuvIcon()}Rejuvs). Use one first.`
      : `A ${rejuvIcon()}Rejuv costs ${boldSouls(price)}, and you don't have that much.`;
  },
  hideout(result, record, price, level) {
    if (!result) return `Your Hideout is ready${record?.textId ? `: <#${record.textId}>. The control panel is pinned there` : ''}.`;
    return {
      level: `A Hideout needs level ${level}.`,
      souls: `A Hideout costs ${boldSouls(price)}, and you don't have that much.`,
      owned: 'You already have a Hideout.',
      away: "Hideouts aren't available in this server.",
    }[result];
  },
  // Today's Daily Deal: `deal` from dailyDeal.js (null = nothing on the shelf today)
  deal(result, deal) {
    if (!deal) return "There's no deal on the shelf today.";
    if (result.reason === 'used') return "You already took today's deal. One per customer.";
    if (deal.slug) return receipts.card(result, deal.slug, deal.key, deal.price);
    return deal.key === 'boost' ? receipts.boost(result, deal.price) : receipts.rejuv(result, deal.price);
  },
  color(result, price) {
    if (result.ok) return `${result.recolor ? 'Recolored' : 'Bought'} ${result.role} for ${boldSouls(price)}.`;
    return {
      color: 'That color needs to be a hex code, like `#e39a3b`.',
      name: 'Your role needs a name.',
      censored: "I can't put that name on a role.",
      souls: `That costs ${boldSouls(price)}, and you don't have that much.`,
      perms: "I can't make or change roles here. Tell staff to give me Manage Roles, with my role above yours.",
      full: "This server has no room for another role.",
    }[result.reason];
  },
};
// When a purchase throws. A Hideout that failed part-way has already been refunded.
const FAILED = {
  card: 'Something went wrong with that purchase. Check your balance with `/souls balance`.',
  hideout: "Something went wrong making your Hideout, and any Souls taken were returned. Tell staff if it keeps happening.",
  color: 'Something went wrong with your role, and any Souls taken were returned. Tell staff if it keeps happening.',
};

module.exports = {
  receipts, FAILED,
  shopView, heroCardsView, SECTION_VIEWS, SECTIONS, STYLES, SECTION_ID, SELECT_ID, STYLE_ID, BUY_ID, EQUIP_ID, BOOST_ID, REJUV_ID, HIDEOUT_BUY_ID, COLOR_ID, DEAL_ID, MENUS, dealView,
};
