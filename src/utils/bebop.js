// Bebop's Bombs, Bebop's game (casino-style Mines): 20 tiles as emoji buttons, 4 hold sticky bombs. Every safe
// tile raises the prize, Cash Out any time after the first; a bomb loses the bet. Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { getStore } = require('../storage');
const { changeSouls } = require('./xp');
const { ensureEmoji } = require('./guild');
const { fmt, soulsIcon, soulsText, boldSouls } = require('./format');
const { pickRandom, shortId } = require('./random');
const { ASSETS } = require('./art');
const { takeBet, resultFields, playAgainButton, gameMessage, timeoutMessage } = require('./casino');

const ART = path.join(ASSETS, 'bebop'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0xd9822b, name: "Bebop's Bombs", icon: path.join(ART, 'sticky_bomb.png'), art: ART, prefix: 'bebop' }; // copper; Sticky Bomb

const TILES = 20; // 4 rows of 5 buttons (a message holds 5 rows; the 5th is Cash Out / Play Again)
const COLS = 5;
const BOMBS = 4;
const RTP = 0.95; // the prize is 95% of the fair odds of getting this far: the house's small cut
const BUTTON_ID = 'mines'; // custom id: mines:<game id>:<tile index|cash>
const AGAIN_ID = 'mines_again'; // custom id: mines_again:<bet>:<player id>
const HIDDEN = '❔';
const BOOM = '💥';
let bombEmoji = '💣'; // the server's :sticky_bomb: once uploaded (ensureBombEmoji)

// Bebop: a scrappy junkyard robot who talks like a Londoner, loves a fight and hates losing to organics
// (deadlock.wiki "Bebop/Voice lines"). Original lines in his voice; one goes in the footer.
const WIN_LINES = [
  "Didn' think you had the nerve to stop. Take your Souls, mate.",
  "Bloody hell, you walked away with it. Fine. FINE.",
  "Miss Shelly's gonna ask where those Souls went. I'm tellin' her you cheated.",
  'Lucky organic. Next time the bombs are goin\' under every tile.',
];
const LOSE_LINES = [
  "Boom! Didn' see that one comin', did ya?",
  "Stuck to ya like glue, that one. Hell of a feeling, innit?",
  "Nothin' you can do now, mate. Should've cashed out.",
  "Oh, that face! That's the best part of the job.",
];
// When the board is laid out.
const START_LINES = [
  "Right then, pick a tile. Any tile. Heh.",
  "Bombs are down, mate. Let's see how brave you are.",
  "Step lightly, organic. Or don't. Makes no difference to me.",
  "I've hidden a few surprises. Go on, have a look.",
];
// After a safe tile.
const SAFE_LINES = [
  "Lucky. Won't last.",
  "Oi, stop dodgin' me bombs!",
  "One more, go on. What's the worst that could happen?",
  "Still in one piece? Not for long.",
];
// When a game is called off for taking too long (he gloats).
const TIMEOUT_LINES = [
  'Oi! Pick a tile or get off me board.',
  "Took too long, mate. Bombs are goin' back in the box.",
  "Bored me half to scrap, you did. Game's off.",
  "Nobody stands this still in a minefield. 'Cept the dead ones.",
];

// Games in progress, saved so a bot restart doesn't eat anyone's bet. key: game id
const games = () => getStore('minesGames');

// ---- rules -------------------------------------------------------------------------------------

// What `safe` safe tiles in a row pay, as a multiple of the bet: 95% of the odds of surviving that many picks,
// rounded down to 2 decimals. 1 safe: x1.18, 2: x1.50, 3: x1.93 ... 16 (the whole board): x4,602.75.
function multiplier(safe) {
  let odds = 1;
  for (let i = 0; i < safe; i++) odds *= (TILES - i) / (TILES - BOMBS - i);
  return safe ? Math.floor(RTP * odds * 100 + 1e-6) / 100 : 1; // + 1e-6: float error mustn't round a cent away
}
const prizeFor = (bet, safe) => Math.floor(bet * multiplier(safe));

function placeBombs(randomInt = crypto.randomInt) {
  const bombs = new Set();
  while (bombs.size < BOMBS) bombs.add(randomInt(TILES));
  return [...bombs];
}

function moves(game) {
  if (game.done) return [];
  const list = [];
  for (let i = 0; i < TILES; i++) if (!game.picked.includes(i)) list.push(String(i));
  if (game.picked.length) list.push('cash');
  return list;
}

// Applies a move ('cash' or a tile index) to a copy of the game.
function play(state, move) {
  const game = structuredClone(state);
  if (move === 'cash') game.done = true;
  else {
    const tile = Number(move);
    if (game.bombs.includes(tile)) Object.assign(game, { done: true, lost: true, hit: tile });
    else {
      game.picked.push(tile);
      if (game.picked.length === TILES - BOMBS) game.done = true; // cleared the board: cashed out for them
    }
  }
  game.version++;
  return game;
}

// ---- messages ----------------------------------------------------------------------------------

// The board: 4 rows of 5 tiles. Picked tiles show souls; once it's over, the bombs show too.
function board(id, game) {
  const souls = soulsIcon().trim() || '💚';
  const rows = [];
  for (let r = 0; r < TILES / COLS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const customId = `${BUTTON_ID}:${id}:${i}`;
      if (game.picked.includes(i)) row.push([customId, null, ButtonStyle.Success, { emoji: souls, disabled: true }]);
      else if (game.done && i === game.hit) row.push([customId, null, ButtonStyle.Danger, { emoji: BOOM, disabled: true }]);
      else if (game.done && game.bombs.includes(i)) row.push([customId, null, ButtonStyle.Secondary, { emoji: bombEmoji, disabled: true }]);
      else row.push([customId, null, ButtonStyle.Secondary, { emoji: HIDDEN, disabled: game.done }]);
    }
    rows.push(row);
  }
  return rows;
}

function view(id, game) {
  const safe = game.picked.length;
  const prize = prizeFor(game.bet, safe);
  const rows = board(id, game);
  if (!game.done) {
    const lines = safe
      ? [`Safe! **${safe}** tile${safe === 1 ? '' : 's'} cleared.`, '**Keep going, or cash out?**']
      : [`<@${game.userId}> bet ${boldSouls(game.bet)}`, `Bebop hid **${BOMBS} Sticky Bombs** under **${TILES}** tiles!`];
    const fields = [['Bet', game.bet], ...(safe ? [['Prize', prize]] : []), ['Next Tile', prizeFor(game.bet, safe + 1)]];
    rows.push([[`${BUTTON_ID}:${id}:cash`, safe ? `Cash Out (${fmt(prize)})` : 'Cash Out', ButtonStyle.Success, { disabled: !safe }]]);
    return gameMessage(HOST, { lines, rows, fields, footer: `"${pickRandom(safe ? SAFE_LINES : START_LINES)}"` });
  }
  rows.push([playAgainButton(AGAIN_ID, game.bet, game.userId)]);
  if (game.lost) {
    return gameMessage(HOST, {
      lines: ['**Boom!** That tile was a Sticky Bomb.', `**You lose ${soulsText(game.bet)}.**`],
      rows,
      fields: resultFields(game.bet, 0, game.balance),
      footer: `"${pickRandom(LOSE_LINES)}"`,
      mood: 'gloat', // he gloats when you lose, he's hurt when you win
    });
  }
  const how = safe === TILES - BOMBS ? 'You cleared the whole board!' : `You cashed out after ${safe} safe tile${safe === 1 ? '' : 's'}.`;
  return gameMessage(HOST, {
    lines: [how, `**You win ${soulsText(prize)}.**`],
    rows,
    fields: resultFields(game.bet, prize, game.balance),
    footer: `"${pickRandom(WIN_LINES)}"`,
    mood: 'injured',
  });
}

// Takes the bet and hides the bombs. Returns a message payload, or { error }.
async function startGame(user, name, bet, bombs = placeBombs()) {
  const error = await takeBet(user.id, bet);
  if (error) return { error };
  const id = shortId();
  const game = { userId: user.id, name, bet, bombs, picked: [], done: false, lost: false, hit: null, version: 0, at: Date.now() };
  await games().set(id, game);
  return view(id, game);
}

// A button press. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
async function move(id, userId, action) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s board. Get your own with \`/mini-game\`.` };
  if (!moves(current).includes(action)) return null;
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.version !== current.version) return g; // someone clicked twice: only the first counts
    game = play(g, action);
    return game;
  });
  if (!game) return null;
  if (!game.done) return view(id, game);
  const user = await changeSouls(userId, game.lost ? 0 : prizeFor(game.bet, game.picked.length));
  await games().delete(id);
  return view(id, { ...game, balance: user.souls });
}

// Called off with no click for too long (casino.js expireGames): the bet back (a prize built up is lost).
const staked = (game) => game.bet;
async function timeoutView(id, game, balance) {
  return timeoutMessage(HOST, {
    staked: staked(game), balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId,
    line: `"${pickRandom(TIMEOUT_LINES)}"`,
  });
}

// On startup: his Sticky Bomb icon as the :sticky_bomb: emoji, shown on the bombs once a game is over.
async function ensureBombEmoji(guild) {
  bombEmoji = (await ensureEmoji(guild, 'sticky_bomb', path.join(ART, 'sticky_bomb.png'))).toString();
}

module.exports = {
  games,
  staked,
  timeoutView,
  startGame,
  move,
  moves,
  play,
  multiplier,
  prizeFor,
  placeBombs,
  ensureBombEmoji,
  WIN_LINES,
  LOSE_LINES,
  TIMEOUT_LINES,
  BUTTON_ID,
  AGAIN_ID,
  TILES,
  BOMBS,
};
