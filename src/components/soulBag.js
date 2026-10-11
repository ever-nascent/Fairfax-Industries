const { GRAB_ID, onGrab } = require('../utils/soulBag');

module.exports = [
  {
    name: 'soul-bag',
    label: 'Grab button',
    matches: (interaction) => interaction.isButton() && interaction.customId === GRAB_ID,
    execute: onGrab,
  },
];
