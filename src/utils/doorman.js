// /guess-the-door, the Doorman's game at The Baroness Hotel: three rooms, one holds the souls. Pick a room, the Doorman
// opens an empty one, then stay or switch. A win pays 1.5x the bet. Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getStore } = require('../storage');
const { soulsText, boldSouls } = require('./format');
const { pickRandom } = require('./random');
const { ASSETS, loadSouls, seeded, halftone, grain, grainAndVignette } = require('./art');
const { resultFields, playAgainButton, gameMessage, timeoutMessage, pay, openGame } = require('./casino');

const ART = path.join(ASSETS, 'doorman'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0x8c1d24, name: 'The Baroness Hotel', icon: path.join(ART, 'hotel_guest.png'), art: ART, prefix: 'doorman' }; // burgundy; his ult icon

const PAYOUT = 1.5;
const BUTTON_ID = 'doorman'; // custom id: doorman:<game id>:<pick|stay|switch>[:<room index>]
const AGAIN_ID = 'doorman_again'; // custom id: doorman_again:<bet>:<player id>
const ROOMS = [101, 102, 103];
// The Doorman's lines when the game ends: original lines written in his voice (a flawless hotel servant
// on top, a smug god underneath; see deadlock.wiki "The Doorman/Voice lines"). One random line goes in the footer.
const WIN_LINES = [
  'How splendid. The Baroness rewards even the luckiest of mortals.',
  'Congratulations. The Baroness shall have your winnings sent up at once.',
  "Your Souls, with the Baroness's compliments. Do visit again soon.",
  'Well chosen. The Baroness does so enjoy a lucky guest.',
];
const LOSE_LINES = [
  "[Laughter] Wrong door, I'm afraid. Do enjoy your stay at the Baroness.",
  'No need to tip. The Baroness has taken the liberty.',
  'Your Souls will be well looked after at the Baroness. You have my word.',
  'Such a pity. Still, the Baroness thanks you for your patronage.',
];
// When the game starts (checking the guest in).
const START_LINES = [
  'Welcome to the Baroness. Your room awaits, one of them, at least.',
  'Right this way. Mind the doors; they have a mind of their own.',
  'Checking in? Splendid. The Baroness has been expecting you.',
  'Three rooms, one fortune. The Baroness does love a guessing game.',
];
// After the pick, when he offers the switch (he knows where the souls are).
const PICK_LINES = [
  'I would never steer a guest wrong. Probably.',
  'Take your time. The Baroness has all of eternity.',
  'A change of room can be arranged, for our most valued guests.',
  'Are you quite sure about that room? I only ask out of courtesy.',
];
// When a game is called off for taking too long (he gloats).
const TIMEOUT_LINES = [
  "Checkout time, I'm afraid. The Baroness waits for no guest.",
  'Your room has been released. Do try to be punctual next time.',
  'Late checkout is reserved for our more decisive guests.',
  'The Baroness does not hold rooms forever. Your Souls are returned, with regret.',
];

// Games in progress, saved so a bot restart doesn't eat anyone's bet. key: game id
const games = () => getStore('doormanGames');

// The empty room the Doorman opens: not the player's pick, not the prize.
function roomToOpen(prize, pick, random = Math.random) {
  const options = [0, 1, 2].filter((i) => i !== prize && i !== pick);
  return options[Math.floor(random() * options.length)];
}
const otherRoom = (pick, opened) => 3 - pick - opened;
const winnings = (bet) => Math.floor(bet * PAYOUT);

// ---- image -------------------------------------------------------------------------------------

const W = 600, H = 340;
const DH = 190, DW = Math.round(DH * (999 / 1325)), GAP = 50, DY = 92;
const X0 = (W - (DW * 3 + GAP * 2)) / 2;
const GOLD = '#e0b560';

let art;
async function loadArt() {
  art ??= {
    door: await loadImage(path.join(ART, 'door.png')),
    void: await loadImage(path.join(ART, 'void.png')),
    souls: await loadSouls(),
  };
  return art;
}

function spray(g, rnd, x, y, w, h, n, color, max) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.6;
    g.beginPath();
    g.arc(x + rnd() * w, y + rnd() * h, rnd() * max, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
}

// The Baroness Hotel corridor: green wallpaper, brass wall lamps, wood panelling, carpet runner.
// Halftone shading and grain keep the Deadlock hero-art look.
let background;
function drawBackground() {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = seeded(7);
  const FLOOR = DY + DH; // floor line
  const RAIL = FLOOR - 62; // chair rail / top of the wood panelling

  // wallpaper: stripes + small art-deco diamond motif
  g.fillStyle = '#16332c';
  g.fillRect(0, 0, W, FLOOR);
  for (let x = 0; x < W; x += 24) {
    g.fillStyle = '#1c3d35';
    g.fillRect(x, 0, 12, RAIL);
  }
  g.fillStyle = 'rgba(224,181,96,0.16)';
  for (let y = 30, row = 0; y < RAIL; y += 26, row++) {
    for (let x = row % 2 ? 12 : 0; x < W; x += 24) {
      g.beginPath();
      g.moveTo(x + 6, y - 5);
      g.lineTo(x + 10, y);
      g.lineTo(x + 6, y + 5);
      g.lineTo(x + 2, y);
      g.fill();
    }
  }

  // warm light pools from the wall lamps (between and beside the doors)
  const lamps = [X0 - GAP / 2 - 4, ...[1, 2].map((i) => X0 + i * (DW + GAP) - GAP / 2), X0 + 3 * (DW + GAP) - GAP / 2 + 4];
  for (const lx of lamps) {
    const pool = g.createRadialGradient(lx, 120, 4, lx, 130, 150);
    pool.addColorStop(0, 'rgba(255,205,130,0.55)');
    pool.addColorStop(0.35, 'rgba(255,205,130,0.18)');
    pool.addColorStop(1, 'rgba(255,205,130,0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, W, FLOOR);
  }

  // crown moulding
  const crown = g.createLinearGradient(0, 0, 0, 22);
  crown.addColorStop(0, '#1a0c08');
  crown.addColorStop(1, '#3b1d12');
  g.fillStyle = crown;
  g.fillRect(0, 0, W, 22);
  g.fillStyle = GOLD;
  g.fillRect(0, 22, W, 2);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 24, W, 6);

  // dark wood panelling below the chair rail
  const wood = g.createLinearGradient(0, RAIL, 0, FLOOR);
  wood.addColorStop(0, '#3a1a12');
  wood.addColorStop(1, '#1e0c08');
  g.fillStyle = wood;
  g.fillRect(0, RAIL, W, FLOOR - RAIL);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  for (let x = 8; x < W; x += 58) g.strokeRect(x, RAIL + 12, 46, FLOOR - RAIL - 22);
  g.strokeStyle = 'rgba(255,190,120,0.12)';
  g.lineWidth = 1;
  for (let x = 8; x < W; x += 58) {
    g.beginPath();
    g.moveTo(x, RAIL + 12 + FLOOR - RAIL - 22);
    g.lineTo(x, RAIL + 12);
    g.lineTo(x + 46, RAIL + 12);
    g.stroke();
  }
  g.fillStyle = '#4a2416';
  g.fillRect(0, RAIL - 4, W, 8); // chair rail
  g.fillStyle = GOLD;
  g.fillRect(0, RAIL - 4, W, 2);

  // halftone shadow creeping down the wall (Deadlock texture)
  halftone(g, 0, 30, W, RAIL - 30, 7, (u, v) => Math.max(0, v * 0.5 - 0.2 + Math.abs(u - 0.5) * 0.6), 'rgba(0,0,0,0.35)');

  // recessed door frames: soft shadow on the wall around each door
  for (let i = 0; i < 3; i++) {
    const x = X0 + i * (DW + GAP);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.75)';
    g.shadowBlur = 16;
    g.fillStyle = '#000';
    g.fillRect(x - 9, DY - 9, DW + 18, DH + 9);
    g.restore();
  }

  // wall lamps: brass plate, arm, glowing glass chimney
  for (const lx of lamps) {
    const y = 104;
    g.fillStyle = '#8a6a34';
    g.beginPath();
    g.roundRect(lx - 5, y + 10, 10, 26, 3);
    g.fill();
    g.strokeStyle = '#b8914a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(lx, y + 26);
    g.quadraticCurveTo(lx + 9, y + 24, lx, y + 12);
    g.stroke();
    g.save();
    g.shadowColor = 'rgba(255,220,160,1)';
    g.shadowBlur = 22;
    const glass = g.createLinearGradient(lx - 5, 0, lx + 5, 0);
    glass.addColorStop(0, '#fff3d8');
    glass.addColorStop(0.5, '#ffffff');
    glass.addColorStop(1, '#f5dcae');
    g.fillStyle = glass;
    g.beginPath();
    g.moveTo(lx - 3, y - 14);
    g.lineTo(lx + 3, y - 14);
    g.quadraticCurveTo(lx + 7, y, lx + 5, y + 10);
    g.lineTo(lx - 5, y + 10);
    g.quadraticCurveTo(lx - 7, y, lx - 3, y - 14);
    g.fill();
    g.restore();
  }

  // floor: dark boards with a burgundy carpet runner and gold border
  g.fillStyle = '#140906';
  g.fillRect(0, FLOOR, W, H - FLOOR);
  const runner = g.createLinearGradient(0, FLOOR, 0, H);
  runner.addColorStop(0, '#5a1519');
  runner.addColorStop(1, '#2c0a0c');
  g.fillStyle = runner;
  g.beginPath();
  g.moveTo(40, FLOOR + 6);
  g.lineTo(W - 40, FLOOR + 6);
  g.lineTo(W + 20, H);
  g.lineTo(-20, H);
  g.fill();
  g.strokeStyle = GOLD;
  g.globalAlpha = 0.6;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(50, FLOOR + 10);
  g.lineTo(W - 50, FLOOR + 10);
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(224,181,96,0.25)';
  for (let x = 70; x < W - 60; x += 30) {
    g.beginPath();
    g.moveTo(x, FLOOR + 22);
    g.lineTo(x + 6, FLOOR + 28);
    g.lineTo(x, FLOOR + 34);
    g.lineTo(x - 6, FLOOR + 28);
    g.fill();
  }
  halftone(g, 0, FLOOR, W, H - FLOOR, 6, (u, v) => Math.max(0, v * 0.9 - 0.1), 'rgba(0,0,0,0.5)');
  spray(g, rnd, 0, RAIL, W, H - RAIL, 260, '#000', 1.4);
  return c;
}

let grainTexture;

// rooms: [{ open, prize, mine }] -> PNG buffer
async function renderRooms(rooms) {
  const { door, void: voidArt, souls } = await loadArt();
  background ??= drawBackground();
  grainTexture ??= grain(W, H, 11, 52);
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(background, 0, 0);

  rooms.forEach((room, i) => {
    const x = X0 + i * (DW + GAP);
    // brass plaque on the wall
    g.fillStyle = GOLD;
    g.beginPath();
    g.roundRect(x + DW / 2 - 26, DY - 42, 52, 24, 4);
    g.fill();
    g.fillStyle = '#2a110b';
    g.font = '18px Retail';
    g.textAlign = 'center';
    g.fillText(String(ROOMS[i]), x + DW / 2, DY - 23);
    // the Doorman's double door (its frame stays when the room is open)
    g.drawImage(door, x - 9, DY - 9, DW + 18, DH + 9);
    g.save();
    g.beginPath();
    if (room.open) g.rect(x, DY, DW, DH); // inside the frame
    else g.rect(x - 9, DY - 9, DW + 18, DH + 9);
    g.clip();
    if (!room.open) {
      halftone(g, x - 9, DY - 9, DW + 18, DH + 9, 5, (u, v) => Math.max(0, v * 1.1 - 0.55 - u * 0.3), 'rgba(10,3,3,0.55)');
    } else {
      // inside: the Baroness Hotel void, both leaves swung inward
      g.drawImage(voidArt, x - 30, DY - 10, DW + 60, DH + 20);
      halftone(g, x, DY, DW, DH, 6, (u, v) => Math.max(0, v * 1.2 - 0.5), 'rgba(10,5,15,0.6)');
      if (room.prize) {
        const cx = x + DW / 2;
        const cy = DY + DH / 2;
        const glow = g.createRadialGradient(cx, cy, 4, cx, cy, 80);
        glow.addColorStop(0, 'rgba(124,255,196,0.7)');
        glow.addColorStop(1, 'rgba(124,255,196,0)');
        g.fillStyle = glow;
        g.fillRect(x, DY, DW, DH);
        const w = 44;
        const h = w * (souls.height / souls.width);
        g.shadowColor = '#7cffc4';
        g.shadowBlur = 18;
        g.drawImage(souls, cx - w / 2, cy - h / 2, w, h);
        g.shadowBlur = 0;
      } else {
        g.fillStyle = 'rgba(10,5,20,0.35)';
        g.fillRect(x, DY, DW, DH);
      }
      const fx = 46; // frame thickness in the door art, at its original 999 px width
      const k = door.width / 999;
      for (const [sx, dx] of [[fx, x], [499, x + DW - 18]]) {
        g.drawImage(door, sx * k, fx * k, 453 * k, door.height - fx * k, dx, DY + 6, 18, DH - 12);
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(dx, DY + 6, 18, DH - 12);
      }
    }
    g.restore();
    if (room.mine) {
      g.fillStyle = GOLD;
      g.font = '15px Retail';
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 4;
      g.fillText('YOUR ROOM', x + DW / 2, DY + DH + 24);
      g.shadowBlur = 0;
    }
  });

  grainAndVignette(g, W, H, grainTexture, { grainAlpha: 0.55, inner: 150, outer: 380, dark: 0.6 });
  return c.toBuffer('image/png');
}

// ---- messages ----------------------------------------------------------------------------------

// The game is the Doorman's, not the Shopkeeper's. His face once the game is over: he gloats when you lose,
// he's hurt when you win.
async function view({ id, rooms, ...message }) {
  // a new name each step so Discord doesn't reuse the old image
  return gameMessage(HOST, { ...message, image: { name: `rooms_${id}_${Date.now()}.png`, data: await renderRooms(rooms) } });
}

// Takes the bet and opens a new game. Returns a message payload, or { error } if they can't play.
async function startGame(user, name, bet) {
  const { error, id } = await openGame(games(), user.id, bet, () => ({ userId: user.id, name, bet, prize: crypto.randomInt(3), pick: null, opened: null, done: false }));
  if (error) return { error };
  return view({
    id,
    rooms: ROOMS.map(() => ({})),
    lines: [`${name} booked a room for ${boldSouls(bet)}.`, '**One of these rooms contain the Souls.**', '**Go on and pick a door.**'],
    buttons: ROOMS.map((n, i) => [`${BUTTON_ID}:${id}:pick:${i}`, `Room ${n}`, ButtonStyle.Secondary]),
    footer: `"${pickRandom(START_LINES)}"`,
  });
}

// Room picked: the Doorman opens an empty room and offers the switch.
function pickView(id, game) {
  const other = otherRoom(game.pick, game.opened);
  return view({
    id,
    rooms: ROOMS.map((_, i) => ({ open: i === game.opened, mine: i === game.pick })),
    lines: [
      `You picked Room ${ROOMS[game.pick]}.`,
      `The Doorman opens Room ${ROOMS[game.opened]}: empty.`,
      `**Stay in ${ROOMS[game.pick]}, or switch to ${ROOMS[other]}?**`,
    ],
    footer: `"${pickRandom(PICK_LINES)}"`,
    buttons: [
      [`${BUTTON_ID}:${id}:stay`, `Stay (${ROOMS[game.pick]})`, ButtonStyle.Secondary],
      [`${BUTTON_ID}:${id}:switch`, `Switch (${ROOMS[other]})`, ButtonStyle.Primary],
    ],
  });
}

// Every door opens.
function resultView(id, game, final, won, balance) {
  const verb = final === game.pick ? `You stayed in Room ${ROOMS[final]}...` : `You switched to Room ${ROOMS[final]}...`;
  const outcome = won
    ? ['The Souls were inside!', `**You win ${soulsText(winnings(game.bet))}.**`]
    : ['Empty.', `**The Souls were in Room ${ROOMS[game.prize]}.**`];
  return view({
    id,
    rooms: ROOMS.map((_, i) => ({ open: true, prize: i === game.prize, mine: i === final })),
    lines: [verb, ...outcome],
    fields: resultFields(game.bet, won ? winnings(game.bet) : 0, balance),
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    footer: `"${pickRandom(won ? WIN_LINES : LOSE_LINES)}"`,
    mood: won ? 'injured' : 'gloat',
  });
}

// ---- button presses ----------------------------------------------------------------------------
// Each returns a message payload, { error } (shown only to the clicker), or null (stale click, ignore).

const notYours = (game) => ({ error: `That's ${game.name}'s room. Book your own with \`/mini-game\`.` });

async function pickRoom(id, userId, index) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return notYours(current);
  let picked = null;
  await games().update(id, (game) => {
    if (!game || game.pick !== null) return game; // already picked (double click)
    picked = { ...game, pick: index, opened: roomToOpen(game.prize, index) };
    return picked;
  });
  return picked && pickView(id, picked);
}

async function finishGame(id, userId, choice) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return notYours(current);
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.pick === null || g.done) return g; // only the first click pays
    game = { ...g, done: true };
    return game;
  });
  if (!game) return null;
  const final = choice === 'switch' ? otherRoom(game.pick, game.opened) : game.pick;
  const won = final === game.prize;
  const user = await pay(userId, won ? winnings(game.bet) : 0);
  await games().delete(id);
  return resultView(id, game, final, won, user.souls);
}

// Called off with no click for too long (casino.js expireGames): the rooms as they were, the bet back.
const staked = (game) => game.bet;
async function timeoutView(id, game, balance) {
  const rooms = ROOMS.map((_, i) => ({ open: i === game.opened, mine: i === game.pick }));
  return timeoutMessage(HOST, {
    image: { name: `rooms_${id}_${Date.now()}.png`, data: await renderRooms(rooms) },
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
  pickRoom,
  finishGame,
  renderRooms,
  roomToOpen,
  otherRoom,
  winnings,
  WIN_LINES,
  LOSE_LINES,
  BUTTON_ID,
  AGAIN_ID,
};
