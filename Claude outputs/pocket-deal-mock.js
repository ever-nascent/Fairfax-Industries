process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-mock-'));
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { changeSouls } = require('../src/utils/xp');
const pocket = require('../src/utils/pocket');

const W = 620;
const strip = (t) => t.replace(/<a?:\w+:\d+>/g, '◆').replace(/\*\*/g, '').replace(/~~/g, '');

async function render(payload, file) {
  const e = payload.embeds[0].toJSON();
  const files = Object.fromEntries(payload.files.map((f) => [f.name, f.attachment]));
  const thumb = await loadImage(files[e.thumbnail.url.replace('attachment://', '')]);
  const icon = await loadImage(files[e.author.icon_url.replace('attachment://', '')]);
  const desc = e.description.split('\n');
  const rows = payload.components.map((r) => r.toJSON().components);
  const H = 60 + desc.length * 22 + 110 + 30 + rows.length * 44 + 50 + 90;
  const c = createCanvas(W, Math.max(H, 520));
  const g = c.getContext('2d');
  g.fillStyle = '#313338'; g.fillRect(0, 0, c.width, c.height);
  const top = 20, h = 70 + desc.length * 22 + 100;
  g.fillStyle = '#2b2d31'; g.fillRect(20, top, W - 40, h);
  g.fillStyle = '#' + e.color.toString(16).padStart(6, '0'); g.fillRect(20, top, 4, h);
  g.drawImage(icon, 36, top + 12, 24, 24);
  g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.fillText(e.author.name, 68, top + 30);
  g.drawImage(thumb, W - 40 - 84, top + 14, 76, 104);
  g.font = '14px sans-serif'; g.fillStyle = '#dbdee1';
  desc.forEach((l, i) => g.fillText(strip(l), 36, top + 58 + i * 22, W - 180));
  let y = top + 58 + desc.length * 22 + 14;
  e.fields?.forEach((f, i) => {
    g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText(f.name, 36 + i * 150, y);
    g.fillStyle = '#dbdee1'; g.font = '13px sans-serif'; g.fillText(strip(f.value), 36 + i * 150, y + 18);
  });
  if (e.footer) { g.fillStyle = '#949ba4'; g.font = '12px sans-serif'; g.fillText(e.footer.text, 36, top + h - 12, W - 80); }
  y = top + h + 16;
  const colors = { 1: '#5865f2', 2: '#4e5058', 3: '#248046', 4: '#da373c' };
  for (const row of rows) {
    row.forEach((b, i) => {
      const w = row.length > 2 ? 100 : 170;
      g.fillStyle = colors[b.style]; g.globalAlpha = b.disabled ? 0.5 : 1;
      g.beginPath(); g.roundRect(24 + i * (w + 8), y, w, 36, 4); g.fill();
      g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.textAlign = 'center';
      g.fillText((b.emoji ? '💼 ' : '') + (b.label ?? ''), 24 + i * (w + 8) + w / 2, y + 23);
      g.textAlign = 'left'; g.globalAlpha = 1;
    });
    y += 44;
  }
  fs.writeFileSync(path.join(__dirname, file), c.toBuffer('image/png'));
}

(async () => {
  await changeSouls('u', 5000);
  const values = pocket.VALUES;
  let msg = await pocket.startGame({ id: 'u' }, 'u', 100, values);
  const id = msg.components[0].toJSON().components[0].custom_id.split(':')[1];
  await render(msg, 'pocket-1-pick.png');
  await pocket.move(id, 'u', '6');
  for (const i of [0, 1, 2, 3, 19]) msg = await pocket.move(id, 'u', String(i));
  await render(msg, 'pocket-2-offer.png');
  msg = await pocket.move(id, 'u', 'deal');
  await render(msg, 'pocket-3-result.png');
})();
