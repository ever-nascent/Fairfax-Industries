// Don't Wake the Bookwyrm, Paige's game (Hangman, his pick Oct 20-21): a word from Deadlock (a hero, an ability or an item: the chapter) is hidden
// as blanks. Pick letters from two dropdowns (A-M, N-Z) or press Solve It and type the word. Every wrong letter, and every wrong solve, wakes
// the Bookwyrm a little more; the 6th wakes her and the bet is lost. Solving it pays the bet x a multiple that falls with every wrong guess.
// The picture is an open storybook (paigeBook.js, paigeWyrm.js): the Bookwyrm changes every 2 wrong guesses. Rules: server-plan.md ("Games").
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getStore } = require('../storage');
const { heroes, items } = require('./trivia');
const { soulsText, boldSouls } = require('./format');
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

// Paige: a bookish, gentle librarian who loves a story and is fond of her sleeping Bookwyrm (deadlock.wiki "Paige/Voice lines"). Original lines
// in that voice; one goes in the footer.
const START_LINES = [
  "Every story has an ending. Let's make sure yours is a happy one!",
  "Shh... she's sleeping. Pick your letters softly.",
  "Oh, I do love a good mystery. Let's turn the first page.",
  "Careful now. She only sleeps lightly between chapters.",
  "Once upon a time, someone bet on a dragon's nap. Hmm. That's you.",
];
const HIT_LINES = [
  "Ooh, a plot twist in your favor!",
  "That fits the story perfectly!",
  "Yes! Keep reading, the ending is close.",
  "Lovely! The words are falling into place.",
  "A fine guess. Not even a rustle from the Bookwyrm.",
];
const MISS_LINES = [
  "Oh dear. She stirred. Quietly now.",
  "That letter isn't in this chapter... shh!",
  "A bit of ink spilled. Tiptoe!",
  "Careful, careful. Her eyes twitched.",
  "Not that one. The pages are rustling...",
];
const LAST_LINES = [
  "One more wrong turn and she wakes. Take your time.",
  "Don't breathe. She's nearly awake.",
  "Her eyes are opening. Choose wisely!",
];
const WIN_LINES = [
  "A perfect ending! I knew you had it in you.",
  "And they all read happily ever after. Well done!",
  "The End. What a wonderful chapter!",
  "You solved the story and spared my Bookwyrm. Splendid!",
];
const LOSE_LINES = [
  "Oh dear. Not every chapter ends well. Shall we turn the page?",
  "Well, she's awake now. To be continued...",
  "That's the thing about dragons. They don't stay asleep. Another try?",
  "Every story has its tragedies. Chin up, the next chapter's yours.",
];
const TIMEOUT_LINES = [
  "Nobody turned the page, so I closed the book. Souls back.",
  "She's still sleeping, and so was the game. Souls back.",
  "You left the book open and wandered off. I tucked her in. Souls back.",
];
const FORFEIT_LINES = [
  "You closed the book in the middle of the story. The Bookwyrm kept the Souls.",
  "Walked off mid-chapter! She woke up lonely. The Souls stay in the book.",
  "A story left unfinished... The Bookwyrm will keep your Souls for it.",
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
    name: `book_${id}_${game.version}_${Date.now()}.png`,
    data: await renderBook({ word: game.word, hits: game.hits, wrong: game.wrong, category: game.category, result: game.done ? (game.won ? 'won' : 'lost') : null }),
  };
  const head = `<@${game.userId}> bet ${boldSouls(game.bet)}.`;
  if (!game.done) {
    const left = MAX_WRONG - game.wrong.length;
    const lines = [head, `A word from the **${game.category}** chapter.`];
    if (!note) lines.push(`**${MAX_WRONG}** wrong guesses and the Bookwyrm wakes.`);
    lines.push('', ...(note ? [note] : []), `**${left}** wrong ${left === 1 ? 'guess' : 'guesses'} left. Solving now pays ${boldSouls(winnings(game.bet, game.wrong.length))}.`);
    return gameMessage(HOST, { lines, image, rows: controls(id, game), footer: say(!game.wrong.length && !game.hits.length ? START_LINES : left === 1 ? LAST_LINES : note?.startsWith('No ') ? MISS_LINES : HIT_LINES) });
  }
  const prize = prizeOf(game);
  const lines = game.won
    ? [head, `<@${game.userId}> solved it: **${game.word}**!`, '', `**You win ${soulsText(prize)}.**`]
    : [head, game.forfeit ? 'The story was left unfinished.' : 'The Bookwyrm woke up!', `The word was **${game.word}**.`, '', `**You lose ${soulsText(game.bet)}.**`];
  return gameMessage(HOST, {
    lines, image,
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    fields: resultFields(game.bet, prize, game.balance),
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
