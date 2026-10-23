// The picture for Don't Wake the Bookwyrm (paige.js): an open storybook on a dark desk. The left page holds the Bookwyrm (paigeWyrm.js: it changes
// every 2 wrong guesses and wakes on the 6th), the guesses left as souls icons and, once the game is over, a stamp; the right page holds the chapter
// (Heroes / Abilities / Items), the word as blanks and the wrong letters as ink blots. Satin bookmark, leather cover, candlelight: all drawn here.
// Everything that never changes (desk, cover, pages, ribbon) is drawn once and copied. Look: server-plan.md ("Games").
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { ASSETS, loadSouls, seeded } = require('./art');
const wyrm = require('./paigeWyrm');
const { drawBorder, damask } = require('./paigeOrnament');
const { encodeGif } = require('./gif');

// The lettering (his ask Oct 21: "make the text fancier"), open-licence fonts kept in assets/fonts (SIL OFL, see assets/CREDITS.txt) so it looks the
// same on any machine: Pinyon Script for headings and the ending (copperplate), Cinzel Decorative for the chapter's capital and the word (storybook
// capitals), IM Fell for the small captions (antique book type).
const fonts = path.join(ASSETS, 'fonts');
for (const [file, name] of [['PinyonScript-Regular.ttf', 'Pinyon Script'], ['CinzelDecorative-Bold.ttf', 'Cinzel Decorative'], ['CinzelDecorative-Regular.ttf', 'Cinzel Decorative Regular'], ['IMFeENit28P.ttf', 'IM Fell Italic'], ['IMFeENrm28P.ttf', 'IM Fell']]) GlobalFonts.registerFromPath(path.join(fonts, file), name);
const SCRIPT = "'Pinyon Script', 'Palatino Linotype', Georgia, serif";
const CAPS = "'Cinzel Decorative', 'Palatino Linotype', Georgia, serif";
const CAPS_LIGHT = "'Cinzel Decorative Regular', 'Palatino Linotype', Georgia, serif";
const BOOK_ITALIC = "'IM Fell Italic', 'Palatino Linotype', Georgia, serif";
const BOOK_ROMAN = "'IM Fell', 'Palatino Linotype', Georgia, serif";
const FIGURES = "'Times New Roman', 'DejaVu Serif', serif"; // lining digits: the book type's 1 looks like a small I
const SERIF = BOOK_ROMAN; // what the Bookwyrm drawing's z's use
// The size (down from `size`) at which `text` in `family` is no wider than `max`.
function fitSize(g, text, family, size, max) {
  for (; size > 14; size--) { g.font = `${size}px ${family}`; if (g.measureText(text).width <= max) break; }
  return size;
}
const INK = '#2a1a10';
const RED_INK = '#9e2418';
const BLOT = 'rgba(82,56,38,0.84)';
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

function desk(g) { // dark wood, a candle's warm light from the top left (Paige's green sparks are animated: fireflies())
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

function cover(g) { // the leather cover round the pages: pebbled and worn, a damask pressed into it, gold tooling, metal corners (his ask Oct 21: texture)
  const box = [B.left - 31, B.top - 27, B.right - B.left + 62, B.bottom - B.top + 66];
  const [bx, by, bw, bh] = box;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
  g.fillStyle = '#4a1712'; g.beginPath(); g.roundRect(...box, 18); g.fill(); g.restore();
  g.fillStyle = '#240705'; g.beginPath(); g.roundRect(bx, by + 9, bw, bh, 18); g.fill(); // the thickness of the board: the underside shows below the leather
  g.fillStyle = '#3a0e09'; g.beginPath(); g.roundRect(bx, by + 4, bw, bh, 18); g.fill();
  const leather = g.createLinearGradient(0, B.top, 0, B.bottom);
  leather.addColorStop(0, '#6c1d13'); leather.addColorStop(1, '#42100a');
  g.fillStyle = leather; g.beginPath(); g.roundRect(...box, 18); g.fill();

  g.save(); g.beginPath(); g.roundRect(...box, 18); g.clip();
  damask(g, bx, by, bx + bw, by + bh);
  const rnd = seeded(61);
  for (let i = 0; i < 9000; i++) { // pebbled grain: tiny dents, each with a lit lip
    const x = bx + rnd() * bw, y = by + rnd() * bh, r = 0.5 + rnd() * 1.1;
    g.fillStyle = 'rgba(20,0,0,0.14)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,150,130,0.06)'; g.beginPath(); g.arc(x - 0.8, y - 0.8, r * 0.8, 0, 7); g.fill();
  }
  g.lineCap = 'round'; g.lineWidth = 0.8;
  for (let i = 0; i < 44; i++) { // scuffs and scratches
    const x = bx + rnd() * bw, y = by + rnd() * bh, len = 8 + rnd() * 26, a = rnd() * Math.PI;
    g.strokeStyle = `rgba(255,195,165,${0.06 + rnd() * 0.08})`;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + 3, y + Math.sin(a) * len * 0.5 - 3, x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  const sheen = g.createRadialGradient(W * 0.25, by, 20, W * 0.25, by, 520); // the candle, catching the leather
  sheen.addColorStop(0, 'rgba(255,170,140,0.1)'); sheen.addColorStop(1, 'rgba(255,170,140,0)');
  g.fillStyle = sheen; g.fillRect(bx, by, bw, bh);
  g.lineWidth = 4; g.strokeStyle = 'rgba(196,104,80,0.17)'; g.beginPath(); g.roundRect(bx + 2.5, by + 2.5, bw - 5, bh - 5, 16); g.stroke(); // the rubbed edge
  for (const [x, y] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]) { // rubbed through at the corners
    const worn = g.createRadialGradient(x, y, 0, x, y, 46); worn.addColorStop(0, 'rgba(190,110,84,0.2)'); worn.addColorStop(1, 'rgba(190,110,84,0)');
    g.fillStyle = worn; g.fillRect(x - 46, y - 46, 92, 92);
  }
  g.restore();

  // the spine: a raised band down the middle of the cover (only its ends show, above and below the pages), grooves on either side of it, gold
  // lines and a diamond on it, like the hinge of a bound book (his note Oct 21: the middle had nothing to say it was a cover)
  const sx = B.spine;
  const band = g.createLinearGradient(sx - 17, 0, sx + 17, 0);
  band.addColorStop(0, 'rgba(10,0,0,0.55)'); band.addColorStop(0.18, 'rgba(255,150,125,0.12)'); band.addColorStop(0.5, 'rgba(255,175,145,0.3)'); band.addColorStop(0.82, 'rgba(255,150,125,0.12)'); band.addColorStop(1, 'rgba(10,0,0,0.55)');
  g.save(); g.beginPath(); g.roundRect(...box, 18); g.clip();
  g.fillStyle = band; g.fillRect(sx - 17, by, 34, bh);
  g.strokeStyle = 'rgba(10,0,0,0.5)'; g.lineWidth = 1.4; for (const dx of [-19, 19]) { g.beginPath(); g.moveTo(sx + dx, by); g.lineTo(sx + dx, by + bh); g.stroke(); }
  g.strokeStyle = GOLD; g.lineWidth = 1.7; for (const dx of [-13, 13]) { g.beginPath(); g.moveTo(sx + dx, by + 12); g.lineTo(sx + dx, by + bh - 12); g.stroke(); }
  g.fillStyle = GOLD;
  for (const y of [by + 22, by + bh - 22]) { g.beginPath(); g.moveTo(sx, y - 7); g.lineTo(sx + 5, y); g.lineTo(sx, y + 7); g.lineTo(sx - 5, y); g.closePath(); g.fill(); }
  g.restore();
  // headbands: the little striped cloth at the top and bottom of the spine, where the pages are sewn in
  for (const y of [B.top + B.dip - 9, B.bottom + B.dip * 0.6 + 1]) {
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#c99a38' : '#e8e0c8'; g.fillRect(sx - 13.5 + i * 3, y, 3, 8); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(sx - 13.5, y + 5.5, 27, 2.5);
  }
  // a bevelled lip round the edge of the board: lit at the top left, in shadow at the bottom right
  const lip = g.createLinearGradient(bx, by, bx + bw, by + bh);
  lip.addColorStop(0, 'rgba(255,190,160,0.55)'); lip.addColorStop(0.5, 'rgba(255,150,120,0.08)'); lip.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.strokeStyle = lip; g.lineWidth = 2.2; g.beginPath(); g.roundRect(bx + 1, by + 1, bw - 2, bh - 2, 17); g.stroke();

  // the gold tooling: a heavy line and a fine one inside it, a dot between the two every few pixels
  g.strokeStyle = GOLD; g.globalAlpha = 0.9; g.lineWidth = 2; g.beginPath(); g.roundRect(bx + 6, by + 6, bw - 12, bh - 12, 13); g.stroke();
  g.globalAlpha = 0.65; g.lineWidth = 0.9; g.beginPath(); g.roundRect(bx + 11, by + 11, bw - 22, bh - 22, 9); g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(30,5,2,0.35)'; g.beginPath(); g.roundRect(bx + 8, by + 8, bw - 16, bh - 16, 12); g.lineWidth = 1; g.strokeStyle = 'rgba(30,5,2,0.35)'; g.stroke(); // the groove under the gold

  // metal corner caps: gold, shaded, with an engraved line and a rivet
  for (const [x, y, sx, sy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
    if (sy < 0) { // at the bottom the cap wraps down over the board's thickness, so no red shows under the gold (his note Oct 21)
      const edge = g.createLinearGradient(0, y, 0, y + 9);
      edge.addColorStop(0, '#a87a2c'); edge.addColorStop(1, '#5e4012');
      g.beginPath(); g.rect(Math.min(x, x + 36 * sx), y - 1, 36, 10);
      g.fillStyle = edge; g.fill(); g.strokeStyle = 'rgba(70,40,8,0.7)'; g.lineWidth = 1; g.stroke();
    }
    const cap = g.createLinearGradient(x, y, x + 34 * sx, y + 34 * sy);
    cap.addColorStop(0, '#f1d27c'); cap.addColorStop(0.55, '#c99a38'); cap.addColorStop(1, '#8c6420');
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 36 * sx, y); g.quadraticCurveTo(x + 13 * sx, y + 13 * sy, x, y + 36 * sy); g.closePath();
    g.fillStyle = cap; g.fill(); g.strokeStyle = 'rgba(70,40,8,0.7)'; g.lineWidth = 1; g.stroke();
    g.beginPath(); g.moveTo(x + 4 * sx, y + 26 * sy); g.quadraticCurveTo(x + 11 * sx, y + 11 * sy, x + 26 * sx, y + 4 * sy); g.strokeStyle = 'rgba(80,50,10,0.55)'; g.lineWidth = 1; g.stroke(); // engraved
    const rivet = g.createRadialGradient(x + 9 * sx - 1, y + 9 * sy - 1, 0.5, x + 9 * sx, y + 9 * sy, 3.6);
    rivet.addColorStop(0, '#fff2c4'); rivet.addColorStop(1, '#8a6420');
    g.fillStyle = rivet; g.beginPath(); g.arc(x + 9 * sx, y + 9 * sy, 3.4, 0, 7); g.fill();
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

function frames(g) { // the scrolled border round each page (paigeOrnament.js)
  for (const [x0, x1] of [[B.left + 28, B.spine - 28], [B.spine + 28, B.right - 28]]) drawBorder(g, x0, B.top + 18, x1, B.bottom - 10);
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
  const title = woke ? 'The Bookwyrm Awakens' : "Don't Wake the Bookwyrm";
  g.font = `${fitSize(g, title, SCRIPT, 29, 290)}px ${SCRIPT}`; g.fillStyle = woke ? RED_INK : INK; // script runs wide: it shrinks to fit inside the frame
  g.fillText(title, LEFT_CX, B.top + 72);
  g.strokeStyle = 'rgba(110,70,30,0.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(LEFT_CX - 90, B.top + 90); g.lineTo(LEFT_CX + 90, B.top + 90); g.stroke();
  const size = 205; // a smaller drawing (his call Oct 21), centred between the heading and the souls row
  wyrm.draw(g, { art: loaded, cx: LEFT_CX, y: B.top + 100 + 8, size, stage: Math.min(3, Math.floor(wrong / 2)), seeded, createCanvas, PAGE, SERIF });
  if (over) return; // the stamp takes the souls row's place
  const h = 34, w = (h * loaded.souls.width) / loaded.souls.height;
  const grey = tint(loaded.souls, '#8f7e60');
  const dark = tint(loaded.souls, '#1d4a3c');
  for (let i = 0; i < MAX_WRONG; i++) {
    const sx = LEFT_CX - 100 + i * 40 - w / 2, sy = B.bottom - 100 - h / 2; // clear of the "guesses left" caption below
    if (i < MAX_WRONG - wrong) { // a dark outline so the mint reads on cream paper
      g.drawImage(dark, sx + 1.5, sy + 1.5, w, h); g.drawImage(dark, sx - 1.5, sy - 1.5, w, h); g.drawImage(loaded.souls, sx, sy, w, h);
    } else { g.globalAlpha = 0.45; g.drawImage(grey, sx, sy, w, h); g.globalAlpha = 1; }
  }
  g.font = `21px ${BOOK_ITALIC}`; g.fillStyle = 'rgba(42,26,16,0.78)';
  g.fillText(`${MAX_WRONG - wrong} wrong ${MAX_WRONG - wrong === 1 ? 'guess' : 'guesses'} left`, LEFT_CX, B.bottom - 40);
}

// Each wrong letter (a '?' for a wrong solve): its letter knocked out of a spilled-ink blot, cream on dark, with spatter and a drip.
function blots(g, wrong, cx) {
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `22px ${BOOK_ITALIC}`; g.fillStyle = 'rgba(110,70,30,0.9)';
  g.fillText('Blotted out', cx, B.bottom - 96);
  const gap = 46, wy = B.bottom - 50, startX = cx - ((wrong.length - 1) * gap) / 2;
  wrong.forEach((ch, i) => {
    const wx = startX + i * gap, rnd = seeded(31 + ch.charCodeAt(0) * 7);
    g.fillStyle = BLOT; // the same faded brown as the Bookwyrm's ink (his call Oct 21: not black)
    g.beginPath();
    for (let k = 0; k <= 20; k++) { const a = (k / 20) * Math.PI * 2, r = 17 + rnd() * 6; g.lineTo(wx + Math.cos(a) * r, wy - 12 + Math.sin(a) * r); }
    g.closePath(); g.fill();
    for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(wx + (rnd() - 0.5) * 50, wy - 12 + (rnd() - 0.5) * 44, 1.2 + rnd() * 2.2, 0, 7); g.fill(); }
    g.fillRect(wx + 4 + rnd() * 4, wy, 3, 6 + rnd() * 8);
    g.font = `22px ${CAPS}`; g.fillStyle = '#f2e5c6'; g.fillText(ch, wx, wy - 3);
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
  g.font = `16px ${CAPS_LIGHT}`; g.fillStyle = 'rgba(110,70,30,0.9)';
  g.fillText('— CHAPTER —', cx, B.top + 64);
  g.font = `44px ${CAPS}`;
  const first = category[0], capW = g.measureText(first).width;
  g.font = `33px ${BOOK_ITALIC}`;
  const rest = category.slice(1), restW = g.measureText(rest).width;
  const startX = cx - (capW + restW + 6) / 2;
  g.fillStyle = '#7a2419'; g.beginPath(); g.roundRect(startX - 8, B.top + 72, capW + 16, 52, 6); g.fill();
  g.strokeStyle = GOLD; g.lineWidth = 2; g.stroke();
  g.font = `44px ${CAPS}`; g.fillStyle = g.strokeStyle = GOLD; g.textAlign = 'left'; g.fillText(first, startX, B.top + 114); g.lineWidth = 1.2; g.strokeText(first, startX, B.top + 114);
  g.font = `33px ${BOOK_ITALIC}`; g.fillStyle = INK; g.fillText(rest, startX + capW + 12, B.top + 112);

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
        const digit = /[0-9]/.test(ch); // the capitals' 1 looks like an I, and so does the book type's: digits get their own font
        g.font = digit ? `${Math.round(fit.size * 0.9)}px ${FIGURES}` : `${Math.round(fit.size * 0.84)}px ${CAPS}`; g.textAlign = 'center';
        g.fillStyle = g.strokeStyle = missed ? RED_INK : INK;
        g.fillText(ch, 0, 0); g.lineWidth = digit ? 0.8 : 1.1; g.strokeText(ch, 0, 0); g.restore(); // a thin outline, so the fine capitals hold up at Discord's size
      }
    }
    ly += pitch;
  }
  blots(g, wrong, cx);
}

// The ending, once the game is over, where the souls row was: a cream ribbon banner with swallow-tailed ends holding "TO BE CONTINUED" or "THE END" in
// letter-spaced capitals between little diamonds (his pick, Oct 21: the spaced capitals of mock-up 5 on the banner of mock-up 3). The End in green ink, To Be
// Continued in black. The banner is sized so its tails stay inside the page's border.
function ending(g, won) {
  const word = won ? 'THE END' : 'TO BE CONTINUED', color = won ? '#2d6444' : '#1c1009', spacing = 4, cy = B.bottom - 66, h = 36;
  g.font = `17px ${CAPS}`;
  const widths = [...word].map((ch) => g.measureText(ch).width), total = widths.reduce((sum, w) => sum + w + spacing, -spacing);
  const w = total + 62, tail = 22;
  g.save(); g.shadowColor = 'rgba(60,35,10,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
  for (const side of [-1, 1]) { // the swallow-tailed ends, behind the banner
    const x = LEFT_CX + side * w / 2;
    g.fillStyle = '#d9c68f'; g.strokeStyle = 'rgba(70,45,20,0.8)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x, cy - h / 2 + 8); g.lineTo(x + side * tail, cy - h / 2 + 8); g.lineTo(x + side * (tail - 8), cy + 6); g.lineTo(x + side * tail, cy + h / 2 + 5); g.lineTo(x, cy + h / 2 + 2); g.closePath(); g.fill(); g.stroke();
  }
  g.fillStyle = '#f1e3bd'; g.strokeStyle = 'rgba(70,45,20,0.85)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(LEFT_CX - w / 2, cy - h / 2); g.quadraticCurveTo(LEFT_CX, cy - h / 2 - 7, LEFT_CX + w / 2, cy - h / 2);
  g.lineTo(LEFT_CX + w / 2, cy + h / 2); g.quadraticCurveTo(LEFT_CX, cy + h / 2 - 7, LEFT_CX - w / 2, cy + h / 2); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(70,45,20,0.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(LEFT_CX - w / 2 + 8, cy - h / 2 + 5); g.quadraticCurveTo(LEFT_CX, cy - h / 2 - 1, LEFT_CX + w / 2 - 8, cy - h / 2 + 5); g.stroke(); // a fine line inside the top edge
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `17px ${CAPS}`; g.fillStyle = g.strokeStyle = color; g.lineWidth = 0.6;
  let x = LEFT_CX - total / 2; const y = cy + 5.5;
  [...word].forEach((ch, i) => { g.fillText(ch, x, y); g.strokeText(ch, x, y); x += widths[i] + spacing; });
  for (const side of [-1, 1]) { // a diamond either side of the words
    const dx = LEFT_CX + side * (total / 2 + 14);
    g.beginPath(); g.moveTo(dx, cy - 5); g.lineTo(dx + 3.6, cy); g.lineTo(dx, cy + 5); g.lineTo(dx - 3.6, cy); g.closePath(); g.fill();
  }
}

// ---- the fireflies --------------------------------------------------------------------------------------------------------------
// Paige's green sparks: dots of light that drift and twinkle over the desk and the leather cover, behind the pages (never over the text). Every
// one moves in whole loops, so the animation joins up with itself. Each frame is the book plus where the fireflies are at that moment.
const FRAMES = 20;
const FRAME_MS = 120; // the loop takes 2.4 s: slow, gentle drifting (his call Oct 21: fewer, and slower)
const FLIES = 14;

let fliesData; // { flies: [{ x, y, ax, ay, kx, ky, px, py, size, kb, pb, hot }], hidden: a canvas that is opaque where the pages and bookmark cover the desk }
function fireflies() {
  if (fliesData) return fliesData;
  const hidden = createCanvas(W, H);
  const g = hidden.getContext('2d');
  g.fillStyle = '#000';
  for (const side of ['left', 'right']) {
    for (let i = 7; i >= 0; i--) { g.save(); g.translate(side === 'left' ? -i * 1.2 : i * 1.2, i * 1.6); pageShape(g, side); g.fill(); g.restore(); }
  }
  ribbon(g); // the bookmark lies over the page and its tail over the cover: both hide a firefly behind them
  const mask = g.getImageData(0, 0, W, H).data;
  const rnd = seeded(808);
  const flies = [];
  while (flies.length < FLIES) {
    const x = rnd() * W, y = rnd() * H;
    if (mask[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 0) continue; // starts where the desk or cover shows
    flies.push({
      x, y, ax: 5 + rnd() * 9, ay: 5 + rnd() * 9, kx: 1, ky: 1, px: rnd(), py: rnd(), // one slow circuit per loop
      size: 1.6 + rnd() * 2.6, kb: 1 + Math.floor(rnd() * 2), pb: rnd(), hot: rnd() < 0.25, // a few burn brighter and whiter
    });
  }
  fliesData = { flies, hidden };
  return fliesData;
}

// The fireflies at moment t (0-1 round the loop) as a transparent layer, pages cut out.
function firefliesAt(t) {
  const { flies, hidden } = fireflies();
  const layer = createCanvas(W, H);
  const g = layer.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  for (const fly of flies) {
    const x = fly.x + fly.ax * Math.sin(2 * Math.PI * (t * fly.kx + fly.px)), y = fly.y + fly.ay * Math.sin(2 * Math.PI * (t * fly.ky + fly.py));
    const glow = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (t * fly.kb + fly.pb))); // twinkles between a faint ember and full light
    const r = fly.size * (3.2 + 1.6 * glow);
    const halo = g.createRadialGradient(x, y, 0, x, y, r);
    halo.addColorStop(0, `rgba(${fly.hot ? '215,255,225' : '150,255,180'},${0.95 * glow})`);
    halo.addColorStop(0.35, `rgba(90,235,140,${0.45 * glow})`);
    halo.addColorStop(1, 'rgba(70,220,120,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'destination-out'; // behind the pages
  g.drawImage(hidden, 0, 0);
  return layer;
}

// A fixed pattern of small noise added to every frame before it is reduced to a GIF's 255 colours: it breaks up the banding in the candlelight
// and the leather the way dithering would, and being the same in every frame it adds nothing that moves.
let noise;
const grainOf = () => {
  if (!noise) { const rnd = seeded(404); noise = new Int8Array(W * H); for (let i = 0; i < noise.length; i++) noise[i] = Math.round((rnd() - 0.5) * 5); }
  return noise;
};

// The still book (no fireflies), as a canvas.
async function drawBook({ word, hits, wrong, category, result = null, noEnding = false }) { // noEnding: previews of other endings
  const loaded = await loadArt();
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(backdrop(), 0, 0);
  leftPage(g, { wrong: wrong.length, loaded, over: !!result });
  rightPage(g, { word, hits, wrong, category, over: !!result });
  if (result && !noEnding) ending(g, result === 'won');
  return c;
}

// The picture for a game: { word, hits: the right letters found, wrong: [the wrong letters, '?' for a wrong solve], category, result: null | 'won' | 'lost' }.
// Returns a GIF buffer (the fireflies shimmer and drift, round and round).
async function renderBook(game) {
  const book = await drawBook(game);
  const grain = grainOf();
  const frames = Array.from({ length: FRAMES }, (_, f) => ({
    delay: FRAME_MS,
    rgba() {
      const c = createCanvas(W, H);
      const g = c.getContext('2d');
      g.drawImage(book, 0, 0);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(firefliesAt(f / FRAMES), 0, 0);
      const image = g.getImageData(0, 0, W, H);
      const d = image.data;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) { const n = grain[p]; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      return image.data;
    },
  }));
  return encodeGif(frames, W, H, { loop: true, picks: [0, Math.floor(FRAMES / 2)] });
}

// The still picture as a PNG (previews and tests).
async function renderBookPng(game) {
  return (await drawBook(game)).toBuffer('image/png');
}

module.exports = { renderBook, renderBookPng, layout, MAX_WRONG };
