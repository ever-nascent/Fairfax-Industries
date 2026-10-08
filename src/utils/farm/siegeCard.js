// The picture on the siege's details screen (his call, Oct 3: a drawn card, not a wall of text): the three lanes with their Walkers (the siege
// only opens while all three are down), then the five stages in the order the hero fights them. Same look as the home card (homeCard.js).
const { createCanvas } = require('@napi-rs/canvas');
const { halftone, grain, grainAndVignette } = require('../art');
const { FONT, image, panel, contain, label } = require('./roamCard');
const { fmt } = require('../format');

const W = 800;
const H = 550;
const PAD = 32;
const READY = '#7dffb3';
const DIM = 'rgba(255,255,255,0.5)';
const TYPE = {
  bullet: { color: '#ffb35c', rgb: '255,179,92', text: 'Weapon Damage' }, spirit: { color: '#c79bff', rgb: '199,155,255', text: 'Spirit Damage' },
  mixed: { color: '#ff9fc4', rgb: '255,159,196', text: 'Weapon + Spirit' }, true: { color: '#ffffff', rgb: '255,255,255', text: 'Curse: True Damage' },
};

let texture;

// The colour of a picture, as 'r,g,b': the average of its pixels, the vivid ones counting most (so a grey statue with a glowing eye
// gives that glow, and a blue book gives blue), lifted so it reads as a light on the dark card. Kept per file.
const tints = new Map();
function tintOf(file, img) {
  if (!tints.has(file)) {
    const k = Math.min(1, 96 / Math.max(img.width, img.height));
    const c = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    const sum = [0, 0, 0];
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, gr, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      const w = (a / 255) * (0.05 + ((Math.max(r, gr, b) - Math.min(r, gr, b)) / 255) ** 2);
      sum[0] += r * w; sum[1] += gr * w; sum[2] += b * w;
      weight += w;
    }
    const avg = sum.map((v) => v / (weight || 1));
    const lift = 205 / Math.max(1, ...avg); // as bright as the lane and damage colours on the card
    tints.set(file, avg.map((v) => Math.round(Math.min(255, v * lift))).join(','));
  }
  return tints.get(file);
}

// Writes `text` no wider than `maxW`: the font shrinks from `px` until it fits (never under `min`), so nothing runs off its panel.
function fit(g, text, x, y, maxW, px, min = 10) {
  let size = px;
  g.font = FONT(size);
  while (size > min && g.measureText(text).width > maxW) g.font = FONT(--size);
  g.fillText(text, x, y, maxW);
}

// lanes: [{ name, icon (file), down: its Walker is down, back: how long it stays down ('20h 0m') | null }];
// stages: [{ name, icon (file), health, count (how many enemies), damageType, curses: it also blasts true damage and curses }]. Returns a PNG.
async function siegeCard({ lanes, stages }) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#10181b');
  bg.addColorStop(1, '#0a0c10');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  halftone(g, 0, 0, W, H, 14, (u, v) => Math.max(0, u * 0.9 + (1 - v) * 0.5 - 0.75) * 0.9, 'rgba(171,255,227,0.10)');

  // ---- the lanes: a Walker per lane, all three must be down ----
  const fallen = lanes.filter((l) => l.down).length;
  const open = fallen === lanes.length;
  label(g, 'Walkers Down', PAD, 30);
  g.textAlign = 'right';
  g.font = FONT(19);
  g.fillStyle = open ? READY : 'rgba(255,255,255,0.75)';
  g.fillText(`${fallen} / ${lanes.length}`, W - PAD, 30);
  g.textAlign = 'left';
  const gap = 14;
  const lw = (W - PAD * 2 - gap * (lanes.length - 1)) / lanes.length;
  const lh = 98;
  for (const [i, lane] of lanes.entries()) {
    const x = PAD + i * (lw + gap);
    const y = 44;
    panel(g, x, y, lw, lh, lane.down ? { fill: 'rgba(125,255,179,0.07)', stroke: 'rgba(125,255,179,0.45)' } : {});
    const badge = await image(lane.icon);
    g.save();
    g.globalAlpha = lane.down ? 1 : 0.4;
    g.drawImage(badge, x + 16, y + (lh - 62) / 2, 62, 62);
    g.restore();
    const tx = x + 92;
    const tw = lw - 92 - 14; // the room left for words in this panel
    g.fillStyle = lane.down ? '#fff' : 'rgba(255,255,255,0.6)';
    fit(g, lane.name, tx, y + (lane.down ? 36 : 44), tw, 23);
    g.fillStyle = lane.down ? READY : DIM;
    fit(g, lane.down ? 'Walker Down' : 'Walker Standing', tx, y + (lane.down ? 58 : 68), tw, 16);
    if (lane.down && lane.back) {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      fit(g, `Back in ${lane.back}`, tx, y + 79, tw, 14);
    }
  }

  // ---- the stages, in order, with an arrow from each to the next ----
  const top = 198;
  label(g, 'The Siege', PAD, top - 14);
  g.textAlign = 'right';
  g.font = FONT(15);
  g.fillStyle = open ? READY : DIM;
  g.fillText(open ? 'Open' : 'Locked Until All Three Walkers Are Down', W - PAD, top - 14);
  g.textAlign = 'left';
  const sgap = 22;
  const sw = (W - PAD * 2 - sgap * (stages.length - 1)) / stages.length;
  const sh = H - top - 26;
  for (const [i, stage] of stages.entries()) {
    const x = PAD + i * (sw + sgap);
    const type = TYPE[stage.damageType];
    const pic = await image(stage.icon);
    const tint = tintOf(stage.icon, pic); // the tile's outline and the light behind the picture take the picture's own colour
    panel(g, x, top, sw, sh, { stroke: `rgba(${tint},${open ? 0.55 : 0.25})` });
    if (i > 0) { // the arrow between two stages
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const ax = x - sgap / 2;
      const ay = top + 72;
      g.beginPath();
      g.moveTo(ax - 4, ay - 8);
      g.lineTo(ax + 4, ay);
      g.lineTo(ax - 4, ay + 8);
      g.stroke();
    }
    // the picture (his renders, their background cut off), on a light of its own colour
    const art = { x: x + 10, y: top + 10, w: sw - 20, h: 124 };
    g.save(); // an oval light that dies out inside the picture's window (no box edge showing)
    g.translate(x + sw / 2, art.y + art.h / 2);
    g.scale(art.w / art.h, 1);
    const glow = g.createRadialGradient(0, 0, 4, 0, 0, art.h / 2);
    glow.addColorStop(0, `rgba(${tint},${open ? 0.45 : 0.2})`);
    glow.addColorStop(1, `rgba(${tint},0)`);
    g.fillStyle = glow;
    g.fillRect(-art.h / 2, -art.h / 2, art.h, art.h);
    g.restore();
    g.save();
    g.globalAlpha = open ? 1 : 0.6;
    // one picture per enemy of the stage (the two Base Guardians stand side by side)
    for (let n = 0; n < stage.count; n++) contain(g, pic, art.x + (n * art.w) / stage.count, art.y + 4, art.w / stage.count, art.h - 6);
    g.restore();
    // its place in the order, on a small disc
    g.beginPath();
    g.arc(x + 24, top + 24, 12, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = FONT(15);
    g.fillText(`${i + 1}`, x + 24, top + 29);
    // name (one or two lines), health, and the damage it deals in a pill
    const mid = x + sw / 2;
    const tw = sw - 16;
    g.fillStyle = open ? '#fff' : 'rgba(255,255,255,0.8)';
    const words = stage.name.split(' ');
    const lines = words.length > 1 ? [words.slice(0, -1).join(' '), words.at(-1)] : [stage.name];
    lines.forEach((line, n) => fit(g, line, mid, top + 162 + n * 21 + (lines.length === 1 ? 10 : 0), tw, 18));
    g.fillStyle = 'rgba(255,255,255,0.85)';
    fit(g, `${stage.count > 1 ? `${stage.count} x ` : ''}${fmt(Math.round(stage.health))}`, mid, top + 218, tw, 19);
    g.fillStyle = DIM;
    fit(g, 'Health', mid, top + 235, tw, 12);
    for (const [n, kind] of [type, ...(stage.curses ? [TYPE.true] : [])].entries()) { // the damage it deals, and the curse blast under it
      g.font = FONT(12);
      const pw = Math.min(tw, g.measureText(kind.text).width + 20);
      g.beginPath();
      g.roundRect(mid - pw / 2, top + 248 + n * 30, pw, 24, 12);
      g.fillStyle = `rgba(${kind.rgb},0.16)`;
      g.fill();
      g.fillStyle = kind.color;
      fit(g, kind.text, mid, top + 264 + n * 30, pw - 12, 12);
    }
    g.textAlign = 'left';
  }

  texture ??= grain(W, H, 91, 90);
  grainAndVignette(g, W, H, texture, { grainAlpha: 0.35, inner: 280, outer: 600, dark: 0.5 });
  return c.toBuffer('image/png');
}

module.exports = { siegeCard };
