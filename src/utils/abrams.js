// Abrams' Interrogation, Abrams' game (Guess Who; his idea Oct 22, built from the mock-up he approved): the culprit is one
// of the 44 heroes. Each turn you're dealt a hand of HAND yes/no questions (abramsCase.js; only ones that still rule
// someone out) and ask one; the case board crosses off every suspect it rules out. Accuse any time; a wrong name loses.
// Solo, against Abrams' case: at most MAX_QUESTIONS questions, and the fewer you ask the more a right accusation pays
// (PAYOUT). Against a member (opponent:): each picks a secret hero for the other to find, turns alternate, no question
// limit, the first right accusation takes the pot and a wrong one loses it. Rules: server-plan.md ("Games").
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { fmt, boldSouls } = require('./format');
const { pickRandom, shuffle } = require('./random');
const { ASSETS } = require('./art');
const { HEROES, heroEmoji } = require('./heroes');
const { QUESTIONS, answer } = require('./abramsCase');
const { renderBoard, renderDuel } = require('./abramsBoard');
const { GREEN, RED, mention, pot, resultFields, playAgainButton, gameMessage, timeoutMessage, forGame } = require('./casino');

const ART = path.join(ASSETS, 'abrams'); // Seismic Impact icon (deadlock.wiki); portraits the wiki's Abrams card / Gloat / Critical
const HOST = { color: 0xb5762c, name: "Abrams' Interrogation", icon: path.join(ART, 'seismic_impact.png'), art: ART, prefix: 'abrams' };

const PVP = true; // casino.js: /mini-game accepts an opponent for this game
const BUTTON_ID = 'case'; // custom id: case:<game id>:<accept|decline|ask|accuse|back|name|pick>[:<menu part>], a dropdown's value last
const AGAIN_ID = 'case_again'; // custom id: case_again:<bet>:<player id>[:<other detective's id>]
const { takeBet, pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger

// Solo pays bet x PAYOUT[questions asked] for a right accusation. Simulated Oct 23 with the reworked questions
// (tools/interrogation-rtp.js): a player who always asks the best question in the hand and accuses at the best moment gets
// about 95% back and wins 92% of cases; weaker play gets less (the Oct 22 table, 1.75 / 1.4 / 1.15 at 3-5 questions, gave
// 100% with the better questions). Oct 23, his ask (it was too hard to profit): hand of 5, 7 questions, a flatter table; good play now returns about 106%, careless play about 88%.
const HAND = 5;
const MAX_QUESTIONS = 7;
const PAYOUT = [4, 3, 2.25, 1.7, 1.35, 1.1, 1, 1];
const winnings = (bet, asked) => Math.floor(bet * PAYOUT[Math.min(asked, MAX_QUESTIONS)]);

const NAMES = HEROES.map((h) => h.name);

// Original lines in Abrams' voice: a tired New York detective, gruff, dry, fond of a rookie who does the work.
const START_LINES = [
  "Forty-four suspects and one cold cup of coffee. Let's get to work.",
  'Somebody in this city did it. We find out who.',
  'Every perp leaves a trail. Ask the right questions.',
  "Sit down, rookie. This one's gonna take some legwork.",
];
const YES_LINES = ["Now we're getting somewhere.", 'That narrows the lineup. Keep pushing.', 'Good question. The board just got smaller.', "That's a lead. Don't let go of it."];
const NO_LINES = ["Dead end. Cross 'em off.", "Not our guy. Next question.", "Nope. But a no is still a clue, rookie.", 'Scratch that. Try another angle.'];
const LAST_LINES = ["That's all the questions the captain's paying for. Make the call.", "Out of questions, rookie. Who's it gonna be?"];
const ACCUSE_LINES = ["Point at the board. Make it count.", "You sure? A wrong name and the real one walks."];
const WIN_LINES = ["Cuffs on. Case closed. Nice work, rookie.", "That's our perp. Drinks are on the precinct.", "Textbook. I'd put you up for detective.", "Knew it. Took you long enough, but I knew it."];
const LOSE_LINES = ["Wrong guy. The real one's halfway to Jersey by now.", "You just let the real perp walk, rookie.", "That's a lawsuit, not an arrest.", "Back to the board. The trail's gone cold."];
const DUEL_LINES = ['Two detectives, one interrogation room. Only one keeps the badge.', 'Good police work wins. Luck just helps.', "That's how you close a case.", 'Somebody buy the loser a coffee.'];
const TIMEOUT_LINES = ['The case went cold while you stared at the board.', "Can't crack a case standing still.", 'Nobody made a move. The suspects all walked.', "I've seen glaciers work faster, rookie."];

// Games in progress, saved so a restart doesn't eat bets. key: game id
// Solo: { userId, name, bet, opponentId: null, culprit, phase: 'play', hunts: { [userId]: board }, turn, mode, done, at }
// Duel: { ..., opponentId, opponentName, phase: 'invite' | 'pick' | 'play', secrets: { [user id]: hero } }
// board (one per detective): { suspects: [names], asked: [[question index, yes]], hand: [question indexes] }
const games = () => getStore('interrogationGames');

const solo = (game) => !game.opponentId;
const staked = (game) => (!solo(game) && game.phase !== 'invite' ? game.bet * 2 : game.bet);
const refunds = (game) =>
  !solo(game) && game.phase !== 'invite' ? [[game.userId, game.bet], [game.opponentId, game.bet]] : [[game.userId, game.bet]];
const other = (game, userId) => (userId === game.userId ? game.opponentId : game.userId);
const nameOf = (game, userId) => (userId === game.userId ? game.name : game.opponentName);
// The hero a detective is hunting: Abrams' culprit, or the other detective's secret.
const targetOf = (game, userId) => (solo(game) ? game.culprit : game.secrets[other(game, userId)]);
const caseNo = (id) => 1000 + (parseInt(id.slice(0, 6), 16) % 9000);

// ---- the case logic (pure) -----------------------------------------------------------------------------------------------

// Questions that still split `suspects` (some would answer yes, some no).
const useful = (suspects) =>
  QUESTIONS.map((_, q) => q).filter((q) => {
    const yes = suspects.filter((h) => answer(h, q)).length;
    return yes > 0 && yes < suspects.length;
  });
// A fresh hand: HAND random useful questions (fewer when fewer are left).
const deal = (suspects, rnd) => shuffle(useful(suspects), rnd).slice(0, HAND);
const newBoard = (rnd) => ({ suspects: [...NAMES], asked: [], hand: deal(NAMES, rnd) });
// Asks question q about `target` on `board`: the answer, the suspects left, a new hand.
function ask(board, q, target, rnd) {
  const yes = answer(target, q);
  const suspects = board.suspects.filter((h) => answer(h, q) === yes);
  return { suspects, asked: [...board.asked, [q, yes]], hand: deal(suspects, rnd) };
}
const outOfQuestions = (game, board) => solo(game) && board.asked.length >= MAX_QUESTIONS;

// ---- messages --------------------------------------------------------------------------------------------------------

// The server's hero emojis for the suspect dropdowns, found on startup (loadHeroEmojis).
let guild = null;
const loadHeroEmojis = (g) => {
  guild = g;
};
const emojiOf = (name) => heroEmoji(guild, HEROES.find((h) => h.name === name)?.slug);

const view = (message) => ({ ...gameMessage(HOST, message), content: '' });
const clueLine = ([q, yes]) => `> ${QUESTIONS[q].text}\n**${yes ? 'Yes' : 'No'}**`; // the question quoted, the answer bold under it, no emoji (his ask Oct 22)
const picture = (id, data) => ({ name: `case_${id}_${Date.now()}.png`, data });
const boardPicture = (id, game, userId, extra = {}) => ({ left: game.hunts[userId].suspects, caseNo: caseNo(id), clues: game.hunts[userId].asked, ...extra });

function questionMenu(id, board) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${BUTTON_ID}:${id}:ask`)
      .setPlaceholder('Ask Abrams a question...')
      .addOptions(board.hand.map((q) => ({ label: QUESTIONS[q].label, value: String(q), description: QUESTIONS[q].group }))),
  );
}
// Dropdowns of heroes, 25 at most per dropdown (Discord's limit). `what`: 'name' (an accusation) or 'pick' (a secret hero).
function heroMenus(id, what, names, placeholder) {
  const parts = [];
  for (let i = 0; i < names.length; i += 25) parts.push(names.slice(i, i + 25));
  return parts.map((part, i) =>
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${BUTTON_ID}:${id}:${what}:${i}`)
        .setPlaceholder(parts.length > 1 ? `${placeholder} (${part[0]} to ${part.at(-1)})` : placeholder)
        .addOptions(part.map((n) => ({ label: n, value: n, ...(emojiOf(n) ? { emoji: emojiOf(n) } : {}) }))),
    ),
  );
}
const accuseButton = (id) => new ActionRowBuilder().addComponents(button(`${BUTTON_ID}:${id}:accuse`, 'Accuse...', ButtonStyle.Danger));
const backButton = (id) => new ActionRowBuilder().addComponents(button(`${BUTTON_ID}:${id}:back`, 'Back to the Questions', ButtonStyle.Secondary));
function button(customId, label, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

// The board's question / accusation controls for whoever's turn it is.
function controls(id, game) {
  const board = game.hunts[game.turn];
  if (game.mode === 'accuse') return [...heroMenus(id, 'name', board.suspects, 'Accuse a suspect...'), ...(outOfQuestions(game, board) ? [] : [backButton(id)])];
  return [...(outOfQuestions(game, board) || !board.hand.length ? [] : [questionMenu(id, board)]), accuseButton(id)];
}

async function soloView(id, game, footer) {
  const board = game.hunts[game.userId];
  const out = outOfQuestions(game, board);
  const prompt = game.mode === 'accuse'
    ? 'Who did it? Pick your suspect. A wrong name loses the bet.'
    : out ? "Out of questions. Make your accusation." : board.asked.length ? 'Ask Abrams another question, or make an accusation.' : 'Abrams has a suspect in mind. Ask him a question, or make an accusation.';
  return view({
    lines: [prompt, ...(board.asked.length ? ['', ...board.asked.map(clueLine)] : [])],
    image: picture(id, await renderBoard(boardPicture(id, game, game.userId))),
    fields: [
      ['Suspects Left', `${board.suspects.length} of ${NAMES.length}`],
      ['Questions Left', `${MAX_QUESTIONS - board.asked.length} of ${MAX_QUESTIONS}`],
      ['Accuse Now Pays', winnings(game.bet, board.asked.length)],
      ['Bet', game.bet],
    ],
    footer: `"${footer}"`,
    rows: controls(id, game),
  });
}

// A duel's clue log for one detective (the last 8, so a field stays under Discord's 1,024 characters).
const clueField = (game, userId) => {
  const asked = game.hunts[userId].asked;
  return [`${nameOf(game, userId)}'s Clues`, asked.length ? asked.slice(-8).map(clueLine).join('\n') : 'None yet'];
};
async function duelBoards(id, game, extra = {}) {
  return renderDuel([game.userId, game.opponentId].map((u) => ({ detective: nameOf(game, u), ...boardPicture(id, game, u), ...(extra[u] ?? {}) })));
}
async function duelView(id, game, footer) {
  const prompt = game.mode === 'accuse'
    ? `${mention(game.turn)}, who did it? A wrong name loses the pot.`
    : `${mention(game.turn)}, your move: ask Abrams a question or make an accusation.`;
  return view({
    lines: [prompt],
    image: picture(id, await duelBoards(id, game)),
    fields: [
      [`${game.name}'s Suspects`, String(game.hunts[game.userId].suspects.length)],
      [`${game.opponentName}'s Suspects`, String(game.hunts[game.opponentId].suspects.length)],
      ['Pot', pot(game)],
      clueField(game, game.userId),
      clueField(game, game.opponentId),
    ],
    footer: `"${footer}"`,
    rows: controls(id, game),
  });
}
const playView = (id, game, footer) => (solo(game) ? soloView(id, game, footer) : duelView(id, game, footer));

const rematchButton = (game) => [`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary];

function inviteView(id, game) {
  const message = view({
    lines: [`${mention(game.userId)} challenges ${mention(game.opponentId)} to an interrogation. Accept?`],
    fields: [['Bet Each', game.bet], ['Pot', pot(game)]],
    footer: '"Two detectives, one case each. Whoever cracks theirs first keeps the badge."',
    buttons: [[`${BUTTON_ID}:${id}:accept`, 'Accept', ButtonStyle.Success], [`${BUTTON_ID}:${id}:decline`, 'Decline', ButtonStyle.Danger]],
  });
  return { ...message, content: mention(game.opponentId) };
}

const ready = (game, userId) => (game.secrets[userId] ? 'Ready' : 'Choosing...');
function pickView(id, game) {
  return view({
    lines: ['Each detective picks a secret hero for the other to find. Picks stay secret.'],
    fields: [[game.name, ready(game, game.userId)], [game.opponentName, ready(game, game.opponentId)], ['Pot', pot(game)]],
    footer: '"Pick somebody good. Make the other guy sweat."',
    rows: heroMenus(id, 'pick', NAMES, 'Pick your secret hero...'),
  });
}

// ---- starting a game -------------------------------------------------------------------------------------------------

// Takes the bet and opens a new case. Returns a message payload, or { error } if they can't play.
// `rnd` (tests): a random-int function used for the culprit and the hands.
async function startGame(user, name, bet, opponent = null, rnd = undefined) {
  if (opponent?.bot) return { error: 'Bots make lousy detectives. Pick a member, or leave the opponent empty to work Abrams\' case.' };
  if (opponent?.id === user.id) return { error: 'You cannot interrogate yourself. Pick another member, or leave it empty to work Abrams\' case.' };
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({
    userId: user.id, name, bet, done: false, mode: 'ask', turn: user.id,
    opponentId: opponent?.id ?? null, opponentName: opponent ? opponent.globalName ?? opponent.username : 'Abrams',
    phase: opponent ? 'invite' : 'play', secrets: {},
    culprit: opponent ? null : pickRandom(NAMES, rnd),
    hunts: opponent ? {} : { [user.id]: newBoard(rnd) },
  }));
  if (error) return { error };
  return opponent ? inviteView(id, game) : playView(id, game, pickRandom(START_LINES));
}

// ---- the end ---------------------------------------------------------------------------------------------------------

async function soloResult(id, game, accused, balance) {
  const culprit = game.culprit;
  const right = accused === culprit;
  const asked = game.hunts[game.userId].asked.length;
  return view({
    lines: [right ? `**Case closed. It was ${culprit}.**` : `**You accused ${accused}. It was ${culprit}.**`],
    image: picture(id, await renderBoard({
      ...boardPicture(id, game, game.userId), accused: right ? null : accused, solved: right ? culprit : null, culprit: right ? null : culprit,
    })),
    fields: [['Questions Asked', String(asked)], ...resultFields(game.bet, right ? winnings(game.bet, asked) : 0, balance)],
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    footer: `"${pickRandom(right ? WIN_LINES : LOSE_LINES)}"`,
    mood: right ? 'injured' : 'gloat', // like every host: hurt when you win, gloating when you lose
    color: right ? GREEN : RED,
  });
}

async function duelResult(id, game, accuser, accused) {
  const target = targetOf(game, accuser);
  const right = accused === target;
  const winner = right ? accuser : other(game, accuser);
  const line = right
    ? `${mention(accuser)} cracked the case: it was ${target}. ${mention(accuser)} takes the pot.`
    : `${mention(accuser)} accused ${accused}, but it was ${target}. ${mention(winner)} takes the pot.`;
  const extra = { [accuser]: right ? { solved: target } : { culprit: target, accused } };
  return view({
    lines: [`**${line}**`],
    image: picture(id, await duelBoards(id, game, extra)),
    fields: [['Winner', mention(winner)], ['Pot', pot(game)], ['Secret Heroes', `${game.name} hid ${game.secrets[game.userId]}\n${game.opponentName} hid ${game.secrets[game.opponentId]}`]],
    buttons: [rematchButton(game)],
    footer: `"${pickRandom(DUEL_LINES)}"`,
    color: GREEN,
  });
}

// ---- button presses --------------------------------------------------------------------------------------------------
// Each returns a message payload, { error } (shown only to the clicker), { private, update } (a secret pick) or null (a stale click).

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
    game = { ...g, phase: 'pick', secrets: {} };
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
    lines: [`${mention(game.opponentId)} turned down the case. ${mention(game.userId)} got ${boldSouls(game.bet)} back.`],
    footer: '"No case, no collar. Go home, get some sleep."',
    rows: [],
  });
}

// A duelist picks the secret hero the other has to find. Both in: the case opens, the challenger asks first.
async function pickSecret(id, userId, hero, rnd) {
  if (!NAMES.includes(hero)) return null;
  const current = await games().get(id);
  if (!current || current.phase !== 'pick') return null;
  if (userId !== current.userId && userId !== current.opponentId) return { error: `This case is between ${current.name} and ${current.opponentName}.` };
  let game = null;
  let already = false;
  await games().update(id, (g) => {
    if (!g || g.done || g.phase !== 'pick') return g;
    if (g.secrets[userId]) {
      already = true;
      return g;
    }
    const secrets = { ...g.secrets, [userId]: hero };
    const both = Object.keys(secrets).length === 2;
    game = both
      ? { ...g, secrets, phase: 'play', mode: 'ask', turn: g.userId, hunts: { [g.userId]: newBoard(rnd), [g.opponentId]: newBoard(rnd) } }
      : { ...g, secrets };
    return game;
  });
  if (already) return { error: `You already hid ${current.secrets[userId]}. Wait for your opponent.` };
  if (!game) return null;
  const secret = `Your secret hero is **${hero}**. ${nameOf(game, other(game, userId))} has to find them.`;
  return { private: secret, update: game.phase === 'play' ? await duelView(id, game, pickRandom(START_LINES)) : pickView(id, game) };
}

// The detective whose turn it is, or an error for anyone else. Returns { error } or null.
function turnError(game, userId) {
  if (solo(game)) return userId === game.userId ? null : { error: `That's ${game.name}'s case. Start your own with \`/mini-game\`.` };
  if (userId !== game.userId && userId !== game.opponentId) return { error: `This case is between ${game.name} and ${game.opponentName}.` };
  return userId === game.turn ? null : { error: `It's ${nameOf(game, game.turn)}'s turn.` };
}

async function askQuestion(id, userId, q, rnd) {
  const current = await games().get(id);
  if (!current || current.phase !== 'play' || current.mode !== 'ask') return null;
  const wrong = turnError(current, userId);
  if (wrong) return wrong;
  let game = null;
  let yes;
  await games().update(id, (g) => {
    if (!g || g.done || g.phase !== 'play' || g.mode !== 'ask' || g.turn !== userId) return g;
    const board = g.hunts[userId];
    if (!board.hand.includes(q) || outOfQuestions(g, board)) return g; // an old dropdown
    const next = ask(board, q, targetOf(g, userId), rnd);
    yes = next.asked.at(-1)[1];
    const hunts = { ...g.hunts, [userId]: next };
    const turn = solo(g) ? userId : other(g, userId);
    game = { ...g, hunts, turn, mode: solo(g) && outOfQuestions(g, next) ? 'accuse' : 'ask' };
    return game;
  });
  if (!game) return null;
  const footer = solo(game) && outOfQuestions(game, game.hunts[userId]) ? pickRandom(LAST_LINES) : pickRandom(yes ? YES_LINES : NO_LINES);
  return playView(id, game, footer);
}

async function setMode(id, userId, mode) {
  const current = await games().get(id);
  if (!current || current.phase !== 'play') return null;
  const wrong = turnError(current, userId);
  if (wrong) return wrong;
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.done || g.phase !== 'play' || g.turn !== userId || g.mode === mode) return g;
    if (mode === 'ask' && outOfQuestions(g, g.hunts[userId])) return g;
    game = { ...g, mode };
    return game;
  });
  if (!game) return null;
  return playView(id, game, mode === 'accuse' ? pickRandom(ACCUSE_LINES) : pickRandom(START_LINES));
}

async function accuse(id, userId, hero) {
  if (!NAMES.includes(hero)) return null;
  const current = await games().get(id);
  if (!current || current.phase !== 'play' || current.mode !== 'accuse') return null;
  const wrong = turnError(current, userId);
  if (wrong) return wrong;
  const game = await games().take(id, (g) => g.phase === 'play' && g.mode === 'accuse' && g.turn === userId && g.hunts[userId].suspects.includes(hero));
  if (!game) return null;
  if (solo(game)) {
    const right = hero === game.culprit;
    const balance = (await pay(game.userId, right ? winnings(game.bet, game.hunts[userId].asked.length) : 0)).souls;
    return soloResult(id, game, hero, balance);
  }
  const winner = hero === targetOf(game, userId) ? userId : other(game, userId);
  await pay(winner, pot(game), other(game, winner));
  return duelResult(id, game, userId, hero);
}

// casino.js gameButtons: args are [action, menu part?, picked value?] (a dropdown's value comes last).
function play(id, userId, [action, ...rest], rnd) {
  const value = rest.at(-1);
  if (action === 'accept') return accept(id, userId);
  if (action === 'decline') return decline(id, userId);
  if (action === 'ask') return askQuestion(id, userId, Number(value), rnd);
  if (action === 'accuse') return setMode(id, userId, 'accuse');
  if (action === 'back') return setMode(id, userId, 'ask');
  if (action === 'name') return accuse(id, userId, value);
  if (action === 'pick') return pickSecret(id, userId, value, rnd);
  return null;
}

// ---- time ran out (casino.js expireGames) ------------------------------------------------------------------------------
// Solo with a question asked: the case goes cold, the bet is lost. A duel: picking with one secret in, the one who never
// picked forfeits; mid-case, whoever's turn it was forfeits. Otherwise nothing was decided and everything staked goes back.
function finishOnTimeout(id, game) {
  if (solo(game)) {
    if (!game.hunts[game.userId].asked.length) return null;
    return {
      pays: [[game.userId, 0]],
      view: async (balance) => view({
        lines: [`**The case went cold. It was ${game.culprit}.**`],
        image: picture(id, await renderBoard({ ...boardPicture(id, game, game.userId), culprit: game.culprit })),
        fields: [['Questions Asked', String(game.hunts[game.userId].asked.length)], ...resultFields(game.bet, 0, balance)],
        buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
        footer: `"${pickRandom(TIMEOUT_LINES)}"`,
        mood: 'gloat',
        color: RED,
      }),
    };
  }
  let loser = null;
  if (game.phase === 'pick' && Object.keys(game.secrets).length === 1) loser = game.secrets[game.userId] ? game.opponentId : game.userId;
  if (game.phase === 'play') loser = game.turn;
  if (!loser) return null;
  const winner = other(game, loser);
  return {
    pays: [[winner, pot(game), loser]],
    view: () => view({
      lines: [`${mention(loser)} ${game.phase === 'pick' ? 'never picked a hero' : 'never made a move'}. ${mention(winner)} wins ${boldSouls(pot(game))}.`],
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
    return view({ lines: [`${mention(game.opponentId)} never answered. ${mention(game.userId)} got ${boldSouls(game.bet)} back.`], footer: `"${pickRandom(TIMEOUT_LINES)}"`, rows: [], mood: 'gloat' });
  }
  return view({
    lines: [`${mention(game.userId)} and ${mention(game.opponentId)} never picked a hero. Both got ${boldSouls(game.bet)} back.`],
    footer: `"${pickRandom(TIMEOUT_LINES)}"`,
    buttons: [rematchButton(game)],
    mood: 'gloat',
  });
}

module.exports = {
  games, staked, refunds, timeoutView, finishOnTimeout, loadHeroEmojis, startGame, play,
  useful, deal, ask, winnings, caseNo, PAYOUT, HAND, MAX_QUESTIONS, NAMES, BUTTON_ID, AGAIN_ID, PVP,
};
