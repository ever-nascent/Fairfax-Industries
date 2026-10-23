// Duel of Stances, Yamato's game: rock paper scissors with his three stances. Against Yamato (he picks when the
// game starts, a win pays 1.85x, a tie gives the bet back) or against another member (both stake the bet,
// picks are secret, the winner takes the pot, a tie refunds both). Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { getStore } = require('../storage');
const { fmt, boldSouls } = require('./format');
const { pickRandom } = require('./random');
const { ASSETS } = require('./art');
const { findEmoji } = require('./guild');
const { GREEN, RED, mention, pot, resultFields, playAgainButton, gameMessage, timeoutMessage, forGame } = require('./casino');

const ART = path.join(ASSETS, 'yamato'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0x7b5ea7, name: "Yamato's Dojo", icon: path.join(ART, 'power_slash.png'), art: ART, prefix: 'yamato' };

const PAYOUT = 1.85; // against Yamato: (1.85 + 1) / 3 = 95% back, like the other games
const PVP = true; // casino.js: /mini-game accepts an opponent for this game
const BUTTON_ID = 'duel'; // custom id: duel:<game id>:<accept|decline|power|flying|crimson>
const { takeBet, pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger
const AGAIN_ID = 'duel_again'; // custom id: duel_again:<bet>:<player id>[:<other duelist's id>]
const winnings = (bet) => Math.floor(bet * PAYOUT);

// Power Slash beats Flying Strike, Flying Strike beats Crimson Slash, Crimson Slash beats Power Slash.
// emoji: the server's emoji found on startup (loadStanceEmojis), a plain one until then.
const STANCES = {
  power: { label: 'Power Slash', file: 'power_slash.png', emoji: '🗡️', beats: 'flying' },
  flying: { label: 'Flying Strike', file: 'flying_strike.png', emoji: '🌀', beats: 'crimson' },
  crimson: { label: 'Crimson Slash', file: 'crimson_slash.png', emoji: '🩸', beats: 'power' },
};
const NAMES = { power: 'power_slash', flying: 'flying_strike', crimson: 'crimson_slash' };
const stanceText = (s) => `${STANCES[s].emoji} **${STANCES[s].label}**`;
const stanceName = (s) => `${STANCES[s].emoji} ${STANCES[s].label}`; // inside a line that is bold already
// 1 = a beats b, -1 = b beats a, 0 = same
const versus = (a, b) => (a === b ? 0 : STANCES[a].beats === b ? 1 : -1);

// Original lines in Yamato's voice: patient, dry, honour above all (deadlock.wiki "Yamato/Voice lines").
const WIN_LINES = [
  'Too slow. Again.',
  'You telegraphed it. Study the blade, then return.',
  'A clean cut. Do not take it personally.',
  'Patience wins duels. You had none.',
];
const LOSE_LINES = [
  'Hm. A fine cut. Do not let it swell your head.',
  'You read me. That is not easy to do.',
  'I underestimated you. It will not happen twice.',
  'Well struck. Again, and I will not hold back.',
];
const DRAW_LINES = ['Same stance. Neither of us moved first.', 'Our blades meet. We are equals, for now.'];
const DUEL_LINES = [
  'Steel decides. Words do not.',
  'Honour the loser. They will be back.',
  'A fine duel. The dojo has seen worse.',
  'Too slow. Again.',
];
const TIMEOUT_LINES = [
  'Hesitation is a stance too. You lost that one by yourself.',
  'The blade waits for no one. Your Souls are returned.',
  'You never drew. I do not duel shadows.',
  'Come back when you have decided.',
];

// Games in progress, saved so a restart doesn't eat bets. key: game id
// { userId, name, bet, opponentId (null = Yamato), opponentName, phase: 'invite' | 'pick', picks: { user id: stance },
//   yamato: his stance (against him), done, at }
const games = () => getStore('duelGames');

const solo = (game) => !game.opponentId;
const staked = (game) => (!solo(game) && game.phase === 'pick' ? game.bet * 2 : game.bet);
const refunds = (game) =>
  !solo(game) && game.phase === 'pick' ? [[game.userId, game.bet], [game.opponentId, game.bet]] : [[game.userId, game.bet]];

// On startup: the stances' server emojis (buttons and results show them).
function loadStanceEmojis(guild) {
  for (const [key, stance] of Object.entries(STANCES)) {
    stance.emoji = findEmoji(guild, NAMES[key]).toString();
  }
}

// ---- messages ----------------------------------------------------------------------------------

// Every view but the invite clears the invite's @mention text.
const view = (message) => ({ ...gameMessage(HOST, { title: 'Duel of Stances', ...message }), content: '' });
// Emoji-only, so the three fit one row on a phone (with names they wrapped, his ask Oct 21); the key names them.
const stanceButtons = (id) =>
  [Object.entries(STANCES).map(([key, s]) => [`${BUTTON_ID}:${id}:${key}`, null, ButtonStyle.Secondary, { emoji: s.emoji }])];
const stanceKey = () => Object.keys(STANCES).map((k) => `${stanceText(k)} beats ${STANCES[STANCES[k].beats].emoji}`);
const ready = (game, userId) => (game.picks[userId] ? 'Ready' : 'Choosing...');
const rematchButton = (game) => [`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary];

function inviteView(id, game) {
  const message = view({
    lines: [`${mention(game.userId)} challenges ${mention(game.opponentId)}. Accept?`],
    fields: [['Bet Each', game.bet], ['Pot', pot(game)]],
    footer: '"Draw your blade or walk away. Both are answers."',
    buttons: [[`${BUTTON_ID}:${id}:accept`, 'Accept', ButtonStyle.Success], [`${BUTTON_ID}:${id}:decline`, 'Decline', ButtonStyle.Danger]],
  });
  return { ...message, content: mention(game.opponentId) };
}

function pickView(id, game) {
  const [lines, fields] = solo(game)
    ? [['Yamato has chosen. Pick your stance.'], [['Win Pays', winnings(game.bet)], ['Draw', 'Bet back'], ['Bet', game.bet]]]
    : [['Pick your stance. Picks stay secret.'], [[game.name, ready(game, game.userId)], [game.opponentName, ready(game, game.opponentId)], ['Pot', pot(game)]]];
  return view({ lines: [...lines, '', ...stanceKey()], fields, footer: '"Choose. Hesitation is a stance too, and it always loses."', rows: stanceButtons(id) });
}

// Takes the bet and opens a new duel. Returns a message payload, or { error } if they can't play.
async function startGame(user, name, bet, opponent = null) {
  if (opponent?.bot) return { error: 'Bots do not duel. Pick a member, or leave the opponent empty to face Yamato.' };
  if (opponent?.id === user.id) return { error: 'You cannot duel yourself. Pick another member, or leave it empty to face Yamato.' };
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({
    userId: user.id, name, bet, done: false, picks: {},
    opponentId: opponent?.id ?? null, opponentName: opponent ? opponent.globalName ?? opponent.username : 'Yamato',
    phase: opponent ? 'invite' : 'pick', yamato: opponent ? null : Object.keys(STANCES)[crypto.randomInt(3)],
  }));
  if (error) return { error };
  return opponent ? inviteView(id, game) : pickView(id, game);
}

// Both stances are in (or it's against Yamato): the picks, who won, the pot. The template every game follows (his pick
// Oct 22): one bold line, the money in fields, green / red.
function resultView(game, outcome, balance) {
  const [mine, theirs] = solo(game) ? [game.picks[game.userId], game.yamato] : [game.picks[game.userId], game.picks[game.opponentId]];
  const draw = `Both chose ${stanceName(mine)}. A draw.`;

  if (solo(game)) {
    const won = outcome > 0 ? winnings(game.bet) : outcome === 0 ? game.bet : 0;
    const line = outcome > 0 ? `Your ${stanceName(mine)} beats Yamato's ${stanceName(theirs)}.` : `Yamato's ${stanceName(theirs)} beats your ${stanceName(mine)}.`;
    return view({
      lines: [`**${outcome === 0 ? draw : line}**`],
      fields: resultFields(game.bet, won, balance),
      buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
      footer: `"${pickRandom(outcome > 0 ? LOSE_LINES : outcome === 0 ? DRAW_LINES : WIN_LINES)}"`,
      mood: outcome > 0 ? 'injured' : outcome === 0 ? 'portrait' : 'gloat', // he gloats when you lose, he's hurt when you win
      color: outcome > 0 ? GREEN : outcome === 0 ? HOST.color : RED,
    });
  }
  const [winner, loser] = outcome > 0 ? [game.userId, game.opponentId] : [game.opponentId, game.userId];
  return view({
    lines: [`**${outcome === 0 ? `${draw} Both bets came back.` : `${mention(winner)}'s ${stanceName(game.picks[winner])} beats ${mention(loser)}'s ${stanceName(game.picks[loser])}.`}**`],
    fields: outcome === 0 ? [['Bet Each', game.bet]] : [['Winner', mention(winner)], ['Pot', pot(game)]],
    buttons: [rematchButton(game)],
    footer: `"${pickRandom(outcome === 0 ? DRAW_LINES : DUEL_LINES)}"`,
    color: outcome === 0 ? HOST.color : GREEN,
  });
}

// ---- button presses ----------------------------------------------------------------------------
// Each returns a message payload, { error } (shown only to the clicker), { private, update } (a secret pick:
// `private` for the clicker, `update` is the game's message) or null (stale click, ignore).

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
    game = { ...g, phase: 'pick', picks: {} };
    return game;
  });
  if (!game) {
    await pay(userId, current.bet);
    return null;
  }
  return pickView(id, game);
}

async function decline(id, userId) {
  const current = await games().get(id);
  if (!current || current.phase !== 'invite') return null;
  if (userId !== current.opponentId) return { error: `Only ${current.opponentName} can turn this challenge down.` };
  const game = await games().take(id, (g) => g.phase === 'invite');
  if (!game) return null;
  await pay(game.userId, game.bet);
  return view({
    lines: [`${mention(game.opponentId)} turned down the challenge. ${mention(game.userId)} got ${boldSouls(game.bet)} back.`],
    footer: '"No shame in walking away. Only in never drawing."',
    rows: [],
  });
}

async function choose(id, userId, stance) {
  if (!STANCES[stance]) return null;
  const current = await games().get(id);
  if (!current || current.phase !== 'pick') return null;
  if (userId !== current.userId && userId !== current.opponentId) {
    return { error: solo(current) ? `That's ${current.name}'s duel. Start your own with \`/mini-game\`.` : `This duel is between ${current.name} and ${current.opponentName}.` };
  }
  let game = null;
  let already = false;
  await games().update(id, (g) => {
    if (!g || g.done || g.phase !== 'pick') return g;
    if (g.picks[userId]) {
      already = true;
      return g;
    }
    const picks = { ...g.picks, [userId]: stance };
    game = { ...g, picks, done: solo(g) || Object.keys(picks).length === 2 };
    return game;
  });
  if (already) return { error: `You already chose ${STANCES[current.picks[userId]].label}. Wait for your opponent.` };
  if (!game) return null;
  if (!game.done) return { private: `You chose ${STANCES[stance].label}.`, update: pickView(id, game) };

  const outcome = solo(game) ? versus(stance, game.yamato) : versus(game.picks[game.userId], game.picks[game.opponentId]);
  let balance; // the challenger's, shown against Yamato
  if (solo(game)) {
    balance = (await pay(game.userId, outcome > 0 ? winnings(game.bet) : outcome === 0 ? game.bet : 0)).souls;
  } else if (outcome === 0) {
    await pay(game.opponentId, game.bet);
    await pay(game.userId, game.bet);
  } else {
    await pay(outcome > 0 ? game.userId : game.opponentId, pot(game), outcome > 0 ? game.opponentId : game.userId);
  }
  await games().delete(id);
  return resultView(game, outcome, balance);
}

const play = (id, userId, [action]) => (action === 'accept' ? accept(id, userId) : action === 'decline' ? decline(id, userId) : choose(id, userId, action));

// Time ran out (casino.js expireGames). Member against member with one stance chosen: the one who never drew
// forfeits the pot. Otherwise nothing was decided and everything staked goes back (timeoutView).
function finishOnTimeout(id, game) {
  if (solo(game) || game.phase !== 'pick') return null;
  const drew = Object.keys(game.picks ?? {});
  if (drew.length !== 1) return null;
  const [winner] = drew;
  const loser = winner === game.userId ? game.opponentId : game.userId;
  return {
    pays: [[winner, pot(game), loser]],
    view: () =>
      view({
        lines: [`${mention(loser)} never drew. ${mention(winner)} wins ${boldSouls(pot(game))}.`],
        buttons: [rematchButton(game)],
        footer: `"${pickRandom(TIMEOUT_LINES)}"`,
        mood: 'gloat',
      }),
  };
}

async function timeoutView(id, game, balance) {
  if (solo(game)) {
    return { ...timeoutMessage(HOST, { staked: game.bet, balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId, line: `"${pickRandom(TIMEOUT_LINES)}"` }), content: '' };
  }
  if (game.phase === 'invite') {
    return view({
      lines: [`${mention(game.opponentId)} never answered. ${mention(game.userId)} got ${boldSouls(game.bet)} back.`],
      footer: `"${pickRandom(TIMEOUT_LINES)}"`,
      rows: [],
      mood: 'gloat',
    });
  }
  return view({
    lines: [`${mention(game.userId)} and ${mention(game.opponentId)} never drew. Both got ${boldSouls(game.bet)} back.`],
    footer: `"${pickRandom(TIMEOUT_LINES)}"`,
    buttons: [rematchButton(game)],
    mood: 'gloat',
  });
}

module.exports = {
  games, staked, refunds, timeoutView, finishOnTimeout, loadStanceEmojis, startGame, play,
  versus, winnings, WIN_LINES, LOSE_LINES, DUEL_LINES, TIMEOUT_LINES, BUTTON_ID, AGAIN_ID, PVP,
};
