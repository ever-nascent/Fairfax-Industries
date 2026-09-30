// Shotgun Roulette, Silver's game, modelled on Buckshot Roulette (core loop, no items): a shotgun with a shown mix of
// live and blank shells, shoot the other player or yourself, a blank on yourself keeps your turn, empty chamber =
// reload, last one with charges wins. Against Silver (a win pays 1.85x) or a member
// (both stake, winner takes the pot). Rules: server-plan.md ("Games").
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { getStore } = require('../storage');
const { fmt, soulsText, boldSouls } = require('./format');
const { pickRandom, shuffle, randomInt } = require('./random');
const { ASSETS } = require('./art');
const { findEmoji } = require('./guild');
const { takeBet, resultFields, playAgainButton, gameMessage, timeoutMessage, pay, openGame } = require('./casino');

const ART = path.join(ASSETS, 'silver'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0x9aa5b1, name: "Silver's Shotgun Roulette", icon: path.join(ART, 'slam_fire.png'), art: ART, prefix: 'silver' };
const GREEN = 0x248046;
const RED = 0xda373c;

const PAYOUT = 1.85;
const PVP = true; // casino.js: /mini-game accepts an opponent for this game
const CHARGES = 3;
const SILVER = 'silver'; // her key in `charges` / `turn`
const BUTTON_ID = 'roulette'; // custom id: roulette:<game id>:<accept|decline|other|self>
const AGAIN_ID = 'roulette_again'; // custom id: roulette_again:<bet>:<player id>[:<other player's id>]
const winnings = (bet) => Math.floor(bet * PAYOUT);

// Original lines in Silver's voice: broke, sarcastic, tired, a bounty hunter (deadlock.wiki "Silver/Voice lines").
const WIN_LINES = ['Hope you weren\'t expectin\' the bounty alive.', 'Shouldn\'t have pissed off a werewolf.', 'Didn\'t even need to wolf out.', 'Easy money. Finally.'];
const LOSE_LINES = ['God, I hate my life...', 'That was way too close.', 'Fine. Keep it. I\'ll find more bad decisions.', 'Lucky. Don\'t get used to it.'];
const DUEL_LINES = ['Somebody\'s buyin\' the next round.', 'I love bad life choices as much as the next gal.', 'Load it, spin it, pray it.', 'Well, aren\'t you two a creepy pair.'];
const TURN_LINES = [
  "Hair of the dog. Pull it, or don't.",
  'I love bad life choices. Go on, make one.',
  "Your call. I've made worse ones before noon.",
  "Shoot me, shoot yourself. Somebody's payin' my tab.",
  "Don't stare at it. Pull the trigger.",
  "Load's fixed. Your luck ain't.",
];
const TIMEOUT_LINES = ['Nobody pulled the trigger. Your Souls are back, coward.', 'Too slow. I\'ve got a bar to get to.', 'Fine, walk. I\'ll be here. Drinkin\'.', 'Can\'t hide from me forever.'];

// Games in progress, saved so a restart doesn't eat bets. key: game id
// { userId, name, bet, opponentId (null = Silver), opponentName, phase: 'invite' | 'play', players: [first, second],
//   charges: { player: n }, shells: [remaining 'live' | 'blank'], turn, log: [what just happened], done, at }
const games = () => getStore('rouletteGames');

const solo = (game) => !game.opponentId;
const mention = (id) => `<@${id}>`;
const pot = (game) => game.bet * 2;
const staked = (game) => (!solo(game) && game.phase === 'play' ? game.bet * 2 : game.bet);
const refunds = (game) =>
  !solo(game) && game.phase === 'play' ? [[game.userId, game.bet], [game.opponentId, game.bet]] : [[game.userId, game.bet]];
const nameOf = (game, id) => (id === game.userId ? game.name : game.opponentName);

// emoji: the server's emojis found on startup (loadShellEmojis), a plain one until then.
const SHELLS = {
  live: { name: 'shell_live', emoji: '🔴' }, blank: { name: 'shell_blank', emoji: '🔵' },
  charge: { name: 'charge', emoji: '❤️' }, lost: { name: 'charge_lost', emoji: '🖤' },
};
function loadShellEmojis(guild) {
  for (const shell of Object.values(SHELLS)) shell.emoji = findEmoji(guild, shell.name).toString();
}

// ---- rules -------------------------------------------------------------------------------------

// 2-8 shells, 1-3 live, at least one blank; the counts are shown, the order is not.
function loadShells(rnd = randomInt) {
  const total = 2 + rnd(7);
  const live = 1 + rnd(Math.min(3, total - 1));
  return shuffle([...Array(live).fill('live'), ...Array(total - live).fill('blank')], rnd);
}
const count = (shells) => ({ live: shells.filter((s) => s === 'live').length, blank: shells.filter((s) => s === 'blank').length });

// One shot by whoever's turn it is. Returns the new game state (nothing saved) with `event` for the message.
function fire(game, atSelf, rnd = randomInt) {
  const shooter = game.turn;
  const other = game.players.find((p) => p !== shooter);
  const target = atSelf ? shooter : other;
  const [shell, ...rest] = game.shells;
  const charges = { ...game.charges, [target]: game.charges[target] - (shell === 'live' ? 1 : 0) };
  const over = charges[target] <= 0;
  const reloaded = !over && rest.length === 0;
  return {
    ...game,
    charges,
    shells: reloaded ? loadShells(rnd) : rest,
    turn: shell === 'blank' && atSelf ? shooter : other,
    winner: over ? game.players.find((p) => p !== target) : null,
    event: { shooter, target, shell, reloaded },
  };
}

// Silver only shoots herself when no live shell is left (simulated: any riskier rule can be beaten by always shooting her).
const silverShoots = (game) => {
  const { live, blank } = count(game.shells);
  return live === 0;
};

const shotText = (game, { shooter, target, shell }) => {
  const who = nameOf(game, shooter) ?? 'Silver';
  const aim = target === shooter ? 'themselves' : nameOf(game, target) ?? 'Silver';
  const self = shooter === SILVER ? 'herself' : 'themselves';
  return `**${who}** shot ${target === shooter ? self : aim}: ${shell === 'live' ? '**BANG.** Live.' : '*click.* Blank.'}`;
};

// Plays the shot, then Silver's shots until it's a person's turn again (or it's over). Returns the new state.
function play(game, atSelf, rnd = randomInt) {
  let g = { ...game, log: [] };
  for (let first = true; first || (g.turn === SILVER && !g.winner); first = false) {
    g = fire(g, first ? atSelf : silverShoots(g), rnd);
    g.log = [...g.log, shotText(g, g.event), ...(g.event.reloaded ? ['*Silver reloads the shotgun.*'] : [])];
  }
  return g;
}

// ---- messages ----------------------------------------------------------------------------------

// Every view but the invite clears the invite's @mention text.
const view = (message) => ({ ...gameMessage(HOST, { title: 'Shotgun Roulette', ...message }), content: '' });
const versusLine = (game) => `${mention(game.userId)} vs ${mention(game.opponentId)}, ${boldSouls(game.bet)} each.`;
// The shots so far, as a quote (the > bar)
const quote = (lines) => lines.map((l) => `> ${l}`);
const bolts = (n) => SHELLS.charge.emoji.repeat(n) + SHELLS.lost.emoji.repeat(CHARGES - n);

function inviteView(id, game) {
  const message = view({
    lines: [versusLine(game), `Pot if accepted: ${boldSouls(pot(game))}`, '', `${mention(game.opponentId)}, you have been challenged. Accept?`],
    footer: '"Sit down. It\'s already loaded."',
    buttons: [[`${BUTTON_ID}:${id}:accept`, 'Accept', ButtonStyle.Success], [`${BUTTON_ID}:${id}:decline`, 'Decline', ButtonStyle.Danger]],
  });
  return { ...message, content: mention(game.opponentId) };
}

function playView(id, game) {
  const { live, blank } = count(game.shells);
  const turnName = nameOf(game, game.turn);
  const other = nameOf(game, game.players.find((p) => p !== game.turn));
  const header = solo(game)
    ? [`**${game.name}** stakes ${boldSouls(game.bet)} against Silver. A win pays ${boldSouls(winnings(game.bet))}.`]
    : [versusLine(game), `Pot: ${boldSouls(pot(game))}`];
  return view({
    lines: [
      ...header, '',
      ...game.players.map((p) => `**${nameOf(game, p)}:** ${bolts(game.charges[p])}`),
      `**Shotgun:** ${SHELLS.live.emoji} ${live} live, ${SHELLS.blank.emoji} ${blank} blank`,
      ...(game.log?.length ? ['', ...quote(game.log)] : []),
      '', `**${turnName}, your turn.**`,
    ],
    footer: `"${pickRandom(TURN_LINES)}"`,
    buttons: [
      [`${BUTTON_ID}:${id}:other`, `Shoot ${other}`, ButtonStyle.Danger],
      [`${BUTTON_ID}:${id}:self`, 'Shoot Yourself', ButtonStyle.Secondary],
    ],
  });
}

// Takes the bet and opens a new game. Returns a message payload, or { error } if they can't play.
async function startGame(user, name, bet, opponent = null) {
  if (opponent?.bot) return { error: 'Bots do not play roulette. Pick a member, or leave the opponent empty to face Silver.' };
  if (opponent?.id === user.id) return { error: 'You cannot play yourself. Pick another member, or leave it empty to face Silver.' };
  const otherId = opponent?.id ?? SILVER;
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({
    userId: user.id, name, bet, done: false,
    opponentId: opponent?.id ?? null, opponentName: opponent ? opponent.globalName ?? opponent.username : 'Silver',
    phase: opponent ? 'invite' : 'play', players: [user.id, otherId], charges: { [user.id]: CHARGES, [otherId]: CHARGES },
    shells: loadShells(), turn: user.id, log: [],
  }));
  if (error) return { error };
  return opponent ? inviteView(id, game) : playView(id, game);
}

function resultView(game, balance) {
  const won = game.winner === game.userId;
  const log = ['', ...quote(game.log)];
  if (solo(game)) {
    const paid = won ? winnings(game.bet) : 0;
    return view({
      lines: [...game.players.map((p) => `**${nameOf(game, p)}:** ${bolts(game.charges[p])}`), ...log, '', won ? `**You win ${soulsText(paid)}.**` : '**Silver wins.**'],
      fields: resultFields(game.bet, paid, balance),
      buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
      footer: `"${pickRandom(won ? LOSE_LINES : WIN_LINES)}"`,
      mood: won ? 'injured' : 'gloat',
      color: won ? GREEN : RED,
    });
  }
  return view({
    lines: [versusLine(game), '', ...game.players.map((p) => `**${nameOf(game, p)}:** ${bolts(game.charges[p])}`), ...log, '', `${mention(game.winner)} wins ${boldSouls(pot(game))}.`],
    buttons: [[`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary]],
    footer: `"${pickRandom(DUEL_LINES)}"`,
    color: GREEN,
  });
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
    game = { ...g, phase: 'play' };
    return game;
  });
  if (!game) {
    await pay(userId, current.bet);
    return null;
  }
  return playView(id, game);
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
    footer: '"Smart. Nobody walks away from this table with everything."',
    rows: [],
  });
}

async function shoot(id, userId, atSelf) {
  const current = await games().get(id);
  if (!current || current.phase !== 'play') return null;
  if (!current.players.includes(userId)) {
    return { error: solo(current) ? `That's ${current.name}'s game. Start your own with \`/mini-game\`.` : `This game is between ${current.name} and ${current.opponentName}.` };
  }
  if (current.turn !== userId) return { error: `It's ${nameOf(current, current.turn)}'s turn.` };
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.done || g.phase !== 'play' || g.turn !== userId) return g; // a double click
    game = play(g, atSelf);
    delete game.event;
    game.done = Boolean(game.winner);
    return game;
  });
  if (!game) return null;
  if (!game.done) return playView(id, game);

  let balance;
  if (solo(game)) balance = (await pay(game.userId, game.winner === game.userId ? winnings(game.bet) : 0)).souls;
  else await pay(game.winner, pot(game));
  await games().delete(id);
  return resultView(game, balance);
}

const move = (id, userId, [action]) =>
  action === 'accept' ? accept(id, userId) : action === 'decline' ? decline(id, userId) : shoot(id, userId, action === 'self');

// Called off with no click for too long (casino.js expireGames): everything staked goes back.
async function timeoutView(id, game, balance) {
  if (solo(game)) {
    return { ...timeoutMessage(HOST, { staked: game.bet, balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId, line: `"${pickRandom(TIMEOUT_LINES)}"` }), content: '' };
  }
  if (game.phase === 'invite') {
    return view({
      lines: [`${mention(game.opponentId)} never answered ${mention(game.userId)}.`, `${boldSouls(game.bet)} went back to ${mention(game.userId)}.`],
      footer: `"${pickRandom(TIMEOUT_LINES)}"`,
      rows: [],
      mood: 'gloat',
    });
  }
  return view({
    lines: [`${mention(game.userId)} and ${mention(game.opponentId)} never finished.`, `Both got ${boldSouls(game.bet)} back.`],
    footer: `"${pickRandom(TIMEOUT_LINES)}"`,
    buttons: [[`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary]],
    mood: 'gloat',
  });
}

module.exports = {
  games, staked, refunds, timeoutView, loadShellEmojis, startGame, move,
  loadShells, fire, play, silverShoots, count, winnings, CHARGES, SILVER, BUTTON_ID, AGAIN_ID, PVP,
};
