const { betCommand } = require('../../utils/casino');
const doorman = require('../../utils/doorman');
const blackjack = require('../../utils/blackjack');
const sinclair = require('../../utils/sinclair');
const paradox = require('../../utils/paradox');
const bebop = require('../../utils/bebop');
const holliday = require('../../utils/holliday');
const yamato = require('../../utils/yamato');
const silver = require('../../utils/silver');
const rem = require('../../utils/rem');
const pocket = require('../../utils/pocket');

// slow: the first picture (shuffle GIF, clock, fuse GIF) takes a moment to draw.
module.exports = betCommand('mini-game', 'Bet Souls on one of the mini-games', {
  'guess-the-door': { label: 'Guess the Door', game: doorman },
  blackjack: { label: 'Blackjack', game: blackjack },
  'rabbit-in-the-hat': { label: 'Rabbit in the Hat', game: sinclair, slow: true },
  'borrowed-time': { label: 'Borrowed Time', game: paradox, slow: true },
  'bebops-bombs': { label: "Bebop's Bombs", game: bebop },
  'powder-keg': { label: 'Powder Keg', game: holliday, slow: true },
  'duel-of-stances': { label: 'Duel of Stances', game: yamato },
  'shotgun-roulette': { label: 'Shotgun Roulette', game: silver },
  'remling-race': { label: 'Remling Race', game: rem },
  'deal-or-no-deal': { label: 'Deal or No Deal', game: pocket },
});
