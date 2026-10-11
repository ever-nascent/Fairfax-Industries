const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { requirePermission } = require('./permissions');
const { privateReply } = require('./embeds');
const { EDITS, editUser, getUser, MAX_LEVEL } = require('./xp');
const audit = require('./auditLog');
const { fmt, boldSouls, soulsText } = require('./format');
const souls = require('./soulsLedger');
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

// Amount first, then member: /souls add 500 @member. Reset only takes the member.
const subcommand = (label, action) => (s) => {
  const base = s.setName(action).setDescription(action === 'set-level' ? `${VERBS[action]} a member (XP follows)` : `${VERBS[action]} a member's ${label}`);
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

// The slash command: one subcommand per edit; /souls also gets history and report (the souls ledger).
function buildData(stat) {
  const built = Object.keys(EDITS)
    .filter((action) => action !== 'set-level' || stat === 'xp')
    .reduce(
      (built, action) => built.addSubcommand(subcommand(LABELS[stat], action)),
      new SlashCommandBuilder()
        .setName(stat)
        .setDescription(`Staff: change a member's ${LABELS[stat]}`)
        // Hidden from members without Manage Server (checked again below).
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    );
  if (stat === 'souls') {
    built
      .addSubcommand((s) => s.setName('history').setDescription("A member's last 15 souls changes").addUserOption(memberOption))
      .addSubcommand((s) =>
        s
          .setName('report')
          .setDescription('What paid souls in and took them out (urn, games, shop, farm ...)')
          .addIntegerOption((o) => o.setName('days').setDescription('How many days back (default 7)').setMinValue(1).setMaxValue(365)),
      );
  }
  return built;
}

const ledgerCommand = (stat) => ({
  data: buildData(stat),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const sub = interaction.options.getSubcommand();
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
