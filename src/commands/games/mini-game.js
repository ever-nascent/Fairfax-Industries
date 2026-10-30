// /mini-game game:<name> bet:<souls>: one command for every betting game. Each game is a module in utils/games/
// (listed below); `betCommand` in utils/games/casino.js builds the command, takes the bet and starts the game. To add a game: write its module, add it here.
const { betCommand } = require('../../utils/games/casino');
const doorman = require('../../utils/games/doorman');
const blackjack = require('../../utils/games/blackjack');
const sinclair = require('../../utils/games/sinclair');
const paradox = require('../../utils/games/paradox');
const bebop = require('../../utils/games/bebop');
const holliday = require('../../utils/games/holliday');
const yamato = require('../../utils/games/yamato');
const silver = require('../../utils/games/silver');
const rem = require('../../utils/games/rem');
const pocket = require('../../utils/games/pocket');
const paige = require('../../utils/games/paige');
const abrams = require('../../utils/games/abrams');

// slow: the first picture (shuffle GIF, clock, fuse GIF) takes a moment to draw.
module.exports = betCommand('mini-game', 'Bet Souls on one of the mini-games', {
  'guess-the-door': { label: 'Guess the Door', game: doorman },
  blackjack: { label: 'Blackjack', game: blackjack },
  'rabbit-in-the-hat': { label: 'Rabbit in the Hat', game: sinclair, slow: true },
  'borrowed-time': { label: 'Borrowed Time', game: paradox, slow: true },
  'bebops-bombs': { label: "Bebop's Bombs", game: bebop, slow: true }, // no picture, but the first start after a restart can still pass Discord's 3 s limit
  'powder-keg': { label: 'Powder Keg', game: holliday, slow: true },
  'duel-of-stances': { label: 'Duel of Stances', game: yamato },
  'shotgun-roulette': { label: 'Shotgun Roulette', game: silver },
  'remling-race': { label: 'Remling Race', game: rem },
  'deal-or-no-deal': { label: 'Deal or No Deal', game: pocket },
  'dont-wake-the-bookwyrm': { label: "Don't Wake the Bookwyrm", game: paige, slow: true },
  'abrams-interrogation': { label: "Abrams' Interrogation", game: abrams, slow: true },
});
