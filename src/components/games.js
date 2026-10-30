// Buttons of the soul-betting games (the shared handling is in utils/games/casino.js).
// Each game's buttons carry the game id, then what was pressed.
const { gameButtons } = require('../utils/games/casino');
const doorman = require('../utils/games/doorman');
const blackjack = require('../utils/games/blackjack');
const sinclair = require('../utils/games/sinclair');
const paradox = require('../utils/games/paradox');
const bebop = require('../utils/games/bebop');
const pocket = require('../utils/games/pocket');
const holliday = require('../utils/games/holliday');
const yamato = require('../utils/games/yamato');
const silver = require('../utils/games/silver');
const rem = require('../utils/games/rem');
const paige = require('../utils/games/paige');
const abrams = require('../utils/games/abrams');

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
  ...gameButtons('remling-race', rem, { play: (id, userId, [lane]) => rem.pick(id, userId, Number(lane)), menu: true }), // a dropdown of the 5 Remlings
  // Play Again (the letter dropdowns, Solve It and its pop-up are in components/paige.js)
  ...gameButtons('dont-wake-the-bookwyrm', paige, { play: () => null, slow: true }),
  // Accept / Decline (a challenge), the secret-hero and question dropdowns, Accuse... / Back, the accusation dropdowns
  ...gameButtons('abrams-interrogation', abrams, { play: abrams.play, slow: true, menu: true }),
];
