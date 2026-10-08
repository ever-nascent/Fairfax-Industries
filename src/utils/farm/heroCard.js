// The picture on the hero screen (/hero, or the Hero button on /base), drawn after the in-game HUD (his call, Oct 3: "it looks a lot better than
// ours"): the level badge with its ring and the souls, the three stat groups under their emblems (weapon orange, vitality green, spirit purple),
// the items as the HUD shows them (the item's own picture with its tier numeral in the corner, 2 x 2 per kind = the HUD's 6 x 2 grid), and the ability bar: white discs with
// the ability glyphs, numbered 1-4, with the three upgrade pips above each. Art: assets/farm/ui and assets/farm/items (the game's own icons from
// deadlock-api.com, see assets/CREDITS.txt), ability glyphs from assets/trivia/abilities.
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { ASSETS, loadSouls, drawSouls, halftone, grain, grainAndVignette } = require('../art');
const { SOULS, FONT, image, label } = require('./roamCard');
const { MAX_TIER, TIER_COSTS, SLOTS, MAX_ITEMS, unlockLevel } = require('./levels');
const { itemByName } = require('./stats');
const { itemFile } = require('./itemArt');
const { fmt } = require('../format');

const W = 800;
const H = 960; // room under the ability names for "Unlocks at level N"
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
  weapon: [['Bullet Damage'], ['Fire Rate', 'stat-fire-rate'], ['Ammo', 'stat-ammo'], ['Lifesteal', 'stat-lifesteal']],
  vitality: [['Health'], ['Movement Speed', 'stat-move-speed'], ['Health Regen', 'stat-health-regen'], ['Spirit Armor', 'stat-spirit-resist'], ['Bullet Armor', 'stat-bullet-resist']],
  spirit: [['Spirit Power'], ['Ability Cooldown', 'stat-cooldown'], ['Ability Range', 'stat-range'], ['Ability Duration', 'stat-duration']],
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']; // V: a legendary
const CORRUPTED = '#b44dff'; // the frame of the hero's corrupted item (ponytail: my pick of colour)

let texture;

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

// view: { hero, progress, pointsLeft, abilities: [{ slot, name, tier, locked }], stats: { label: text }, items: { weapon: [names], vitality: [...], spirit: [...] }, souls, corrupted: item name | undefined }
async function heroCard(view) {
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
  g.fillText(p.max ? 'MAX LEVEL' : `${fmt(Math.round(p.needed - p.into))} TO NEXT`, bx + 66, 62);
  drawSouls(g, souls, bx + 66, 76, 40);
  g.font = '44px Radiance';
  g.fillStyle = SOULS;
  const amount = fmt(view.souls);
  g.fillText(amount, bx + 96, 112);
  const amountW = g.measureText(amount).width;
  g.font = FONT(14);
  g.fillStyle = 'rgba(171,255,227,0.6)';
  g.fillText('YOUR SOULS', bx + 106 + amountW, 110);
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
  g.textAlign = 'left';

  // ---- stats: a column per kind under its emblem, the big number first ----
  const sTop = 156;
  const sGap = 14;
  const sw = (W - 2 * PAD - 2 * sGap) / SLOTS.length;
  const sh = 200;
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
  const TILE = 100, NAME_H = 32;
  const COLS = MAX_ITEMS / 2;
  const colGap = (W - 2 * PAD - COLS * TILE) / (COLS - 1);
  const held = SLOTS.flatMap((slot) => view.items[slot].map((name) => [name, KIND[slot]]));
  g.textAlign = 'right';
  g.font = FONT(14);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillText(`${held.length} / ${MAX_ITEMS}`, W - PAD, iy - 4);
  g.textAlign = 'left';
  {
    for (let i = 0; i < MAX_ITEMS; i++) {
      const x = PAD + (i % COLS) * (TILE + colGap);
      const y = iy + Math.floor(i / COLS) * (TILE + NAME_H);
      const [name, kind] = held[i] ?? [];
      if (!name) { box(g, x, y, TILE, TILE, 12, 'rgba(255,255,255,0.035)', 'rgba(255,255,255,0.12)'); continue; }
      // the item's own picture (the game's shop art, as the HUD shows it), with a glow in its kind's colour; a flat tile with the
      // HUD glyph only when that picture is missing
      let art = null;
      try { art = await image(itemFile(name)); } catch { /* no shop art for it */ }
      g.save();
      g.shadowColor = `rgba(${kind.rgb},0.45)`;
      g.shadowBlur = 14;
      const fill = g.createLinearGradient(x, y, x, y + TILE);
      fill.addColorStop(0, kind.tile[0]);
      fill.addColorStop(1, kind.tile[1]);
      box(g, x, y, TILE, TILE, 12, fill);
      g.restore();
      g.save();
      g.beginPath();
      g.roundRect(x, y, TILE, TILE, 12);
      g.clip();
      if (art) g.drawImage(art, x, y, TILE, TILE);
      else { try { g.drawImage(await tinted(path.join(ASSETS, 'farm', 'items', `${slug(name)}.png`), kind.ink, 72), x + 14, y + 16); } catch { /* the name under the tile says what it is */ } }
      g.restore();
      box(g, x, y, TILE, TILE, 12, null, name === view.corrupted ? CORRUPTED : `rgba(${kind.rgb},0.9)`, name === view.corrupted ? 4 : 2); // the corrupted one: a violet frame
      // the tier, on a dark tab in the corner
      const tier = ROMAN[itemByName(name)?.Tier ?? 0];
      if (tier) {
        g.beginPath();
        g.roundRect(x + TILE - 30, y, 30, 22, [0, 12, 0, 10]);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fill();
        g.textAlign = 'center';
        g.fillStyle = '#fff';
        g.font = FONT(13);
        g.fillText(tier, x + TILE - 15, y + 16);
      }
      // the name under the tile, on one or two lines
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = FONT(12);
      const words = name.split(' ');
      const lines = words.length > 1 && g.measureText(name).width > TILE + 6 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name];
      lines.forEach((line, k) => fit(g, line, x + TILE / 2, y + TILE + 14 + k * 13, TILE + 8, 12));
    }
    g.textAlign = 'left';
  }
  iy += 2 * (TILE + NAME_H) + 8;

  // ---- the ability bar: a dark panel with a green top edge; per ability the three upgrade pips, a white disc with its glyph, its number and name ----
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
    box(g, cx - 12, cy + 34, 24, 22, 5, a.locked ? 'rgba(255,255,255,0.25)' : '#e9e9e9');
    g.fillStyle = '#141414';
    g.font = FONT(14);
    g.fillText(`${a.slot}`, cx, cy + 50);
    g.fillStyle = a.locked ? 'rgba(255,255,255,0.4)' : '#fff';
    fit(g, a.name, cx, cy + 78, colW - 16, 15);
    if (a.locked) {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.font = FONT(12);
      g.fillText(`Unlocks at level ${unlockLevel(a.slot)}`, cx, cy + 94);
    }
    g.textAlign = 'left';
  }

  texture ??= grain(W, H, 53, 90);
  grainAndVignette(g, W, H, texture, { grainAlpha: 0.3, inner: 300, outer: 640, dark: 0.5 });
  return c.toBuffer('image/png');
}

module.exports = { heroCard };
