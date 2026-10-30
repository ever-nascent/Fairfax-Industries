// /item (his ask, Oct 30): look up any shop item (the 156 shop items + the 17 legendaries) by typing part of its name.
// `search` is the autocomplete (typos, word order and partial words all work); `itemView` is the embed: what it does, its in-game price,
// what it is built from and upgrades into, with Details / Enhanced / Corrupted buttons and a View Upgrade Tree dropdown.
// Item data is the wiki's cards (stats.js) with the game's tooltips and bonus labels from deadlock-api.com (tooltips.js, corruption.js, refreshed
// daily at startup), pictures from itemArt.js. Prices are the game's own, never the souls economy's scale.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { ITEMS, LEGENDARIES, itemByName, DRAWBACKS } = require('./stats');
const { itemFile, fetchMissing, CORRUPTED_FRAME, enhancedOverlay } = require('./itemArt');
const { bonusLines } = require('./corruption');
const { itemLines } = require('./views');
const { fmt, soulsText } = require('../format');

const ITEM_VIEW_ID = 'iteminfo'; // button: iteminfo:<details | enhanced | corrupted>:<user id>:<item name>
const TREE_ID = 'itemtree'; // dropdown: itemtree:<user id>, value = the item name
const ALL = [...ITEMS, ...LEGENDARIES].sort((a, b) => a.Name.localeCompare(b.Name));
const SLOT = { Weapon: 'Weapon', Armor: 'Vitality', Tech: 'Spirit' };
const COLOR = { Weapon: 0xe0a030, Armor: 0x6cb04a, Tech: 0xa070d8 }; // the game's shop colours: orange, green, purple
const VIEWS = { details: 'Details', enhanced: 'Enhanced', corrupted: 'Corrupted' };
const have = (item) => fs.existsSync(itemFile(item.Name));

// ---- search ----
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const NAMES = ALL.map((i) => ({ item: i, key: norm(i.Name) }));

function lev(a, b) { // edit distance, a swapped pair of letters ("toxci") counts as one
  let older = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], older[j - 2] + 1);
    }
    older = prev;
    prev = cur;
  }
  return prev[b.length];
}
const subsequence = (q, s) => { let at = 0; for (const c of s) if (c === q[at]) at++; return at === q.length; };

// How well a typed text points at a name, 0 (not at all) to 100 (exactly). Both are already normalised.
function score(q, name) {
  if (name === q) return 100;
  if (name.startsWith(q)) return 90;
  const words = name.split(' ');
  const tokens = q.split(' ');
  if (words.some((w) => w.startsWith(q))) return 80;
  if (name.includes(q)) return 70;
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 65; // "bullets toxic", "tox bul"
  // typos: each typed word within a few edits of the start of some word of the name ("toxci bulets")
  let off = 0;
  for (const t of tokens) {
    const allowed = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0;
    const best = Math.min(...words.map((w) => Math.min(lev(t, w.slice(0, t.length)), lev(t, w))));
    if (best > allowed) { off = -1; break; }
    off += best;
  }
  if (off >= 0) return 55 - off * 5;
  return q.length >= 3 && subsequence(q.replace(/ /g, ''), name.replace(/ /g, '')) ? 30 : 0; // "tbul" -> Toxic Bullets
}

// The cards that best match what was typed, best first (nothing typed: the first ones A-Z).
function search(text, limit = 25) {
  const q = norm(text ?? '');
  if (!q) return NAMES.slice(0, limit).map((n) => n.item);
  return NAMES.map((n) => ({ item: n.item, s: score(q, n.key) })).filter((m) => m.s > 0)
    .sort((a, b) => b.s - a.s || a.item.Name.localeCompare(b.item.Name)).slice(0, limit).map((m) => m.item);
}

// The autocomplete list: "Toxic Bullets  -  Spirit, Tier 3, 3,200" (the pick is just the name).
const choices = (text) => search(text).map((i) => ({ name: `${i.Name}  -  ${SLOT[i.Slot]}, Tier ${i.Tier}, ${fmt(i.Cost)}`.slice(0, 100), value: i.Name }));

// What was typed in the command's box, resolved to one card: an exact name, else the best match if it is a good one.
function resolve(text) {
  const exact = itemByName(String(text).trim());
  if (exact) return exact;
  const q = norm(text);
  const [best] = search(text, 1);
  return best && score(q, norm(best.Name)) >= 40 ? best : null;
}

// ---- the item's family ----
const byKey = new Map(ALL.map((i) => [i.Key, i]));
const builtFrom = (card) => (card.Components ?? []).map((k) => byKey.get(k)).filter(Boolean);
const upgradesInto = (card) => ALL.filter((i) => (i.Components ?? []).includes(card.Key));
const has = (card, view) => view === 'details' || Object.keys(card[view === 'enhanced' ? 'PropertyUpgrades' : 'CorruptedUpgrades'] ?? {}).length > 0;

// ---- the embed ----
// The item's picture; in the Corrupted view the game's corrupted frame is laid over it, in the Enhanced view the wiki's blue gradient, like everywhere else in the bot.
async function pictureOf(item, view) {
  const name = path.basename(itemFile(item.Name));
  if (view === 'details') return new AttachmentBuilder(itemFile(item.Name), { name });
  const art = await loadImage(itemFile(item.Name));
  const canvas = createCanvas(art.width, art.height);
  const g = canvas.getContext('2d');
  g.drawImage(art, 0, 0);
  if (view === 'enhanced') enhancedOverlay(g, 0, 0, art.width, art.height);
  else g.drawImage(await loadImage(CORRUPTED_FRAME), 0, 0, art.width, art.height);
  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: `${view}_${name}` });
}
const wiki = (card) => `https://deadlock.wiki/${encodeURIComponent(card.Name.replace(/ /g, '_'))}`;
const names = (list) => list.map((i) => `**${i.Name}** (${fmt(i.Cost)})`).join('\n') || 'Nothing';

function sectionOf(card, view) {
  if (view === 'details') return itemLines(card).join('\n');
  if (view === 'enhanced') return ['**Enhanced Bonuses**', ...(bonusLines(card.Name, 'enhanced').length ? bonusLines(card.Name, 'enhanced') : ['None listed'])].join('\n');
  const tier = card.Tier === 4 ? 1 : 0; // DRAWBACKS ranges: [tier 3, tier 4]
  const drawbacks = Object.values(DRAWBACKS).map((d) => `${d.name} -${d.range[tier][0]} to -${d.range[tier][1]}${d.unit}`);
  return ['**Corrupted Bonuses**', ...(bonusLines(card.Name).length ? bonusLines(card.Name) : ['None listed']), '', '**Drawback** (one is rolled when The Broker corrupts it)', ...drawbacks].join('\n');
}

// Everything to send for one item and view. The item is the thumbnail; an item with an upgrade tree (parts or upgrades) also gets the View Upgrade Tree dropdown,
// which opens any item in that tree in the same message (his ask, Oct 30: no upgrade pictures in the embed).
async function itemView(card, view = 'details', userId = '0') {
  if (!has(card, view)) view = 'details';
  if (!have(card)) await fetchMissing().catch(() => {}); // a first-time picture; the embed still works without it
  const e = new EmbedBuilder().setColor(COLOR[card.Slot]).setTitle(`${card.Name}${view === 'details' ? '' : `  -  ${VIEWS[view]}`}`).setURL(wiki(card))
    .setDescription(sectionOf(card, view).slice(0, 4000))
    .addFields(
      { name: 'Cost', value: soulsText(card.Cost), inline: true },
      { name: 'Type', value: `${SLOT[card.Slot]}, ${card.Tier === 5 ? 'Legendary' : `Tier ${card.Tier}`}`, inline: true },
      { name: 'Use', value: card.Activation === 'Passive' ? 'Passive' : 'Active', inline: true },
    );
  if (view === 'details') e.addFields({ name: 'Built From', value: names(builtFrom(card)), inline: true }, { name: 'Upgrades Into', value: names(upgradesInto(card)), inline: true });
  const shown = have(card);
  const picture = shown && (await pictureOf(card, view));
  if (picture) e.setThumbnail(`attachment://${picture.name}`);
  const buttons = Object.entries(VIEWS).map(([key, label]) => new ButtonBuilder().setCustomId(`${ITEM_VIEW_ID}:${key}:${userId}:${card.Name}`).setLabel(label)
    .setStyle(key === view ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(key === view || !has(card, key)));
  const components = [new ActionRowBuilder().addComponents(...buttons)];
  const tree = [...builtFrom(card).map((i) => [i, 'Built from']), ...upgradesInto(card).map((i) => [i, 'Upgrades into'])].slice(0, 25).map(([i, how]) => ({ i, how }));
  if (tree.length) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${TREE_ID}:${userId}`).setPlaceholder('View Upgrade Tree')
      .addOptions(tree.map(({ i, how }) => ({ label: i.Name, description: `${how} - Tier ${i.Tier}, ${fmt(i.Cost)} souls`, value: i.Name })))));
  }
  return { embeds: [e], files: picture ? [picture] : [], components };
}

module.exports = { ITEM_VIEW_ID, TREE_ID, search, choices, resolve, itemView, builtFrom, upgradesInto, has };
