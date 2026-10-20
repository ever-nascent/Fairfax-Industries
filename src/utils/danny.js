// Danny's Drop Zone, Deadman Danny's game: Connect Four on a 7 x 6 board of emoji (🔴 / 🟡, his colours). Against
// Danny (you're red and go first, he answers in the same message, looking a few moves ahead; a win pays 2x, a draw
// gives the bet back) or against a member (both stake the bet, the challenger is red and goes first, the winner
// takes the pot, a draw refunds both). Rules: server-plan.md ("Games").
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { getStore } = require('../storage');
const { fmt, soulsText, boldSouls } = require('./format');
const { pickRandom, randomInt } = require('./random');
const { ASSETS } = require('./art');
const { GREEN, RED, mention, pot, versusLine, resultFields, playAgainButton, gameMessage, timeoutMessage, forGame } = require('./casino');

const ART = path.join(ASSETS, 'danny'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0xe0a526, name: "Danny's Drop Zone", icon: path.join(ART, 'close_the_deal.png'), art: ART, prefix: 'danny' }; // his coat's yellow

const PAYOUT = 2; // a win against Danny pays 2x the bet (his call, Oct 20); a draw gives the bet back
const DEPTH = 6; // how many moves ahead Danny looks
const PVP = true; // casino.js: /mini-game accepts an opponent for this game
const BUTTON_ID = 'drop'; // custom id: drop:<game id>:<column 0-6|accept|decline>
const { takeBet, pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger
const AGAIN_ID = 'drop_again'; // custom id: drop_again:<bet>:<player id>[:<other player's id>]

const COLS = 7, ROWS = 6;
const PIECE = { r: '🔴', y: '🟡' };
const EMPTY = '⚫';
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
const DROPPED = '⬇️'; // over the column the last piece went into

// Danny: Fairfax Industries' star salesman, showy and reckless, flies a jetpack, has died and come back more times
// than he can count (deadlock.wiki). Original lines in that voice; one goes in the footer.
const START_LINES = [
  'Welcome to the Drop Zone! Four in a row and you walk away rich. Allegedly.',
  "Pick a column, friend. I'll be dropping in shortly. Literally.",
  'A Fairfax-certified game board! Mostly not on fire.',
  "Four in a row. I've done harder things while falling out of the sky.",
  'Step right up! First one to four closes the deal.',
];
// After Danny drops his piece.
const MOVE_LINES = [
  'Incoming! Watch your head.',
  'Bombs away! Well, pieces away.',
  'Your move, champ. No pressure. Some pressure.',
  'Ooh, I like where this is going. For me.',
  "I'd block that if I were you. Oh wait, I'm me.",
  "Coming in hot! Don't mind the scorch marks.",
];
// You won: Danny is hurt.
const WIN_LINES = [
  'You drive a hard bargain. Pleasure doing business.',
  'Ouch. That one went down in flames. Mine, not yours.',
  'Fine, fine! Tell your friends Danny pays out.',
  "I've crashed worse than this. Take your Souls.",
];
// You lost: Danny gloats.
const LOSE_LINES = [
  'And that, my friend, is how you close a deal!',
  'Four in a row! Fairfax Industries thanks you for your business!',
  'Never bet against a man with a jetpack.',
  "Splat! That's the sound of your Souls hitting my wallet.",
];
const DRAW_LINES = [
  "A full board and no winner? I'll call it a partnership.",
  "Stalemate! Take your Souls back, we'll call it even.",
];
// Member against member.
const DUEL_LINES = [
  'Deal closed! One winner, one valuable lesson.',
  'Shake hands, folks. Business is business.',
  'What a show! I should be selling tickets.',
];
// Called off before anyone moved: the Souls go back.
const TIMEOUT_LINES = [
  'The offer expired, friend. Your Souls are back.',
  "Silence? I'll take that as a no. Souls back.",
  "I don't wait around. I've got a jetpack and places to be.",
  "Deal's off. Come back when you're ready to buy.",
];
// Ran out of time mid-game: whoever had to move forfeits.
const FORFEIT_LINES = [
  'Took too long, pal. In my line of work, hesitation gets you splattered.',
  "Clock's out! A deal's a deal, and that one's closed.",
  'Froze up at the drop? Happens to rookies.',
];

// Games in progress, saved so a restart doesn't eat bets. key: game id
// { userId, name, bet, opponentId (null = Danny), opponentName, phase: 'invite' | 'play', board (42 chars, row 0 at
//   the bottom: '.' / 'r' / 'y'), turn ('r' | 'y'), last (column of the last drop), version, at }
// The challenger is always red ('r'); yellow is Danny or the opponent.
const games = () => getStore('dropGames');

const solo = (game) => !game.opponentId;
const started = (game) => game.board?.includes('r');
const staked = (game) => (!solo(game) && game.phase === 'play' ? game.bet * 2 : game.bet);
const refunds = (game) =>
  !solo(game) && game.phase === 'play' ? [[game.userId, game.bet], [game.opponentId, game.bet]] : [[game.userId, game.bet]];
const playerOf = (game, piece) => (piece === 'r' ? game.userId : game.opponentId);

// ---- the board ---------------------------------------------------------------------------------

const newBoard = () => '.'.repeat(COLS * ROWS);
const at = (board, col, row) => board[row * COLS + col];
// The row a piece dropped in `col` lands on, or -1 when the column is full.
const landing = (board, col) => {
  for (let row = 0; row < ROWS; row++) if (at(board, col, row) === '.') return row;
  return -1;
};
const legal = (board) => [...Array(COLS).keys()].filter((c) => landing(board, c) >= 0);
function drop(board, col, piece) {
  const row = landing(board, col);
  if (row < 0) return null;
  const i = row * COLS + col;
  return board.slice(0, i) + piece + board.slice(i + 1);
}

const LINES = [[1, 0], [0, 1], [1, 1], [1, -1]];
// Does the piece at (col, row) make four in a row?
function fourAt(board, col, row) {
  const piece = at(board, col, row);
  for (const [dc, dr] of LINES) {
    let n = 1;
    for (const s of [1, -1]) {
      for (let c = col + dc * s, r = row + dr * s; c >= 0 && c < COLS && r >= 0 && r < ROWS && at(board, c, r) === piece; c += dc * s, r += dr * s) n++;
    }
    if (n >= 4) return true;
  }
  return false;
}

// ---- Danny's move: negamax with alpha-beta, DEPTH moves ahead ------------------------------------

// Every run of four cells on the board, worked out once.
const WINDOWS = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    for (const [dc, dr] of LINES) {
      const cells = [0, 1, 2, 3].map((k) => [col + dc * k, row + dr * k]);
      if (cells.every(([c, r]) => c >= 0 && c < COLS && r >= 0 && r < ROWS)) WINDOWS.push(cells.map(([c, r]) => r * COLS + c));
    }
  }
}
// How good the board looks for `me`: open threes and twos, the centre column.
function evaluate(board, me) {
  const them = me === 'r' ? 'y' : 'r';
  let score = 0;
  for (let row = 0; row < ROWS; row++) score += (board[row * COLS + 3] === me) * 3 - (board[row * COLS + 3] === them) * 3;
  for (const w of WINDOWS) {
    let mine = 0, theirs = 0;
    for (const i of w) { if (board[i] === me) mine++; else if (board[i] === them) theirs++; }
    if (theirs === 0) score += mine === 3 ? 5 : mine === 2 ? 2 : 0;
    else if (mine === 0) score -= theirs === 3 ? 4 : theirs === 2 ? 2 : 0;
  }
  return score;
}
const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first, so alpha-beta cuts more
const WIN = 1_000_000;
function negamax(board, depth, alpha, beta, me) {
  const moves = ORDER.filter((c) => landing(board, c) >= 0);
  if (!moves.length) return 0;
  if (depth === 0) return evaluate(board, me);
  const them = me === 'r' ? 'y' : 'r';
  let best = -Infinity;
  for (const col of moves) {
    const row = landing(board, col);
    const next = drop(board, col, me);
    const score = fourAt(next, col, row) ? WIN + depth : -negamax(next, depth - 1, -beta, -alpha, them); // sooner wins score higher
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
// The column Danny plays as `me`; among equally good columns he picks at random.
function bestMove(board, me = 'y', depth = DEPTH, rnd = randomInt) {
  const them = me === 'r' ? 'y' : 'r';
  const scored = legal(board).map((col) => {
    const next = drop(board, col, me);
    return [col, fourAt(next, col, landing(board, col)) ? WIN + depth : -negamax(next, depth - 1, -Infinity, Infinity, them)];
  });
  const top = Math.max(...scored.map(([, s]) => s));
  return pickRandom(scored.filter(([, s]) => s === top).map(([c]) => c), rnd);
}

// Drops `piece` into `col` on a copy of the game: who won, a full board, whose turn is next.
function place(state, col, piece) {
  const row = landing(state.board, col);
  const board = drop(state.board, col, piece);
  const game = { ...state, board, last: col, turn: piece === 'r' ? 'y' : 'r', version: state.version + 1 };
  if (fourAt(board, col, row)) Object.assign(game, { done: true, winner: piece });
  else if (!board.includes('.')) Object.assign(game, { done: true, winner: null });
  return game;
}

// ---- messages ----------------------------------------------------------------------------------

// Every view but the invite clears the invite's @mention text.
const view = (message) => ({ ...gameMessage(HOST, message), content: '' });
const rematch = (game) => [`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary];

// The board as emoji rows, top row first, column numbers on top (an arrow over the last drop).
function boardText(game) {
  const head = KEYCAPS.map((k, c) => (c === game.last ? DROPPED : k)).join('');
  const rows = [];
  for (let row = ROWS - 1; row >= 0; row--) rows.push([...Array(COLS).keys()].map((c) => PIECE[at(game.board, c, row)] ?? EMPTY).join(''));
  return [head, ...rows].join('\n');
}
// Column buttons 1-7 in two rows (a full column greyed out).
const columnRows = (id, game) => {
  const button = (c) => [`${BUTTON_ID}:${id}:${c}`, `${c + 1}`, ButtonStyle.Secondary, { disabled: landing(game.board, c) < 0 }];
  return [[0, 1, 2, 3].map(button), [4, 5, 6].map(button)];
};
const sides = (game) => `${PIECE.r} ${mention(game.userId)}  vs  ${PIECE.y} ${solo(game) ? '**Danny**' : mention(game.opponentId)}`;

function soloView(id, game) {
  if (!game.done) {
    const lines = started(game)
      ? [sides(game), '', `Danny dropped into column **${game.last + 1}**.`, '', boardText(game), '', '**Your move.** Pick a column.']
      : [`${mention(game.userId)} bet ${boldSouls(game.bet)}.`, `You're ${PIECE.r}, Danny is ${PIECE.y}. Four in a row wins ${boldSouls(game.bet * PAYOUT)}, a draw gives the bet back.`, '', boardText(game), '', '**Your move.** Pick a column.'];
    return view({ lines, rows: columnRows(id, game), footer: `"${pickRandom(started(game) ? MOVE_LINES : START_LINES)}"` });
  }
  const outcome = game.winner === 'r' ? 1 : game.winner === 'y' ? -1 : 0;
  const won = outcome > 0 ? game.bet * PAYOUT : outcome === 0 ? game.bet : 0;
  const result = game.forfeit
    ? ['**You ran out of time. Danny takes it.**']
    : outcome > 0 ? [`**Four in a row! You win ${soulsText(won)}.**`]
      : outcome < 0 ? ['**Danny gets four in a row.**'] : ['**The board is full. A draw.**', `Your ${soulsText(game.bet)} came back.`];
  return view({
    lines: [sides(game), '', boardText(game), '', ...result],
    fields: resultFields(game.bet, won, game.balance),
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    footer: `"${pickRandom(game.forfeit ? FORFEIT_LINES : outcome > 0 ? WIN_LINES : outcome < 0 ? LOSE_LINES : DRAW_LINES)}"`,
    mood: outcome > 0 ? 'injured' : outcome < 0 ? 'gloat' : 'portrait', // he gloats when you lose, he's hurt when you win
    color: outcome > 0 ? GREEN : outcome < 0 ? RED : HOST.color,
  });
}

function inviteView(id, game) {
  const message = view({
    lines: [versusLine(game), `Pot if accepted: ${boldSouls(pot(game))}`, '', `${mention(game.opponentId)}, you have been challenged to the Drop Zone.`, '**Accept?**'],
    footer: '"A once in a lifetime offer! Well, twice. I keep coming back."',
    buttons: [[`${BUTTON_ID}:${id}:accept`, 'Accept', ButtonStyle.Success], [`${BUTTON_ID}:${id}:decline`, 'Decline', ButtonStyle.Danger]],
  });
  return { ...message, content: mention(game.opponentId) };
}

function duelView(id, game) {
  const top = [versusLine(game), `Pot: ${boldSouls(pot(game))}`, sides(game), '', boardText(game), ''];
  if (!game.done) {
    return view({
      lines: [...top, `${PIECE[game.turn]} **${mention(playerOf(game, game.turn))}'s move.**`],
      rows: columnRows(id, game),
      footer: `"${pickRandom(started(game) ? MOVE_LINES : START_LINES)}"`,
    });
  }
  const winner = game.winner && playerOf(game, game.winner);
  return view({
    lines: [
      ...top,
      ...(game.forfeit ? [`${mention(playerOf(game, game.forfeit))} ran out of time.`] : []),
      ...(winner ? [`${PIECE[game.winner]} ${mention(winner)} wins ${boldSouls(pot(game))}.`] : ['**The board is full. A draw.**', `Both get ${boldSouls(game.bet)} back.`]),
    ],
    buttons: [rematch(game)],
    footer: `"${pickRandom(game.forfeit ? FORFEIT_LINES : winner ? DUEL_LINES : DRAW_LINES)}"`,
    color: winner ? GREEN : HOST.color,
  });
}

// Takes the bet and opens a new game. Returns a message payload, or { error } if they can't play.
async function startGame(user, name, bet, opponent = null) {
  if (opponent?.bot) return { error: "Bots don't make deals. Pick a member, or leave the opponent empty to play Danny." };
  if (opponent?.id === user.id) return { error: "You can't play yourself. Pick another member, or leave it empty to play Danny." };
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({
    userId: user.id, name, bet, done: false, board: newBoard(), turn: 'r', last: null, version: 0,
    opponentId: opponent?.id ?? null, opponentName: opponent ? opponent.globalName ?? opponent.username : 'Danny',
    phase: opponent ? 'invite' : 'play',
  }));
  if (error) return { error };
  return opponent ? inviteView(id, game) : soloView(id, game);
}

// ---- button presses ----------------------------------------------------------------------------
// Each returns a message payload, { error } (shown only to the clicker) or null (stale click, ignore).

async function accept(id, userId) {
  const current = await games().get(id);
  if (!current || current.phase !== 'invite') return null;
  if (userId === current.userId) return { error: `Wait for ${current.opponentName} to answer.` };
  if (userId !== current.opponentId) return { error: `This challenge is for ${current.opponentName}.` };
  const error = await takeBet(userId, current.bet);
  if (error) return { error };
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.done || g.phase !== 'invite') return g; // called off while the bet was being taken
    game = { ...g, phase: 'play', at: Date.now() };
    return game;
  });
  if (!game) {
    await pay(userId, current.bet);
    return null;
  }
  return duelView(id, game);
}

async function decline(id, userId) {
  const current = await games().get(id);
  if (!current || current.phase !== 'invite') return null;
  if (userId !== current.opponentId) return { error: `Only ${current.opponentName} can turn this challenge down.` };
  const game = await games().take(id, (g) => g.phase === 'invite');
  if (!game) return null;
  await pay(game.userId, game.bet);
  return view({
    lines: [`${mention(game.opponentId)} turned down ${mention(game.userId)}'s challenge.`, `${boldSouls(game.bet)} went back to ${mention(game.userId)}.`],
    footer: '"No deal? Your loss, pal. Literally, nothing."',
    rows: [],
  });
}

// Pays out a finished game and removes it. Returns the challenger's balance.
async function settle(id, game) {
  await games().delete(id);
  if (solo(game)) {
    const won = game.winner === 'r' ? game.bet * PAYOUT : game.winner === null ? game.bet : 0;
    return (await pay(game.userId, won)).souls;
  }
  if (!game.winner) {
    await pay(game.opponentId, game.bet);
    return (await pay(game.userId, game.bet)).souls;
  }
  const [winner, loser] = game.winner === 'r' ? [game.userId, game.opponentId] : [game.opponentId, game.userId];
  await pay(winner, pot(game), loser);
  return null;
}

// A column button. Against Danny he answers in the same click. `dannyMove(board)` picks his column (tests fix it).
async function dropAt(id, userId, col, dannyMove = (board) => bestMove(board, 'y')) {
  const current = await games().get(id);
  if (!current || current.phase !== 'play' || current.done) return null;
  if (userId !== current.userId && userId !== current.opponentId) {
    return { error: solo(current) ? `That's ${current.name}'s game. Start your own with \`/mini-game\`.` : `This game is between ${current.name} and ${current.opponentName}.` };
  }
  if (userId !== playerOf(current, current.turn)) return { error: `It's ${current.turn === 'r' ? current.name : current.opponentName}'s move.` };
  if (!(col >= 0 && col < COLS) || landing(current.board, col) < 0) return null;
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.version !== current.version) return g; // someone clicked twice: only the first counts
    game = place(g, col, g.turn);
    if (solo(game) && !game.done) game = place(game, dannyMove(game.board), 'y');
    return game;
  });
  if (!game) return null;
  if (!game.done) return solo(game) ? soloView(id, game) : duelView(id, game);
  const balance = await settle(id, game);
  return solo(game) ? soloView(id, { ...game, balance }) : duelView(id, game);
}

const play = (id, userId, [action]) =>
  action === 'accept' ? accept(id, userId) : action === 'decline' ? decline(id, userId) : dropAt(id, userId, Number(action));

// Time ran out (casino.js expireGames). Once a piece has been dropped, whoever had to move forfeits: against Danny
// the bet is lost, between members the other one takes the pot. Before that nothing was decided: everything goes back.
function finishOnTimeout(id, state) {
  if (state.phase !== 'play' || !started(state)) return null;
  const game = { ...state, done: true, winner: state.turn === 'r' ? 'y' : 'r', forfeit: state.turn };
  if (solo(game)) return { pays: [[game.userId, 0]], view: (balance) => soloView(id, { ...game, balance }) };
  const [winner, loser] = [playerOf(game, game.winner), playerOf(game, game.forfeit)];
  return { pays: [[winner, pot(game), loser]], view: () => duelView(id, game) };
}

async function timeoutView(id, game, balance) {
  const line = `"${pickRandom(TIMEOUT_LINES)}"`;
  if (solo(game)) return { ...timeoutMessage(HOST, { staked: game.bet, balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId, line }), content: '' };
  if (game.phase === 'invite') {
    return view({
      lines: [`${mention(game.opponentId)} never answered ${mention(game.userId)}.`, `${boldSouls(game.bet)} went back to ${mention(game.userId)}.`],
      footer: line,
      rows: [],
      mood: 'gloat',
    });
  }
  return view({
    lines: [`${mention(game.userId)} never made the first move.`, `Both got ${boldSouls(game.bet)} back.`],
    footer: line,
    buttons: [rematch(game)],
    mood: 'gloat',
  });
}

module.exports = {
  games, staked, refunds, timeoutView, finishOnTimeout, startGame, play, dropAt,
  newBoard, drop, landing, fourAt, bestMove, place, boardText,
  PAYOUT, COLS, ROWS, START_LINES, MOVE_LINES, WIN_LINES, LOSE_LINES, DRAW_LINES, DUEL_LINES, TIMEOUT_LINES, FORFEIT_LINES,
  BUTTON_ID, AGAIN_ID, PVP,
};
