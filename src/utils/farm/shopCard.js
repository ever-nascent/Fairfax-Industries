// The item shop picture (/base dropdown "Item Shop", or Item Shop on the hero screen), drawn like the in-game shop (his call, Oct 3): the game's own
// tab art (Weapon "Fairfax", Vitality "MPS", Spirit "Curiosity Catalog") with its four tier boxes, the items as the game's shop cards (card back per
// kind and tier, the item's shop picture, its name, ACTIVE / IMBUE tags), the tier prices on the dark plates, and the three tabs down the left side.
// On top of the game's look: what the member owns, can upgrade, or can't afford. The Broker and Sell tabs have no art in the game, so they are drawn
// as one dark page of cards with a price under each. Art: assets/farm/shop (the game's, from deadlock-api.com's asset bucket, see assets/CREDITS.txt)
// and the item pictures (itemArt.js). Layout numbers are measured on the art (912 px wide copies), and match deadlock-ui's shop panel grid.
const path = require('node:path');
const fs = require('node:fs');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { ASSETS } = require('../art'); // (also registers the Retail font)
const { image } = require('./roamCard');
const { itemByName } = require('./stats');
const { itemFile } = require('./itemArt');
const { fmt } = require('../format');

const DIR = path.join(ASSETS, 'farm', 'shop');
// The script lettering of the shop's name on the background (his call, Oct 3). ponytail: Windows' Gabriola for now; a font file in assets/fonts is the real
// home (the VPS has no Windows fonts), the first one found wins and a missing font falls back to the plain bold lettering.
const SCRIPT_FILES = [path.join(ASSETS, 'fonts', 'script.ttf'), path.join(ASSETS, 'fonts', 'script.otf'), 'C:/Windows/Fonts/Gabriola.ttf'];
const scriptFile = SCRIPT_FILES.find((f) => fs.existsSync(f));
if (scriptFile) GlobalFonts.registerFromPath(scriptFile, 'ShopScript');
const SCRIPT = scriptFile ? 'ShopScript' : 'sans-serif';
const K = 1.5; // the art is measured at 912 px wide; drawn at 1368
const BG_W = 912 * K, BG_H = 809 * K;
const TABS_W = 96; // the tab strip left of the page
const W = TABS_W + BG_W;
const RETAIL = (px) => `${px}px Retail`;
// Retail draws some punctuation (- ' : /) as a souls glyph, so anything but letters, digits, spaces and commas is drawn in a plain bold font.
const runs = (text) => text.match(/[A-Za-z0-9 ,]+|[^A-Za-z0-9 ,]+/g) ?? [];
const fontFor = (run, px) => (/^[A-Za-z0-9 ,]+$/.test(run) ? RETAIL(px) : `bold ${Math.round(px * 0.9)}px sans-serif`);
function measure(g, text, px) { return runs(text).reduce((w, r) => { g.font = fontFor(r, px); return w + g.measureText(r).width; }, 0); }
// Writes `text` in Retail at (x, y), centred when `center`.
function write(g, text, x, y, px, center = true) {
  let at = center ? x - measure(g, text, px) / 2 : x;
  g.textAlign = 'left';
  for (const r of runs(text)) { g.font = fontFor(r, px); g.fillText(r, at, y); at += g.measureText(r).width; }
}
const TAB_COLOR = { weapon: '#e4b20c', vitality: '#a5ce3c', spirit: '#b866de' };
const NAME_DARK = { weapon: '#e4c5a1', vitality: '#c2e7cd', spirit: '#e3d4f2' }; // a tier 4 card's name, on its dark back
const PRICE = 'rgb(107,166,128)';
const TIER_PRICE = { 1: 800, 2: 1600, 3: 3200, 4: 6400 };
const CORRUPTED = '#b44dff';
// Each tier's box [x0, y0, x1, y1], its price plate's centre, and the cards per row (deadlock-ui's grid). Vitality and Spirit share one layout.
const LAYOUT = {
  weapon: {
    1: { box: [30, 120, 410, 392], plate: [61, 140], cols: 5 }, 2: { box: [428, 18, 882, 392], plate: [470, 31], cols: 6 },
    3: { box: [25, 420, 555, 790], plate: [77, 430], cols: 7 }, 4: { box: [567, 420, 885, 790], plate: [628, 423], cols: 4 },
  },
  other: {
    1: { box: [33, 122, 415, 392], plate: [62, 141], cols: 5 }, 2: { box: [432, 18, 886, 395], plate: [469, 32], cols: 6 },
    3: { box: [30, 420, 420, 790], plate: [76, 427], cols: 5 }, 4: { box: [430, 420, 888, 792], plate: [478, 422], cols: 6 },
  },
};
const ASPECT = 128 / 82; // a shop card's height over its width

// The ribbon (his call, Oct 3): across the middle of a card, a dark one reading OWNED on the greyed cards you have, a solid one in the tab's colour
// reading UPGRADE on the glowing ones, with a diamond at each end. `size` is half a card's width; a small one (the legend's) has no word.
function badge(g, cx, cy, size, color, label = 'OWNED') {
  const solid = label === 'UPGRADE' || label === 'CORRUPT', w = size * (solid || label === 'CORRUPTED' ? 1.9 : 1.6), h = size * 0.36, notch = h * 0.35;
  const ink = '#1a140e';
  g.save();
  g.lineJoin = 'miter';
  g.fillStyle = solid ? color : 'rgba(20,15,10,0.9)';
  g.beginPath();
  g.moveTo(cx - w / 2, cy - h / 2); g.lineTo(cx + w / 2, cy - h / 2); g.lineTo(cx + w / 2 - notch, cy);
  g.lineTo(cx + w / 2, cy + h / 2); g.lineTo(cx - w / 2, cy + h / 2); g.lineTo(cx - w / 2 + notch, cy);
  g.closePath();
  if (solid) { g.shadowColor = color; g.shadowBlur = size * 0.2; }
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = solid ? ink : color; g.lineWidth = Math.max(1.5, size * 0.035); g.stroke();
  g.fillStyle = solid ? ink : color;
  for (const d of [-1, 1]) { g.save(); g.translate(cx + d * (w / 2 - h * 0.62), cy); g.rotate(Math.PI / 4); g.fillRect(-h * 0.1, -h * 0.1, h * 0.2, h * 0.2); g.restore(); }
  if (h >= 20) write(g, label, cx, cy + h * 0.22, Math.round(h * 0.62));
  g.restore();
}

// One shop card at (x, y), `w` wide: the game's card back and picture and name, then our marks. state: { owned, inside, upgrade, poor, corrupted, picked, glow, ribbon, note }.
async function card(g, name, x, y, w, state = {}) {
  const c = itemByName(name);
  const kind = { Weapon: 'weapon', Armor: 'vitality', Tech: 'spirit' }[c.Slot];
  const tier = Math.min(4, c.Tier);
  const h = w * ASPECT;
  g.save();
  if (state.poor && !state.picked) g.globalAlpha = 0.45;
  const glowing = (color) => { // the game makes an upgradeable item glow: a soft light around the card in its tab's colour, no label
    g.save();
    g.shadowColor = color;
    g.shadowBlur = w * 0.26;
    g.fillStyle = '#1a140e';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(x, y, w, h, 5); g.fill(); }
    g.restore();
  };
  const lit = state.glow ?? (state.upgrade && !state.owned ? TAB_COLOR[kind] : null); // the light round a card that can be acted on
  if (lit) glowing(lit);
  else if (state.corrupted) glowing(CORRUPTED);
  g.beginPath();
  g.roundRect(x, y, w, h, 5);
  g.clip();
  const back = await image(path.join(DIR, `card_${kind}_t${tier}.png`));
  const k = Math.max(w / back.width, h / back.height); // object-fit: cover
  g.drawImage(back, x + (w - back.width * k) / 2, y + (h - back.height * k) / 2, back.width * k, back.height * k);
  try { g.drawImage(await image(itemFile(name)), x, y, w, w); } catch { /* no picture: the name says what it is */ }
  // the name, in the bottom 36%, dark on light backs and light on the dark tier 4 back
  g.fillStyle = tier >= 4 ? NAME_DARK[kind] : '#1a1510';
  const words = name.split(' ');
  let px = Math.round(w * (name.length > 24 ? 0.135 : name.length > 19 ? 0.15 : name.length > 14 ? 0.16 : 0.175));
  const lines = measure(g, name, px) > w * 0.9 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name];
  while (px > 8 && lines.some((l) => measure(g, l, px) > w * 0.94)) px--;
  const mid = y + w + (h - w) / 2;
  lines.forEach((l, i) => write(g, l, x + w / 2, mid + px * 0.35 + (i - (lines.length - 1) / 2) * px * 0.95, px));
  g.textAlign = 'center';
  // ACTIVE / IMBUE, where the game puts them (just above the name)
  const tag = (text, bg, fg, full) => {
    g.font = `bold ${Math.round(w * 0.11)}px sans-serif`;
    const tw = full ? w : Math.max(w * 0.6, g.measureText(text).width + 8);
    const th = w * 0.15;
    g.fillStyle = bg;
    g.beginPath(); g.roundRect(x + (w - tw) / 2, y + w - th, tw, th, 2); g.fill();
    g.fillStyle = fg;
    g.fillText(text, x + w / 2, y + w - th * 0.25);
  };
  if (c.IsImbue) tag('IMBUE', '#5a3a8a', '#d4b8f0', true);
  else if (c.Activation !== 'Passive') tag('ACTIVE', '#181818', 'rgba(255,239,215,0.9)');
  if (state.owned || state.inside) { // already yours: drained of colour and darkened
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = 'rgb(128,128,128)';
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(16,12,9,0.38)';
    g.fillRect(x, y, w, h);
  }
  g.restore();
  // our marks: an OWNED ribbon on what you own (on top of the greying), the rim of an upgrade, the tag of a corrupted card
  if (state.owned) badge(g, x + w / 2, y + w * 0.46, w / 2, TAB_COLOR[kind], 'OWNED');
  if (lit) { // a thin light rim on the glowing card, and its ribbon
    g.lineWidth = 2;
    g.strokeStyle = lit;
    g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, h - 2, 5); g.stroke();
    badge(g, x + w / 2, y + w * 0.46, w / 2, lit, state.ribbon ?? 'UPGRADE');
  }
  if (state.corrupted) {
    g.font = `bold ${Math.round(w * 0.11)}px sans-serif`;
    const tw = g.measureText('CORRUPTED').width + 10;
    g.fillStyle = CORRUPTED;
    g.beginPath(); g.roundRect(x + (w - tw) / 2, y - w * 0.07, tw, w * 0.15, 3); g.fill();
    g.fillStyle = '#111';
    g.textAlign = 'center';
    g.fillText('CORRUPTED', x + w / 2, y + w * 0.045);
  }
  if (state.note) { // under the card (Broker and Sell pages): a price or a drawback
    g.fillStyle = state.noteColor ?? PRICE;
    const px = Math.round(w * 0.17);
    const lines = [];
    for (const para of state.note.split('\n')) { // wrapped to the card's width (a drawback can be long)
      let line = '';
      for (const word of para.split(' ')) {
        if (line && measure(g, `${line} ${word}`, px) > w * 1.15) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
      }
      lines.push(line);
    }
    lines.slice(0, 3).forEach((l, i) => write(g, l, x + w / 2, y + h + w * 0.2 + i * w * 0.19, px));
  }
  return h;
}

// The price on a tier's plate, tilted like the game's, with the souls glyph.
async function price(g, amount, cx, cy, px, local = false) {
  const glyph = await image(path.join(DIR, 'price_souls.png'));
  g.save();
  g.translate(cx, cy);
  if (!local) g.rotate((-5 * Math.PI) / 180);
  g.font = RETAIL(px);
  const text = fmt(amount);
  const gw = px * 0.78 * (glyph.width / glyph.height);
  const tw = gw + px * 0.25 + g.measureText(text).width;
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowBlur = 3;
  g.drawImage(glyph, -tw / 2, -px * 0.62, gw, px * 0.78);
  g.fillStyle = PRICE;
  g.textAlign = 'left';
  g.fillText(text, -tw / 2 + gw + px * 0.25, px * 0.3);
  g.restore();
}

// The three tabs down the left, the open one long, in the game's colours with its icons.
async function tabs(g, open) {
  const shape = await image(path.join(DIR, 'tab_shape.png'));
  const edge = await image(path.join(DIR, 'tab_edge.png'));
  let y = 16;
  for (const kind of ['weapon', 'vitality', 'spirit']) {
    const h = kind === open ? 210 : 88;
    const w = TABS_W - 8;
    const t = createCanvas(w, h);
    const tg = t.getContext('2d');
    tg.drawImage(shape, 0, 0, w, Math.max(h, (shape.height * w) / shape.width));
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = TAB_COLOR[kind];
    tg.fillRect(0, 0, w, h);
    tg.globalCompositeOperation = 'source-over';
    tg.globalAlpha = 0.6;
    tg.drawImage(edge, 0, h - (edge.height * w) / edge.width, w, (edge.height * w) / edge.width);
    g.save();
    if (kind !== open) g.globalAlpha = 0.75;
    g.drawImage(t, 8, y);
    g.drawImage(await image(path.join(DIR, `tab_icon_${kind}.png`)), 8 + (w - 66) / 2 - 4, y + (h - 66) / 2, 66, 66);
    g.restore();
    y += h + 10;
  }
}

// The page header (his call, Oct 3: its parts have to interact): one band cut into three zones by slanted dividers that catch the tier's light,
// each zone tinted differently and all sitting on the same lit bottom edge: the tier (title, pips strung on a line), the kind on show (icon, name, how
// many are yours) and the price. Even tiers run the other way round. The game's own "TIER n" title sits under it, so ours replaces it.
// The whole header is in the tab's colour (his call, Oct 3); each tier is a shade of it, Tier 1 the palest and Tier 4 the full colour, and the bottom
// edge gets one more line per tier.
const PALE = { 1: 0.6, 2: 0.38, 3: 0.16, 4: 0 }; // how much white each tier's shade has
const shade = (hex, white) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - white) + 255 * white).toString(16).padStart(2, '0')).join('');
// The band itself: three zones (left, middle, right) cut by slanted dividers, a lit bottom edge with `lines` lines, and whatever each zone draws
// (spec.left / mid / right: async (g, x, width) => draws from x). `order` is the zone order; the left and right zones are tinted, the middle is dark.
async function band(g, { accent, glow, lines, flip = false, widths = { left: 310, mid: 540 }, left, mid, right }) {
  const x0 = TABS_W, R = x0 + BG_W, H = 128, SK = 22;
  const order = flip ? ['right', 'mid', 'left'] : ['left', 'mid', 'right'];
  const edges = [x0]; // where each zone starts; the last one runs to the right end
  for (const z of order.slice(0, 2)) edges.push(edges.at(-1) + (z === 'right' ? widths.right ?? 440 : widths[z]));
  edges.push(R);
  const zone = (i) => { // a zone's slanted outline
    const l = edges[i], r = edges[i + 1];
    g.beginPath();
    g.moveTo(i ? l + SK : l, 0); g.lineTo(i < 2 ? r + SK : r, 0); g.lineTo(i < 2 ? r - SK : r, H); g.lineTo(i ? l - SK : l, H);
    g.closePath();
  };
  const tint = { left: glow, mid: null, right: accent };
  for (const [i, z] of order.entries()) {
    zone(i);
    g.fillStyle = 'rgba(14,11,9,0.93)';
    g.fill();
    if (tint[z]) { // the outer zones are lit from the bottom in their colour
      const lit = g.createLinearGradient(0, H, 0, 0);
      lit.addColorStop(0, tint[z] + '55');
      lit.addColorStop(1, tint[z] + '00');
      zone(i); g.fillStyle = lit; g.fill();
    }
  }
  for (const i of [1, 2]) { // the dividers catch the light
    g.save();
    g.shadowColor = glow; g.shadowBlur = 8;
    g.strokeStyle = glow; g.lineWidth = 3;
    g.beginPath(); g.moveTo(edges[i] + SK, 0); g.lineTo(edges[i] - SK, H); g.stroke();
    g.restore();
  }
  // the bottom edge: the accent colour, one more line per step, running under all three zones
  g.save();
  g.shadowColor = glow;
  g.shadowBlur = lines >= 4 ? 22 : lines * 4;
  g.fillStyle = accent;
  g.fillRect(x0, H - 6, BG_W, 6);
  g.fillStyle = glow;
  for (let i = 0; i < lines - 1; i++) g.fillRect(x0, H - 12 - i * 6, BG_W, 2);
  g.restore();
  const draw = { left, mid, right };
  for (const [i, z] of order.entries()) {
    const zx = edges[i] + (i ? SK : 0), zw = edges[i + 1] - edges[i];
    await draw[z](g, zx + (i ? 26 : 36), zw);
  }
}

// The shop's header: the tier (title, pips strung on a line), the kind on show (icon, name, how many are yours) and the price, in the tab's colour.
async function header(g, kind, tier, info) {
  const accent = TAB_COLOR[kind], glow = shade(accent, PALE[tier]);
  await band(g, {
    accent, glow, lines: tier, flip: tier % 2 === 0,
    async left(g, tx) {
      g.fillStyle = glow;
      write(g, `TIER ${tier}`, tx, 66, 60, false);
      g.strokeStyle = glow; g.globalAlpha = 0.5; g.lineWidth = 2;
      g.beginPath(); g.moveTo(tx, 94); g.lineTo(tx + 3 * 32 + 60, 94); g.stroke();
      g.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(tx + 10 + i * 32, 94);
        g.rotate(Math.PI / 4);
        g.beginPath(); g.rect(-8, -8, 16, 16);
        if (i < tier) { g.shadowColor = glow; g.shadowBlur = 10; g.fillStyle = glow; g.fill(); } else { g.fillStyle = '#16120f'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.45)'; g.stroke(); }
        g.restore();
      }
    },
    async mid(g, kx) {
      const ico = createCanvas(64, 64);
      const ig = ico.getContext('2d');
      ig.drawImage(await image(path.join(DIR, `tab_icon_${kind}.png`)), 0, 0, 64, 64);
      ig.globalCompositeOperation = 'source-in';
      ig.fillStyle = accent;
      ig.fillRect(0, 0, 64, 64);
      g.drawImage(ico, kx, 8, 60, 60);
      g.fillStyle = accent;
      write(g, `${kind.toUpperCase()} ITEMS`, kx + 76, 56, 52, false);
      g.fillStyle = 'rgba(230,220,205,0.85)';
      write(g, `${info.count} Items, ${info.owned} Owned`, kx + 2, 98, 28, false);
    },
    async right(g, rx, zw) { // what every item on the page costs
      const px = rx - 26 + (zw - 280) / 2;
      g.fillStyle = 'rgba(230,220,205,0.8)';
      write(g, 'EACH ITEM', px, 40, 26, false);
      await price(g, TIER_PRICE[tier], px + 120, 88, 56, true);
    },
  });
}

// Faint stamps behind the cards (his call, Oct 3: wording and Deadlock symbols in the background): the tab's own name big across the page,
// the shop's name, and scattered symbols from the game's UI (the tab's icon, the souls glyph, map icons), all in one flat ink. Placed from the
// kind and tier so every page differs but never changes between draws. Dark ink on the light tiers, light ink on the dark ones.
const BACKDROP = false; // off for now (his call, Oct 3); set true to bring the words and symbols back
const BRAND = { weapon: 'FAIRFAX', vitality: 'MPS', spirit: 'CURIOSITY CATALOG' };
const STAMPS = ['walker', 'shrine', 'guardian', 'patron', 'mid-boss', 'base-guardian', 'golden-statue', 'trooper', 'trooper-melee', 'unlock-token', 'patron-weakened']; // the icons with see-through backgrounds (a crate's is a solid square)
async function backdrop(g, kind, tier) {
  const px = g.getImageData(TABS_W + 100, 160, BG_W - 200, PAGE_H - 260).data; // dark ink on a light page, light ink on a dark one
  let lum = 0;
  for (let i = 0; i < px.length; i += 4 * 97) lum += (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
  const ink = lum / (px.length / (4 * 97)) > 0.33 ? '30,18,6' : '255,245,230';
  let seed = ['weapon', 'vitality', 'spirit'].indexOf(kind) * 7 + tier * 13 + 5;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const stamp = async (file, cx, cy, size, angle, alpha) => { // one picture as a flat silhouette
    const img = await image(file);
    const t = createCanvas(size, size);
    const tg = t.getContext('2d');
    const k = Math.min(size / img.width, size / img.height);
    tg.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = `rgba(${ink},${alpha})`;
    tg.fillRect(0, 0, size, size);
    g.save(); g.translate(cx, cy); g.rotate(angle); g.drawImage(t, -size / 2, -size / 2); g.restore();
  };
  const words = (text, cx, cy, px, angle, alpha) => {
    g.save(); g.translate(cx, cy); g.rotate(angle); g.fillStyle = `rgba(${ink},${alpha})`; write(g, text, 0, 0, px); g.restore();
  };
  const side = (text, cx, max, alpha) => { // a word running up a side margin, as big as fits
    let px = 150;
    while (px > 24 && measure(g, text, px) > max) px -= 2;
    words(text, cx, 560, px, -Math.PI / 2, alpha);
  };
  side(BRAND[kind], TABS_W + 62, 700, 0.2);
  { // the shop's name in script, running up the right margin as big as fits
    let px = 170;
    g.font = `${px}px ${SCRIPT}`;
    while (px > 30 && (g.font = `${px}px ${SCRIPT}`, g.measureText('The Curiosity Shop').width) > 560) px -= 2;
    g.save(); g.translate(TABS_W + BG_W - 52, 430); g.rotate(-Math.PI / 2); g.fillStyle = `rgba(${ink},0.3)`; g.textAlign = 'center'; g.fillText('The Curiosity Shop', 0, 0); g.restore();
  }
  // a few stamps, one per cell of a wide even grid, each nudged a little off-centre: spread out, not crowded
  const COLS = 4, ROWS = 3, area = { x: TABS_W + 30, y: 140, w: BG_W - 60, h: PAGE_H - 170 };
  for (let n = 0; n < COLS * ROWS; n++) {
    const [cx, cy] = [n % COLS, Math.floor(n / COLS)];
    const glyph = n % 4 === 0 ? path.join(DIR, 'price_souls.png') : path.join(ASSETS, 'farm', 'icons', `${STAMPS[Math.floor(rnd() * STAMPS.length)]}.png`);
    await stamp(glyph, area.x + (cx + 0.5 + (rnd() - 0.5) * 0.4) * (area.w / COLS), area.y + (cy + 0.5 + (rnd() - 0.5) * 0.4) * (area.h / ROWS), 72 + rnd() * 40, (rnd() - 0.5) * 1.2, 0.17);
  }
}

// A kind's tab, one tier at a time (his call, Oct 3: the whole page was too small to read): that tier's box of the game's tab art, filling the page,
// its price plate, and its items as big shop cards. view: { kind, tier, names: [that kind's items], state(name) -> card state }.
const PAGE_H = 980;
async function shopTab({ kind, tier, names, state }) {
  const c = createCanvas(W, PAGE_H);
  const g = c.getContext('2d');
  g.fillStyle = '#16120f';
  g.fillRect(0, 0, W, PAGE_H);
  await tabs(g, kind);
  // the tier's own box of the art (the art is 1825 px wide, the boxes are measured at 912), cropped to fill the page
  const art = await image(path.join(DIR, `bg_${kind}.webp`));
  const [x0, y0, x1, y1] = LAYOUT[kind === 'weapon' ? 'weapon' : 'other'][tier].box.map((v) => (v * art.width) / 912);
  const bw = x1 - x0;
  // the art prints its own "TIER 1" at the top of the box (our price plate would half-cover it), so start below it
  const below = (v) => v + 100 / Math.max(BG_W / bw, PAGE_H / (y1 - v));
  const y0b = below(y0), bh = y1 - y0b;
  const k = Math.max(BG_W / bw, PAGE_H / bh);
  const sw = BG_W / k, sh = PAGE_H / k;
  g.drawImage(art, x0 + (bw - sw) / 2, y0b + (bh - sh) / 2, sw, sh, TABS_W, 0, BG_W, PAGE_H);
  if (BACKDROP) await backdrop(g, kind, tier);
  const onShow = names.filter((n) => Math.min(4, itemByName(n).Tier) === tier);
  await header(g, kind, tier, { count: onShow.length, owned: onShow.filter((n) => state(n).owned).length });
  // the cards, as big as fit
  const list = names.filter((n) => Math.min(4, itemByName(n).Tier) === tier);
  const area = { x: TABS_W + 150, y: 150, w: BG_W - 300, h: PAGE_H - 190 }; // wide side margins, so a full tier doesn't run edge to edge
  const gap = 16;
  let best = { w: 0, cols: 1 };
  for (let cols = 1; cols <= list.length; cols++) {
    const rows = Math.ceil(list.length / cols);
    const w = Math.min((area.w - gap * (cols - 1)) / cols, (area.h - gap * (rows - 1)) / rows / ASPECT, 200);
    if (w > best.w) best = { w, cols };
  }
  const { w, cols } = best;
  const rows = Math.ceil(list.length / cols);
  const left = area.x + (area.w - (cols * w + (cols - 1) * gap)) / 2;
  const top = area.y + (area.h - (rows * w * ASPECT + (rows - 1) * gap)) / 2;
  for (const [i, name] of list.entries()) await card(g, name, left + (i % cols) * (w + gap), top + Math.floor(i / cols) * (w * ASPECT + gap), w, state(name));
  return c.toBuffer('image/png');
}

// The Broker page (his call, Oct 3), drawn from a picture of his shop: black street, a rose-lit interior, the pink neon OPEN sign, his fedora silhouette
// and the green eye on the counter. The same header band as the shop, in neon pink with the eye as its mark; the sign says OPEN or CLOSED with the
// time left, and the items he can corrupt are lit pink with a CORRUPT ribbon and their price under them.
// view: { open, timer: 'time left or until he opens', cards: [{ name, state }], empty }.
const BROKER = '#ff4f8b';
const EYE = '#4dffb6';
// The Broker's sigil, copied from the one glowing on his counter: an almond eye inside a second almond, a ringed iris and a pupil, a dot at each
// corner, a pair of rays with a bar across them above and below, and specks around it. One colour, round ends.
function emblem(g, cx, cy, L, color, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color; g.fillStyle = color;
  g.lineWidth = Math.max(1.6, L * 0.032); g.lineCap = 'round'; g.lineJoin = 'round';
  const almond = (half, bulge) => { g.beginPath(); g.moveTo(cx - half, cy); g.quadraticCurveTo(cx, cy - bulge, cx + half, cy); g.quadraticCurveTo(cx, cy + bulge, cx - half, cy); g.closePath(); g.stroke(); };
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(cx + x1 * L, cy + y1 * L); g.lineTo(cx + x2 * L, cy + y2 * L); g.stroke(); };
  const dot = (x, y, r) => { g.beginPath(); g.arc(cx + x * L, cy + y * L, r * L, 0, Math.PI * 2); g.fill(); };
  almond(L * 0.5, L * 0.42);
  almond(L * 0.39, L * 0.3);
  g.beginPath(); g.arc(cx, cy, L * 0.135, 0, Math.PI * 2); g.stroke();
  dot(0, 0, 0.042);
  dot(-0.5, 0, 0.032); dot(0.5, 0, 0.032);
  for (const v of [-1, 1]) { // above and below: two rays leaning together, and a bar across them
    line(-0.05, v * 0.36, -0.17, v * 0.17);
    line(0.05, v * 0.36, 0.17, v * 0.17);
    line(-0.34, v * 0.275, 0.34, v * 0.275);
  }
  if (L >= 120) for (const [x, y, r] of [[-0.42, -0.22, 0.022], [-0.24, -0.34, 0.014], [0.24, -0.34, 0.014], [0.43, -0.2, 0.022], [-0.44, 0.24, 0.016], [-0.3, 0.2, 0.014], [0.36, 0.2, 0.014], [0.44, 0.3, 0.016], [-0.36, -0.36, 0.01], [0.36, -0.37, 0.01]]) dot(x, y, r);
  g.restore();
}

// The Broker's shop, drawn after the picture of it (his call, Oct 3): the rose-lit room, the Broker as a dark figure against it (pinched fedora, pale
// eyes, a broad coat), his counter with the glowing sigil on its front, a dripping candle, a stack of books and a bottle. (x, y) is the top left and
// `u` the scene's width; it is 1.85 u tall.
function brokerScene(g, x, y, u) {
  const X = (v) => x + v * u, Y = (v) => y + v * u;
  const SHADE = '#3a0f22'; // the figure and what stands on the counter: dark maroon, as lit from behind
  g.save();
  g.beginPath(); g.roundRect(x, y, u, u * 1.85, u * 0.03); g.clip();
  // the room
  const wall = g.createLinearGradient(0, y, 0, Y(1.85));
  wall.addColorStop(0, '#8a3a5c'); wall.addColorStop(0.45, '#a3466c'); wall.addColorStop(1, '#6b2944');
  g.fillStyle = wall; g.fillRect(x, y, u, u * 1.85);
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(X(0), Y(0), u * 0.2, u * 1.2); // a shelf's pale side on the left
  g.fillStyle = 'rgba(255,255,255,0.045)'; g.fillRect(X(0.36), Y(0.02), u * 0.36, u * 0.26); // a poster behind him
  g.fillStyle = 'rgba(255,150,120,0.22)'; g.fillRect(X(0.86), Y(0), u * 0.035, u * 1.1); // the door frame on the right
  g.fillStyle = 'rgba(255,150,120,0.1)'; g.fillRect(X(0.9), Y(0), u * 0.1, u * 1.1);
  const haze = g.createRadialGradient(X(0.5), Y(0.5), 0, X(0.5), Y(0.5), u * 0.75);
  haze.addColorStop(0, 'rgba(255,150,190,0.3)'); haze.addColorStop(1, 'rgba(255,150,190,0)');
  g.fillStyle = haze; g.fillRect(x, y, u, u * 1.85);
  // the Broker
  g.fillStyle = SHADE;
  g.beginPath(); // coat: sloping shoulders, slim, arms at his sides
  g.moveTo(X(0.455), Y(0.425));
  g.bezierCurveTo(X(0.42), Y(0.44), X(0.375), Y(0.465), X(0.36), Y(0.52));
  g.bezierCurveTo(X(0.338), Y(0.6), X(0.325), Y(0.74), X(0.33), Y(1.02));
  g.lineTo(X(0.672), Y(1.02));
  g.bezierCurveTo(X(0.678), Y(0.74), X(0.662), Y(0.6), X(0.64), Y(0.52));
  g.bezierCurveTo(X(0.625), Y(0.465), X(0.575), Y(0.44), X(0.54), Y(0.425));
  g.closePath(); g.fill();
  g.fillRect(X(0.468), Y(0.385), u * 0.058, u * 0.06); // neck
  g.beginPath(); g.ellipse(X(0.497), Y(0.345), u * 0.054, u * 0.062, 0, 0, Math.PI * 2); g.fill(); // head
  g.save(); // the hat sits at a slant, tipped down to one side
  g.translate(X(0.497), Y(0.3)); g.rotate(-0.2); g.translate(-X(0.497), -Y(0.3));
  g.beginPath(); // its crown, pinched at the top
  g.moveTo(X(0.432), Y(0.298));
  g.bezierCurveTo(X(0.43), Y(0.25), X(0.445), Y(0.232), X(0.47), Y(0.232));
  g.quadraticCurveTo(X(0.497), Y(0.246), X(0.524), Y(0.232));
  g.bezierCurveTo(X(0.55), Y(0.232), X(0.566), Y(0.25), X(0.564), Y(0.298));
  g.closePath(); g.fill();
  g.beginPath(); // the brim, dipping at the front and lifting at the sides
  g.moveTo(X(0.385), Y(0.318));
  g.quadraticCurveTo(X(0.4), Y(0.288), X(0.44), Y(0.29));
  g.lineTo(X(0.556), Y(0.29));
  g.quadraticCurveTo(X(0.596), Y(0.288), X(0.612), Y(0.31));
  g.quadraticCurveTo(X(0.5), Y(0.338), X(0.385), Y(0.318));
  g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#e2b3c6'; // his eyes, pale under the brim
  for (const ex of [0.477, 0.517]) { g.beginPath(); g.arc(X(ex), Y(0.338), u * 0.0075, 0, Math.PI * 2); g.fill(); }
  // on the counter, behind its front edge: a bottle, an open book, a stack of books, the candle
  g.fillStyle = SHADE;
  g.beginPath(); g.roundRect(X(0.185), Y(0.79), u * 0.085, u * 0.24, u * 0.02); g.fill();
  g.fillRect(X(0.21), Y(0.755), u * 0.035, u * 0.05);
  g.fillStyle = '#4a3238';
  g.beginPath(); g.moveTo(X(0.24), Y(1.035)); g.lineTo(X(0.4), Y(1.0)); g.lineTo(X(0.42), Y(1.0)); g.lineTo(X(0.6), Y(1.035)); g.closePath(); g.fill(); // the open book
  g.fillStyle = '#3b2a2c';
  g.fillRect(X(0.66), Y(0.735), u * 0.2, u * 0.3);
  g.fillStyle = '#5b4640';
  for (const by of [0.735, 0.835, 0.935]) g.fillRect(X(0.66), Y(by), u * 0.2, u * 0.012);
  // the counter: its top in perspective, its grey front
  g.fillStyle = '#4f3f40';
  g.beginPath(); g.moveTo(X(0.2), Y(1.03)); g.lineTo(X(0.88), Y(1.03)); g.lineTo(X(0.97), Y(1.21)); g.lineTo(X(0.06), Y(1.21)); g.closePath(); g.fill();
  const front = g.createLinearGradient(0, Y(1.21), 0, Y(1.85));
  front.addColorStop(0, '#6f6460'); front.addColorStop(1, '#55494a');
  g.fillStyle = front; g.fillRect(X(0.06), Y(1.21), u * 0.91, u * 0.64);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(X(0), Y(1.21), u * 0.06, u * 0.64); // the side in shadow
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(X(0.06), Y(1.21), u * 0.91, u * 0.012);
  // the candle: tall, cream, with wax run down the counter's edge, and its flame
  g.fillStyle = '#e9ddb0';
  g.beginPath();
  g.moveTo(X(0.64), Y(0.72)); g.lineTo(X(0.662), Y(0.675)); g.lineTo(X(0.7), Y(0.72));
  g.lineTo(X(0.71), Y(1.06)); g.quadraticCurveTo(X(0.735), Y(1.12), X(0.725), Y(1.2)); g.lineTo(X(0.71), Y(1.2));
  g.quadraticCurveTo(X(0.7), Y(1.1), X(0.668), Y(1.085)); g.quadraticCurveTo(X(0.635), Y(1.07), X(0.632), Y(1.03));
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(X(0.685), Y(0.72), u * 0.02, u * 0.34);
  g.save(); g.shadowColor = '#ffd98a'; g.shadowBlur = u * 0.09; g.fillStyle = '#fff2c4';
  g.beginPath(); g.moveTo(X(0.662), Y(0.6)); g.quadraticCurveTo(X(0.69), Y(0.66), X(0.662), Y(0.682)); g.quadraticCurveTo(X(0.636), Y(0.66), X(0.662), Y(0.6)); g.fill(); g.restore();
  // the sigil on the counter's front, glowing
  g.save(); g.shadowColor = EYE; g.shadowBlur = u * 0.06; emblem(g, X(0.515), Y(1.5), u * 0.72, '#74e0b9'); g.restore();
  g.restore();
  // the doorway's edge: a thin line of the sign's light
  g.save(); g.shadowColor = BROKER; g.shadowBlur = 18; g.strokeStyle = 'rgba(255,120,165,0.9)'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(x, y, u, u * 1.85, u * 0.03); g.stroke(); g.restore();
}

async function brokerPage({ open, timer, cards, empty }) {
  const DOOR = 400; // the left of the page is his doorway; the cards stay to the right of it
  const rows = Math.max(1, Math.ceil(cards.length / 5)), cols = Math.max(1, Math.ceil(cards.length / rows)), gap = 24; // (rows of 5 at most, split evenly)
  const w = Math.min(200, (BG_W - DOOR - 60 - gap * (cols - 1)) / cols);
  const rowH = w * ASPECT + w * 0.8 + gap;
  const H = Math.max(820, 190 + rows * rowH + 80);
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const cx = TABS_W + DOOR + (BG_W - DOOR) / 2; // the middle of the shop floor, right of the doorway
  g.fillStyle = '#0b0408';
  g.fillRect(0, 0, W, H);
  // the rose light of the room, from low in the middle, and the roll-up shutter's faint slats
  const room = g.createRadialGradient(cx, H * 0.78, 0, cx, H * 0.78, H * 0.95);
  room.addColorStop(0, 'rgba(255,63,122,0.34)');
  room.addColorStop(0.6, 'rgba(120,20,60,0.14)');
  room.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = room;
  g.fillRect(TABS_W, 0, BG_W, H);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 134; y < H; y += 18) g.fillRect(TABS_W, y, BG_W, 6);
  g.strokeStyle = 'rgba(255,120,150,0.12)'; g.lineWidth = 3; // the rug under the counter
  for (const k of [1, 0.78]) { g.beginPath(); g.ellipse(cx, H - 110, 420 * k, 80 * k, 0, 0, Math.PI * 2); g.stroke(); }
  const u = Math.min(340, (H - 190) / 1.85); // his shop, in the doorway on the left, as big as the page allows
  brokerScene(g, TABS_W + 30 + (340 - u) / 2, 160 + (H - 190 - u * 1.85) / 2, u);
  await band(g, {
    accent: BROKER, glow: shade(BROKER, 0.2), lines: 4,
    async left(g, x) {
      g.fillStyle = shade(BROKER, 0.2);
      write(g, 'BROKER', x, 66, 60, false);
      g.fillStyle = 'rgba(230,220,205,0.85)';
      write(g, 'Corrupted Wares', x, 98, 28, false);
    },
    async mid(g, x) {
      g.save(); g.shadowColor = EYE; g.shadowBlur = 12; emblem(g, x + 36, 40, 68, EYE); g.restore();
      g.fillStyle = BROKER;
      write(g, 'CORRUPT AN ITEM', x + 86, 54, 42, false);
      g.fillStyle = 'rgba(230,220,205,0.85)';
      write(g, 'One Per Hero, For Its Price Again', x + 4, 98, 26, false);
    },
    async right(g, x, zw) { // the neon sign, and the time left
      const mid = x - 26 + zw / 2;
      g.save();
      g.font = '84px Retail';
      g.textAlign = 'center';
      if (open) {
        g.shadowColor = BROKER; g.shadowBlur = 28; g.fillStyle = BROKER; g.fillText('OPEN', mid, 64);
        g.shadowBlur = 8; g.fillStyle = '#ffd9e6'; g.fillText('OPEN', mid, 64);
      } else {
        g.font = '66px Retail'; g.fillStyle = '#7d3b52'; g.fillText('CLOSED', mid, 64);
      }
      g.restore();
      g.fillStyle = 'rgba(230,220,205,0.9)';
      write(g, open ? `Closes In ${timer}` : `Opens In ${timer}`, mid, 96, 26);
    },
  });
  if (!cards.length) {
    g.fillStyle = 'rgba(230,220,205,0.85)';
    write(g, empty, cx, 330, 36);
  }
  const left = cx - (cols * w + (cols - 1) * gap) / 2;
  for (const [i, { name, state }] of cards.entries()) await card(g, name, left + (i % cols) * (w + gap), 190 + Math.floor(i / cols) * rowH, w, state);
  return c.toBuffer('image/png');
}

// The Broker and Sell tabs: one dark page with a title, a line under it, and cards with a note under each. cards: [{ name, state }].
async function listPage({ title, line, accent, cards, empty }) {
  const cols = 7, w = 150, gap = 26, rowH = w * ASPECT + 70;
  const rows = Math.max(1, Math.ceil(cards.length / cols));
  const H = 170 + rows * rowH + 30;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#16120f';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d1719';
  g.beginPath(); g.roundRect(20, 20, W - 40, H - 40, 10); g.fill();
  g.lineWidth = 3; g.strokeStyle = accent; g.stroke();
  g.fillStyle = accent;
  write(g, title, 60, 104, 64, false);
  g.fillStyle = '#d8cfc4';
  write(g, line, 60, 146, 30, false);
  if (!cards.length) {
    g.fillStyle = '#8f867b';
    write(g, empty, 60, 230, 30, false);
  }
  const left = (W - (cols * w + (cols - 1) * gap)) / 2;
  for (const [i, { name, state }] of cards.entries()) await card(g, name, left + (i % cols) * (w + gap), 200 + Math.floor(i / cols) * rowH, w, state);
  return c.toBuffer('image/png');
}

module.exports = { shopTab, listPage, brokerPage, BROKER, CORRUPTED, TIER_PRICE };
