// Shotgun Roulette, Silver's game, modelled on Buckshot Roulette: a shotgun with a shown mix of live and blank shells,
// shoot the other player or yourself, a blank on yourself keeps your turn, empty chamber = reload, last one with
// charges wins. Every load deals both players items (his picks Oct 22: the Buckshot names, 6 of them, standard emojis).
// Against Silver (a win pays PAYOUT, she uses her items too) or a member (both stake, winner takes the pot).
// Rules: server-plan.md ("Games").
const path = require('node:path');
const { ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { fmt, boldSouls } = require('./format');
const { pickRandom, shuffle, randomInt } = require('./random');
const { ASSETS } = require('./art');
const { findEmoji } = require('./guild');
const { GREEN, RED, mention, pot, resultFields, playAgainButton, gameMessage, timeoutMessage, forGame } = require('./casino');

const ART = path.join(ASSETS, 'silver'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0x9aa5b1, name: "Silver's Shotgun Roulette", icon: path.join(ART, 'slam_fire.png'), art: ART, prefix: 'silver' };

const PAYOUT = 1.85;
const PVP = true; // casino.js: /mini-game accepts an opponent for this game
const CHARGES = 3;
const DEAL = 2; // items each player gets every time the shotgun is loaded
const MAX_ITEMS = 8;
const SILVER = 'silver'; // her key in `charges` / `turn`
const BUTTON_ID = 'roulette'; // custom id: roulette:<game id>:<accept|decline|other|self>, the item dropdown roulette:<game id>:item
const { takeBet, pay, openGame } = forGame(BUTTON_ID); // souls go through these, tagged for the ledger
const AGAIN_ID = 'roulette_again'; // custom id: roulette_again:<bet>:<player id>[:<other player's id>]
const winnings = (bet) => Math.floor(bet * PAYOUT);

// The items (Buckshot Roulette's). Every line the game says is in Title Case (his ask Oct 22); her footer lines are speech.
const ITEMS = {
  glass: { emoji: '🔍', name: 'Magnifying Glass', does: () => 'See The Next Shell' },
  beer: { emoji: '🍺', name: 'Beer', does: () => 'Rack Out The Next Shell Without Firing It' },
  saw: { emoji: '🪚', name: 'Handsaw', does: () => 'Your Next Live Shot Takes 2 Charges' },
  cuffs: { emoji: '⛓️', name: 'Handcuffs', does: (foe) => `${foe} Skips ${foe === 'Silver' ? 'Her' : 'Their'} Next Turn` },
  smokes: { emoji: '🚬', name: 'Cigarettes', does: () => 'Get 1 Charge Back' },
  inverter: { emoji: '🔄', name: 'Inverter', does: () => 'Flip The Next Shell: Live To Blank, Blank To Live' },
};
const KEYS = Object.keys(ITEMS);

// Original lines in Silver's voice: broke, sarcastic, tired, a bounty hunter (deadlock.wiki "Silver/Voice lines").
// Rougher since Oct 22 (his ask: swear like she does in the game: damn, hell, shit, bastard); none copied from her voice lines.
const WIN_LINES = [
  'Damn, that was easy. Pay the lady.',
  'Hell yeah. Drinks are on you, technically.',
  'Tough break, dumbass. Next.',
  "Don't cry on my table. It's the only clean thing I own.",
  'Easy money. Finally, some damn luck.',
];
const LOSE_LINES = [
  'Well, shit. That one had my name on it.',
  'Lucky bastard. Take it before I change my mind.',
  "Fine. Keep it. I'll find more bad decisions.",
  'Son of a... yeah, okay. You earned it.',
  'That was way too damn close.',
];
const DUEL_LINES = [
  "Somebody's buyin' the next round, and it ain't the loser.",
  'Hell of a show. You two are sick bastards.',
  'Load it, spin it, pray it.',
  "Damn. I've seen bar fights with better manners.",
];
const TURN_LINES = [
  "Hair of the dog. Pull it, or don't.",
  'Pull the damn trigger already.',
  "Your call. I've made worse ones before noon.",
  "Shoot me, shoot yourself. Somebody's payin' my tab.",
  "Quit starin' at it like it owes you money.",
  "Hell, I'd shoot. But I'm a lousy role model.",
];
const TIMEOUT_LINES = [
  'Nobody pulled the trigger. Your Souls are back, coward.',
  "Too damn slow. I've got a bar to get to.",
  "Fine, walk. I'll be here. Drinkin'.",
  'Chickened out? Shit. Here, take your Souls.',
];

// Games in progress, saved so a restart doesn't eat bets. key: game id
// { userId, name, bet, opponentId (null = Silver), opponentName, phase: 'invite' | 'play', players: [first, second],
//   charges: { player: n }, shells: [remaining 'live' | 'blank'], turn, log: [what just happened], done, at,
//   items: { player: [item keys] }, saw (the next shot is sawed off), cuffed / freed (who skips their next turn / just
//   skipped one and can't be cuffed again yet), flipped (an Inverter flipped the next shell: the shown counts don't
//   change), known: { player: what they saw the next shell is }, acted (the log is this turn's item uses) }
const games = () => getStore('rouletteGames');

const solo = (game) => !game.opponentId;
const staked = (game) => (!solo(game) && game.phase === 'play' ? game.bet * 2 : game.bet);
const refunds = (game) =>
  !solo(game) && game.phase === 'play' ? [[game.userId, game.bet], [game.opponentId, game.bet]] : [[game.userId, game.bet]];
const nameOf = (game, id) => (id === game.userId ? game.name : game.opponentName);
const foeOf = (game, id) => game.players.find((p) => p !== id);
const itemsOf = (game, id) => game.items?.[id] ?? [];

// emoji: the server's emojis found on startup (loadShellEmojis), a plain one until then.
const SHELLS = {
  live: { name: 'shell_live', emoji: '🔴' }, blank: { name: 'shell_blank', emoji: '🔵' },
  charge: { name: 'charge', emoji: '❤️' }, lost: { name: 'charge_lost', emoji: '🖤' },
};
function loadShellEmojis(guild) {
  for (const shell of Object.values(SHELLS)) shell.emoji = findEmoji(guild, shell.name).toString();
}
const shellName = (shell) => `${SHELLS[shell].emoji} ${shell === 'live' ? 'Live' : 'Blank'}`;
const RELOAD = '*Silver Reloads The Shotgun. 2 Items Each.*';

// ---- rules -------------------------------------------------------------------------------------

// 2-8 shells, 1-3 live, at least one blank; the counts are shown, the order is not.
function loadShells(rnd = randomInt) {
  const total = 2 + rnd(7);
  const live = 1 + rnd(Math.min(3, total - 1));
  return shuffle([...Array(live).fill('live'), ...Array(total - live).fill('blank')], rnd);
}
const count = (shells) => ({ live: shells.filter((s) => s === 'live').length, blank: shells.filter((s) => s === 'blank').length });
const flip = (shell) => (shell === 'live' ? 'blank' : 'live');

// DEAL random items to each player, keeping at most MAX_ITEMS.
const deal = (game, rnd = randomInt) => Object.fromEntries(game.players.map((p) =>
  [p, [...itemsOf(game, p), ...Array.from({ length: DEAL }, () => KEYS[rnd(KEYS.length)])].slice(0, MAX_ITEMS)]));
// A new load: shells and items; what anyone saw is gone.
const reload = (game, rnd) => ({ shells: loadShells(rnd), items: deal(game, rnd), flipped: false, known: {} });

// The counts the players see: as loaded, so an Inverter's flip doesn't show.
function shown(game) {
  const c = count(game.shells);
  if (game.flipped && game.shells.length) { c[game.shells[0]]--; c[flip(game.shells[0])]++; }
  return c;
}
// The chance the next shell is live, from what `who` knows (what they saw, else the shown counts and any flip).
function liveChance(game, who) {
  const seen = game.known?.[who];
  if (seen) return seen === 'live' ? 1 : 0;
  const { live, blank } = shown(game);
  const p = live / (live + blank);
  return game.flipped ? 1 - p : p;
}
const canCuff = (game, who) => !game.cuffed && game.freed !== foeOf(game, who);

// One shot by whoever's turn it is. Returns the new game state (nothing saved) with `event` for the message.
function fire(game, atSelf, rnd = randomInt) {
  const shooter = game.turn;
  const other = foeOf(game, shooter);
  const target = atSelf ? shooter : other;
  const [shell, ...rest] = game.shells;
  const hit = shell === 'live' ? (game.saw ? 2 : 1) : 0;
  const charges = { ...game.charges, [target]: Math.max(0, game.charges[target] - hit) };
  const over = charges[target] <= 0;
  const reloaded = !over && rest.length === 0;
  const keeps = shell === 'blank' && atSelf;
  const skipped = !keeps && game.cuffed === other; // cuffed: the turn comes straight back
  return {
    ...game,
    charges,
    ...(reloaded ? reload(game, rnd) : { shells: rest, flipped: false, known: {} }),
    saw: false,
    turn: keeps || skipped ? shooter : other,
    cuffed: skipped ? null : game.cuffed ?? null,
    freed: skipped ? other : keeps ? game.freed ?? null : null,
    winner: over ? foeOf(game, target) : null,
    event: { shooter, target, shell, hit, reloaded, skipped: skipped ? other : null },
  };
}

// The player whose turn it is uses an item. Returns { game, secret } (secret: what only they see) or { error }.
// The item's line is added to the log.
function useItem(game, key, rnd = randomInt) {
  const who = game.turn;
  const foe = foeOf(game, who);
  const mine = itemsOf(game, who);
  if (!mine.includes(key)) return { error: "You Don't Have That Item." };
  const [next, ...rest] = game.shells;
  let g = { ...game, items: { ...game.items, [who]: mine.filter((k, i) => i !== mine.indexOf(key)) } };
  let text, secret = null;
  if (key === 'glass') {
    g.known = { ...g.known, [who]: next };
    secret = `🔍 The Next Shell Is **${shellName(next)}**.`;
    text = 'Used The 🔍 Magnifying Glass.';
  } else if (key === 'beer') {
    g = { ...g, ...(rest.length ? { shells: rest, flipped: false, known: {} } : reload(g, rnd)) };
    text = `Drank A 🍺 Beer. Racked Out A ${shellName(next)} Shell.`;
    if (!rest.length) text += `\n${RELOAD}`;
  } else if (key === 'saw') {
    if (game.saw) return { error: 'The Barrel Is Already Sawed Off.' };
    g.saw = true;
    text = 'Used The 🪚 Handsaw. The Next Live Shell Takes 2 Charges.';
  } else if (key === 'cuffs') {
    if (!canCuff(game, who)) return { error: `${nameOf(game, foe)} Can't Be Cuffed Again Yet.` };
    g.cuffed = foe;
    text = `Used The ⛓️ Handcuffs. ${nameOf(game, foe)} Skips A Turn.`;
  } else if (key === 'smokes') {
    if (game.charges[who] >= CHARGES) return { error: 'You Already Have Every Charge.' };
    g.charges = { ...game.charges, [who]: game.charges[who] + 1 };
    text = 'Smoked The 🚬 Cigarettes. +1 Charge.';
  } else {
    g.shells = [flip(next), ...rest];
    g.flipped = !game.flipped;
    g.known = Object.fromEntries(Object.entries(game.known ?? {}).map(([p, s]) => [p, flip(s)]));
    text = 'Used The 🔄 Inverter. The Next Shell Is Flipped.';
  }
  const [first, ...more] = text.split('\n');
  g.log = [...(g.log ?? []), `**${nameOf(g, who)}** ${first}`, ...more];
  return { game: g, secret };
}

// What a sensible player does next, from what `who` can know (Silver plays by it; the odds test plays it too).
// Returns { item } or { shoot: atSelf }. Every item it picks changes what it knows or the game, so it can't loop.
function decide(game, who) {
  const has = (k) => itemsOf(game, who).includes(k);
  const foe = foeOf(game, who);
  const p = liveChance(game, who);
  const sure = p === 0 || p === 1;
  if (has('smokes') && game.charges[who] < CHARGES) return { item: 'smokes' };
  if (!sure && has('glass')) return { item: 'glass' };
  if (p < 0.5 && has('inverter')) return { item: 'inverter' }; // a likely blank becomes a likely live
  if (p === 0) return { shoot: true }; // a sure blank on yourself keeps the turn
  if (p < 0.5 && has('beer')) return { item: 'beer' };
  if (has('cuffs') && canCuff(game, who)) return { item: 'cuffs' };
  if (p >= 0.5 && has('saw') && !game.saw && game.charges[foe] > 1) return { item: 'saw' }; // simulated: beats saving it for a sure live
  return { shoot: false };
}

const shotText = (game, { shooter, target, shell, hit }) => {
  const who = nameOf(game, shooter) ?? 'Silver';
  const self = shooter === SILVER ? 'Herself' : 'Themselves';
  const sound = shell === 'live' ? `**BANG.** Live.${hit > 1 ? ' Sawed Off: 2 Charges.' : ''}` : '*Click.* Blank.';
  return `**${who}** Shot ${target === shooter ? self : nameOf(game, target) ?? 'Silver'}: ${sound}`;
};

// One shot, with its lines added to the log.
function shot(game, atSelf, rnd) {
  const g = fire(game, atSelf, rnd);
  const { skipped, reloaded } = g.event;
  return {
    ...g,
    log: [...(game.log ?? []), shotText(g, g.event), ...(skipped ? [`*${nameOf(g, skipped)} Is Cuffed And Skips A Turn.*`] : []), ...(reloaded ? [RELOAD] : [])],
  };
}

// Plays the shot, then Silver's turn (her items, her shots) until it's a person's turn again (or it's over).
// The log keeps this turn's item uses (acted) and adds everything after them.
function play(game, atSelf, rnd = randomInt) {
  let g = shot({ ...game, log: game.acted ? game.log : [], acted: false }, atSelf, rnd);
  while (g.turn === SILVER && !g.winner) {
    const next = decide(g, SILVER);
    g = next.item ? useItem(g, next.item, rnd).game : shot(g, next.shoot, rnd);
  }
  return g;
}

// ---- messages ----------------------------------------------------------------------------------

// Every view but the invite clears the invite's @mention text.
const view = (message) => ({ ...gameMessage(HOST, { title: 'Shotgun Roulette', ...message }), content: '' });
// The shots so far, as a quote (the > bar)
const quote = (lines) => lines.map((l) => `> ${l}`);
const bolts = (n) => SHELLS.charge.emoji.repeat(n) + SHELLS.lost.emoji.repeat(CHARGES - n);
const bag = (game, p) => (itemsOf(game, p).length ? itemsOf(game, p).map((k) => ITEMS[k].emoji).join(' ') : 'No Items');

// The charges left, one field per player (the template every game follows, his pick Oct 22: one line, the state in
// fields); while playing, each player's items under them.
const chargeFields = (game, items = false) => game.players.map((p) => [
  nameOf(game, p),
  [bolts(game.charges[p]), ...(items ? [bag(game, p)] : []), ...(items && game.cuffed === p ? ['⛓️ Skips Next Turn'] : [])].join('\n'),
]);

// The turn player's items as one dropdown (5 buttons would wrap on a phone), one option per kind.
function itemMenu(id, game) {
  const mine = itemsOf(game, game.turn);
  if (!mine.length) return [];
  const foe = nameOf(game, foeOf(game, game.turn));
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`${BUTTON_ID}:${id}:item`)
    .setPlaceholder('Use An Item...')
    .addOptions([...new Set(mine)].map((k) => {
      const n = mine.filter((m) => m === k).length;
      return { label: `${ITEMS[k].name}${n > 1 ? ` (×${n})` : ''}`, description: ITEMS[k].does(foe), value: k, emoji: ITEMS[k].emoji };
    })))];
}

function inviteView(id, game) {
  const message = view({
    lines: [`${mention(game.userId)} Challenges ${mention(game.opponentId)}. Accept?`],
    fields: [['Bet Each', game.bet], ['Pot', pot(game)]],
    footer: '"Sit down. It\'s already loaded."',
    buttons: [[`${BUTTON_ID}:${id}:accept`, 'Accept', ButtonStyle.Success], [`${BUTTON_ID}:${id}:decline`, 'Decline', ButtonStyle.Danger]],
  });
  return { ...message, content: mention(game.opponentId) };
}

function playView(id, game) {
  const { live, blank } = shown(game);
  const turnName = nameOf(game, game.turn);
  const other = nameOf(game, foeOf(game, game.turn));
  const log = game.log?.length ? [...quote(game.log), ''] : ['Silver Loads The Shotgun. 2 Items Each.', ''];
  return view({
    lines: [...log, `${turnName}, Your Turn.${itemsOf(game, game.turn).length ? ' Use An Item, Or Shoot.' : ''}`],
    fields: [
      ...chargeFields(game, true),
      ['Shotgun', [`${SHELLS.live.emoji} ${live} Live`, `${SHELLS.blank.emoji} ${blank} Blank`, ...(game.saw ? ['🪚 Sawed Off'] : [])].join('\n')],
      ...(solo(game) ? [['Win Pays', winnings(game.bet)], ['Bet', game.bet]] : [['Pot', pot(game)]]),
    ],
    footer: `"${pickRandom(TURN_LINES)}"`,
    rows: [...itemMenu(id, game), [
      [`${BUTTON_ID}:${id}:other`, `Shoot ${other}`, ButtonStyle.Danger],
      [`${BUTTON_ID}:${id}:self`, 'Shoot Yourself', ButtonStyle.Secondary],
    ]],
  });
}

// Takes the bet and opens a new game. Returns a message payload, or { error } if they can't play.
async function startGame(user, name, bet, opponent = null) {
  if (opponent?.bot) return { error: 'Bots do not play roulette. Pick a member, or leave the opponent empty to face Silver.' };
  if (opponent?.id === user.id) return { error: 'You cannot play yourself. Pick another member, or leave it empty to face Silver.' };
  const otherId = opponent?.id ?? SILVER;
  const players = [user.id, otherId];
  const { error, id, game } = await openGame(games(), user.id, bet, () => ({
    userId: user.id, name, bet, done: false,
    opponentId: opponent?.id ?? null, opponentName: opponent ? opponent.globalName ?? opponent.username : 'Silver',
    phase: opponent ? 'invite' : 'play', players, charges: { [user.id]: CHARGES, [otherId]: CHARGES },
    turn: user.id, log: [], ...reload({ players }),
  }));
  if (error) return { error };
  return opponent ? inviteView(id, game) : playView(id, game);
}

// Over: the last shots, one bold line, the charges and the money in fields, green / red.
function resultView(game, balance) {
  const won = game.winner === game.userId;
  const log = [...quote(game.log), ''];
  if (solo(game)) {
    const paid = won ? winnings(game.bet) : 0;
    return view({
      lines: [...log, won ? '**You Outlasted Silver.**' : '**Silver Outlasted You.**'],
      fields: [...chargeFields(game), ...resultFields(game.bet, paid, balance)],
      buttons: [playAgainButton(AGAIN_ID, game.bet, game.userId)],
      footer: `"${pickRandom(won ? LOSE_LINES : WIN_LINES)}"`,
      mood: won ? 'injured' : 'gloat',
      color: won ? GREEN : RED,
    });
  }
  return view({
    lines: [...log, `**${mention(game.winner)} Is The Last One Standing.**`],
    fields: [...chargeFields(game), ['Winner', mention(game.winner)], ['Pot', pot(game)]],
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
    lines: [`${mention(game.opponentId)} Turned Down The Challenge. ${mention(game.userId)} Got ${boldSouls(game.bet)} Back.`],
    footer: '"Smart. Nobody walks away from this table with everything."',
    rows: [],
  });
}

// Why `userId` can't act in this game right now, or null.
function notYours(current, userId) {
  if (!current.players.includes(userId)) {
    return { error: solo(current) ? `That's ${current.name}'s game. Start your own with \`/mini-game\`.` : `This game is between ${current.name} and ${current.opponentName}.` };
  }
  return current.turn !== userId ? { error: `It's ${nameOf(current, current.turn)}'s turn.` } : null;
}

async function shoot(id, userId, atSelf) {
  const current = await games().get(id);
  if (!current || current.phase !== 'play') return null;
  const refused = notYours(current, userId);
  if (refused) return refused;
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
  else await pay(game.winner, pot(game), game.winner === game.userId ? game.opponentId : game.userId);
  await games().delete(id);
  return resultView(game, balance);
}

// An item from the dropdown. Using one doesn't end the turn; the Magnifying Glass answers only the clicker.
async function item(id, userId, key) {
  const current = await games().get(id);
  if (!current || current.phase !== 'play') return null;
  const refused = notYours(current, userId);
  if (refused) return refused;
  let used = null;
  await games().update(id, (g) => {
    if (!g || g.done || g.phase !== 'play' || g.turn !== userId) return g; // a double click
    used = useItem(g.acted ? g : { ...g, log: [] }, key); // the first item of a turn clears the last turn's shots
    if (used.error) return g;
    used.game.acted = true;
    return used.game;
  });
  if (!used) return null;
  if (used.error) return { error: used.error };
  const update = playView(id, used.game);
  return used.secret ? { private: used.secret, update } : update;
}

const move = (id, userId, [action, value]) =>
  action === 'accept' ? accept(id, userId)
    : action === 'decline' ? decline(id, userId)
      : action === 'item' ? item(id, userId, value)
        : shoot(id, userId, action === 'self');

// Time ran out (casino.js expireGames). Once a shot was fired or an item used, whoever's turn it is forfeits: against
// Silver the bet is lost, against a member the other one takes the pot. Before that everything staked goes back (timeoutView).
function finishOnTimeout(id, state) {
  if (state.phase !== 'play' || !state.log?.length) return null;
  const quitter = state.turn;
  const winner = foeOf(state, quitter);
  const game = { ...state, winner, done: true, log: [`**${nameOf(state, quitter)}** Ran Out Of Time.`] };
  return {
    pays: solo(game) ? [[game.userId, 0]] : [[winner, pot(game), quitter]],
    view: (balance) => resultView(game, balance),
  };
}

async function timeoutView(id, game, balance) {
  if (solo(game)) {
    return { ...timeoutMessage(HOST, { staked: game.bet, balance, againId: AGAIN_ID, bet: game.bet, userId: game.userId, line: `"${pickRandom(TIMEOUT_LINES)}"` }), content: '' };
  }
  if (game.phase === 'invite') {
    return view({
      lines: [`${mention(game.opponentId)} Never Answered. ${mention(game.userId)} Got ${boldSouls(game.bet)} Back.`],
      footer: `"${pickRandom(TIMEOUT_LINES)}"`,
      rows: [],
      mood: 'gloat',
    });
  }
  return view({
    lines: [`${mention(game.userId)} And ${mention(game.opponentId)} Never Finished. Both Got ${boldSouls(game.bet)} Back.`],
    footer: `"${pickRandom(TIMEOUT_LINES)}"`,
    buttons: [[`${AGAIN_ID}:${game.bet}:${game.userId}:${game.opponentId}`, `Rematch (${fmt(game.bet)})`, ButtonStyle.Primary]],
    mood: 'gloat',
  });
}

module.exports = {
  games, staked, refunds, timeoutView, finishOnTimeout, loadShellEmojis, startGame, move,
  loadShells, fire, play, useItem, decide, liveChance, shown, deal, count, winnings,
  ITEMS, CHARGES, MAX_ITEMS, SILVER, BUTTON_ID, AGAIN_ID, PVP,
};
