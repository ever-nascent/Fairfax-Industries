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
        )
        .addIntegerOption((o) =>
          o
            .setName('min-length')
            .setDescription('Shortest message (characters) that counts; 0 = any (default 0, leave empty to keep it)')
            .setMinValue(0)
            .setMaxValue(200),
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
    .addSubcommand((s) =>
      s
        .setName('ignore-channel')
        .setDescription('No XP in this channel or category (run again to turn it back on)')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Text, voice or stage channel, forum or category')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildVoice,
              ChannelType.GuildStageVoice,
              ChannelType.GuildCategory,
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('soul-bag')
        .setDescription('How often a Soul Bag drops in chat')
        .addNumberOption((o) =>
          o
            .setName('chance')
            .setDescription('% chance per counted chat message (default 2, 0 = off)')
            .setMinValue(0)
            .setMaxValue(100)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o.setName('cooldown').setDescription('Minutes between bags (default 60)').setMinValue(0).setMaxValue(1440).setRequired(true),
        ),
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
      const minLength = interaction.options.getInteger('min-length');
      const s = await updateSettings(guildId, (s) => {
        Object.assign(s, { minXp: min, maxXp: max, cooldownSeconds: cooldown });
        if (minLength !== null) s.minLength = minLength;
      });
      const length = s.minLength ? ` Messages under **${s.minLength}** characters don't count.` : '';
      return reply(`Chat XP is now **${min}–${max}** per message, once every **${cooldown}s**.${length}`);
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

    if (sub === 'ignore-channel') {
      const channel = interaction.options.getChannel('channel');
      const s = await updateSettings(guildId, (s) => {
        const on = s.ignoredChannelIds.includes(channel.id);
        s.ignoredChannelIds = on ? s.ignoredChannelIds.filter((id) => id !== channel.id) : [...s.ignoredChannelIds, channel.id];
      });
      return reply(s.ignoredChannelIds.includes(channel.id) ? `${channel} no longer gives XP.` : `${channel} gives XP again.`);
    }

    if (sub === 'soul-bag') {
      const chance = interaction.options.getNumber('chance');
      const cooldown = interaction.options.getInteger('cooldown');
      await updateSettings(guildId, (s) => Object.assign(s, { bagChance: chance, bagCooldownMinutes: cooldown }));
      return reply(
        chance ? `A Soul Bag has a **${chance}%** chance per chat message, at most once every **${cooldown} min**.` : 'Soul Bags are **off**.',
      );
    }

    // show
    const s = await getSettings(guildId);
    const embed = new EmbedBuilder()
      .setColor(REPLY_COLOR)
      .setTitle('XP settings')
      .addFields(
        {
          name: 'Chat XP',
          value: `${s.minXp}–${s.maxXp} per message, every ${s.cooldownSeconds}s${s.minLength ? `, ${s.minLength}+ characters` : ''}`,
          inline: true,
        },
        { name: 'Voice XP', value: s.voiceEnabled ? `On, ${s.voiceXpPerMinute}/min` : 'Off', inline: true },
        { name: 'Soul Bag', value: s.bagChance ? `${s.bagChance}% per message, every ${s.bagCooldownMinutes} min` : 'Off', inline: true },
        {
          name: 'Level-up channel',
          value: s.levelUpChannelId ? `<#${s.levelUpChannelId}>` : 'Off: nobody sees level-ups. Set one with `/xp-config level-up-channel`.',
        },
        { name: 'No XP in', value: s.ignoredChannelIds.map((id) => `<#${id}>`).join(' ') || 'No channel is ignored' },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
