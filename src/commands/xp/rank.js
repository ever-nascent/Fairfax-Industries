const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUser, progress, MAX_LEVEL } = require('../../utils/xp');
const { renderRankCard, CARD_COLOR, cardColor } = require('../../utils/rankCard');
const { getHero, heroArt } = require('../../utils/heroes');
const { pickRandom } = require('../../utils/random');

// The Shopkeeper's replies when someone checks a bot's rank.
const SELF_LINE = "Me? Kid, I don't level up. I *own* the place. Now you gonna buy somethin', or you just here for the air conditioning?";
const BOT_LINES = [
  "That's a bot, pal. No levels, no Souls, and it's never bought a single thing from me. Next customer!",
  "A bot? It's been sittin' at level zero since the day it walked in. Never bought so much as a gumball.",
  "I don't keep a tab for machines. Can't shake their hand, can't take their Souls. What else you got?",
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Show your level card (or someone else's)")
    .addUserOption((o) => o.setName('member').setDescription('Whose card to show')),

  async execute(interaction) {
    // Works for someone who left the server too: their XP is kept (like on /leaderboard), shown under their username.
    const target = interaction.options.getUser('member') ?? interaction.user;
    const member = target.id === interaction.user.id ? interaction.member : interaction.options.getMember('member');
    if (target.bot) {
      const line = target.id === interaction.client.user.id ? SELF_LINE : pickRandom(BOT_LINES);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(CARD_COLOR).setDescription(line)], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    const user = await getUser(target.id);
    const { level, into, need } = progress(user.xp);
    // Their equipped hero card from the Shop ('<slug>:<style>'), else the plain card.
    const [slug, style] = user.card?.split(':') ?? [];
    const hero = getHero(slug) ? await heroArt(slug, style) : null;
    const png = await renderRankCard({ name: member?.displayName ?? target.username, level, into, need, souls: user.souls, maxLevel: MAX_LEVEL, hero });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(hero ? cardColor(hero.color) : CARD_COLOR).setImage('attachment://rank.png')],
      files: [new AttachmentBuilder(png, { name: 'rank.png' })],
    });
  },
};
