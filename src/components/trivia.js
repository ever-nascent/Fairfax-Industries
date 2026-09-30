const { MessageFlags } = require('discord.js');
const { guess, roundError, answerModal, BUTTON_ID, NEXT_ID, TYPE_ID } = require('../utils/trivia');
const { runRound } = require('../commands/games/trivia');

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

// /trivia's answer buttons and item dropdown: only the runner can answer; their one guess ends the round.
async function onAnswer(interaction) {
  const [, roundId, button] = interaction.customId.split(':');
  const choice = Number(interaction.isStringSelectMenu() ? interaction.values[0] : button);
  const result = await guess(roundId, interaction.user.id, choice, interaction.guild);
  if (result.reply) return reply(interaction, result.reply);
  // attachments: [] drops the old files so the new ones (with Dynamo's new face) replace them
  return interaction.update({ ...result.payload, attachments: [] });
}

// Type Your Answer: the button opens the pop-up, sending it answers.
async function onType(interaction) {
  const roundId = interaction.customId.split(':')[1];
  if (interaction.isButton()) {
    const error = roundError(roundId, interaction.user.id);
    return error ? reply(interaction, error) : interaction.showModal(answerModal(roundId));
  }
  const result = await guess(roundId, interaction.user.id, interaction.fields.getTextInputValue('answer'), interaction.guild);
  if (result.reply) return reply(interaction, result.reply);
  return interaction.update({ ...result.payload, attachments: [] });
}

module.exports = [
  {
    name: 'trivia',
    label: 'Answer button',
    matches: (interaction) => (interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(`${BUTTON_ID}:`),
    execute: onAnswer,
  },
  {
    name: 'trivia',
    label: 'Type Your Answer',
    matches: (interaction) => (interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(`${TYPE_ID}:`),
    execute: onType,
  },
  {
    name: 'trivia',
    label: 'Next Question button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(NEXT_ID),
    execute: runRound,
  },
];
