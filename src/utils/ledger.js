const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { requirePermission } = require('./permissions');
const { privateReply } = require('./embeds');
const { EDITS, editUser, getUser, MAX_LEVEL } = require('./xp');
const audit = require('./auditLog');
const { fmt, boldSouls, soulsText } = require('./format');
const souls = require('./soulsLedger');
const { walletEmbed, heroWalletView } = require('./wallet');
const { getFarmUser, hasHero } = require('./farm/play');
const { roster } = require('./farm/hero');
const { REPLY_COLOR } = require('../config');

const MAX_AMOUNT = 100_000_000;
const LABELS = { xp: 'XP', souls: 'Souls' };
const VERBS = { add: 'Add to', subtract: 'Subtract from', set: 'Set exactly', reset: 'Reset to 0 for', 'set-level': 'Set the level of' };

// Pure: the reply line for a member's new total.
const describe = (stat, user) =>
  stat === 'xp' ? `**${fmt(user.xp)} XP** (level ${user.level})` : boldSouls(user.souls);

const amountOption = (label, action) => (o) =>
  action === 'set-level'
    ? o.setName('amount').setDescription('The level').setMinValue(0).setMaxValue(MAX_LEVEL).setRequired(true)
    : o.setName('amount').setDescription(`Amount of ${label}`).setMinValue(0).setMaxValue(MAX_AMOUNT).setRequired(true);

const memberOption = (o) => o.setName('member').setDescription('Member').setRequired(true);

// Amount first, then member: /souls add 500 @member. Reset only takes the member. `prefix`: 'Staff: ' on /souls, which members see too.
const subcommand = (label, action, prefix = '') => (s) => {
  const base = s.setName(action).setDescription(prefix + (action === 'set-level' ? `${VERBS[action]} a member (XP follows)` : `${VERBS[action]} a member's ${label}`));
  return (action === 'reset' ? base : base.addIntegerOption(amountOption(label, action))).addUserOption(memberOption);
};

// Staff edits go to the audit log channel and the member's history, so a slip can be undone from the old value.
async function recordEdit(interaction, member, command, before, after) {
  const embed = audit.entryEmbed({
    color: audit.COLOR.edit,
    title: 'Staff edit: XP / souls',
    fields: [
      { name: 'Staff', value: audit.who(interaction.user), inline: true },
      { name: 'Member', value: audit.who(member), inline: true },
      { name: 'Command', value: `\`${command}\`` },
      { name: 'Before', value: before, inline: true },
      { name: 'After', value: after, inline: true },
    ],
  });
  await audit.log(interaction.guild, 'staff-edit', embed, { userIds: [interaction.user.id, member.id] });
  await audit.addHistory(member.id, 'staff-edit', `${interaction.user.username} ran ${command}: ${before.replace(/\*/g, '')} → ${after.replace(/\*/g, '')}`);
}

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

// /souls history: a member's last 15 souls changes, newest first, each with the balance after it (a farm hero's own souls: "→ Haze: 1,234").
async function showHistory(interaction, member) {
  const rows = souls.history(member.id, 15);
  if (!rows.length) return privateReply(interaction, `Nothing recorded for ${member} yet. (The ledger started on Oct 4, 2026.)`);
  const lines = rows.map((e) => `<t:${Math.floor(e.t / 1000)}:f> **${signed(e.d)}** ${souls.label(e.r)}${e.w ? ` (with <@${e.w}>)` : ''} → ${e.h ? `${e.h}: ` : ''}${fmt(e.b)}`);
  const embed = new EmbedBuilder().setColor(REPLY_COLOR).setTitle(`Souls: ${member.username}`).setDescription(lines.join('\n'));
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

// /souls report: what each source paid in and took out over the last `days`, and who keeps winning duels off whom.
async function showReport(interaction, days) {
  const { rows, pairs } = souls.report(Date.now() - days * 86_400_000);
  if (!rows.length) return privateReply(interaction, `No souls moved in the last ${days} days.`);
  const net = rows.reduce((sum, r) => sum + r.in - r.out, 0);
  const lines = rows.slice(0, 20).map((r) => `**${souls.label(r.reason)}**: +${fmt(r.in)} / −${fmt(r.out)} (${fmt(r.count)})`);
  const embed = new EmbedBuilder()
    .setColor(REPLY_COLOR)
    .setTitle(`Souls economy: last ${days} day${days === 1 ? '' : 's'}`)
    .setDescription(`${lines.join('\n')}\n\nNet change in circulation: **${signed(net)}**`)
    .setFooter({ text: 'Each line: souls in / souls out (changes). Games show what players won and bet.' });
  const duels = pairs.filter((p) => p.count >= 2).slice(0, 5);
  if (duels.length) {
    embed.addFields({ name: 'Duel winners (worth a look)', value: duels.map((p) => `<@${p.winner}> beat <@${p.loser}> ${p.count}x: ${soulsText(p.souls)}`).join('\n') });
  }
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

// /souls is everyone's (his calls, Oct 11: it replaces /wallet): `balance` (the server balance) and `hero` (one of their Hero Farming heroes'
// own souls), both private. Its other subcommands stay the staff tools (his call: members see them in the list and are refused).
const memberSubs = (built) => built
  .addSubcommand((s) => s.setName('balance').setDescription('Your souls, Soul Boost, Rejuvs and recent activity (only you see it)'))
  .addSubcommand((s) => s.setName('hero').setDescription("One of your Hero Farming heroes: its own souls, level, Rejuvs and buffs (only you see it)")
    .addStringOption((o) => o.setName('hero').setDescription('Which hero (default: your current one)').setAutocomplete(true)));

// The slash command: one subcommand per edit; /souls also gets history and report (the souls ledger), and the members' own two first.
function buildData(stat) {
  const start = new SlashCommandBuilder().setName(stat);
  if (stat === 'souls') memberSubs(start.setDescription('Your souls, and your heroes\' (staff: change a member\'s souls)'));
  // /xp is hidden from members without Manage Server (checked again below)
  else start.setDescription(`Staff: change a member's ${LABELS[stat]}`).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  const built = Object.keys(EDITS)
    .filter((action) => action !== 'set-level' || stat === 'xp')
    .reduce((built, action) => built.addSubcommand(subcommand(LABELS[stat], action, stat === 'souls' ? 'Staff: ' : '')), start);
  if (stat === 'souls') {
    built
      .addSubcommand((s) => s.setName('history').setDescription("Staff: a member's last 15 souls changes").addUserOption(memberOption))
      .addSubcommand((s) =>
        s
          .setName('report')
          .setDescription('Staff: what paid souls in and took them out (urn, games, shop, farm ...)')
          .addIntegerOption((o) => o.setName('days').setDescription('How many days back (default 7)').setMinValue(1).setMaxValue(365)),
      );
  }
  return built;
}

// /souls balance: what /wallet showed (the server balance's own changes only).
async function showBalance(interaction) {
  const user = await getUser(interaction.user.id);
  const embed = walletEmbed(interaction.member, user, souls.history(interaction.user.id, 6, { heroes: false }));
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// /souls hero [hero]: one of the member's unlocked heroes (default: the current one), with its last 6 souls changes.
async function showHero(interaction) {
  const record = await getFarmUser(interaction.user.id);
  if (!record.hero) return privateReply(interaction, 'You have no hero yet. Pick one with `/base`.');
  const typed = interaction.options.getString('hero');
  const hero = typed ? roster().find((n) => n.toLowerCase() === typed.trim().toLowerCase()) : record.hero;
  if (!hero || !hasHero(record, hero)) return privateReply(interaction, `You haven't unlocked ${hero ?? typed}.`);
  const view = await heroWalletView(interaction.member, record, hero, souls.history(interaction.user.id, 6, { hero }));
  return interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
}

const ledgerCommand = (stat) => ({
  data: buildData(stat),

  // /souls hero: the member's unlocked heroes, current one first, filtered by what they typed
  async autocomplete(interaction) {
    const record = await getFarmUser(interaction.user.id);
    const typed = interaction.options.getFocused().toLowerCase();
    const mine = roster().filter((n) => hasHero(record, n)).sort((a, b) => (b === record.hero) - (a === record.hero));
    await interaction.respond(mine.filter((n) => n.toLowerCase().includes(typed)).slice(0, 25).map((n) => ({ name: n === record.hero ? `${n} (current)` : n, value: n })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (stat === 'souls' && sub === 'balance') return showBalance(interaction);
    if (stat === 'souls' && sub === 'hero') return showHero(interaction);
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    if (sub === 'report') return showReport(interaction, interaction.options.getInteger('days') ?? 7);
    const member = interaction.options.getUser('member');
    if (sub === 'history') return showHistory(interaction, member);
    if (member.bot) return privateReply(interaction, "Bots don't have XP or Souls.");

    const action = interaction.options.getSubcommand();
    const amount = interaction.options.getInteger('amount') ?? 0;
    const before = await getUser(member.id);
    const user = await editUser(member.id, { stat, action, amount });
    const command = `/${stat} ${action}${action === 'reset' ? '' : ` ${fmt(amount)}`}`;
    await recordEdit(interaction, member, command, describe(stat, before), describe(stat, user));
    return privateReply(interaction, `${member} now has ${describe(stat, user)}.`);
  },
});

module.exports = { ledgerCommand };
