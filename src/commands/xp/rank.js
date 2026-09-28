const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUser, progress, MAX_LEVEL } = require('../../utils/xp');
const { renderRankCard, CARD_COLOR } = require('../../utils/rankCard');

// The Shopkeeper's replies when someone checks a bot's rank.
const SELF_LINE = "Me? Kid, I don't level up. I *own* the place. Now you gonna buy somethin', or you just here for the air conditioning?";
const BOT_LINES = [
  "That's a bot, pal. No levels, no souls, and it's never bought a single thing from me. Next customer!",
  "A bot? It's been sittin' at level zero longer than the Knicks been waitin' on a ring. And believe me, I got money on both.",
  "I don't keep a tab for machines. Can't shake their hand, can't take their souls. What else you got?",
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Show your level card (or someone else's)")
    .addUserOption((o) => o.setName('member').setDescription('Whose card to show')),

  async execute(interaction) {
    const target = interaction.options.getMember('member') ?? interaction.member;
    if (target.user.bot) {
      const line = target.id === interaction.client.user.id ? SELF_LINE : BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(CARD_COLOR).setDescription(line)], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    const user = await getUser(target.id);
    const { level, into, need } = progress(user.xp);
    const png = await renderRankCard({ name: target.displayName, level, into, need, souls: user.souls, maxLevel: MAX_LEVEL });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(CARD_COLOR).setImage('attachment://rank.png')],
      files: [new AttachmentBuilder(png, { name: 'rank.png' })],
    });
  },
};
