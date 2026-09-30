// Duel of Stances, Yamato's game: rock paper scissors with his three stances. Against Yamato (he picks when the
// game starts, a win pays 1.85x, a tie gives the bet back) or against another member (both stake the bet,
// picks are secret, the winner takes the pot, a tie refunds both). Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { getStore } = require('../storage');
const { changeSouls } = require('./xp');
const { fmt, soulsText, boldSouls } = require('./format');
const { pickRandom, shortId } = require('./random');
const { ASSETS } = require('./art');
const { ensureEmoji } = require('./guild');
const { takeBet, resultFields, playAgainButton, gameMessage, timeoutMessage } = require('./casino');

const ART = path.join(ASSETS, 'yamato'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0x7b5ea7, name: "Yamato's Dojo", icon: path.join(ART, 'power_slash.png'), art: ART, prefix: 'yamato' };
const GREEN = 0x248046;
const RED = 0xda373c;

const PAYOUT = 1.85; // against Yamato: (1.85 + 1) / 3 = 95% back, like the other games
const PVP = true; // casino.js: /mini-game accepts an opponent for this game
const BUTTON_ID = 'duel'; // custom id: duel:<game id>:<accept|decline|power|flying|crimson>
const AGAIN_ID = 'duel_again'; // custom id: duel_again:<bet>:<player id>[:<other duelist's id>]
const winnings = (bet) => Math.floor(bet * PAYOUT);

// Power Slash beats Flying Strike, Flying Strike beats Crimson Slash, Crimson Slash beats Power Slash.
// emoji: the server's emoji once uploaded (ensureStanceEmojis), a plain one until then.
const STANCES = {
  power: { label: 'Power Slash', file: 'power_slash.png', emoji: '🗡️', beats: 'flying' },
  flying: { label: 'Flying Strike', file: 'flying_strike.png', emoji: '🌀', beats: 'crimson' },
  crimson: { label: 'Crimson Slash', file: 'crimson_slash.png', emoji: '🩸', beats: 'power' },
};
const NAMES = { power: 'power_slash', flying: 'flying_strike', crimson: 'crimson_slash' };
const stanceText = (s) => `${STANCES[s].emoji} **${STANCES[s].label}**`;
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
const mention = (id) => `<@${id}>`;
const pot = (game) => game.bet * 2;
const staked = (game) => (!solo(game) && game.phase === 'pick' ? game.bet * 2 : game.bet);
const refunds = (game) =>
  !solo(game) && game.phase === 'pick' ? [[game.userId, game.bet], [game.opponentId, game.bet]] : [[game.userId, game.bet]];

// On startup: the stances' icons as server emojis (buttons and results show them).
async function ensureStanceEmojis(guild) {
  for (const [key, stance] of Object.entries(STANCES)) {
    stance.emoji = (await ensureEmoji(guild, NAMES[key], path.join(ART, stance.file))).toString();
  }
}

// ---- messages ----------------------------------------------------------------------------------

// Every view but the invite clears the invite's @mention text.
const view = (message) => ({ ...gameMessage(HOST, { title: 'Duel of Stances', ...message }), content: '' });
const versusLine = (game) => `${mention(game.userId)} vs ${mention(game.opponentId)}, ${boldSouls(game.bet)} each.`;
const stanceButtons = (id) =>
  [Object.entries(STANCES).map(([key, s]) => [`${BUTTON_ID}:${id}:${key}`, s.label, ButtonStyle.Secondary, { emoji: s.emoji }])];

function inviteView(id, game) {
  const message = view({
    lines: [versusLine(game), `Pot if accepted: ${boldSouls(pot(game))}`, '', `${mention(game.opponentId)}, you have been challenged.`, '**Accept?**'],
    footer: '"Draw your blade or walk away. Both are answers."',
    buttons: [[`${BUTTON_ID}:${id}:accept`, 'Accept', ButtonStyle.Success], [`${BUTTON_ID}:${id}:decline`, 'Decline', ButtonStyle.Danger]],
  });
  return { ...message, content: mention(game.opponentId) };
}

function pickView(id, game) {
  const lines = solo(game)
    ? [`**${game.name}** stakes ${boldSouls(game.bet)} against Yamato.`, `A win pays ${boldSouls(winnings(game.bet))}.`, 'A tie gives your bet back.', '', 'Yamato has already chosen.', '**Pick your stance.**']
    : [
        versusLine(game),
        `Pot: ${boldSouls(pot(game))}`,
        '',
        '**Pick your stance.**',
        "Your opponent can't see it.",
        `**${game.name}:** ${game.picks[game.userId] ? 'ready' : 'choosing...'}`,
        `**${game.opponentName}:** ${game.picks[game.opponentId] ? 'ready' : 'choosing...'}`,
      ];
  return view({ lines, footer: '"Choose. Hesitation is a stance too, and it always loses."', rows: stanceButtons(id) });
}

// Takes the bet and opens a new duel. Returns a message payload, or { error } if they can't play.
async function startGame(user, name, bet, opponent = null) {
  if (opponent?.bot) return { error: 'Bots do not duel. Pick a member, or leave the opponent empty to face Yamato.' };
  if (opponent?.id === user.id) return { error: 'You cannot duel yourself. Pick another member, or leave it empty to face Yamato.' };
  const error = await takeBet(user.id, bet);
  if (error) return { error };
  const id = shortId();
  const game = {
    userId: user.id, name, bet, done: false, at: Date.now(), picks: {},
    opponentId: opponent?.id ?? null, opponentName: opponent ? opponent.globalName ?? opponent.username : 'Yamato',
    phase: opponent ? 'invite' : 'pick', yamato: opponent ? null : Object.keys(STANCES)[crypto.randomInt(3)],
  };
  await games().set(id, game);
  return opponent ? inviteView(id, game) : pickView(id, game);
}

// Both stances are in (or it's against Yamato): the picks, who won, the pot.
function resultView(game, outcome, balance) {
  const [mine, theirs] = solo(game) ? [game.picks[game.userId], game.yamato] : [game.picks[game.userId], game.picks[game.opponentId]];
  const theirName = game.opponentName;
  const stances = [`**${game.name}** chose ${stanceText(mine)}`, `**${theirName}** chose ${stanceText(theirs)}`];
  const beats = outcome === 0 ? null : outcome > 0 ? [mine, theirs] : [theirs, mine];
  const beatsLine = beats ? `**${STANCES[beats[0]].label}** beats **${STANCES[beats[1]].label}**.` : 'Same stance. The blades meet.';

  if (solo(game)) {
    const won = outcome > 0 ? winnings(game.bet) : outcome === 0 ? game.bet : 0;
    return view({
      lines: [...stances, '', beatsLine, ...(outcome === 0 ? ['**A draw.**', `Your ${soulsText(game.bet)} came back.`] : [outcome > 0 ? `**You win ${soulsText(won)}.**` : '**Yamato wins.**'])],
      fields: resultFields(game.bet, won, balance),
      buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
      footer: `"${pickRandom(outcome > 0 ? LOSE_LINES : outcome === 0 ? DRAW_LINES : WIN_LINES)}"`,
      mood: outcome > 0 ? 'injured' : outcome === 0 ? 'portrait' : 'gloat', // he gloats when you lose, he's hurt when you win
      color: outcome > 0 ? GREEN : outcome === 0 ? HOST.color : RED,
    });
  }
  const winner = outcome > 0 ? game.userId : game.opponentId;
  return view({
    lines: [
      versusLine(game), '', ...stances, '', beatsLine,
      ...(outcome === 0 ? ['**A draw.**', `Both get ${boldSouls(game.bet)} back.`] : [`${mention(winner)} wins ${boldSouls(pot(game))}.`]),
    ],
    buttons: [[`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary]],
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
    await changeSouls(userId, current.bet);
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
  await changeSouls(game.userId, game.bet);
  return view({
    lines: [`${mention(game.opponentId)} turned down ${mention(game.userId)}'s challenge.`, `${boldSouls(game.bet)} went back to ${mention(game.userId)}.`],
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
    balance = (await changeSouls(game.userId, outcome > 0 ? winnings(game.bet) : outcome === 0 ? game.bet : 0)).souls;
  } else if (outcome === 0) {
    await changeSouls(game.opponentId, game.bet);
    await changeSouls(game.userId, game.bet);
  } else {
    await changeSouls(outcome > 0 ? game.userId : game.opponentId, pot(game));
  }
  await games().delete(id);
  return resultView(game, outcome, balance);
}

const play = (id, userId, [action]) => (action === 'accept' ? accept(id, userId) : action === 'decline' ? decline(id, userId) : choose(id, userId, action));

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
    lines: [`${mention(game.userId)} and ${mention(game.opponentId)} never both drew.`, `Both got ${boldSouls(game.bet)} back.`],
    footer: `"${pickRandom(TIMEOUT_LINES)}"`,
    buttons: [[`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary]],
    mood: 'gloat',
  });
}

module.exports = {
  games, staked, refunds, timeoutView, ensureStanceEmojis, startGame, play,
  STANCES, versus, winnings, WIN_LINES, LOSE_LINES, DRAW_LINES, DUEL_LINES, TIMEOUT_LINES, BUTTON_ID, AGAIN_ID, PVP,
};
