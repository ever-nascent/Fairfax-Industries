// Makes the ability and item emojis (an icon next to each ability and item name in fights, the hero screen and the
// Damage Breakdown). Every fight ability -> assets/emojis/a_<name>.png (the wiki's white icon on a dark circle, so it shows on Discord's light
// theme too); every shop item and legendary -> assets/emojis/i_<name>.png (its shop picture). The bot uploads them at its next start
// (src/utils/appEmojis.js). An ability icon missing from assets/trivia/abilities is downloaded from deadlock.wiki first.
// Run after adding a hero or an item: `node tools/icon-emojis.js` (test/appEmojis.test.js fails while one is missing). Never touches data/.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { wikiFetch } = require('../src/utils/wikiFetch');
const { ITEM_POOL, LEGENDARY_NAMES } = require('../src/utils/farm/levels');
const { itemFile } = require('../src/utils/farm/itemArt');
const { abilityEmojiName, itemEmojiName, slug } = require('../src/utils/farm/icons');

const ASSETS = path.join(__dirname, '..', 'assets');
const OUT = path.join(ASSETS, 'emojis');
const ABILITY_ICONS = path.join(ASSETS, 'trivia', 'abilities');
const UA = 'Mozilla/5.0 (fairfax-icon-emojis)';
const SIZE = 128;

async function wikiIcon(name, file) {
  const q = new URLSearchParams({ action: 'query', titles: `File:${name}.png`, prop: 'imageinfo', iiprop: 'url', format: 'json', formatversion: 2 });
  const page = (await (await wikiFetch(`https://deadlock.wiki/api.php?${q}`, { userAgent: UA })).json()).query.pages[0];
  if (!page.imageinfo) throw new Error(`the wiki has no File:${name}.png`);
  fs.writeFileSync(file, Buffer.from(await (await wikiFetch(page.imageinfo[0].url, { userAgent: UA })).arrayBuffer()));
}

async function abilityEmoji(src) {
  const c = createCanvas(SIZE, SIZE);
  const g = c.getContext('2d');
  g.fillStyle = '#1b1d21';
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4a4f58'; g.lineWidth = 4;
  g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2); g.stroke();
  const img = await loadImage(src);
  const fit = SIZE * 0.68;
  const scale = fit / Math.max(img.width, img.height);
  g.drawImage(img, (SIZE - img.width * scale) / 2, (SIZE - img.height * scale) / 2, img.width * scale, img.height * scale);
  return c.toBuffer('image/png');
}

async function itemEmoji(src) {
  const c = createCanvas(SIZE, SIZE);
  c.getContext('2d').drawImage(await loadImage(src), 0, 0, SIZE, SIZE);
  return c.toBuffer('image/png');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const abilities = [...new Set(Object.values(require('../assets/farm/abilities.json')).map((a) => a.Name))];
  let made = 0;
  const failed = [];
  for (const name of abilities) {
    const src = path.join(ABILITY_ICONS, `${slug(name)}.png`);
    try {
      if (!fs.existsSync(src)) { await wikiIcon(name, src); console.log(`Downloaded ${name}'s icon`); }
      fs.writeFileSync(path.join(OUT, `${abilityEmojiName(name)}.png`), await abilityEmoji(src));
      made++;
    } catch (e) { failed.push(`${name}: ${e.message}`); }
  }
  for (const name of [...ITEM_POOL, ...LEGENDARY_NAMES]) {
    try { fs.writeFileSync(path.join(OUT, `${itemEmojiName(name)}.png`), await itemEmoji(itemFile(name))); made++; } catch (e) { failed.push(`${name}: ${e.message}`); }
  }
  // Map icons from deadlock.wiki's Cursed Apple page: the power-ups (our bridge buffs, keyed as in buffs.js BRIDGE), the
  // Teleporter, the Curiosity Shop and the Vault Camp (Sinner's Sacrifice). The small minimap ones are scaled up without smoothing.
  const MAP = { powerup_casting: 'farm/bridge/casting.png', powerup_gun: 'farm/bridge/gun.png', powerup_movement: 'farm/bridge/movement.png', powerup_survival: 'farm/bridge/survival.png',
    teleporter: 'farm/icons/teleporter.png', curiosity_shop: 'shop/art/shop_icon.png', vault_camp: 'farm/icons/vault-camp.png' };
  for (const [name, rel] of Object.entries(MAP)) {
    const img = await loadImage(path.join(ASSETS, rel));
    const c = createCanvas(SIZE, SIZE);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = img.width >= 64;
    const scale = SIZE / Math.max(img.width, img.height);
    g.drawImage(img, (SIZE - img.width * scale) / 2, (SIZE - img.height * scale) / 2, img.width * scale, img.height * scale);
    fs.writeFileSync(path.join(OUT, `${name}.png`), c.toBuffer('image/png'));
    made++;
  }
  console.log(`Made ${made} emoji pictures in assets/emojis.`);
  if (failed.length) { console.log(`Failed:\n  ${failed.join('\n  ')}`); process.exitCode = 1; }
}

main();
