// Draws Silver's emojis (128 px) like the in-game ability icons (flat, sharp, one colour on transparent), white, hearts as outlines (a lost one is dim grey and cracked).
// node assets/silver/make_shells.js   ->   shell_live (solid), shell_blank (hollow hull), charge (outline heart), charge_lost (dim cracked outline)
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

const DIM = '#6b6f76';
const poly = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
const paint = (g, pts, hollow, color) => {
  poly(g, pts);
  if (hollow) { g.lineJoin = 'miter'; g.lineWidth = 9; g.strokeStyle = color; g.stroke(); } else { g.fillStyle = color; g.fill(); }
};
const WHITE = '#ffffff';
const cut = (g, x, y, w, h) => { g.globalCompositeOperation = 'destination-out'; g.fillRect(x, y, w, h); g.globalCompositeOperation = 'source-over'; };

const HULL = [[-18, -42], [-10, -54], [10, -54], [18, -42], [18, 20], [-18, 20]];
function shell(hollow) {
  const c = createCanvas(128, 128), g = c.getContext('2d');
  g.translate(64, 64); g.rotate(Math.PI / 4);
  paint(g, HULL, hollow, WHITE);
  paint(g, [[-18, 27], [18, 27], [18, 43], [-18, 43]], false, WHITE); // base
  paint(g, [[-25, 47], [25, 47], [25, 57], [-25, 57]], false, WHITE); // rim
  if (!hollow) cut(g, -20, -37, 40, 4); // crimp line
  cut(g, -30, 21, 60, 5); // gap between hull and base
  cut(g, -30, 43.5, 60, 3); // gap between base and rim
  return c;
}

const HEART = [[64, 114], [10, 60], [10, 36], [28, 16], [52, 16], [64, 30], [76, 16], [100, 16], [118, 36], [118, 60]];
function heart(color, cracked) {
  const c = createCanvas(128, 128), g = c.getContext('2d');
  paint(g, HEART, true, color);
  if (cracked) { // crack
    g.globalCompositeOperation = 'destination-out'; g.strokeStyle = '#000'; g.lineWidth = 8; g.lineJoin = 'miter';
    g.beginPath(); g.moveTo(64, 26); g.lineTo(52, 56); g.lineTo(74, 72); g.lineTo(60, 108); g.stroke();
  }
  return c;
}

const EMOJIS = { shell_live: shell(false), shell_blank: shell(true), charge: heart(WHITE, false), charge_lost: heart(DIM, true) };
for (const [name, canvas] of Object.entries(EMOJIS)) fs.writeFileSync(path.join(__dirname, `${name}.png`), canvas.toBuffer('image/png'));
