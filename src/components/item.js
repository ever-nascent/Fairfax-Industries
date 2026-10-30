// /item's Details / Enhanced / Corrupted buttons and the View Upgrade Tree dropdown. Button routes: each route has `matches` (is this click mine? usually by the customId prefix) and `execute`. components/index.js lists every route file.
// Whoever ran /item switches the message; anyone else gets the page they pressed privately.
const { MessageFlags } = require('discord.js');
const { ITEM_VIEW_ID, TREE_ID, resolve, itemView } = require('../utils/farm/itemInfo');

// The buttons carry the item's name; the dropdown carries it as the picked value and opens that item's Details.
async function onView(interaction) {
  const [, view, userId, ...name] = interaction.customId.split(':'); // item names have no ':' but split anyway
  return show(interaction, name.join(':'), view, userId);
}
const onTree = (interaction) => show(interaction, interaction.values[0], 'details', interaction.customId.split(':')[1]);

async function show(interaction, name, view, userId) {
  const card = resolve(name);
  if (!card) return interaction.reply({ content: 'That item is gone from the game data.', flags: MessageFlags.Ephemeral });
  const mine = interaction.user.id === userId;
  const payload = await itemView(card, view, userId);
  return mine ? interaction.update({ ...payload, attachments: [] }) : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

module.exports = [
  {
    name: 'item',
    label: 'Item view button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${ITEM_VIEW_ID}:`),
    execute: onView,
  },
  {
    name: 'item',
    label: 'View Upgrade Tree dropdown',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${TREE_ID}:`),
    execute: onTree,
  },
];
