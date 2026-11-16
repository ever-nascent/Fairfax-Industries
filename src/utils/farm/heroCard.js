// The picture on the hero screen (/hero, or the Hero button on /base), drawn after the in-game HUD ("it looks a lot better than
// ours"): the level badge with its ring and the souls, the three stat groups under their emblems (weapon orange, vitality green, spirit purple),
// the items as the HUD shows them (the item's own picture with its tier numeral in the corner, 2 x 2 per kind = the HUD's 6 x 2 grid), and the ability bar: white discs with
// the ability glyphs, numbered 1-4, with the three upgrade pips above each. Art: assets/farm/ui and assets/farm/items (the game's own icons from
// deadlock-api.com, see assets/CREDITS.txt), ability glyphs from assets/trivia/abilities.
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { ASSETS, loadSouls, drawSouls, halftone, grain, grainAndVignette, jpeg } = require('../art');
const { SOULS, FONT, image, label } = require('./roamCard');
const { MAX_TIER, TIER_COSTS, SLOTS, MAX_ITEMS, unlockLevel } = require('./levels');
const { itemByName } = require('./stats');
const { itemFile, CORRUPTED_FRAME, enhancedOverlay, crackOverlay } = require('./itemArt');
const { paintOverlay } = require('./paintSplash');
const { fusedTile, halfPath } = require('./fuseStitch');
const { flameFrame, emberOverlay } = require('./emberFrame');
const { fmt } = require('../format');
const { RANKS } = require('./rebirth');

const W = 800;
const BASE_H = 982; // room under the ability names for "Unlocks at level N" (+22, Oct 28: a fifth stat row, Headshot Precision / Melee Armor)
const PAD = 32;
const READY = '#7dffb3';
const UI = path.join(ASSETS, 'farm', 'ui');
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
// The three kinds, in the game's colours: `tile` is an owned item's tile (top and bottom of its shading), `ink` the glyph on it.
const KIND = {
  weapon: { name: 'Weapon', color: '#f2a544', rgb: '242,165,68', tile: ['#f7c583', '#eb9a3c'], ink: '#3a2106', emblem: 'weapon.png' },
  vitality: { name: 'Vitality', color: '#93d63f', rgb: '147,214,63', tile: ['#a9e25a', '#7cc22c'], ink: '#14300a', emblem: 'vitality.png' },
  spirit: { name: 'Spirit', color: '#cf9bff', rgb: '207,155,255', tile: ['#dab4ff', '#b77cf4'], ink: '#2b0f4f', emblem: 'spirit.png' },
};
// Which stats go under which emblem: the first is the big number, the rest are rows of [label on the stat sheet, icon in assets/farm/ui].
const STATS = {
  weapon: [['Bullet Damage'], ['Fire Rate', 'stat-fire-rate'], ['Ammo', 'stat-ammo'], ['Lifesteal', 'stat-lifesteal'], ['Precision', 'stat-precision'], ['Headshot Precision', 'stat-headshot']],
  vitality: [['Health'], ['Movement Speed', 'stat-move-speed'], ['Health Regen', 'stat-health-regen'], ['Spirit Armor', 'stat-spirit-resist'], ['Bullet Armor', 'stat-bullet-resist'], ['Melee Armor', 'stat-melee-resist']],
  spirit: [['Spirit Power'], ['Ability Cooldown', 'stat-cooldown'], ['Ability Range', 'stat-range'], ['Ability Duration', 'stat-duration']],
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']; // V: a legendary

const textures = new Map(); // the film grain, one per card height (a legendary adds a row)

// A one-colour copy of a glyph (the game's icons are white on nothing), kept per file, colour and size.
const tints = new Map();
async function tinted(file, color, size) {
  const key = `${file}|${color}|${size}`;
  if (!tints.has(key)) {
    const img = await image(file);
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    const k = Math.min(size / img.width, size / img.height);
    g.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, size, size);
    tints.set(key, c);
  }
  return tints.get(key);
}

// Writes `text` no wider than `maxW`: the font shrinks from `px` until it fits.
function fit(g, text, x, y, maxW, px, min = 9) {
  let size = px;
  g.font = FONT(size);
  while (size > min && g.measureText(text).width > maxW) g.font = FONT(--size);
  g.fillText(text, x, y, maxW);
}

const box = (g, x, y, w, h, r, fill, stroke, lw = 1.5) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
};

// The legendary slot's tile: gold, its own row under the 12 items, drawn only once the hero has a legendary.
const LEGENDARY = { rgb: '255,196,72', tile: ['#ffd77a', '#e9a92f'], ink: '#3d2603' };
const TILE = 100;
const NAME_H = 32;
const LEGEND_H = TILE + NAME_H + 40; // the row's height: its label, the tile and the name under it

// One item's tile at (x, y): the item's own picture (the game's shop art, as the HUD shows it) with a glow in its kind's colour (a flat tile with
// the HUD glyph only when that picture is missing), its tier in the corner and its name under it. `frame` / `frameWidth`: the border (`null`: no
// border and no glow, the legendary's tile: "remove that").
// `flags` = { corrupted, enhanced, fragile, painted }: the Item's marks over its picture.
// `fusedWith` (Victor's Abomination, Descend) = { name, kind, flags } of the second Item: the tile is then his stitched template
// (fuseStitch.js), this Item left of the scar and that one right of it, each with its own marks, tier tab and half of the border.
const artOf = async (name) => { try { return await image(itemFile(name)); } catch { return null; } }; // null: no shop art for it
// The marks, drawn by a plain function (the fused template draws them inside each half's clip, so nothing in it may wait).
async function marker(name, flags) {
  const frame = flags.corrupted ? await image(CORRUPTED_FRAME) : null;
  return (g, x, y) => {
    if (flags.enhanced) enhancedOverlay(g, x, y, TILE, TILE); // the wiki's blue gradient over the picture
    if (frame) g.drawImage(frame, x, y, TILE, TILE); // the game's corrupted frame over the picture
    if (flags.tempered) emberOverlay(g, x, y, TILE, name); // a Tempered Item (Descend, Infernus' fire) burns
    if (flags.fragile) crackOverlay(g, x, y, TILE, TILE, name); // a Fragile Item (Descend's Broker) is cracked
    if (flags.painted) paintOverlay(g, x, y, TILE, TILE, name); // Violet's replica (Descend) is splashed with paint
  };
}
// The tier numeral on a corner triangle in the Item's kind colour, like the shop (orange Weapon, green Vitality, purple Spirit).
function tierTab(g, name, x, y, kind, left = false) {
  const tier = ROMAN[itemByName(name)?.Tier ?? 0];
  if (!tier) return;
  const T = 40, edge = left ? x : x + TILE, dir = left ? 1 : -1;
  g.save();
  g.beginPath();
  g.roundRect(x, y, TILE, TILE, 12);
  g.clip();
  g.beginPath();
  g.moveTo(edge, y);
  g.lineTo(edge + dir * T, y);
  g.lineTo(edge, y + T);
  g.closePath();
  g.fillStyle = kind.tile[1];
  g.fill();
  g.restore();
  g.textAlign = 'center';
  g.fillStyle = kind.ink;
  g.font = FONT(13);
  g.fillText(tier, edge + dir * 11, y + 15);
}
async function itemTile(g, name, kind, x, y, frame = `rgba(${kind.rgb},0.9)`, frameWidth = 2, flags = {}, fusedWith = null) {
  const art = await artOf(name);
  const mark = await marker(name, flags);
  if (flags.tempered && frame) frame = 'rgba(255,205,90,1)'; // a Tempered Item's border is hot gold (its flames are drawn first, in heroCard)
  g.save();
  g.shadowColor = `rgba(${kind.rgb},0.45)`;
  g.shadowBlur = frame ? 14 : 0;
  const fill = g.createLinearGradient(x, y, x, y + TILE);
  fill.addColorStop(0, kind.tile[0]);
  fill.addColorStop(1, kind.tile[1]);
  box(g, x, y, TILE, TILE, 12, fill);
  g.restore();
  if (fusedWith) {
    const other = fusedWith.kind;
    const markB = await marker(fusedWith.name, fusedWith.flags ?? {});
    await fusedTile(g, x, y, TILE,
      { art, tile: kind.tile, rgb: kind.rgb, over: (c) => mark(c, x, y) },
      { art: await artOf(fusedWith.name), tile: other.tile, rgb: other.rgb, over: (c) => markB(c, x, y) });
    for (const [side, k] of [['a', kind], ['b', other]]) { // each half of the border in its own Item's kind
      g.save();
      halfPath(g, x, y, TILE, side);
      g.clip();
      box(g, x, y, TILE, TILE, 12, null, `rgba(${k.rgb},0.9)`, frameWidth);
      g.restore();
    }
    tierTab(g, name, x, y, kind, true);
    tierTab(g, fusedWith.name, x, y, other);
  } else {
    g.save();
    g.beginPath();
    g.roundRect(x, y, TILE, TILE, 12);
    g.clip();
    if (art) g.drawImage(art, x, y, TILE, TILE);
    else { try { g.drawImage(await tinted(path.join(ASSETS, 'farm', 'items', `${slug(name)}.png`), kind.ink, 72), x + 14, y + 16); } catch { /* the name under the tile says what it is */ } }
    mark(g, x, y);
    g.restore();
    if (frame) box(g, x, y, TILE, TILE, 12, null, frame, frameWidth);
    tierTab(g, name, x, y, kind);
  }
  // the name under the tile, on one or two lines
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = FONT(12);
  const shown = fusedWith ? `${name} + ${fusedWith.name}` : name;
  const words = shown.split(' ');
  const lines = words.length > 1 && g.measureText(shown).width > TILE + 6 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [shown];
  lines.forEach((line, k) => fit(g, line, x + TILE / 2, y + TILE + 14 + k * 13, TILE + 8, 12));
  g.textAlign = 'left';
}

// view: { hero, progress, pointsLeft, abilities: [{ slot, name, tier, locked }], stats: { label: text }, items: { weapon: [names], vitality: [...], spirit: [...] }, souls,
//   corrupted: item name (or a list of names) | undefined, legendary: the one in the legendary slot | undefined (the card grows a row for it),
//   counter: { top, amount, label } | undefined (a /descend run: what stands in for the level's souls and the hero's souls, which a run has none of) }
async function heroCard(view) {
  const H = BASE_H + (view.legendary ? LEGEND_H : 0);
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#141a18');
  bg.addColorStop(1, '#0a0c0d');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  halftone(g, 0, 0, W, H, 14, (u, v) => Math.max(0, u * 0.9 + (1 - v) * 0.5 - 0.75) * 0.9, 'rgba(171,255,227,0.08)');
  const souls = await loadSouls();
  const p = view.progress;

  // ---- level badge (a ring that fills toward the next level), what is left to it, and the souls ----
  const [bx, by, br] = [PAD + 52, 86, 44];
  g.beginPath();
  g.arc(bx, by, br, 0, Math.PI * 2);
  g.fillStyle = '#1b2421';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.stroke();
  g.beginPath();
  g.arc(bx, by, br, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, Math.min(1, p.into / p.needed)));
  g.strokeStyle = SOULS;
  g.lineCap = 'round';
  g.stroke();
  g.lineCap = 'butt';
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  fit(g, `${p.level}`, bx, by + 15, 62, 44);
  g.textAlign = 'left';
  g.font = FONT(15);
  g.fillStyle = SOULS;
  g.fillText(view.counter?.top ?? (p.max ? 'MAX LEVEL' : `${fmt(Math.round(p.needed - p.into))} TO NEXT`), bx + 66, 62);
  if (!view.counter) drawSouls(g, souls, bx + 66, 76, 40);
  g.font = '44px Radiance';
  g.fillStyle = SOULS;
  const amount = view.counter?.amount ?? fmt(view.souls);
  const ax = view.counter ? bx + 66 : bx + 96;
  g.fillText(amount, ax, 112);
  const amountW = g.measureText(amount).width;
  g.font = FONT(14);
  g.fillStyle = 'rgba(171,255,227,0.6)';
  g.fillText(view.counter?.label ?? 'YOUR SOULS', ax + 10 + amountW, 110);
  // ability points to spend, top right
  const pointColor = view.pointsLeft ? READY : 'rgba(255,255,255,0.35)';
  g.textAlign = 'right';
  g.font = '44px Radiance';
  g.fillStyle = pointColor;
  g.fillText(`${view.pointsLeft}`, W - PAD, 98);
  const pw = g.measureText(`${view.pointsLeft}`).width;
  g.drawImage(await tinted(path.join(UI, 'ability-point.svg'), pointColor, 34), W - PAD - pw - 44, 66);
  g.font = FONT(14);
  g.fillText(view.pointsLeft === 1 ? 'ABILITY POINT' : 'ABILITY POINTS', W - PAD, 122);
  if (view.rebirth) { // Rebirth (rebirth.js): the rank's icon and name above the ability points
    const name = RANKS[view.rebirth - 1];
    g.drawImage(await image(path.join(ASSETS, 'ranks', `${String(view.rebirth + 1).padStart(2, '0')}_${name.toLowerCase()}.png`)), W - PAD - 48, 8, 48, 48);
    g.fillStyle = SOULS;
    g.font = FONT(15);
    g.fillText(`${name.toUpperCase()}  REBIRTH`, W - PAD - 56, 38);
  }
  g.textAlign = 'left';

  // ---- stats: a column per kind under its emblem, the big number first ----
  const sTop = 156;
  const sGap = 14;
  const sw = (W - 2 * PAD - 2 * sGap) / SLOTS.length;
  const sh = 222; // five rows under the big number
  for (const [n, slot] of SLOTS.entries()) {
    const kind = KIND[slot];
    const x = PAD + n * (sw + sGap);
    box(g, x, sTop, sw, sh, 14, 'rgba(255,255,255,0.04)', `rgba(${kind.rgb},0.35)`);
    const [[bigName], ...rows] = STATS[slot];
    const emblem = await image(path.join(UI, kind.emblem));
    const ek = Math.min(64 / emblem.width, 64 / emblem.height);
    g.drawImage(emblem, x + 14, sTop + 14, emblem.width * ek, emblem.height * ek);
    g.fillStyle = kind.color;
    fit(g, view.stats[bigName] ?? '0', x + 90, sTop + 50, sw - 100, 34);
    g.font = FONT(13);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText(bigName.toUpperCase(), x + 90, sTop + 70);
    for (const [i, [name, icon]] of rows.entries()) {
      const y = sTop + 102 + i * 23;
      g.drawImage(await tinted(path.join(UI, `${icon}.svg`), kind.color, 20), x + 16, y - 15);
      g.font = FONT(15);
      g.fillStyle = '#fff';
      g.fillText(view.stats[name] ?? '0', x + 44, y);
      g.textAlign = 'right';
      g.font = FONT(13);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText(name, x + sw - 14, y);
      g.textAlign = 'left';
    }
  }

  // ---- items: 12 tiles (6 x 2) for any mix of kinds, each in its kind's colour: the item's own picture, its tier in the corner ----
  let iy = sTop + sh + 40;
  label(g, 'Items', PAD, iy);
  iy += 16;
  const COLS = MAX_ITEMS / 2;
  const colGap = (W - 2 * PAD - COLS * TILE) / (COLS - 1);
  const held = SLOTS.flatMap((slot) => view.items[slot].map((name) => [name, KIND[slot]]));
  const joined = new Map((view.fused ?? []).map(([a, b]) => [a, held.find(([n]) => n === b)])); // a fusion is one tile: both Items stitched into it
  for (const [b] of joined.values()) held.splice(held.findIndex(([n]) => n === b), 1);
  const corruptedOnes = [].concat(view.corrupted ?? []);
  // (a corrupted Item is still Enhanced: both marks show, Nov 13)
  const flagsOf = (name, painted) => {
    const corrupted = corruptedOnes.includes(name);
    return { corrupted, enhanced: !!view.enhanced?.includes(name), fragile: !!view.fragile?.includes(name), tempered: !!view.tempered?.[name], painted };
  };
  g.textAlign = 'right';
  g.font = FONT(14);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  const open = view.maxItems ?? MAX_ITEMS; // a Descend run on Ascension 8+ has fewer slots: the rest are drawn locked (a lock, like the game)
  g.fillText(`${held.length} / ${open}`, W - PAD, iy - 4);
  g.textAlign = 'left';
  // a Tempered Item's flames go down first, under every tile and name, so a second-row fire never covers the names above it
  held.forEach(([name], i) => {
    if (view.tempered?.[name] || view.tempered?.[joined.get(name)?.[0]]) flameFrame(g, PAD + (i % COLS) * (TILE + colGap), iy + Math.floor(i / COLS) * (TILE + NAME_H), TILE, name);
  });
  for (let i = 0; i < MAX_ITEMS; i++) {
    const x = PAD + (i % COLS) * (TILE + colGap);
    const y = iy + Math.floor(i / COLS) * (TILE + NAME_H);
    const [name, kind] = held[i] ?? [];
    if (!name && i >= open) {
      box(g, x, y, TILE, TILE, 12, 'rgba(0,0,0,0.35)', 'rgba(255,255,255,0.10)');
      const size = Math.round(TILE * 0.42);
      g.drawImage(await tinted(path.join(UI, 'lock.svg'), 'rgba(255,255,255,0.38)', size), x + (TILE - size) / 2, y + (TILE - size) / 2, size, size);
      const note = view.lockedNotes?.[i - open];
      if (note) {
        g.textAlign = 'center';
        g.font = FONT(12);
        g.fillStyle = 'rgba(255,255,255,0.4)';
        g.fillText(note, x + TILE / 2, y + TILE + 16);
        g.textAlign = 'left';
      }
      continue;
    }
    if (!name) { box(g, x, y, TILE, TILE, 12, 'rgba(255,255,255,0.035)', 'rgba(255,255,255,0.12)'); continue; }
    // the last copies of a name are Violet's (her replica goes in after the original, and dropItem takes the first copy)
    const painted = held.slice(i).filter(([n]) => n === name).length <= (view.replicas ?? []).filter((n) => n === name).length;
    const [b, bKind] = joined.get(name) ?? [];
    joined.delete(name); // only the first copy is stitched: a second (Violet's replica) is its own tile
    // a fused Item is one copy: painted only when every copy of it is Violet's
    const fused = b ? { name: b, kind: bKind, flags: flagsOf(b, SLOTS.flatMap((s) => view.items[s]).filter((n) => n === b).length <= (view.replicas ?? []).filter((n) => n === b).length) } : null;
    await itemTile(g, name, kind, x, y, undefined, undefined, flagsOf(name, painted), fused);
  }
  iy += 2 * (TILE + NAME_H) + 8;
  if (view.legendary) { // the legendary slot, under the 12
    label(g, 'Legendary', PAD, iy + 16);
    await itemTile(g, view.legendary, LEGENDARY, PAD, iy + 32, null, 0, { enhanced: !!view.enhanced?.includes(view.legendary) });
    iy += LEGEND_H;
  }

  // ---- the ability bar: a dark panel with a green top edge; per ability the three upgrade pips, a white disc with its glyph, its name ----
  const aTop = iy + 8;
  const aH = H - aTop - 24;
  g.save();
  g.beginPath();
  g.roundRect(PAD, aTop, W - 2 * PAD, aH, 16);
  g.clip();
  g.fillStyle = '#272c29';
  g.fillRect(PAD, aTop, W - 2 * PAD, aH);
  g.fillStyle = READY;
  g.fillRect(PAD, aTop, W - 2 * PAD, 5);
  g.restore();
  const colW = (W - 2 * PAD) / view.abilities.length;
  for (const [i, a] of view.abilities.entries()) {
    const cx = PAD + colW * i + colW / 2;
    // pips: the dearest tier on top, like the game (5, 2, 1 points)
    for (let t = MAX_TIER; t >= 1; t--) {
      const y = aTop + 20 + (MAX_TIER - t) * 23;
      const bought = !a.locked && a.tier >= t;
      box(g, cx - 62, y, 124, 18, 9, bought ? '#dff0c0' : '#1a1e1c');
      g.textAlign = 'center';
      g.font = FONT(12);
      g.fillStyle = bought ? '#1f2a12' : 'rgba(255,255,255,0.35)';
      g.fillText(`${TIER_COSTS[t - 1]}`, cx + 6, y + 13);
      g.save(); // the little diamond before the cost
      g.translate(cx - 8, y + 9);
      g.rotate(Math.PI / 4);
      g.fillRect(-3, -3, 6, 6);
      g.restore();
    }
    const cy = aTop + 132;
    g.beginPath();
    g.arc(cx, cy, 40, 0, Math.PI * 2);
    g.fillStyle = a.locked ? 'rgba(255,255,255,0.14)' : '#f4f4f4';
    g.fill();
    try {
      const size = a.locked ? 34 : 56;
      const glyph = a.locked ? await tinted(path.join(UI, 'lock.svg'), 'rgba(255,255,255,0.5)', size) : await tinted(path.join(ASSETS, 'trivia', 'abilities', `${slug(a.name)}.png`), '#141414', size);
      g.drawImage(glyph, cx - size / 2, cy - size / 2);
    } catch { /* no glyph for it */ }
    g.fillStyle = a.locked ? 'rgba(255,255,255,0.4)' : '#fff';
    fit(g, a.name, cx, cy + 78, colW - 16, 15);
    if (a.locked) {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.font = FONT(12);
      g.fillText(`Unlocks at level ${unlockLevel(a.slot)}`, cx, cy + 94);
    }
    g.textAlign = 'left';
  }

  if (!textures.has(H)) textures.set(H, grain(W, H, 53, 90));
  grainAndVignette(g, W, H, textures.get(H), { grainAlpha: 0.3, inner: 300, outer: 640, dark: 0.5 });
  return jpeg(c);
}

module.exports = { heroCard };
