// /trivia mode:<Heroes|Items>: one question hosted by Dynamo, souls for a right answer. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Questions and payouts: utils/games/trivia.js; the answer buttons: components/trivia.js.
const { SlashCommandBuilder } = require('discord.js');
const { startRound } = require('../../utils/games/trivia');

// Starts a solo trivia round for whoever ran it (public message). Also used by the Next Question button,
// which carries the mode in its custom id.
async function runRound(interaction) {
  const mode = (interaction.isChatInputCommand() ? interaction.options.getString('mode') : interaction.customId.split(':')[1]) || undefined;
  const result = await startRound(interaction.user.id, interaction.guild, (payload) =>
    interaction.editReply({ ...payload, attachments: [] }),
  { mode });
  return interaction.reply(result.payload);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Deadlock trivia: one guess, get it right for Souls')
    .addStringOption((o) =>
      o.setName('mode').setDescription('Leave empty for any question').addChoices({ name: 'Heroes', value: 'heroes' }, { name: 'Items', value: 'items' }),
    ),
  execute: runRound,
  runRound,
};
