// Buttons of the soul-betting games (the shared handling is in utils/casino.js).
// Each game's buttons carry the game id, then what was pressed.
const { gameButtons } = require('../utils/casino');
const doorman = require('../utils/doorman');
const blackjack = require('../utils/blackjack');
const sinclair = require('../utils/sinclair');
const paradox = require('../utils/paradox');
const bebop = require('../utils/bebop');
const pocket = require('../utils/pocket');
const holliday = require('../utils/holliday');
const yamato = require('../utils/yamato');
const silver = require('../utils/silver');
const rem = require('../utils/rem');

module.exports = [
  // Room 1-3 (pick), then Stay / Switch
  ...gameButtons('guess-the-door', doorman, {
    play: (id, userId, [action, room]) =>
      action === 'pick' ? doorman.pickRoom(id, userId, Number(room)) : doorman.finishGame(id, userId, action),
  }),
  // Hit / Stand / Double Down / Split
  ...gameButtons('blackjack', blackjack, { play: (id, userId, [action]) => blackjack.move(id, userId, action) }),
  // Hat 1-3
  ...gameButtons('rabbit-in-the-hat', sinclair, { play: (id, userId, [hat]) => sinclair.pickHat(id, userId, Number(hat)), slow: true }),
  // Higher / Lower / Spin Again / Cash Out
  ...gameButtons('borrowed-time', paradox, { play: (id, userId, [action]) => paradox.move(id, userId, action), slow: true }),
  // Tile 0-19 / Cash Out
  ...gameButtons('bebops-bombs', bebop, { play: (id, userId, [action]) => bebop.move(id, userId, action) }),
  ...gameButtons('deal-or-no-deal', pocket, { play: (id, userId, [action]) => pocket.move(id, userId, action) }),
  // Cash Out
  ...gameButtons('powder-keg', holliday, { play: (id, userId) => holliday.cashOut(id, userId), slow: true }),
  // Accept / Decline (a challenge), then Power Slash / Flying Strike / Crimson Slash
  ...gameButtons('duel-of-stances', yamato, { play: yamato.play }),
  // Accept / Decline (a challenge), then Shoot (the other player) / Shoot Yourself
  ...gameButtons('shotgun-roulette', silver, { play: silver.move }),
  // Remling 1-5
  ...gameButtons('remling-race', rem, { play: (id, userId, [lane]) => rem.pick(id, userId, Number(lane)) }),
];
