// Rem's Remling Race, Rem's game (a horse race): pick 1 of 5 Remlings, then the message is edited every couple of
// seconds as they run along their lanes (emoji and dashes, no picture). A win pays your bet x that Remling's odds.
// Rules: server-plan.md ("Games").
const path = require('node:path');
const { ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { findEmoji } = require('./guild');
const { pickRandom, shuffle, randomInt } = require('./random');
const { ASSETS } = require('./art');
const { GREEN, RED, staked, plainTimeout, resultFields, playAgainButton, gameMessage, forGame } = require('./casino');

const ART = path.join(ASSETS, 'rem'); // deadlock.wiki (portraits, Lil Helpers icon), Remlings drawn from that icon, see assets/CREDITS.txt
const HOST = { color: 0x7b6cf6, name: "Rem's Remling Race", icon: path.join(ART, 'lil_helpers.png'), art: ART, prefix: 'rem' }; // Lil Helpers

const FINISH = 10; // cells to run; each cell is a dash
const STEP = 3; // a Remling moves 0, 1 or 2 cells a frame
const TICK_MS = 2000; // the message is edited this often (Discord allows about 5 edits per 5 s per channel)
const RTP = 95; // percent: a pick pays 95% / its chance to win, the house's small cut
const SHARES = [36, 26, 20, 11, 7]; // percent chance to win, handed to the 5 Remlings in a random order each race
const BUTTON_ID = 'remling'; // custom id: remling:<game id> on the dropdown, its value the lane 0-4
const { pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger
const AGAIN_ID = 'remling_again'; // custom id: remling_again:<bet>:<player id>

const COLOURS = ['red', 'blue', 'green', 'yellow', 'pink'];
const NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Pink'];
const emoji = ['🔴', '🔵', '🟢', '🟡', '🩷']; // the server's :remling_<colour>: found on startup (loadRemlingEmojis)

// Rem: a sleepy, friendly little familiar: naps and pillows, "buddies", dropped g's ("somethin'", "'em", "I'mma"),
// pouty when it loses (deadlock.wiki "Rem/Voice lines"). Original lines in that voice; one goes in the footer.
const START_LINES = [
  "I brought my buddies! Pick one to cheer for, okay?",
  "They're all my friends... but pick one. Shh, I won't tell the others.",
  "Ooh, a race! Pick the fast one. I gotta nap after.",
  "I got a good feelin' 'bout this. Pick a buddy!",
  "Everybody's ready... 'cept that one, he's yawnin'. Pick somebody!",
];
// While they run (the footer changes every frame).
const RACE_LINES = [
  "Run, buddies, run!",
  "We're gonna win thiiiiis!",
  "Ooh, that one's fast!",
  "Don't stop to nap!",
  "Go, go, go...",
  "I can't watch! ...I'm watchin'.",
  "Almost there, almost there!",
];
const WIN_LINES = [
  "Way to go! Your buddy was fastest. I'mma cry into my pillow.",
  "They did it! ...Mine were s'posed to win. Hooray, I guess.",
  "Ooh, I was close! Almost had 'em. Take your Souls...",
  "Aww. My buddies tried. Yours tried more.",
  "You picked the good one! I'm happy for you. A little.",
];
const LOSE_LINES = [
  "We did it! My buddies won! Sorry, yours was sleepy...",
  "Hooray! I keep winnin', then! Sorry 'bout your Souls.",
  "I got the Souls! ...Is it bad that I like it?",
  "Your buddy stopped to nap. Good idea, honestly. Night-night.",
  "Way to go, Remlings! I'mma buy somethin' with these!",
];
const TIMEOUT_LINES = [
  "Everybody fell asleep waitin'. Night-night, Souls back.",
  "Nobody picked... so we all took a nap. Race is off.",
  "Where'd my new friend go? Race is off, Souls are back.",
  "[Yawn] Too long. I like my pillow more. Souls back.",
];

// Games in progress. key: game id
const games = () => getStore('remlingGames');
const messages = new Map(); // game id -> the start message, so the race can edit it (lost on a restart: see gamesReady.js)

// ---- rules -------------------------------------------------------------------------------------

// What a Remling with `percent` chance to win pays, as a multiple of the bet (rounded down to 2 decimals).
const oddsFor = (percent) => Math.floor((RTP / percent) * 100 + 1e-6) / 100;
const prizeFor = (bet, odds) => Math.floor(bet * odds);

// The positions of the 5 Remlings after each frame, ending with `winner` alone at the finish. Any random
// race would do; it's re-run until the chosen winner wins it, so the chances stay exactly SHARES.
function raceFor(winner, rnd = randomInt) {
  for (;;) {
    let pos = SHARES.map(() => 0);
    const frames = [pos];
    while (Math.max(...pos) < FINISH) {
      pos = pos.map((p) => Math.min(FINISH, p + rnd(STEP)));
      frames.push(pos);
    }
    const leaders = pos.flatMap((p, i) => (p === FINISH ? [i] : []));
    if (leaders.length === 1 && leaders[0] === winner) return frames;
  }
}

// A new race: who is fast (chance per lane), who wins, and every frame of it.
function makeRace(rnd = randomInt) {
  const chances = shuffle(SHARES, rnd);
  let roll = rnd(100);
  const winner = chances.findIndex((c) => (roll -= c) < 0);
  return { odds: chances.map(oddsFor), winner, frames: raceFor(winner, rnd) };
}

// ---- messages ----------------------------------------------------------------------------------

// "> **1.** - - 🔴 - - - 🏁": the > gives the bar behind the numbers
const lane = (i, pos, flag = '🏁') => `> **${i + 1}.** ${[...Array(pos).fill('-'), emoji[i], ...Array(FINISH - pos).fill('-'), flag].join(' ')}`;
const track = (positions, winner) => positions.map((p, i) => lane(i, p, i === winner ? '🏆' : '🏁')).join('\n');
const backing = (game) => `You backed ${emoji[game.pick]} **${NAMES[game.pick]}** at **${game.odds[game.pick]}×**.`;

// The template every game follows (his pick Oct 22): one line on top (plain while playing, bold once it's over), the
// track under it, the money in fields, green / red at the end.
function startView(id, game) {
  return gameMessage(HOST, {
    lines: ['Pick your Remling, then watch them go!', '', track(game.frames[0])],
    fields: [['Bet', game.bet]],
    // one dropdown, not five buttons: the buttons wrapped onto two rows on a phone (his call Oct 22)
    rows: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`${BUTTON_ID}:${id}`)
      .setPlaceholder('Pick your Remling...')
      .addOptions(game.odds.map((o, i) => ({ label: `${NAMES[i]} (${o}×)`, value: String(i), emoji: emoji[i] }))))],
    footer: `"${pickRandom(START_LINES)}"`,
  });
}

// Frame `f` of the race. Later frames leave out the pictures (Discord keeps the ones already on the message).
function raceView(game, f, withFiles = false) {
  const { files, ...rest } = gameMessage(HOST, {
    lines: [backing(game), '', track(game.frames[f])],
    fields: [['Bet', game.bet]],
    rows: [],
    footer: `"${RACE_LINES[f % RACE_LINES.length]}"`,
  });
  return withFiles ? { files, ...rest } : rest;
}

function endView(id, game) {
  const won = game.pick === game.winner;
  const prize = won ? prizeFor(game.bet, game.odds[game.pick]) : 0;
  const odds = `${game.odds[game.pick]}×`;
  const line = won
    ? `**${emoji[game.winner]} ${NAMES[game.winner]} wins the race! You backed it at ${odds}.**`
    : `**${emoji[game.winner]} ${NAMES[game.winner]} wins the race. You backed ${emoji[game.pick]} ${NAMES[game.pick]} at ${odds}.**`;
  return gameMessage(HOST, {
    lines: [line, '', track(game.frames[game.frames.length - 1], game.winner)],
    buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
    fields: resultFields(game.bet, prize, game.balance),
    footer: `"${pickRandom(won ? WIN_LINES : LOSE_LINES)}"`,
    mood: won ? 'injured' : 'gloat', // gloats when you lose, hurt when you win
    color: won ? GREEN : RED,
  });
}

// Takes the bet and sets up the race. Returns a message payload, or { error }.
async function startGame(user, name, bet, race = makeRace()) {
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({ userId: user.id, name, bet, ...race, pick: null }));
  return error ? { error } : startView(id, game);
}

// casino.js calls this once the start message is up: the race edits it.
async function posted(id, message) {
  messages.set(id, message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs the race: edits the message every tickMs, then pays out. edit: changes the game's message.
async function run(id, edit, tickMs = TICK_MS) {
  const game = await games().get(id);
  if (!game || game.pick === null) return;
  for (let f = 1; f < game.frames.length; f++) {
    await sleep(tickMs);
    await edit(raceView(game, f)).catch((e) => console.error('[games] Remling Race could not edit:', e.message)); // the race still ends
  }
  const done = await games().take(id, (g) => g.pick !== null); // taken inside the lock, so it can only be paid once
  if (!done) return;
  const won = done.pick === done.winner;
  const user = await pay(done.userId, won ? prizeFor(done.bet, done.odds[done.pick]) : 0);
  await edit({ ...endView(id, { ...done, balance: user.souls }), attachments: [] });
}

// A Remling button. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
async function pick(id, userId, lane) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s race. Start your own with \`/mini-game\`.` };
  if (current.pick !== null || !(lane >= 0 && lane < COLOURS.length)) return null;
  let game = null;
  await games().update(id, (g) => {
    if (!g || g.pick !== null) return g; // someone clicked twice: only the first counts
    game = { ...g, pick: lane };
    return game;
  });
  if (!game) return null;
  const message = messages.get(id);
  if (message) {
    run(id, (payload) => message.edit(payload))
      .catch((e) => console.error('[games] Remling Race failed:', e.message))
      .finally(() => messages.delete(id));
  }
  return raceView(game, 0, true);
}

// Called off (casino.js expireGames: never picked, or the bot restarted mid-race): the bet back.
const timeoutView = plainTimeout(HOST, TIMEOUT_LINES, AGAIN_ID);

// On startup: the Remling icons as :remling_<colour>: emojis, used in the lanes and buttons.
function loadRemlingEmojis(guild) {
  for (const [i, colour] of COLOURS.entries()) {
    emoji[i] = findEmoji(guild, `remling_${colour}`).toString();
  }
}

module.exports = {
  games, staked, timeoutView, loadRemlingEmojis, startGame, posted, run, pick, makeRace, raceFor, oddsFor, prizeFor,
  SHARES, FINISH, BUTTON_ID, AGAIN_ID,
};
