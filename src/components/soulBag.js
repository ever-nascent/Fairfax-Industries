// The Soul Bag's Grab button. Button / dropdown / pop-up routes: each route has `matches` (is this click mine? usually by the customId prefix) and `execute`. components/index.js lists every route file.
// The bag itself: utils/economy/soulBag.js.
const { GRAB_ID, onGrab } = require('../utils/economy/soulBag');

module.exports = [
  {
    name: 'soul-bag',
    label: 'Grab button',
    matches: (interaction) => interaction.isButton() && interaction.customId === GRAB_ID,
    execute: onGrab,
  },
];
