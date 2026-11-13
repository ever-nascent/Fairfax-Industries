// /jackpot: the Weekly Jackpot. Shows the pot, your Tickets and last week's winner, with Buy buttons (only the runner can press them).
// The rules: utils/economy/jackpot.js; the buttons: components/jackpot.js; the weekly draw: events/jackpotReady.js.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getUser } = require('../../utils/economy/xp');
const { TICKET, HOUSE, MAX_TICKETS, status, drawAndAnnounce, lastLine, tickets } = require('../../utils/economy/jackpot');
const { fmt, soulsText, boldSouls } = require('../../utils/format');
const { REPLY_COLOR } = require('../../config');

const BUY_ID = 'jackpot_buy'; // custom id: jackpot_buy:<user id>:<count>
const COUNTS = [1, 5]; // the Buy buttons

// The jackpot screen for `member`: a message payload.
async function jackpotView(member, now = Date.now()) {
  await drawAndAnnounce(member.guild, now); // the week may have turned since the last sweep
  const s = await status(member.guild.id, member.id, now);
  const { souls } = await getUser(member.id);
  const embed = new EmbedBuilder()
    .setColor(REPLY_COLOR)
    .setTitle('Weekly Jackpot')
    .setDescription(`One Ticket is one chance. I draw one every Monday at midnight UTC and its owner takes the pot.\n\n**${Math.round((1 - HOUSE) * 100)}%** of every Ticket goes into the pot.`)
    .addFields(
      { name: 'The Pot', value: soulsText(s.pot), inline: true },
      { name: 'Tickets Sold', value: `**${s.sold}**`, inline: true },
      { name: 'Draw', value: `<t:${Math.floor(s.drawAt / 1000)}:R>`, inline: true },
      { name: 'Your Tickets', value: `**${s.mine}** / ${MAX_TICKETS}`, inline: true },
      { name: 'Ticket Price', value: soulsText(TICKET), inline: true },
      { name: 'Your Balance', value: soulsText(souls), inline: true },
      { name: 'Last Week', value: s.last ? lastLine(s.last) : 'Nobody has won yet.' },
    );
  const buttons = COUNTS.map((n) =>
    new ButtonBuilder()
      .setCustomId(`${BUY_ID}:${member.id}:${n}`)
      .setLabel(`Buy ${n} (${fmt(n * TICKET)})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(s.left < n || souls < n * TICKET));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)], allowedMentions: { parse: [] } };
}

// What the buyer is told, privately, after a Buy button.
function receipt(result) {
  if (result.ok) return `You bought ${tickets(result.count)} for ${boldSouls(result.cost)}.`;
  return result.reason === 'limit' ? `You can hold **${MAX_TICKETS}** Tickets a week.` : "You don't have enough Souls for that.";
}

module.exports = {
  data: new SlashCommandBuilder().setName('jackpot').setDescription('The Weekly Jackpot: buy Tickets, one winner takes the pot every Monday'),
  BUY_ID,
  jackpotView,
  receipt,

  async execute(interaction) {
    return interaction.reply(await jackpotView(interaction.member));
  },
};
