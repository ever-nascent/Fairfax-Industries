// Shop item pictures for the hero screen: the in-game shop art from deadlock-api.com (unofficial), saved to assets/lockle/items on first use
// (Lockle keeps its pictures in the same folder under the same names). `missing()` lists items without a picture, `fetchMissing()` downloads them.
const fs = require('node:fs');
const path = require('node:path');
const { ASSETS } = require('../art');
const { ITEM_POOL, LEGENDARY_NAMES } = require('./levels');

const DIR = path.join(ASSETS, 'lockle', 'items');
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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

module.exports = { itemFile, missing, fetchMissing };
