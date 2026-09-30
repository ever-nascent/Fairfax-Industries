// /borrowed-time, Paradox's game: higher or lower on a clock. The hand lands on an hour (I-XII, never the same
// hour twice in a row); call Higher or Lower for the next spin. Each right call multiplies the prize, Cash Out any
// time, one wrong call loses the bet. Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getStore } = require('../storage');
const { changeSouls } = require('./xp');
const { encodeGif } = require('./gif');
const { fmt, soulsText, boldSouls } = require('./format');
const { pickRandom, shortId } = require('./random');
const { ASSETS, halftone, grain, grainAndVignette } = require('./art');
const { takeBet, resultFields, playAgainButton, gameMessage, timeoutMessage } = require('./casino');

const ART = path.join(ASSETS, 'paradox'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0xc24fa0, name: 'Borrowed Time', icon: path.join(ART, 'pulse_grenade.png'), art: ART, prefix: 'paradox' }; // magenta; Pulse Grenade

const RTP = 0.95; // each call pays 95% of its fair odds: the house's small cut
const BUTTON_ID = 'clock'; // custom id: clock:<game id>:<higher|lower|spin|cash>
const AGAIN_ID = 'clock_again'; // custom id: clock_again:<bet>:<player id>
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// Paradox is cocky, runs jobs, makes time puns and explains them (deadlock.wiki "Paradox/Voice lines").
// Original lines in her voice; one goes in the footer.
const WIN_LINES = [
  'Cashing out? Smart. Annoying, but smart.',
  'Fine, take it. Paradox gets it back eventually. We always do.',
  "Quit while you're ahead. Time's on your side... this time.",
  "Good timing. That was a little time joke. You're welcome.",
];
const LOSE_LINES = [
  'Time comes for everyone. Yours just came early.',
  'High risk, high reward. Mostly high risk.',
  "Should've cashed out. Easiest lift of my life.",
  "Don't feel bad. Nobody beats Paradox on the clock.",
];
// While the clock is running.
const PLAY_LINES = [
  "Tick tock. Higher or lower? I haven't got all day. Well, technically I do.",
  "Time's a loan, and I'm the one collecting.",
  "Don't overthink it. That's how you lose time.",
  "Every second counts. Get it? Because it's a clock.",
];
// When a game is called off for taking too long (she gloats).
const TIMEOUT_LINES = [
  "Out of time. Ironic, considering who you're playing with.",
  "Borrowed time comes due. I'm calling it in.",
  "Tick tock. That was your time, and now it's mine.",
  'You had all the time in the world, and you wasted it.',
];

// Games in progress, saved so a bot restart doesn't eat anyone's bet. key: game id
const games = () => getStore('clockGames');

// ---- rules -------------------------------------------------------------------------------------

// How many of the 11 possible next hours make the call right.
const outs = (hour, call) => (call === 'higher' ? 12 - hour : hour - 1);
// What a right call multiplies the prize by: fair odds (11 / outs) minus the cut, rounded down to 2 decimals.
const multiplier = (hour, call) => Math.floor((RTP * 11 * 100) / outs(hour, call)) / 100;
// The next hour: any hour but this one.
function nextHour(hour, randomInt = crypto.randomInt) {
  const r = randomInt(11) + 1;
  return r >= hour ? r + 1 : r;
}

// Which buttons the current hour allows. At I or XII there's nothing to guess (the next hour can only go one
// way), so the hand spins again for free.
function moves(game) {
  if (game.done) return [];
  const list = game.hour === 1 || game.hour === 12 ? ['spin'] : ['higher', 'lower'];
  if (game.prize > game.bet) list.push('cash');
  return list;
}

// Applies a move to a copy of the game (hour drawn by `next` so tests can fix it).
function play(state, move, next = nextHour) {
  const game = structuredClone(state);
  game.prizeBefore = state.prize;
  if (move === 'cash') game.done = true;
  else {
    const to = next(game.hour);
    if (move === 'spin') game.history.push([to, null]);
    else {
      const right = move === 'higher' ? to > game.hour : to < game.hour;
      if (right) game.prize = Math.floor(game.prize * multiplier(game.hour, move));
      else Object.assign(game, { done: true, lost: true });
      game.history.push([to, right, move]);
    }
    game.hour = to;
  }
  game.version++;
  return game;
}

// ---- image -------------------------------------------------------------------------------------

const W = 600, H = 340;
const PLUM = '#241019', TEAL = '#5fc4d8', PINK = '#e86bc0', PALE = '#e8e0ea', GREEN = '#7cffc4', RED = '#ff7a8a';

let art;
async function loadArt() {
  if (art) return art;
  art = { clock: await loadImage(path.join(ART, 'clock.png')), grain: grain(W, H, 4, 46) };
  return art;
}

// One frame. angle: where the main hand points (radians, 0 = XII); landed: false while it's still spinning;
// t: time in seconds, for the background clocks.
function drawFrame(game, angle, landed, t) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const lost = landed && game.lost;
  const hour = ((Math.round(angle / ((Math.PI * 2) / 12)) % 12) + 12) % 12 || 12; // the hour under the hand
  g.drawImage(art.clock, 0, 0, W, H);
  g.fillStyle = 'rgba(18,7,12,0.25)';
  g.fillRect(0, 0, W, H);
  const cx = 300, cy = 160, R = 118;
  const pool = g.createRadialGradient(cx, cy, 40, cx, cy, 150);
  pool.addColorStop(0, 'rgba(18,7,12,0.75)');
  pool.addColorStop(1, 'rgba(18,7,12,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, W, H);
  for (const clock of BG_CLOCKS) drawBackgroundClock(g, clock, t);

  // dial and ticks, the current hour's tick lit
  g.strokeStyle = 'rgba(232,224,234,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R, 0, 7);
  g.stroke();
  g.strokeStyle = 'rgba(232,224,234,0.15)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(cx, cy, R - 10, 0, 7);
  g.stroke();
  for (let h = 1; h <= 12; h++) {
    const a = -Math.PI / 2 + (h / 12) * Math.PI * 2;
    const on = h === hour;
    g.strokeStyle = on ? (lost ? RED : landed ? TEAL : PINK) : 'rgba(232,224,234,0.5)';
    g.lineWidth = on ? 5 : 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16));
    g.lineTo(cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2));
    g.stroke();
  }
  // the hand: ornate, flat plum like the hands in her art
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.fillStyle = PLUM;
  g.strokeStyle = 'rgba(232,224,234,0.7)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -R + 8);
  g.lineTo(7, -R + 30);
  g.lineTo(3, -R + 34);
  g.lineTo(4, 14);
  g.lineTo(-4, 14);
  g.lineTo(-3, -R + 34);
  g.lineTo(-7, -R + 30);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(0, -R + 50, 9, 0, 7);
  g.fill();
  g.stroke();
  g.restore();
  g.fillStyle = PLUM;
  g.beginPath();
  g.arc(cx, cy, 9, 0, 7);
  g.fill();
  g.strokeStyle = PALE;
  g.stroke();

  // the hour as a big Roman numeral like the ones in her art: plum, pale edge, pink halftone
  const tx = cx, ty = cy + 78;
  g.font = 'bold 54px Georgia, serif';
  g.textAlign = 'center';
  g.lineWidth = 6;
  g.strokeStyle = PALE;
  g.strokeText(ROMAN[hour], tx, ty);
  g.globalAlpha = landed ? 1 : 0.55; // dim while the hand is still moving
  g.fillStyle = lost ? '#5a1020' : PLUM;
  g.fillText(ROMAN[hour], tx, ty);
  g.globalAlpha = 1;
  const m = g.measureText(ROMAN[hour]);
  g.save();
  g.beginPath();
  g.rect(tx - m.width / 2, ty - 44, m.width, 48);
  g.clip();
  g.globalCompositeOperation = 'source-atop';
  halftone(g, tx - m.width / 2, ty - 44, m.width, 48, 4, (u, v) => Math.max(0, v - 0.35), 'rgba(232,107,192,0.6)');
  g.restore();

  // timeline: the last 8 hours
  const shown = (landed ? game.history : game.history.slice(0, -1)).slice(-8); // the new hour shows once it lands
  g.fillStyle = 'rgba(18,7,12,0.85)';
  g.beginPath();
  g.roundRect(14, 14, 140, 30 + shown.length * 24, 5);
  g.fill();
  g.strokeStyle = 'rgba(95,196,216,0.7)';
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = TEAL;
  g.font = '14px Retail';
  g.textAlign = 'left';
  g.fillText('TIMELINE', 26, 34);
  shown.forEach(([h, right], i) => {
    g.fillStyle = right === false ? RED : PALE;
    g.font = 'bold 17px Georgia, serif';
    g.fillText(ROMAN[h], 28, 60 + i * 24);
    if (right === undefined) return;
    g.font = '13px Retail';
    g.fillStyle = right ? GREEN : right === false ? RED : TEAL;
    g.fillText(right ? 'CALLED IT' : right === false ? 'WRONG' : 'FREE SPIN', 80, 59 + i * 24);
  });

  // prize
  g.fillStyle = 'rgba(18,7,12,0.85)';
  g.beginPath();
  g.roundRect(W - 150, 14, 136, 62, 5);
  g.fill();
  g.strokeStyle = 'rgba(232,107,192,0.7)';
  g.stroke();
  g.fillStyle = PINK;
  g.font = '14px Retail';
  g.fillText(lost ? 'LOST' : landed && game.done ? 'CASHED OUT' : 'PRIZE', W - 138, 34);
  g.fillStyle = lost ? RED : GREEN;
  g.font = '28px Retail';
  g.fillText(lost ? '0' : fmt(landed ? game.prize : game.prizeBefore ?? game.prize), W - 138, 64);

  g.fillStyle = PALE;
  g.textAlign = 'center';
  g.font = '15px Retail';
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 5;
  g.fillText('HIGHER OR LOWER', cx, 314);
  g.font = '12px Retail';
  g.fillStyle = TEAL;
  g.fillText('BORROWED TIME', cx, 330);
  g.shadowBlur = 0;

  grainAndVignette(g, W, H, art.grain, { grainAlpha: 0.4, inner: 160, outer: 400, dark: 0.5 });
  return g.getImageData(0, 0, W, H).data;
}

// Small clocks around the edges, tilted like the shattered clock in her art, hands ticking at their own speeds.
const BG_CLOCKS = [
  { x: 78, y: 290, r: 32, tilt: -0.5, squash: 0.75, speed: 2.1 },
  { x: 526, y: 196, r: 50, tilt: 0.35, squash: 0.8, speed: -1.3 },
  { x: 452, y: 296, r: 24, tilt: 0.9, squash: 0.65, speed: 3.4 },
];
function drawBackgroundClock(g, { x, y, r, tilt, squash, speed }, t) {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.scale(1, squash);
  g.fillStyle = 'rgba(36,16,25,0.55)';
  g.beginPath();
  g.arc(0, 0, r, 0, 7);
  g.fill();
  g.strokeStyle = 'rgba(232,224,234,0.45)';
  g.lineWidth = 2;
  g.stroke();
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    g.strokeStyle = h % 3 ? 'rgba(232,224,234,0.3)' : 'rgba(95,196,216,0.7)';
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
    g.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    g.stroke();
  }
  // a slow hand and a fast one (the fast one ticks in steps, like a second hand)
  for (const [len, turns, color, width] of [[0.55, speed * 0.15, 'rgba(232,107,192,0.8)', 3], [0.8, Math.floor(speed * t * 6) / 12, 'rgba(95,196,216,0.9)', 1.5]]) {
    const a = (turns * (len === 0.55 ? t : 1)) * Math.PI * 2;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.sin(a) * r * len, -Math.cos(a) * r * len);
    g.stroke();
  }
  g.restore();
}

const SPIN_FRAMES = 28; // at 45 ms: about 1.3 s of spinning
const REST_FRAMES = 14; // then the background clocks keep ticking for about 1 s
// The hand spins from `from` to the game's hour (at least one full turn, slowing down with a little overshoot),
// then rests while the background clocks tick on. from = null: no spin (cashing out). Plays once, stops on the result.
async function renderClock(game, from = 12) {
  await loadArt();
  const spin = from === null ? 0 : SPIN_FRAMES;
  from ??= game.hour;
  const a0 = (from / 12) * Math.PI * 2;
  const a1 = a0 + (((game.hour - from + 12) % 12) / 12) * Math.PI * 2 + Math.PI * 2;
  // slows down with a small overshoot: at most ~0.2 rad, under half an hour, so it never shows the wrong hour
  const easeOutBack = (x) => 1 + 1.7 * (x - 1) ** 3 + 0.7 * (x - 1) ** 2;
  const frames = [];
  for (let f = 0; f < spin; f++) frames.push({ rgba: drawFrame(game, a0 + (a1 - a0) * easeOutBack(f / spin), false, f * 0.045), delay: 45 });
  for (let f = 0; f <= REST_FRAMES; f++) frames.push({ rgba: drawFrame(game, a1, true, spin * 0.045 + f * 0.07), delay: f === 0 ? 90 : 70 });
  return encodeGif(frames, W, H);
}

// ---- messages ----------------------------------------------------------------------------------

async function view(id, game) {
  const file = `clock_${id}_${game.version}.gif`; // new name each step so Discord doesn't reuse the old image
  const from = game.history.length > 1 ? game.history[game.history.length - 2][0] : 12; // where the hand spins from
  const now = ROMAN[game.hour];
  const lines = [];
  let buttons;
  let fields = null;
  let footer = null;
  let mood = 'portrait';
  const [, right, call] = game.history[game.history.length - 1];
  const cashedOut = game.done && !game.lost;

  if (!game.done) {
    if (game.history.length === 1) lines.push(`${game.name} borrowed ${boldSouls(game.bet)} of time.`);
    else if (right === null) lines.push(`Free spin: the hand went to ${now}.`);
    else lines.push(`Called it! The hand went to ${now}. Prize: ${boldSouls(game.prize)}.`);
    lines.push(
      game.hour === 1 || game.hour === 12
        ? `**It's ${now}: the next hour can only go one way. Spin again for free.**`
        : `**It's ${now}. Is the next hour higher or lower?**`,
    );
    buttons = moves(game).map((m) => {
      if (m === 'cash') return [m, `Cash Out (${fmt(game.prize)})`, ButtonStyle.Success];
      if (m === 'spin') return [m, 'Spin Again', ButtonStyle.Primary];
      return [m, `${m === 'higher' ? 'Higher' : 'Lower'} (×${multiplier(game.hour, m)})`, ButtonStyle.Primary];
    });
    buttons = buttons.map(([m, label, style]) => [`${BUTTON_ID}:${id}:${m}`, label, style]);
    footer = `"${pickRandom(PLAY_LINES)}"`;
  } else {
    const won = game.lost ? 0 : game.prize;
    if (game.lost) {
      lines.push(`You called ${call}. The hand went to ${now}.`, `**Time's up. You lose ${soulsText(game.bet)}.**`);
    } else {
      lines.push(`You cashed out at ${now}.`, `**You win ${soulsText(won)}.**`);
    }
    fields = resultFields(game.bet, won, game.balance);
    footer = `"${pickRandom(game.lost ? LOSE_LINES : WIN_LINES)}"`;
    mood = game.lost ? 'gloat' : 'injured'; // she gloats when you lose, she's hurt when you win
    buttons = [playAgainButton(AGAIN_ID, game.bet, game.userId)];
  }

  const image = { name: file, data: await renderClock(game, cashedOut ? null : from) };
  return gameMessage(HOST, { lines, image, buttons, fields, footer, mood });
}

// Takes the bet and spins the first hour. Returns a message payload, or { error }.
async function startGame(user, name, bet, hour = crypto.randomInt(12) + 1) {
  const error = await takeBet(user.id, bet);
  if (error) return { error };
  const id = shortId();
  const game = { userId: user.id, name, bet, prize: bet, hour, history: [[hour]], done: false, lost: false, version: 0, at: Date.now() };
  await games().set(id, game);
  return view(id, game);
}

// A button press. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
async function move(id, userId, action, next = nextHour) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s clock. Borrow your own time with \`/mini-game\`.` };
  if (!moves(current).includes(action)) return null;
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.version !== current.version) return g; // someone clicked twice: only the first counts
    game = play(g, action, next);
    return game;
  });
  if (!game) return null;
  if (!game.done) return view(id, game);
  const user = await changeSouls(userId, game.lost ? 0 : game.prize);
  await games().delete(id);
  return view(id, { ...game, balance: user.souls });
}

// Called off with no click for too long (casino.js expireGames): the clock stops where it was, the bet back
// (a prize built up by right calls is lost).
const staked = (game) => game.bet;
async function timeoutView(id, game, balance) {
  return timeoutMessage(HOST, {
    image: { name: `clock_${id}_timeout.gif`, data: await renderClock(game, null) },
    staked: staked(game), balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId,
    line: `"${pickRandom(TIMEOUT_LINES)}"`,
  });
}

module.exports = {
  games,
  staked,
  timeoutView,
  TIMEOUT_LINES,
  startGame,
  move,
  moves,
  play,
  multiplier,
  nextHour,
  renderClock,
  WIN_LINES,
  LOSE_LINES,
  BUTTON_ID,
  AGAIN_ID,
};
