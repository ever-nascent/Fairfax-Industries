// /help's category and page dropdowns and its Back / Next buttons. Button / dropdown routes: each route has `matches` (is this click mine? usually by the customId prefix) and `execute`. components/index.js lists every route file.
// The member who ran /help turns its pages; anyone else gets the page they picked as their own private copy. The pages: utils/help.js.
const { MessageFlags } = require('discord.js');
const { CATEGORY_ID, PAGE_ID, TURN_ID, helpView, contextOf } = require('../utils/help');

function show(interaction, ownerId, key, index) {
  const mine = interaction.user.id === ownerId;
  const view = helpView(contextOf(interaction), interaction.user.id, key, index);
  return mine ? interaction.update(view) : interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
}

const prefixed = (id) => (interaction) => interaction.customId?.startsWith(`${id}:`);

module.exports = [
  {
    name: 'help',
    label: 'Category dropdown',
    matches: (interaction) => interaction.isStringSelectMenu() && prefixed(CATEGORY_ID)(interaction),
    execute: (interaction) => show(interaction, interaction.customId.split(':')[1], interaction.values[0], 0),
  },
  {
    name: 'help',
    label: 'Page dropdown',
    matches: (interaction) => interaction.isStringSelectMenu() && prefixed(PAGE_ID)(interaction),
    execute: (interaction) => { const [, owner, key] = interaction.customId.split(':'); return show(interaction, owner, key, interaction.values[0]); },
  },
  {
    name: 'help',
    label: 'Back / Next button',
    matches: (interaction) => interaction.isButton() && prefixed(TURN_ID)(interaction),
    execute: (interaction) => { const [, owner, key, index] = interaction.customId.split(':'); return show(interaction, owner, key, index); },
  },
];
