const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { leaderboard, progress, MAX_LEVEL } = require('../../utils/xp');
const { renderLeaderboard, CARD_COLOR } = require('../../utils/rankCard');

module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('The 10 biggest high rollers in the joint, ranked by level. Think you made the cut?'),

  async execute(interaction) {
    const top = await leaderboard(10);
    if (top.length === 0) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(CARD_COLOR).setDescription('Nobody has any XP yet.')] });
    }
    await interaction.deferReply();
    // Current display names; members who left fall back to their username.
    const members = await interaction.guild.members.fetch({ user: top.map((u) => u.userId) }).catch(() => new Map());
    const rows = await Promise.all(
      top.map(async (u) => {
        const name =
          members.get(u.userId)?.displayName ??
          (await interaction.client.users.fetch(u.userId).catch(() => null))?.username ??
          'Unknown';
        const p = progress(u.xp);
        return { name, level: p.level, fill: p.level >= MAX_LEVEL ? 1 : p.into / p.need, xp: u.xp, souls: u.souls };
      }),
    );
    const png = await renderLeaderboard(interaction.guild.name, rows);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(CARD_COLOR).setImage('attachment://leaderboard.png')],
      files: [new AttachmentBuilder(png, { name: 'leaderboard.png' })],
    });
  },
};
