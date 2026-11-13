// Weekly Jackpot (his picks, Nov 13: the second Souls sink from the economy review). Members buy tickets with server Souls; every
// Monday at midnight UTC (like the weekly quests) one ticket is drawn and its owner takes the pot. The pot is what the tickets cost
// minus HOUSE, which is removed for good. One record per server in data/jackpot.json:
//   { week (the Monday these tickets are for), tickets: { user id: count }, last: { week, winner, pot, mine, sold } | null, channelId }
// The command and its Buy buttons: commands/xp/jackpot.js, components/jackpot.js. The weekly draw: events/jackpotReady.js.
const crypto = require('node:crypto');
const { EmbedBuilder } = require('discord.js');
const { getStore } = require('../../storage');
const { SCALE } = require('./economy');
const { changeSouls } = require('./xp');
const { weekOf } = require('./quests');
const { boldSouls, soulsText } = require('../format');
const { REPLY_COLOR } = require('../../config');

const TICKET = 100 * SCALE; // his pick: 1,000 Souls
const HOUSE = 0.1; // the share of every ticket removed for good (his pick)
const MAX_TICKETS = 20; // per member per week
const WEEK_MS = 7 * 86_400_000;

const store = () => getStore('jackpot'); // key: server id
const blank = (week) => ({ week, tickets: {}, last: null, channelId: null });
const sold = (rec) => Object.values(rec.tickets).reduce((a, b) => a + b, 0);
const potOf = (tickets) => Math.floor(tickets * TICKET * (1 - HOUSE));
const drawAt = (now = Date.now()) => Date.parse(weekOf(now)) + WEEK_MS;

// Draws last week's winner if the week has turned and nobody has yet. Returns the draw ({ week, winner, pot, mine, sold }) the
// first time, else null. The winner is picked and the tickets cleared in one locked step, so it can only happen once; the pot is
// paid after. ponytail: a crash between the two loses that pot (the ledger shows no 'jackpot' win for the week); add a paid flag if it ever happens.
async function settle(guildId, now = Date.now(), randomInt = crypto.randomInt) {
  const week = weekOf(now);
  let drawn = null;
  await store().update(guildId, (cur) => {
    if (!cur || cur.week === week) return cur;
    const total = sold(cur);
    if (!total) return { ...cur, week, tickets: {} };
    let at = randomInt(total);
    const [winner, mine] = Object.entries(cur.tickets).find(([, n]) => (at -= n) < 0);
    drawn = { week: cur.week, winner, pot: potOf(total), mine, sold: total };
    return { ...cur, week, tickets: {}, last: drawn };
  });
  if (drawn) await changeSouls(drawn.winner, drawn.pot, 'jackpot');
  return drawn;
}

// This week's jackpot as `userId` sees it: { pot, sold, mine, left (tickets they may still buy), drawAt, last, channelId }.
async function status(guildId, userId, now = Date.now()) {
  await settle(guildId, now);
  const rec = (await store().get(guildId)) ?? blank(weekOf(now));
  const mine = rec.tickets[userId] ?? 0;
  return { pot: potOf(sold(rec)), sold: sold(rec), mine, left: MAX_TICKETS - mine, drawAt: drawAt(now), last: rec.last, channelId: rec.channelId };
}

// Buys `count` tickets. The tickets are claimed first, inside the store lock (so the weekly limit holds under fast clicks), then
// paid for; if the member can't pay, the claim is taken back. Returns { ok: true, count, cost, user } or { ok: false, reason: 'limit' | 'souls' }.
async function buyTickets(guildId, userId, count, now = Date.now()) {
  await settle(guildId, now);
  const week = weekOf(now);
  let claimed = false;
  await store().update(guildId, (cur) => {
    const rec = cur ?? blank(week);
    const mine = rec.tickets[userId] ?? 0;
    if (!(count >= 1) || mine + count > MAX_TICKETS) return cur;
    claimed = true;
    return { ...rec, tickets: { ...rec.tickets, [userId]: mine + count } };
  });
  if (!claimed) return { ok: false, reason: 'limit' };
  const cost = count * TICKET;
  const user = await changeSouls(userId, -cost, 'jackpot');
  if (user) return { ok: true, count, cost, user };
  await store().update(guildId, (rec) => {
    const mine = (rec.tickets[userId] ?? 0) - count;
    const tickets = { ...rec.tickets, [userId]: mine };
    if (mine <= 0) delete tickets[userId];
    return { ...rec, tickets };
  });
  return { ok: false, reason: 'souls' };
}

// Staff: where the winner is announced (null = nowhere; /jackpot still shows last week's).
const setChannel = (guildId, channelId, now = Date.now()) => store().update(guildId, (cur) => ({ ...(cur ?? blank(weekOf(now))), channelId }));

const tickets = (n) => `**${n}** ${n === 1 ? 'Ticket' : 'Tickets'}`;
// "<@id> won **9,000 Souls** with **3** of **10** Tickets."
const lastLine = (last) => `<@${last.winner}> won ${boldSouls(last.pot)} with **${last.mine}** of ${tickets(last.sold)}.`;

// The Shopkeeper's lines (original, in his voice).
const WIN_LINES = [
  "I pulled a name outta the jar and it's yours. Don't spend it all in one place. Spend it in mine.",
  "Somebody's gotta win, and this week it's you. Drinks are on the winner, that's the rule.",
  'One ticket outta the whole jar, and it had your name on it. Lucky you.',
];

// The post in the announcement channel once a week's winner is drawn.
function winnerMessage(drawn) {
  const embed = new EmbedBuilder()
    .setColor(REPLY_COLOR)
    .setTitle('Weekly Jackpot')
    .setDescription(`${lastLine(drawn)}\n\n${WIN_LINES[crypto.randomInt(WIN_LINES.length)]}`)
    .addFields({ name: 'Next Draw', value: `<t:${Math.floor(drawAt() / 1000)}:R>`, inline: true }, { name: 'Ticket Price', value: soulsText(TICKET), inline: true })
    .setFooter({ text: 'Buy Tickets with /jackpot.' });
  return { content: `<@${drawn.winner}>`, embeds: [embed], allowedMentions: { users: [drawn.winner] } };
}

// Settles the server's jackpot if its week has turned and posts the winner in the channel staff set. Returns the draw or null.
async function drawAndAnnounce(guild, now = Date.now()) {
  const drawn = await settle(guild.id, now);
  if (!drawn) return null;
  console.log(`[jackpot] "${guild.name}": ${drawn.winner} won ${drawn.pot} Souls (${drawn.mine} of ${drawn.sold} tickets)`);
  const { channelId } = (await store().get(guild.id)) ?? {};
  const channel = channelId && (await guild.channels.fetch(channelId).catch(() => null));
  await channel?.send(winnerMessage(drawn)).catch((error) => console.error('[jackpot] Could not announce the winner:', error.message));
  return drawn;
}

// Every server that has a jackpot record (the weekly sweep goes over these).
const servers = async () => Object.keys(await store().all());

module.exports = { TICKET, HOUSE, MAX_TICKETS, potOf, drawAt, settle, status, buyTickets, setChannel, lastLine, tickets, winnerMessage, drawAndAnnounce, servers };
