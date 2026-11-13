// Shop item pictures for the hero screen: the in-game shop art from deadlock-api.com (unofficial), saved to assets/lockle/items on first use
// (Lockle keeps its pictures in the same folder under the same names). `missing()` lists items without a picture, `fetchMissing()` downloads them.
const fs = require('node:fs');
const path = require('node:path');
const { ASSETS } = require('../art');
const { ITEM_POOL, LEGENDARY_NAMES } = require('./levels');

const DIR = path.join(ASSETS, 'lockle', 'items');
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
// What the game lays over a corrupted item's picture (the wiki's Item frame corrupted, 300 x 300, transparent in the middle; his ask, Oct 30: every corrupted item looks like this everywhere).
const CORRUPTED_FRAME = path.join(ASSETS, 'farm', 'ui', 'item_frame_corrupted.png');
// What the wiki lays over an enhanced item's picture (his paste of its CSS, Oct 30): linear-gradient(45deg, rgba(63,220,255,0.56) 20%, transparent 80%),
// i.e. blue in the bottom-left fading out towards the top-right. Fills the square at (x, y), `w` x `h`, on a canvas context.
function enhancedOverlay(g, x, y, w, h) {
  const half = ((w + h) * Math.SQRT1_2) / 2 * Math.SQRT1_2; // half the CSS gradient line's length, split into x and y
  const grad = g.createLinearGradient(x + w / 2 - half, y + h / 2 + half, x + w / 2 + half, y + h / 2 - half);
  grad.addColorStop(0.2, 'rgba(63,220,255,0.56)');
  grad.addColorStop(0.8, 'rgba(63,220,255,0)');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
}
const { crackOverlay } = require('./fragileGlass'); // the broken glass over a Fragile Item's picture (Descend's Broker)
// A cracked item's picture on its own (the Broker's stall): the shop art with crackOverlay over it, as a JPEG (no see-through parts).
async function crackedPicture(name, size = 192) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = '#2a2d33';
  g.fillRect(0, 0, size, size);
  try { g.drawImage(await loadImage(itemFile(name)), 0, 0, size, size); } catch { /* no shop art: the cracks over a plain square */ }
  crackOverlay(g, 0, 0, size, size, name);
  return require('../art').jpeg(c);
}
const itemFile = (name) => path.join(DIR, `${slug(name)}.png`);
const missing = () => [...ITEM_POOL, ...LEGENDARY_NAMES].filter((name) => !fs.existsSync(itemFile(name)));

async function fetchMissing() {
  const todo = missing();
  if (!todo.length) return [];
  const res = await fetch('https://api.deadlock-api.com/v1/assets/items', { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const byName = new Map((await res.json()).map((i) => [i.name, i]));
  fs.mkdirSync(DIR, { recursive: true });
  const failed = [];
  for (const name of todo) {
    const url = byName.get(name)?.shop_image;
    try {
      if (!url) throw new Error('no picture in the item list');
      const img = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!img.ok) throw new Error(`HTTP ${img.status}`);
      fs.writeFileSync(itemFile(name), Buffer.from(await img.arrayBuffer()));
    } catch (error) {
      console.error(`[farm] No picture for ${name}: ${error.message}`);
      failed.push(name);
    }
  }
  return failed;
}

module.exports = { enhancedOverlay, crackOverlay, crackedPicture, CORRUPTED_FRAME, itemFile, missing, fetchMissing };
