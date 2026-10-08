const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { leaderboard, progress, standing, MAX_LEVEL } = require('../../utils/xp');
const { renderLeaderboard, CARD_COLOR } = require('../../utils/rankCard');
const { fmt } = require('../../utils/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('The 10 biggest high rollers in the joint. Think you made the cut?')
    .addSubcommand((s) => s.setName('xp').setDescription('Top 10 by level and XP'))
    .addSubcommand((s) => s.setName('souls').setDescription('Top 10 by souls')),

  async execute(interaction) {
    const by = interaction.options.getSubcommand();
    const top = await leaderboard(10, by);
    if (top.length === 0) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(CARD_COLOR).setDescription(`Nobody has any ${by === 'xp' ? 'XP' : 'souls'} yet.`)] });
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
    // The runner's own spot when they're not in the top 10.
    const me = top.some((u) => u.userId === interaction.user.id) ? null : await standing(interaction.user.id, by);
    const embed = new EmbedBuilder().setColor(CARD_COLOR).setImage('attachment://leaderboard.png');
    if (me?.position) embed.setFooter({ text: `You are #${fmt(me.position)} of ${fmt(me.total)}` });
    const png = await renderLeaderboard(interaction.guild.name, rows, by);
    await interaction.editReply({
      embeds: [embed],
      files: [new AttachmentBuilder(png, { name: 'leaderboard.png' })],
    });
  },
};
