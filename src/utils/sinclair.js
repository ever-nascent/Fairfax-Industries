// /rabbit-in-the-hat, Sinclair's game: three top hats, the rabbit is under one. Sinclair shuffles (an animated
// GIF), you pick a hat; a win pays 2.5x the bet. Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { encodeGif } = require('./gif');
const { getStore } = require('../storage');
const { changeSouls } = require('./xp');
const { soulsText, boldSouls } = require('./format');
const { pickRandom, shortId } = require('./random');
const { ASSETS, halftone, grain, grainAndVignette } = require('./art');
const { takeBet, resultFields, playAgainButton, gameMessage, timeoutMessage } = require('./casino');

const ART = path.join(ASSETS, 'sinclair'); // deadlock.wiki, see assets/CREDITS.txt
// the pale sage of his select art; his Rabbit Hex icon
const HOST = { color: 0x8fa39a, name: 'The Amazing Sinclair', icon: path.join(ART, 'rabbit_hex.png'), art: ART, prefix: 'sinclair' };

const PAYOUT = 2.5;
const BUTTON_ID = 'hat'; // custom id: hat:<game id>:<hat index>
const AGAIN_ID = 'hat_again'; // custom id: hat_again:<bet>:<player id>
const winnings = (bet) => Math.floor(bet * PAYOUT);

// Henry the Magnificent and his spectral assistant Savannah share one body and never stop bickering
// (deadlock.wiki "Sinclair/Voice lines"). Original lines in their voices: 4 each, so either one speaks half the time.
const WIN_LINES = [
  `Henry: "A lucky guess. Please, hold your applause."`,
  `Henry: "That was part of the act, obviously."`,
  `Henry: "Nobody finds the rabbit! Nobody was SUPPOSED to."`,
  `Henry: "Enjoy your moment. Henry the Magnificent will return."`,
  `Savannah: "You found it? Henry's going to sulk for a week."`,
  `Savannah: "I told him to shuffle faster."`,
  `Savannah: "Good eye. Don't tell Henry I said that."`,
  `Savannah: "Well, somebody finally upstaged him."`,
];
const LOSE_LINES = [
  `Henry: "Presto! And your Souls disappear."`,
  `Henry: "God, I'm good."`,
  `Henry: "Please, hold your applause. Actually, no. Applaud."`,
  `Henry: "I am Henry the Magnificent! Never forget it."`,
  `Savannah: "Don't feel bad. Nobody ever finds it."`,
  `Savannah: "He takes the bows, I take your Souls. Teamwork."`,
  `Savannah: "The rabbit's never where you think. Trust me."`,
  `Savannah: "Another satisfied audience member."`,
];
// While the hats shuffle.
const START_LINES = [
  `Henry: "Ladies and gentlemen, keep your eyes on the hats!"`,
  `Henry: "Behold! The greatest trick in all of the Cursed Apple!"`,
  `Savannah: "Watch his hands. Actually, watch mine."`,
  `Savannah: "He practiced this all night. Humor him."`,
];
// When a game is called off for taking too long.
const TIMEOUT_LINES = [
  `Henry: "The show must go on! Without you, apparently."`,
  `Henry: "Intermission is over. The audience has gone home."`,
  `Savannah: "Took too long. The rabbit got bored and left."`,
  `Savannah: "Henry waited. I didn't. Curtain's down."`,
];

// Games in progress, saved so a bot restart doesn't eat anyone's bet. key: game id
const games = () => getStore('hatGames');

// ---- image -------------------------------------------------------------------------------------

const W = 600, H = 340;
const PALE = '#d3dbd2', NAVY = '#1b2030', INK = '#0b0d12';
const HX = [250, 370, 490]; // hat positions on the table
const TABLE = 250; // y of the table top

// A cut-out turned into a flat shape of one colour.
function silhouette(img, color) {
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

let art;
async function loadArt() {
  if (art) return art;
  const rabbit = await loadImage(path.join(ART, 'rabbit.png'));
  art = { stage: await loadImage(path.join(ART, 'stage.png')), rabbitW: rabbit.width, rabbitH: rabbit.height };
  art.rabbit = silhouette(rabbit, PALE);
  art.rabbitInk = silhouette(rabbit, INK);
  art.backdrop = drawBackdrop();
  art.grain = grain(W, H, 9, 46);
  return art;
}

// His select art with the table and title on it (everything that never moves).
function drawBackdrop() {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(art.stage, 0, 0, W, H);
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(70, TABLE);
  g.lineTo(530, TABLE);
  g.lineTo(570, H);
  g.lineTo(30, H);
  g.closePath();
  g.fill();
  g.fillStyle = PALE;
  g.fillRect(70, TABLE - 2, 460, 3);
  halftone(g, 30, TABLE + 1, 540, H - TABLE - 1, 5, (u, v) => Math.max(0, 0.5 - v * 0.6 - Math.abs(u - 0.6) * 0.5), 'rgba(211,219,210,0.35)');
  g.fillStyle = PALE;
  g.textAlign = 'left';
  g.font = '22px Retail';
  g.fillText('THE AMAZING', 22, 38);
  g.font = '40px Retail';
  g.fillText('SINCLAIR', 20, 76);
  g.fillStyle = 'rgba(211,219,210,0.6)';
  g.fillRect(22, 86, 150, 2);
  g.font = '13px Retail';
  g.fillText('WHERE IS THE RABBIT', 22, 106); // the font has no "?"
  return c;
}

// Top hat, origin at the bottom centre of the brim: comic halftone from a moonlit top to solid black,
// a brass band like his pocket watch, the brim curled with a pale edge.
function topHat(g) {
  const crown = () => {
    g.beginPath();
    g.moveTo(-28, -10);
    g.lineTo(-31, -94);
    g.quadraticCurveTo(0, -100, 31, -94);
    g.lineTo(28, -10);
    g.closePath();
  };
  g.fillStyle = INK;
  crown();
  g.fill();
  g.save();
  crown();
  g.clip();
  halftone(g, -32, -100, 64, 92, 4.5, (u, v) => Math.max(0, 1 - v * 1.5 - Math.abs(u - 0.7) * 0.8), 'rgba(211,219,210,0.75)');
  g.restore();
  g.fillStyle = '#b9ae8a';
  g.fillRect(-28.5, -30, 57, 10);
  halftone(g, -29, -30, 58, 10, 3, (u) => Math.max(0, 0.5 - u * 0.6), 'rgba(11,13,18,0.6)');
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(-54, -14);
  g.quadraticCurveTo(-40, -6, -26, -9);
  g.lineTo(26, -9);
  g.quadraticCurveTo(40, -6, 54, -14);
  g.quadraticCurveTo(52, 0, 28, 1);
  g.lineTo(-28, 1);
  g.quadraticCurveTo(-52, 0, -54, -14);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(211,219,210,0.7)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(26, -9);
  g.quadraticCurveTo(40, -6, 54, -14);
  g.stroke();
}

// One picture. hats: [{ x, lift, tilt }]; rabbitAt: hat index or null; mine: hat index or null.
function drawScene({ hats, rabbitAt = null, mine = null }) {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(art.backdrop, 0, 0);
  for (const h of hats) {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.ellipse(h.x + 8, TABLE + 2, 27 + 20 * Math.max(0, 1 - (h.lift ?? 0) / 60), 6, 0, 0, 7);
    g.fill();
  }
  if (rabbitAt !== null) {
    const x = HX[rabbitAt];
    const rw = 50;
    const rh = rw * (art.rabbitH / art.rabbitW) * 0.55;
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) g.drawImage(art.rabbitInk, x - rw / 2 + dx, TABLE - rh + dy, rw, rh);
    g.save();
    g.shadowColor = 'rgba(211,219,210,0.9)';
    g.shadowBlur = 18;
    g.drawImage(art.rabbit, x - rw / 2, TABLE - rh, rw, rh);
    g.restore();
    halftone(g, x - rw / 2, TABLE - rh, rw, rh, 3, (u, v) => Math.max(0, v - 0.55), 'rgba(27,32,48,0.5)');
  }
  for (const h of hats) {
    g.save();
    g.translate(h.x, TABLE - (h.lift ?? 0));
    g.rotate(h.tilt ?? 0);
    topHat(g);
    g.restore();
  }
  HX.forEach((x, i) => {
    g.fillStyle = i === mine ? PALE : NAVY;
    g.beginPath();
    g.roundRect(x - 15, 282, 30, 26, 3);
    g.fill();
    g.strokeStyle = PALE;
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = i === mine ? INK : PALE;
    g.font = '19px Retail';
    g.textAlign = 'center';
    g.fillText(String(i + 1), x, 301);
  });
  grainAndVignette(g, W, H, art.grain, { grainAlpha: 0.4, inner: 170, outer: 400, dark: 0.5 });
  return g.getImageData(0, 0, W, H).data;
}

// The result: your hat lifted, and the rabbit's hat lifted too if it's a different one.
async function renderReveal(pick, rabbitAt) {
  await loadArt();
  const hats = HX.map((x, i) => (i === pick || i === rabbitAt ? { x: x + 20, lift: 96, tilt: -0.28 } : { x }));
  const rgba = drawScene({ hats, rabbitAt, mine: pick });
  const c = createCanvas(W, H);
  const img = c.getContext('2d').createImageData(W, H);
  img.data.set(rgba);
  c.getContext('2d').putImageData(img, 0, 0);
  return c.toBuffer('image/png');
}

// The shuffle: hats swap places in arcs (one over, one under). Decorative: the rabbit is placed at random,
// so following the hats doesn't help. Same every game, so it's made once.
const SWAPS = [[0, 1], [1, 2], [0, 2], [1, 2], [0, 1], [0, 2]];
const STEPS = 7;
let shuffleGif;
async function renderShuffle() {
  if (shuffleGif) return shuffleGif;
  await loadArt();
  const frames = [drawScene({ hats: HX.map((x) => ({ x })) })];
  for (const [a, b] of SWAPS) {
    for (let s = 1; s <= STEPS; s++) {
      const t = s / STEPS;
      const ease = t * t * (3 - 2 * t);
      const arc = Math.sin(Math.PI * t);
      const hats = HX.map((x) => ({ x }));
      hats[a] = { x: HX[a] + (HX[b] - HX[a]) * ease, lift: arc * 34, tilt: arc * 0.15 };
      hats[b] = { x: HX[b] + (HX[a] - HX[b]) * ease, lift: -arc * 4 };
      frames.push(drawScene({ hats }));
    }
  }
  shuffleGif = encodeGif(
    frames.map((rgba, f) => ({ rgba, delay: f === 0 ? 500 : f === frames.length - 1 ? 1000 : 55 })),
    W,
    H,
  );
  return shuffleGif;
}

// ---- messages ----------------------------------------------------------------------------------

// Takes the bet, hides the rabbit, shows the shuffle. Returns a message payload, or { error }.
async function startGame(user, name, bet) {
  const error = await takeBet(user.id, bet);
  if (error) return { error };
  const id = shortId();
  await games().set(id, { userId: user.id, name, bet, rabbit: crypto.randomInt(3), done: false, at: Date.now() });
  return gameMessage(HOST, {
    lines: [`${name} bet ${boldSouls(bet)}.`, 'Sinclair shuffles the hats...', '**Where is the rabbit?**'],
    buttons: HX.map((_, i) => [`${BUTTON_ID}:${id}:${i}`, `Hat ${i + 1}`, ButtonStyle.Secondary]),
    footer: pickRandom(START_LINES), // already "Henry: ..." / "Savannah: ..."
    image: { name: `shuffle_${id}.gif`, data: await renderShuffle() },
  });
}

// A hat picked. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
async function pickHat(id, userId, pick) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s trick. Try your own with \`/mini-game\`.` };
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.done) return g; // only the first click counts
    game = { ...g, done: true };
    return game;
  });
  if (!game) return null;
  const won = pick === game.rabbit;
  const user = await changeSouls(userId, won ? winnings(game.bet) : 0);
  await games().delete(id);
  return gameMessage(HOST, {
    lines: [
      won ? `Hat ${pick + 1}... and there's the rabbit!` : `Hat ${pick + 1}... empty. The rabbit was under hat ${game.rabbit + 1}.`,
      won ? `**You win ${soulsText(winnings(game.bet))}.**` : `**You lose ${soulsText(game.bet)}.**`,
    ],
    fields: resultFields(game.bet, won ? winnings(game.bet) : 0, user.souls),
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    footer: pickRandom(won ? WIN_LINES : LOSE_LINES), // already "Henry: ..." / "Savannah: ..."
    mood: won ? 'injured' : 'gloat', // he's hurt when you win, he gloats when you lose
    image: { name: `reveal_${id}.png`, data: await renderReveal(pick, game.rabbit) },
  });
}

// Called off with no click for too long (casino.js expireGames): the hats stay down, the bet back.
const staked = (game) => game.bet;
async function timeoutView(id, game, balance) {
  return timeoutMessage(HOST, {
    image: { name: `hats_${id}.png`, data: await renderReveal(null, null) },
    staked: staked(game), balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId,
    line: pickRandom(TIMEOUT_LINES), // already "Henry: ..." / "Savannah: ..."
  });
}

module.exports = {
  games,
  staked,
  timeoutView,
  TIMEOUT_LINES,
  startGame,
  pickHat,
  renderShuffle,
  renderReveal,
  winnings,
  WIN_LINES,
  LOSE_LINES,
  BUTTON_ID,
  AGAIN_ID,
};
