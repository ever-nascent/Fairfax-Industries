// The picture for Don't Wake the Bookwyrm (paige.js): an open storybook on a dark desk. The left page holds the Bookwyrm (paigeWyrm.js: it changes
// every 2 wrong guesses and wakes on the 6th), the guesses left as souls icons and, once the game is over, a stamp; the right page holds the chapter
// (Heroes / Abilities / Items), the word as blanks and the wrong letters as ink blots. Satin bookmark, leather cover, candlelight: all drawn here.
// Everything that never changes (desk, cover, pages, ribbon) is drawn once and copied. Look: server-plan.md ("Games").
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ASSETS, loadSouls, seeded } = require('./art');
const wyrm = require('./paigeWyrm');

const SERIF = "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif"; // Windows ships Palatino; elsewhere the next one that exists
const INK = '#2a1a10';
const RED_INK = '#9e2418';
const GOLD = '#d8b25a';
const W = 1000, H = 560;
const MAX_WRONG = 6;
const B = { left: 70, right: W - 70, top: 58, bottom: H - 62, spine: W / 2, dip: 16, lift: 10 }; // the book's geometry
const PAGE = { left: 110, right: 464, top: 150, bottom: 402 }; // where the Bookwyrm may draw

let art;
async function loadArt() {
  art ??= (async () => ({ wyrm: await loadImage(path.join(ASSETS, 'paige', 'bookwyrm.png')), souls: await loadSouls() }))();
  return art;
}

// A picture recoloured: the shape of `img` in one flat colour.
function tint(img, color) {
  const c = createCanvas(img.width, img.height);
  const t = c.getContext('2d');
  t.drawImage(img, 0, 0);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = color;
  t.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---- the parts that never change -----------------------------------------------------------------------------------

function desk(g) { // dark wood, a candle's warm light from the top left, a few of Paige's green sparks
  g.fillStyle = '#1a110b'; g.fillRect(0, 0, W, H);
  const rnd = seeded(5);
  for (let y = 0; y < H; y += 3) {
    g.strokeStyle = `rgba(${90 + rnd() * 40},${55 + rnd() * 25},${30 + rnd() * 15},${0.10 + rnd() * 0.12})`;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= W; x += 50) g.lineTo(x, y + Math.sin(x / 140 + y / 37) * 3);
    g.stroke();
  }
  const light = g.createRadialGradient(W * 0.25, -40, 20, W * 0.35, H * 0.3, W * 0.9);
  light.addColorStop(0, 'rgba(255,190,110,0.35)'); light.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = light; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 2.5;
    const s = g.createRadialGradient(x, y, 0, x, y, r * 4);
    s.addColorStop(0, 'rgba(140,255,170,0.9)'); s.addColorStop(1, 'rgba(140,255,170,0)');
    g.fillStyle = s; g.beginPath(); g.arc(x, y, r * 4, 0, 7); g.fill();
  }
}

function pageShape(g, side, inset = 0) { // a page's outline: top and bottom edges dip into the spine
  const out = side === 'left' ? B.left + inset : B.right - inset;
  const s = B.spine;
  const t = B.top + inset * 0.4, b = B.bottom - inset * 0.4;
  g.beginPath();
  g.moveTo(out, t + B.lift);
  g.bezierCurveTo((out * 2 + s) / 3, t - 8, (out + s * 2) / 3, t - 4, s, t + B.dip);
  g.lineTo(s, b + B.dip * 0.6);
  g.bezierCurveTo((out + s * 2) / 3, b + 6, (out * 2 + s) / 3, b + 10, out, b - B.lift * 0.3);
  g.closePath();
}

function cover(g) { // the leather cover round the pages, with gold tooling and corners
  const box = [B.left - 26, B.top - 22, B.right - B.left + 52, B.bottom - B.top + 56];
  g.save(); g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
  g.fillStyle = '#4a1712'; g.beginPath(); g.roundRect(...box, 18); g.fill(); g.restore();
  const leather = g.createLinearGradient(0, B.top, 0, B.bottom);
  leather.addColorStop(0, '#7a2419'); leather.addColorStop(1, '#4f140e');
  g.fillStyle = leather; g.beginPath(); g.roundRect(...box, 18); g.fill();
  g.strokeStyle = GOLD; g.globalAlpha = 0.75; g.lineWidth = 2; g.setLineDash([2, 5]);
  g.beginPath(); g.roundRect(B.left - 17, B.top - 13, B.right - B.left + 34, B.bottom - B.top + 38, 12); g.stroke();
  g.setLineDash([]); g.globalAlpha = 1;
  for (const [x, y, sx, sy] of [[B.left - 26, B.top - 22, 1, 1], [B.right + 26, B.top - 22, -1, 1], [B.left - 26, B.bottom + 34, 1, -1], [B.right + 26, B.bottom + 34, -1, -1]]) {
    g.fillStyle = GOLD; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 34 * sx, y); g.quadraticCurveTo(x + 12 * sx, y + 12 * sy, x, y + 34 * sy); g.closePath(); g.fill();
    g.fillStyle = '#8a6a2a'; g.beginPath(); g.arc(x + 10 * sx, y + 10 * sy, 3, 0, 7); g.fill();
  }
}

function pages(g) { // the page block's thickness, the paper, its fibres and age spots, the shadow down the gutter
  for (const side of ['left', 'right']) {
    for (let i = 7; i >= 1; i--) {
      g.save(); g.translate(side === 'left' ? -i * 1.2 : i * 1.2, i * 1.6);
      pageShape(g, side); g.fillStyle = i % 2 ? '#d9c79c' : '#c7b283'; g.fill(); g.restore();
    }
  }
  for (const side of ['left', 'right']) {
    pageShape(g, side);
    const paper = g.createLinearGradient(side === 'left' ? B.left : B.right, 0, B.spine, 0);
    paper.addColorStop(0, '#e9d8b0'); paper.addColorStop(0.25, '#f5e9cc'); paper.addColorStop(0.8, '#f1e2c0'); paper.addColorStop(0.95, '#cfb98b'); paper.addColorStop(1, '#a89066');
    g.fillStyle = paper; g.fill();
  }
  g.save(); pageShape(g, 'left'); pageShape(g, 'right'); g.clip();
  const rnd = seeded(21);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(120,85,40,${rnd() * 0.06})`; g.fillRect(B.left + rnd() * (B.right - B.left), B.top + rnd() * (B.bottom - B.top + 20), 1 + rnd() * 3, 1); }
  for (let i = 0; i < 9; i++) {
    const x = B.left + rnd() * (B.right - B.left), y = B.top + rnd() * (B.bottom - B.top), r = 8 + rnd() * 30;
    const s = g.createRadialGradient(x, y, 0, x, y, r); s.addColorStop(0, 'rgba(150,105,50,0.10)'); s.addColorStop(1, 'rgba(150,105,50,0)');
    g.fillStyle = s; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const gut = g.createLinearGradient(B.spine - 60, 0, B.spine + 60, 0);
  gut.addColorStop(0, 'rgba(80,50,20,0)'); gut.addColorStop(0.45, 'rgba(80,50,20,0.28)'); gut.addColorStop(0.5, 'rgba(60,35,12,0.5)'); gut.addColorStop(0.55, 'rgba(80,50,20,0.28)'); gut.addColorStop(1, 'rgba(80,50,20,0)');
  g.fillStyle = gut; g.fillRect(B.spine - 60, 0, 120, H);
  g.restore();
}

function frames(g) { // an ink frame inside each page with little flourishes at the corners
  g.strokeStyle = 'rgba(110,70,30,0.55)'; g.lineWidth = 1.5;
  for (const [x0, x1] of [[B.left + 34, B.spine - 30], [B.spine + 30, B.right - 34]]) {
    const y0 = B.top + 34, y1 = B.bottom - 22;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeRect(x0 + 5, y0 + 5, x1 - x0 - 10, y1 - y0 - 10);
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      g.beginPath(); g.moveTo(x + 5 * sx, y + 22 * sy); g.bezierCurveTo(x + 18 * sx, y + 18 * sy, x + 18 * sx, y + 18 * sy, x + 22 * sx, y + 5 * sy); g.stroke();
      g.fillStyle = 'rgba(110,70,30,0.6)'; g.beginPath(); g.arc(x + 13 * sx, y + 13 * sy, 2.5, 0, 7); g.fill();
    }
  }
}

// A satin bookmark: it comes out of the spine at the top, drapes down the right page in loose S-curves (twisting as it goes: narrow where it
// turns edge-on, lit where it faces up) and hangs over the bottom edge in a notched tail.
function ribbon(g) {
  const N = 90;
  const bez = (t, a, b, c, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
  const P = [[B.spine + 4, B.top + 6], [B.spine + 70, B.top + 170], [B.spine - 30, B.bottom - 150], [B.spine + 84, B.bottom + 34]];
  const centre = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    return [bez(t, P[0][0], P[1][0], P[2][0], P[3][0]) + Math.sin(t * Math.PI * 3.2) * 16 * t, bez(t, P[0][1], P[1][1], P[2][1], P[3][1])];
  });
  const twist = (t) => Math.cos(t * Math.PI * 2.6 + 0.4); // -1..1: which side of the satin faces up
  const half = (t) => 11 * (0.45 + 0.55 * Math.abs(twist(t))) * (t > 0.9 ? 1 + (t - 0.9) * 4 : 1); // it fans out a little towards the tail
  const edges = centre.map(([x, y], i) => {
    const [ax, ay] = centre[Math.max(0, i - 1)], [bx, by] = centre[Math.min(N, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
    const h = half(i / N);
    return { l: [x + nx * h, y + ny * h], r: [x - nx * h, y - ny * h], dir: [(bx - ax) / len, (by - ay) / len] };
  });
  g.save(); g.translate(5, 7); g.globalAlpha = 0.25; g.fillStyle = '#3a2410'; // its shadow on the page
  g.beginPath(); edges.forEach((e, i) => (i ? g.lineTo(...e.l) : g.moveTo(...e.l))); [...edges].reverse().forEach((e) => g.lineTo(...e.r)); g.closePath(); g.fill();
  g.restore();
  for (let i = 0; i < N; i++) { // the satin, one strip at a time, shaded by how it faces the light
    const light = 0.5 + 0.5 * twist(i / N);
    g.fillStyle = `rgb(${Math.round(22 + 40 * light)},${Math.round(92 + 70 * light)},${Math.round(52 + 45 * light)})`;
    g.beginPath(); g.moveTo(...edges[i].l); g.lineTo(...edges[i + 1].l); g.lineTo(...edges[i + 1].r); g.lineTo(...edges[i].r); g.closePath(); g.fill();
    g.strokeStyle = g.fillStyle; g.lineWidth = 1; g.stroke(); // no seams between strips
  }
  g.lineCap = 'butt';
  for (let i = 0; i < N; i++) { // a sheen down the middle where it faces up, darker hems along both edges
    const tw = twist(i / N);
    if (tw > 0.2) { g.strokeStyle = `rgba(220,255,225,${0.3 * tw})`; g.lineWidth = 4; g.beginPath(); g.moveTo(...centre[i]); g.lineTo(...centre[i + 1]); g.stroke(); }
    g.strokeStyle = 'rgba(10,45,25,0.55)'; g.lineWidth = 1.5;
    for (const side of ['l', 'r']) { g.beginPath(); g.moveTo(...edges[i][side]); g.lineTo(...edges[i + 1][side]); g.stroke(); }
  }
  const end = edges[N], [cx, cy] = centre[N];
  const notch = [cx - end.dir[0] * 4, cy - end.dir[1] * 4]; // the notched (swallowtail) end
  const tipL = [end.l[0] + end.dir[0] * 18, end.l[1] + end.dir[1] * 18], tipR = [end.r[0] + end.dir[0] * 18, end.r[1] + end.dir[1] * 18];
  g.fillStyle = `rgb(${22 + 40 * (0.5 + 0.5 * twist(1))},${92 + 70 * (0.5 + 0.5 * twist(1))},70)`;
  g.beginPath(); g.moveTo(...end.l); g.lineTo(...tipL); g.lineTo(...notch); g.lineTo(...tipR); g.lineTo(...end.r); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(10,45,25,0.55)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(...tipL); g.lineTo(...notch); g.lineTo(...tipR); g.stroke();
}

let background; // the desk, book and bookmark, drawn once
function backdrop() {
  if (!background) {
    background = createCanvas(W, H);
    const g = background.getContext('2d');
    desk(g); cover(g); pages(g); frames(g); ribbon(g);
  }
  return background;
}

// ---- the parts that change -------------------------------------------------------------------------------------------

const LEFT_CX = (B.left + B.spine) / 2 + 6;

// The left page: the heading, the Bookwyrm, the guesses left as souls icons (colour = a guess still to spend, grey = spent) and how many are left.
function leftPage(g, { wrong, loaded, over }) {
  const woke = wrong >= MAX_WRONG;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `italic 24px ${SERIF}`; g.fillStyle = woke ? RED_INK : INK;
  g.fillText(woke ? 'The Bookwyrm Wakes' : "Don't Wake the Bookwyrm", LEFT_CX, B.top + 74);
  g.strokeStyle = 'rgba(110,70,30,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(LEFT_CX - 90, B.top + 86); g.lineTo(LEFT_CX + 90, B.top + 86); g.stroke();
  const size = 240;
  wyrm.draw(g, { art: loaded, cx: LEFT_CX, y: B.top + 100, size, stage: Math.min(3, Math.floor(wrong / 2)), seeded, createCanvas, PAGE, SERIF });
  if (over) return; // the stamp takes the souls row's place
  const h = 34, w = (h * loaded.souls.width) / loaded.souls.height;
  const grey = tint(loaded.souls, '#8f7e60');
  const dark = tint(loaded.souls, '#1d4a3c');
  for (let i = 0; i < MAX_WRONG; i++) {
    const sx = LEFT_CX - 100 + i * 40 - w / 2, sy = B.bottom - 72 - h / 2;
    if (i < MAX_WRONG - wrong) { // a dark outline so the mint reads on cream paper
      g.drawImage(dark, sx + 1.5, sy + 1.5, w, h); g.drawImage(dark, sx - 1.5, sy - 1.5, w, h); g.drawImage(loaded.souls, sx, sy, w, h);
    } else { g.globalAlpha = 0.45; g.drawImage(grey, sx, sy, w, h); g.globalAlpha = 1; }
  }
  g.font = `italic 19px ${SERIF}`; g.fillStyle = 'rgba(42,26,16,0.75)';
  g.fillText(`${MAX_WRONG - wrong} wrong ${MAX_WRONG - wrong === 1 ? 'guess' : 'guesses'} left`, LEFT_CX, B.bottom - 40);
}

// Each wrong letter (a '?' for a wrong solve): its letter knocked out of a spilled-ink blot, cream on dark, with spatter and a drip.
function blots(g, wrong, cx) {
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `italic 20px ${SERIF}`; g.fillStyle = 'rgba(110,70,30,0.9)';
  g.fillText('Blotted out', cx, B.bottom - 96);
  const gap = 46, wy = B.bottom - 50, startX = cx - ((wrong.length - 1) * gap) / 2;
  wrong.forEach((ch, i) => {
    const wx = startX + i * gap, rnd = seeded(31 + ch.charCodeAt(0) * 7);
    g.fillStyle = 'rgba(30,18,10,0.88)';
    g.beginPath();
    for (let k = 0; k <= 20; k++) { const a = (k / 20) * Math.PI * 2, r = 17 + rnd() * 6; g.lineTo(wx + Math.cos(a) * r, wy - 12 + Math.sin(a) * r); }
    g.closePath(); g.fill();
    for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(wx + (rnd() - 0.5) * 50, wy - 12 + (rnd() - 0.5) * 44, 1.2 + rnd() * 2.2, 0, 7); g.fill(); }
    g.fillRect(wx + 4 + rnd() * 4, wy, 3, 6 + rnd() * 8);
    g.font = `bold 26px ${SERIF}`; g.fillStyle = '#f2e5c6'; g.fillText(ch, wx, wy - 2);
  });
}

// Lays the word out in blanks: letters (A-Z) get a slot with a line, anything else (space, ' - & , ! digits) is just printed. Words wrap onto
// at most 3 lines, as large as will fit. Returns { size, lines: [[{ ch, x }]], width } with x measured from each line's left edge.
function layout(word, avail) {
  const widths = (size) => (ch) => (/[A-Z]/.test(ch) ? size : size * 0.5);
  const attempt = (size) => {
    const w = widths(size);
    const words = word.split(' ');
    const lines = [[]];
    let used = 0;
    for (const token of words) {
      const tokenW = [...token].reduce((sum, ch) => sum + w(ch), 0);
      if (used && used + size * 0.6 + tokenW > avail) { lines.push([]); used = 0; }
      if (used) used += size * 0.6;
      const line = lines.at(-1);
      for (const ch of token) { line.push({ ch, x: used }); used += w(ch); }
    }
    return { size, lines, width: (line) => (line.length ? line.at(-1).x + w(line.at(-1).ch) : 0) };
  };
  for (let size = 46; size >= 18; size -= 2) {
    const fit = attempt(size);
    if (fit.lines.every((line) => fit.width(line) <= avail) && fit.lines.length <= (size >= 34 ? 2 : 3)) return fit;
  }
  return attempt(18);
}

// The right page: the chapter with an illuminated capital, the word as blanks, the wrong letters as ink blots.
// `over`: the game is finished, so the whole word shows and the letters never found are in red.
function rightPage(g, { word, hits, wrong, category, over }) {
  const x0 = B.spine + 62, x1 = B.right - 62, cx = (x0 + x1) / 2;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `18px ${SERIF}`; g.fillStyle = 'rgba(110,70,30,0.85)';
  g.fillText('— CHAPTER —', cx, B.top + 64);
  g.font = `bold 44px ${SERIF}`;
  const first = category[0], capW = g.measureText(first).width;
  g.font = `italic 30px ${SERIF}`;
  const rest = category.slice(1), restW = g.measureText(rest).width;
  const startX = cx - (capW + restW + 6) / 2;
  g.fillStyle = '#7a2419'; g.beginPath(); g.roundRect(startX - 8, B.top + 72, capW + 16, 52, 6); g.fill();
  g.strokeStyle = GOLD; g.lineWidth = 2; g.stroke();
  g.font = `bold 44px ${SERIF}`; g.fillStyle = GOLD; g.textAlign = 'left'; g.fillText(first, startX, B.top + 114);
  g.font = `italic 30px ${SERIF}`; g.fillStyle = INK; g.fillText(rest, startX + capW + 12, B.top + 112);

  const fit = layout(word, x1 - x0);
  const pitch = fit.size + 26, block = (fit.lines.length - 1) * pitch + fit.size;
  const rnd = seeded(word.length * 7 + word.charCodeAt(0));
  let ly = 200 + (172 - block) / 2 + fit.size * 0.8; // centred between the chapter and the blots
  g.lineCap = 'round';
  for (const line of fit.lines) {
    const left = cx - fit.width(line) / 2;
    for (const { ch, x } of line) {
      const letter = /[A-Z]/.test(ch);
      const slot = letter ? fit.size : fit.size * 0.5;
      const lx = left + x;
      if (letter) { g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(lx + 5, ly + 10); g.quadraticCurveTo(lx + slot / 2, ly + 12 + (rnd() - 0.5) * 3, lx + slot - 5, ly + 10); g.stroke(); }
      if (letter ? hits.includes(ch) || over : ch !== ' ') {
        const missed = letter && over && !hits.includes(ch);
        g.save(); g.translate(lx + slot / 2, ly); g.rotate((rnd() - 0.5) * 0.08);
        g.font = `bold ${Math.round(fit.size * 0.95)}px ${SERIF}`; g.textAlign = 'center'; g.fillStyle = missed ? RED_INK : INK;
        g.fillText(ch, 0, 0); g.restore();
      }
    }
    ly += pitch;
  }
  blots(g, wrong, cx);
}

// A stamp across the bottom of the left page once the game is over.
function stamp(g, won) {
  g.save(); g.translate(LEFT_CX, B.bottom - 66); g.rotate(-0.06);
  const color = won ? '#2f8a52' : RED_INK;
  g.font = `bold italic 40px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const text = won ? 'The End' : 'To Be Continued...';
  const tw = g.measureText(text).width + 50;
  g.fillStyle = 'rgba(245,233,204,0.88)'; g.strokeStyle = color; g.lineWidth = 4;
  g.beginPath(); g.roundRect(-tw / 2, -34, tw, 68, 12); g.fill(); g.stroke();
  g.lineWidth = 1.5; g.beginPath(); g.roundRect(-tw / 2 + 6, -28, tw - 12, 56, 9); g.stroke();
  g.fillStyle = color; g.fillText(text, 0, 2);
  g.restore();
}

// The picture for a game: { word, hits: the right letters found, wrong: [the wrong letters, '?' for a wrong solve], category, result: null | 'won' | 'lost' }.
// Returns a PNG buffer.
async function renderBook({ word, hits, wrong, category, result = null }) {
  const loaded = await loadArt();
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(backdrop(), 0, 0);
  leftPage(g, { wrong: wrong.length, loaded, over: !!result });
  rightPage(g, { word, hits, wrong, category, over: !!result });
  if (result) stamp(g, result === 'won');
  return c.toBuffer('image/png');
}

module.exports = { renderBook, layout, MAX_WRONG };
