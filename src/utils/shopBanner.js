// The /shop first-screen banner: the in-game Curiosity Shop with the member's name, level flask and souls
// on top, and below it a copy of the in-game shop page (FAIRFAX header, one panel per tier, item cards).
// Every Shop price is a real in-game tier price. Design rules: server-plan.md ("/shop first screen").
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { drawFlask, fit, TEXT_FONT } = require('./rankCard');
const { heroArt } = require('./heroes');
const { ASSETS, loadSouls, drawSouls, seeded, halftone } = require('./art');
const { fmt } = require('./format');

// Windows fonts for the shop page lettering (the bot runs on Windows); other systems fall back to generic fonts.
for (const [file, family] of [['georgiab.ttf', 'SerifB'], ['ariblk.ttf', 'Heavy']]) {
  const p = path.join('C:/Windows/Fonts', file);
  if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, family);
}
const SERIF = 'SerifB, Georgia, serif';
const HEAVY = 'Heavy, "Arial Black", sans-serif';

const W = 1000;
const H = 770;
const TOP = 340; // shop art + customer above, shop page below
const INK = '#16110b';
const TEAL = '#7fd9a8';
const ORANGE = '#d9892f';
const CREAM = '#efe4c9';

const round = (g, x, y, w, h, r) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};
const star = (g, cx, cy, r) => {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
};

// Worn paper: speckles + faint scratches.
function wear(g, rnd, x, y, w, h, n, dark = 'rgba(60,40,20,', light = 'rgba(255,250,235,') {
  for (let i = 0; i < n; i++) {
    g.fillStyle = (rnd() < 0.6 ? dark : light) + (0.05 + rnd() * 0.15) + ')';
    g.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  g.strokeStyle = 'rgba(80,55,30,0.12)';
  g.lineWidth = 1;
  for (let i = 0; i < n / 40; i++) {
    const sx = x + rnd() * w;
    const sy = y + rnd() * h;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + (rnd() - 0.5) * 40, sy + (rnd() - 0.5) * 20);
    g.stroke();
  }
}

function hatch(g, x, y, w, h, color, gap) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  for (let d = -h; d < w; d += gap) {
    g.beginPath();
    g.moveTo(x + d, y + h);
    g.lineTo(x + d + h, y);
    g.stroke();
  }
  g.restore();
}

// The minimap Stairs icon (deadlock.wiki, 24 px) redrawn as vector; coordinates on its 24-unit grid.
function drawStairs(g, x, y, size) {
  g.save();
  g.translate(x, y);
  g.scale(size / 24, size / 24);
  round(g, 0, 0, 24, 24, 3.5);
  g.fillStyle = '#101010';
  g.fill();
  round(g, 0.5, 0.5, 23, 23, 3.2);
  g.strokeStyle = '#6b6b6b';
  g.lineWidth = 1;
  g.stroke();
  g.strokeStyle = '#e9e9e9';
  g.lineWidth = 2;
  g.lineJoin = 'miter';
  g.lineCap = 'square';
  g.beginPath(); // the stairs, climbing up to the right
  [[5, 17.5], [5, 13], [9, 13], [9, 9], [13, 9], [13, 5], [17, 5]].forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
  g.stroke();
  g.lineCap = 'round';
  g.beginPath(); // arrow shaft
  g.moveTo(13.5, 18);
  g.lineTo(18.2, 13.3);
  g.stroke();
  g.lineCap = 'square';
  g.beginPath(); // arrow head
  g.moveTo(14.8, 13);
  g.lineTo(18.5, 13);
  g.lineTo(18.5, 16.7);
  g.stroke();
  g.restore();
}

// The in-game shop page: worn greyish-tan paper, diagonal hatching, a ragged edge.
function paper(g, rnd, px, py, pw, ph) {
  g.save();
  g.beginPath();
  g.moveTo(px, py);
  for (let x = px; x <= px + pw; x += 20) g.lineTo(x, py + rnd() * 3);
  for (let y = py; y <= py + ph; y += 20) g.lineTo(px + pw - rnd() * 3, y);
  for (let x = px + pw; x >= px; x -= 20) g.lineTo(x, py + ph - rnd() * 3);
  for (let y = py + ph; y >= py; y -= 20) g.lineTo(px + rnd() * 3, y);
  g.closePath();
  g.clip();
  g.fillStyle = '#b9ab8d';
  g.fillRect(px, py, pw, ph);
  hatch(g, px, py, pw, ph, 'rgba(110,80,45,0.16)', 18);
  wear(g, rnd, px, py, pw, ph, 3000);
  const vg = g.createRadialGradient(px + pw / 2, py + ph / 2, 100, px + pw / 2, py + ph / 2, 620);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(40,25,10,0.35)');
  g.fillStyle = vg;
  g.fillRect(px, py, pw, ph);
  g.restore();
}

// ---- tier price plates, fancier each tier (like in-game) ----
function priceWidth(g, price) {
  g.font = '34px Retail';
  return g.measureText(price).width + 20;
}
function plateText(g, souls, price, x, y) {
  g.font = '34px Retail';
  g.fillStyle = TEAL;
  g.textAlign = 'left';
  drawSouls(g, souls, x, y - 28, 30);
  g.fillText(price, x + 20, y);
}
// Draws the tier's price plate with its top-left at (x, y); returns its width.
function plate(g, rnd, tier, x, y, price, souls) {
  const w = priceWidth(g, price) + 30;
  const h = 46;
  g.save();
  g.translate(x, y);
  if (tier === 4) {
    // straight octagon, double bronze outline, a point with a star above and below
    const hw = w + 26;
    const cut = 10;
    const oct = (i) => {
      g.beginPath();
      g.moveTo(cut + i, i); g.lineTo(hw - cut - i, i); g.lineTo(hw - i, cut + i); g.lineTo(hw - i, h - cut - i);
      g.lineTo(hw - cut - i, h - i); g.lineTo(cut + i, h - i); g.lineTo(i, h - cut - i); g.lineTo(i, cut + i);
      g.closePath();
    };
    const bump = (top) => {
      g.beginPath();
      g.moveTo(hw / 2 - 18, top ? 0 : h);
      g.lineTo(hw / 2, top ? -16 : h + 16);
      g.lineTo(hw / 2 + 18, top ? 0 : h);
      g.closePath();
      g.fill();
    };
    g.fillStyle = INK;
    oct(0);
    g.fill();
    bump(true);
    bump(false);
    g.strokeStyle = '#b07a35';
    g.lineWidth = 1.5;
    oct(3);
    g.stroke();
    oct(6);
    g.stroke();
    g.fillStyle = '#b07a35';
    star(g, hw / 2, -6, 4.5);
    star(g, hw / 2, h + 6, 4.5);
    plateText(g, souls, price, 22, 35);
    g.restore();
    return hw;
  }
  g.rotate(tier === 2 ? -0.03 : -0.045);
  if (tier === 3) {
    // ticket: notched corners, dotted gold border
    const n = 8;
    g.beginPath();
    g.moveTo(n, 0); g.lineTo(w - n, 0); g.lineTo(w, n); g.lineTo(w, h - n);
    g.lineTo(w - n, h); g.lineTo(n, h); g.lineTo(0, h - n); g.lineTo(0, n);
    g.closePath();
    g.fillStyle = INK;
    g.fill();
    g.fillStyle = '#c99a45';
    for (let px = 8; px < w - 6; px += 7) {
      g.beginPath(); g.arc(px, 4, 1.4, 0, 7); g.arc(px, h - 4, 1.4, 0, 7); g.fill();
    }
    for (let py = 10; py < h - 6; py += 7) {
      g.beginPath(); g.arc(4, py, 1.4, 0, 7); g.arc(w - 4, py, 1.4, 0, 7); g.fill();
    }
  } else {
    g.fillStyle = INK;
    g.fillRect(0, 0, w, h);
    wear(g, rnd, 0, 0, w, h, 60, 'rgba(90,70,40,', 'rgba(90,70,40,');
    if (tier === 2) {
      g.strokeStyle = '#b8862f';
      g.lineWidth = 1.5;
      g.strokeRect(4, 4, w - 8, h - 8);
    }
  }
  plateText(g, souls, price, 14, 36);
  g.restore();
  return w;
}

// ---- tier panel frames ----
function frame(g, rnd, tier, x, y, w, h) {
  if (tier === 4) {
    // dark panel, bronze double lines with notched corners, a star in each corner
    g.fillStyle = '#0e0804';
    g.fillRect(x, y, w, h);
    wear(g, rnd, x, y, w, h, 500, 'rgba(110,80,40,', 'rgba(110,80,40,');
    const notched = (i, r) => {
      const x0 = x + i, y0 = y + i, x1 = x + w - i, y1 = y + h - i;
      g.beginPath();
      g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.arc(x1, y0, r, Math.PI, Math.PI / 2, true);
      g.lineTo(x1, y1 - r); g.arc(x1, y1, r, -Math.PI / 2, Math.PI, true);
      g.lineTo(x0 + r, y1); g.arc(x0, y1, r, 0, -Math.PI / 2, true);
      g.lineTo(x0, y0 + r); g.arc(x0, y0, r, Math.PI / 2, 0, true);
      g.closePath();
    };
    g.strokeStyle = '#8a6531';
    g.lineWidth = 1.5;
    notched(8, 10);
    g.stroke();
    notched(13, 10);
    g.stroke();
    g.fillStyle = '#8a6531';
    for (const [sx, sy] of [[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + h - 9], [x + w - 9, y + h - 9]]) star(g, sx, sy, 4);
    return;
  }
  if (tier === 2) {
    // faint target circles behind the cards
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.strokeStyle = 'rgba(150,110,50,0.35)';
    g.lineWidth = 2;
    for (const r of [60, 110, 160]) {
      g.beginPath();
      g.arc(x + w * 0.6, y + h * 0.55, r, 0, 7);
      g.stroke();
    }
    g.restore();
  }
  if (tier === 3) {
    // halftone dots, a beaded band top and left, double lines right and bottom
    halftone(g, x, y, w, h, 9, () => 0.35, 'rgba(120,85,40,0.25)');
    g.fillStyle = '#b8862f';
    g.fillRect(x, y, w, 9);
    g.fillRect(x, y, 9, h);
    g.fillStyle = '#e0c07a';
    for (let px = x + 5; px < x + w; px += 7) { g.beginPath(); g.arc(px, y + 4.5, 1.5, 0, 7); g.fill(); }
    for (let py = y + 5; py < y + h; py += 7) { g.beginPath(); g.arc(x + 4.5, py, 1.5, 0, 7); g.fill(); }
    g.strokeStyle = '#c0873a';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.stroke();
    g.beginPath(); g.moveTo(x + w - 5, y + 9); g.lineTo(x + w - 5, y + h - 5); g.lineTo(x + 9, y + h - 5); g.stroke();
    return;
  }
  g.strokeStyle = '#c0873a';
  g.lineWidth = 1.5;
  g.strokeRect(x, y, w, h);
  g.strokeRect(x + 5, y + 5, w - 10, h - 10);
}

// ---- item card: art on top, name on a worn paper band; drawn at design size, then scaled per tier ----
const CARD = { w: 132, art: 116, name: 52 };
const CARD_TONES = {
  1: { art: '#ece2ca', band: '#e2cd9c', text: '#231c14' },
  2: { art: '#caa261', band: '#d6b67e', text: '#231c14' },
  3: { art: '#6e4a31', band: '#c9a273', text: '#231c14' },
  4: { art: '#231619', band: '#574941', text: '#e6d5ba' },
};
const CARD_SCALE = { 1: 0.85, 2: 0.85, 3: 0.72, 4: 1.15 }; // tier 3 holds two cards; tier 4 has a tall panel
const cardSize = (tier) => ({ w: CARD.w * CARD_SCALE[tier], h: (CARD.art + CARD.name) * CARD_SCALE[tier] });

function card(g, rnd, tier, x0, y0, { name, tag, art, artBg }, scale = CARD_SCALE[tier]) {
  const t = CARD_TONES[tier];
  const { w } = CARD;
  const h = CARD.art + CARD.name;
  g.save();
  g.translate(x0, y0);
  g.scale(scale, scale);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 5;
  g.shadowOffsetY = 2;
  round(g, 0, 0, w, h, 8);
  g.fillStyle = t.band;
  g.fill();
  g.restore();
  g.save();
  round(g, 0, 0, w, h, 8);
  g.clip();
  g.fillStyle = artBg ?? t.art;
  g.fillRect(0, 0, w, CARD.art);
  halftone(g, 0, 0, w, CARD.art, 5, (u, v) => Math.max(0, (v - 0.35) * 0.5), 'rgba(0,0,0,0.12)');
  g.save();
  g.beginPath();
  g.rect(0, 0, w, CARD.art);
  g.clip();
  art(w / 2, CARD.art / 2);
  g.restore();
  // little print marks in the corners, like the in-game cards
  g.fillStyle = tier === 4 ? 'rgba(230,200,150,0.35)' : 'rgba(40,30,20,0.35)';
  g.beginPath(); g.moveTo(6, 6); g.lineTo(24, 6); g.lineTo(6, 24); g.fill();
  g.fillRect(w - 26, 8, 18, 5);
  g.fillRect(10, CARD.art - 12, 30, 2);
  g.fillRect(w - 30, CARD.art - 12, 20, 2);
  wear(g, rnd, 0, 0, w, h, 220, tier === 4 ? 'rgba(0,0,0,' : 'rgba(90,60,30,');
  g.restore();
  round(g, 0.5, 0.5, w - 1, h - 1, 8);
  g.strokeStyle = 'rgba(40,28,15,0.55)';
  g.lineWidth = 1;
  g.stroke();
  if (tag) {
    // like the in-game black ACTIVE tag
    g.font = '15px Radiance';
    g.textAlign = 'center';
    const tw = g.measureText(tag).width + 16;
    round(g, (w - tw) / 2, CARD.art - 24, tw, 22, 4);
    g.fillStyle = '#17171a';
    g.fill();
    g.fillStyle = '#f1efe9';
    g.fillText(tag, w / 2, CARD.art - 7);
  }
  g.fillStyle = t.text;
  g.textAlign = 'center';
  g.font = '19px Radiance';
  const lines = Array.isArray(name) ? name : [name];
  lines.forEach((l, i) => g.fillText(l, w / 2, CARD.art + (lines.length === 1 ? 33 : 22 + i * 20)));
  g.textAlign = 'left';
  g.restore();
}

// ---- FAIRFAX header plate (in-game: "FAIRFAX / ARTILLERY BOUGHT AND SOLD") ----
function header(g, rnd, x, y, w, h) {
  g.fillStyle = INK;
  g.fillRect(x, y, w, h);
  const bx = x + 40, bw = w - 80, top = y + 10, bh = h - 38, notch = 22;
  const ribbon = (dx, dy) => {
    g.beginPath();
    g.moveTo(bx - notch + dx, top + dy); g.lineTo(bx + bw + notch + dx, top + dy);
    g.lineTo(bx + bw + dx, top + bh / 2 + dy); g.lineTo(bx + bw + notch + dx, top + bh + dy);
    g.lineTo(bx - notch + dx, top + bh + dy); g.lineTo(bx + dx, top + bh / 2 + dy);
    g.closePath();
  };
  g.lineWidth = 3;
  g.strokeStyle = ORANGE;
  ribbon(3, 3);
  g.stroke();
  g.strokeStyle = CREAM;
  ribbon(0, 0);
  g.stroke();
  g.font = `50px ${HEAVY}`;
  g.textAlign = 'center';
  g.fillStyle = ORANGE;
  g.fillText('FAIRFAX', x + w / 2 + 3, top + bh - 6);
  g.fillStyle = CREAM;
  g.fillText('FAIRFAX', x + w / 2, top + bh - 9);
  g.font = '15px Radiance';
  g.fillStyle = ORANGE;
  g.fillText('S O U L S   B O U G H T   A N D   S O L D', x + w / 2, y + h - 10);
  g.textAlign = 'left';
  wear(g, rnd, x, y, w, h, 500, 'rgba(0,0,0,', 'rgba(20,14,8,');
}

// The Shop's items as cards (name, tag, art), for the shelf and the item pages.
function itemCards(g, { rejuv, souls }) {
  return {
    soulBoost: { name: 'Soul Boost', tag: '2× · 1 HR', artBg: '#bf9a5c', art: (cx, cy) => {
      g.save(); g.shadowColor = '#3fe0a8'; g.shadowBlur = 16;
      drawSouls(g, souls, cx - 22, cy - 46, 76);
      g.restore();
    } },
    rejuv: { name: 'Rejuv', tag: 'MAX 3', art: (cx, cy) => {
      g.save(); g.shadowColor = '#ffd84a'; g.shadowBlur = 22;
      g.drawImage(rejuv, cx - 44, cy - 50, 88, 88);
      g.restore();
    } },
    hideout: { name: 'Hideout', tag: 'LV 20+', art: (cx, cy) => drawStairs(g, cx - 38, cy - 46, 76) },
  };
}

let art;
async function loadArt() {
  art ??= {
    shop: await loadImage(path.join(ASSETS, 'shop', 'art', 'curiosity_shop.png')), // deadlock.wiki
    rejuv: await loadImage(path.join(ASSETS, 'shop', 'art', 'rejuv.png')), // deadlock.wiki "Mid-Boss.png"
    souls: await loadSouls(),
  };
  return art;
}

// { name, level, fill (0..1 XP into the level), souls, heroSlug (their equipped hero, shown on the hero cards) } -> PNG buffer.
async function renderShopBanner({ name, level, fill, souls: balance, heroSlug }) {
  const { shop, rejuv, souls } = await loadArt();
  const icon = await heroArt(heroSlug, 'icon');
  const render = await heroArt(heroSlug, 'portrait');
  const rnd = seeded(5);
  const c = createCanvas(W, H);
  const g = c.getContext('2d');

  // ---- top: the Curiosity Shop + customer ----
  g.fillStyle = '#17100c';
  g.fillRect(0, 0, W, H);
  const sh = TOP + 40;
  g.drawImage(shop, -30, -10, (sh * shop.width) / shop.height, sh);
  const fade = g.createLinearGradient(380, 0, 540, 0);
  fade.addColorStop(0, 'rgba(23,16,12,0)');
  fade.addColorStop(1, 'rgba(23,16,12,1)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, TOP);
  g.fillStyle = '#17100c';
  g.fillRect(560, 0, W - 560, TOP);
  halftone(g, 480, 0, W - 480, TOP, 8, (u, v) => Math.max(0, 0.55 - v * 0.5 + u * 0.1), 'rgba(227,154,59,0.08)');
  g.textAlign = 'left';
  g.fillStyle = '#e39a3b';
  g.font = '22px Radiance';
  g.fillText('CUSTOMER', 580, 70);
  g.fillStyle = '#fcf0da';
  g.font = `50px ${TEXT_FONT}`;
  g.fillText(fit(g, name, W - 600), 580, 124);
  drawFlask(g, 636, 215, 52, level, fill);
  g.textAlign = 'left';
  drawSouls(g, souls, 722, 186, 52);
  g.fillStyle = '#abffe3';
  g.font = '54px Retail';
  g.fillText(fmt(balance), 766, 232);
  g.font = '20px Radiance';
  g.fillStyle = '#8fa39b';
  g.fillText('SOULS', 768, 260);
  const down = g.createLinearGradient(0, TOP - 40, 0, TOP + 6);
  down.addColorStop(0, 'rgba(18,12,9,0)');
  down.addColorStop(1, 'rgba(18,12,9,1)');
  g.fillStyle = down;
  g.fillRect(0, TOP - 40, W, 46);

  // ---- the shop page ----
  const px = 14, py = TOP + 8, pw = W - 28, ph = H - py - 12;
  paper(g, rnd, px, py, pw, ph);

  header(g, rnd, 36, py + 18, 440, 94);

  // Tiers 1-3 in a row under the header.
  const items = itemCards(g, { rejuv, souls });
  const tiers = [
    { tier: 1, price: '800', cards: [{ name: 'Icon Card', art: (cx, cy) => {
      const img = icon.image, s = 92 / img.height;
      g.drawImage(img, cx - (img.width * s) / 2, cy - 48, img.width * s, 92);
    } }] },
    { tier: 2, price: '1600', cards: [items.soulBoost] },
    { tier: 3, price: '3200', cards: [
      { name: ['Full Portrait', 'Card'], art: (cx, cy) => {
        const img = render.image, s = 175 / img.height;
        g.drawImage(img, cx - (img.width * s) / 2, cy - 58, img.width * s, 175);
      } },
      items.rejuv,
    ] },
  ];
  const gap = 12, pad = 18, rowY = py + 158, rowH = cardSize(1).h + 2 * pad + 26;
  const labelWidth = (tier) => {
    g.font = `20px ${SERIF}`;
    return g.measureText(`TIER ${tier}`).width;
  };
  let x = 36;
  for (const t of tiers) {
    const size = cardSize(t.tier);
    const cardsW = t.cards.length * size.w + (t.cards.length - 1) * 10;
    const w = Math.max(cardsW + 2 * pad, priceWidth(g, t.price) + 30 + labelWidth(t.tier) + 6);
    frame(g, rnd, t.tier, x, rowY, w, rowH);
    t.cards.forEach((cd, j) => card(g, rnd, t.tier, x + (w - cardsW) / 2 + j * (size.w + 10), rowY + 30 + (rowH - 30 - size.h) / 2, cd));
    const plateW = plate(g, rnd, t.tier, x - 8, rowY - 30, t.price, souls);
    g.font = `20px ${SERIF}`;
    g.fillStyle = '#2e261c';
    g.fillText(`TIER ${t.tier}`, x + plateW - 2, rowY - 2);
    x += w + gap;
  }

  // Tier 4: tall dark panel on the right, like the in-game shop's bottom-right panel.
  const t4x = x + 8, t4y = py + 44, t4w = px + pw - 22 - t4x, t4h = rowY + rowH - t4y;
  frame(g, rnd, 4, t4x, t4y, t4w, t4h);
  plate(g, rnd, 4, t4x - 10, t4y - 22, '6400', souls);
  g.textAlign = 'center';
  g.font = `20px ${SERIF}`;
  g.fillStyle = '#c4b08a';
  g.fillText('TIER 4', t4x + t4w / 2, t4y + 58);
  g.font = `italic 14px ${SERIF}`;
  g.fillStyle = '#a8702c';
  g.fillText('EXPERTS ONLY', t4x + t4w / 2, t4y + 77);
  g.textAlign = 'left';
  const s4 = cardSize(4);
  card(g, rnd, 4, t4x + (t4w - s4.w) / 2, t4y + 86 + (t4h - 100 - s4.h) / 2, items.hideout);

  // film grain over everything
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.2})`;
    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
  }
  return c.toBuffer('image/png');
}

// A tick (met) or a cross (not met).
function tick(g, x, y, ok) {
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.strokeStyle = ok ? '#7fd9a8' : '#e0664a';
  g.beginPath();
  if (ok) {
    g.moveTo(x, y); g.lineTo(x + 7, y + 8); g.lineTo(x + 20, y - 8);
  } else {
    g.moveTo(x, y - 8); g.lineTo(x + 16, y + 8); g.moveTo(x + 16, y - 8); g.lineTo(x, y + 8);
  }
  g.stroke();
  g.lineCap = 'butt';
}

const PAGE_W = 1000;
const PAGE_H = 540;

// One item's Shop page, on the shop-page paper. Left: a close-up of its tier panel with a big card.
// Right: title, subtitle, what you get (`lines`: each a string, or [text, bold text, text]), then a dark box of
// `cells`: { kind: 'level' | 'souls' | 'text', label, value, sub?, ok? } (ok true/false draws a tick/cross).
// item: 'soulBoost' | 'rejuv' | 'hideout'. Returns a PNG buffer.
async function renderItemPage({ item, tier, price, title, subtitle, lines, cells, level = 0, fill = 0 }) {
  const { rejuv, souls } = await loadArt();
  const rnd = seeded(9);
  const c = createCanvas(PAGE_W, PAGE_H);
  const g = c.getContext('2d');
  g.fillStyle = '#17100c';
  g.fillRect(0, 0, PAGE_W, PAGE_H);
  paper(g, rnd, 10, 10, PAGE_W - 20, PAGE_H - 20);

  // left: the tier panel, close up
  const tx = 40, ty = 74, tw = 330, th = 410;
  frame(g, rnd, tier, tx, ty, tw, th);
  if (tier === 4) {
    plate(g, rnd, 4, tx - 10, ty - 22, price, souls);
    g.textAlign = 'center';
    g.font = `22px ${SERIF}`;
    g.fillStyle = '#c4b08a';
    g.fillText('TIER 4', tx + tw / 2, ty + 62);
    g.font = `italic 15px ${SERIF}`;
    g.fillStyle = '#a8702c';
    g.fillText('EXPERTS ONLY', tx + tw / 2, ty + 82);
    g.textAlign = 'left';
  } else {
    const plateW = plate(g, rnd, tier, tx - 8, ty - 30, price, souls);
    g.font = `22px ${SERIF}`;
    g.fillStyle = '#2e261c';
    g.fillText(`TIER ${tier}`, tx + plateW - 2, ty - 2);
  }
  const scale = 1.5;
  card(g, rnd, tier, tx + (tw - CARD.w * scale) / 2, ty + (tier === 4 ? 100 : 70), itemCards(g, { rejuv, souls })[item], scale);

  // right: what you get
  const rx = 420;
  g.font = `54px ${HEAVY}`;
  g.fillStyle = ORANGE;
  g.fillText(title, rx + 3, 111);
  g.fillStyle = INK;
  g.fillText(title, rx, 108);
  g.font = '17px Radiance';
  g.fillStyle = '#7a4f1f';
  g.fillText(subtitle.split('').join(' '), rx + 2, 138);
  g.fillStyle = 'rgba(60,40,20,0.5)';
  g.fillRect(rx, 156, 520, 2);
  let y = 196;
  for (const line of lines) {
    const parts = Array.isArray(line) ? line : [line];
    g.fillStyle = '#6b3f14';
    g.save(); g.translate(rx + 8, y - 7); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore();
    let x = rx + 26;
    parts.forEach((part, i) => {
      const bold = parts.length === 3 && i === 1;
      g.font = bold ? `21px ${TEXT_FONT}` : `20px ${TEXT_FONT}`;
      g.fillStyle = bold ? '#1f160c' : '#2e2419';
      g.fillText(part, x, y);
      x += g.measureText(part).width;
    });
    y += 38;
  }

  // the requirements / status box
  const by = 404, bh = 92, cw = 540 / cells.length;
  round(g, rx, by, 540, bh, 8);
  g.fillStyle = 'rgba(22,17,11,0.9)';
  g.fill();
  g.strokeStyle = '#8a6531';
  g.lineWidth = 1.5;
  round(g, rx + 5, by + 5, 530, bh - 10, 6);
  g.stroke();
  cells.forEach((cell, i) => {
    let x = rx + i * cw + 22;
    if (cell.kind === 'level') {
      drawFlask(g, x + 30, by + bh / 2 + 2, 30, level, fill);
      x += 74;
    } else if (cell.kind === 'souls') {
      drawSouls(g, souls, x, by + 22, 48);
      x += 34;
    }
    g.textAlign = 'left';
    g.font = '15px Radiance';
    g.fillStyle = '#b8a27a';
    g.fillText(cell.label, x, by + 38);
    g.font = cell.kind === 'text' ? '24px Radiance' : '26px Retail';
    g.fillStyle = cell.kind === 'souls' ? '#abffe3' : '#fcf0da';
    g.fillText(cell.value, x, by + 66);
    const vw = g.measureText(cell.value).width;
    if (cell.sub) {
      g.font = '16px Radiance';
      g.fillStyle = '#b8a27a';
      g.fillText(cell.sub, x + vw + 8, by + 66);
    }
    if (cell.ok !== undefined) tick(g, rx + (i + 1) * cw - 44, by + 52, cell.ok);
  });

  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.18})`;
    g.fillRect(rnd() * PAGE_W, rnd() * PAGE_H, 1.5, 1.5);
  }
  return c.toBuffer('image/png');
}

module.exports = { renderShopBanner, renderItemPage };

