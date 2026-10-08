// The picture on the /jungle roam result: everything the hero picked up as one card, drawn in the Deadlock comic look (halftone, grain,
// vignette; see art.js). Top: the four finds (all shown, what wasn't found is dimmed). Bottom left: the permanent buffs gained. Bottom
// right: this hour's bridge buff (lit when found). Bottom strip: the souls.
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ASSETS, loadSouls, drawSouls, halftone, grain, grainAndVignette } = require('../art');
const { FINDS } = require('./roam');
const { BRIDGE } = require('./buffs');
const { fmt } = require('../format');

const W = 800;
const H = 500;
const PAD = 32;
const FARM = path.join(ASSETS, 'farm');
// transparent pictures: cutouts/ are hand-cut from the wiki's screenshots (make_cutouts.js), the statue is the owl statue he supplied
const ICON = { crate: 'cutouts/crate', toughCrate: 'cutouts/tough-crate', statue: 'icons/golden-statue', sinner: 'cutouts/sinners-sacrifice' };
const GOLD = '#f5c542';
const SOULS = '#abffe3';
// one colour per bridge buff, also the embed colour when one is found
const BRIDGE_COLOR = { casting: '#b07cff', gun: '#ff9f43', movement: '#4db8ff', survival: '#5be07f' };
const FONT = (px) => `${px}px Radiance`; // Retail draws an apostrophe as the souls glyph

const cache = new Map();
const image = async (file) => cache.get(file) ?? cache.set(file, await loadImage(file)).get(file);
let texture;

function panel(g, x, y, w, h, { fill = 'rgba(255,255,255,0.05)', stroke = 'rgba(255,255,255,0.12)', glow } = {}) {
  g.save();
  if (glow) { g.shadowColor = glow; g.shadowBlur = 28; }
  g.beginPath();
  g.roundRect(x, y, w, h, 14);
  g.fillStyle = fill;
  g.fill();
  g.restore();
  g.lineWidth = glow ? 2.5 : 1.5;
  g.strokeStyle = glow ?? stroke;
  g.beginPath();
  g.roundRect(x, y, w, h, 14);
  g.stroke();
}

// Draws `img` inside the box without stretching it.
function contain(g, img, x, y, w, h) {
  const k = Math.min(w / img.width, h / img.height);
  g.drawImage(img, x + (w - img.width * k) / 2, y + (h - img.height * k) / 2, img.width * k, img.height * k);
}

function label(g, text, x, y) {
  g.font = FONT(17);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.textAlign = 'left';
  g.fillText(text.toUpperCase().split('').join(' '), x, y);
}

function badge(g, n, x, y) {
  g.font = '30px Radiance';
  g.textAlign = 'right';
  g.lineWidth = 6;
  g.strokeStyle = '#0b0d10';
  g.fillStyle = '#fff';
  g.strokeText(`x${n}`, x, y);
  g.fillText(`x${n}`, x, y);
  g.textAlign = 'left';
}

const LIT = { fill: 'rgba(245,197,66,0.08)', stroke: 'rgba(245,197,66,0.45)' };

// haul: the result of a roam (roam.js, plus bridge / bridgeNow / souls); gained: { buff key: count }. Returns a PNG.
async function roamCard(haul, gained) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#10181b');
  bg.addColorStop(1, '#0a0c10');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  halftone(g, 0, 0, W, H, 14, (u, v) => Math.max(0, u * 0.9 + (1 - v) * 0.5 - 0.75) * 0.9, 'rgba(171,255,227,0.10)');

  // ---- finds ----
  label(g, 'Found', PAD, 42);
  // the count has its own strip at the top of the tile, so it never covers a picture
  const tileW = 172, gap = 16, tileY = 56, tileH = 226;
  for (const [i, f] of FINDS.entries()) {
    const n = haul.finds[f.key];
    const x = PAD + i * (tileW + gap);
    panel(g, x, tileY, tileW, tileH, n ? LIT : {});
    g.globalAlpha = n ? 1 : 0.22;
    const pic = await image(`${path.join(FARM, ICON[f.key])}.png`);
    const tall = pic.height / pic.width > 1.4; // tall pictures (statue, machine) use the whole tile height, they are narrow so the count still has room
    contain(g, pic, x + 14, tileY + (tall ? 10 : 40), tileW - 28, tall ? tileH - 46 : 140);
    g.globalAlpha = 1;
    g.font = FONT(15);
    g.textAlign = 'center';
    g.fillStyle = n ? '#fff' : 'rgba(255,255,255,0.35)';
    g.fillText(f.name, x + tileW / 2, tileY + tileH - 16);
    g.textAlign = 'left';
    if (n) badge(g, n, x + tileW - 14, tileY + 32);
  }

  // ---- buffs gained ----
  const rowY = 334;
  label(g, 'Buffs', PAD, rowY - 14);
  const keys = Object.keys(gained);
  const buffW = 104; // the picture on the left, the count in the strip on the right
  const buffsW = 4 * buffW + 3 * 8;
  if (!keys.length) {
    panel(g, PAD, rowY, buffsW, 84);
    g.font = FONT(16);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.textAlign = 'center';
    g.fillText('None this time', PAD + buffsW / 2, rowY + 48);
    g.textAlign = 'left';
  }
  for (const [i, key] of keys.entries()) {
    const x = PAD + i * (buffW + 8);
    panel(g, x, rowY, buffW, 84, LIT);
    contain(g, await image(path.join(FARM, 'buffs', `${key}.png`)), x + 6, rowY + 6, 72, 72);
    if (gained[key] > 1) badge(g, gained[key], x + buffW - 8, rowY + 50);
  }

  // ---- bridge buff ----
  const bx = PAD + buffsW + 28;
  const bw = W - PAD - bx;
  label(g, 'Bridge Buff', bx, rowY - 14);
  const found = haul.bridge;
  const key = found ?? haul.bridgeNow;
  const color = BRIDGE_COLOR[key];
  panel(g, bx, rowY, bw, 84, found ? { fill: 'rgba(255,255,255,0.07)', glow: color } : {});
  g.globalAlpha = found ? 1 : 0.28;
  contain(g, await image(path.join(FARM, 'bridge', `${key}.png`)), bx + 10, rowY + 8, 68, 68);
  g.globalAlpha = 1;
  g.font = FONT(22);
  g.fillStyle = found ? color : 'rgba(255,255,255,0.4)';
  g.fillText(BRIDGE[key].name, bx + 92, rowY + (found ? 36 : 42));
  g.font = FONT(14);
  g.fillStyle = found ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
  g.fillText(found ? 'Found. Used next fight' : 'On the map this hour', bx + 92, rowY + 62);

  // ---- souls ----
  const sy = 446;
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(PAD, sy - 8, W - 2 * PAD, 1.5);
  drawSouls(g, await loadSouls(), PAD + 2, sy + 4, 38);
  g.font = '36px Radiance';
  g.fillStyle = haul.souls ? SOULS : 'rgba(255,255,255,0.35)';
  g.fillText(`+${fmt(haul.souls)}`, PAD + 38, sy + 38);
  g.font = FONT(16);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.textAlign = 'right';
  g.fillText('SOULS EARNED', W - PAD, sy + 36);
  g.textAlign = 'left';

  texture ??= grain(W, H, 77, 90);
  grainAndVignette(g, W, H, texture, { grainAlpha: 0.35, inner: 260, outer: 560, dark: 0.55 });
  return c.toBuffer('image/png');
}

module.exports = { roamCard, BRIDGE_COLOR, GOLD, SOULS, FONT, image, panel, contain, label, badge, FARM };
