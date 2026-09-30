const P = 'D:/Projects/Discord Bots/Fairfax Industries/';
const { createCanvas, loadImage } = require(P + 'node_modules/@napi-rs/canvas');
const { halftone, grain, grainAndVignette } = require(P + 'src/utils/art.js');
const A = (f) => (/^[A-Za-z]:/.test(f) ? f : P + 'assets/' + f);
const OUT = P + 'Claude outputs/';
const fs = require('node:fs');
const img = {};
const L = async (f) => (img[f] ??= await loadImage(A(f)));

const FONT = '"Segoe UI", "Segoe UI Emoji"';
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

function wrap(g, text, w) {
  const out = []; let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
  }
  return [...out, line];
}

// Segments: 'text', {b:'bold'}, {ping:'@x'}, {img:'file', s:20}
async function drawLine(g, segs, x, y) {
  for (const s of segs) {
    if (typeof s === 'string' || s.b) {
      const t = typeof s === 'string' ? s : s.b;
      g.font = `${s.b ? '600 ' : ''}15px ${FONT}`; g.fillStyle = s.b ? '#fff' : '#dbdee1';
      g.fillText(t, x, y); x += g.measureText(t).width;
    } else if (s.ping) {
      g.font = `500 15px ${FONT}`; const w = g.measureText(s.ping).width;
      g.fillStyle = 'rgba(88,101,242,.3)'; rr(g, x, y - 15, w + 4, 20, 3); g.fill();
      g.fillStyle = '#c9cdfb'; g.fillText(s.ping, x + 2, y); x += w + 5;
    } else { const sz = s.s || 20; g.drawImage(await L(s.img), x + 1, y - 16, sz, sz); x += sz + 3; }
  }
}

const BTN = { primary: '#5865f2', secondary: '#4e5058', success: '#248046', danger: '#da373c' };

async function mock(o) {
  const W = 680, c = createCanvas(W, 1400), g = c.getContext('2d');

  g.textBaseline = 'alphabetic';
  let y = 26;
  g.font = `13px ${FONT}`; g.fillStyle = '#949ba4';
  for (const l of wrap(g, o.label, W - 40)) { g.fillText(l, 20, y); y += 18; }
  y += 14;
  // header
  g.fillStyle = '#5865f2'; g.beginPath(); g.arc(40, y + 20, 20, 0, 7); g.fill();
  g.drawImage(await L('card/souls.png'), 26, y + 6, 28, 28);
  g.font = `600 16px ${FONT}`; g.fillStyle = '#fff'; g.fillText('The Shopkeeper', 76, y + 16);
  let nx = 76 + g.measureText('The Shopkeeper').width + 6;
  g.fillStyle = '#5865f2'; rr(g, nx, y + 3, 30, 16, 3); g.fill();
  g.font = `600 10px ${FONT}`; g.fillStyle = '#fff'; g.fillText('APP', nx + 5, y + 15);
  g.font = `12px ${FONT}`; g.fillStyle = '#949ba4'; g.fillText('Today at 8:02 PM', nx + 38, y + 16);
  y += 26;
  // embed
  const ex = 76, ew = 540, top = y + 4; y = top + 16;
  const thumbW = o.thumb ? 80 : 0, tx = ex + 20, tw = ew - 36 - (thumbW ? thumbW + 16 : 0);
  if (o.author) {
    const a = await L(o.authorIcon);
    g.save(); g.beginPath(); g.arc(tx + 12, y + 8, 12, 0, 7); g.clip(); g.fillStyle = '#111'; g.fill(); g.drawImage(a, tx, y - 4, 24, 24); g.restore();
    g.font = `600 14px ${FONT}`; g.fillStyle = '#fff'; g.fillText(o.author, tx + 32, y + 13); y += 32;
  }
  if (o.title) { g.font = `600 16px ${FONT}`; g.fillStyle = '#fff'; g.fillText(o.title, tx, y + 10); y += 30; }
  for (const l of o.lines) {
    if (l.quote) { g.fillStyle = '#4e5058'; rr(g, tx, y - 6, 4, 22, 2); g.fill(); }
    if (l.length) await drawLine(g, l, l.quote ? tx + 14 : tx, y + 10); y += l.length ? (l.quote ? 22 : 24) : 10;
  }
  if (o.thumb) { const t = await L(o.thumb); g.drawImage(t, ex + ew - 16 - thumbW, top + 16, thumbW, thumbW * t.height / t.width); y = Math.max(y, top + 16 + thumbW * t.height / t.width + 4); }
  if (o.image) { y += 6; const im = await o.image(); const iw = ew - 36, ih = iw * im.height / im.width; rr(g, tx, y, iw, ih, 6); g.save(); g.clip(); g.drawImage(im, tx, y, iw, ih); g.restore(); y += ih + 4; }
  if (o.footer) { y += 6; g.font = `12px ${FONT}`; g.fillStyle = '#dbdee1'; for (const l of wrap(g, o.footer, ew - 36)) { g.fillText(l, tx, y + 10); y += 17; } }
  y += 14;
  // draw embed bg behind (redraw via compositing)
  g.save(); g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#2b2d31'; rr(g, ex, top, ew, y - top, 4); g.fill();
  g.fillStyle = o.color; rr(g, ex, top, 4, y - top, [4, 0, 0, 4]); g.fill();
  g.restore();

  y += 8;
  for (const row of o.buttons || []) {
    let bx = ex;
    for (const b of row) {
      g.font = `500 14px ${FONT}`; const iw = b.icon ? 22 : 0; const w = g.measureText(b.label).width + 32 + iw;
      g.globalAlpha = b.disabled ? 0.5 : 1;
      g.fillStyle = BTN[b.style || 'secondary']; rr(g, bx, y, w, 32, 4); g.fill();
      if (b.icon) g.drawImage(await L(b.icon), bx + 12, y + 7, 18, 18);
      g.fillStyle = '#fff'; g.fillText(b.label, bx + 16 + iw, y + 21);
      g.globalAlpha = 1; bx += w + 8;
    }
    y += 40;
  }
  y += 12;
  const out = createCanvas(W, y), og = out.getContext('2d');
  og.fillStyle = '#313338'; og.fillRect(0, 0, W, y); og.drawImage(c, 0, 0);
  fs.writeFileSync(OUT + o.file, out.toBuffer('image/png'));
}
module.exports = { mock, L, createCanvas, halftone, grain, grainAndVignette };
