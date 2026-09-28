const path = require('node:path');
const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { claimUrn, soulsIcon, URN_MAX_DAYS } = require('../../utils/xp');

const CARD = path.join(__dirname, '..', '..', '..', 'assets', 'card');
const icon = () => new AttachmentBuilder(path.join(CARD, 'soul_urn.png'), { name: 'soul_urn.png' }); // deadlock.wiki
const render = () => new AttachmentBuilder(path.join(CARD, 'soul_urn_render.png'), { name: 'soul_urn_render.png' });
const URN_COLOR = 0x20a8b8; // the urn's teal
// The Soul Urn's own voice line (deadlock.wiki, "Soul Urn"). Footers can't be italic.
const URN_LINE = "You'd think people would be more excited about a jar of souls!";
const fmt = (n) => n.toLocaleString('en-US');

const urnEmbed = () =>
  new EmbedBuilder().setColor(URN_COLOR).setAuthor({ name: 'Soul Urn', iconURL: 'attachment://soul_urn.png' });

module.exports = {
  data: new SlashCommandBuilder().setName('urn').setDescription('Claim your daily Soul Urn'),

  async execute(interaction) {
    const result = await claimUrn(interaction.user.id);
    if (!result.claimed) {
      const next = new Date();
      next.setUTCHours(24, 0, 0, 0); // days roll over at midnight UTC
      const embed = urnEmbed().setDescription(
        `You already claimed today's urn. Next one <t:${Math.floor(next.getTime() / 1000)}:R>.`,
      );
      return interaction.reply({ embeds: [embed], files: [icon()], flags: MessageFlags.Ephemeral });
    }
    const { souls, user } = result;
    const days = user.urnStreak === 1 ? '1 day' : `${user.urnStreak} days`;
    const embed = urnEmbed()
      .setThumbnail('attachment://soul_urn_render.png')
      .setDescription(`${interaction.user} delivered the urn for ${soulsIcon()}**${fmt(souls)} souls**.`)
      .addFields(
        { name: 'Streak', value: user.urnStreak >= URN_MAX_DAYS ? `${days} (max bonus)` : days, inline: true },
        { name: 'Balance', value: `${soulsIcon()}${fmt(user.souls)} souls`, inline: true },
      )
      .setFooter({ text: `"${URN_LINE}"` });
    return interaction.reply({ embeds: [embed], files: [icon(), render()] });
  },
};
