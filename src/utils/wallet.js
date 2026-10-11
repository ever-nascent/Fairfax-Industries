// What `/souls balance` and `/souls hero` show (his calls, Oct 11: they replace `/wallet`; both private). The command is `/souls` (utils/ledger.js),
// whose other subcommands are the staff tools.
const { EmbedBuilder } = require('discord.js');
const { triviaOdds, REJUV_MAX, URN_MAX_DAYS } = require('./xp');
const { label } = require('./soulsLedger');
const { fmt, soulsText } = require('./format');
const { CARD_COLOR } = require('./rankCard');
const { HEROES, heroArt } = require('./heroes');
const { progress } = require('./farm/levels');
const { buffText } = require('./farm/buffs');
const { MAX_REJUVS, heroOf } = require('./farm/play');
const { heroPicture } = require('./farm/views');

const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const signed = (n) => `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
const recentLines = (recent) => recent.map((e) => `**${signed(e.d)}** ${label(e.r)} ${stamp(e.t)}`).join('\n');

// `/souls balance`: the server balance, Soul Boost, Rejuvs, urn and trivia status, and the last few changes (the server balance's only).
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
  if (recent.length) embed.addFields({ name: 'Recent', value: recentLines(recent) });
  return embed;
}

// `/souls hero`: one of the member's Hero Farming heroes (`record` from play.js getFarmUser): its own souls, level, Rejuvs, permanent buffs
// (roaming and Eternal Gift, what it fights with) and its last few souls changes (`recent`: that hero's ledger lines). In the hero's colour, its icon in the corner.
async function heroWalletView(member, record, hero, recent) {
  const h = heroOf(record, hero);
  const slug = HEROES.find((x) => x.name === hero).slug;
  const buffs = Object.entries(h.gifts ?? {}).reduce((all, [k, n]) => ({ ...all, [k]: (all[k] ?? 0) + n }), { ...h.buffs });
  const embed = new EmbedBuilder()
    .setColor((await heroArt(slug, 'icon')).color)
    .setAuthor({ name: `${member.displayName}'s ${hero}` })
    .setThumbnail('attachment://thumb.png')
    .setDescription(soulsText(h.souls))
    .addFields(
      { name: 'Level', value: `${progress(h.earned).level}`, inline: true },
      { name: 'Rejuvs', value: `${h.rejuvs} / ${MAX_REJUVS}`, inline: true },
      { name: 'Permanent Buffs', value: Object.keys(buffs).length ? Object.entries(buffs).map(([k, n]) => buffText(k, n)).join('\n') : 'None yet', inline: false },
    )
    .setFooter({ text: hero === record.hero ? 'Your current hero.' : `Switch to ${hero} on /base to spend these.` });
  if (recent.length) embed.addFields({ name: 'Recent', value: recentLines(recent) });
  return { embeds: [embed], files: [await heroPicture(hero)] };
}

module.exports = { walletEmbed, heroWalletView };
