// /lfg-config (Manage Channels): set LFG up in a server (`setup`, `pings-menu`), close a lobby, the empty-lobby timeout, the lobby category, mode settings, and the LFG regions (add / remove / rename a region's channel and role). A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Lobbies and the region list: utils/server/lfg.js. The "rename the role too?" buttons: components/lfgRegions.js.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { REPLY_COLOR } = require('../../config');
const { replyEmbed, privateReply } = require('../../utils/embeds');
const { findOrCreateChannel } = require('../../utils/guild');
const { menusWithRole, fetchMenuMessage, dropOption } = require('../../utils/server/reactionRoles');
const { pingMenuMessage } = require('../../components/lfgPings');
const {
  MODES,
  getSettings,
  updateSettings,
  closeLobby,
  isLobby,
  openLobbies,
  regionKey,
  regionChannelName,
  ensureInfrastructure,
  isSetUp,
  RANKS,
  PING_ROLES,
} = require('../../utils/server/lfg');

const modeChoices = Object.entries(MODES).map(([value, m]) => ({ name: m.label, value }));
const regionOption = (o) => o.setName('region').setDescription('Pick a region').setAutocomplete(true).setRequired(true);
const regionLine = (r) => `**${r.label}** <#${r.channelId}>${r.roleId ? ` · <@&${r.roleId}>` : ''}`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lfg-config')
    .setDescription('Staff: manage the LFG system')
    // Hidden from members without Manage Channels (checked again below).
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set LFG up in this server: the ping and rank roles, an LFG category and a first region channel')
        .addStringOption((o) => o.setName('region').setDescription('Name of the first region, e.g. NA (default: Any). Add more later with region-add').setMaxLength(30)),
    )
    .addSubcommand((s) => s.setName('pings-menu').setDescription('Post the LFG Pings dropdown here, so members can pick their LFG ping roles'))
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
    .addSubcommand((s) =>
      s
        .setName('region-add')
        .setDescription('Add an LFG region: a new channel, or one you already have')
        .addStringOption((o) => o.setName('name').setDescription('Name shown on lobbies, like Europe').setMaxLength(30).setRequired(true))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Use this channel (leave empty to make a new #lfg-<name>)').addChannelTypes(ChannelType.GuildText),
        )
        .addRoleOption((o) => o.setName('role').setDescription('A role that belongs to this region (kept in step by remove / rename)')),
    )
    .addSubcommand((s) =>
      s
        .setName('region-remove')
        .setDescription('Remove an LFG region, and its channel and role if you say so')
        .addStringOption(regionOption)
        .addBooleanOption((o) => o.setName('delete-channel').setDescription('Delete its channel (false = keep it as a normal channel)').setRequired(true))
        .addBooleanOption((o) => o.setName('delete-role').setDescription('Delete its role too (needs Manage Roles; false = keep it)').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('region-rename')
        .setDescription("Rename a region's channel (I'll ask about its role after)")
        .addStringOption(regionOption)
        .addStringOption((o) => o.setName('channel-name').setDescription('New channel name').setMaxLength(100))
        .addStringOption((o) => o.setName('label').setDescription('New name shown on lobbies (default: unchanged)').setMaxLength(30)),
    )
    .addSubcommand((s) =>
      s
        .setName('region-role')
        .setDescription("Link a role to a region, or unlink it (needs Manage Roles)")
        .addStringOption(regionOption)
        .addRoleOption((o) => o.setName('role').setDescription('The role (leave empty to unlink)')),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Show the current LFG settings')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = focused.value.toLowerCase();
    if (focused.name === 'region') {
      const regions = Object.entries((await getSettings(interaction.guildId))?.regions ?? {});
      const found = regions.filter(([, r]) => r.label.toLowerCase().includes(typed));
      return interaction.respond(found.slice(0, 25).map(([key, r]) => ({ name: r.label, value: key })));
    }
    const lobbies = (await openLobbies(interaction.guild)).filter((c) => c.name.toLowerCase().includes(typed));
    await interaction.respond(lobbies.slice(0, 25).map((c) => ({ name: c.name.slice(0, 100), value: c.id })));
  },

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
    const reply = (text) => privateReply(interaction, text);
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const guildId = interaction.guildId;

    if (sub === 'setup') {
      const label = (interaction.options.getString('region') ?? 'Any').trim() || 'Any';
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const cfg = await ensureInfrastructure(guild, { regions: { [regionKey(label, {})]: { label, name: regionChannelName(label) } } });
        const regions = Object.values(cfg.regions).map(regionLine).join('\n');
        const next = [
          '**Next:**',
          '• `/lfg-config pings-menu` in a channel members can see: they pick their LFG pings from it.',
          '• Ranked LFG uses the rank roles (Initiate to Eternus). Give members theirs with `/reaction-roles`, or by hand.',
          '• `/lfg-config region-add` for more regions, and `/lfg` to start a lobby inside a region channel.',
        ];
        return interaction.editReply({
          embeds: [
            replyEmbed(
              [`LFG is set up. I made (or found) ${RANKS.length} rank roles, ${PING_ROLES.length} LFG ping roles and an **LFG** category.`, '', '**Regions**', regions, '', ...next].join('\n'),
            ),
          ],
        });
      } catch (error) {
        console.error('[lfg] /lfg-config setup failed:', error);
        return interaction.editReply({ embeds: [replyEmbed("I couldn't finish setting LFG up. Check that I have **Manage Roles** and **Manage Channels**, then run `/lfg-config setup` again (it picks up where it stopped).")] });
      }
    }

    if (!isSetUp(await getSettings(guildId))) return reply('LFG is not set up in this server yet. Run `/lfg-config setup` first.');

    if (sub === 'pings-menu') {
      await interaction.channel.send(pingMenuMessage());
      return reply('Posted the LFG Pings dropdown here. Members pick their LFG pings from it.');
    }

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

    const cfg = await getSettings(guildId);
    const regions = cfg.regions ?? {};

    if (sub === 'region-add') {
      const name = interaction.options.getString('name').trim();
      const picked = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      if (Object.values(regions).some((r) => r.label.toLowerCase() === name.toLowerCase())) return reply(`There is already a region called **${name}**.`);
      if (role && (role.id === guild.id || role.managed)) return reply(`${role} can't be linked: it's @everyone or belongs to a bot.`);
      if (role && !(await requirePermission(interaction, PermissionFlagsBits.ManageRoles))) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = picked ?? (await findOrCreateChannel(guild, { name: regionChannelName(name), type: ChannelType.GuildText, parent: cfg.lfgCategoryId }, null));
      if (Object.values(regions).some((r) => r.channelId === channel.id)) {
        return interaction.editReply({ embeds: [replyEmbed(`${channel} is already a region's channel.`)] });
      }
      const key = regionKey(name, regions);
      const region = { label: name, name: channel.name, channelId: channel.id, ...(role && { roleId: role.id }) };
      await updateSettings(guildId, (s) => (s.regions = { ...s.regions, [key]: region }));
      return interaction.editReply({ embeds: [replyEmbed(`Added the region ${regionLine(region)}. \`/lfg\` works in ${channel} now.`)] });
    }

    if (sub === 'region-remove' || sub === 'region-rename' || sub === 'region-role') {
      const key = interaction.options.getString('region');
      const region = regions[key];
      if (!region) return reply("That region doesn't exist. Pick one from the list.");
      const role = region.roleId ? guild.roles.cache.get(region.roleId) : null;
      const channel = await guild.channels.fetch(region.channelId).catch(() => null);

      if (sub === 'region-role') {
        if (!(await requirePermission(interaction, PermissionFlagsBits.ManageRoles))) return;
        const next = interaction.options.getRole('role');
        if (next && (next.id === guild.id || next.managed)) return reply(`${next} can't be linked: it's @everyone or belongs to a bot.`);
        await updateSettings(guildId, (s) => {
          const { roleId: _old, ...rest } = s.regions[key];
          s.regions = { ...s.regions, [key]: { ...rest, ...(next && { roleId: next.id }) } };
        });
        return reply(next ? `**${region.label}** is now linked to ${next}.` : `**${region.label}** has no linked role now.`);
      }

      if (sub === 'region-rename') {
        const channelName = interaction.options.getString('channel-name');
        const label = interaction.options.getString('label')?.trim();
        if (!channelName && !label) return reply('Give a new channel name, a new label, or both.');
        if (label && Object.entries(regions).some(([k, r]) => k !== key && r.label.toLowerCase() === label.toLowerCase())) {
          return reply(`There is already a region called **${label}**.`);
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (channelName && channel) {
          // Discord only allows 2 channel renames per 10 minutes.
          const failed = await channel.setName(channelName, `LFG region renamed by ${interaction.user.tag}`).then(() => null, (e) => e.message);
          if (failed) return interaction.editReply({ embeds: [replyEmbed(`I couldn't rename ${channel}: ${failed}`)] });
        }
        await updateSettings(guildId, (s) => {
          s.regions = { ...s.regions, [key]: { ...region, label: label ?? region.label, name: channel?.name ?? region.name } };
        });
        const done = `Renamed${channel ? ` ${channel}` : ''}${label ? `, now shown as **${label}** on lobbies` : ''}.`;
        if (!role) return interaction.editReply({ embeds: [replyEmbed(done)] });
        // Ask about the role: Yes opens a pop-up to type its new name (components/lfgRegions.js).
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`lfg_role:rename:${interaction.user.id}:${key}`).setLabel('Rename Role').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`lfg_role:keep:${interaction.user.id}:${key}`).setLabel('Keep Role Name').setStyle(ButtonStyle.Secondary),
        );
        return interaction.editReply({ embeds: [replyEmbed(`${done}\nThis region has the role ${role}. Rename it too?`)], components: [row] });
      }

      // region-remove
      if (Object.keys(regions).length === 1) {
        return reply("That's the only LFG region left, and `/lfg` needs one. Add another first, or rename this one.");
      }
      const deleteChannel = interaction.options.getBoolean('delete-channel');
      const deleteRole = interaction.options.getBoolean('delete-role');
      if (deleteRole && role && !(await requirePermission(interaction, PermissionFlagsBits.ManageRoles))) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await updateSettings(guildId, (s) => {
        const { [key]: _gone, ...rest } = s.regions;
        s.regions = rest;
      });
      const lines = [`Removed the region **${region.label}**.`];
      const why = `LFG region ${region.label} removed by ${interaction.user.tag}`;

      if (deleteRole && role) {
        const gone = await role.delete(why).then(() => true, (e) => lines.push(`I couldn't delete ${role.name}: ${e.message}`) && false);
        if (gone) {
          lines.push(`Deleted the role **${role.name}**.`);
          // The role may be a #roles option: take it off those menus too, or they'd show a deleted role.
          for (const [id, menu] of await menusWithRole(guildId, role.id)) {
            const message = await fetchMenuMessage(guild, id, menu);
            if (message?.embeds[0] && (await dropOption(message, id, menu, role.id))) lines.push(`Took it off the menu \`${id}\` in <#${menu.channelId}>.`);
          }
        }
      } else if (role) {
        lines.push(`Kept the role ${role}.`);
      }

      if (deleteChannel && channel) {
        const gone = await channel.delete(why).then(() => true, (e) => lines.push(`I couldn't delete the channel: ${e.message}`) && false);
        if (gone) lines.push(`Deleted **#${channel.name}**.`);
      } else if (channel) {
        lines.push(`Kept ${channel} as a normal channel.`);
      }
      return interaction.editReply({ embeds: [replyEmbed(lines.join('\n'))] });
    }

    // show
    const off = new Set(cfg.disabledModes ?? []);
    const embed = new EmbedBuilder()
      .setColor(REPLY_COLOR)
      .setTitle('LFG Settings')
      .addFields(
        { name: 'Regions', value: Object.values(regions).map(regionLine).join('\n').slice(0, 1024) || 'none' },
        { name: 'Lobby Category', value: `<#${cfg.categoryId}>`, inline: true },
        { name: 'Empty Timeout', value: `${cfg.timeoutMinutes ?? 5} min`, inline: true },
        {
          name: 'Modes',
          value: Object.entries(MODES).map(([k, m]) => `${m.label}: ${off.has(k) ? 'Off' : '**On**'}`).join(' · '),
        },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
