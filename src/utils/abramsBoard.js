// Abrams' Interrogation: the case board picture (the mock-up he approved Oct 22). A corkboard with all 44 hero icons
// as suspects: ruled-out ones greyed and crossed out in red, the ones left circled and joined by red string, a paper
// "CASE FILE #" label on top and a status tag at the bottom. A duel draws two boards side by side, one per detective.
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ASSETS, seeded } = require('./art'); // art.js also registers the game fonts (Radiance, Retail)
const { HEROES } = require('./heroes');

const W = 640;
const H = 420;
const S = 50; // icon size
const GAP = 5;
const COLS = 11;
const PAPER = '#efe6cf';
const INK = '#2b1d12';
const RED = '#e8242b';
const GREEN = '#7cffc4';

// The 44 hero icons, loaded once.
let icons;
async function loadIcons() {
  if (icons) return icons;
  icons = {};
  for (const h of HEROES) icons[h.name] = await loadImage(path.join(ASSETS, 'heroes', `${h.slug}.png`)).catch(() => null);
  return icons;
}

// The cork texture, drawn once.
let cork;
function corkTexture() {
  if (cork) return cork;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = seeded(5);
  g.fillStyle = '#8a6a45';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(60,38,18,${rnd() * 0.35})` : `rgba(255,225,170,${rnd() * 0.18})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const v = g.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 420);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3b2412';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  cork = c;
  return cork;
}

// Shrinks the font until `text` fits `width`.
function fit(g, text, font, size, width, min = 5) {
  let s = size;
  g.font = `${s}px ${font}`;
  while (g.measureText(text).width > width && s > min) {
    s -= 0.5;
    g.font = `${s}px ${font}`;
  }
}

// One board at (ox, oy). board: { left: suspect names still in, caseNo, status (tag text), solved (a name circled
// green: the culprit caught), culprit (a name circled red: the one who got away), accused (a wrong pick, crossed out) }.
async function drawBoard(g, ox, oy, board) {
  const art = await loadIcons();
  g.save();
  g.translate(ox, oy);
  g.drawImage(corkTexture(), 0, 0);

  g.save();
  g.translate(W / 2, 44);
  g.rotate(-0.015);
  g.fillStyle = PAPER;
  g.fillRect(-170, -24, 340, 44);
  g.fillStyle = INK;
  g.font = '24px Radiance';
  g.textAlign = 'center';
  g.fillText(`CASE FILE #${board.caseNo}`, 0, 7);
  g.restore();

  const left = new Set(board.left);
  const x0 = (W - (COLS * S + (COLS - 1) * GAP)) / 2;
  const y0 = 92;
  const pos = {};
  for (const [i, h] of HEROES.entries()) {
    const x = x0 + (i % COLS) * (S + GAP);
    const y = y0 + Math.floor(i / COLS) * (S + GAP + 16);
    pos[h.name] = [x, y];
    const live = left.has(h.name) && h.name !== board.accused;
    g.fillStyle = PAPER;
    g.fillRect(x - 2, y - 2, S + 4, S + 16);
    g.fillStyle = live ? '#1c1a22' : '#55504a';
    g.fillRect(x, y, S, S);
    if (art[h.name]) {
      g.save();
      if (!live) g.globalAlpha = 0.3;
      g.drawImage(art[h.name], x + 2, y + 2, S - 4, S - 4);
      g.restore();
    }
    g.fillStyle = INK;
    g.textAlign = 'center';
    fit(g, h.name.toUpperCase(), 'Retail', 8, S + 2);
    g.fillText(h.name.toUpperCase(), x + S / 2, y + S + 10);
    if (!live) {
      g.strokeStyle = 'rgba(190,20,20,.9)';
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(x + 6, y + 6);
      g.lineTo(x + S - 6, y + S - 6);
      g.moveTo(x + S - 6, y + 6);
      g.lineTo(x + 6, y + S - 6);
      g.stroke();
    }
  }

  // red string between the suspects left (up to 8 of them, more is just a tangle), a circle and a pin on each
  const marked = board.solved ? [board.solved] : board.culprit ? [board.culprit] : HEROES.map((h) => h.name).filter((n) => left.has(n) && n !== board.accused);
  if (marked.length > 1 && marked.length <= 8) {
    g.strokeStyle = '#c4161c';
    g.lineWidth = 2.5;
    const pts = marked.map((n) => [pos[n][0] + S / 2, pos[n][1] - 4]);
    g.beginPath();
    g.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) g.quadraticCurveTo((pts[i - 1][0] + pts[i][0]) / 2, Math.min(pts[i - 1][1], pts[i][1]) - 40, ...pts[i]);
    g.stroke();
  }
  if (marked.length <= 8) {
    for (const n of marked) {
      const [x, y] = pos[n];
      g.strokeStyle = board.solved === n ? GREEN : RED;
      g.lineWidth = 4;
      g.beginPath();
      g.ellipse(x + S / 2, y + S / 2 + 4, S / 2 + 9, S / 2 + 13, 0, 0, 7);
      g.stroke();
      g.fillStyle = RED;
      g.beginPath();
      g.arc(x + S / 2, y - 4, 5, 0, 7);
      g.fill();
    }
  }

  g.save();
  g.translate(W / 2, H - 30);
  g.rotate(0.01);
  g.fillStyle = board.solved ? '#1f6b45' : '#7a1216';
  g.fillRect(-170, -18, 340, 34);
  g.fillStyle = '#f3e9dc';
  g.textAlign = 'center';
  fit(g, board.status, 'Radiance', 19, 320, 10);
  g.fillText(board.status, 0, 6);
  g.restore();
  g.restore();
}

// One case board, a PNG buffer.
async function renderBoard(board) {
  const c = createCanvas(W, H);
  await drawBoard(c.getContext('2d'), 0, 0, board);
  return c.toBuffer('image/png');
}

// A duel: two boards side by side, each under its detective's name. boards: [{ detective, ...board }, two of them].
async function renderDuel(boards) {
  const TOP = 40;
  const c = createCanvas(W * 2 + 20, H + TOP);
  const g = c.getContext('2d');
  g.fillStyle = '#1e1a16';
  g.fillRect(0, 0, c.width, c.height);
  for (const [i, b] of boards.entries()) {
    const ox = i * (W + 20);
    g.fillStyle = '#f3e9dc';
    g.textAlign = 'center';
    const label = `${b.detective.toUpperCase()}'S CASE`;
    fit(g, label, 'Radiance', 24, W - 40, 12);
    g.fillText(label, ox + W / 2, 29);
    await drawBoard(g, ox, TOP, b);
  }
  return c.toBuffer('image/png');
}

module.exports = { renderBoard, renderDuel };
