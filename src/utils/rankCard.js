// Draws the /rank card: the in-game level flask, name, level, souls and a big XP bar.
// Flask colours and shape were sampled/traced from a Deadlock screenshot; fonts are the game's
// (Retail, Radiance) from deadlock.wiki.
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Radiance-Bold.woff2'), 'Radiance');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Retaildemo-bold.woff2'), 'Retail');
// Names can hold characters the game fonts lack; fall back to system fonts for those.
// Windows fonts first (the bot runs on Windows), then common Linux ones in case it moves to a Linux host.
const TEXT_FONT = [
  'Radiance',
  '"Segoe UI"', '"Yu Gothic"', '"Malgun Gothic"', '"Segoe UI Emoji"', '"Segoe UI Symbol"',
  '"Noto Sans"', '"Noto Sans CJK JP"', '"Noto Sans CJK KR"', '"WenQuanYi Zen Hei"', '"Noto Color Emoji"', '"DejaVu Sans"',
  'sans-serif',
].join(', ');

const W = 1000;
const H = 300;
const C = {
  bg: '#131a18',
  outline: '#0b1403',
  empty: '#2b2b2b',
  liquid: '#6aa98a',
  digit: '#fcf0da',
  glow: '#21392c',
  souls: '#abffe3', // colour of the in-game souls icon
  text: '#fcf0da',
  muted: '#8fa39b',
};

// Flask neck, in units of the outer radius (centre = 0,0). NECK is the outer edge of the black
// outline; NECK_IN is where the grey starts (it opens into the body, like in-game).
const NECK = [[-1.184, -0.702], [-0.592, -1.217], [-0.372, -1.054], [-0.372, -0.507], [-1.034, -0.507]];
const NECK_IN = [[-1.034, -0.673], [-0.596, -1.049], [-0.563, -0.948], [-0.462, -0.758], [0, 0], [-0.765, -0.489], [-0.865, -0.646]];

function flaskPath(g, x, y, r, R, neck) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.moveTo(x + neck[0][0] * R, y + neck[0][1] * R);
  for (const [a, b] of neck.slice(1)) g.lineTo(x + a * R, y + b * R);
  g.closePath();
}

// `fill` 0..1 = how far the liquid is up the flask (XP progress into the current level).
// `colors` swaps the liquid/glow for hero cards.
function drawFlask(g, x, y, R, level, fill, { liquid = C.liquid, glow = C.glow } = {}) {
  const t = 0.135 * R; // outline thickness
  flaskPath(g, x, y, R, R, NECK);
  g.fillStyle = g.strokeStyle = C.outline;
  g.fill();
  g.lineWidth = 0.05 * R;
  g.lineJoin = 'round';
  g.stroke();
  flaskPath(g, x, y, R - t, R, NECK_IN);
  g.fillStyle = C.empty;
  g.fill();
  g.save();
  g.beginPath();
  g.arc(x, y, R - t, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = liquid;
  g.fillRect(x - R, y + (R - t) * (1 - 2 * fill), 2 * R, 2 * R);
  g.restore();

  // Level number: cream, with a dark soft glow behind it. Sized to the in-game proportions.
  const txt = String(level);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = '100px Retail';
  const m = g.measureText(txt);
  const size = 100 * Math.min((0.73 * R) / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent), (1.25 * R) / m.width);
  g.font = `${size}px Retail`;
  const m2 = g.measureText(txt);
  const baseline = y + 0.03 * R + (m2.actualBoundingBoxAscent - m2.actualBoundingBoxDescent) / 2;
  g.save();
  g.shadowColor = glow;
  g.shadowBlur = 0.3 * R;
  g.fillStyle = glow;
  for (let i = 0; i < 3; i++) g.fillText(txt, x, baseline);
  g.restore();
  g.fillStyle = C.digit;
  g.fillText(txt, x, baseline);
}

// Shrinks `text` with an ellipsis until it fits `maxWidth` in the current font.
function fit(g, text, maxWidth) {
  if (g.measureText(text).width <= maxWidth) return text;
  let s = [...text];
  while (s.length > 1 && g.measureText(s.join('') + '…').width > maxWidth) s.pop();
  return s.join('') + '…';
}

const fmt = (n) => n.toLocaleString('en-US');
let soulsIcon;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Blend colour `a` towards `b` by t (0..1), both '#rrggbb'.
const mix = (a, b, t) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(',')})`;

// Hero art on the right, fading out towards the text on the left and the XP bar below.
// A full render fills the card's height; a chat icon (stand-in until renders are downloaded) sits smaller.
function drawHeroArt(g, { image, isRender }) {
  const layer = createCanvas(W, H);
  const l = layer.getContext('2d');
  const h = isRender ? H * 1.15 : 190;
  const w = h * (image.width / image.height);
  const x = isRender ? W - w - 10 : W - w - 70;
  l.drawImage(image, x, isRender ? 0 : 18, w, h);
  l.globalCompositeOperation = 'destination-in';
  const fade = l.createLinearGradient(Math.max(x, 560), 0, Math.max(x, 560) + 140, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  l.fillStyle = fade;
  l.fillRect(0, 0, W, H);
  const bottom = l.createLinearGradient(0, 190, 0, H);
  bottom.addColorStop(0, 'rgba(0,0,0,1)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.35)');
  l.fillStyle = bottom;
  l.fillRect(0, 0, W, H);
  g.drawImage(layer, 0, 0);
}

// { name, level, into, need, souls, maxLevel, hero? } -> PNG buffer.
// hero = { image, isRender, color } (from heroes.heroArt) turns it into that hero's card:
// the hero's art, and their colour on the XP bar, flask liquid, background tint and text accents.
async function renderRankCard({ name, level, into, need, souls, maxLevel, hero }) {
  soulsIcon ??= await loadImage(path.join(ASSETS, 'card', 'souls.png'));
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const accent = hero?.color ?? C.liquid;
  const flask = hero ? { liquid: accent, glow: mix(accent, '#000000', 0.75) } : {};

  g.beginPath();
  g.roundRect(0, 0, W, H, 24);
  g.clip();
  g.fillStyle = hero ? mix(C.bg, accent, 0.1) : C.bg;
  g.fillRect(0, 0, W, H);
  const p = level >= maxLevel ? 1 : into / need;

  if (hero) {
    // Soft glow of the hero's colour behind the art.
    const glow = g.createRadialGradient(W - 170, 110, 20, W - 170, 110, 420);
    glow.addColorStop(0, mix(C.bg, accent, 0.35));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    drawHeroArt(g, hero);
  } else {
    // Big faded souls mark on the right.
    g.globalAlpha = 0.06;
    g.drawImage(soulsIcon, W - 230, 25, 145, 145 * (soulsIcon.height / soulsIcon.width));
    g.globalAlpha = 1;
  }
  drawFlask(g, 130, 142, 80, level, p, flask);

  g.textAlign = 'left';
  g.fillStyle = C.text;
  g.font = `46px ${TEXT_FONT}`;
  g.fillText(fit(g, name, 480), 225, 100);
  g.fillStyle = hero ? mix(accent, '#ffffff', 0.25) : C.muted;
  g.font = `26px ${TEXT_FONT}`;
  g.fillText(`LEVEL ${level}`, 227, 138);

  // Souls, laid out like the in-game "$0 ITEM VALUE".
  g.drawImage(soulsIcon, 227, 160, 22, 38);
  g.fillStyle = C.souls;
  g.font = '40px Retail';
  g.fillText(fmt(souls), 257, 195);
  const sw = g.measureText(fmt(souls)).width;
  g.font = '20px Retail';
  g.fillText('SOULS', 265 + sw, 194);

  // XP bar.
  const x0 = 40;
  const y0 = 225;
  const bw = W - 80;
  const bh = 34;
  g.fillStyle = 'rgba(10,14,13,0.85)';
  g.beginPath();
  g.roundRect(x0, y0, bw, bh, bh / 2);
  g.fill();
  if (p > 0) {
    g.fillStyle = accent;
    g.beginPath();
    g.roundRect(x0 + 4, y0 + 4, Math.max(bh - 8, (bw - 8) * p), bh - 8, (bh - 8) / 2);
    g.fill();
  }
  g.fillStyle = C.text;
  g.font = `20px ${TEXT_FONT}`;
  g.textAlign = 'right';
  g.fillText(level >= maxLevel ? 'MAX LEVEL' : `${fmt(into)} / ${fmt(need)} XP`, x0 + bw - 16, y0 + 24);

  return c.toBuffer('image/png');
}

const MEDAL = ['#e8c267', '#c9d1d4', '#c98a5a']; // gold, silver, bronze

// Leaderboard image in the same style. rows: [{ name, level, fill (0..1), xp, souls }], best first.
async function renderLeaderboard(serverName, rows) {
  soulsIcon ??= await loadImage(path.join(ASSETS, 'card', 'souls.png'));
  const HEAD = 130;
  const RH = 84; // row height
  const LH = HEAD + rows.length * RH + 24;
  const c = createCanvas(W, LH);
  const g = c.getContext('2d');

  g.beginPath();
  g.roundRect(0, 0, W, LH, 24);
  g.clip();
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, LH);
  g.globalAlpha = 0.06;
  g.drawImage(soulsIcon, W - 200, 12, 110, 110 * (soulsIcon.height / soulsIcon.width));
  g.globalAlpha = 1;

  g.textAlign = 'left';
  g.fillStyle = C.text;
  g.font = `52px ${TEXT_FONT}`;
  g.fillText('LEADERBOARD', 40, 72);
  g.fillStyle = C.muted;
  g.font = `22px ${TEXT_FONT}`;
  g.fillText(fit(g, `${serverName.toUpperCase()}  ·  TOP ${rows.length}`, W - 300), 42, 106);

  rows.forEach((r, i) => {
    const y = HEAD + i * RH;
    const mid = y + RH / 2;
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
    g.beginPath();
    g.roundRect(24, y + 4, W - 48, RH - 8, 12);
    g.fill();
    if (i < 3) {
      g.fillStyle = MEDAL[i];
      g.beginPath();
      g.roundRect(24, y + 4, 6, RH - 8, [12, 0, 0, 12]);
      g.fill();
    }

    g.textAlign = 'center';
    g.fillStyle = i < 3 ? MEDAL[i] : C.muted;
    g.font = '40px Retail';
    g.fillText(String(i + 1), 78, mid + 14);

    drawFlask(g, 150, mid + 4, 27, r.level, r.fill);

    g.textAlign = 'left';
    g.fillStyle = C.text;
    g.font = `32px ${TEXT_FONT}`;
    g.fillText(fit(g, r.name, 440), 200, mid + 2);
    g.fillStyle = C.muted;
    g.font = `18px ${TEXT_FONT}`;
    g.fillText(`LEVEL ${r.level}  ·  ${fmt(r.xp)} XP`, 202, mid + 26);

    // Souls on the right, like the in-game "$0 ITEM VALUE".
    g.textAlign = 'right';
    g.fillStyle = C.souls;
    g.font = '20px Retail';
    const lw = g.measureText('SOULS').width;
    g.fillText('SOULS', W - 56, mid + 12);
    g.font = '36px Retail';
    const nw = g.measureText(fmt(r.souls)).width;
    g.fillText(fmt(r.souls), W - 64 - lw, mid + 12);
    g.drawImage(soulsIcon, W - 64 - lw - nw - 28, mid - 16, 18, 32);
  });

  return c.toBuffer('image/png');
}

// Embed colour for a plain card (the flask liquid). Hero cards use the hero's colour (cardColor).
const cardColor = (hexColor) => parseInt(hexColor.slice(1), 16);
const CARD_COLOR = cardColor(C.liquid);

module.exports = { renderRankCard, renderLeaderboard, CARD_COLOR, cardColor };
