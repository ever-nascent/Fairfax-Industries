// Abrams' Interrogation: the case board picture (his pick Oct 22: the corkboard, with the case folder worked in; no circles,
// X's or stamps). A corkboard in a wooden frame: the case folder top left (case number, suspects left or the status), a
// "WHO?" card top right, the suspects still in as pinned photos (as big as fits) with red string to the WHO? card once 12 or
// fewer are left, and a manila "Cleared" folder along the bottom with every ruled-out suspect tucked into it. Each question
// asked pins up a sticky note of its clue plus one random item (a clipping, a map, a receipt ...: his ask, "random stuff gets
// added over time"), placed where nothing else is. When the case ends everyone else is filed away and the culprit stays up,
// with a tape label (CAUGHT, or YOUR PICK and THE CULPRIT joined by string). A duel draws two boards side by side.
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { ASSETS, seeded, halftone, grain, grainAndVignette } = require('./art'); // art.js also registers the game fonts (Radiance, Retail)
const { HEROES } = require('./heroes');
const { QUESTIONS } = require('./abramsCase');

GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'PermanentMarker-Regular.ttf'), 'Permanent Marker');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'SpecialElite-Regular.ttf'), 'Special Elite');
const MARKER = 'Permanent Marker';
const TYPED = 'Special Elite';

const W = 640;
const H = 440;
const MANILA = '#d4ab68';
const TYPE_INK = '#2c2117';
const PEN = '#1d2a55';
const STRING = 'rgba(196,22,28,.95)';

// The 44 hero icons, loaded once.
let icons;
async function loadIcons() {
  if (icons) return icons;
  icons = {};
  for (const h of HEROES) icons[h.name] = await loadImage(path.join(ASSETS, 'heroes', `${h.slug}.png`)).catch(() => null);
  return icons;
}

// The cork in its wooden frame, drawn once.
let cork;
function corkTexture() {
  if (cork) return cork;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = seeded(5);
  g.fillStyle = '#9a7650';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rnd() < 0.55 ? `rgba(70,42,18,${rnd() * 0.4})` : `rgba(255,230,180,${rnd() * 0.2})`;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H, 0.5 + rnd() * 1.6, 0, 7);
    g.fill();
  }
  const v = g.createRadialGradient(W / 2, H / 2, 140, W / 2, H / 2, 430);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.5)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  const wood = g.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, '#5a3517');
  wood.addColorStop(0.5, '#3d230f');
  wood.addColorStop(1, '#5a3517');
  g.strokeStyle = wood;
  g.lineWidth = 22;
  g.strokeRect(11, 11, W - 22, H - 22);
  g.strokeStyle = 'rgba(0,0,0,.45)';
  g.lineWidth = 3;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.strokeStyle = 'rgba(255,210,150,.15)';
  g.lineWidth = 2;
  g.strokeRect(2, 2, W - 4, H - 4);
  cork = c;
  return cork;
}

// Shrinks the font until `text` fits `width`.
function fit(g, text, font, size, width, min = 5) {
  let s = size;
  g.font = `${s}px ${font}`;
  while (g.measureText(text).width > width && s > min) {
    s -= 0.5;
    g.font = `${s}px ${font}`;
  }
}
const shadow = (g, blur = 6, y = 3) => Object.assign(g, { shadowColor: 'rgba(0,0,0,.45)', shadowBlur: blur, shadowOffsetY: y });
const noShadow = (g) => Object.assign(g, { shadowColor: 'transparent', shadowBlur: 0, shadowOffsetY: 0 });

// The biggest tiles (w wide, w * ratio high) that fit n in a box, at most `max` wide, centred, the last row centred too.
function place(names, box, ratio, gap, max) {
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= names.length; cols++) {
    const rows = Math.ceil(names.length / cols);
    const s = Math.min((box.w - gap * (cols - 1)) / cols, (box.h - gap * (rows - 1)) / rows / ratio, max);
    if (s > best.size) best = { cols, size: s };
  }
  const { cols, size } = best;
  const rows = Math.ceil(names.length / cols);
  const y0 = box.y + (box.h - (rows * size * ratio + (rows - 1) * gap)) / 2;
  return names.map((name, i) => {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, names.length - r * cols);
    const x0 = box.x + (box.w - (inRow * size + (inRow - 1) * gap)) / 2;
    return { name, x: x0 + (i % cols) * (size + gap), y: y0 + r * (size * ratio + gap), s: size };
  });
}

function pin(g, x, y, color = '#d62828') {
  g.save();
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath();
  g.arc(x + 2, y + 3, 5, 0, 7);
  g.fill();
  const gr = g.createRadialGradient(x - 2, y - 2, 1, x, y, 6);
  gr.addColorStop(0, '#ffffffaa');
  gr.addColorStop(0.4, color);
  gr.addColorStop(1, '#1a0606');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, 5.5, 0, 7);
  g.fill();
  g.restore();
}

// Crumpled-paper shading, drawn once: creases (a shadow line beside a highlight) each shading one side of the sheet a touch
// darker or lighter, so the facets between them catch the light differently.
let crumple;
function crumpleTexture() {
  if (crumple) return crumple;
  const S = 256;
  const c = createCanvas(S, S);
  const g = c.getContext('2d');
  const rnd = seeded(77);
  g.fillStyle = '#808080'; // mid grey: drawn as an overlay, so only the creases and facets change the paper
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const px = rnd() * S;
    const py = rnd() * S;
    const a = rnd() * Math.PI;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const L = S * 1.5;
    g.fillStyle = rnd() < 0.5 ? 'rgba(40,20,0,.16)' : 'rgba(255,250,235,.2)';
    g.beginPath();
    g.moveTo(px - dx * L, py - dy * L);
    g.lineTo(px + dx * L, py + dy * L);
    g.lineTo(px + dx * L - dy * L, py + dy * L + dx * L);
    g.lineTo(px - dx * L - dy * L, py - dy * L + dx * L);
    g.fill();
    // the crease itself: a short, slightly bent stretch of the line
    const from = (rnd() - 0.5) * S * 0.9;
    const len = 90 + rnd() * 120;
    const pts = Array.from({ length: 5 }, (_, k) => {
      const t = from + (len * k) / 4;
      const j = (rnd() - 0.5) * 2;
      return [px + dx * t - dy * j, py + dy * t + dx * j];
    });
    for (const [color, off] of [['rgba(40,25,5,.8)', 0], ['rgba(255,252,235,.85)', 1.4]]) {
      g.strokeStyle = color;
      g.lineWidth = 1.3;
      g.beginPath();
      pts.forEach(([x, y], k) => (k ? g.lineTo(x - dy * off, y + dx * off) : g.moveTo(x - dy * off, y + dx * off)));
      g.stroke();
    }
  }
  // paper fibre: fine speckle over everything
  const px = g.getImageData(0, 0, S, S);
  for (let i = 0; i < px.data.length; i += 4) {
    const n = (rnd() - 0.5) * 12;
    px.data[i] += n;
    px.data[i + 1] += n;
    px.data[i + 2] += n;
  }
  g.putImageData(px, 0, 0);
  crumple = c;
  return crumple;
}
// Crinkles a w x h piece of paper drawn at (0, 0) (clip to its shape first if it isn't a rectangle). `seed` picks the
// part of the texture, so each piece crumples differently but the same way every redraw.
function crinkle(g, w, h, seed, strength = 1) {
  const t = crumpleTexture();
  const rnd = seeded((seed % 2147483646) + 1);
  rnd();
  const sw = Math.min(256, w * 2); // twice the piece's size, so a small piece still catches several creases
  const sh = Math.min(256, h * 2);
  g.save();
  g.globalAlpha = strength;
  g.globalCompositeOperation = 'overlay';
  g.drawImage(t, rnd() * (256 - sw), rnd() * (256 - sh), sw, sh, 0, 0, w, h);
  g.restore();
}
// An old Polaroid's picture in the box (x, y, w, h): warm faded colours, lifted blacks, a soft dark edge and, when `leak`,
// a light leak from one corner (his ask: the old-time detective feel).
function aged(g, x, y, w, h, leak = 0) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(255,170,90,.35)';
  g.fillRect(x, y, w, h);
  g.globalCompositeOperation = 'lighten';
  g.fillStyle = '#2e2520';
  g.fillRect(x, y, w, h);
  g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(30,15,5,0)');
  v.addColorStop(1, 'rgba(30,15,5,.5)');
  g.fillStyle = v;
  g.fillRect(x, y, w, h);
  if (leak) {
    const cx = leak > 0.5 ? x + w : x;
    const l = g.createRadialGradient(cx, y, 0, cx, y, w * 0.7);
    l.addColorStop(0, 'rgba(255,140,60,.45)');
    l.addColorStop(1, 'rgba(255,140,60,0)');
    g.globalCompositeOperation = 'screen';
    g.fillStyle = l;
    g.fillRect(x, y, w, h);
  }
  g.restore();
}
// A Polaroid's frame, w x h at (0, 0): cream, yellowed toward the edges.
function polaroidFrame(g, w, h) {
  shadow(g);
  g.fillStyle = '#ede5d2';
  g.fillRect(0, 0, w, h);
  noShadow(g);
  const y = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8);
  y.addColorStop(0, 'rgba(170,130,60,0)');
  y.addColorStop(1, 'rgba(170,130,60,.28)');
  g.fillStyle = y;
  g.fillRect(0, 0, w, h);
  crinkle(g, w, h, 5, 0.8);
}

// A suspect's photo: an old Polaroid with the name in marker underneath, tilted by `angle`.
function photo(g, art, t, angle) {
  const { x, y, s } = t;
  const h = s * 1.22;
  const b = Math.max(2, s * 0.06);
  g.save();
  g.translate(x + s / 2, y + h / 2);
  g.rotate(angle);
  g.translate(-s / 2, -h / 2);
  polaroidFrame(g, s, h);
  g.fillStyle = '#23202a';
  g.fillRect(b, b, s - 2 * b, s - 2 * b);
  if (art) g.drawImage(art, b, b, s - 2 * b, s - 2 * b);
  aged(g, b, b, s - 2 * b, s - 2 * b, t.leak);
  g.fillStyle = '#2b1d12';
  g.textAlign = 'center';
  const label = t.name.toUpperCase().replace('&', 'AND'); // the marker font has no &
  fit(g, label, MARKER, s * 0.17, s - 2 * b);
  g.fillText(label, s / 2, s + (h - s) * 0.68);
  g.restore();
}

// Grain on paper.
function grainy(g, x, y, w, h, seed, color = '110,70,20') {
  const rnd = seeded(seed);
  for (let i = 0; i < (w * h) / 40; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(${color},${rnd() * 0.12})` : `rgba(255,240,200,${rnd() * 0.12})`;
    g.fillRect(x + rnd() * w, y + rnd() * h, 1.5, 1.5);
  }
}
// A manila folder panel, with a tab on top when given one ({ x, w, text }).
function folder(g, x, y, w, h, { tab, shade = 0, seed = 1 } = {}) {
  g.save();
  shadow(g, 7);
  g.fillStyle = MANILA;
  g.beginPath();
  if (tab) {
    g.moveTo(x, y + 4);
    g.lineTo(x + tab.x, y + 4);
    g.lineTo(x + tab.x + 8, y - 16);
    g.lineTo(x + tab.x + tab.w - 8, y - 16);
    g.lineTo(x + tab.x + tab.w, y + 4);
    g.lineTo(x + w, y + 4);
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
    g.closePath();
  } else g.roundRect(x, y, w, h, 3);
  g.fill();
  g.clip();
  g.translate(x, y - 16);
  crinkle(g, w, h + 16, seed * 977, 0.8);
  g.restore();
  grainy(g, x, y - (tab ? 16 : 0), w, h + (tab ? 16 : 0), seed);
  if (shade) {
    g.fillStyle = `rgba(60,35,10,${shade})`;
    g.fillRect(x, y + 4, w, h - 4);
  }
  g.strokeStyle = 'rgba(120,80,30,.55)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + 6, y + h - 6);
  g.lineTo(x + w - 6, y + h - 6);
  g.stroke();
  if (tab?.text) {
    g.fillStyle = TYPE_INK;
    g.font = `13px ${TYPED}`;
    g.textAlign = 'center';
    g.fillText(tab.text, x + tab.x + tab.w / 2, y - 2);
  }
}
// A strip of masking tape with a word in marker, centred on (cx, cy).
function tape(g, cx, cy, text, angle) {
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.font = `17px ${MARKER}`;
  const w = g.measureText(text).width + 26;
  const h = 26;
  g.fillStyle = 'rgba(236,224,190,.93)';
  g.beginPath();
  g.moveTo(-w / 2, -h / 2);
  for (let i = 0; i <= 4; i++) g.lineTo(-w / 2 + (i % 2 ? 3 : 0), -h / 2 + (h * i) / 4);
  for (let i = 0; i <= 4; i++) g.lineTo(w / 2 - (i % 2 ? 3 : 0), h / 2 - (h * i) / 4);
  g.closePath();
  g.fill();
  g.fillStyle = PEN;
  g.textAlign = 'center';
  g.fillText(text, 0, 6);
  g.restore();
}

// ---- the clutter: one sticky note per clue, and one random item per question asked ------------------------------------
// Each draws itself in a box of its own size at (0, 0), already rotated and placed by drawClutter.

const NOTE_COLORS = ['#f4ebd2', '#f1f1ef', '#e7e1ef', '#f3e9c9', '#efe6dc']; // the pastel cream / white / lavender of his tape-and-paper reference
const TAPE_COLORS = ['#9fb88f', '#d99a94', '#8fb8d0', '#c8a8d4', '#d9c27a']; // washi-tape pastels
// A strip of translucent tape centred on (x, y), turned by `angle`; `torn` ends are jagged, otherwise cut straight.
function noteTape(g, x, y, { color, angle, w, h, torn }) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  shadow(g, 2, 1);
  g.fillStyle = color;
  g.globalAlpha = 0.8;
  g.beginPath();
  g.moveTo(-w / 2, -h / 2);
  g.lineTo(w / 2, -h / 2);
  for (let i = 0; i <= 4; i++) g.lineTo(w / 2 - (torn && i % 2 ? 2.5 : 0), -h / 2 + (h * i) / 4);
  g.lineTo(-w / 2, h / 2);
  for (let i = 4; i >= 0; i--) g.lineTo(-w / 2 + (torn && i % 2 ? 2.5 : 0), -h / 2 + (h * i) / 4);
  g.closePath();
  g.fill();
  noShadow(g);
  g.fillStyle = 'rgba(255,255,255,.25)';
  g.fillRect(-w / 2 + 3, -h / 2, w - 6, h * 0.35);
  g.restore();
}

// Every note differs, like his reference: some flat, some with a hard folded-up bottom corner, some with a soft curled one,
// some with the bottom edge lifting a little; the tape across the top middle, over a corner, or off to one side, in any
// pastel, torn or cut straight, at its own angle.
const FOLDS = ['flat', 'hard', 'soft', 'lift'];
function stickyNote([q, yes], rnd) {
  const color = NOTE_COLORS[Math.floor(rnd() * NOTE_COLORS.length)];
  const fold = FOLDS[Math.floor(rnd() * FOLDS.length)];
  const right = rnd() < 0.5; // which side the fold / lift is on
  const size = 13 + rnd() * 9;
  const tape = {
    color: TAPE_COLORS[Math.floor(rnd() * TAPE_COLORS.length)],
    w: 28 + rnd() * 12,
    h: 11 + rnd() * 3,
    torn: rnd() < 0.5,
    ...[
      { x: 37, y: 3, angle: (rnd() - 0.5) * 0.3 }, // across the top middle
      { x: 37 + (rnd() - 0.5) * 30, y: 3, angle: (rnd() - 0.5) * 0.5 }, // off to one side
      { x: 8, y: 6, angle: -0.75 }, // diagonal over the top left
      { x: 66, y: 6, angle: 0.75 }, // diagonal over the top right
    ][Math.floor(rnd() * 4)],
  };
  return {
    w: 74, h: 66,
    draw(g, seed) {
      const W = 74;
      const H = 66;
      const cx = right ? W : 0;
      const ix = right ? -1 : 1;
      const h = [cx + ix * size, H]; // where the fold meets the bottom edge
      const v = [cx, H - size]; // and the side edge
      const soft = fold === 'soft';
      // the sheet's outline: a hard fold cuts the corner straight, a soft one along a curve (the bend), a lift bows the bottom edge up
      const outline = () => {
        g.beginPath();
        if (fold === 'lift') {
          // his reference: the lower part of the sheet bends toward you. The far side curves in, the bottom edge sags
          // up in the middle and the near bottom corner flares out to a point, its side edge bowing a little (drawn
          // for the left, mirrored for the right)
          g.save();
          if (right) { g.translate(W, 0); g.scale(-1, 1); }
          g.moveTo(0, 0);
          g.lineTo(W, 0);
          g.lineTo(W, H * 0.55);
          g.quadraticCurveTo(W + 1, H * 0.88, W - 4, H);
          g.quadraticCurveTo(W * 0.5, H - 8, -3, H + 1);
          g.quadraticCurveTo(1.5, H * 0.7, 0, H * 0.3);
          g.restore();
          g.closePath();
          return;
        }
        g.moveTo(0, 0);
        g.lineTo(W, 0);
        if (fold === 'flat') {
          g.lineTo(W, H);
          g.lineTo(0, H);
        } else {
          const cut = (a, b) => (soft ? g.quadraticCurveTo(cx + ix * size * 0.3, H - size * 0.3, ...b) : g.lineTo(...b));
          if (right) {
            g.lineTo(...v);
            cut(v, h);
            g.lineTo(0, H);
          } else {
            g.lineTo(W, H);
            g.lineTo(...h);
            cut(h, v);
          }
        }
        g.closePath();
      };
      shadow(g, fold === 'lift' ? 6 : 4, fold === 'lift' ? 3 : 2);
      g.fillStyle = color;
      outline();
      g.fill();
      noShadow(g);
      g.save();
      outline();
      g.clip();
      // clean flat paper (his reference): only a soft light-to-dark wash, no creases
      const wash = g.createLinearGradient(0, 0, W * 0.4, H);
      wash.addColorStop(0, 'rgba(255,250,225,.22)');
      wash.addColorStop(1, 'rgba(70,60,50,.07)');
      g.fillStyle = wash;
      g.fillRect(0, 0, W, H);
      if (fold === 'hard' || soft) {
        // the paper bends up toward the fold: a shadow into the sheet (wider and fainter when soft)
        const sh = g.createLinearGradient(cx, H, cx + ix * size * (soft ? 3.4 : 2.2), H - size * (soft ? 3.4 : 2.2));
        sh.addColorStop(0, `rgba(60,50,40,${soft ? 0.16 : 0.26})`);
        sh.addColorStop(1, 'rgba(60,50,40,0)');
        g.fillStyle = sh;
        g.fillRect(0, 0, W, H);
      } else if (fold === 'lift') {
        // the bottom edge lifts: it catches the light, with the paper darkening just above it
        const lift = g.createLinearGradient(0, H - 16, 0, H);
        lift.addColorStop(0, 'rgba(60,50,40,0)');
        lift.addColorStop(0.55, 'rgba(60,50,40,.12)');
        lift.addColorStop(1, 'rgba(255,255,250,.35)');
        g.fillStyle = lift;
        g.fillRect(0, H - 16, W, 16);
      }
      g.restore();
      g.fillStyle = 'rgba(0,0,0,.07)';
      g.fillRect(0, 0, 74, 12);
      g.fillStyle = PEN;
      g.textAlign = 'center';
      fit(g, QUESTIONS[q].note, MARKER, 13, 66);
      g.fillText(QUESTIONS[q].note, 37, 30);
      g.font = `19px ${MARKER}`;
      g.fillStyle = PEN;
      g.fillText(yes ? 'YES' : 'NO', 37, 54);
      g.strokeStyle = g.fillStyle;
      g.lineWidth = 2;
      const tw = g.measureText(yes ? 'YES' : 'NO').width;
      g.beginPath();
      g.moveTo(37 - tw / 2 - 2, 58);
      g.lineTo(37 + tw / 2 + 4, 57);
      g.stroke();
      if (fold === 'hard' || soft) {
        // the folded-over flap: the back of the sheet, white fading into the paper, with its own shadow
        shadow(g, soft ? 6 : 4, soft ? 3 : 2);
        const back = g.createLinearGradient(cx + ix * size, H, cx, H - size);
        back.addColorStop(0, '#ffffff');
        back.addColorStop(1, color);
        g.fillStyle = back;
        g.beginPath();
        g.moveTo(...h);
        if (soft) {
          g.quadraticCurveTo(cx + ix * size * 0.3, H - size * 0.3, ...v); // the bend is round ...
        } else g.lineTo(...v);
        g.lineTo(cx + ix * size, H - size); // ... the folded tip stays pointed
        g.closePath();
        g.fill();
        noShadow(g);
      }
      // (the flap goes on after the writing, so a fold covers any words under it)
      noteTape(g, tape.x, tape.y, tape); // held up by tape, not a pin
    },
  };
}

// Deadlock pictures for the clutter (assets/abrams/board, from deadlock.wiki), loaded once.
const SCENES = [['subway.jpg', 'THE SUBWAY'], ['stronghold.jpg', 'THE STRONGHOLD'], ['archmother_base.jpg', 'SAPPHIRE BASE'], ['warehouse.jpg', 'FAIRFAX WAREHOUSE'], ['window.jpg', 'ACROSS THE STREET']];
let boardArt;
async function loadBoardArt() {
  if (boardArt) return boardArt;
  const dir = path.join(ASSETS, 'abrams', 'board');
  const load = (f) => loadImage(path.join(dir, f)).catch(() => null);
  boardArt = { scenes: [], map: await load('map.png'), logo: await load('fairfax_logo.png') };
  for (const [file, caption] of SCENES) boardArt.scenes.push({ image: await load(file), caption });
  return boardArt;
}

// A picture as newsprint: dark halftone dots, w x h.
function newsprint(image, w, h) {
  const src = createCanvas(w, h);
  const s = src.getContext('2d');
  s.filter = 'grayscale(1) contrast(1.2)';
  const k = Math.max(w / image.width, h / image.height);
  s.drawImage(image, (w - image.width * k) / 2, (h - image.height * k) / 2, image.width * k, image.height * k);
  const px = s.getImageData(0, 0, w, h).data;
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#25231f';
  const step = 2.4;
  for (let y = 0, row = 0; y < h; y += step, row++) {
    for (let x = row % 2 ? step / 2 : 0; x < w; x += step) {
      const r = (1 - px[(Math.floor(y) * w + Math.floor(x)) * 4] / 255) * step * 0.62;
      if (r > 0.15) {
        g.beginPath();
        g.arc(x, y, r, 0, 7);
        g.fill();
      }
    }
  }
  return c;
}

// One inked fingerprint, w x h: ridges that whorl or loop round a core and flatten into arches at the base, the ink
// broken up and fading at the edge of the fingertip.
function fingerprint(w, h, rnd) {
  const S = 3; // drawn at three times the size, then scaled down
  const c = createCanvas(w * S, h * S);
  const g = c.getContext('2d');
  const img = g.createImageData(w * S, h * S);
  const cx = 0.5 + (rnd() - 0.5) * 0.16;
  const cy = 0.4 + (rnd() - 0.5) * 0.1;
  const tilt = rnd() * 6.3;
  const loop = 0.15 + rnd() * 0.35; // how far the ridges bend to one side (a loop) rather than circle round (a whorl)
  const period = 0.06 + rnd() * 0.01;
  const phase = Array.from({ length: 4 }, () => rnd() * 6.3);
  for (let y = 0; y < h * S; y++) {
    for (let x = 0; x < w * S; x++) {
      const u = x / (w * S);
      const v = y / (h * S);
      const ex = (u - 0.5) / 0.47;
      const ey = (v - 0.53) / 0.48;
      const edge = ex * ex + ey * ey;
      if (edge > 1) continue;
      const dx = u - cx;
      const dy = (v - cy) * 0.85;
      const a = Math.atan2(dy, dx);
      const whorl = Math.hypot(dx, dy) * (1 + loop * Math.cos(a - tilt)) + 0.01 * Math.sin(a * 3 + phase[0]);
      const arch = (v - cy) * 0.9 + 0.4 * dx * dx + 0.008 * Math.sin(u * 18 + phase[1]);
      const t = Math.min(1, Math.max(0, (v - cy - 0.1) / 0.28));
      const f = whorl * (1 - t) + (arch + 0.1) * t;
      const ridge = 0.5 + 0.5 * Math.cos((2 * Math.PI * f) / period);
      const breaks = 0.5 + 0.5 * Math.sin(x * 0.55 + phase[2]) * Math.sin(y * 0.43 + phase[3]) * Math.sin((x - y) * 0.19);
      const ink = Math.min(1, Math.max(0, (ridge - 0.42) * 3.2)) * (1 - edge ** 4) * (0.45 + 0.55 * breaks) * (0.75 + rnd() * 0.25);
      const i = (y * w * S + x) * 4;
      img.data[i] = 26;
      img.data[i + 1] = 28;
      img.data[i + 2] = 40;
      img.data[i + 3] = Math.round(ink * 240);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const HEADLINES = ['BODY FOUND IN THE SUBWAY', 'WITNESS SAW NOTHING', 'SOULS VAULT ROBBED', 'CULT ACTIVITY ON THE RISE', 'SHRINE VANDALIZED', 'BLACKOUT IN THE CITY', 'NO SUSPECTS, SAYS PRECINCT', 'PATRONS STIR AGAIN'];
const NOTES = [['ALIBI?', 'check it'], ['MOTIVE?', '???'], ['WHERE WAS', 'SHE AT 2AM?'], ['CALL BACK', '555-0142'], ['WHO PAID', 'THE BRIBE?'], ['TRUST', 'NOBODY']];
const paper = (g, w, h, color, seed, blur = 4) => {
  shadow(g, blur, 2);
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  noShadow(g);
  crinkle(g, w, h, seed);
};
// Each takes (rnd, the board art) and returns { w, h, draw(g), pin }: drawn in its own w x h box at (0, 0), pinned at `pin`.
const ITEMS = [
  // a newspaper clipping with a halftone photo of a Deadlock scene
  (rnd, art) => {
    const headline = HEADLINES[Math.floor(rnd() * HEADLINES.length)];
    const scene = art.scenes[Math.floor(rnd() * art.scenes.length)];
    const edge = Array.from({ length: 32 }, () => rnd() * 3);
    return {
      w: 124, h: 92,
      draw(g, seed) {
        shadow(g, 4, 2);
        g.fillStyle = '#e2ddcf';
        g.beginPath();
        g.moveTo(0, edge[0]);
        for (let i = 0; i <= 15; i++) g.lineTo((124 * i) / 15, edge[i]);
        for (let i = 0; i <= 15; i++) g.lineTo(124 - (124 * i) / 15, 92 - edge[16 + i]);
        g.closePath();
        g.fill();
        noShadow(g);
        g.fillStyle = '#222';
        g.textAlign = 'left';
        g.font = `8px ${TYPED}`;
        g.fillText('THE CITY HERALD', 6, 13);
        g.fillRect(6, 16, 112, 1);
        fit(g, headline, 'Radiance', 12, 112);
        g.fillText(headline, 6, 30);
        if (scene.image) g.drawImage(newsprint(scene.image, 58, 44), 6, 36);
        g.fillStyle = 'rgba(40,40,40,.45)';
        for (let y = 38; y < 86; y += 5) g.fillRect(70, y, y > 80 ? 30 : 48, 2);
      },
      pin: [62, 7],
    };
  },
  // a torn-off piece of the city minimap with a pin in it
  (rnd, art) => {
    const sx = 30 + rnd() * 90;
    const sy = 30 + rnd() * 90;
    const edge = Array.from({ length: 20 }, () => rnd() * 4);
    const spot = [24 + rnd() * 50, 22 + rnd() * 40];
    return {
      w: 96, h: 82,
      draw(g, seed) {
        shadow(g, 4, 2);
        g.fillStyle = '#ece5d0';
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(96, 0);
        for (let i = 0; i <= 10; i++) g.lineTo(96 - edge[i], (82 * i) / 10);
        for (let i = 0; i <= 9; i++) g.lineTo(96 - (96 * i) / 9, 82 - edge[10 + i]);
        g.closePath();
        g.fill();
        noShadow(g);
        if (art.map) {
          g.save();
          g.clip();
          g.drawImage(art.map, sx, sy, 100, 86, 3, 3, 90, 77);
          crinkle(g, 96, 82, seed, 1.3);
          g.restore();
        }
      },
      pin: spot,
    };
  },
  // a diner receipt
  () => ({
    w: 46, h: 92,
    draw(g, seed) {
      paper(g, 46, 92, '#faf8f2', seed, 3);
      g.fillStyle = '#555';
      g.textAlign = 'center';
      g.font = `7px ${TYPED}`;
      g.fillText("SAL'S DINER", 23, 14);
      g.textAlign = 'left';
      [['COFFEE', '.50'], ['PIE', '.75'], ['COFFEE', '.50'], ['TIP', '.25']].forEach(([a, b], i) => {
        g.fillText(a, 4, 30 + i * 11);
        g.fillText(b, 32, 30 + i * 11);
      });
      g.fillText('2:14 AM', 4, 84);
    },
    pin: [23, 6],
  }),
  // a fingerprint card: two inked prints in ruled boxes
  (rnd) => {
    const prints = [fingerprint(34, 44, rnd), fingerprint(34, 44, rnd)];
    return {
      w: 100, h: 74,
      draw(g, seed) {
        paper(g, 100, 74, '#f6f2e6', seed);
        g.fillStyle = '#3a3a3a';
        g.textAlign = 'left';
        g.font = `7px ${TYPED}`;
        g.fillText('LATENT PRINTS', 6, 10);
        g.strokeStyle = 'rgba(40,40,60,.55)';
        g.lineWidth = 1.3;
        ['R. THUMB', 'R. INDEX'].forEach((label, i) => {
          const x = 6 + i * 46;
          g.strokeRect(x, 14, 42, 54);
          g.drawImage(prints[i], x + 4, 15, 34, 44);
          g.fillText(label, x + 3, 66);
        });
      },
      pin: [88, 6],
    };
  },
  // an index card in pen
  (rnd) => {
    const [a, b] = NOTES[Math.floor(rnd() * NOTES.length)];
    return {
      w: 92, h: 56,
      draw(g, seed) {
        paper(g, 92, 56, '#fbf8ef', seed);
        g.strokeStyle = '#e04b4b';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, 14);
        g.lineTo(92, 14);
        g.stroke();
        g.strokeStyle = '#9cc3e6';
        for (const y of [28, 42]) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(92, y);
          g.stroke();
        }
        g.fillStyle = PEN;
        g.textAlign = 'center';
        fit(g, a, MARKER, 14, 84);
        g.fillText(a, 46, 26);
        fit(g, b, MARKER, 13, 84);
        g.fillText(b, 46, 44);
      },
      pin: [46, 6],
    };
  },
  // a photo of a Deadlock scene
  (rnd, art) => {
    const scene = art.scenes[Math.floor(rnd() * art.scenes.length)];
    return {
      w: 84, h: 82,
      draw(g, seed) {
        polaroidFrame(g, 84, 82);
        if (scene.image) {
          const k = Math.max(76 / scene.image.width, 58 / scene.image.height);
          g.save();
          g.beginPath();
          g.rect(4, 4, 76, 58);
          g.clip();
          g.drawImage(scene.image, 42 - (scene.image.width * k) / 2, 33 - (scene.image.height * k) / 2, scene.image.width * k, scene.image.height * k);
          g.restore();
          aged(g, 4, 4, 76, 58, seed % 3 === 0 ? (seed % 2) + 0.4 : 0);
        }
        g.fillStyle = '#2b1d12';
        g.textAlign = 'center';
        fit(g, scene.caption, MARKER, 10, 76);
        g.fillText(scene.caption, 42, 76);
      },
      pin: [42, 4],
    };
  },
  // a Fairfax shipping manifest, one line highlighted
  (rnd, art) => {
    const lines = Array.from({ length: 7 }, () => 30 + rnd() * 32);
    return {
      w: 78, h: 96,
      draw(g, seed) {
        paper(g, 78, 96, '#f1ece0', seed);
        if (art.logo) g.drawImage(art.logo, 17, 6, 44, 24);
        g.fillStyle = '#333';
        g.textAlign = 'center';
        g.font = `7px ${TYPED}`;
        g.fillText('SHIPPING MANIFEST', 39, 40);
        g.fillStyle = 'rgba(232,200,40,.45)';
        g.fillRect(6, 58, 64, 6);
        g.fillStyle = 'rgba(40,40,40,.4)';
        lines.forEach((w, i) => g.fillRect(8, 48 + i * 6, w, 2));
      },
      pin: [39, 5],
    };
  },
  // a coffee ring on the cork (no pin)
  () => ({
    w: 64, h: 64,
    draw(g, seed) {
      g.strokeStyle = 'rgba(55,30,10,.35)';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(32, 32, 26, 0.4, 5.9);
      g.stroke();
      g.lineWidth = 2;
      g.beginPath();
      g.arc(33, 31, 22, 2, 4.5);
      g.stroke();
    },
  }),
];

// seeded() with neighbouring seeds starts almost the same, so the clutter's seeds are mixed first.
const mixed = (n) => seeded(((Math.imul(n, 2654435761) >>> 0) % 2147483646) + 1);

const overlap = (a, b, m = 4) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// The clutter for `clues` (one note per clue, one random item per clue), each in the first spot (of 80 random tries) that
// is clear of `taken` (the fixed boxes: folder, WHO? card, Cleared folder) and of the clutter before it; with no clear spot,
// the spot that covers the least. Placed oldest first and never looking at the photos (which change every question), so a
// piece stays where it was put. Drawn under the photos, so a crowded board hides some of it. Same case: same spots.
function drawClutter(g, caseNo, clues, taken, art) {
  const order = shuffle(ITEMS.map((_, i) => i), mixed(caseNo * 7 + 1));
  const pieces = [];
  clues.forEach((clue, k) => {
    pieces.push(stickyNote(clue, mixed(caseNo * 31 + k * 2 + 1)));
    pieces.push(ITEMS[order[k % order.length]](mixed(caseNo * 31 + k * 2 + 2), art));
  });
  const busy = [...taken];
  const spots = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const rnd = mixed(caseNo * 131 + i * 17 + 3);
    let best = null;
    for (let t = 0; t < 80; t++) {
      const r = { x: 28 + rnd() * (W - 56 - p.w), y: 28 + rnd() * (H - 56 - p.h), w: p.w, h: p.h };
      const cost = busy.reduce((sum, b) => sum + (overlap(r, b) ? area(r, b) + 1 : 0), 0);
      if (!best || cost < best.cost) best = { ...r, cost, angle: (rnd() - 0.5) * 0.3 };
      if (!cost) break;
    }
    busy.push(best);
    spots[i] = best;
  }
  for (const [i, p] of pieces.entries()) {
    const { x, y, angle } = spots[i];
    g.save();
    g.translate(x + p.w / 2, y + p.h / 2);
    g.rotate(angle);
    g.translate(-p.w / 2, -p.h / 2);
    p.draw(g, (caseNo * 7 + i * 131) % 100000);
    if (p.pin) pin(g, ...p.pin, ['#d62828', '#2a6fd6', '#e8c21c', '#2fa35a'][i % 4]);
    g.restore();
  }
}
// A seeded shuffle (random.js's takes a random-int function; this one a 0..1 one).
function shuffle(list, rnd) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One board at (ox, oy). board: { left: suspect names still in, caseNo, clues: [[question, yes]], solved (the culprit,
// caught), culprit (the culprit, not caught), accused (a wrong pick), side (a duel's second board: 1) }.
async function drawBoard(g, ox, oy, board) {
  const art = await loadIcons();
  g.save();
  g.translate(ox, oy);
  g.drawImage(corkTexture(), 0, 0);
  const rnd = seeded(board.caseNo);
  const left = new Set(board.left);
  const ins = HEROES.map((h) => h.name).filter((n) => left.has(n));
  let outs = HEROES.map((h) => h.name).filter((n) => !left.has(n));
  const culprit = board.solved || board.culprit;
  // once it's over only the culprit (and a wrong pick) stay up; everyone else is filed under Cleared
  let show = ins;
  if (culprit) {
    show = board.accused && board.accused !== culprit ? [board.accused, culprit] : [culprit];
    outs = HEROES.map((h) => h.name).filter((n) => !show.includes(n));
  }

  // where everything goes, so the clutter can keep clear of it
  const caseBox = { x: 30, y: 26, w: 262, h: 92 };
  const whoBox = { x: W - 154, y: 26, w: 92, h: 110 };
  const folderH = outs.length ? 32 : 0;
  const two = outs.length > 20;
  const fy = H - 28 - folderH;
  const clearedBox = { x: 30, y: fy - (two ? 52 : 38), w: W - 60, h: folderH + (two ? 52 : 38) };
  const top = culprit ? 112 : 116;
  // a crowded board keeps a column on the right clear for the clutter
  const side = !culprit && board.clues?.length && show.length > 8 ? 108 : 0;
  const box = { x: 36, y: top, w: W - 72 - side, h: H - top - 26 - (outs.length ? folderH + 46 : 0) };
  const tiles = place(show, box, 1.22, show.length > 22 ? 5 : culprit ? 70 : 14, 120);
  // fixed boxes only (the same on every question), so clutter never moves; the Cleared folder is always reserved
  const reserved = { x: 30, y: H - 28 - 32 - 52, w: W - 60, h: 32 + 52 };
  drawClutter(g, board.caseNo + (board.side ?? 0) * 7919, board.clues ?? [], [caseBox, whoBox, reserved], await loadBoardArt());

  // the case folder
  g.save();
  g.translate(34, 44);
  g.rotate(-0.025);
  folder(g, 0, 0, 252, 70, { tab: { x: 10, w: 132, text: `CASE No. ${board.caseNo}` }, seed: 3 });
  g.fillStyle = TYPE_INK;
  g.textAlign = 'left';
  g.font = `15px ${TYPED}`;
  g.fillText('HOMICIDE  -  DET. ABRAMS', 12, 30);
  g.font = `14px ${TYPED}`;
  g.fillText(!culprit ? `SUSPECTS: ${ins.length} OF ${HEROES.length}` : board.solved ? 'STATUS: CLOSED' : 'STATUS: UNSOLVED', 12, 52);
  g.restore();
  pin(g, 270, 56, '#2a6fd6');

  // the WHO? card the strings run to, while the case is open
  const hub = [W - 108, 32];
  if (!culprit) {
    g.save();
    g.translate(W - 150, 30);
    g.rotate(0.05);
    polaroidFrame(g, 80, 98);
    g.fillStyle = '#1b1a20';
    g.fillRect(5, 5, 70, 70);
    g.fillStyle = '#3a3742';
    g.beginPath();
    g.arc(40, 34, 15, 0, 7);
    g.fill();
    g.beginPath();
    g.ellipse(40, 75, 28, 22, 0, Math.PI, 0);
    g.fill();
    aged(g, 5, 5, 70, 70);
    g.fillStyle = '#f4efe4';
    g.font = `30px ${MARKER}`;
    g.textAlign = 'center';
    g.fillText('?', 40, 50);
    g.fillStyle = '#2b1d12';
    g.font = `13px ${MARKER}`;
    g.fillText('WHO?', 40, 92);
    g.restore();
  }

  // the suspects
  for (const t of tiles) photo(g, art[t.name], { ...t, leak: rnd() < 0.25 ? rnd() : 0 }, (rnd() - 0.5) * 0.12);
  if (!culprit && ins.length <= 12) {
    g.save();
    g.strokeStyle = STRING;
    g.lineWidth = 2;
    Object.assign(g, { shadowColor: 'rgba(0,0,0,.4)', shadowOffsetY: 2, shadowBlur: 2 });
    for (const t of tiles) {
      const p = [t.x + t.s / 2, t.y + 4];
      g.beginPath();
      g.moveTo(...p);
      g.quadraticCurveTo((p[0] + hub[0]) / 2, Math.max(p[1], hub[1]) + 30, ...hub);
      g.stroke();
    }
    g.restore();
  }
  for (const t of tiles) pin(g, t.x + t.s / 2, t.y + 4);
  if (!culprit) pin(g, ...hub);
  if (culprit) {
    const label = (t, text, angle) => tape(g, t.x + t.s / 2, t.y + t.s * 1.22 + 6, text, angle);
    if (tiles.length === 2) {
      const [a, b] = tiles;
      g.save();
      g.strokeStyle = STRING;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(a.x + a.s / 2, a.y + 4);
      g.quadraticCurveTo((a.x + b.x + b.s) / 2, a.y - 30, b.x + b.s / 2, b.y + 4);
      g.stroke();
      g.restore();
      pin(g, a.x + a.s / 2, a.y + 4);
      pin(g, b.x + b.s / 2, b.y + 4);
      label(a, 'YOUR PICK', 0.04);
      label(b, 'THE CULPRIT', -0.05);
    } else label(tiles[0], board.solved ? 'CAUGHT' : 'THE CULPRIT', -0.05);
  }

  // the Cleared folder: the ruled-out suspects' photos tucked into it, in grey
  if (outs.length) {
    const fx = 30;
    const fw = W - 60;
    folder(g, fx, fy - (two ? 44 : 30), fw, folderH + (two ? 44 : 30), { shade: 0.12, seed: 9 });
    const s = 32;
    const rows = two ? [outs.filter((_, i) => i % 2 === 0), outs.filter((_, i) => i % 2)] : [outs];
    rows.forEach((row, r) => {
      const step = Math.min(s + 6, (fw - 170 - s) / Math.max(1, row.length - 1));
      row.forEach((n, i) => {
        const x = fx + 150 + (r ? step / 2 : 0) + i * step;
        const y = fy - (two ? (r ? 24 : 42) : 26);
        g.save();
        g.translate(x + s / 2, y + s / 2);
        g.rotate((rnd() - 0.5) * 0.25);
        g.translate(-s / 2, -s / 2);
        shadow(g, 3, 0);
        g.fillStyle = '#ece6d8';
        g.fillRect(-2, -2, s + 4, s + 4);
        noShadow(g);
        g.filter = 'grayscale(1) brightness(.9)';
        if (art[n]) g.drawImage(art[n], 0, 0, s, s);
        g.filter = 'none';
        g.restore();
      });
    });
    folder(g, fx, fy, fw, folderH, { seed: 11 });
    g.save();
    g.translate(fx + 12, fy - (two ? 36 : 24));
    g.rotate(-0.03);
    shadow(g, 3, 0);
    g.fillStyle = '#f6f1e3';
    g.fillRect(0, 0, 124, 40);
    noShadow(g);
    g.fillStyle = TYPE_INK;
    g.textAlign = 'center';
    g.font = `16px ${TYPED}`;
    g.fillText('CLEARED', 62, 18);
    g.font = `13px ${TYPED}`;
    g.fillText(`${outs.length} SUSPECT${outs.length === 1 ? '' : 'S'}`, 62, 34);
    g.restore();
  }
  finish(g);
  g.restore();
}

// Deadlock's look over the whole board (his ask): comic halftone shade in the corners, a teal cast in the shadows,
// then the film grain and vignette every game picture ends with.
let grainTexture;
function finish(g) {
  halftone(g, 0, 0, W, H, 6, (u, v) => Math.max(0, Math.hypot(u - 0.5, v - 0.5) * 1.6 - 0.74), 'rgba(12,8,4,.35)'); // the corners only
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(40,96,100,.35)';
  g.fillRect(0, 0, W, H);
  g.restore();
  grainTexture ??= grain(W, H, 11, 50);
  grainAndVignette(g, W, H, grainTexture, { grainAlpha: 0.45, inner: 200, outer: 420, dark: 0.45 });
}

// One case board, a PNG buffer.
async function renderBoard(board) {
  const c = createCanvas(W, H);
  await drawBoard(c.getContext('2d'), 0, 0, board);
  return c.toBuffer('image/png');
}

// A duel: two boards side by side, each under its detective's name. boards: [{ detective, ...board }, two of them].
async function renderDuel(boards) {
  const TOP = 40;
  const c = createCanvas(W * 2 + 20, H + TOP);
  const g = c.getContext('2d');
  g.fillStyle = '#1e1a16';
  g.fillRect(0, 0, c.width, c.height);
  for (const [i, b] of boards.entries()) {
    const ox = i * (W + 20);
    g.fillStyle = '#f3e9dc';
    g.textAlign = 'center';
    const label = `${b.detective.toUpperCase()}'S CASE`;
    fit(g, label, 'Radiance', 24, W - 40, 12);
    g.fillText(label, ox + W / 2, 29);
    await drawBoard(g, ox, TOP, { ...b, side: i }); // side: each detective's board gets its own clutter
  }
  return c.toBuffer('image/png');
}

module.exports = { renderBoard, renderDuel };
