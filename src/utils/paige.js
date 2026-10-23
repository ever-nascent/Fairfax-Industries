// Don't Wake the Bookwyrm, Paige's game (Hangman, his pick Oct 20-21): a word from Deadlock (a hero, an ability or an item: the chapter) is hidden
// as blanks. Pick letters from two dropdowns (A-M, N-Z) or press Solve It and type the word. Every wrong letter, and every wrong solve, wakes
// the Bookwyrm a little more; the 6th wakes her and the bet is lost. Solving it pays the bet x a multiple that falls with every wrong guess.
// The picture is an open storybook (paigeBook.js, paigeWyrm.js): the Bookwyrm changes every 2 wrong guesses. Rules: server-plan.md ("Games").
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getStore } = require('../storage');
const { heroes, items } = require('./trivia');
const { pickRandom, randomInt } = require('./random');
const { ASSETS } = require('./art');
const { renderBook, MAX_WRONG } = require('./paigeBook');
const { staked, plainTimeout, resultFields, playAgainButton, gameMessage, forGame, GREEN, RED } = require('./casino');

const ART = path.join(ASSETS, 'paige'); // deadlock.wiki (portraits, the Bookwyrm icon), see assets/CREDITS.txt
const HOST = { color: 0x3fae6a, name: "Don't Wake the Bookwyrm", icon: path.join(ART, 'icon.png'), art: ART, prefix: 'paige' }; // her green

const BUTTON_ID = 'hangman'; // custom id: hangman:<game id>:<0 = A-M, 1 = N-Z> (the letter dropdowns)
const SOLVE_ID = 'hangman_solve'; // custom id: hangman_solve:<game id> (the Solve It button and its pop-up)
const AGAIN_ID = 'hangman_again'; // custom id: hangman_again:<bet>:<player id>
const { pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger

// What a win pays, as a multiple of the bet, by the wrong guesses made when it was solved (0-5; a win never pays less than the bet). Set so a
// typical player (knows 60% of the names) gets back about 95% (tools/hangman-rtp.js). Someone who knows every name, or a script with the list, gets
// about 150%: the words are few and public, so this game can't be made fair to them without making it stingy for everyone else.
const PAYOUT = [1.55, 1.35, 1.2, 1.1, 1.05, 1.0];
const winnings = (bet, wrong) => Math.floor(bet * PAYOUT[Math.min(wrong, PAYOUT.length - 1)]);

// Paige: an earnest, nervous bookworm who is thrilled by stories and dragons (deadlock.wiki "Paige/Voice lines", read Oct 21: 277 lines, about 8
// words each, 46% in the first person, 39% end in "!", 45% use a contraction; she hesitates and apologises ("uh...", "Heh.", "Sorry!"), says
// "gonna" and "gotta", jokes about her dad's bookstore, Storytime, book club, plot armor, and loves "the part where the dragon eats everyone").
// Original lines in that voice, short and mostly about herself, not narration; one goes in the footer (footers can't be italic).
const START_LINES = [
  "Okay, she's asleep. Everybody just... stay quiet, please!",
  "Who doesn't love a story with a dragon? ...A sleeping dragon. Let's keep it that way.",
  "Have I got a story for you! Just, uh, don't wake the dragon.",
  "Pick a letter! Gently. She's a really light sleeper.",
  "I promised her a nap. Please don't make me a liar!",
  "This one's one of my favourites. And she bites. Heh.",
];
const HIT_LINES = [
  "Ooh, that fits! Did you guys see that?",
  "Okay, okay, this is going good!",
  "That's the right letter! This is getting exciting!",
  "Yes! The story's really coming together!",
  "Perfect! Not even a rustle. I think. Heh.",
  "I love it when the pieces just click!",
];
const MISS_LINES = [
  "Oh no. Oh no, she moved! Was that her wing?",
  "Uh... that's not in this one. Sorry!",
  "Shh, shh, shh. Everybody breathe. She's still out.",
  "Okay, that one made my heart jump. Heh.",
  "Not that letter! She twitched! I saw it!",
  "Ugh, I can't look. Is she still asleep?",
];
const LAST_LINES = [
  "Okay. Okay okay okay. One more and she's awake. No pressure!",
  "I really need you to not mess this one up. Sorry! I'm sorry.",
  "Her eye's open. Her eye is OPEN!",
  "I gotta be honest, I'm really nervous right now.",
];
const WIN_LINES = [
  "You did it! I can't believe we got away with that!",
  "Plot armor works on dragons too, apparently!",
  "Happily ever after! I love it when that happens.",
  "That's how a story's supposed to end! Great job!",
  "Phew! That was a little too exciting for me. Nice work!",
];
const LOSE_LINES = [
  "Oh no. She's awake. I'm, uh, gonna hide behind my book.",
  "Well. This is the part where the dragon eats everyone. I did warn you!",
  "Sorry! I really thought we had her. Next chapter?",
  "To be continued... right? Please say there's a next chapter.",
  "Okay, I take it back. Maybe book club was safer.",
];
const TIMEOUT_LINES = [
  "Nobody was turning pages, so I tucked her in. Souls back!",
  "Uh, hello? Okay, I'll just close the book. Your Souls are back.",
  "I got a little nervous waiting, so I closed it. Souls back, sorry!",
];
const FORFEIT_LINES = [
  "You left in the middle of the story?! Sorry, the Bookwyrm kept the Souls.",
  "Aw, you didn't even finish the chapter. She kept your Souls, I'm sorry!",
  "I think she ate the rest of the story. And your Souls. Sorry!",
];

// Games in progress. key: game id
// { userId, name, bet, word, category, hits: [right letters], wrong: [wrong letters, '?' for a wrong solve], done, won, balance, version }
const games = () => getStore('hangmanGames');

// ---- the words ---------------------------------------------------------------------------------------------------------

// Upper case, accents off. Letters are A-Z; anything else in a name (space, ' - & , ! digits) is printed from the start.
const normalize = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
const isLetter = (ch) => /^[A-Z]$/.test(ch);
const lettersOf = (word) => [...new Set([...word].filter(isLetter))];

// The chapters: every hero, ability and item of the trivia data (assets/trivia, kept fresh by the startup check).
let pool;
function wordPool() {
  pool ??= {
    Heroes: [...new Set(heroes().map((h) => normalize(h.name)))],
    Abilities: [...new Set(heroes().flatMap((h) => h.abilities.map((a) => normalize(a.name))))],
    Items: [...new Set(items().map((i) => normalize(i.name)))],
  };
  return pool;
}
// A chapter at random, then a word from it (so the 43 heroes come up as often as the 150 items).
function pickWord(rnd = randomInt) {
  const chapters = Object.keys(wordPool());
  const category = pickRandom(chapters, rnd);
  return { category, word: pickRandom(wordPool()[category], rnd) };
}

// ---- rules -------------------------------------------------------------------------------------------------------------

const used = (game) => new Set([...game.hits, ...game.wrong.filter(isLetter)]);
const complete = (game) => lettersOf(game.word).every((ch) => game.hits.includes(ch));

// A letter guessed: returns the new state (unchanged if the letter was used already or the game is over).
function guessLetter(game, letter) {
  if (game.done || !isLetter(letter) || used(game).has(letter)) return game;
  const next = { ...game, version: game.version + 1 };
  if (game.word.includes(letter)) next.hits = [...game.hits, letter]; else next.wrong = [...game.wrong, letter];
  if (next.wrong.length >= MAX_WRONG) Object.assign(next, { done: true, won: false });
  else if (complete(next)) Object.assign(next, { done: true, won: true });
  return next;
}

// A solve attempt (the typed word): spaces, punctuation and case don't matter. A wrong one costs a wrong guess, shown as a '?'.
const squash = (text) => normalize(text).replace(/[^A-Z0-9]/g, '');
function solveWord(game, text) {
  if (game.done) return game;
  const next = { ...game, version: game.version + 1 };
  if (squash(text) === squash(game.word)) Object.assign(next, { hits: lettersOf(game.word), done: true, won: true });
  else {
    next.wrong = [...game.wrong, '?'];
    if (next.wrong.length >= MAX_WRONG) Object.assign(next, { done: true, won: false });
  }
  return next;
}
const prizeOf = (game) => (game.won ? winnings(game.bet, game.wrong.length) : 0);

// ---- messages ----------------------------------------------------------------------------------------------------------

const say = (lines) => `"${pickRandom(lines)}"`;

// The two letter dropdowns (A-M, N-Z; a letter leaves its dropdown once used) and Solve It.
function controls(id, game) {
  const taken = used(game);
  const menu = (half, from, to) => {
    const left = [];
    for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code++) if (!taken.has(String.fromCharCode(code))) left.push(String.fromCharCode(code));
    const select = new StringSelectMenuBuilder().setCustomId(`${BUTTON_ID}:${id}:${half}`).setPlaceholder(`Letters ${from} - ${to}  (${left.length} left)`);
    // a dropdown needs at least one option: with none left it is switched off
    select.addOptions(left.length ? left.map((letter) => ({ label: letter, value: letter })) : [{ label: '-', value: 'none' }]);
    return new ActionRowBuilder().addComponents(select.setDisabled(!left.length));
  };
  const solve = new ButtonBuilder().setCustomId(`${SOLVE_ID}:${id}`).setLabel('Solve It').setStyle(ButtonStyle.Success);
  return [menu(0, 'A', 'M'), menu(1, 'N', 'Z'), new ActionRowBuilder().addComponents(solve)];
}

// The game's message. `note`: what the last guess did (shown above the status), `balance`: set once it is over.
async function view(id, game, note = null) {
  const image = {
    name: `book_${id}_${game.version}_${Date.now()}.gif`,
    data: await renderBook({ word: game.word, hits: game.hits, wrong: game.wrong, category: game.category, result: game.done ? (game.won ? 'won' : 'lost') : null }),
  };
  // The template every game follows (his pick Oct 22): one plain line and the state in fields while playing (Bet last), one
  // bold line, the money in fields and green / red once it's over.
  if (!game.done) {
    const left = MAX_WRONG - game.wrong.length;
    // what just happened (or, on the opening screen, how to play), then the status in fields
    const lines = [note ?? `Pick a letter below, or press **Solve It**. ${MAX_WRONG} wrong guesses wake the Bookwyrm.`];
    const fields = [['Guesses Left', `${left} of ${MAX_WRONG}`], ['Solving Pays', winnings(game.bet, game.wrong.length)], ['Bet', game.bet]];
    return gameMessage(HOST, { lines, image, fields, rows: controls(id, game), footer: say(!game.wrong.length && !game.hits.length ? START_LINES : left === 1 ? LAST_LINES : note?.startsWith('No ') ? MISS_LINES : HIT_LINES) });
  }
  const prize = prizeOf(game);
  const how = game.won ? 'You solved it!' : game.forfeit ? 'You left the story unfinished.' : 'The Bookwyrm awakens!';
  const lines = game.won ? [how, `The word was **${game.word}**`] : [`**${how} The word was ${game.word}.**`]; // a win: two lines, only the word in bold (his call, Oct 22)
  const fields = resultFields(game.bet, prize, game.balance);
  return gameMessage(HOST, {
    lines, image,
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    fields,
    footer: say(game.won ? WIN_LINES : game.forfeit ? FORFEIT_LINES : LOSE_LINES),
    mood: game.won ? 'gloat' : 'injured', // happy for you when you solve it, hiding behind her book when you lose
    color: game.won ? GREEN : RED,
  });
}

// ---- playing -----------------------------------------------------------------------------------------------------------

// Takes the bet and opens a game. Returns a message payload, or { error }.
async function startGame(user, name, bet, pick = pickWord()) {
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({
    userId: user.id, name, bet, ...pick, hits: [], wrong: [], done: false, won: false, version: 0,
  }));
  return error ? { error } : view(id, game);
}

// The player's open game, or { error } (someone else's, or already over: stale clicks are ignored by returning null).
async function mine(id, userId) {
  const game = await games().get(id);
  if (!game) return { stale: true };
  if (game.userId !== userId) return { error: `That's ${game.name}'s story. Start your own with \`/mini-game\`.` };
  return { game };
}

// Applies `change(state)` to the player's game inside the store's lock (a double click can't play twice), pays out if that ended it, and returns
// the new message. Returns { error } (shown only to the clicker) or null (a stale click).
async function play(id, userId, change, note) {
  const found = await mine(id, userId);
  if (found.error) return found;
  if (found.stale) return null;
  let before = null, after = null;
  await games().update(id, (g) => {
    if (!g || g.done) return g;
    before = g;
    after = change(g);
    return after.version === g.version ? g : { ...after, at: Date.now() };
  });
  if (!after || after.version === before.version) return null;
  if (!after.done) return view(id, after, note(before, after));
  const user = await pay(userId, prizeOf(after));
  await games().delete(id);
  return view(id, { ...after, balance: user.souls });
}

// A letter picked from a dropdown.
const guess = (id, userId, letter) => play(id, userId, (g) => guessLetter(g, letter), (before, after) => (after.hits.length > before.hits.length ? `**${after.hits.at(-1)}** is in the story!` : `No **${after.wrong.at(-1)}** in this story.`));

// The typed word from the Solve It pop-up.
const solve = (id, userId, text) => play(id, userId, (g) => solveWord(g, text), () => "That isn't how the story ends.");

// The Solve It button: an error (not your game) or null, then the pop-up.
async function solveError(id, userId) {
  const found = await mine(id, userId);
  return found.error ?? (found.stale ? 'That story is already finished. Start a new one with `/mini-game`.' : null);
}
const solveModal = (id) => new ModalBuilder().setCustomId(`${SOLVE_ID}:${id}`).setTitle('Solve It').addComponents(
  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer').setLabel("The word (a wrong answer wakes her)").setStyle(TextInputStyle.Short).setMaxLength(60).setRequired(true)),
);

// Time ran out (casino.js expireGames): once a letter has been picked the player walked away from a story half read, so it is lost; before that
// the bet goes back.
function finishOnTimeout(id, state) {
  if (!state.hits.length && !state.wrong.length) return null;
  const game = { ...state, done: true, won: false, forfeit: true };
  return { pays: [[game.userId, 0]], view: (balance) => view(id, { ...game, balance }) };
}

const timeoutView = plainTimeout(HOST, TIMEOUT_LINES, AGAIN_ID);

module.exports = {
  games, staked, timeoutView, finishOnTimeout, startGame, guess, solve, solveError, solveModal, view,
  guessLetter, solveWord, pickWord, wordPool, winnings, normalize, lettersOf, PAYOUT, MAX_WRONG, BUTTON_ID, SOLVE_ID, AGAIN_ID,
};
