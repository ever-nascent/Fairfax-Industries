const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { BRAND_COLOR } = require('../../config');
const { replyEmbed, privateReply } = require('../../utils/embeds');
const {
  RANKS,
  MODES,
  lfgRoleName,
  joinableRanks,
  getSettings,
  registerLobby,
  findOpenLobbyFor,
  getTimeoutMinutes,
  regionForChannel,
} = require('../../utils/lfg');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lfg')
    .setDescription('Look for a Deadlock game: pings players and opens a voice lobby')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Game mode')
        .setRequired(true)
        .addChoices(
          { name: 'Standard', value: 'standard' },
          { name: 'Street Brawl', value: 'streetbrawl' },
          { name: 'Ranked', value: 'ranked' },
        ),
    ),

  async execute(interaction) {
    const reply = (text) => privateReply(interaction, text);
    const { guild, member, user } = interaction;
    const mode = interaction.options.getString('mode');
    const cfg = await getSettings(guild.id);
    if (!cfg) return reply('LFG is still being set up. Try again in a minute.');
    if (cfg.disabledModes?.includes(mode)) return reply(`${MODES[mode].label} LFG is turned off right now.`);

    // The region comes from the channel /lfg is run in.
    const region = regionForChannel(cfg, interaction.channelId);
    if (!region) {
      const list = Object.values(cfg.regionChannels).map((id) => `<#${id}>`).join(' ');
      return reply(`Run /lfg in your region's LFG channel: ${list}`);
    }

    // One open lobby per person.
    const existing = await findOpenLobbyFor(guild, user.id);
    if (existing) return reply(`You already have an open lobby: <#${existing}>`);

    // Work out the rank (ranked only), the ping role and who may join.
    let rank = null;
    let pingRoleId;
    let allowedRoleIds = null; // null = anyone can join
    if (mode === 'ranked') {
      const held = RANKS.filter((r) => member.roles.cache.has(cfg.roles[r]));
      if (held.length === 0) {
        const roles = guild.channels.cache.find((c) => c.name === 'roles' && c.type === ChannelType.GuildText);
        return reply(`You don't have a rank role yet. Grab yours in ${roles ?? '#roles'} first.`);
      }
      rank = held[held.length - 1]; // if they somehow hold several, use the highest
      pingRoleId = cfg.roles[lfgRoleName(rank)];
      allowedRoleIds = joinableRanks(rank).map((r) => cfg.roles[r]);
    } else {
      pingRoleId = cfg.roles[MODES[mode].lfgRole];
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const label = rank ? `${MODES.ranked.label} · ${rank}` : MODES[mode].label;
    const fullLabel = `${region.label} ${label}`;
    const overwrites = [];
    if (allowedRoleIds) {
      overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] });
      for (const id of allowedRoleIds) overwrites.push({ id, allow: [PermissionFlagsBits.Connect] });
      overwrites.push({ id: guild.members.me.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] });
    }

    const voice = await guild.channels.create({
      name: `${region.label} · ${label} · ${member.displayName}`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: cfg.categoryId,
      permissionOverwrites: overwrites,
      reason: `/lfg by ${user.tag}`,
    });

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`Looking for a game: ${fullLabel}`)
      .setDescription(`${user} is looking for a **${fullLabel}** game!\nJoin the lobby: ${voice}`)
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ text: `Lobby deletes itself after ${getTimeoutMinutes()} min with nobody in it` })
      .setTimestamp();
    if (rank) {
      embed.addFields({ name: 'Who can join', value: joinableRanks(rank).join(', ') });
    }

    const lfgChannel = interaction.channel;
    const message = await lfgChannel
      .send({
        content: `<@&${pingRoleId}>`,
        embeds: [embed],
        allowedMentions: { roles: [pingRoleId] }, // ping only the LFG role; the runner is shown, not pinged
      })
      .catch((error) => console.error('[lfg] Post failed:', error.message));
    // No post, no lobby: delete the voice channel so it isn't left behind, and tell the runner.
    if (!message) {
      await voice.delete('LFG post failed').catch(() => null);
      const failed = replyEmbed('An error occurred while posting your LFG. The lobby has been removed. Please run `/lfg` again.')
        .setColor(0xed4245) // Discord red: an error
        .setTitle('LFG Not Created')
        .addFields(
          { name: 'Mode', value: label, inline: true },
          { name: 'Region', value: region.label, inline: true },
          { name: 'Lobby', value: 'Removed', inline: true },
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [failed] });
    }

    await registerLobby(interaction.client, voice, {
      ownerId: user.id,
      mode,
      rank,
      region: region.key,
      messageId: message.id,
      textChannelId: lfgChannel.id,
    });

    await interaction.editReply({ embeds: [replyEmbed(`Lobby created: ${voice}. Posted here.`)] });
  },
};
