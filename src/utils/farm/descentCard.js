// /descend's pick screen (his ask, Oct 24: like Street Brawl's "Select Items"): a revolver cylinder over a dark, blurred backdrop, "SELECT ITEMS" top
// left. The cylinder spins, slows, clicks into place, then the 3 choices show in its top chambers (vitality left, weapon top, spirit right, like
// the game): a ring in the kind's colour, the item's picture and name, "UPGRADE" under an upgrade of a held item (the game's "ENHANCED").
// A boss's reward uses the same screen with buffs or legendaries. The first time an offer is shown it is a GIF that plays once and stays on the
// picks; any redraw after that is the still PNG (the spin doesn't replay). Our own drawing in the game's style, not its art.
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { grain, grainAndVignette } = require('../art'); // (also registers the Retail font)
const { image, FARM } = require('./roamCard');
const { itemFile } = require('./itemArt');
const { itemByName } = require('./stats');
const { write, measure } = require('./shopCard');
const { encodeGif } = require('../gif');
const { buffText } = require('./buffs');

const W = 800;
const H = 460;
const C = [400, 332]; // the cylinder's centre
const SPOKE = 160; // centre to a chamber
const CHAMBER = 70; // a chamber's radius
const BODY = 238; // the cylinder's outer radius
const TOP = [-90 - 72, -90, -90 + 72]; // the three chambers that hold the picks: left, top, right (degrees)
const KIND = { weapon: '#ee9a2e', vitality: '#74d13c', spirit: '#b763ec', legendary: '#f0c34a' };
// A permanent buff's ring colour: the stat's side of the game's three (weapon, vitality, spirit).
const BUFF_KIND = { fireRate: 'weapon', maxAmmo: 'weapon', weaponDamage: 'weapon', precision: 'weapon', maxHealth: 'vitality', bulletResist: 'vitality', spiritResist: 'vitality', moveSpeed: 'vitality', spiritPower: 'spirit', cooldownReduction: 'spirit', abilityRange: 'spirit' };
const SLOT_KIND = { Weapon: 'weapon', Armor: 'vitality', Tech: 'spirit' };
const rad = (deg) => (deg * Math.PI) / 180;
const at = (deg, r) => [C[0] + Math.cos(rad(deg)) * r, C[1] + Math.sin(rad(deg)) * r];

// The dark, out-of-focus room behind the cylinder (kept once).
let backdrop;
function drawBackdrop() {
  if (backdrop) return backdrop;
  backdrop = createCanvas(W, H);
  const g = backdrop.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2a2622');
  bg.addColorStop(0.5, '#1a1b1e');
  bg.addColorStop(1, '#0e1012');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (const [x, y, r, color] of [[90, 250, 140, 'rgba(196,150,90,0.22)'], [690, 90, 170, 'rgba(120,130,150,0.16)'], [560, 380, 120, 'rgba(150,70,60,0.14)'], [250, 40, 110, 'rgba(210,190,150,0.12)'], [760, 300, 90, 'rgba(90,140,120,0.12)']]) {
    const glow = g.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
  }
  grainAndVignette(g, W, H, grain(W, H, 2410, 40), { grainAlpha: 0.35, inner: 180, outer: 520, dark: 0.6 });
  return backdrop;
}

// The cylinder at rest (chambers empty), drawn once on its own square; a frame turns it.
let body;
function drawBody() {
  if (body) return body;
  const S = BODY * 2 + 20;
  body = createCanvas(S, S);
  const g = body.getContext('2d');
  g.translate(S / 2, S / 2);
  const pt = (deg, r) => [Math.cos(rad(deg)) * r, Math.sin(rad(deg)) * r];
  // the outer shell, with a flute cut between every two chambers
  g.beginPath();
  g.arc(0, 0, BODY, 0, Math.PI * 2);
  g.fillStyle = 'rgba(150,152,160,0.16)';
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i++) { const [x, y] = pt(-90 + 36 + 72 * i, BODY + 6); g.beginPath(); g.arc(x, y, 50, 0, Math.PI * 2); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(214,214,220,0.75)';
  g.lineWidth = 4;
  g.beginPath();
  for (let i = 0; i < 5; i++) { // the rim: arcs between the flutes, the flutes curving in
    const a0 = -90 + 36 + 72 * i;
    const half = (Math.asin(50 / (BODY + 6)) * 180) / Math.PI;
    g.arc(0, 0, BODY, rad(a0 + half), rad(a0 + 72 - half));
  }
  g.stroke();
  for (let i = 0; i < 5; i++) { const [x, y] = pt(-90 + 36 + 72 * i, BODY + 6); g.beginPath(); g.arc(x, y, 50, rad(-90 + 36 + 72 * i + 180 - 62), rad(-90 + 36 + 72 * i + 180 + 62)); g.stroke(); }
  // an inner dashed ring
  g.setLineDash([26, 14]);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(214,214,220,0.4)';
  g.beginPath();
  g.arc(0, 0, BODY - 22, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  // the spokes from the hub to each chamber
  for (let i = 0; i < 5; i++) {
    const deg = -90 + 72 * i;
    g.save();
    g.rotate(rad(deg));
    g.fillStyle = 'rgba(170,172,180,0.18)';
    g.fillRect(56, -22, SPOKE - 56, 44);
    g.strokeStyle = 'rgba(214,214,220,0.5)';
    g.lineWidth = 2;
    g.strokeRect(56, -22, SPOKE - 56 - CHAMBER, 44);
    g.restore();
  }
  // the chambers: dark wells with a faint hexagram, a pale rim
  for (let i = 0; i < 5; i++) {
    const [x, y] = pt(-90 + 72 * i, SPOKE);
    const well = g.createRadialGradient(x, y - 10, 4, x, y, CHAMBER);
    well.addColorStop(0, '#26272b');
    well.addColorStop(1, '#0b0b0d');
    g.beginPath();
    g.arc(x, y, CHAMBER, 0, Math.PI * 2);
    g.fillStyle = well;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 2;
    for (const turn of [0, 180]) {
      g.beginPath();
      for (let k = 0; k < 3; k++) { const a = rad(turn - 90 + 120 * k); const px = x + Math.cos(a) * CHAMBER * 0.78; const py = y + Math.sin(a) * CHAMBER * 0.78; if (k) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath();
      g.stroke();
    }
    g.beginPath();
    g.arc(x, y, CHAMBER, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(200,200,206,0.8)';
    g.lineWidth = 5;
    g.stroke();
  }
  // the hub
  g.beginPath();
  g.arc(0, 0, 58, 0, Math.PI * 2);
  g.fillStyle = 'rgba(20,20,24,0.75)';
  g.fill();
  g.strokeStyle = 'rgba(214,214,220,0.7)';
  g.lineWidth = 3;
  g.stroke();
  return body;
}

// Text that fits `width`, on one or two lines, centred at (x, y).
function label(g, text, x, y, px, width) {
  let size = px;
  while (size > 11 && measure(g, text, size) > width) size -= 1;
  if (measure(g, text, size) <= width) return write(g, text, x, y, size);
  const words = text.split(' ');
  const cut = Math.ceil(words.length / 2);
  write(g, words.slice(0, cut).join(' '), x, y - size * 0.55, Math.max(11, px - 2));
  write(g, words.slice(cut).join(' '), x, y + size * 0.55, Math.max(11, px - 2));
}

// One pick in its chamber: `grow` 0-1 as it pops in.
async function choiceIn(g, choice, deg, grow = 1) {
  const [x, y] = at(deg, SPOKE);
  const color = KIND[choice.kind];
  g.save();
  g.globalAlpha = Math.min(1, grow * 1.4);
  g.shadowColor = color;
  g.shadowBlur = 22 * grow;
  g.beginPath();
  g.arc(x, y, CHAMBER, 0, Math.PI * 2);
  g.strokeStyle = color;
  g.lineWidth = 7;
  g.stroke();
  g.shadowBlur = 0;
  const pic = await image(choice.picture);
  const s = 64 * (0.5 + grow / 2);
  g.drawImage(pic, x - s / 2, y - 16 - s / 2, s, s);
  if (grow >= 1) {
    g.fillStyle = '#f4efe6';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 6;
    label(g, choice.name, x, y + 38, 17, CHAMBER * 1.7);
    if (choice.tag) { g.fillStyle = '#5ab8ff'; write(g, choice.tag, x, y + 62, 13); }
  }
  g.restore();
}

// The still part of every frame: backdrop and title.
function frameBase(g, title, line) {
  g.drawImage(drawBackdrop(), 0, 0);
  g.fillStyle = '#ece6da';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 8;
  write(g, title, 40, 92, 46, false);
  g.fillStyle = '#d65fe0';
  write(g, line, 42, 122, 18, false);
  g.shadowBlur = 0;
}
function hub(g, hubText) {
  g.fillStyle = '#ece6da';
  write(g, hubText[0], C[0], C[1] + 2, 16);
  g.fillStyle = 'rgba(236,230,218,0.6)';
  write(g, hubText[1], C[0], C[1] + 22, 11);
}

// choices: [{ name, kind: weapon | vitality | spirit | legendary, picture (file), tag? }], in chamber order (left, top, right).
// Returns { gif } (animate) or { png }.
async function pickPicture({ choices, title = 'SELECT ITEMS', line = '', hubText = ['PICK ONE', 'OR SKIP'], animate = true }) {
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
    hub(g, hubText);
    return c;
  };
  if (!animate) return { png: (await draw(0, 1)).toBuffer('image/png') };
  // two and a half turns, slowing to a stop (ease out), a small kick back as it locks, then the picks pop in
  const SPIN = 22;
  const turns = 720 + 72 * 2;
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
  return { gif: encodeGif(rgba, W, H, { picks: [0, Math.floor(SPIN / 2), frames.length - 1] }) };
}

// What an offer looks like in the chambers: items (their kind's colour, "UPGRADE" for one that upgrades a held item), buffs (`stacks` of each), legendaries.
const BUFF_DIR = path.join(FARM, 'buffs');
function choicesOf(offer, upgrades = new Set(), stacks = 1) {
  if (offer.kind === 'buffs') return offer.choices.map((key) => ({ name: buffText(key, stacks), kind: BUFF_KIND[key] ?? 'legendary', picture: path.join(BUFF_DIR, `${key}.png`) }));
  if (offer.kind === 'legendaries') return offer.choices.map((name) => ({ name, kind: 'legendary', picture: itemFile(name) }));
  return offer.choices.map((name) => ({ name, kind: SLOT_KIND[itemByName(name).Slot], picture: itemFile(name), tag: upgrades.has(name) ? 'UPGRADE' : null }));
}

module.exports = { pickPicture, choicesOf, KIND };
