const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requirePermission } = require('./permissions');
const { privateReply } = require('./embeds');
const { EDITS, editUser } = require('./xp');
const { fmt, boldSouls } = require('./format');

const MAX_AMOUNT = 100_000_000;
const LABELS = { xp: 'XP', souls: 'Souls' };
const VERBS = { add: 'Add to', subtract: 'Subtract from', set: 'Set exactly', reset: 'Reset to 0 for' };

// Pure: the reply line for a member's new total.
const describe = (stat, user) =>
  stat === 'xp' ? `**${fmt(user.xp)} XP** (level ${user.level})` : boldSouls(user.souls);

const amountOption = (label) => (o) =>
  o.setName('amount').setDescription(`Amount of ${label}`).setMinValue(0).setMaxValue(MAX_AMOUNT).setRequired(true);

const memberOption = (o) => o.setName('member').setDescription('Member').setRequired(true);

// Amount first, then member: /souls add 500 @member. Reset only takes the member.
const subcommand = (label, action) => (s) => {
  const base = s.setName(action).setDescription(`${VERBS[action]} a member's ${label}`);
  return (action === 'reset' ? base : base.addIntegerOption(amountOption(label))).addUserOption(memberOption);
};

// Staff command for one stat ('xp' or 'souls'): /xp add|subtract|set|reset, /souls ...
const ledgerCommand = (stat) => ({
  data: Object.keys(EDITS).reduce(
    (built, action) => built.addSubcommand(subcommand(LABELS[stat], action)),
    new SlashCommandBuilder()
      .setName(stat)
      .setDescription(`Staff: change a member's ${LABELS[stat]}`)
      // Hidden from members without Manage Server (checked again below).
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const member = interaction.options.getUser('member');
    if (member.bot) return privateReply(interaction, "Bots don't have XP or Souls.");

    const user = await editUser(member.id, {
      stat,
      action: interaction.options.getSubcommand(),
      amount: interaction.options.getInteger('amount') ?? 0,
    });
    return privateReply(interaction, `${member} now has ${describe(stat, user)}.`);
  },
});

module.exports = { ledgerCommand };
