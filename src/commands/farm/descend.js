const { SlashCommandBuilder } = require('discord.js');
const { getFarmUser } = require('../../utils/farm/play');
const { pickView } = require('../../utils/farm/views');
const { screen, leaderboardView } = require('../../utils/farm/descentViews');
const { leaderboard } = require('../../utils/farm/descent');

// /descend: Hero Farming's roguelite mode (utils/farm/descent.js). Public like the farm's commands; only the runner can press its buttons.
module.exports = {
  data: new SlashCommandBuilder().setName('descend').setDescription('Take a hero down room after room, from level 0, picking items as you go')
    .addSubcommand((s) => s.setName('run').setDescription('Start a run, or carry on with the one you have'))
    .addSubcommand((s) => s.setName('leaderboard').setDescription("The server's deepest runs")),

  async execute(interaction) {
    await interaction.deferReply();
    const record = await getFarmUser(interaction.user.id);
    if (interaction.options.getSubcommand() === 'leaderboard') return interaction.editReply(leaderboardView(interaction.member, await leaderboard(), record));
    if (!record.hero) return interaction.editReply(await pickView(interaction.member)); // a first hero comes from the farm (/base)
    return interaction.editReply(await screen(interaction.member, record));
  },
};
