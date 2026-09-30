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
const { changeSouls } = require('./xp');
const { fmt, soulsText, boldSouls } = require('./format');
const { pickRandom, shortId } = require('./random');
const { ASSETS, seeded, halftone, grain, grainAndVignette, loadSouls, drawSouls } = require('./art');
const { resultFields, playAgainButton, gameMessage, timeoutMessage, takeBet } = require('./casino');

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
// orange sheriff star, halftone, grain), her white Powder Keg icon with a plain white fuse thrown in one big
// lasso loop, a comic flame at the burning end, the multiplier on a cream-edged plate.

const W = 640, H = 240, S = W / 800;
const TEAL = '#1d2927', ORANGE = '#d9782d', AMBER = '#f0a442', CREAM = '#efe3c8', WHITE = '#f6f2ea';
const SMOKE = '#435e5a', SMOKE_HI = '#6f8e88';
const KX = 50, KY = 80, KS = 190 / 137; // where the keg icon (137 px) sits, and its scale
const TIP = { x: KX + 123 * KS, y: KY + 29 * KS }; // top of the icon's own fuse stub
const FW = 6 * KS; // the icon's fuse thickness

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
  const L0 = { x: 262, y: 140 }, L1 = { x: 452, y: 140 }, M = { x: 560, y: 100 }, END = { x: 690, y: 112 };
  const dense = [
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
  art = { bg, keg, fuse, base, souls: await loadSouls(), grain: grain(W, H, 11, 70) };
  return art;
}

// ---- the flame at the burning end, in the explosion's style: layered orange / amber / cream / white with
// halftone dots between the layers, grunge from her background, cream light shards, embers rising ----

// A comic flame: round at the bottom, three tongues licking up; sway leans them.
function flamePath(g, x, y, R, height, sway) {
  const tongues = [[-0.62, 0.62], [0, 1], [0.55, 0.72]]; // [angle off straight up, height]
  g.beginPath();
  for (let i = 0; i <= 120; i++) {
    const th = -Math.PI + (Math.PI * 2 * i) / 120; // from the left, over the top, round the bottom
    let r = R;
    if (th < 0) {
      for (const [off, h] of tongues) {
        const d = Math.abs(th - (-Math.PI / 2 + off + sway * (1 + off)));
        r = Math.max(r, R + height * h * Math.max(0, 1 - d / 0.5) ** 1.7);
      }
    }
    g.lineTo(x + Math.cos(th) * r * (th < 0 ? 0.8 : 1), y + Math.sin(th) * r);
  }
  g.closePath();
}
function flame(g, p, frame) {
  const sway = Math.sin(frame * 1.3) * 0.12, lick = 1 + Math.sin(frame * 2.1) * 0.12;
  halftone(g, p.x - 70, p.y - 92, 140, 140, 7, (u, v) => Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2.1) * 0.95, 'rgba(240,164,66,.8)');
  shards(g, p.x, p.y - 10, 7, 80, 300 + (frame % 5), 0.22, 1);
  const layer = (R, height, dy, fill, dots) => {
    const shape = () => flamePath(g, p.x, p.y - dy, R, height * lick, sway);
    shape();
    g.fillStyle = fill;
    g.fill();
    if (dots) {
      const r = R + height * 0.6, cy = p.y - dy - height * 0.4;
      g.save();
      shape();
      g.clip();
      halftone(g, p.x - r, cy - r, r * 2, r * 2, 5, (u, v) => Math.max(0, 1.05 - Math.hypot(u - 0.5, v - 0.5) * 2.2), dots);
      g.restore();
    }
    return shape;
  };
  grunge(g, layer(22, 74, 0, ORANGE, AMBER), 0.3);
  layer(16, 50, -2, AMBER, CREAM);
  layer(10, 28, -3, CREAM, WHITE);
  layer(5, 12, -3, '#fffdf6');
  // embers rising off it
  const rnd = seeded(500 + frame);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = 40 * (0.4 + rnd() * 0.9);
    g.fillStyle = rnd() > 0.5 ? WHITE : AMBER;
    g.beginPath();
    g.arc(p.x + Math.cos(a) * r, p.y - 50 + Math.sin(a) * r - 40 * rnd(), 1 + rnd() * 2.2, 0, 7);
    g.fill();
  }
}

function smokePuff(g, p) {
  g.fillStyle = 'rgba(200,200,190,.55)';
  for (const [dx, dy, r] of [[0, -10, 9], [8, -24, 12], [-4, -42, 14], [10, -60, 11]]) {
    g.beginPath();
    g.arc(p.x + dx, p.y + dy, r, 0, 7);
    g.fill();
  }
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
    g.strokeStyle = '#fff';
    g.lineWidth = FW;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(fuse[0].x, fuse[0].y);
    for (let i = 1; i <= end; i++) g.lineTo(fuse[i].x, fuse[i].y);
    g.stroke();
    g.drawImage(art.keg, KX, KY, 137 * KS, 137 * KS);
    if (state === 'lit') flame(g, fuse[end], frame);
    else smokePuff(g, fuse[end]);
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
  const lines = game.lost
    ? [`**BOOM!** The keg blew at **${times(game.crash)}**.`, `**You lose ${soulsText(game.bet)}.**`]
    : [`You cashed out at **${times(game.cashedAt)}**.`, `**You win ${soulsText(prize(game))}.**`, `The keg would have blown at **${times(game.crash)}**.`];
  return gameMessage(HOST, {
    lines,
    image: { name: `keg_${id}.png`, data: await renderEnd(game) },
    fields: resultFields(game.bet, game.lost ? 0 : prize(game), game.balance),
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    footer: `"${pickRandom(game.lost ? LOSE_LINES : WIN_LINES)}"`,
    mood: game.lost ? 'gloat' : 'injured', // she gloats when you lose, she's hurt when you win
  });
}

// Takes the bet and picks where the keg blows. Returns a message payload, or { error }.
// The fuse starts once the message is up (posted).
async function startGame(user, name, bet, crash = crashPoint()) {
  const error = await takeBet(user.id, bet);
  if (error) return { error };
  const id = shortId();
  await games().set(id, { userId: user.id, name, bet, crash, done: false, at: Date.now() });
  return gameMessage(HOST, {
    lines: [`<@${user.id}> put ${boldSouls(bet)} on the keg.`, 'The longer you wait, the more it pays. **Cash Out before it blows.**'],
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
  const user = await changeSouls(game.userId, ended.lost ? 0 : prize(ended));
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
const staked = (game) => game.bet;
async function timeoutView(id, game, balance) {
  return timeoutMessage(HOST, {
    staked: staked(game), balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId,
    line: `"${pickRandom(TIMEOUT_LINES)}"`,
  });
}

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
  CAP,
};
