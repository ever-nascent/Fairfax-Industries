const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUser, triviaOdds, REJUV_MAX, URN_MAX_DAYS } = require('../../utils/xp');
const { history, label } = require('../../utils/soulsLedger');
const { fmt, soulsText } = require('../../utils/format');
const { CARD_COLOR } = require('../../utils/rankCard');

const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

// What the Wallet shows: balance, Soul Boost, Rejuvs, urn and trivia status, and the last few changes (private).
function walletEmbed(member, user, recent, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const urn = user.urnDay === today ? `Claimed. Next ${stamp(next.getTime())}` : `Ready: use \`/urn\`${user.urnStreak ? ` (streak ${user.urnStreak})` : ''}`;
  const left = triviaOdds(user, now).left;
  const embed = new EmbedBuilder()
    .setColor(CARD_COLOR)
    .setAuthor({ name: `${member.displayName}'s Wallet` })
    .setDescription(soulsText(user.souls))
    .addFields(
      { name: 'Soul Boost', value: user.boostUntil > now.getTime() ? `Ends ${stamp(user.boostUntil)}` : 'Not active', inline: true },
      { name: 'Rejuvs', value: `${user.rejuvs} / ${REJUV_MAX}`, inline: true },
      { name: 'Soul Urn', value: `${urn}\nStreak bonus maxes at ${URN_MAX_DAYS} days`, inline: false },
      { name: 'Trivia Today', value: left > 0 ? `${left} paid answers left` : 'No paid answers left until midnight UTC', inline: false },
    );
  if (recent.length) {
    const signed = (n) => `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
    embed.addFields({ name: 'Recent', value: recent.map((e) => `**${signed(e.d)}** ${label(e.r)} ${stamp(e.t)}`).join('\n') });
  }
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder().setName('wallet').setDescription('Your souls, boost, Rejuvs and recent activity (only you see it)'),
  walletEmbed,

  async execute(interaction) {
    const user = await getUser(interaction.user.id);
    const embed = walletEmbed(interaction.member, user, history(interaction.user.id, 6));
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
