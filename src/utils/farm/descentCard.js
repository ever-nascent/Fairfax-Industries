// /descend's pick screen (his ask, Oct 24; redrawn Oct 26 to match the game's "Select Items" almost 1 to 1): a blurred street behind a line-drawn
// revolver cylinder (6 chambers 60 degrees apart, a scalloped shell with flutes between them), "SELECT ITEMS" top left with a pink line under it.
// The cylinder spins, slows, clicks into place, then the 3 choices show in its top chambers (vitality left, weapon top, spirit right, like the game):
// the chamber is tinted by the item's kind and glows inward, the item sits in a framed card (tier marks top right, ACTIVE along the bottom) with its
// name under it; ENHANCED is the blue badge under the name, UPGRADE (an item that upgrades one the hero holds) the game's teal ribbon across the
// card's corner, and a BONUS item is a smaller tilted card over the corner with "BONUS!" above it. Left out on purpose: what makes no sense in
// Discord (the timer, the hero portraits, the bottom bar, the item tooltip: the stats are in the embed). A boss's reward uses the same screen with
// buffs or legendaries. The first time an offer is shown it is a GIF that plays once and stays on the picks; any redraw after that is the still PNG
// (the spin doesn't replay). Our own drawing in the game's style, not its art.
const path = require('node:path');
const { createCanvas, Path2D, PathOp } = require('@napi-rs/canvas');
const { grain, grainAndVignette } = require('../art'); // (also registers the Retail and Radiance fonts)
const { image, FARM } = require('./roamCard');
const { itemFile, enhancedOverlay } = require('./itemArt');
const { itemByName } = require('./stats');
const { encodeGif } = require('../gif');
const { buffText } = require('./buffs');

const W = 800;
const H = 460;
const C = [400, 375]; // the cylinder's hub (low, below the picture's middle like the game's)
const SPOKE = 200; // hub to a chamber
const RING = 75; // a chamber's ring radius
const RING_TOP = 80; // the top chamber is about 7% bigger
const SHELL = 292; // the shell's outer radius
const TOP = [-150, -90, -30]; // the three chambers that hold the picks: left, top, right (degrees)
const FONT = 'Radiance, sans-serif';
// the ring's colour, the chamber's inside from its rim to its middle, and the card's border, by kind
const KIND = { weapon: '#ce9425', vitality: '#8cc63a', spirit: '#b695d9', legendary: '#e6bc4a' };
const RING_FROM = { vitality: '#6b8730' }; // vitality's ring is a gradient, dark to light
const INSIDE = { weapon: ['#6b4311', '#1c1209'], vitality: ['#273306', '#101b03'], spirit: ['#4e355d', '#28222d'], legendary: ['#5e4a12', '#211a08'] };
const UPGRADE = '#56b6b0';
// A permanent buff's ring colour: the stat's side of the game's three (weapon, vitality, spirit).
const BUFF_KIND = { fireRate: 'weapon', maxAmmo: 'weapon', weaponDamage: 'weapon', precision: 'weapon', maxHealth: 'vitality', bulletResist: 'vitality', spiritResist: 'vitality', moveSpeed: 'vitality', spiritPower: 'spirit', cooldownReduction: 'spirit', abilityRange: 'spirit' };
const SLOT_KIND = { Weapon: 'weapon', Armor: 'vitality', Tech: 'spirit' };
const rad = (deg) => (deg * Math.PI) / 180;
const polar = (deg, r) => [Math.cos(rad(deg)) * r, Math.sin(rad(deg)) * r];
const at = (deg, r) => { const [x, y] = polar(deg, r); return [C[0] + x, C[1] + y]; };
const ringOf = (deg) => (deg === -90 ? RING_TOP : RING);
// the same pseudo-random numbers every time, so a redraw never moves anything
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// The blurred game street behind the cylinder (kept once): warm brown low on the left, cool grey light streaks high up, soft diagonal shafts of light.
let backdrop;
function drawBackdrop() {
  if (backdrop) return backdrop;
  const s = createCanvas(W, H);
  const g = s.getContext('2d');
  const base = g.createLinearGradient(0, H, W, 0);
  base.addColorStop(0, '#6e4c36');
  base.addColorStop(0.4, '#4d4540');
  base.addColorStop(0.75, '#3f434a');
  base.addColorStop(1, '#585c64');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const blob = (x, y, r, color) => { const b = g.createRadialGradient(x, y, 0, x, y, r); b.addColorStop(0, color); b.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = b; g.fillRect(0, 0, W, H); };
  blob(60, 330, 260, 'rgba(176,112,64,0.55)'); // the warm street low on the left
  blob(700, 60, 260, 'rgba(170,176,190,0.40)'); // cool light high on the right
  blob(330, 20, 200, 'rgba(190,190,196,0.30)');
  blob(760, 400, 200, 'rgba(120,56,44,0.40)'); // a red sign low on the right
  blob(400, 250, 200, 'rgba(18,16,18,0.45)'); // the dark the cylinder sits in
  g.globalCompositeOperation = 'lighter';
  for (const [x0, w, a] of [[30, 90, 0.07], [180, 60, 0.05], [330, 120, 0.07], [520, 70, 0.06], [650, 100, 0.07]]) { // diagonal light shafts
    g.fillStyle = `rgba(240,240,250,${a})`;
    g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + w, 0); g.lineTo(x0 + w - 240, H); g.lineTo(x0 - 240, H); g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const soft = createCanvas(W, H);
  const k = soft.getContext('2d');
  k.filter = 'blur(16px)';
  k.drawImage(s, -20, -20, W + 40, H + 40);
  k.filter = 'none';
  grainAndVignette(k, W, H, grain(W, H, 2410, 30), { grainAlpha: 0.22, inner: 260, outer: 620, dark: 0.55 });
  backdrop = soft;
  return backdrop;
}

// A hexagon of radius r at (x, y) as a path.
function hexagon(g, x, y, r, turn = 0) {
  g.beginPath();
  for (let k = 0; k < 6; k++) { const [px, py] = polar(turn - 90 + 60 * k, r); if (k) g.lineTo(x + px, y + py); else g.moveTo(x + px, y + py); }
  g.closePath();
}
// A chamber's bore, like the game's: a six-pointed star of two triangles (an upright one and an upside-down one) crossing inside it. `dark` draws it as
// shaded lines (a tinted pick's chamber), else faint light ones (an empty chamber).
function bore(g, x, y, r, tint) {
  g.save();
  g.lineJoin = 'round';
  for (const turn of [0, 180]) {
    g.beginPath();
    for (let k = 0; k < 3; k++) { const [px, py] = polar(turn - 90 + 120 * k, r * 0.86); if (k) g.lineTo(x + px, y + py); else g.moveTo(x + px, y + py); }
    g.closePath();
    if (tint) { g.globalAlpha = 0.34; g.strokeStyle = tint; g.lineWidth = 6.5; g.stroke(); } // thick bands in the kind's colour, like the game's
    else { g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 2; g.stroke(); }
  }
  g.restore();
}

// The cylinder at rest (chambers empty), drawn once on its own square round the hub; a frame turns it. Lines only, worn grey, no spokes.
let body;
function drawBody() {
  if (body) return body;
  const S = 680;
  body = createCanvas(S, S);
  const g = body.getContext('2d');
  g.translate(S / 2, S / 2);
  // the scalloped shell: one big round with a flute (a round notch) cut between every two chambers
  let shell = new Path2D();
  shell.arc(0, 0, SHELL, 0, Math.PI * 2);
  const rim = new Path2D(); // the big rim behind the top chamber is part of the shell's outline, not a line through it
  rim.arc(...polar(-90, SPOKE), 112, 0, Math.PI * 2);
  shell = shell.op(rim, PathOp.Union);
  for (let i = 0; i < 6; i++) { const [x, y] = polar(-60 + 60 * i, SHELL + 8); const p = new Path2D(); p.arc(x, y, 46, 0, Math.PI * 2); shell = shell.op(p, PathOp.Difference); }
  g.fillStyle = 'rgba(12,12,16,0.30)';
  g.fill(shell);
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(210,210,216,0.25)';
  g.lineWidth = 10;
  g.stroke(shell);
  g.strokeStyle = 'rgba(222,222,228,0.92)';
  g.lineWidth = 4.5;
  g.stroke(shell);
  // short arcs linking neighbours, on the circle between the chambers and the hub
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(222,222,228,0.75)';
  g.lineWidth = 10;
  for (let i = 0; i < 6; i++) { const mid = -60 + 60 * i; g.beginPath(); g.arc(0, 0, 173, rad(mid - 6), rad(mid + 6)); g.stroke(); }
  g.lineCap = 'butt';
  // the hub, low and quiet
  g.strokeStyle = 'rgba(206,206,212,0.4)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.stroke();
  // the chambers: a dark well, its bore, a worn ring, a thin broken ring round it
  for (let i = 0; i < 6; i++) {
    const deg = -90 + 60 * i;
    const [x, y] = polar(deg, SPOKE);
    const r = i === 0 ? RING_TOP : RING;
    const well = g.createRadialGradient(x, y, 4, x, y, r);
    well.addColorStop(0, '#0b0b0d');
    well.addColorStop(1, '#27272c');
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = well; g.fill();
    bore(g, x, y, r, null);
    g.strokeStyle = 'rgba(206,206,212,0.8)';
    g.lineWidth = 5;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(206,206,212,0.5)';
    g.lineWidth = 2.5;
    g.setLineDash([70, 18, 120, 24, 40, 20]);
    g.beginPath(); g.arc(x, y, r + 14, rad(deg + 20), rad(deg + 20) + Math.PI * 2); g.stroke();
    g.setLineDash([]);
  }
  // worn: tiny nicks taken out of the lines
  const rand = rng(77);
  g.globalCompositeOperation = 'destination-out';
  for (let n = 0; n < 700; n++) { g.fillStyle = `rgba(0,0,0,${0.25 + rand() * 0.5})`; g.fillRect((rand() - 0.5) * S, (rand() - 0.5) * S, 1 + rand() * 3, 1 + rand() * 1.5); }
  g.globalCompositeOperation = 'source-over';
  return body;
}

// `text` in one line when it fits `width`, else the two most even lines.
function wrap(g, text, width) {
  g.font = `19px ${FONT}`;
  if (g.measureText(text).width <= width) return [text];
  const words = text.split(' ');
  if (words.length < 2) return [text];
  let best = null;
  for (let cut = 1; cut < words.length; cut++) {
    const lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (!best || widest < best.widest) best = { lines, widest };
  }
  return best.lines;
}
// Cream lettering with a dark outline and a shadow, centred at (x, y).
function lettering(g, text, x, y, px = 19, fill = '#f0e8da') {
  g.save();
  g.font = `${px}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  g.strokeStyle = '#17120e';
  g.lineWidth = 4.5;
  g.strokeText(text, x, y);
  g.shadowColor = 'transparent';
  g.fillStyle = fill;
  g.fillText(text, x, y);
  g.restore();
}
// "BONUS!" / "ENHANCED": bold italic caps, white (or the badge's blue) with a dark outline.
function slanted(g, text, x, y, px, fill, outline, turn = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rad(turn));
  g.font = `italic bold ${px}px sans-serif`;
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.strokeStyle = outline;
  g.lineWidth = px * 0.36;
  g.strokeText(text, 0, 0);
  g.fillStyle = fill;
  g.fillText(text, 0, 0);
  g.restore();
}
// The blue ENHANCED badge with the game's own Enhanced arrow (the wiki's Enhanced arrow.png, his pick Oct 30), centred at (x, y).
const ARROW = path.join(FARM, 'ui', 'enhanced_arrow.png');
// The wiki's own style for the word: #3FDCFF, bold, Retail (its Valve Pulp / retail-demo), a 2 px #112179 outline all round and a 6 px #112179 glow (his paste of the wiki's CSS, Oct 30; sizes scaled to `px`).
const TILT = -4; // degrees: the word leans left, rising to the right (his ask, Oct 30: 3-5)
function enhancedWord(g, x, y, px) {
  const edge = '#112179', d = Math.max(1, px * 0.13);
  g.save();
  g.translate(x, y);
  g.rotate(rad(TILT));
  x = 0; y = 0;
  g.font = `bold ${px}px Retail, sans-serif`;
  g.textAlign = 'center';
  g.shadowColor = edge;
  g.shadowBlur = 0;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) { // text-shadow: the 8 offsets
    g.shadowOffsetX = dx * d; g.shadowOffsetY = dy * d;
    g.fillStyle = edge;
    g.fillText('ENHANCED', x, y);
  }
  g.shadowOffsetX = 0; g.shadowOffsetY = 0; g.shadowBlur = px * 0.46; // 0 0 6px
  g.fillText('ENHANCED', x, y);
  g.shadowColor = 'transparent';
  g.fillStyle = '#3FDCFF';
  g.fillText('ENHANCED', x, y);
  const width = g.measureText('ENHANCED').width;
  g.restore();
  return width;
}
async function enhancedBadge(g, x, y) {
  const px = 15;
  const w = enhancedWord(g, x - 8, y, px);
  const arrow = await image(ARROW);
  const h = 34;
  const rise = Math.sin(rad(TILT)) * (w / 2 + 3); // the arrow follows the word's tilt
  g.drawImage(arrow, x - 8 + w / 2 + 3, y - h + 9 + rise, h * arrow.width / arrow.height, h);
}

// One framed item card (the picture, its border in the kind's colour, tier marks top right, ACTIVE / IMBUE along the bottom, the UPGRADE ribbon)
// centred at (cx, cy), `size` square, turned by `turn` degrees.
async function card(g, { picture, kind, tier, active, upgrade, enhanced }, cx, cy, size, turn = 0) {
  const x = -size / 2;
  g.save();
  g.translate(cx, cy);
  g.rotate(rad(turn));
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowBlur = 12;
  g.shadowOffsetY = 4;
  g.fillStyle = '#101214';
  g.beginPath(); g.roundRect(x, x, size, size, 4); g.fill();
  g.shadowColor = 'transparent';
  g.save();
  g.beginPath(); g.roundRect(x, x, size, size, 4); g.clip();
  try { g.drawImage(await image(picture), x, x, size, size); } catch { /* no picture: the name says what it is */ }
  if (enhanced) { // an enhanced item gets the wiki's blue 45-degree gradient over its picture
    enhancedOverlay(g, x, x, size, size);
  }
  if (active) { // a dark pill at the bottom, centred
    const th = Math.round(size * 0.15), tw = size * (active === 'IMBUE' ? 0.5 : 0.46);
    g.fillStyle = active === 'IMBUE' ? 'rgba(90,58,138,0.95)' : 'rgba(16,16,18,0.92)';
    g.beginPath(); g.roundRect(-tw / 2, x + size - th - size * 0.05, tw, th, th * 0.3); g.fill();
    g.fillStyle = active === 'IMBUE' ? '#d4b8f0' : 'rgba(240,232,218,0.95)';
    g.font = `bold ${Math.max(6, Math.round(size * 0.105))}px sans-serif`;
    g.textAlign = 'center';
    g.fillText(active, 0, x + size - size * 0.05 - th * 0.27);
  }
  if (upgrade) { // the game's teal ribbon across the top-right corner
    g.strokeStyle = UPGRADE;
    g.lineWidth = size * 0.17;
    g.beginPath(); g.moveTo(-x - size * 0.5, x - 2); g.lineTo(-x + 2, x + size * 0.5); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-x - size * 0.5 - 4, x - 2); g.lineTo(-x + 2, x + size * 0.5 + 4); g.stroke();
  }
  if (tier) { // the corner is cut in the border's colour, the tier marks (a bar for each tier) on it
    const c = size * 0.2;
    g.fillStyle = KIND[kind];
    g.beginPath(); g.moveTo(-x - c, x); g.lineTo(-x, x); g.lineTo(-x, x + c); g.closePath(); g.fill();
    const bw = size * 0.02, bh = size * 0.055, gap = bw * 1.9;
    g.save();
    g.translate(-x - c * 0.3, x + c * 0.3);
    g.rotate(rad(45));
    g.fillStyle = '#2a1c06';
    for (let t = 0; t < tier; t++) g.fillRect((t - (tier - 1) / 2) * gap - bw / 2, -bh / 2, bw, bh);
    g.restore();
  }
  g.restore();
  g.strokeStyle = KIND[kind];
  g.lineWidth = 3;
  g.beginPath(); g.roundRect(x, x, size, size, 4); g.stroke();
  g.restore();
}

// One pick in its chamber: `grow` 0-1 as it pops in.
async function choiceIn(g, choice, deg, grow = 1) {
  const [x, y] = at(deg, SPOKE);
  const r = ringOf(deg);
  const kind = choice.kind;
  const [rim, mid] = INSIDE[kind];
  g.save();
  g.globalAlpha = Math.min(1, grow * 1.4);
  // the inside, tinted by the kind and glowing inward
  const well = g.createRadialGradient(x, y, 6, x, y, r);
  well.addColorStop(0, mid);
  well.addColorStop(0.5, mid);
  well.addColorStop(1, rim);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = well; g.fill();
  bore(g, x, y, r, KIND[kind]);
  const shade = g.createRadialGradient(x, y, r * 0.55, x, y, r); // dark again at the rim
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = shade; g.fill();
  // the ring
  const ring = g.createLinearGradient(x - r, y + r, x + r, y - r);
  ring.addColorStop(0, RING_FROM[kind] ?? KIND[kind]);
  ring.addColorStop(1, KIND[kind]);
  g.shadowColor = KIND[kind];
  g.shadowBlur = 14 * grow;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.strokeStyle = ring;
  g.lineWidth = 5;
  g.stroke();
  g.shadowBlur = 0;
  // the card, then the name and the badge under it (the block is centred a little high in the ring)
  const size = Math.round(r * 2 * 0.45) * (0.5 + grow / 2);
  const lines = wrap(g, choice.name, 160);
  const rows = lines.length + (choice.enhanced ? 1.15 : 0);
  const top = y - (size + 8 + rows * 21) / 2 + 2;
  const cy = top + size / 2;
  await card(g, choice, x, cy, size);
  if (choice.bonus) { // a smaller card tilted over the top left, "BONUS!" above it
    await card(g, choice.bonus, x - size * 0.6, cy - size * 0.48, size * 0.75, -15);
    if (grow >= 1) slanted(g, 'BONUS!', x - size * 0.6 - 4, cy - size * 0.48 - size * 0.75 / 2 - 9, 15, '#ffffff', '#15110d', -15);
  }
  if (grow >= 1) {
    const base = top + size + 8 + 15;
    lines.forEach((l, i) => lettering(g, l, x, base + i * 21));
    if (choice.enhanced) await enhancedBadge(g, x, base + lines.length * 21 + 1);
  }
  g.restore();
}

// The still part of every frame: backdrop and title.
function frameBase(g, title, line) {
  g.drawImage(drawBackdrop(), 0, 0);
  g.save();
  g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 8;
  let px = 30; // the title is about 200 px wide, like the game's at this size
  g.font = `${px}px ${FONT}`;
  g.letterSpacing = '1px';
  while (g.measureText(title).width > 215 && px > 18) { px -= 1; g.font = `${px}px ${FONT}`; }
  g.fillStyle = '#dbd1c2';
  g.strokeStyle = '#dbd1c2';
  g.lineWidth = 1.3; // a touch heavier, like the game's
  g.lineJoin = 'round';
  g.strokeText(title, 28, 108);
  g.fillText(title, 28, 108);
  g.letterSpacing = '0.5px';
  g.font = `14px ${FONT}`;
  g.fillStyle = '#c070b0';
  g.fillText(line, 29, 134);
  g.restore();
}

// choices: [{ name, kind: weapon | vitality | spirit | legendary, picture (file), tier?, active?, upgrade?, enhanced?, bonus? }], in chamber order (left, top, right).
// Returns { gif } (animate) or { png }. hubText is accepted and ignored (the game's hub has no words).
async function pickPicture({ choices, title = 'SELECT ITEMS', line = '', animate = true }) {
  const cyl = drawBody();
  const draw = async (angle, grow, blur = 0) => {
    const c = createCanvas(W, H);
    const g = c.getContext('2d');
    frameBase(g, title, line);
    for (let k = blur; k >= 0; k--) { // a fast turn leaves a smear behind it
      g.save();
      g.globalAlpha = k ? 0.25 : 1;
      g.translate(...C);
      g.rotate(rad(angle - k * 9));
      g.drawImage(cyl, -cyl.width / 2, -cyl.height / 2);
      g.restore();
    }
    if (grow > 0) for (const [i, ch] of choices.entries()) await choiceIn(g, ch, TOP[i], grow);
    return c;
  };
  if (!animate) return { png: (await draw(0, 1)).toBuffer('image/png') };
  // two and a half turns, slowing to a stop (ease out), a small kick back as it locks, then the picks pop in
  const SPIN = 22;
  const turns = 720 + 60 * 2;
  const frames = [];
  for (let f = 0; f < SPIN; f++) {
    const t = (f + 1) / SPIN;
    const angle = -turns * (1 - (1 - t) ** 3);
    frames.push({ c: await draw(angle + turns, 0, t < 0.5 ? 2 : t < 0.75 ? 1 : 0), delay: 50 });
  }
  frames.push({ c: await draw(-3, 0), delay: 70 });
  frames.push({ c: await draw(0, 0), delay: 160 });
  for (const grow of [0.35, 0.7, 1]) frames.push({ c: await draw(0, grow), delay: grow < 1 ? 50 : 1000 });
  const rgba = frames.map((f) => ({ delay: f.delay, rgba: f.c.getContext('2d').getImageData(0, 0, W, H).data }));
  return { gif: encodeGif(rgba, W, H, { picks: [0, Math.floor(SPIN / 2), frames.length - 1], dither: true }) };
}

// What an offer looks like in the chambers: items (their kind's colour; an upgrade of a held item gets the teal ribbon, an enhanced one the blue badge,
// a BONUS item its own small card), buffs (`stacks` of each), legendaries.
const BUFF_DIR = path.join(FARM, 'buffs');
function itemChoice(name, kind) {
  const item = itemByName(name);
  return { name, kind: kind ?? SLOT_KIND[item.Slot], picture: itemFile(name), tier: item.Tier, active: item.IsImbue ? 'IMBUE' : item.Activation !== 'Passive' ? 'ACTIVE' : null };
}
function choicesOf(offer, upgrades = new Set(), stacks = 1) {
  if (offer.kind === 'buffs') return offer.choices.map((key) => ({ name: buffText(key, stacks), kind: BUFF_KIND[key] ?? 'legendary', picture: path.join(BUFF_DIR, `${key}.png`) }));
  if (offer.kind === 'legendaries') return offer.choices.map((name) => ({ ...itemChoice(name, 'legendary'), enhanced: !!offer.enhanced?.includes(name) }));
  return offer.choices.map((name, i) => ({
    ...itemChoice(name), upgrade: upgrades.has(name), enhanced: !!offer.enhanced?.includes(name), bonus: offer.bonuses?.[i] ? itemChoice(offer.bonuses[i]) : null,
  }));
}

module.exports = { pickPicture, choicesOf, KIND };
