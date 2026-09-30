const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { REPLY_COLOR } = require('../../config');
const { privateReply } = require('../../utils/embeds');
const { getSettings, updateSettings } = require('../../utils/xp');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xp-config')
    .setDescription('Staff: manage XP and levels')
    // Hidden from members without Manage Server (checked again below).
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('chat')
        .setDescription('XP per chat message and the cooldown between counted messages')
        .addIntegerOption((o) =>
          o.setName('min').setDescription('Least XP per message (default 15)').setMinValue(0).setMaxValue(1000).setRequired(true),
        )
        .addIntegerOption((o) =>
          o.setName('max').setDescription('Most XP per message (default 25)').setMinValue(0).setMaxValue(1000).setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('cooldown')
            .setDescription('Seconds between counted messages (default 60)')
            .setMinValue(0)
            .setMaxValue(3600)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('voice')
        .setDescription('Turn voice XP on or off')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('per-minute').setDescription('XP per minute in voice (default 10)').setMinValue(1).setMaxValue(1000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('level-up-channel')
        .setDescription('Where level-ups are announced (leave empty to turn announcements off)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Show the current XP settings')),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const reply = (text) => privateReply(interaction, text);
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'chat') {
      const min = interaction.options.getInteger('min');
      const max = interaction.options.getInteger('max');
      const cooldown = interaction.options.getInteger('cooldown');
      if (min > max) return reply("`min` can't be bigger than `max`.");
      await updateSettings(guildId, (s) => Object.assign(s, { minXp: min, maxXp: max, cooldownSeconds: cooldown }));
      return reply(`Chat XP is now **${min}–${max}** per message, once every **${cooldown}s**.`);
    }

    if (sub === 'voice') {
      const enabled = interaction.options.getBoolean('enabled');
      const perMinute = interaction.options.getInteger('per-minute');
      const s = await updateSettings(guildId, (s) => {
        s.voiceEnabled = enabled;
        if (perMinute) s.voiceXpPerMinute = perMinute;
      });
      return reply(enabled ? `Voice XP is **on**: **${s.voiceXpPerMinute} XP/min**.` : 'Voice XP is **off**.');
    }

    if (sub === 'level-up-channel') {
      const channel = interaction.options.getChannel('channel');
      await updateSettings(guildId, (s) => (s.levelUpChannelId = channel?.id ?? null));
      return reply(channel ? `Level-ups will be announced in ${channel}.` : 'Level-up announcements are **off**.');
    }

    // show
    const s = await getSettings(guildId);
    const embed = new EmbedBuilder()
      .setColor(REPLY_COLOR)
      .setTitle('XP settings')
      .addFields(
        { name: 'Chat XP', value: `${s.minXp}–${s.maxXp} per message, every ${s.cooldownSeconds}s`, inline: true },
        { name: 'Voice XP', value: s.voiceEnabled ? `On, ${s.voiceXpPerMinute}/min` : 'Off', inline: true },
        { name: 'Level-up channel', value: s.levelUpChannelId ? `<#${s.levelUpChannelId}>` : 'Off' },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
