// Hero Farming: every farm message, drawn like the previews he approved one at a time (server-plan.md, "Hero Farming"). Each view
// returns { embeds, components, files }. Heroes have no pronouns in the text, on purpose. Souls-coloured embeds are the menus and live
// fights, green is a win, red a loss.
const path = require('node:path');
const fs = require('node:fs');
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ASSETS } = require('../art');
const { HEROES: HERO_DATA, ABILITIES, itemByName, innateStats, drawbackText, effectValue } = require('./stats');
const { IMBUES } = require('./items');
const { roster, heroInfo, buildHero } = require('./hero');
const { TARGETS, SIEGE, WAVES, wavePay, wavesPay, LANES, LANED, WALKER_STEP, payout, CLEAR_CAP, clearsOf, clearPower, clearSouls } = require('./targets');
const { COOLDOWN: ROAM_COOLDOWN } = require('./roam');
const { roamCard, BRIDGE_COLOR, GOLD } = require('./roamCard');
const { itemFile } = require('./itemArt');
const { heroCard } = require('./heroCard');
const { shopTab, listPage, brokerPage, BROKER, CORRUPTED, TIER_PRICE } = require('./shopCard');
const { progress, pointsSpent, campMultiplier, TIER_COSTS, MAX_TIER, SLOTS, MAX_ITEMS, countItems, priceFor, heldIn, waitingLegendary, POOL, itemsOf, sellPrice,
  brokerOpen, brokerNext, brokerCloses, corruptible, corruptPrice } = require('./levels');
const { homeCard } = require('./homeCard');
const { siegeCard } = require('./siegeCard');
const { BUFFS, BRIDGE, buffText, dailyBuffs } = require('./buffs');
const { MAX_REJUVS, cooldownSeconds, cooldownLeft, hauntFile, campFamilies, CAMP_SIZE, fightKit, hasHero, switchLeft, PER_LANE, slotOf, isDown, walkersDown, lockedBy, EGG, cooldownsActive: cooldownsOnNow } = require('./play');
const { PAYOUT_SCALE } = require('./targets');
const { SPECIALS } = require('./haunts');
const { HEROES, heroEmoji, heroArt } = require('../heroes');
const { fmt, soulsIcon } = require('../format');
const { pickRandom } = require('../random');
const { streakBar } = require('../trivia'); // the same bar as /trivia and /urn

const DUEL_ID = 'farm_duel'; // button: farm_duel:<user id> (fight the rival that showed up)
const WALK_ID = 'farm_walk'; // button: farm_walk:<user id> (let it go)
const HERO_ID = 'farm_hero'; // select: farm_hero:<user id> (the second dropdown of a split list: farm_hero:<user id>:1)
const PICK_ID = 'farm_pick'; // button "Select": farm_pick:<user id>:<hero>
const TARGET_ID = 'farm_target'; // select: farm_target:<user id>
const SEND_ID = 'farm_send'; // button "Send": farm_send:<user id>:<target>
const BACK_ID = 'farm_back'; // button "Back": farm_back:<user id>
const HEROCARD_ID = 'farm_herocard'; // button "Hero": farm_herocard:<user id>
const UPGRADE_ID = 'farm_upgrade'; // select: farm_upgrade:<user id>, value = ability slot
const ITEM_ID = 'farm_item'; // select (item shop): farm_item:<user id>:<weapon | vitality | spirit>:<tier>, value = item name
const BUY_ID = 'farm_buy'; // button "Buy (price)" (item shop): farm_buy:<user id>:<weapon | vitality | spirit>:<tier>:<item name>
const SHOPMODE_ID = 'farm_shopmode'; // button: farm_shopmode:<user id>:<on (the item shop) | off (the hero screen)>
const SELL_ID = 'farm_sell'; // select: farm_sell:<user id>, value = item name
const SWITCH_ID = 'farm_switch'; // button "Switch Hero" (home): farm_switch:<user id>
const SWITCHTO_ID = 'farm_switchto'; // button "Switch": farm_switchto:<user id>:<hero>
const UNLOCK_ID = 'farm_unlock'; // button "Unlock": farm_unlock:<user id>:<hero>
const IMBUE_ID = 'farm_imbue'; // select (hero screen): farm_imbue:<user id>, value = an owned imbue item -> its ability pick
const IMBUESET_ID = 'farm_imbueset'; // select: farm_imbueset:<user id>:<item>, value = ability slot
const SHOPTAB_ID = 'farm_shoptab'; // button (item shop): farm_shoptab:<user id>:<weapon | vitality | spirit | broker | sell>[:<tier 1-4>]
const CORRUPT_ID = 'farm_corrupt'; // select (Broker screen): farm_corrupt:<user id>, value = item name
const HATCH_ID = 'farm_hatch'; // button "Hatch Egg": farm_hatch:<user id>

const COLOR = 0xabffe3; // the souls glyph's colour
const WIN = 0x57f287; // Discord green, like /trivia's right answer
const LOSS = 0xed4245; // Discord red
const ICONS = path.join(ASSETS, 'farm', 'icons');

const LABELS = {
  'small-camp': 'Tier 1 Camp', 'medium-camp': 'Tier 2 Camp', 'large-camp': 'Tier 3 Camp', guardian: 'Guardian', walker: 'Walker',
  'mid-boss': 'Mid-Boss', siege: 'Base Siege', waves: 'Waves',
};
const HOME_ORDER = ['small-camp', 'medium-camp', 'large-camp', 'guardian', 'walker', 'mid-boss', 'roam', 'siege'];
// ponytail: the descriptions are mine, short and plain; reword them in one place here.
const TEXT = {
  'small-camp': 'Three small Haunts guard this camp.',
  'medium-camp': 'Five Haunts guard this camp: two medium and three small.',
  'large-camp': 'Three large Haunts guard this camp.',
  guardian: 'A lane Guardian, the first line of defense.',
  walker: 'A giant Walker, the second line of defense.',
  'mid-boss': 'A huge boss with a shield that keeps coming back.\nDefeating it drops a Rejuv to keep.',
};
const CAMP_ENEMIES = { 'small-camp': '3 small Haunts', 'medium-camp': '2 medium + 3 small Haunts', 'large-camp': '3 large Haunts' };

// ---- small helpers ----
const embed = (color = COLOR) => new EmbedBuilder().setColor(color).setAuthor({ name: 'Hero Farming', iconURL: 'attachment://souls.png' });
const soulsFile = () => new AttachmentBuilder(path.join(ASSETS, 'card', 'souls.png'), { name: 'souls.png' });
const picture = (file) => new AttachmentBuilder(file, { name: 'thumb.png' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const span = (secs) => (secs >= 3600 ? plural(Math.round(secs / 3600), 'hour') : plural(Math.round(secs / 60), 'minute'));
const every = (secs) => (secs === 3600 ? 'every hour' : secs === 86400 ? 'once a day' : `every ${span(secs)}`);
const timeLeft = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
// Where a target stands for this member: 'Ready', 'Ready in 2h 5m', 'Down, back in 9h 0m' (a beaten Guardian or Walker) or 'Locked' (lockedBy).
const status = (record, key, now, lane) => {
  const l = cooldownLeft(record, slotOf(key, lane), now);
  if (l > 0) return LANED.has(key) && isDown(record, key, lane, now) ? `Down, back in ${timeLeft(l)}` : `Ready in ${timeLeft(l)}`;
  return lockedBy(record, key, lane, now) ? 'Locked' : 'Ready';
};
// "York Guardian", "Tier 1 Camp": a target's name, with its lane when it has one.
const nameOf = (key, lane) => (PER_LANE.has(key) && LANES[lane] ? `${LANES[lane].name} ${LABELS[key]}` : LABELS[key]);
// Every place a hero can be sent, in the home order: [key, lane | undefined] (a Guardian and a Walker per lane).
// (a wave run per lane comes after the Walkers; it has no tile on the home card)
const places = () => HOME_ORDER.filter((k) => k !== 'roam').flatMap((key) => (LANED.has(key) ? Object.keys(LANES).map((lane) => [key, lane]) : [[key]]))
  .flatMap((place) => (place[0] === 'walker' && place[1] === Object.keys(LANES).at(-1) ? [place, ...Object.keys(LANES).map((lane) => ['waves', lane])] : [place]));
const souls = (n) => `${soulsIcon()}${fmt(n)}`;
const bar = (hp, max) => streakBar(Math.max(hp > 0 ? 1 : 0, Math.round((hp / max) * 10)), 10);
const barLine = (hp, max) => `${bar(hp, max)} ${fmt(Math.round(hp))} / ${fmt(Math.round(max))}`;
const slugOf = (name) => HEROES.find((h) => h.name === name).slug;
const heroText = (guild, name) => { const e = heroEmoji(guild, slugOf(name)); return e ? `<:${e.name}:${e.id}> ` : ''; };
// Title Case for a line of text (his call, Oct 3, for the target screens): every word capitalised but the little ones (and not the
// unit after a number: "1h 5m", "4s").
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'at', 'for', 'on', 'by', 'per', 'vs']);
const titleCase = (text) => text.replace(/(?<![\dA-Za-z'])[A-Za-z][A-Za-z']*/g, (word, at) => (at > 0 && SMALL_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1)));
const row = (...components) => new ActionRowBuilder().addComponents(...components);

// The hero's icon (his call, Oct 3: the icon, not the full-body art), kept as a PNG per hero.
const thumbs = new Map();
async function heroPicture(name) {
  const slug = slugOf(name);
  if (!thumbs.has(slug)) {
    const { image } = await heroArt(slug, 'icon');
    const c = createCanvas(Math.round((image.width * 220) / image.height), 220);
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    thumbs.set(slug, c.toBuffer('image/png'));
  }
  return picture(thumbs.get(slug));
}

const statLines = (name) => {
  const h = HERO_DATA[name];
  const w = h.Weapon;
  return [
    ['Health', fmt(h.MaxHealth)], ['Health Regen', `${h.BaseHealthRegen} per second`], ['Move Speed', `${h.MaxMoveSpeed} m/s`],
    ['Weapon DPS', `${Math.round(w.DPS)}`], ['Bullet Damage', `${w.BulletDamage}`], ['Fire Rate', `${w.RoundsPerSecond.toFixed(1)} per second`],
    ['Clip', `${w.ClipSize}`], ['Reload', `${w.ReloadSingle ? +(w.ReloadDelay + w.ReloadTime * w.ClipSize).toFixed(1) : w.ReloadTime} s`], ['Falloff Range', `${Math.round(w.FalloffStartRange)}m to ${w.FalloffEndRange}m`],
  ];
};

// ---- hero pick ----
// No `selected`: the list of heroes. With one: that hero's stats and abilities and a Select button (nothing is saved until then).
// A member who already has a hero (`record`) gets the same screen for switching: each hero shows its level or its unlock price, and the
// button is Switch (once a day) or Unlock (a Character Unlock Token).
async function pickView(member, selected = null, record = null, now = Date.now()) {
  const guild = member.guild;
  const names = roster();
  const switching = !!record?.hero;
  const levelOf = (n) => progress(n === record.hero ? record.earned : record.heroes?.[n]?.earned).level;
  const wait = switching ? switchLeft(record, now) : 0;
  const tokens = record?.tokens ?? 0;
  const back = new ButtonBuilder().setCustomId(`${BACK_ID}:${member.id}`).setLabel('Back').setStyle(ButtonStyle.Secondary);
  // a dropdown holds 25 options: a bigger roster is split A to Z over two of them
  const sorted = [...names].sort((x, y) => x.replace(/^The /, '').localeCompare(y.replace(/^The /, '')));
  const halves = names.length <= 25 ? [names] : [sorted.slice(0, Math.ceil(sorted.length / 2)), sorted.slice(Math.ceil(sorted.length / 2))];
  const menus = halves.map((part, i) => new StringSelectMenuBuilder().setCustomId(`${HERO_ID}:${member.id}${i ? `:${i}` : ''}`)
    .setPlaceholder(halves.length > 1 ? `${part[0]} to ${part.at(-1)}` : switching ? 'Choose a hero' : 'Choose your hero')
    .addOptions(part.map((n) => ({ label: n, value: n, emoji: heroEmoji(guild, slugOf(n)), default: n === selected }))));
  const e = embed();
  const files = [soulsFile()];
  const components = menus.map((m) => row(m));
  if (switching && !selected) {
    e.setTitle('Switch Hero').setDescription(
      'Each hero keeps its own level, abilities and items.\nBuffs, cooldowns and Rejuvs stay with you.\n\n' +
      names.map((n) => `${heroText(guild, n)}**${n}**  -  ${hasHero(record, n) ? `Level ${levelOf(n)}${n === record.hero ? '  -  Current Hero' : ''}` : 'Locked'}`).join('\n'),
    ).setFooter({ text: `${wait > 0 ? `You can switch again in ${timeLeft(wait)}.` : 'You can switch once a day.'}  ${tokenText(tokens)}` });
    components.push(row(back));
  } else if (!selected) {
    e.setTitle('Pick Your Hero').setDescription(
      'Pick the hero who farms for you. You gear them up and send them out,\nand they stay yours, so choose the one you want to run with.\n\n' +
      names.map((n) => `${heroText(guild, n)}**${n}**  -  ${fmt(HERO_DATA[n].MaxHealth)} HP  -  ${Math.round(HERO_DATA[n].Weapon.DPS)} DPS`).join('\n'),
    ).setFooter({ text: 'Your first hero is free. More can be unlocked later.' });
  } else {
    const info = heroInfo(selected);
    const owned = switching && hasHero(record, selected);
    const current = switching && selected === record.hero;
    e.setTitle(owned ? `${selected}  -  Level ${levelOf(selected)}` : selected)
      .setDescription(current ? `__${selected} is your current Hero.__` : owned ? `__Switch to ${selected}?__` : switching ? `__Unlock ${selected} with a Character Unlock Token?__` : `__Select ${selected} as your Hero?__`)
      .addFields(
        ...statLines(selected).map(([name, value]) => ({ name, value, inline: true })),
        { name: 'Abilities', value: info.map(([name, text], i) => `**${name}${i === 3 ? ' (Ultimate)' : ''}**\n${text}`).join('\n\n') },
      )
      .setThumbnail('attachment://thumb.png')
      .setFooter({ text: current ? 'Pick another hero to switch or unlock.'
        : owned ? (wait > 0 ? `You can switch again in ${timeLeft(wait)}.` : 'You can switch once a day. Your heroes keep their own level, abilities and items.')
        : switching ? `Unlocking does not switch. ${selected} starts at level 0 with no items. ${tokenText(tokens)}`
        : `Select to make ${selected} your hero. Your first hero is free.` });
    files.push(await heroPicture(selected));
    const button = (id, label, disabled = false) => new ButtonBuilder().setCustomId(`${id}:${member.id}:${selected}`).setLabel(label).setStyle(ButtonStyle.Success).setDisabled(disabled);
    if (!switching) components.push(row(button(PICK_ID, 'Select')));
    else if (current) components.push(row(back));
    else if (owned) components.push(row(button(SWITCHTO_ID, 'Switch', wait > 0), back));
    else components.push(row(button(UNLOCK_ID, 'Unlock (1 Token)', tokens < 1), back));
  }
  return { embeds: [e], components, files };
}

// ---- home ----
const targetMenu = (userId, record, now, current) =>
  new StringSelectMenuBuilder().setCustomId(`${TARGET_ID}:${userId}`).setPlaceholder(`Choose where to send ${record.hero}`).addOptions(
    [...places().map(([key, lane]) => ({
      label: nameOf(key, lane), value: slotOf(key, lane), description: `${status(record, key, now, lane)}  -  ${every(cooldownSeconds(key))}`.slice(0, 100), default: slotOf(key, lane) === current,
    })), { label: 'Item Shop', value: 'shop', description: 'Buy, sell and corrupt items' }], // his call, Oct 3: the shop opens from this dropdown
  );

// What a trip pays this member: camps pay more as their hero levels, every target as it has grown with their clears.
const payAmount = (key, record) => {
  const grown = clearSouls(record?.clears?.[key]);
  if (key === 'siege') return Math.round(payout(SIEGE.stages.reduce((s, st) => s + st.souls, 0)) * grown);
  const base = payout(TARGETS[key].souls) * grown;
  return Math.round(key.endsWith('-camp') ? base * campMultiplier(progress(record?.earned).level) : base);
};
// "Grown Stronger  -  45%  (3 / 10 clears)": how much tougher this member's clears have made the target.
const grownField = (key, record) => ({ name: 'Grown Stronger', value: `${Math.round((clearPower(record.clears?.[key], key) - 1) * 100)}%  (${clearsOf(record.clears?.[key])} / ${CLEAR_CAP} clears)` });
const payText = (key, record) => {
  if (key === 'roam') return 'Crates, buffs and more';
  return souls(payAmount(key, record)) + (TARGETS[key]?.rejuv ? ' + 1 Rejuv' : '');
};

// The stats the hero fights with right now: base, its boons (level), items, permanent buffs and what its own abilities add
// (Abrams' Infernal Resilience: health and regen), so it is the very sheet a fight uses.
const currentStats = (record) => buildHero(record.hero, fightKit({ ...record, items: itemsOf(record.items) })).stats;

// One drawn card (homeCard.js) with every target; the dropdown below it still lists them with their cooldowns.
async function homeView(member, record, now = Date.now()) {
  const hero = record.hero;
  const day = new Date(now).toISOString().slice(0, 10);
  const tiles = HOME_ORDER.map((key) => {
    const left = cooldownLeft(record, key, now);
    const tile = { key, left, timeLeft: timeLeft(left) };
    if (LANED.has(key)) { // one tile for the three lanes: a pip per lane (lit = it can be fought now), and how many can
      const lanes = Object.keys(LANES).map((lane) => ({ lane, left: cooldownLeft(record, slotOf(key, lane), now), locked: !!lockedBy(record, key, lane, now) }));
      const open = lanes.filter((l) => l.left <= 0 && !l.locked);
      tile.pips = lanes.map((l) => ({ lane: l.lane, on: l.left <= 0 && !l.locked }));
      tile.ready = open.length > 0;
      // none can be fought: "Locked" while a lane only waits on its Guardian, else the time until the first one is back
      tile.text = open.length ? `${open.length} Ready` : lanes.some((l) => l.left <= 0) ? 'Locked' : timeLeft(Math.min(...lanes.map((l) => l.left)));
    }
    if (key === 'siege' && left <= 0 && lockedBy(record, 'siege', undefined, now)) { tile.ready = false; tile.text = 'Locked'; } // (its screen says how many Walkers are down)
    if (key === 'roam') tile.extra = 'Crates and Buffs';
    else tile.pay = payAmount(key, record);
    if (TARGETS[key]?.rejuv) tile.rejuv = true;
    return tile;
  });
  const card = await homeCard({ tiles, heldBridge: record.bridge ?? [], now, day });
  // no text but the hero's current stats (base plus the permanent buffs it has found)
  const st = currentStats(record);
  const e = embed().setTitle(`${hero}  -  Level ${progress(record.earned).level}`).setImage('attachment://home.png').setThumbnail('attachment://thumb.png')
    .addFields(
      { name: 'Health', value: fmt(Math.round(st.maxHealth)), inline: true },
      { name: 'Bullet Damage', value: `${+(st.bulletDamage * st.weaponDamageMult).toFixed(1)}`, inline: true },
      { name: 'Fire Rate', value: `${+st.fireRate.toFixed(2)}/s`, inline: true },
      { name: 'Ammo', value: `${st.clip}`, inline: true },
      { name: 'Spirit Power', value: `${+st.spirit.toFixed(1)}`, inline: true },
      { name: 'Cooldown Reduction', value: `${+(st.cdr * 100).toFixed(1)}%`, inline: true },
      { name: 'Rejuvs', value: `${record.rejuvs} / ${MAX_REJUVS}`, inline: true },
    );
  const heroButton = new ButtonBuilder().setCustomId(`${HEROCARD_ID}:${member.id}`).setLabel('Hero').setStyle(ButtonStyle.Secondary);
  const buttons = [heroButton];
  if (roster().length > 1) buttons.push(new ButtonBuilder().setCustomId(`${SWITCH_ID}:${member.id}`).setLabel('Switch Hero').setStyle(ButtonStyle.Secondary));
  return { embeds: [e], components: [row(targetMenu(member.id, record, now)), row(...buttons)], files: [soulsFile(), await heroPicture(hero), new AttachmentBuilder(card, { name: 'home.png' })] };
}

// ---- the hero screen: level, abilities, stats and items ----
// The wiki's stat names on an item -> how to write one ("+210 Health").
const ITEM_STAT_TEXT = {
  BonusHealth: ['Health', ''], BonusHealthRegen: ['Health Regen', ''], BaseAttackDamagePercent: ['Weapon Damage', '%'], BonusFireRate: ['Fire Rate', '%'],
  BonusClipSizePercent: ['Ammo', '%'], BulletResist: ['Bullet Resist', '%'], TechResist: ['Spirit Resist', '%'], TechPower: ['Spirit Power', ''],
  SpiritPower: ['Spirit Power', ''], BulletLifestealPercent: ['Lifesteal', '%'], CooldownReduction: ['Cooldown Reduction', '%'], BonusAbilityDurationPercent: ['Ability Duration', '%'],
  OutOfCombatHealthRegen: ['Regen Out of Combat', ''], AbilityLifestealPercentHero: ['Spirit Lifesteal', '%'], AbilityLifestealPercentHeroPassive: ['Spirit Lifesteal', '%'],
  TechPowerPercent: ['Spirit Power', '%'], MaxHealthLossPercent: ['Max Health', '%'], NonPlayerBonusWeaponPower: ['Weapon Damage vs Camps', '%'], NonPlayerBulletResist: ['Bullet Resist vs Camps', '%'],
  BonusMoveSpeed: ['Move Speed', ' m/s'], BonusSprintSpeed: ['Sprint Speed', ' m/s'], TechRangeMultiplier: ['Ability Range', '%'], StatusResistancePercent: ['Debuff Resist', '%'], Stamina: ['Stamina', ''],
  BonusMeleeDamagePercent: ['Melee Damage', '%'], BonusAbilityCharges: ['Ability Charges', ''], ItemCooldownReduction: ['Item Cooldown Reduction', '%'], HealAmpCastPercent: ['Healing', '%'],
};
const itemStats = (card) => innateStats(card).filter(([k]) => ITEM_STAT_TEXT[k]).map(([k, v]) => `${v >= 0 ? '+' : ''}${+v.toFixed(2)}${ITEM_STAT_TEXT[k][1]} ${ITEM_STAT_TEXT[k][0]}`).join(', ');

// What a hatched egg would give now: { souls, buffs } (play.js hatchEgg).
const eggWorth = (record) => ({
  souls: Math.round((effectValue(EGG, 'StartingGold') + (record.egg ?? 0)) * PAYOUT_SCALE),
  buffs: Math.floor((record.egg ?? 0) / effectValue(EGG, 'BonusBuffsPerGold')),
});
// "The Broker Is Open For 21 More Minutes" / "The Broker Opens In 2h 10m" (30 minutes every 3 hours, UTC).
const brokerLine = (now) => (brokerOpen(now) ? `The Broker is open for ${timeLeft(brokerCloses(now) - now)} more.` : `The Broker opens in ${timeLeft(brokerNext(now) - now)}.`);

// mode: 'main' | 'imbue:<item>' (pick its ability). Buying, selling and the Broker are in the item shop (shopView).
async function heroView(member, record, balance = 0, mode = 'main', now = Date.now()) {
  const hero = record.hero;
  const p = progress(record.earned);
  const left = p.points - pointsSpent(record.tiers);
  const owned = itemsOf(record.items);
  const slots = Object.entries(HERO_DATA[hero].BoundAbilities).map(([slot, { Key }]) => ({
    slot: Number(slot), name: ABILITIES[Key].Name, tier: record.tiers?.[slot] ?? 0, locked: Number(slot) > p.unlocks,
  }));
  const st = currentStats(record);
  const pct = (x) => `${+(x * 100).toFixed(1)}%`;
  const stats = {
    Health: fmt(Math.round(st.maxHealth)), 'Bullet Damage': `${+(st.bulletDamage * st.weaponDamageMult).toFixed(1)}`, 'Fire Rate': `${+st.fireRate.toFixed(2)}/s`,
    Ammo: `${st.clip}`, 'Spirit Power': `${+st.spirit.toFixed(1)}`, Lifesteal: pct(st.lifesteal),
    // the game's names for them on the HUD (his list, Oct 3)
    'Ability Cooldown': st.cdr ? `-${pct(st.cdr)}` : '0%', 'Ability Duration': `+${pct(st.durationMult - 1)}`,
    'Ability Range': `+${pct(st.rangeMult - 1)}`, 'Movement Speed': `${+st.moveSpeed.toFixed(1)} m/s`,
    'Health Regen': `${+st.healthRegen.toFixed(1)}/s`, 'Bullet Armor': pct(st.bulletResist), 'Spirit Armor': pct(st.spiritResist),
  };
  const card = await heroCard({ hero, progress: p, pointsLeft: Math.max(0, left), abilities: slots, stats, items: owned, souls: balance, corrupted: record.corrupted?.name });
  const e = embed().setTitle(`${hero}  -  Level ${p.level}`).setImage('attachment://hero.png').setThumbnail('attachment://thumb.png');
  const held = SLOTS.flatMap((slot) => owned[slot]);
  const notes = [];
  const itemFields = []; // what the hero's items are doing, one field each (his call, Oct 3)
  const waiting = waitingLegendary(record);
  if (waiting) itemFields.push({ name: 'Legendary Waiting', value: `${waiting}\nSell an item to make room.` });
  if (record.corrupted) itemFields.push({ name: 'Corrupted', value: `${record.corrupted.name}\n${drawbackText(record.corrupted)}` });
  const imbued = held.filter((n) => IMBUES.includes(n));
  const abilityName = (slot) => slots.find((a) => a.slot === slot)?.name ?? `Ability ${slot}`;
  if (imbued.length) itemFields.push({ name: 'Imbued', value: imbued.map((n) => `${n}\ninto ${abilityName(record.imbues?.[n] ?? 1)}`).join('\n') });
  if (held.includes(EGG.Name)) { const w = eggWorth(record); itemFields.push({ name: 'Golden Goose Egg', value: `Hatches for ${fmt(w.souls)} souls\nand ${plural(w.buffs, 'permanent buff')}` }); }
  const components = [];
  const button = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
  const [where, kind] = mode.split(':');
  if (where === 'imbue' && held.includes(kind)) { // which ability the item goes into (his call, Oct 3: the member picks; free to change)
    notes.push(titleCase(`Choose the ability to imbue ${kind} into.`));
    components.push(row(new StringSelectMenuBuilder().setCustomId(`${IMBUESET_ID}:${member.id}:${kind}`).setPlaceholder(titleCase(`Imbue ${kind} into`))
      .addOptions(slots.map((a) => ({ label: a.name, value: String(a.slot), default: (record.imbues?.[kind] ?? 1) === a.slot, description: a.slot === 4 ? 'Ultimate' : `Ability ${a.slot}` })))));
    components.push(row(button(`${SHOPMODE_ID}:${member.id}:off`, 'Done')));
  } else {
    const upgradable = slots.filter((a) => !a.locked && a.tier < MAX_TIER);
    if (upgradable.length) {
      components.push(row(new StringSelectMenuBuilder().setCustomId(`${UPGRADE_ID}:${member.id}`).setPlaceholder(`Spend an ability point (${Math.max(0, left)} left)`)
        .addOptions(upgradable.map((a) => ({ label: `${a.name}  -  Tier ${a.tier + 1}`, value: String(a.slot), description: `Costs ${plural(TIER_COSTS[a.tier], 'ability point')}` })))));
    }
    if (imbued.length) {
      components.push(row(new StringSelectMenuBuilder().setCustomId(`${IMBUE_ID}:${member.id}`).setPlaceholder('Change what an item is imbued into')
        .addOptions(imbued.map((n) => ({ label: n, value: n, description: titleCase(`Imbued into ${abilityName(record.imbues?.[n] ?? 1)}`) })))));
    }
    const buttons = [button(`${BACK_ID}:${member.id}`, 'Back'), button(`${SHOPMODE_ID}:${member.id}:on`, 'Item Shop')];
    if (held.includes(EGG.Name)) buttons.push(button(`${HATCH_ID}:${member.id}`, 'Hatch Egg'));
    components.push(row(...buttons));
  }
  if (notes.length) e.setDescription(notes.join('\n'));
  if (itemFields.length) e.addFields(itemFields.map((f) => ({ ...f, inline: true })));
  return { embeds: [e], components, files: [soulsFile(), await heroPicture(hero), new AttachmentBuilder(card, { name: 'hero.png' })] };
}

// ---- the item shop (his calls, Oct 3): drawn like the in-game shop, one tab at a time (shopCard.js) ----
// Tabs: Weapon / Vitality / Spirit, each with price buttons 800 / 1,600 / 3,200 / 6,400 (his call, Oct 3: one tier at a time, big enough to read; no tier
// has more than 25 items, so one buy dropdown), Broker (corrupt one tier 3 or 4 item, while he is open), Sell (half the price back). Back goes to /base,
// Hero to the hero screen.
const SHOP_TABS = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit', broker: 'Broker', sell: 'Sell' };
const buyText = (name, owned) => {
  const c = itemByName(name);
  const { price, used } = priceFor(c, owned);
  const holder = heldIn(name, owned);
  const kind = SLOTS.find((slot) => POOL[slot].includes(name));
  return titleCase(`${owned[kind].includes(name) ? 'Owned  -  ' : holder ? `In ${holder}  -  ` : used.length ? `Upgrade from ${used.join(' + ')}  -  ` : ''}${fmt(price)} souls  -  ${itemStats(c) || 'effect only'}`).slice(0, 100);
};
// `picked` is the item chosen in the dropdown: its card is framed, its page (description, stats, price, souls left) is in the embed, and Buy confirms.
async function shopView(member, record, balance = 0, tab = 'weapon', now = Date.now(), tier = 1, picked = null) {
  if (!SHOP_TABS[tab]) tab = 'weapon';
  tier = [1, 2, 3, 4].includes(Number(tier)) ? Number(tier) : 1;
  const owned = itemsOf(record.items);
  const held = SLOTS.flatMap((slot) => owned[slot]);
  const e = embed().setTitle(`Item Shop  -  ${SHOP_TABS[tab]}${SLOTS.includes(tab) ? `  -  ${fmt(TIER_PRICE[tier])}` : ''}`).setImage('attachment://shop.png').setThumbnail('attachment://thumb.png')
    .addFields({ name: 'Souls', value: fmt(balance), inline: true }, { name: 'Items', value: `${countItems(owned)} / ${MAX_ITEMS}`, inline: true });
  const components = [row(...Object.entries(SHOP_TABS).map(([key, label]) => new ButtonBuilder().setCustomId(`${SHOPTAB_ID}:${member.id}:${key}`).setLabel(label)
    .setStyle(key === tab ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(key === tab)))];
  let pic;
  let buy = null;
  if (SLOTS.includes(tab)) {
    if (!POOL[tab].includes(picked) || itemByName(picked).Tier !== tier) picked = null;
    const state = (name) => {
      const mine = held.includes(name);
      const holder = !mine && heldIn(name, owned);
      const { price, used } = priceFor(itemByName(name), owned);
      return { owned: mine, corrupted: record.corrupted?.name === name, inside: !!holder, upgrade: !mine && !holder && used.length > 0, poor: !mine && !holder && price > balance, picked: name === picked };
    };
    pic = await shopTab({ kind: tab, tier, names: POOL[tab], state });
    components.push(row(...[1, 2, 3, 4].map((t) => new ButtonBuilder().setCustomId(`${SHOPTAB_ID}:${member.id}:${tab}:${t}`).setLabel(fmt(TIER_PRICE[t]))
      .setStyle(t === tier ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(t === tier))));
    const names = POOL[tab].filter((n) => itemByName(n).Tier === tier);
    components.push(row(new StringSelectMenuBuilder().setCustomId(`${ITEM_ID}:${member.id}:${tab}:${tier}`).setPlaceholder(titleCase(`Buy a ${fmt(TIER_PRICE[tier])} souls item`))
      .addOptions(names.map((name) => ({ label: name, value: name, default: name === picked, description: buyText(name, owned) })))));
    if (picked) {
      const c = itemByName(picked);
      const { price, used } = priceFor(c, owned);
      const holder = heldIn(picked, owned);
      const mine = held.includes(picked);
      const full = countItems(owned) - used.length >= MAX_ITEMS;
      const why = mine ? 'You already own this.' : holder ? `Already part of ${holder}.` : record.corrupted && used.includes(record.corrupted.name) ? `That would use up your corrupted ${record.corrupted.name}.`
        : full ? `Your build is full (${MAX_ITEMS} items). Sell one first.` : price > balance ? `You need ${fmt(price - balance)} more souls.` : null;
      const lines = [`**${picked}**  -  ${c.Activation === 'Passive' ? 'Passive' : 'Active'}`, (c.Description ?? '').replace(/<[^>]+>/g, '').slice(0, 400)].filter(Boolean);
      if (itemStats(c)) lines.push(`${itemStats(c)}`);
      if (used.length) lines.push(titleCase(`Upgrades ${used.join(' + ')} for ${fmt(price)} souls (${fmt(TIER_PRICE[tier] - price)} off).`));
      lines.push(why ? `*${why}*` : titleCase(`Costs ${fmt(price)} souls. You will have ${fmt(balance - price)} left.`));
      e.setDescription(lines.join('\n'));
      buy = new ButtonBuilder().setCustomId(`${BUY_ID}:${member.id}:${tab}:${tier}:${picked}`).setLabel(`Buy (${fmt(price)})`).setStyle(ButtonStyle.Success).setDisabled(!!why);
    }
  } else if (tab === 'broker') { // corrupt one owned tier 3 or 4 item (one per hero), only while he is open
    const open = brokerOpen(now) || !cooldownsOnNow();
    const choices = held.filter((n) => corruptible(itemByName(n)) && n !== record.legendary);
    const lines = [titleCase(brokerLine(now)), titleCase("Corrupting makes an item stronger, with one random drawback. It costs the item's price again, and a hero can have one.")];
    if (record.corrupted) lines.push(titleCase(`${record.hero} already has a corrupted item. Sell it to corrupt another.`));
    e.setDescription(lines.join('\n'));
    const can = open && !record.corrupted; // lit and corruptible; otherwise greyed
    pic = await brokerPage({
      open, timer: timeLeft(brokerOpen(now) ? brokerCloses(now) - now : brokerNext(now) - now), empty: titleCase('Corrupting needs a tier 3 or 4 item.'),
      cards: choices.map((name) => (record.corrupted?.name === name ? { name, state: { glow: BROKER, ribbon: 'CORRUPTED', note: drawbackText(record.corrupted), noteColor: BROKER } }
        : { name, state: can ? { glow: BROKER, ribbon: 'CORRUPT', note: `${fmt(corruptPrice(itemByName(name)))} Souls` } : { poor: true, note: `${fmt(corruptPrice(itemByName(name)))} Souls` } })),
    });
    if (open && !record.corrupted && choices.length) {
      components.push(row(new StringSelectMenuBuilder().setCustomId(`${CORRUPT_ID}:${member.id}`).setPlaceholder(titleCase('Corrupt an item'))
        .addOptions(choices.map((name) => ({ label: name, value: name, description: titleCase(`Costs ${fmt(corruptPrice(itemByName(name)))} souls`) })))));
    }
  } else { // sell: half the price back (a legendary can't be sold)
    const sellable = held.filter((name) => name !== record.legendary);
    pic = await listPage({
      title: 'Sell Items', line: titleCase('Items sell back for half of what they cost.'), accent: '#e4b20c', empty: titleCase(`${record.hero} has no items.`),
      cards: held.map((name) => ({ name, state: name === record.legendary ? { note: "Can't Be Sold", noteColor: '#8f867b' } : { corrupted: record.corrupted?.name === name, note: `${fmt(sellPrice(itemByName(name), record.corrupted))} Souls` } })),
    });
    if (sellable.length) {
      components.push(row(new StringSelectMenuBuilder().setCustomId(`${SELL_ID}:${member.id}`).setPlaceholder(titleCase('Sell an item back for half its price'))
        .addOptions(sellable.map((name) => ({ label: name, value: name, description: titleCase(`Sells for ${fmt(sellPrice(itemByName(name), record.corrupted))} souls${record.corrupted?.name === name ? ' (corrupted)' : ''}`) })))));
    }
  }
  const button = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
  components.push(row(button(`${BACK_ID}:${member.id}`, 'Back'), button(`${HEROCARD_ID}:${member.id}`, 'Hero'), ...(buy ? [buy] : [])));
  return { embeds: [e], components, files: [soulsFile(), await heroPicture(record.hero), new AttachmentBuilder(pic, { name: 'shop.png' })] };
}

// A picture with its empty border cut off, on a square (the camp triangles sit small in their files; an author icon is only 24 px). Kept per file.
const trims = new Map();
async function trimmed(file) {
  if (!trims.has(file)) {
    const img = await loadImage(file);
    const probe = createCanvas(img.width, img.height);
    const g = probe.getContext('2d');
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, img.width, img.height);
    let [x0, y0, x1, y1] = [img.width, img.height, 0, 0];
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (data[(y * img.width + x) * 4 + 3] > 16) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const [w, h] = [Math.max(1, x1 - x0 + 1), Math.max(1, y1 - y0 + 1)];
    const side = Math.max(w, h);
    const out = createCanvas(side, side);
    out.getContext('2d').drawImage(img, x0, y0, w, h, (side - w) / 2, (side - h) / 2, w, h);
    trims.set(file, out.toBuffer('image/png'));
  }
  return trims.get(file);
}

// ---- a target's details, with Send / Back ----
// What the siege card (siegeCard.js) shows: each lane's Walker, and the five stages as the member would meet them (grown with their clears).
const siegeCardData = (record, now) => ({
  lanes: Object.entries(LANES).map(([key, lane]) => {
    const down = isDown(record, 'walker', key, now);
    return { name: lane.name, icon: lane.icon, down, back: down ? timeLeft(cooldownLeft(record, slotOf('walker', key), now)) : null };
  }),
  stages: SIEGE.stages.map((s) => {
    const foes = s.enemies();
    return { name: s.name, icon: s.icon, count: foes.length, health: foes[0].stats.maxHealth * clearPower(record.clears?.siege, 'siege'), damageType: foes[0].stats.damageType, curses: !!foes[0].stats.blast };
  }),
});

// Every target's screen is in Title Case (his call, Oct 3). A camp's has the minimap triangle as the author icon and one of its Haunts in the corner;
// `family` is that Haunt's family (random unless given), and Send carries it so the fight is against the one shown.
// A Guardian or Walker is its lane's (`variant` is the lane, York unless given): its screen says which lane, and when it is down or locked.
async function targetView(member, key, record, now = Date.now(), variant = null) {
  const hero = record.hero;
  const family = !CAMP_SIZE[key] ? null : campFamilies(key).includes(variant) ? variant : pickRandom(campFamilies(key));
  const lane = !PER_LANE.has(key) ? undefined : LANES[variant] ? variant : Object.keys(LANES)[0];
  const left = cooldownLeft(record, slotOf(key, lane), now);
  const by = lockedBy(record, key, lane, now);
  const e = embed().setTitle(nameOf(key, lane)).setThumbnail('attachment://thumb.png');
  let footer;
  let pic;
  if (key === 'siege') {
    e.setDescription(`${hero} fights through the enemy base in one go. No stopping,\nand health carries from one stage to the next.`)
      .addFields(
        { name: 'Pays', value: payText('siege', record), inline: true }, { name: 'Cooldown', value: 'Once a day', inline: true }, { name: 'Rejuvs', value: `${record.rejuvs} / ${MAX_REJUVS}`, inline: true }, { ...grownField('siege', record), inline: true },
      ).setImage('attachment://siege.png');
    footer = `Pays only if every stage is cleared. If ${hero} dies at any stage, it all restarts, nothing is paid, and the cooldown starts.`;
    pic = SIEGE.stages[3].icon;
  } else if (key === 'waves') {
    const best = record.bestWave ?? 0;
    e.setDescription(`${hero} holds the lane against wave after wave of troopers.\nEvery wave is stronger than the last, and health carries on.`)
      .addFields([
        { name: 'Lane', value: `${LANES[lane].name} (${LANES[lane].color})` },
        { name: 'Each Wave', value: `3 troopers + 1 medic (a melee trooper joins after wave ${WAVES.early})` },
        { name: 'Pays', value: `${souls(wavePay(1))} for wave 1, a little more each wave` },
        { name: 'Cooldown', value: 'Once a day' },
        { name: 'Best Run', value: best ? `${plural(best, 'wave')} (${souls(wavesPay(best))})` : 'None yet' },
      ].map((f) => ({ ...f, inline: true })));
    footer = `Every wave cleared pays, and nothing is lost when ${hero} falls. The run ends when ${hero} falls.`;
    pic = path.join(ICONS, 'trooper.png');
  } else {
    const t = TARGETS[key];
    const foes = t.enemies();
    const s = foes[0].stats;
    const camp = CAMP_ENEMIES[key];
    const fields = [];
    if (camp) {
      fields.push({ name: 'Enemies', value: camp }, { name: 'Health', value: key === 'medium-camp' ? '322 or 129' : `${fmt(s.maxHealth)} each` });
    } else {
      if (lane) fields.push({ name: 'Lane', value: `${LANES[lane].name} (${LANES[lane].color})` });
      // a Walker is tougher for every other Walker that is down
      fields.push({ name: 'Health', value: fmt(s.maxHealth + (key === 'walker' ? WALKER_STEP * Object.keys(LANES).filter((l) => l !== lane && isDown(record, 'walker', l, now)).length : 0)) });
      if (s.healthRegen) fields.push({ name: 'Health Regen', value: `${s.healthRegen} per second` });
      fields.push({ name: 'Damage', value: `${+s.dps.toFixed(1)} per second (${s.damageType === 'spirit' ? 'spirit' : 'weapon'})` });
    }
    fields.push({ name: 'Bullet Resist', value: `${Math.round(s.bulletResist * 100)}%` });
    if (camp) fields.push({ name: 'Spirit Resist', value: `${Math.round(s.spiritResist * 100)}%` });
    // the family's special attack (haunts.js): small Haunts have none, so a Tier 1 camp never shows one
    if (SPECIALS[family] && CAMP_SIZE[key] !== 'small') fields.push({ name: key === 'medium-camp' ? 'Special Attack (Medium Haunts)' : 'Special Attack', value: SPECIALS[family].text });
    fields.push({ name: 'Pays', value: payText(key, record) }, { name: 'Cooldown', value: every(t.cooldown) });
    if (t.rejuv) fields.push({ name: 'Rejuvs Held', value: `${record.rejuvs}` });
    fields.push(grownField(key, record));
    e.setDescription(TEXT[key]).addFields(fields.map((f) => ({ ...f, inline: true })));
    footer = t.rejuv ? `No Rejuvs work in this fight. If ${hero} dies, nothing is paid and the cooldown still starts.` : `If ${hero} dies, nothing is paid and the cooldown still starts.`;
    pic = t.icon;
  }
  const why = left > 0 ? (lane && isDown(record, key, lane, now) ? `Down: back in ${timeLeft(left)}.` : `Not ready yet: ${timeLeft(left)} left.`)
    : by === 'guardian' ? `Locked: ${LANES[lane].name}'s Guardian must fall first.` : by === 'walkers' ? 'Locked: all three Walkers must be down first.' : '';
  const text = why ? `${why} ${footer}` : footer;
  // every line of text on a target's screen is in Title Case (not the souls emoji's own text)
  const cased = (line) => (line.includes('<') ? line : titleCase(line));
  e.setDescription(cased(e.data.description)).setFields(e.data.fields.map((f) => ({ ...f, value: cased(f.value) }))).setFooter({ text: titleCase(text) });
  const send = new ButtonBuilder().setCustomId(`${SEND_ID}:${member.id}:${key}${family || lane ? `:${family || lane}` : ''}`).setLabel('Send').setStyle(ButtonStyle.Success).setDisabled(left > 0 || !!by);
  const back = new ButtonBuilder().setCustomId(`${BACK_ID}:${member.id}`).setLabel('Back').setStyle(ButtonStyle.Secondary);
  if (family) { // the camp's triangle moves to the author line, the Haunt takes the corner
    e.setAuthor({ name: 'Hero Farming', iconURL: 'attachment://icon.png' });
    return { embeds: [e], components: [row(targetMenu(member.id, record, now, key)), row(send, back)], files: [new AttachmentBuilder(await trimmed(pic), { name: 'icon.png' }), picture(hauntFile(family, CAMP_SIZE[key]))] };
  }
  if (lane) { // a lane's Guardian or Walker: the lane's badge is the author icon
    e.setAuthor({ name: 'Hero Farming', iconURL: 'attachment://icon.png' });
    return { embeds: [e], components: [row(targetMenu(member.id, record, now, slotOf(key, lane))), row(send, back)], files: [new AttachmentBuilder(LANES[lane].icon, { name: 'icon.png' }), picture(pic)] };
  }
  const files = [soulsFile(), picture(pic)];
  if (key === 'siege') files.push(new AttachmentBuilder(await siegeCard(siegeCardData(record, now)), { name: 'siege.png' }));
  return { embeds: [e], components: [row(targetMenu(member.id, record, now, key)), row(send, back)], files };
}

// ---- a fight, live and finished ----
// The troopers of a wave run (his renders, Oct 3): the picture is the trooper the hero is shooting at, the first one still standing.
const TROOPER_PIC = { Trooper: 'trooper', 'Medic Trooper': 'trooper-medic', 'Melee Trooper': 'trooper-melee' };
const trooperPicture = (frame) => {
  const foe = frame?.enemies.find((e) => e.hp > 0) ?? frame?.enemies[0];
  return path.join(ICONS, `${TROOPER_PIC[foe?.name.replace(/ \d+$/, '')] ?? 'trooper'}.png`);
};
const enemyGroup = (run, frame) => (run.family ? `${run.family.name}s` : run.siege || run.waves ? run.stageNames[frame.stage] : nameOf(run.key, run.lane));
const enemyPicture = (run, frame) => (run.waves ? trooperPicture(frame) : run.family ? hauntFile(run.family.key, run.family.size) : run.siege ? SIEGE.stages[frame.stage].icon : TARGETS[run.key].icon);

// A defeated enemy: "Down" in red. Discord only colours text inside an `ansi` code block ([31m = red, [0m = back to normal);
// desktop and web show the colour, a client without ANSI support shows plain text.
const DOWN = '```ansi\n\u001b[31mDown\u001b[0m\n```';

// One field per enemy: a bar made of the server's emojis is about 380 characters, and a field holds at most 1,024.
const enemyFields = (frame) => frame.enemies.map((f) => ({ name: f.asleep && f.hp > 0 ? `${f.name} 💤` : f.name, value: f.hp > 0 ? barLine(f.hp, f.max) : DOWN }));

// One snapshot of the fight (frames come from play.simulate).
function fightView(run, frame) {
  const hero = run.hero;
  const e = embed().setTitle(run.siege ? 'Base Siege' : nameOf(run.key, run.lane)).setThumbnail('attachment://thumb.png');
  if (run.siege) e.setDescription(`Stage ${frame.stage + 1} of ${run.stageNames.length}: ${hero} is fighting the ${run.stageNames[frame.stage]}.`);
  else if (run.waves) e.setDescription(`${run.stageNames[frame.stage]}: ${hero} is holding the lane against ${frame.enemies.length} troopers.`);
  else if (run.family) e.setDescription(`${hero} is fighting ${frame.enemies.length} ${run.family.name}s.`);
  else e.setDescription(`${hero} is fighting the ${nameOf(run.key, run.lane)}.`);
  const fields = [];
  if (run.siege) {
    fields.push({ name: 'Stages', value: run.stageNames.map((n, i) => `${n}  -  ${i < frame.stage ? 'Cleared' : i === frame.stage ? 'Fighting' : 'Waiting'}`).join('\n') });
  }
  fields.push({
    name: hero,
    value: `${barLine(frame.hero.hp, frame.hero.max)}${frame.hero.respawning ? '  -  Respawning' : ''}${run.siege ? `\nRejuvs Left: ${frame.rejuvs}` : ''}`,
  });
  fields.push(...enemyFields(frame));
  fields.push({ name: 'Abilities', value: frame.abilities.map((a) => `${a.name}  -  ${a.status}`).join('\n') });
  fields.push({ name: 'Battle Log', value: frame.log.length ? frame.log.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing yet' });
  e.addFields(fields).setFooter({ text: `Fight time ${clock(frame.t)}${run.siege ? '  -  one death and the whole siege restarts' : ''}` });
  return { embeds: [e], components: [], files: [soulsFile(), picture(enemyPicture(run, frame))], attachments: [] };
}

function resultView(run) {
  const hero = run.hero;
  const last = run.frames[run.frames.length - 1];
  const group = enemyGroup(run, last);
  const label = run.siege ? 'Base Siege' : nameOf(run.key, run.lane);
  const cooldown = cooldownSeconds(run.siege ? 'siege' : run.key);
  const e = embed(run.won ? WIN : LOSS).setThumbnail('attachment://thumb.png');
  if (run.waves) { // a wave run always ends with the hero down; what counts is how far it got
    e.setTitle(`${label}: ${plural(run.cleared, 'Wave')} Cleared`).setDescription(run.timedOut ? `${hero} ran out of time on ${run.stageNames[run.cleared]}.` : `${hero} fell on ${run.stageNames[Math.min(run.cleared, run.stageNames.length - 1)]}.`);
  } else if (run.won) {
    e.setTitle(`${label} Cleared`).setDescription(run.siege ? `${hero} took down the Base Guardians, both Shrines and the Patron.`
      : run.family ? `${hero} took down all ${last.enemies.length} ${group}.` : `${hero} took down the ${label}.`);
  } else if (run.siege) {
    e.setTitle('Base Siege Failed').setDescription(run.timedOut ? `${hero} ran out of time at the ${run.stageNames[run.cleared]}. The siege starts over.` : `${hero} fell to the ${run.stageNames[run.cleared]}. The siege starts over.`);
  } else {
    e.setTitle(`${hero} Was Defeated`).setDescription(run.timedOut ? `${hero} ran out of time and the ${group} is back to full health.` : `The ${group} won and ${run.family ? 'the camp' : 'the target'} is back to full health.`);
  }
  e.addFields(
    { name: 'Souls Earned', value: run.won ? `+${souls(run.souls)}` : souls(0), inline: true },
    { name: 'Fight Time', value: clock(run.seconds), inline: true },
    { name: 'Next Attempt', value: `In ${span(cooldown)}`, inline: true },
  );
  if (run.rejuvsEarned) e.addFields({ name: 'Rejuv Earned', value: `+${run.rejuvsEarned}`, inline: true });
  if (run.itemSouls) e.addFields({ name: 'From Items', value: `+${souls(run.itemSouls)}`, inline: true }); // Trophy Collector, Cultist Sacrifice (already in Souls Earned)
  if (run.gifts?.length) { // Eternal Gift's permanent buffs
    const got = {};
    for (const b of run.gifts) got[b] = (got[b] ?? 0) + 1;
    e.addFields({ name: `Eternal Gift  -  ${hero} keeps these for good`, value: Object.entries(got).map(([k, n]) => buffText(k, n)).join('\n') });
  }
  if (run.siege) {
    e.addFields({ name: 'Stages', value: run.stageNames.map((n, i) => `${n}  -  ${i < run.cleared ? 'Cleared' : i === run.cleared ? 'Failed' : 'Not Reached'}`).join('\n') });
  }
  if (run.waves) e.addFields({ name: 'Best Run', value: plural(Math.max(run.best ?? 0, run.cleared), 'Wave'), inline: true });
  e.addFields({ name: hero, value: barLine(last.hero.hp, last.hero.max) });
  if (!run.won || run.waves) e.addFields(enemyFields(last));
  const lines = run.log.slice(-(run.won ? 8 : 5));
  e.addFields({ name: 'Battle Log', value: lines.length ? lines.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing happened' });
  e.setFooter({ text: run.waves ? `Every wave cleared paid. ${hero} can hold this lane again in ${span(cooldown)}.` : run.won ? `${hero} can clear this ${run.family ? 'Camp' : label} again in ${span(cooldown).replace(/hour|minute/, (u) => u[0].toUpperCase() + u.slice(1))}.` : `Nothing is paid, and the cooldown has started. ${hero} can try again in ${span(cooldown)}.` });
  return { embeds: [e], components: [], files: [soulsFile(), picture(enemyPicture(run, last))], attachments: [] };
}

// ---- encounters: the duel with a rival hero (rules: encounter.js; the offer and the unlock: play.js) ----
// The offer: a hero the member hasn't unlocked showed up (play.js meet) and waits OFFER_MS. Its own embed under the fight's result
// (his call, Oct 10), in the rival's colour with its picture, and the Fight / Walk Away buttons.
async function withRival(view, rival, ownerId) {
  const { color } = await heroArt(slugOf(rival), 'icon');
  view.embeds.push(new EmbedBuilder().setColor(color).setTitle('A Rival Appears').setThumbnail('attachment://rival.png')
    .setDescription(`**${rival}** steps out and wants a duel.`)
    .addFields(
      { name: 'Win', value: `${rival} is yours to play`, inline: true },
      { name: 'Lose', value: 'Costs nothing but Rejuvs used', inline: true },
    ).setFooter({ text: `${rival} waits for 5 minutes.` }));
  view.files.push((await heroPicture(rival)).setName('rival.png'));
  view.components.push(row(
    new ButtonBuilder().setCustomId(`${DUEL_ID}:${ownerId}`).setLabel(`Fight ${rival}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${WALK_ID}:${ownerId}`).setLabel('Walk Away').setStyle(ButtonStyle.Secondary),
  ));
  return view;
}

// The rival's face: its portrait from the wiki where one was downloaded (assets/farm/rivals: gloating when it won, hurt when it was beaten),
// else the hero's icon.
async function rivalFace(name, mood = null) {
  const file = mood && path.join(ASSETS, 'farm', 'rivals', `${name.toLowerCase()}_${mood}.png`);
  return file && fs.existsSync(file) ? picture(file) : heroPicture(name);
}

// One snapshot of a duel (frames come from encounter.duel, the same shape as a trip's).
async function duelView(run, frame) {
  const e = embed().setTitle(`${run.hero} vs ${run.rival}`).setThumbnail('attachment://thumb.png').setDescription(`${run.hero} is duelling ${run.rival}.`)
    .addFields(
      { name: run.hero, value: `${barLine(frame.hero.hp, frame.hero.max)}${frame.hero.respawning ? '  -  Respawning' : ''}
Rejuvs Left: ${frame.rejuvs}` },
      ...enemyFields(frame),
      { name: 'Abilities', value: frame.abilities.map((a) => `${a.name}  -  ${a.status}`).join('\n') },
      { name: 'Battle Log', value: frame.log.length ? frame.log.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing yet' },
    ).setFooter({ text: `Fight time ${clock(frame.t)}  -  win and ${run.rival} is unlocked` });
  return { embeds: [e], components: [], files: [soulsFile(), await rivalFace(run.rival)], attachments: [] };
}

async function duelResultView(run) {
  const { hero, rival } = run;
  const last = run.frames[run.frames.length - 1];
  const cost = `It cost you ${run.rejuvsUsed ? plural(run.rejuvsUsed, 'Rejuv') : 'nothing'}.`;
  const e = embed(run.won ? WIN : LOSS).setThumbnail('attachment://thumb.png');
  if (run.won) e.setTitle(`${rival} Unlocked`).setDescription(`${hero} won the duel. ${rival} is yours now, at level 0 with no items.\nSwitch with **Switch Hero** on \`/base\`.`);
  else if (run.timedOut) e.setTitle(`${rival} Got Away`).setDescription(`Nobody went down in time and ${rival} slipped away. ${cost}`);
  else e.setTitle(`${hero} Was Defeated`).setDescription(`${rival} won the duel and moved on. ${cost}`);
  const lines = run.log.slice(-6);
  e.addFields(
    { name: 'Fight Time', value: clock(run.seconds), inline: true },
    { name: 'Rejuvs Used', value: String(run.rejuvsUsed), inline: true },
    { name: hero, value: barLine(last.hero.hp, last.hero.max) },
    ...enemyFields(last),
    { name: 'Battle Log', value: lines.length ? lines.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing happened' },
  ).setFooter({ text: run.won ? 'You can switch heroes once a day. Each hero keeps its own level, abilities and items.' : 'Another rival may show up after a won fight.' });
  return { embeds: [e], components: [], files: [soulsFile(), await rivalFace(rival, run.won ? 'critical' : 'gloat')], attachments: [] };
}

// How many Character Unlock Tokens a member holds, and where the next one comes from (the footer of the switch screens).
const tokenText = (n) => (n > 0 ? `You have ${plural(n, 'Character Unlock Token')}.` : 'Win the Base Siege with a hero to earn a Character Unlock Token (once per hero).');

// A hero's first siege win pays a Character Unlock Token (his call, Oct 2): its own message after the result, like a legendary drop.
const TOKEN_COLOR = 0xa98be8; // the token's violet
function tokenView(hero) {
  const e = embed(TOKEN_COLOR).setTitle('Character Unlock Token').setThumbnail('attachment://token.png')
    .setDescription(`${hero} beat the Base Siege and earned a **Character Unlock Token**.
Use it on the Switch Hero screen to unlock any hero.`)
    .setFooter({ text: 'Each hero earns one from its first siege win.' });
  return { embeds: [e], files: [soulsFile(), new AttachmentBuilder(path.join(ICONS, 'unlock-token.png'), { name: 'token.png' })] };
}

// A legendary drop (levels.js rollLegendary) is its own gold message right after the fight result (his call, Oct 2): the item's name,
// every number on its card with the game's own labels, and its picture.
function legendaryView(name) {
  const card = itemByName(name);
  const lines = [...new Map(Object.entries(card).filter(([k]) => k.startsWith('Info')).flatMap(([, info]) => info.Main).map((l) => [l.Key, l])).values()]
    .map((l) => `${l.Prefix === '{s:sign}' ? (l.Value > 0 ? '+' : '') : l.Prefix}${(+l.Value.toFixed(2)).toLocaleString('en-US')}${l.Postfix.trim()} ${l.Label.replace(/([a-z])([A-Z])/g, '$1 $2')}`); // a missing label is the key, split into words
  const e = embed(parseInt(GOLD.slice(1), 16)).setTitle('Legendary Drop').setDescription([`**${name}**`, ...lines].join('\n')).setImage('attachment://legendary.png');
  return { embeds: [e], files: [soulsFile(), new AttachmentBuilder(itemFile(name), { name: 'legendary.png' })] };
}

// ---- /jungle roam ----
// One drawn card (roamCard.js) with the finds, buffs, bridge buff and souls; the text under it is the readable detail. Colour: the bridge
// buff's own colour when one was found, gold for a permanent buff or a Sinner's Sacrifice, green otherwise.
async function roamView(haul) {
  const hero = haul.hero;
  const total = Object.values(haul.finds).reduce((s, n) => s + n, 0);
  const gained = {};
  for (const b of haul.buffs) gained[b] = (gained[b] ?? 0) + 1;
  const hex = (c) => parseInt(c.slice(1), 16);
  const color = haul.bridge ? hex(BRIDGE_COLOR[haul.bridge]) : haul.buffs.length || haul.finds.sinner ? hex(GOLD) : WIN;
  const e = embed(color).setTitle('Roam').setDescription(`${hero} roamed the map and picked up ${plural(total, 'thing')}.`)
    .setImage('attachment://roam.png')
    .setFooter({ text: `Next roam in ${span(ROAM_COOLDOWN)}  -  ${haul.bridge ? 'Bridge buff found' : `This hour's bridge buff: ${BRIDGE[haul.bridgeNow].name}`}` });
  if (haul.buffs.length) e.addFields({ name: `Buffs Gained  -  they stay with ${hero} for good`, value: Object.entries(gained).map(([k, n]) => buffText(k, n)).join('\n') });
  if (haul.bridge) e.addFields({ name: `${BRIDGE[haul.bridge].name} Bridge Buff  -  used on ${hero}'s next fight`, value: BRIDGE[haul.bridge].text });
  return { embeds: [e], components: [], files: [soulsFile(), new AttachmentBuilder(await roamCard(haul, gained), { name: 'roam.png' })], attachments: [] };
}

const notReady = (what, left) => `${what} isn't ready yet. Ready in ${timeLeft(left)}.`;

module.exports = {
  titleCase,
  HERO_ID, PICK_ID, TARGET_ID, SEND_ID, BACK_ID, HEROCARD_ID, UPGRADE_ID, ITEM_ID, BUY_ID, SHOPMODE_ID, SELL_ID, SWITCH_ID, SWITCHTO_ID, UNLOCK_ID, LABELS, HOME_ORDER,
  IMBUE_ID, IMBUESET_ID, SHOPTAB_ID, CORRUPT_ID, HATCH_ID, DUEL_ID, WALK_ID, withRival, duelView, duelResultView,
  pickView, homeView, heroView, shopView, targetView, fightView, resultView, legendaryView, tokenView, roamView, notReady, timeLeft, span, every, clock,
};
