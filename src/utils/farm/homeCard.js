// The picture on the /base home screen: every target as a tile (picture, name, Ready or time left, payout), then this hour's bridge
// buff and the day's Golden Statue buffs along the bottom. Same look as the roam card (roamCard.js).
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { ASSETS, loadSouls, drawSouls, halftone, grain, grainAndVignette } = require('../art');
const { BRIDGE, dailyBuffs, bridgeNow } = require('./buffs');
const { BRIDGE_COLOR, SOULS, FONT, image, panel, contain, label, FARM } = require('./roamCard');
const { fmt } = require('../format');

const W = 800;
const H = 570;
const PAD = 32;
const READY = '#7dffb3';
const LANE_COLOR = { york: '#f5c84c', broadway: '#5b9bff', park: '#5fe08a' }; // Yellow, Blue, Green
// picture of each tile; `scene` pictures have their own background, so they fill a rounded window instead of floating on the tile
const ART = {
  'small-camp': 'haunts/crabbage_pot_small', 'medium-camp': 'haunts/gutter_ghoul_medium', 'large-camp': 'haunts/crabbage_pot_large',
  guardian: 'icons/guardian', walker: 'icons/walker', 'mid-boss': 'icons/mid-boss', roam: 'icons/golden-statue', siege: '../patrons/archmother', // the Patron's face, the picture from the #roles menu
};
const SCENE = new Set(['guardian', 'walker']);
const ORDER = ['small-camp', 'medium-camp', 'large-camp', 'guardian', 'walker', 'mid-boss', 'roam', 'siege'];
const NAME = {
  'small-camp': 'Tier 1 Camp', 'medium-camp': 'Tier 2 Camp', 'large-camp': 'Tier 3 Camp', guardian: 'Guardian', walker: 'Walker',
  'mid-boss': 'Mid-Boss', roam: 'Roam', siege: 'Base Siege',
};

let texture;

// tiles: [{ key, left: ms of cooldown left, timeLeft, pay: souls | null, rejuv: true when it also drops a Rejuv, extra: text instead of pay,
//   ready / text: (optional) override "is it lit" and the bottom-left words, pips: [{ lane, on }] one dot per lane (Guardian, Walker) }]; heldBridge: the hero's held bridge buff keys;
// now: ms. Returns a PNG.
async function homeCard({ tiles, heldBridge = [], now = Date.now(), day }) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#10181b');
  bg.addColorStop(1, '#0a0c10');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  halftone(g, 0, 0, W, H, 14, (u, v) => Math.max(0, u * 0.9 + (1 - v) * 0.5 - 0.75) * 0.9, 'rgba(171,255,227,0.10)');
  const souls = await loadSouls();

  const tileW = 172, gap = 16, tileH = 176, rowGap = 14, top = 40;
  label(g, 'Where to send your hero', PAD, 28);
  for (const [i, key] of ORDER.entries()) {
    const t = tiles.find((x) => x.key === key);
    const x = PAD + (i % 4) * (tileW + gap);
    const y = top + Math.floor(i / 4) * (tileH + rowGap);
    const ready = t.ready ?? t.left <= 0;
    panel(g, x, y, tileW, tileH, ready ? { fill: 'rgba(125,255,179,0.06)', stroke: 'rgba(125,255,179,0.4)' } : {});
    const pic = await image(`${path.join(FARM, ART[key])}.png`);
    // a soft light behind the picture, so dark art (the Patron) doesn't vanish into the tile
    const glow = g.createRadialGradient(x + tileW / 2, y + 60, 4, x + tileW / 2, y + 60, 70);
    glow.addColorStop(0, ready ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(x + 4, y + 4, tileW - 8, 112);
    g.save();
    g.globalAlpha = ready ? 1 : 0.4;
    if (SCENE.has(key)) {
      g.beginPath();
      g.roundRect(x + 12, y + 12, tileW - 24, 92, 10);
      g.clip();
      const k = Math.max((tileW - 24) / pic.width, 92 / pic.height);
      g.drawImage(pic, x + 12 + (tileW - 24 - pic.width * k) / 2, y + 12 + (92 - pic.height * k) / 2, pic.width * k, pic.height * k);
    } else {
      contain(g, pic, x + 14, y + 10, tileW - 28, 96);
    }
    g.restore();
    g.textAlign = 'center';
    g.font = FONT(17);
    g.fillStyle = ready ? '#fff' : 'rgba(255,255,255,0.55)';
    g.fillText(NAME[key], x + tileW / 2, y + 128);
    g.textAlign = 'left';
    // bottom line: Ready / time left on the left, the payout on the right
    g.font = FONT(15);
    g.fillStyle = ready ? READY : 'rgba(255,255,255,0.45)';
    g.fillText(t.text ?? (ready ? 'Ready' : t.timeLeft), x + 14, y + 156);
    for (const [n, pip] of (t.pips ?? []).entries()) { // a dot per lane in its colour: filled = can be fought now, a ring = down or locked
      const [px, py] = [x + 22 + n * 18, y + 22];
      g.beginPath();
      g.arc(px, py, 6, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fill();
      g.beginPath();
      g.arc(px, py, pip.on ? 5 : 4, 0, Math.PI * 2);
      if (pip.on) { g.fillStyle = LANE_COLOR[pip.lane]; g.fill(); } else { g.strokeStyle = LANE_COLOR[pip.lane]; g.globalAlpha = 0.6; g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1; }
    }
    g.font = FONT(15);
    g.textAlign = 'right';
    if (t.pay != null) {
      const text = fmt(t.pay);
      let right = x + tileW - 14;
      if (t.rejuv) { // a Rejuv drop (the Mid-Boss) goes at the far right, the souls just left of it
        g.drawImage(await image(path.join(ASSETS, 'shop', 'art', 'rejuv.png')), right - 22, y + 140, 22, 22);
        right -= 28;
      }
      g.font = FONT(16);
      g.fillStyle = SOULS;
      g.fillText(text, right, y + 156);
      drawSouls(g, souls, right - g.measureText(text).width - 16, y + 142, 18);
    } else {
      g.font = FONT(11);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillText(t.extra, x + tileW - 14, y + 156);
    }
    g.textAlign = 'left';
  }

  // ---- bottom band: this hour's bridge buff, and the Golden Statue buffs today ----
  const by = top + 2 * tileH + rowGap + 34;
  const bh = 88;
  const key = bridgeNow(now);
  const color = BRIDGE_COLOR[key];
  const lw = 372;
  panel(g, PAD, by, lw, bh);
  label(g, 'Bridge Buff This Hour', PAD, by - 8);
  contain(g, await image(path.join(FARM, 'bridge', `${key}.png`)), PAD + 12, by + 10, 68, 68);
  g.font = FONT(22);
  g.fillStyle = color;
  g.fillText(BRIDGE[key].name, PAD + 92, by + 36);
  g.font = FONT(14);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  const mins = 60 - new Date(now).getUTCMinutes();
  g.fillText(`Changes in ${mins}m`, PAD + 92, by + 58);
  if (heldBridge.length) {
    g.fillStyle = READY;
    g.fillText(`You hold: ${heldBridge.map((k) => BRIDGE[k].name).join(', ')}`, PAD + 92, by + 77);
  }

  const rx = PAD + lw + 16;
  const rw = W - PAD - rx;
  panel(g, rx, by, rw, bh);
  label(g, 'Statue Buffs Today', rx, by - 8);
  const buffs = dailyBuffs(day);
  const size = 64;
  const startX = rx + (rw - (buffs.length * size + (buffs.length - 1) * 10)) / 2;
  for (const [i, k] of buffs.entries()) contain(g, await image(path.join(FARM, 'buffs', `${k}.png`)), startX + i * (size + 10), by + 12, size, size);

  texture ??= grain(W, H, 91, 90);
  grainAndVignette(g, W, H, texture, { grainAlpha: 0.35, inner: 260, outer: 560, dark: 0.55 });
  return c.toBuffer('image/png');
}

module.exports = { homeCard };
