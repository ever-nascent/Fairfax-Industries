// Shared drawing helpers for the bot's images: the game fonts, the souls glyph, and the Deadlock comic look
// (halftone dots, film grain, vignette).
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const SOULS_PNG = path.join(ASSETS, 'card', 'souls.png'); // deadlock.wiki
// The game's fonts (deadlock.wiki).
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Radiance-Bold.woff2'), 'Radiance');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Retaildemo-bold.woff2'), 'Retail');

let souls;
const loadSouls = async () => (souls ??= await loadImage(SOULS_PNG));
// The souls glyph is 44x77: draw it by height so it keeps its shape.
const drawSouls = (g, img, x, y, h) => g.drawImage(img, x, y, (h * img.width) / img.height, h);

// Seeded random, so textures come out the same in every image.
const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// Comic halftone dots over a box. amount(u, v) is the dot size (0..1) at u, v (0..1 across the box).
function halftone(g, x, y, w, h, step, amount, color) {
  g.fillStyle = color;
  for (let py = y, row = 0; py < y + h + step; py += step, row++) {
    for (let px = x + (row % 2 ? step / 2 : 0); px < x + w + step; px += step) {
      const r = amount((px - x) / w, (py - y) / h) * step * 0.62;
      if (r > 0.3) {
        g.beginPath();
        g.arc(px, py, r, 0, 7);
        g.fill();
      }
    }
  }
}

// Grey film-grain texture for grainAndVignette(). Make it once and keep it.
function grain(w, h, seed, strength) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = seeded(seed);
  const img = g.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + (rnd() - 0.5) * strength;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// The last layer of every game image: film grain, then a dark vignette from radius `inner` to `outer`.
function grainAndVignette(g, w, h, grainTexture, { grainAlpha, inner, outer, dark }) {
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = grainAlpha;
  g.drawImage(grainTexture, 0, 0);
  g.restore();
  const vig = g.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, `rgba(0,0,0,${dark})`);
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
}

module.exports = { ASSETS, SOULS_PNG, loadSouls, drawSouls, seeded, halftone, grain, grainAndVignette };
