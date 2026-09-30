const { MessageFlags } = require('discord.js');
const { guess, view, GUESS_ID, AGAIN_ID } = require('../utils/lockle');
const { runGame } = require('../commands/games/lockle');

// /lockle's hero dropdowns: a pick is a guess (only the runner's count).
async function onGuess(interaction) {
  // answer Discord first: it gives 3 seconds, and a busy bot (e.g. just started) can miss that
  await interaction.deferUpdate();
  const [, gameId] = interaction.customId.split(':');
  const result = await guess(gameId, interaction.user.id, interaction.values[0]);
  if (result.reply) return interaction.followUp({ content: result.reply, flags: MessageFlags.Ephemeral });
  return interaction.editReply({ ...(await view(result.game, interaction.guild)), attachments: [] });
}

module.exports = [
  {
    name: 'lockle',
    label: 'Guess dropdown',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${GUESS_ID}:`),
    execute: onGuess,
  },
  {
    name: 'lockle',
    label: 'Play Again button',
    matches: (interaction) => interaction.isButton() && interaction.customId === AGAIN_ID,
    execute: runGame,
  },
];
