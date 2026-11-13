// /lockle daily|practice: guess the hero from a real ranked build. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Game logic and picture: utils/games/lockle.js; the guess dropdowns: components/lockle.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { startPractice, startDaily, view } = require('../../utils/games/lockle');

const FAILED = "Couldn't get a build from the match data right now (deadlock-api.com). Try again in a bit.";

// Starts a game: Daily (private) or Practice (public). Also used by the Play Again button.
async function runGame(interaction) {
  const daily = interaction.isChatInputCommand() && interaction.options.getSubcommand() === 'daily';
  await interaction.deferReply(daily ? { flags: MessageFlags.Ephemeral } : {});
  try {
    const game = daily ? await startDaily(interaction.user.id) : await startPractice(interaction.user.id);
    return interaction.editReply(await view(game, interaction.guild));
  } catch (error) {
    console.error('[lockle] Failed to start a game:', error.message);
    return interaction.editReply({ content: FAILED });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockle')
    .setDescription('Guess the hero from a real high-rank build')
    .addSubcommand((s) => s.setName('daily').setDescription("Today's randomized lockle build!"))
    .addSubcommand((s) => s.setName('practice').setDescription('A random build picked from a wide selection of games!')),
  execute: runGame,
  runGame,
};
