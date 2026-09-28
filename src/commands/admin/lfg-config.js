const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { REPLY_COLOR } = require('../../config');
const { replyEmbed } = require('../../utils/embeds');
const { MODES, getSettings, updateSettings, closeLobby, isLobby, openLobbies } = require('../../utils/lfg');

const modeChoices = Object.entries(MODES).map(([value, m]) => ({ name: m.label, value }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lfg-config')
    .setDescription('Staff: manage the LFG system')
    // Hidden from members without Manage Channels (checked again below).
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('Close an LFG lobby now (even if people are in it)')
        // Autocomplete lists only the lobbies that are open right now.
        .addStringOption((o) => o.setName('lobby').setDescription('Pick an open lobby').setAutocomplete(true).setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Saved in the server audit log')),
    )
    .addSubcommand((s) =>
      s
        .setName('timeout')
        .setDescription('How long an empty lobby waits before deleting itself')
        .addIntegerOption((o) =>
          o.setName('minutes').setDescription('1-120 minutes (default 5)').setMinValue(1).setMaxValue(120).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('lobby-category')
        .setDescription('Category new lobby voice channels are created in')
        .addChannelOption((o) =>
          o.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory).setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('mode')
        .setDescription('Turn a game mode on or off for /lfg')
        .addStringOption((o) => o.setName('mode').setDescription('Game mode').setRequired(true).addChoices(...modeChoices))
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Show the current LFG settings')),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const lobbies = (await openLobbies(interaction.guild)).filter((c) => c.name.toLowerCase().includes(typed));
    await interaction.respond(lobbies.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.id })));
  },

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
    const reply = (text) => interaction.reply({ embeds: [replyEmbed(text)], flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'close') {
      const lobby = interaction.guild.channels.cache.get(interaction.options.getString('lobby'));
      if (!lobby || !(await isLobby(lobby.id))) return reply("That lobby isn't open anymore. Pick one from the list.");
      const reason = interaction.options.getString('reason');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await closeLobby(interaction.client, lobby.id, {
        why: `closed by ${interaction.user.tag}${reason ? `: ${reason}` : ''}`.slice(0, 400),
        force: true,
      });
      return interaction.editReply({ embeds: [replyEmbed(`Closed **${lobby.name}**.`).setTimestamp()] });
    }

    if (sub === 'timeout') {
      const minutes = interaction.options.getInteger('minutes');
      await updateSettings(guildId, (s) => (s.timeoutMinutes = minutes));
      return reply(`LFG VC's will now automatically be deleted when vacant for **${minutes} minute${minutes === 1 ? '' : 's'}**.`);
    }

    if (sub === 'lobby-category') {
      const category = interaction.options.getChannel('category');
      await updateSettings(guildId, (s) => (s.categoryId = category.id));
      return reply(`New LFG VC's will be created under the **${category.name}** category.`);
    }

    if (sub === 'mode') {
      const mode = interaction.options.getString('mode');
      const enabled = interaction.options.getBoolean('enabled');
      await updateSettings(guildId, (s) => {
        const off = new Set(s.disabledModes ?? []);
        if (enabled) off.delete(mode);
        else off.add(mode);
        s.disabledModes = [...off];
      });
      return reply(`**${MODES[mode].label}** is now **${enabled ? 'enabled' : 'disabled'}** for /lfg.`);
    }

    // show
    const s = await getSettings(guildId);
    if (!s) return reply('LFG is not set up yet. Restart the bot.');
    const off = new Set(s.disabledModes ?? []);
    const embed = new EmbedBuilder()
      .setColor(REPLY_COLOR)
      .setTitle('LFG Settings')
      .addFields(
        { name: 'Region Channels', value: Object.values(s.regionChannels ?? {}).map((id) => `<#${id}>`).join(' ') || 'none' },
        { name: 'Lobby Category', value: `<#${s.categoryId}>`, inline: true },
        { name: 'Empty Timeout', value: `${s.timeoutMinutes ?? 5} min`, inline: true },
        {
          name: 'Modes',
          value: Object.entries(MODES).map(([k, m]) => `${m.label}: ${off.has(k) ? 'Off' : '**On**'}`).join(' · '),
        },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
