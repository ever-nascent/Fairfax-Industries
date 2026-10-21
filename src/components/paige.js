const { MessageFlags } = require('discord.js');
const paige = require('../utils/paige');

// Don't Wake the Bookwyrm's controls (Play Again is in components/games.js with the other games').
// The picture takes a moment to draw, so each answers Discord first (it only gives 3 seconds) and edits the message after.
const done = async (interaction, result) => {
  if (!result) return null; // a stale click
  if (result.error) return interaction.followUp({ content: result.error, flags: MessageFlags.Ephemeral });
  return interaction.editReply({ ...result, attachments: [] }); // attachments: [] drops the old pictures
};

module.exports = [
  {
    name: 'dont-wake-the-bookwyrm',
    label: 'Letter dropdown',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${paige.BUTTON_ID}:`),
    async execute(interaction) {
      await interaction.deferUpdate();
      const [, id] = interaction.customId.split(':');
      return done(interaction, await paige.guess(id, interaction.user.id, interaction.values[0]));
    },
  },
  {
    name: 'dont-wake-the-bookwyrm',
    label: 'Solve It button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${paige.SOLVE_ID}:`),
    async execute(interaction) {
      const id = interaction.customId.split(':')[1];
      const error = await paige.solveError(id, interaction.user.id);
      return error ? interaction.reply({ content: error, flags: MessageFlags.Ephemeral }) : interaction.showModal(paige.solveModal(id));
    },
  },
  {
    name: 'dont-wake-the-bookwyrm',
    label: 'Solve It pop-up',
    matches: (interaction) => interaction.isModalSubmit() && interaction.customId.startsWith(`${paige.SOLVE_ID}:`),
    async execute(interaction) {
      await interaction.deferUpdate();
      const id = interaction.customId.split(':')[1];
      return done(interaction, await paige.solve(id, interaction.user.id, interaction.fields.getTextInputValue('answer')));
    },
  },
];
