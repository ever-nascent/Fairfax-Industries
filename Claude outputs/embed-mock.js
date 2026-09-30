// Discord-style mock of one bot message: node "Claude outputs/embed-mock.js" (runs in a temp DATA_DIR).
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-mock-'));
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { changeSouls } = require('../src/utils/xp');

const W = 640;
const strip = (t) => t.replace(/<a?:\w+:\d+>/g, '◆').replace(/\*\*/g, '').replace(/<@\w+>/g, '@Zechariah');

async function render(payload, file) {
  const e = payload.embeds[0].toJSON();
  const files = Object.fromEntries((payload.files ?? []).map((f) => [f.name, f.attachment]));
  const load = (url) => (url && files[url.replace('attachment://', '')] ? loadImage(files[url.replace('attachment://', '')]) : null);
  const [thumb, icon, image] = await Promise.all([load(e.thumbnail?.url), load(e.author?.icon_url), load(e.image?.url)]);
  const desc = (e.description ?? '').split('\n');
  const fields = e.fields ?? [];
  const full = fields.filter((f) => !f.inline);
  const inline = fields.filter((f) => f.inline);
  const imgH = image ? Math.round((W - 80) * image.height / image.width) : 0;
  const h = 58 + desc.length * 22 + full.length * 44 + (inline.length ? 44 : 0) + (imgH ? imgH + 12 : 0) + (e.footer ? 30 : 0) + 10;
  const rows = (payload.components ?? []).map((r) => r.toJSON().components);
  const c = createCanvas(W, 20 + h + 16 + rows.length * 44 + 10);
  const g = c.getContext('2d');
  g.fillStyle = '#313338'; g.fillRect(0, 0, c.width, c.height);
  const top = 20;
  g.fillStyle = '#2b2d31'; g.fillRect(20, top, W - 40, h);
  g.fillStyle = '#' + (e.color ?? 0).toString(16).padStart(6, '0'); g.fillRect(20, top, 4, h);
  if (icon) g.drawImage(icon, 36, top + 12, 24, 24);
  g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.fillText(e.author?.name ?? '', 68, top + 30);
  if (thumb) g.drawImage(thumb, W - 40 - 84, top + 14, 76, 76 * thumb.height / thumb.width);
  g.font = '14px sans-serif'; g.fillStyle = '#dbdee1';
  desc.forEach((l, i) => g.fillText(strip(l), 36, top + 58 + i * 22, W - 180));
  let y = top + 58 + desc.length * 22 + 8;
  for (const f of full) {
    g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText(f.name, 36, y);
    g.fillStyle = '#dbdee1'; g.font = '13px sans-serif'; g.fillText(strip(f.value), 36, y + 18);
    y += 44;
  }
  inline.forEach((f, i) => {
    g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText(f.name, 36 + i * 150, y);
    g.fillStyle = '#dbdee1'; g.font = '13px sans-serif'; g.fillText(strip(f.value), 36 + i * 150, y + 18);
  });
  if (inline.length) y += 44;
  if (image) { g.drawImage(image, 36, y - 10, W - 80, imgH); y += imgH + 12; }
  if (e.footer) { g.fillStyle = '#949ba4'; g.font = '12px sans-serif'; g.fillText(e.footer.text, 36, top + h - 14, W - 80); }
  y = top + h + 16;
  const colors = { 1: '#5865f2', 2: '#4e5058', 3: '#248046', 4: '#da373c' };
  for (const row of rows) {
    row.forEach((b, i) => {
      const w = 130;
      g.fillStyle = colors[b.style]; g.beginPath(); g.roundRect(24 + i * (w + 8), y, w, 36, 4); g.fill();
      g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.textAlign = 'center';
      g.fillText(b.label ?? '', 24 + i * (w + 8) + w / 2, y + 23);
      g.textAlign = 'left';
    });
    y += 44;
  }
  fs.writeFileSync(path.join(__dirname, file), c.toBuffer('image/png'));
}

(async () => {
  await changeSouls('u', 5000);
  const doorman = require('../src/utils/doorman');
  let msg = await doorman.startGame({ id: 'u' }, '@Zechariah', 100);
  const id = msg.components[0].toJSON().components[0].custom_id.split(':')[1];
  await render(msg, 'doorman-1-start.png');
  msg = await doorman.pickRoom(id, 'u', 0);
  await render(msg, 'doorman-2-pick.png');
  const game = await doorman.games().get(id);
  msg = await doorman.finishGame(id, 'u', game.prize === 0 ? 'stay' : 'switch');
  await render(msg, 'doorman-3-result.png');

  const sinclair = require('../src/utils/sinclair');
  await render(await sinclair.startGame({ id: 'u' }, '@Zechariah', 100), 'sinclair-start.png');

  const urn = require('../src/commands/xp/urn');
  const member = { toString: () => '@Zechariah', guild: { emojis: { cache: new Map() } } };
  await render(urn.claimedMessage(member, { souls: 150, user: { urnStreak: 4, souls: 5150 } }), 'urn-claimed.png');
})();

(async () => {
  if (process.argv[2] !== 'yamato') return;
  const y = require('../src/utils/yamato');
  await changeSouls('y', 5000);
  const msg = await y.startGame({ id: 'y' }, 'Zechariah', 100);
  await render(msg, 'yamato-1-pick.png');
  const id = msg.components[0].toJSON().components[0].custom_id.split(':')[1];
  await render(await y.play(id, 'y', ['power']), 'yamato-2-result.png');
})();
