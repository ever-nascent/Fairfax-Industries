// Thin Ice, Kelvin's game (the Squid Game glass bridge on his Ice Path): a frozen path of 10 steps, two panels each.
// Pick Left or Right; one panel of every step cracks (50/50). Every safe step doubles the prize, Cash Out any time
// after the first; a cracked panel loses the bet. Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { getStore } = require('../storage');
const { fmt } = require('./format');
const { pickRandom } = require('./random');
const { ASSETS, loadSouls, drawSouls, seeded, halftone, grain, grainAndVignette } = require('./art');
const { GREEN, RED, staked, plainTimeout, resultFields, playAgainButton, gameMessage, forGame } = require('./casino');

const ART = path.join(ASSETS, 'kelvin'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0x7cc8f0, name: 'Thin Ice', icon: path.join(ART, 'ice_path.png'), art: ART, prefix: 'kelvin' }; // ice blue; Ice Path

const STEPS = 10; // his call, Oct 22
const RTP = 0.95; // the house's cut, taken once: the prize is 95% of the fair odds of getting this far (like Bebop's Bombs)
const BUTTON_ID = 'ice'; // custom id: ice:<game id>:<left|right|cash>
const { pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger
const AGAIN_ID = 'ice_again'; // custom id: ice_again:<bet>:<player id>
const SIDES = ['left', 'right'];

// Kelvin: a big-hearted Arctic explorer and scientist, warm and fatherly, fond of a cold joke (deadlock.wiki
// "Kelvin/Voice lines"). Original lines in his voice; one goes in the footer.
const START_LINES = [
  'Easy now. The ice will tell you where to step, if you listen.',
  'I laid this path myself. Mostly sturdy. Mostly.',
  'Cold out here, eh? Keep moving, it helps.',
  'One foot in front of the other. Left or right, friend?',
];
// After a safe step.
const SAFE_LINES = [
  'Ha! Solid as a glacier.',
  "Good footing. Don't get greedy, though.",
  'Hear that creak? Neither did I. Keep going.',
  "You've got the legs of a mountaineer.",
];
// You cashed out or crossed (he's hurt).
const WIN_LINES = [
  "Wise. The ice doesn't forgive, but it does let you leave.",
  'Back on solid ground. Warm your hands, you earned it.',
  'Ha! You made it. My pockets are a little colder for it.',
  "Smart choice. I've seen braver folk go for a swim.",
];
// You fell through (he gloats).
const LOSE_LINES = [
  "Splash! Don't worry, the water's only freezing.",
  'Thin ice, friend. I did warn you.',
  'Ah, should have stepped the other way. Happens to the best of us.',
  "Down you go! I'll fish you out once I've counted these Souls.",
];
// When a game is called off for taking too long.
const TIMEOUT_LINES = [
  'Standing still out here is how you freeze solid.',
  'The path melted while you were thinking.',
  "Took too long, friend. Ice Path doesn't last forever.",
  "I've seen glaciers move faster than that.",
];

// Games in progress, saved so a bot restart doesn't eat anyone's bet. key: game id
const games = () => getStore('kelvinGames');

// ---- rules -------------------------------------------------------------------------------------

// What `safe` safe steps pay, as a multiple of the bet: 95% of the fair odds (2 per step), rounded down to 2 decimals.
// 1: x1.9, 2: x3.8, 3: x7.6 ... 10 (the whole path): x972.8.
const multiplier = (safe) => (safe ? Math.floor(RTP * 2 ** safe * 100 + 1e-6) / 100 : 1);
const prizeFor = (bet, safe) => Math.floor(bet * multiplier(safe));

// The panel that holds on each step: 0 left, 1 right.
const makePath = (randomInt = crypto.randomInt) => Array.from({ length: STEPS }, () => randomInt(2));

const safeSteps = (game) => game.picks.length - (game.lost ? 1 : 0);

function moves(game) {
  if (game.done) return [];
  return game.picks.length ? [...SIDES, 'cash'] : [...SIDES];
}

// Applies a move ('left' / 'right' / 'cash') to a copy of the game.
function play(state, move) {
  const game = structuredClone(state);
  if (move === 'cash') game.done = true;
  else {
    const side = SIDES.indexOf(move);
    game.picks.push(side);
    if (game.path[game.picks.length - 1] !== side) Object.assign(game, { done: true, lost: true });
    else if (game.picks.length === STEPS) game.done = true; // crossed the whole path: cashed out for them
  }
  game.version++;
  return game;
}

// ---- picture -----------------------------------------------------------------------------------

const W = 600, H = 420;
const CX = 270; // the path's centre line (the multipliers sit on its right)
const NEAR_Y = 372; // bottom of step 1
const SHRINK = 0.92; // each step further away is this much smaller
const ROW = 32, GAP = 7, HALF = 150, MID = 9; // step 1's height, the gap between steps, half the path's width, half the middle gap
const ICE = '#cfeaff', FROST = '#7cc8f0', ABYSS = '#03070e';
let textures;

// Where step i sits: its bottom and top y and the scale at each.
function rowBox(i) {
  let y = NEAR_Y, s = 1;
  for (let k = 0; k < i; k++) { y -= (ROW + GAP) * s; s *= SHRINK; }
  return { yb: y, sb: s, yt: y - ROW * s, st: s * SHRINK };
}

// One panel's corners: side 0 left, 1 right.
function panel(i, side) {
  const { yb, sb, yt, st } = rowBox(i);
  const dir = side ? 1 : -1;
  return [[CX + dir * MID * sb, yb], [CX + dir * HALF * sb, yb], [CX + dir * HALF * st, yt], [CX + dir * MID * st, yt]];
}

function poly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

// Crack lines spreading from a point in the panel (seeded, so a panel always cracks the same way).
function cracks(g, pts, seed, color, width) {
  const rnd = seeded(seed);
  const [x0, y0] = [(pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4, (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4];
  const w = Math.abs(pts[1][0] - pts[0][0]), h = Math.abs(pts[0][1] - pts[3][1]);
  g.save();
  poly(g, pts);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = width;
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rnd() * 0.6;
    let x = x0, y = y0;
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 4; j++) {
      x += Math.cos(a + (rnd() - 0.5) * 0.9) * w * 0.16;
      y += Math.sin(a + (rnd() - 0.5) * 0.9) * h * 0.4;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

// The panel you fell through: a hole into the dark with jagged shards left round its edge.
function broken(g, pts, seed) {
  const rnd = seeded(seed);
  g.save();
  poly(g, pts);
  g.clip();
  g.fillStyle = ABYSS;
  g.fill();
  g.fillStyle = 'rgba(207,234,255,0.75)';
  for (let e = 0; e < 4; e++) {
    const [a, b] = [pts[e], pts[(e + 1) % 4]];
    const [mx, my] = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
    for (let k = 0; k < 4; k++) {
      const t0 = k / 4, t1 = (k + 1) / 4, tm = (t0 + t1) / 2, d = 0.15 + rnd() * 0.3;
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const pm = [a[0] + (b[0] - a[0]) * tm, a[1] + (b[1] - a[1]) * tm];
      poly(g, [p0, p1, [pm[0] + (mx - pm[0]) * d, pm[1] + (my - pm[1]) * d]]);
      g.fill();
    }
  }
  g.restore();
  poly(g, pts);
  g.strokeStyle = '#ff6b78';
  g.lineWidth = 2;
  g.stroke();
}

function drawPanel(g, i, side, state) {
  const pts = panel(i, side);
  const [yb, yt] = [pts[0][1], pts[3][1]];
  if (state === 'fell') return broken(g, pts, 31 + i * 2 + side);
  const grad = g.createLinearGradient(0, yb, 0, yt);
  if (state === 'safe') { grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#a8dcff'); }
  else if (state === 'cracked') { grad.addColorStop(0, 'rgba(120,160,190,0.45)'); grad.addColorStop(1, 'rgba(90,130,165,0.35)'); }
  else { grad.addColorStop(0, 'rgba(190,225,255,0.42)'); grad.addColorStop(1, 'rgba(150,200,240,0.28)'); }
  g.save();
  if (state === 'safe' || state === 'next') { g.shadowColor = FROST; g.shadowBlur = state === 'safe' ? 14 : 10; }
  poly(g, pts);
  g.fillStyle = grad;
  g.fill();
  g.restore();
  // frost streaks across the ice
  g.save();
  poly(g, pts);
  g.clip();
  g.strokeStyle = state === 'safe' ? 'rgba(124,200,240,0.5)' : 'rgba(255,255,255,0.22)';
  g.lineWidth = 1;
  const rnd = seeded(7 + i * 2 + side);
  for (let k = 0; k < 3; k++) {
    const x = pts[0][0] + (pts[1][0] - pts[0][0]) * rnd(), y = yb - (yb - yt) * rnd();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (side ? 1 : -1) * 22 * (1 - i * 0.05), y - 4);
    g.stroke();
  }
  g.restore();
  if (state === 'cracked') cracks(g, pts, 51 + i * 2 + side, 'rgba(230,245,255,0.75)', 1.2);
  poly(g, pts);
  g.strokeStyle = state === 'next' ? '#ffffff' : state === 'safe' ? ICE : 'rgba(207,234,255,0.55)';
  g.lineWidth = state === 'next' ? 2.5 : 1.5;
  g.stroke();
}

// A snowy ledge: the near one under step 1, the far one past the last step.
function ledge(g, yb, sb, yt, st) {
  const pts = [[CX - (HALF + 14) * sb, yb], [CX + (HALF + 14) * sb, yb], [CX + (HALF + 14) * st, yt], [CX - (HALF + 14) * st, yt]];
  const grad = g.createLinearGradient(0, yb, 0, yt);
  grad.addColorStop(0, '#e9f5ff');
  grad.addColorStop(1, '#9fc4de');
  poly(g, pts);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.5;
  g.stroke();
}

async function loadTextures() {
  if (textures) return textures;
  const snow = createCanvas(W, H), s = snow.getContext('2d'), rnd = seeded(97);
  for (let k = 0; k < 140; k++) {
    s.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`;
    s.beginPath();
    s.arc(rnd() * W, rnd() * H, 0.6 + rnd() * 1.8, 0, 7);
    s.fill();
  }
  textures = { snow, grain: grain(W, H, 11, 40), souls: await loadSouls() };
  return textures;
}

// The path seen from Kelvin's end: crossed panels glow, the one you fell through is a hole. Once it's over every
// cracked panel shows its cracks.
async function renderPath(game) {
  const { snow, grain: grainTexture, souls } = await loadTextures();
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#16304d');
  sky.addColorStop(0.35, '#0b1a2e');
  sky.addColorStop(1, ABYSS);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // a cold glow on the horizon behind the far end, comic dots in the drop
  const glow = g.createRadialGradient(CX, 40, 10, CX, 40, 260);
  glow.addColorStop(0, 'rgba(124,200,240,0.35)');
  glow.addColorStop(1, 'rgba(124,200,240,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  halftone(g, 0, 180, W, H - 180, 9, (u, v) => v * 0.55, 'rgba(124,200,240,0.10)');

  const far = rowBox(STEPS);
  ledge(g, far.yb + GAP * far.sb * 0.5, far.sb, far.yb - 26 * far.sb, far.sb * SHRINK);
  ledge(g, H + 4, 1.06, NEAR_Y + GAP * 0.6, 1);

  const at = game.picks.length; // the step being chosen (while playing)
  for (let i = STEPS - 1; i >= 0; i--) {
    for (const side of [0, 1]) {
      const picked = game.picks[i] === side;
      const holds = game.path[i] === side;
      let state = 'ice';
      if (picked) state = holds ? 'safe' : 'fell';
      else if (game.done && !holds) state = 'cracked';
      else if (!game.done && i === at) state = 'next';
      drawPanel(g, i, side, state);
    }
    // the prize each step pays, on the right
    const { yb, yt, sb } = rowBox(i);
    const passed = i < safeSteps(game);
    g.font = `${Math.round(Math.max(13, 20 * sb))}px Retail`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = passed ? ICE : !game.done && i === at ? '#ffffff' : 'rgba(207,234,255,0.45)';
    g.fillText(`x${multiplier(i + 1)}`, CX + (HALF + 26) * sb, (yb + yt) / 2);
  }

  // your souls where you stand: the start ledge, the last safe panel, or falling through
  const safe = safeSteps(game);
  if (!game.lost) {
    const spot = safe ? rowBox(safe - 1) : { yb: NEAR_Y + 30, yt: NEAR_Y + 4, sb: 1 };
    const x = safe ? CX + (game.picks[safe - 1] ? 1 : -1) * ((HALF + MID) / 2) * spot.sb : CX;
    const h = 36 * spot.sb;
    g.save();
    g.shadowColor = '#7dffb3';
    g.shadowBlur = 16;
    drawSouls(g, souls, x - (h * souls.width) / souls.height / 2, (spot.yb + spot.yt) / 2 - h / 2 - 4 * spot.sb, h);
    g.restore();
  }

  g.drawImage(snow, 0, 0);
  grainAndVignette(g, W, H, grainTexture, { grainAlpha: 0.35, inner: 180, outer: 420, dark: 0.55 });
  return c.encode('png');
}

// ---- messages ----------------------------------------------------------------------------------

// The template every game follows (his pick Oct 22): one plain line and the state in fields while playing (Bet last); one
// bold line, the money in fields and green / red once it's over.
async function view(id, game) {
  const safe = safeSteps(game);
  const prize = prizeFor(game.bet, safe);
  const image = { name: `ice_${id}_${game.version}.png`, data: await renderPath(game) };
  if (!game.done) {
    const lines = [safe ? `Safe! Step ${safe + 1} of ${STEPS}. Left or right?` : `${STEPS} steps of Ice Path. One panel of each step cracks. Left or right?`];
    const fields = [['Prize', safe ? prize : 'None yet'], ['Next Step', prizeFor(game.bet, safe + 1)], ['Bet', game.bet]];
    const buttons = [
      [`${BUTTON_ID}:${id}:left`, 'Left', ButtonStyle.Primary],
      [`${BUTTON_ID}:${id}:right`, 'Right', ButtonStyle.Primary],
      [`${BUTTON_ID}:${id}:cash`, safe ? `Cash Out (${fmt(prize)})` : 'Cash Out', ButtonStyle.Success, { disabled: !safe }],
    ];
    return gameMessage(HOST, { lines, image, buttons, fields, footer: `"${pickRandom(safe ? SAFE_LINES : START_LINES)}"` });
  }
  const buttons = [playAgainButton(AGAIN_ID, game.bet, game.userId)];
  if (game.lost) {
    return gameMessage(HOST, {
      lines: [`**The ice cracked on step ${game.picks.length}.**`],
      image,
      buttons,
      fields: resultFields(game.bet, 0, game.balance),
      footer: `"${pickRandom(LOSE_LINES)}"`,
      mood: 'gloat', // he gloats when you lose, he's hurt when you win
      color: RED,
    });
  }
  return gameMessage(HOST, {
    lines: [safe === STEPS ? '**You crossed the whole path!**' : `**You cashed out after ${safe} safe step${safe === 1 ? '' : 's'}.**`],
    image,
    buttons,
    fields: resultFields(game.bet, prize, game.balance),
    footer: `"${pickRandom(WIN_LINES)}"`,
    mood: 'injured',
    color: GREEN,
  });
}

// Takes the bet and freezes the path. Returns a message payload, or { error }.
async function startGame(user, name, bet, iced = makePath()) {
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({ userId: user.id, name, bet, path: iced, picks: [], done: false, lost: false, version: 0 }));
  return error ? { error } : view(id, game);
}

// A button press. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
async function move(id, userId, action) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s path. Lay your own with \`/mini-game\`.` };
  if (!moves(current).includes(action)) return null;
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.version !== current.version) return g; // someone clicked twice: only the first counts
    game = play(g, action);
    return game;
  });
  if (!game) return null;
  if (!game.done) return view(id, game);
  const user = await pay(userId, game.lost ? 0 : prizeFor(game.bet, safeSteps(game)));
  await games().delete(id);
  return view(id, { ...game, balance: user.souls });
}

// Time ran out (casino.js expireGames): with safe steps behind them the prize so far is cashed out; with none the bet goes back.
function finishOnTimeout(id, state) {
  if (!state.picks.length) return null;
  const game = play(state, 'cash');
  return { pays: [[game.userId, prizeFor(game.bet, safeSteps(game))]], view: (balance) => view(id, { ...game, balance }) };
}

const timeoutView = plainTimeout(HOST, TIMEOUT_LINES, AGAIN_ID);

module.exports = {
  games,
  staked,
  timeoutView,
  finishOnTimeout,
  startGame,
  move,
  moves,
  play,
  multiplier,
  prizeFor,
  makePath,
  renderPath,
  WIN_LINES,
  LOSE_LINES,
  TIMEOUT_LINES,
  BUTTON_ID,
  AGAIN_ID,
  STEPS,
};
