const path = require('node:path');
const { SlashCommandBuilder, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { claimUrn, URN_MAX_DAYS } = require('../../utils/xp');
const { heroEmoji } = require('../../utils/heroes');
const { soulsText, boldSouls } = require('../../utils/format');
const { pickRandom } = require('../../utils/random');
const { ASSETS } = require('../../utils/art');
const { streakBar } = require('../../utils/trivia'); // the same bar as /trivia

const CARD = path.join(ASSETS, 'card');
const icon = () => new AttachmentBuilder(path.join(CARD, 'soul_urn.png'), { name: 'soul_urn.png' }); // deadlock.wiki
const render = () => new AttachmentBuilder(path.join(CARD, 'soul_urn_render.png'), { name: 'soul_urn_render.png' });
const URN_COLOR = 0x20a8b8; // the urn's teal
// The Soul Urn's own voice lines (deadlock.wiki, "Soul Urn/Voice lines"). Footers can't be italic.
const URN_LINE = "You'd think people would be more excited about a jar of Souls!";
// When they come back after missing days (its "left behind" lines).
const MISSED_LINES = [
  'I was beginning to feel abandoned.',
  "I can't believe I've been left here to rot!",
  'I was worried I was forgotten.',
  "Hmph, it's about time!",
];
const REJUV_ID = 'urn_rejuv'; // custom id: urn_rejuv:<user id>:<use|fresh>

const urnEmbed = () =>
  new EmbedBuilder().setColor(URN_COLOR).setAuthor({ name: 'Soul Urn', iconURL: 'attachment://soul_urn.png' });

// The public "delivered the urn" message. The streak bar fills up to the max bonus (URN_MAX_DAYS days).
function claimedMessage(member, { souls, user, rejuvUsed }) {
  const days = user.urnStreak === 1 ? '1 Day in a Row!' : `${user.urnStreak} Days in a Row!`;
  const bar = streakBar(Math.min(user.urnStreak, URN_MAX_DAYS), URN_MAX_DAYS);
  const embed = urnEmbed()
    .setThumbnail('attachment://soul_urn_render.png')
    .setDescription(`${member} delivered the urn for ${boldSouls(souls)}.`)
    .addFields(
      { name: 'Streak', value: `${bar} **${days}**${user.urnStreak >= URN_MAX_DAYS ? ' (max bonus)' : ''}` },
      { name: 'Balance', value: soulsText(user.souls), inline: true },
    )
    .setFooter({ text: `"${URN_LINE}"` });
  if (rejuvUsed) {
    const emoji = heroEmoji(member.guild, 'rejuv');
    embed.addFields({ name: 'Rejuv Used', value: `${emoji ? `<:${emoji.name}:${emoji.id}> ` : ''}${user.rejuvs} left`, inline: true });
  }
  return { embeds: [embed], files: [icon(), render()], components: [] };
}

// Their streak broke and they carry a Rejuv: use it, or start over (the Rejuv is kept).
function rejuvMessage(member, user, now = new Date()) {
  const missed = Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(user.urnDay)) / 86400000) - 1;
  const days = (n) => (n === 1 ? '1 day' : `${n} days`);
  const emoji = heroEmoji(member.guild, 'rejuv');
  const embed = urnEmbed()
    .setThumbnail('attachment://soul_urn_render.png')
    .setDescription(`${member}, your **Streak** broke!\n\nUse a Rejuv to save it, or start over and keep your Rejuv.`)
    .addFields(
      { name: 'Streak', value: days(user.urnStreak), inline: true },
      { name: 'Missed', value: days(missed), inline: true },
      { name: 'Rejuvs', value: `${emoji ? `<:${emoji.name}:${emoji.id}> ` : ''}${user.rejuvs}`, inline: true },
    )
    .setFooter({ text: `"${pickRandom(MISSED_LINES)}"` });
  const use = new ButtonBuilder().setCustomId(`${REJUV_ID}:${member.id}:use`).setLabel('Use Rejuv').setStyle(ButtonStyle.Success);
  if (emoji) use.setEmoji(emoji);
  const fresh = new ButtonBuilder().setCustomId(`${REJUV_ID}:${member.id}:fresh`).setLabel('Start Over').setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], files: [icon(), render()], components: [new ActionRowBuilder().addComponents(use, fresh)] };
}

module.exports = {
  data: new SlashCommandBuilder().setName('urn').setDescription('Claim your daily Soul Urn'),
  REJUV_ID,
  claimedMessage,

  async execute(interaction) {
    const result = await claimUrn(interaction.user.id);
    if (result.ask) return interaction.reply(rejuvMessage(interaction.member, result.user));
    if (!result.claimed) {
      const next = new Date();
      next.setUTCHours(24, 0, 0, 0); // days roll over at midnight UTC
      const embed = urnEmbed().setDescription(
        `You already claimed today's urn. Next one <t:${Math.floor(next.getTime() / 1000)}:R>.`,
      );
      return interaction.reply({ embeds: [embed], files: [icon()], flags: MessageFlags.Ephemeral });
    }
    return interaction.reply(claimedMessage(interaction.member, result));
  },
};
