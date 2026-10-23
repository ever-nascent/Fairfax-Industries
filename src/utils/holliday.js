// Holliday's Powder Keg, Holliday's game (casino Crash): the fuse burns, the multiplier climbs, Cash Out before the
// keg blows. The start message is a GIF of the fuse burning at a steady pace while the multiplier and the souls a
// Cash Out would pay count up; the bot's own clock decides the payout and when the keg blows.
// Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { encodeGif } = require('./gif');
const { getStore } = require('../storage');
const { fmt } = require('./format');
const { pickRandom } = require('./random');
const { ASSETS, seeded, halftone, grain, grainAndVignette, loadSouls, drawSouls } = require('./art');
const { GREEN: WIN_COLOR, RED: LOSE_COLOR, staked, plainTimeout, resultFields, playAgainButton, gameMessage, forGame } = require('./casino');

const ART = path.join(ASSETS, 'holliday'); // deadlock-api.com + deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0xd9782d, name: "Holliday's Powder Keg", icon: path.join(ART, 'powder_keg.png'), art: ART, prefix: 'holliday' }; // orange; Powder Keg

const FUSE_MS = 20_000; // the fuse burns down in 20 s; the multiplier reaches the cap as it hits the keg
const CAP = 10;
const RTP = 0.95; // cashing out at any multiplier returns 95% on average: the house's small cut
const FRAME_MS = 125; // GIF frame length (8 a second: the flame still moves smoothly, the file stays smaller)
// The GIF shows up on players' screens about this long after the message is posted (it has to download first),
// so the bot's clock starts then; otherwise the keg blows at a number the GIF hasn't reached yet.
// ponytail: a fixed guess, measure it if the keg still seems to blow early
const GIF_DELAY_MS = 1000;
const BUTTON_ID = 'keg'; // custom id: keg:<game id>:cash
const { pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger
const AGAIN_ID = 'keg_again'; // custom id: keg_again:<bet>:<player id>

// Holliday: a blunt Midwestern sheriff from Macomb, in New York hunting a killer, hates the city, dry and short
// with people (deadlock.wiki "Holliday/Quotes"). Original lines in her voice; one goes in the footer.
const START_LINES = [
  "Fuse is lit. I don't have all day, and neither does that keg.",
  "Walk away whenever you like. Nobody in this city ever does.",
  "Tick, tick. That's your luck burning down.",
  "I've seen tougher folks than you lose their nerve over less.",
];
const WIN_LINES = [
  'Fine. Take it and get out of my sight.',
  "Smart. Didn't figure anyone in New York knew when to quit.",
  "Huh. You've got better sense than most folks I lock up.",
  "Don't get comfortable. Luck burns out, same as fuses.",
];
const LOSE_LINES = [
  "Should've walked away. Nobody in this city ever does.",
  "Boom. Told you it wasn't gonna wait.",
  "That's the thing about powder. It doesn't care how brave you are.",
  "Back in Macomb we'd call that a lesson. Here I guess it's a Tuesday.",
];
// When a game is called off (the fuse went out, or the bot restarted mid-game): she gloats, the bet comes back.
const TIMEOUT_LINES = [
  'Fuse fizzled out. Take your Souls and go.',
  'Damp powder. Happens. Your Souls are back.',
  'Nothing blew, nothing won. Get out of here.',
  "Keg's a dud today. Count yourself lucky.",
];

// Games in progress. key: game id
const games = () => getStore('kegGames');

// ---- rules -------------------------------------------------------------------------------------

// The multiplier after `ms` of burning: 1x at the start, 10x when the fuse hits the keg, growing the same
// share every second (x2 at 6 s, x3 at 9.5 s, x5 at 14 s), rounded down to 2 decimals.
const multiplierAt = (ms) => Math.min(CAP, Math.floor(100 * CAP ** (Math.max(0, ms) / FUSE_MS) + 1e-6) / 100);
// How long the fuse burns before the multiplier reaches m.
const msUntil = (m) => (FUSE_MS * Math.log(m)) / Math.log(CAP);

// Where the keg blows. The chance it lasts past m is 95% / m, so cashing out at any m returns 95% on average;
// 5% of kegs blow at 1.00x, and every keg blows at the 10x cap. u: a random number 0 <= u < 1.
function crashPoint(u = crypto.randomInt(2 ** 47) / 2 ** 47) {
  return Math.min(CAP, Math.max(1, RTP / (1 - u)));
}
const prize = (game) => Math.floor(game.bet * game.cashedAt);
// Rounded down, like the multiplier on the fuse GIF.
const times = (m) => `${(Math.floor(m * 100 + 1e-6) / 100).toFixed(2)}×`;

// ---- pictures ----------------------------------------------------------------------------------
// Drawn in 800 x 300 units (the mockups), output at 640 x 240. Look: Holliday's select background (teal, the
// orange sheriff star, halftone, grain), her white Powder Keg icon with a twisted cream cotton fuse thrown in one
// big lasso loop, a candle flame at the burning end, the multiplier on a cream-edged plate.

const W = 640, H = 240, S = W / 800;
const TEAL = '#1d2927', ORANGE = '#d9782d', AMBER = '#f0a442', CREAM = '#efe3c8', WHITE = '#f6f2ea';
const SMOKE = '#435e5a', SMOKE_HI = '#6f8e88';
const KX = 50, KY = 80, KS = 190 / 137; // where the keg icon (137 px) sits, and its scale
const TIP = { x: KX + 123 * KS, y: KY + 29 * KS }; // top of the icon's own fuse stub
const KW = 137 * KS; // the keg icon's drawn size
const FW = 6 * KS; // the icon's fuse thickness
const KEG_TINT = '#f2d2b0'; // the barrel's tint (pale sheriff orange)
// The icon's own fuse stub (icon pixels): taken off for the rope, which is drawn from the lid along the stub's own
// wiggle (STUB_PATH) and on into the lasso.
const STUB = { x: 97, y: 46 };
const STUB_PATH = [[90, 43], [96, 39], [101, 37], [106, 38], [111, 40], [116, 40], [120, 37], [122, 33], [123, 29]];

let art;
async function loadArt() {
  if (art) return art;
  const [bg, icon] = await Promise.all([loadImage(path.join(ART, 'background.png')), loadImage(HOST.icon)]);
  // the icon without the spark drawn on it, so our fuse carries on from its fuse stub
  const keg = createCanvas(137, 137);
  const k = keg.getContext('2d');
  k.drawImage(icon, 0, 0);
  k.clearRect(0, 0, 137, 29);
  k.clearRect(100, 29, 19, 3);
  // tinted (shading kept)
  k.globalCompositeOperation = 'multiply';
  k.fillStyle = KEG_TINT;
  k.fillRect(0, 0, 137, 137);
  k.globalCompositeOperation = 'destination-in';
  k.drawImage(icon, 0, 0);
  k.globalCompositeOperation = 'destination-out'; // the spark again (destination-in brought it back)
  k.fillRect(0, 0, 137, 29);
  k.fillRect(100, 29, 19, 3);
  k.fillRect(STUB.x, 0, 137 - STUB.x, STUB.y); // the stub goes: the rope is drawn from the lid instead
  k.fillRect(92, 30, 6, 10);
  k.globalCompositeOperation = 'source-over';
  // the fuse: up out of the stub, one big loop (a prolate trochoid, like a thrown lasso), then a wave to its
  // end above the plate; points spaced evenly along it, so it burns at a steady pace
  const bez = (a, b, c, d) => Array.from({ length: 121 }, (_, i) => {
    const t = i / 120, u = 1 - t;
    return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y };
  });
  const loop = (from, to, r) => Array.from({ length: 201 }, (_, i) => {
    const t = Math.PI + (2 * Math.PI * i) / 200;
    return { x: from.x + ((to.x - from.x) / (2 * Math.PI)) * (t - Math.PI) - r * Math.sin(t), y: from.y - r * (1 + Math.cos(t)) };
  });
  // the stub's wiggle, from the lid to the stub's top (a smooth curve through STUB_PATH)
  const stub = [], P = STUB_PATH.map(([x, y]) => ({ x: KX + x * KS, y: KY + y * KS }));
  for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < 20; k++) {
    const t = k / 20, [a, b, c, d] = [P[Math.max(0, i - 1)], P[i], P[i + 1], P[Math.min(P.length - 1, i + 2)]];
    const cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    stub.push({ x: cr(a.x, b.x, c.x, d.x), y: cr(a.y, b.y, c.y, d.y) });
  }
  const L0 = { x: 262, y: 140 }, L1 = { x: 452, y: 140 }, M = { x: 560, y: 100 }, END = { x: 690, y: 112 };
  const dense = [
    ...stub,
    ...bez(TIP, { x: TIP.x, y: TIP.y - 45 }, { x: L0.x - 45, y: L0.y }, L0),
    ...loop(L0, L1, 58),
    ...bez(L1, { x: L1.x + 40, y: L1.y }, { x: M.x - 40, y: M.y }, M),
    ...bez(M, { x: M.x + 40, y: M.y }, { x: END.x - 40, y: END.y + 20 }, END),
  ];
  const along = [0];
  for (let i = 1; i < dense.length; i++) along.push(along[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  const fuse = [];
  for (let i = 0, j = 0; i <= 400; i++) {
    const want = (along.at(-1) * i) / 400;
    while (along[j + 1] < want) j++;
    fuse.push(dense[j]);
  }
  // the parts that never move: background, star, halftone
  const base = createCanvas(W, H);
  const g = base.getContext('2d');
  g.scale(S, S);
  g.fillStyle = TEAL;
  g.fillRect(0, 0, 800, 300);
  g.globalAlpha = 0.9;
  g.drawImage(bg, 0, 0, 1298, 733, 250, -10, 620, 350);
  g.globalAlpha = 1;
  halftone(g, 0, 0, 800, 300, 10, (u, v) => Math.max(0, 0.55 - Math.hypot(u - 0.15, v - 0.6) * 1.1), '#2f4441');
  art = { bg, keg, fuse, geo: geometry(fuse), base, souls: await loadSouls(), grain: grain(W, H, 11, 70) };
  return art;
}

// ---- the fuse: a twisted cotton cord shaded like rope, scorched just ahead of the flame, passing over itself in
// the loop and blending into the keg's own white stub ----

const LIGHT = { x: -0.45, y: -0.89 }; // light from the upper left
const line = (g, pts, from, to) => {
  g.beginPath();
  g.moveTo(pts[from].x, pts[from].y);
  for (let i = from + 1; i <= to; i++) g.lineTo(pts[i].x, pts[i].y);
};
const stroke = (g, style, width, pts, from, to) => {
  g.strokeStyle = style;
  g.lineWidth = width;
  line(g, pts, from, to);
  g.stroke();
};

// Normals, the shading lines (shifted toward the light), the twist grooves and where the loop crosses itself,
// worked out once (loadArt).
function geometry(f) {
  const n = f.map((p, i) => {
    const a = f[Math.max(0, i - 1)], b = f[Math.min(f.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { tx: (b.x - a.x) / l, ty: (b.y - a.y) / l, nx: -(b.y - a.y) / l, ny: (b.x - a.x) / l };
  });
  const shift = (k) => f.map((p, i) => { const d = n[i], dot = d.nx * LIGHT.x + d.ny * LIGHT.y; return { x: p.x + d.nx * dot * k, y: p.y + d.ny * dot * k }; });
  const step = Math.hypot(f[1].x - f[0].x, f[1].y - f[0].y), pitch = Math.max(1, Math.round(4.6 / step));
  const twists = [];
  for (let i = 1; i < f.length; i += pitch) { // a groove slanting across the cord, a ridge of light beside it
    const p = f[i], d = n[i], h = FW / 2 - 0.8, s = 2.1;
    twists.push({ i, a: { x: p.x + d.nx * h - d.tx * s, y: p.y + d.ny * h - d.ty * s }, b: { x: p.x - d.nx * h + d.tx * s, y: p.y - d.ny * h + d.ty * s }, tx: d.tx, ty: d.ty });
  }
  let cross = { d: Infinity }; // the loop's crossing: the closest two points at least 40 apart along the fuse
  for (let i = 0; i < f.length; i++) for (let j = i + 40; j < f.length; j++) {
    const d = Math.hypot(f[i].x - f[j].x, f[i].y - f[j].y);
    if (d < cross.d) cross = { d, under: i, over: j };
  }
  const split = Math.round((cross.under + cross.over) / 2); // the cord is drawn in two pieces from the loop's top
  return { step, twists, cross, split, lo: shift(-FW * 0.2), hi: shift(FW * 0.2), spec: shift(FW * 0.3) };
}

// One piece of the cord from..to: edge, body, shaded and lit sides, the twist, the sheen.
function piece(g, f, from, to) {
  const { lo, hi, spec, twists } = art.geo;
  stroke(g, '#5a4433', FW + 1.8, f, from, to); // the edge
  stroke(g, KEG_TINT, FW, f, from, to); // the body, the barrel's colour
  stroke(g, '#d3ae8a', FW * 0.42, lo, from, to); // the side away from the light
  stroke(g, '#fae4ca', FW * 0.42, hi, from, to); // the lit side
  const cap = g.lineCap;
  g.lineCap = 'butt';
  for (const [dx, style, width] of [[0, 'rgba(110,74,46,.55)', 1], [1.2, 'rgba(255,244,230,.45)', 0.8]]) { // groove, then ridge
    g.beginPath();
    for (const t of twists) if (t.i >= from && t.i < to) { g.moveTo(t.a.x + t.tx * dx, t.a.y + t.ty * dx); g.lineTo(t.b.x + t.tx * dx, t.b.y + t.ty * dx); }
    g.strokeStyle = style;
    g.lineWidth = width;
    g.stroke();
  }
  g.lineCap = cap;
  stroke(g, 'rgba(255,248,238,.8)', 1.1, spec, from, to); // the sheen
}

// The cord by the burning point: scorched brown going black, then the glowing ember band (dull red once snuffed).
function ember(g, f, end, heat) {
  const p = f[end], { step } = art.geo;
  const around = (n, stops, width) => { // a colour falling off from the burning point along the last n points of cord
    const a = Math.max(0, end - n);
    if (end - a < 1) return;
    const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, n * step);
    stops.forEach(([at, c]) => gr.addColorStop(at, c));
    g.save();
    g.lineCap = 'butt';
    stroke(g, gr, width, f, a, end);
    g.restore();
  };
  around(16, [[0, 'rgba(38,22,15,.95)'], [0.3, 'rgba(78,44,24,.85)'], [0.65, 'rgba(130,88,48,.35)'], [1, 'rgba(150,110,60,0)']], FW);
  if (heat) around(4, [[0, 'rgb(255,214,140)'], [0.45, 'rgb(245,120,40)'], [1, 'rgba(200,60,25,0)']], FW * 0.9);
  else around(5, [[0, 'rgba(120,34,20,.95)'], [0.6, 'rgba(70,28,18,.8)'], [1, 'rgba(50,25,15,0)']], FW * 0.9);
}

// Warm light from the flame (for 'multiply': white turns warm, dark stays dark), strength b.
function warmth(g, c, r, b) {
  const m = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r), k = (v) => Math.round(255 - (255 - v) * b);
  m.addColorStop(0, `rgb(255,${k(165)},${k(90)})`);
  m.addColorStop(0.45, `rgb(255,${k(215)},${k(165)})`);
  m.addColorStop(1, '#fff');
  return m;
}

// The unburnt cord, fuse[0..end]. state: 'lit' or 'cash'.
function cord(g, f, end, state) {
  const { cross, split } = art.geo;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.save();
  g.translate(2.5, 3.5);
  stroke(g, 'rgba(0,0,0,.3)', FW, f, 0, end); // its shadow on the wall
  g.restore();
  // two pieces, so the later strand passes over the earlier one where the loop crosses, its shadow falling on it
  piece(g, f, 0, Math.min(end, split));
  if (end > split) {
    if (end > cross.over - 8) {
      const to = Math.min(end, cross.over + 8), a = f[cross.over - 8], b = f[to], gr = g.createLinearGradient(a.x, a.y, b.x, b.y);
      gr.addColorStop(0, 'rgba(40,30,20,0)');
      gr.addColorStop(0.5, 'rgba(40,30,20,.6)');
      gr.addColorStop(1, 'rgba(40,30,20,0)');
      g.save();
      g.translate(1.6, 2.6);
      stroke(g, gr, FW + 1, f, cross.over - 8, to);
      g.restore();
    }
    g.lineCap = 'butt';
    piece(g, f, split, end);
    g.lineCap = 'round';
  }
  ember(g, f, end, state === 'lit');
  if (state === 'lit') { // the flame's warm light on the cord near it
    g.save();
    g.globalCompositeOperation = 'multiply';
    stroke(g, warmth(g, { x: f[end].x, y: f[end].y - FH * 0.35 }, 115, 0.9), FW + 2, f, 0, end);
    g.restore();
  }
}

// ---- the flame: a candle flame of flat nested layers like the explosion's fireball (red rim, orange, amber, pale
// yellow, white core) that bends with layered noise and now and then throws off a lick; a glowing
// bead where it burns, a steady warm haze that warms the cord and the keg's near side ----

const FH = 82, FR = 16.5; // the flame's height and half width
const FLAME_BASE = -5; // how far above the burning point the flame starts: below it, so its round base wraps the rope's end
const GLOW = 125; // the warm haze's reach
const RIM = '#c2461d';
// [half width, height, lift, colour]
const LAYERS = [[1, 1, 0, RIM], [0.87, 0.92, 1.4, '#e8762a'], [0.66, 0.74, 4.5, '#f6a63e'], [0.46, 0.53, 6, '#ffd877'], [0.25, 0.28, 7.5, '#fff7e2']];

// Smooth noise, the same for the same input (no Math.random: the same bet draws the same GIF).
const hash = (n) => { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x); };
const noise = (x) => { const i = Math.floor(x), u = x - i, s = u * u * (3 - 2 * u); return (hash(i) * (1 - s) + hash(i + 1) * s) * 2 - 1; };
const fbm = (x) => noise(x) * 0.6 + noise(x * 2.3 + 17) * 0.3 + noise(x * 5.1 + 31) * 0.1;

// How far the flame's centre line leans at height S (0 base .. 1 tip) on frame T: a slow lean plus waves rising up it.
const bend = (S, T) => FH * (0.13 * fbm(T * 0.23 + 9) * S ** 1.5 + 0.12 * S ** 1.2 * fbm(S * 2.4 - T * 0.9 + 3));
// One layer's outline: a teardrop round at the bottom, pointed at the tip, its edges rippling.
// H: the whole flame's height (the layers share its bend); h / r / lift: this layer's height, half width, lift.
function tongue(g, x, y, H, h, r, lift, T) {
  const N = 26, L = [], R = [];
  for (let k = 0; k <= N; k++) {
    const s = k / N, hy = lift + s * h, S = Math.min(1, hy / H), w = r * Math.sin(Math.PI * s ** 0.4) ** 0.7;
    const cx = x + bend(S, T), cy = y - hy;
    L.push([cx - w * (1 + 0.2 * S * noise(S * 4 - T * 1.1 + 100)), cy]);
    R.push([cx + w * (1 + 0.2 * S * noise(S * 4 - T * 1.1 + 200)), cy]);
  }
  g.beginPath();
  g.moveTo(...R[0]);
  for (let k = 1; k <= N; k++) g.lineTo(...R[k]);
  for (let k = N; k >= 0; k--) g.lineTo(...L[k]);
  g.closePath();
}
// A lick: in some 1 s windows the tip stretches (phase 0), a piece tears off (1) and rises away (2); -1: none.
function lickPhase(T) {
  const m = Math.floor(T / 8), start = m * 8 + Math.floor(hash(m * 1.7 + 0.3) * 5);
  return hash(m * 2.9 + 11) < 0.65 && T >= start && T <= start + 2 ? T - start : -1;
}
// The flame's height this frame (it stretches before a lick tears off, drops back after).
function heightAt(T) {
  const ph = lickPhase(T), H = FH * (1 + 0.15 * fbm(T * 0.5) + 0.05 * noise(T * 1.7 + 50));
  return { ph, H: H * (ph === 0 ? 1.18 : ph >= 1 ? 0.88 : 1) };
}
// The layers, outside in.
function flameAt(g, x, y, T, H, r, layers = LAYERS) {
  layers.forEach(([wk, hk, lift, c]) => {
    tongue(g, x, y, H, H * hk, r * wk, lift, T);
    g.fillStyle = c;
    g.fill();
  });
}
// Light falling off round p over radius r (stops: [[at, colour]]), screened on.
function light(g, p, r, stops) {
  const s = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  stops.forEach(([at, c]) => s.addColorStop(at, c));
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = s;
  g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  g.restore();
}
// The haze and the light on the keg move only every 2nd frame (8 fps -> 4): light that moves changes every pixel
// under it, which bloats the GIF. On odd frames: where the burning point was a frame earlier.
const held = (f, end, frame) => (frame % 2 ? Math.round((1 - Math.min(1, ((frame - 1) * FRAME_MS) / FUSE_MS)) * (f.length - 1)) : end);
// The same light on the keg once the flame is near it: only the icon's own pixels, only its near top corner.
let lit;
function kegLight(g, c) {
  const near = 1 - Math.hypot(c.x - 220, c.y - 120) / 150; // 0 far .. 1 on the stub
  if (near <= 0) return;
  lit ??= createCanvas(KW, KW);
  const k = lit.getContext('2d');
  k.globalCompositeOperation = 'copy';
  k.drawImage(art.keg, 0, 0, KW, KW);
  k.globalCompositeOperation = 'source-in';
  k.fillStyle = warmth(k, { x: c.x - KX, y: c.y - KY }, 90, 0.7 * near);
  k.fillRect(0, 0, KW, KW);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.drawImage(lit, KX, KY, KW, KW);
  g.restore();
}
// The bead where the fuse burns: a glowing orange-red drop (a dull red ember once snuffed), a little light round it.
function bead(g, p, r, inner, outer, glow) {
  light(g, p, r * 2.6, [[0, glow], [1, 'rgba(255,110,40,0)']]);
  const b = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 0, p.x, p.y, r);
  b.addColorStop(0, inner);
  b.addColorStop(0.55, outer);
  b.addColorStop(1, RIM);
  g.fillStyle = b;
  g.beginPath();
  g.arc(p.x, p.y, r, 0, 7);
  g.fill();
}
function flame(g, f, end, frame) {
  const p = f[end], T = frame, { ph, H } = heightAt(T), q = f[held(f, end, frame)];
  light(g, { x: q.x, y: q.y - FH * 0.35 }, GLOW, [[0, 1], [0.25, 0.64], [0.5, 0.32], [0.75, 0.11], [1, 0]].map(([at, k]) => [at, `rgba(240,146,56,${0.5 * k})`])); // the steady haze
  kegLight(g, { x: q.x, y: q.y - FH * 0.35 });
  flameAt(g, p.x, p.y - FLAME_BASE, T, H, FR * (ph === 0 ? 0.92 : 1));
  bead(g, p, 3.4, '#fff1c4', '#ff9a3a', 'rgba(255,170,80,.7)');
  if (ph >= 1) { // the torn-off piece, rising and shrinking
    const up = ph === 1 ? 7 : 22, k = ph === 1 ? 0.3 : 0.17, x = p.x + bend(1, T) * 1.1, y = p.y - FLAME_BASE - H - up + H * k;
    g.save();
    g.globalAlpha = ph === 1 ? 1 : 0.75;
    flameAt(g, x, y, T + 3, H * k, FR * (ph === 1 ? 0.36 : 0.24), LAYERS.slice(0, 3).map(([w, h, , c], i) => [w, h, i * 1.5, c]));
    g.restore();
  }
}

// Cashed out: no flame, the charred end with a dying red ember and a curl of the explosion's teal smoke
// (SMOKE_HI) spreading as it rises.
const CURL = [[0, -4], [-24, -32], [28, -64], [-6, -118]]; // the smoke's path up from the ember (a bezier)
function snuff(g, f, end) {
  const p = f[end], at = (t) => { // a point on the curl, t 0..1
    const u = 1 - t, k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: p.x + k.reduce((s, w, i) => s + w * CURL[i][0], 0), y: p.y + k.reduce((s, w, i) => s + w * CURL[i][1], 0) };
  };
  const top = p.y + CURL[3][1] - 18, gr = g.createLinearGradient(0, p.y, 0, top);
  gr.addColorStop(0, 'rgba(111,142,136,.95)');
  gr.addColorStop(0.55, 'rgba(111,142,136,.8)');
  gr.addColorStop(1, 'rgba(111,142,136,0)');
  g.save();
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, q = at(t), r = 3.2 + 15 * t ** 1.5;
    g.moveTo(q.x + r, q.y);
    g.arc(q.x, q.y, r, 0, 7);
  }
  g.fillStyle = gr;
  g.fill();
  g.clip();
  halftone(g, p.x - 45, top, 90, p.y - top, 7, (u, v) => 0.5 * Math.max(0, 1 - Math.abs(v - 0.42) * 3.2), '#a5bbb5'); // a few paler dots where it spreads
  g.restore();
  bead(g, p, 4.4, '#ffb070', '#d8441c', 'rgba(255,90,30,.5)');
}

// ---- the explosion ("Shatter"): the keg icon cut into wedges flying apart over a layered fireball ----

function burstPath(g, cx, cy, R, n, rnd) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = ((i + rnd() * 0.5) / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? R * (0.52 + rnd() * 0.12) : R * (0.8 + rnd() * 0.4);
    g.lineTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r);
  }
  g.closePath();
}
// One fireball layer: flat fill, then dots of the next colour growing toward the centre (the comic gradient).
function layer(g, cx, cy, R, n, seed, fill, dots) {
  burstPath(g, cx, cy, R, n, seeded(seed));
  g.fillStyle = fill;
  g.fill();
  if (!dots) return;
  g.save();
  burstPath(g, cx, cy, R, n, seeded(seed));
  g.clip();
  halftone(g, cx - R * 1.6, cy - R * 1.2, R * 3.2, R * 2.4, 9, (u, v) => Math.max(0, 1.05 - Math.hypot((u - 0.5) * 1.2, v - 0.5) * 2.4), dots);
  g.restore();
}
// Grunge: her background art multiplied into the shape `clip` draws.
function grunge(g, clip, alpha) {
  g.save();
  clip();
  g.clip();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = alpha;
  g.drawImage(art.bg, 400, 650, 850, 500, 0, 0, 800, 300);
  g.restore();
}
function fireball(g, cx, cy, R, seed) {
  layer(g, cx, cy, R, 13, seed, ORANGE, AMBER);
  grunge(g, () => burstPath(g, cx, cy, R, 13, seeded(seed)), 0.3);
  layer(g, cx, cy, R * 0.72, 11, seed + 1, AMBER, CREAM);
  layer(g, cx, cy, R * 0.45, 9, seed + 2, CREAM, WHITE);
  layer(g, cx, cy, R * 0.22, 7, seed + 3, '#fffdf6');
}
// Long angular light shards, like the jagged cut-outs in her background.
function shards(g, cx, cy, n, len, seed, alpha = 0.25, sx = 1.2) {
  const rnd = seeded(seed);
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = CREAM;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, w = 0.04 + rnd() * 0.05, l = len * (0.6 + rnd() * 0.5);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a - w) * l * sx, cy + Math.sin(a - w) * l);
    g.lineTo(cx + Math.cos(a + w) * l * 0.9 * sx, cy + Math.sin(a + w) * l * 0.9);
    g.fill();
  }
  g.restore();
}
// Teal smoke blobs, lighter dots on top.
function cloud(g, blobs) {
  const shape = () => {
    g.beginPath();
    for (const [x, y, r] of blobs) {
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, 7);
    }
  };
  shape();
  g.fillStyle = SMOKE;
  g.fill();
  g.save();
  shape();
  g.clip();
  const top = Math.min(...blobs.map(([, y, r]) => y - r)), bottom = Math.max(...blobs.map(([, y, r]) => y + r));
  halftone(g, 0, top, 800, bottom - top, 8, (u, v) => Math.max(0, 0.9 - v * 1.3), SMOKE_HI);
  g.restore();
  grunge(g, shape, 0.3);
}
function sparks(g, cx, cy, n, R, seed) {
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = R * (0.7 + rnd() * 0.8);
    g.fillStyle = rnd() > 0.5 ? WHITE : AMBER;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r, 1.5 + rnd() * 3, 0, 7);
    g.fill();
  }
}
function shatter(g, cx, cy, size, seed) {
  const rnd = seeded(seed), k = size / 137, ccx = 62, ccy = 84, N = 6; // cut around the keg's middle
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2 + 0.4, a1 = ((i + 1) / N) * Math.PI * 2 + 0.4, mid = (a0 + a1) / 2;
    const piece = createCanvas(137, 137);
    const p = piece.getContext('2d');
    p.beginPath();
    p.moveTo(ccx, ccy);
    for (const a of [a0, mid, a1]) p.lineTo(ccx + Math.cos(a) * 200, ccy + Math.sin(a) * 200);
    p.closePath();
    p.clip();
    p.drawImage(art.keg, 0, 0);
    const dist = 38 + rnd() * 30, spin = (rnd() - 0.5) * 1.2;
    const x = cx + Math.cos(mid) * dist * 1.3, y = cy + Math.sin(mid) * dist;
    g.save();
    g.globalAlpha = 0.4;
    g.strokeStyle = CREAM;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx + Math.cos(mid) * 20, cy + Math.sin(mid) * 20);
    g.lineTo(x - Math.cos(mid) * 14, y - Math.sin(mid) * 14);
    g.stroke();
    g.restore();
    g.save();
    g.translate(x, y);
    g.rotate(spin);
    g.drawImage(piece, -ccx * k, -ccy * k, 137 * k, 137 * k);
    g.restore();
  }
}
function explosion(g) {
  const flash = g.createRadialGradient(150, 190, 20, 150, 190, 380);
  flash.addColorStop(0, 'rgba(217,120,45,.4)');
  flash.addColorStop(1, 'rgba(217,120,45,0)');
  g.fillStyle = flash;
  g.fillRect(0, 0, 800, 300);
  const cx = 160, cy = 185;
  cloud(g, [[80, 110, 50], [240, 110, 55], [260, 230, 50], [60, 240, 48]]);
  shards(g, cx, cy, 20, 320, 8);
  fireball(g, cx, cy, 90, 41);
  shatter(g, cx, cy, 170, 13);
  sparks(g, cx, cy, 45, 140, 15);
}

// One picture. state: 'lit' (burning, `ms` in), 'cash' (snuffed at `ms`), 'boom'. mult: shown on the plate.
// While it burns the plate's top line is what a Cash Out pays now (bet x mult), with the souls icon.
function drawScene(state, ms, mult, frame = 0, bet = 0) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(art.base, 0, 0);
  // while burning, the grain goes under the fuse and flame: grain over a moving flame bloats the GIF
  if (state === 'lit') grainAndVignette(g, W, H, art.grain, { grainAlpha: 0.55, inner: 176, outer: 416, dark: 0 });
  g.scale(S, S);
  if (state === 'boom') explosion(g);
  else {
    const { fuse } = art;
    const end = Math.round((1 - Math.min(ms, FUSE_MS) / FUSE_MS) * (fuse.length - 1)); // steady burn
    cord(g, fuse, end, state);
    g.drawImage(art.keg, KX, KY, KW, KW);
    if (state === 'lit') flame(g, fuse, end, frame);
    else snuff(g, fuse, end);
  }
  // the plate, knocked crooked by a blast
  g.save();
  g.translate(635, 209);
  if (state === 'boom') g.rotate(-0.035);
  g.beginPath();
  g.roundRect(-135, -59, 270, 118, 10);
  g.fillStyle = 'rgba(20,28,27,.9)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = CREAM;
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = CREAM;
  g.font = '20px Radiance';
  if (state === 'lit') {
    g.font = '24px Radiance';
    const text = fmt(Math.floor(bet * mult)), w = g.measureText(text).width, iw = (26 * art.souls.width) / art.souls.height;
    const left = -(w + iw + 6) / 2;
    drawSouls(g, art.souls, left, -51, 26);
    g.textAlign = 'left';
    g.fillText(text, left + iw + 6, -29);
    g.textAlign = 'center';
  } else g.fillText(state === 'cash' ? 'CASHED OUT' : 'BOOM', 0, -29);
  g.font = '64px Radiance';
  g.fillStyle = { lit: '#f2c14e', cash: '#57f287', boom: '#ed4245' }[state];
  g.fillText(times(mult), 0, 39);
  g.restore();
  g.setTransform(1, 0, 0, 1, 0, 0);
  grainAndVignette(g, W, H, art.grain, { grainAlpha: state === 'lit' ? 0 : 0.55, inner: 176, outer: 416, dark: 0.55 });
  return c;
}

// The start picture: the whole fuse burning down at a steady pace with the multiplier and the souls a Cash Out
// would pay counting up, played once. Doesn't depend on where the keg blows (the bot's clock handles that), only
// on the bet, so the last few bets' GIFs are kept (Play Again reuses them).
const fuseGifs = new Map(); // bet -> GIF
async function renderFuse(bet) {
  if (fuseGifs.has(bet)) return fuseGifs.get(bet);
  await loadArt();
  const frames = [];
  for (let ms = 0, f = 0; ms <= FUSE_MS; ms += FRAME_MS, f++) {
    const [at, n] = [ms, f];
    frames.push({ rgba: () => drawScene('lit', at, multiplierAt(at), n, bet).getContext('2d').getImageData(0, 0, W, H).data, delay: FRAME_MS });
  }
  const gif = encodeGif(frames, W, H);
  if (fuseGifs.size >= 20) fuseGifs.delete(fuseGifs.keys().next().value); // oldest out
  fuseGifs.set(bet, gif);
  return gif;
}

// The end picture: cashed out (fuse snuffed where it was) or the keg blown.
async function renderEnd(game) {
  await loadArt();
  return drawScene(game.lost ? 'boom' : 'cash', game.ms, game.lost ? game.crash : game.cashedAt).toBuffer('image/png');
}

// ---- messages ----------------------------------------------------------------------------------

async function endView(id, game) {
  // The template every game follows (his pick Oct 22): one bold line, the money in fields, green / red.
  const lines = game.lost
    ? [`**BOOM! The keg blew at ${times(game.crash)}.**`]
    : [`**You cashed out at ${times(game.cashedAt)}. The keg would have blown at ${times(game.crash)}.**`];
  return gameMessage(HOST, {
    lines,
    image: { name: `keg_${id}.png`, data: await renderEnd(game) },
    fields: resultFields(game.bet, game.lost ? 0 : prize(game), game.balance),
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    footer: `"${pickRandom(game.lost ? LOSE_LINES : WIN_LINES)}"`,
    mood: game.lost ? 'gloat' : 'injured', // she gloats when you lose, she's hurt when you win
    color: game.lost ? LOSE_COLOR : WIN_COLOR,
  });
}

// Takes the bet and picks where the keg blows. Returns a message payload, or { error }.
// The fuse starts once the message is up (posted).
async function startGame(user, name, bet, crash = crashPoint()) {
  const { error, id } = await openGame(games(), user.id, bet, () => ({ userId: user.id, name, bet, crash, done: false }));
  if (error) return { error };
  return gameMessage(HOST, {
    lines: ['Cash out before it blows!'],
    fields: [['Bet', bet]],
    image: { name: `fuse_${id}.gif`, data: await renderFuse(bet) },
    buttons: [[`${BUTTON_ID}:${id}:cash`, 'Cash Out', ButtonStyle.Success]],
    footer: `"${pickRandom(START_LINES)}"`,
  });
}

// Ends a game once (Cash Out and the keg at the same moment: only the first counts) and pays out.
// outcome(game) says how it ended. Returns the finished game, or null.
async function settle(id, canEnd, outcome) {
  const game = await games().take(id, (g) => Boolean(g.startedAt) && canEnd(g));
  if (!game) return null;
  const ended = { ...game, done: true, ...outcome(game) };
  const user = await pay(game.userId, ended.lost ? 0 : prize(ended));
  return { ...ended, balance: user.souls };
}

// The keg blows (on its timer). edit: changes the game's message.
async function blow(id, edit) {
  const game = await settle(id, () => true, (g) => ({ lost: true, ms: msUntil(g.crash) }));
  if (game) await edit({ ...(await endView(id, game)), attachments: [] });
}

// casino.js calls this once the start message is up: the fuse starts once the GIF is on screen (GIF_DELAY_MS),
// and the keg blows on time unless they cash out first.
async function posted(id, message) {
  const game = await games().update(id, (g) => (g && !g.done ? { ...g, startedAt: Date.now() + GIF_DELAY_MS } : g));
  if (!game?.startedAt) return;
  setTimeout(() => blow(id, (payload) => message.edit(payload)).catch((e) => console.error('[games] Powder Keg could not blow:', e.message)), GIF_DELAY_MS + msUntil(game.crash))
    .unref(); // doesn't keep the process alive on its own (tests)
}

// Cash Out pressed. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
// Past the moment the keg blows (its timer just hasn't run yet), it's a loss.
async function cashOut(id, userId, now = Date.now()) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s keg. Light your own with \`/mini-game\`.` };
  const game = await settle(id, (g) => g.userId === userId, (g) => {
    const ms = Math.max(0, now - g.startedAt); // a click before the fuse starts (GIF_DELAY_MS) cashes out at 1.00x
    return ms >= msUntil(g.crash) ? { lost: true, ms } : { cashedAt: multiplierAt(ms), ms };
  });
  return game && endView(id, game);
}

// Called off (casino.js expireGames: the start message never went up, or the bot restarted mid-game): the bet back.
const timeoutView = plainTimeout(HOST, TIMEOUT_LINES, AGAIN_ID);

module.exports = {
  games,
  staked,
  timeoutView,
  startGame,
  posted,
  blow,
  cashOut,
  renderFuse,
  renderEnd,
  multiplierAt,
  msUntil,
  crashPoint,
  START_LINES,
  WIN_LINES,
  LOSE_LINES,
  TIMEOUT_LINES,
  BUTTON_ID,
  AGAIN_ID,
  FUSE_MS,
};
