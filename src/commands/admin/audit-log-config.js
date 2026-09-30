const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { REPLY_COLOR } = require('../../config');
const { privateReply } = require('../../utils/embeds');
const { EVENTS, getSettings, updateSettings, getHistory, ts, clip } = require('../../utils/auditLog');

const ALL = 'all';

// Adds or removes `id` in the settings list `key`.
const setIn = (key, id, on) => updateSettings((s) => (s[key] = on ? [...new Set([...s[key], id])] : s[key].filter((x) => x !== id)));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('audit-log-config')
    .setDescription('Admins: choose what the audit log records')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName('event')
        .setDescription('Turn one event (or all of them) on or off')
        .addStringOption((o) => o.setName('event').setDescription('Start typing to search').setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName('on').setDescription('On or off').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('ignore-channel')
        .setDescription('Stop (or start again) logging what happens in a channel or category')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true))
        .addBooleanOption((o) => o.setName('ignore').setDescription('True = ignore it, false = log it again').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('ignore-member')
        .setDescription('Stop (or start again) logging what a member does')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addBooleanOption((o) => o.setName('ignore').setDescription('True = ignore them, false = log them again').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Move the audit log to another channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('account-age')
        .setDescription('Flag joins from accounts younger than this')
        .addIntegerOption((o) => o.setName('days').setDescription('Days (default 7)').setMinValue(1).setMaxValue(365).setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription("A member's names, nicknames, joins/leaves and mod actions")
        .addUserOption((o) => o.setName('member').setDescription('Member (can be someone who left)').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Show the current audit log settings')),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = [[ALL, 'All events'], ...Object.entries(EVENTS)]
      .filter(([key, name]) => key.includes(typed) || name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map(([value, name]) => ({ name: name.slice(0, 100), value }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.Administrator))) return;
    const reply = (text) => privateReply(interaction, text);
    const sub = interaction.options.getSubcommand();

    if (sub === 'event') {
      const event = interaction.options.getString('event');
      const on = interaction.options.getBoolean('on');
      if (event !== ALL && !EVENTS[event]) return reply('Pick an event from the list.');
      await updateSettings((s) => {
        const keys = event === ALL ? Object.keys(EVENTS) : [event];
        s.off = on ? s.off.filter((k) => !keys.includes(k)) : [...new Set([...s.off, ...keys])];
      });
      return reply(`${event === ALL ? 'All events' : `**${EVENTS[event]}**`}: now **${on ? 'on' : 'off'}**.`);
    }

    if (sub === 'ignore-channel') {
      const channel = interaction.options.getChannel('channel');
      const ignore = interaction.options.getBoolean('ignore');
      await setIn('ignoredChannels', channel.id, ignore);
      const inside = channel.type === ChannelType.GuildCategory ? ' and every channel in it' : '';
      return reply(ignore ? `Nothing in ${channel}${inside} is logged now.` : `${channel}${inside} is logged again.`);
    }

    if (sub === 'ignore-member') {
      const user = interaction.options.getUser('member');
      const ignore = interaction.options.getBoolean('ignore');
      await setIn('ignoredMembers', user.id, ignore);
      return reply(ignore ? `Nothing ${user} does is logged now.` : `${user} is logged again.`);
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      await updateSettings((s) => (s.channelId = channel.id));
      return reply(`The audit log now posts in ${channel}. Its permissions weren't changed: check who can see it.`);
    }

    if (sub === 'account-age') {
      const days = interaction.options.getInteger('days');
      await updateSettings((s) => (s.newAccountDays = days));
      return reply(`Joins from accounts younger than **${days} day${days === 1 ? '' : 's'}** are flagged as new accounts.`);
    }

    if (sub === 'history') {
      const user = interaction.options.getUser('member');
      const history = await getHistory(user.id);
      if (!history.length) return reply(`Nothing recorded for ${user} yet. (History started when the audit log was turned on.)`);
      const lines = history.map((h) => `${ts(h.at)} ${h.text}`).reverse(); // newest first
      let text = '';
      for (const line of lines) {
        if (text.length + line.length + 1 > 3800) break;
        text += `${line}\n`;
      }
      const shown = text.trim().split('\n').length;
      const embed = new EmbedBuilder()
        .setColor(REPLY_COLOR)
        .setTitle(`History: ${user.username}`)
        .setDescription(text)
        .setFooter({ text: `User ID: ${user.id} | ${history.length} records${shown < lines.length ? `, newest ${shown} shown, all in the file` : ''}` });
      const files =
        shown < lines.length
          ? [new AttachmentBuilder(Buffer.from(history.map((h) => `${new Date(h.at).toISOString()} ${h.text}`).join('\n')), { name: `history-${user.id}.txt` })]
          : [];
      return interaction.reply({ embeds: [embed], files, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    // show
    const s = await getSettings();
    const off = Object.keys(EVENTS).filter((k) => s.off.includes(k));
    const embed = new EmbedBuilder()
      .setColor(REPLY_COLOR)
      .setTitle('Audit log settings')
      .addFields(
        { name: 'Log channel', value: `<#${s.channelId}>`, inline: true },
        { name: 'New account under', value: `${s.newAccountDays} days`, inline: true },
        { name: `Events off (${off.length}/${Object.keys(EVENTS).length})`, value: clip(off.map((k) => EVENTS[k]).join('\n'), 1024) || 'None: everything is logged' },
        { name: 'Ignored channels', value: clip(s.ignoredChannels.map((id) => `<#${id}>`).join(' '), 1024) || 'None' },
        { name: 'Ignored members', value: clip(s.ignoredMembers.map((id) => `<@${id}>`).join(' '), 1024) || 'None' },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
