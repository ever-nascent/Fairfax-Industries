// Pocket's Suitcases, Pocket's game (Deal or No Deal): 20 cases in a 4x5 grid of buttons, each holding a multiple of
// the bet. Keep one, open the rest in rounds, take Pocket's offer (Deal) or say No Deal. Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { getStore } = require('../storage');
const { changeSouls } = require('./xp');
const { fmt, soulsIcon, soulsText, boldSouls } = require('./format');
const { pickRandom, shuffle, shortId } = require('./random');
const { ASSETS } = require('./art');
const { takeBet, resultFields, playAgainButton, gameMessage, timeoutMessage } = require('./casino');

const ART = path.join(ASSETS, 'pocket'); // portraits from the deadlock-api.com assets API ("synth"), icon from deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0xf46f0b, name: "Pocket's Suitcases", icon: path.join(ART, 'satchel.png'), art: ART, prefix: 'pocket' }; // orange; Enchanter's Satchel

const CASES = 20; // 4 rows of 5 buttons (a message holds 5 rows; the 5th is Deal / No Deal, Keep / Swap or Play Again)
const COLS = 5;
// What each case can hold, as a multiple of the bet. They average exactly 0.95, so never taking a deal returns 95%.
const VALUES = [0.05, 0.05, 0.1, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8, 1, 1.25, 1.5, 2, 2.5, 6];
// Cases to open before each offer: 18 in all, so two are left (yours and one other) for Keep / Swap.
const ROUNDS = [5, 4, 3, 3, 2, 1];
// Pocket offers this share of what is left on average, so any deal pays a little less than playing on.
const OFFER_SHARE = [0.55, 0.65, 0.75, 0.82, 0.88, 0.94];
const BUTTON_ID = 'suitcase'; // custom id: suitcase:<game id>:<case index|deal|nodeal|keep|swap>
const AGAIN_ID = 'suitcase_again'; // custom id: suitcase_again:<bet>:<player id>

// Pocket: Fairfax's son, on the run with a suitcase that is full of surprises. Polite, anxious, a little dry and
// sorry about what he does to you (deadlock.wiki "Pocket/Voice lines"). Original lines in his voice; one goes in the footer.
// {name} is the player's name. Lines are picked by what just happened (see `footerFor` and the result view).
const PICK_LINES = [
  "Please choose carefully, {name}. I've, um, grown attached to all of them.",
  "Pick whichever one calls to you, {name}.",
  "My father packed these himself. That should worry you.",
  "Twenty cases, {name}. Some of them are holding a grudge.",
];
const OPEN_LINES = [
  "Go on. It won't bite. Probably.",
  "Keep going, {name}. I'll just stand back here...",
  "Oh, that one. I forgot what I put in that one.",
];
const BIG_LOSS_LINES = [
  "That one hurt me too, and I'm not even the one betting.",
  "I'm sorry, {name}. I wish it didn't have to go this way.",
  "That was a good one. The spirits did that, not me.",
  "I hate that I saw that coming.",
];
const SMALL_LOSS_LINES = [
  "Not much in that one. Every soul counts, though.",
  "Small one, {name}. You make your own luck.",
  "Barely anything in there. Consider yourself spared.",
  "That one was never going to hurt you. This time.",
];
const LOW_OFFER_LINES = [
  "It's not much, {name}. New York's expensive, and I know it.",
  "I wish I could offer more. I'm sorry.",
  "Take it or don't. Either way, I understand.",
  "That's the best I can do with what's left in there.",
];
const OFFER_LINES = [
  "Here's my offer, {name}. Think it over.",
  "It's fair, I think. I don't like haggling.",
  "Pays to plan ahead. Take it, or don't.",
  "That's what the case is worth to me right now.",
];
const GOOD_OFFER_LINES = [
  "That's more than you put in, {name}. Take it. Please.",
  "Any sensible person would walk away ahead.",
  "I shouldn't be this generous. Every soul counts.",
  "Take the win, {name}. You make your own luck.",
];
const FINAL_LINES = [
  "Two cases left, {name}. Whichever you choose, I'm sorry.",
  "Keep or swap? I've seen both go wrong.",
  "It's you and the case now. Trust your gut.",
  "You can still change your mind. That's rare in my family.",
];
const WIN_LINES = [
  "Well played, {name}. You earned that.",
  "You beat the case. Not many can say that.",
  "Good luck spending it, {name}. New York's expensive.",
  "Congratulations. I mean it.",
];
const BIG_WIN_LINES = [
  "{name}, that's a lot. My father would have made a face.",
  "That case gave up more than I thought. I'm... impressed.",
  "I make my own luck, and you just made more.",
  "Take it, {name}. Just don't tell my father where it came from.",
];
const LOSE_LINES = [
  "I'm so sorry, {name}. It wasn't personal.",
  "I wish it didn't have to go this way.",
  "The case took more than it gave. It does that.",
  "Sorry. I hate that I'm getting good at this.",
];
const GOOD_DEAL_LINES = [
  "Smart, {name}. You left before it got worse.",
  "That's a sensible deal. My father would never take one.",
  "You walked away ahead. Well done.",
];
const BAD_DEAL_LINES = [
  "Your case was worth more, {name}. I wish I'd been able to tell you.",
  "You took the deal, and the case had more. I'm sorry.",
  "That's the risk with a deal. I hate that it's me saying it.",
];
// When a game is called off for taking too long.
const TIMEOUT_LINES = [
  "I can't keep the case open forever, {name}. Maybe next time.",
  "Still there? I'll close it up, then.",
  "No hurry... well, a little hurry.",
  "We'll try again. I'm not going anywhere. Not without this case.",
];

// Games in progress, saved so a bot restart doesn't eat anyone's bet. key: game id
const games = () => getStore('pocketGames');

// What Pocket says after a case opens: sorry for a big one, relieved for a small one.
function openLines(game) {
  const held = game.last === null ? 1 : game.values[game.last];
  return held >= 1.5 ? BIG_LOSS_LINES : held <= 0.2 && game.last !== null ? SMALL_LOSS_LINES : OPEN_LINES;
}
// The end: a deal is judged against the case you were holding, a kept or swapped case by its prize.
function resultLines(game, won) {
  if (game.how === 'deal') return game.prize >= amount(game.bet, game.values[game.mine]) ? GOOD_DEAL_LINES : BAD_DEAL_LINES;
  if (game.prize >= game.bet * 2) return BIG_WIN_LINES;
  return won ? WIN_LINES : LOSE_LINES;
}
const times = (mult) => `${soulsIcon()}×${mult}`;
const say = (lines, game) => pickRandom(lines).replaceAll('{name}', game.name);
const biggestLeft = (game) => Math.max(...unopened(game).map((i) => game.values[i]));

// ---- rules -------------------------------------------------------------------------------------

const amount = (bet, mult) => Math.floor(bet * mult);
const shuffled = (randomInt = crypto.randomInt) => shuffle(VALUES, randomInt);
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

// Cases nobody has opened yet (yours included).
const unopened = (game) => game.values.map((_, i) => i).filter((i) => !game.opened.includes(i));
const offerFor = (game) => amount(game.bet, mean(unopened(game).map((i) => game.values[i])) * OFFER_SHARE[game.round]);
// The one other case left once every round is done.
const lastCase = (game) => unopened(game).find((i) => i !== game.mine);

function moves(game) {
  if (game.done) return [];
  if (game.phase === 'offer') return ['deal', 'nodeal'];
  if (game.phase === 'final') return ['keep', 'swap'];
  return unopened(game).filter((i) => game.phase === 'pick' || i !== game.mine).map(String);
}

// Pays what the game ended on: the case's value, or the deal.
function finish(game, prize, how) {
  return Object.assign(game, { done: true, phase: 'done', prize, how });
}

// Applies a move to a copy of the game.
function play(state, move) {
  const game = structuredClone(state);
  if (game.phase === 'pick') {
    game.mine = Number(move);
    game.phase = 'open';
    game.toOpen = ROUNDS[0];
    game.last = null;
  } else if (game.phase === 'open') {
    const i = Number(move);
    game.opened.push(i);
    game.last = i;
    if (--game.toOpen === 0) {
      game.phase = 'offer';
      game.offer = offerFor(game);
    }
  } else if (game.phase === 'offer') {
    if (move === 'deal') finish(game, game.offer, 'deal');
    else if (game.round === ROUNDS.length - 1) game.phase = 'final';
    else {
      game.round++;
      game.phase = 'open';
      game.toOpen = ROUNDS[game.round];
      game.last = null;
    }
  } else if (game.phase === 'final') {
    finish(game, amount(game.bet, game.values[move === 'keep' ? game.mine : lastCase(game)]), move);
  }
  game.version++;
  return game;
}

// ---- messages ----------------------------------------------------------------------------------

// The board: 4 rows of 5 cases. Yours is blue, opened ones show what they held (red = a big prize gone), and once it's over every case shows.
function board(id, game, frozen) {
  const rows = [];
  for (let r = 0; r < CASES / COLS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const customId = `${BUTTON_ID}:${id}:${i}`;
      const value = `×${game.values[i]}`;
      if (i === game.mine && !game.done) row.push([customId, String(i + 1), ButtonStyle.Primary, { emoji: '💼', disabled: true }]);
      else if (game.opened.includes(i) || game.done) {
        const kept = game.done && i === game.mine;
        row.push([customId, value, kept ? ButtonStyle.Primary : game.values[i] >= 1 ? ButtonStyle.Danger : ButtonStyle.Success, { emoji: kept ? '💼' : undefined, disabled: true }]);
      } else row.push([customId, null, ButtonStyle.Secondary, { emoji: '💼', disabled: frozen }]);
    }
    rows.push(row);
  }
  return rows;
}

function view(id, game) {
  const board20 = (frozen) => board(id, game, frozen);
  const mine = `Your Case: **#${game.mine + 1}**`;
  const big = () => `> Biggest Prize Left: **${game.opened.some((i) => game.values[i] === Math.max(...game.values)) ? '???' : times(biggestLeft(game))}**`; // once the top prize is gone, it isn't revealed
  if (game.phase === 'pick') {
    return gameMessage(HOST, {
      lines: [`<@${game.userId}> Bet ${boldSouls(game.bet)}`, 'Pocket Has **20 Suitcases**. Pick One To Keep.'],
      rows: board20(false),
      fields: [['Bet', game.bet]],
      footer: `"${say(PICK_LINES, game)}"`,
    });
  }
  if (game.phase === 'open') {
    const last = game.last === null ? [] : [`> That Case Held **${times(game.values[game.last])}**.`];
    return gameMessage(HOST, {
      lines: [mine, big(), ...last, `Open **${game.toOpen}** More Case${game.toOpen === 1 ? '' : 's'}.`],
      rows: board20(false),
      fields: [['Bet', game.bet]],
      footer: `"${say(openLines(game), game)}"`,
    });
  }
  if (game.phase === 'offer') {
    const rows = board20(true);
    rows.push([
      [`${BUTTON_ID}:${id}:deal`, `Deal (${fmt(game.offer)})`, ButtonStyle.Success],
      [`${BUTTON_ID}:${id}:nodeal`, 'No Deal', ButtonStyle.Danger],
    ]);
    return gameMessage(HOST, {
      lines: [mine, big(), `> That Case Held **${times(game.values[game.last])}**.`, `Pocket Offers **${soulsText(game.offer)}**. **Deal Or No Deal?**`],
      rows,
      fields: [['Bet', game.bet], ['Offer', game.offer]],
      footer: `"${say(game.offer >= game.bet ? GOOD_OFFER_LINES : game.offer >= game.bet * 0.6 ? OFFER_LINES : LOW_OFFER_LINES, game)}"`,
    });
  }
  if (game.phase === 'final') {
    const rows = board20(true);
    rows.push([
      [`${BUTTON_ID}:${id}:keep`, 'Keep My Case', ButtonStyle.Primary],
      [`${BUTTON_ID}:${id}:swap`, 'Swap Cases', ButtonStyle.Secondary],
    ]);
    return gameMessage(HOST, {
      lines: [mine, big(), 'Two Cases Left: Yours And The Last One On The Board.', '**Keep Yours, Or Swap?**'],
      rows,
      fields: [['Bet', game.bet]],
      footer: `"${say(FINAL_LINES, game)}"`,
    });
  }
  const rows = board20(true);
  rows.push([playAgainButton(AGAIN_ID, game.bet, game.userId)]);
  const won = game.prize >= game.bet;
  const owned = amount(game.bet, game.values[game.mine]);
  const lines = game.how === 'deal'
    ? ['You Took The Deal.', `Your Case Held **${soulsText(owned)}**.`]
    : game.how === 'swap'
      ? ['You Swapped.', `The Other Case Held **${soulsText(game.prize)}**.`, `Your Old Case Held **${soulsText(owned)}**.`]
      : ['You Kept Your Case.', `It Held **${soulsText(game.prize)}**.`];
  lines.push(game.prize > game.bet ? `**You Win ${soulsText(game.prize)}.**` : `**You Get ${soulsText(game.prize)}.**`);
  return gameMessage(HOST, {
    lines,
    rows,
    fields: resultFields(game.bet, game.prize, game.balance),
    footer: `"${say(resultLines(game, won), game)}"`,
    mood: won ? 'injured' : 'gloat', // he gloats when you lose, he's hurt when you win
  });
}

// Takes the bet and packs the cases. Returns a message payload, or { error }.
async function startGame(user, name, bet, values = shuffled()) {
  const error = await takeBet(user.id, bet);
  if (error) return { error };
  const id = shortId();
  const game = {
    userId: user.id, name, bet, values, mine: null, opened: [], round: 0, phase: 'pick', toOpen: 0,
    offer: 0, last: null, done: false, prize: 0, how: null, version: 0, at: Date.now(),
  };
  await games().set(id, game);
  return view(id, game);
}

// A button press. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
async function move(id, userId, action) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s suitcase. Get your own with \`/mini-game\`.` };
  if (!moves(current).includes(action)) return null;
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.version !== current.version) return g; // someone clicked twice: only the first counts
    game = play(g, action);
    return game;
  });
  if (!game) return null;
  if (!game.done) return view(id, game);
  const user = await changeSouls(userId, game.prize);
  await games().delete(id);
  return view(id, { ...game, balance: user.souls });
}

// Called off with no click for too long (casino.js expireGames): the whole bet back.
const staked = (game) => game.bet;
async function timeoutView(id, game, balance) {
  return timeoutMessage(HOST, {
    staked: staked(game), balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId,
    line: `"${say(TIMEOUT_LINES, game)}"`,
  });
}

module.exports = {
  games,
  staked,
  timeoutView,
  startGame,
  move,
  moves,
  play,
  offerFor,
  lastCase,
  amount,
  VALUES,
  ROUNDS,
  OFFER_SHARE,
  WIN_LINES,
  LOSE_LINES,
  OFFER_LINES,
  TIMEOUT_LINES,
  BUTTON_ID,
  AGAIN_ID,
  CASES,
};
