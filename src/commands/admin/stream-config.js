// /stream-config (Manage Server): this server's Twitch and TikTok go-live alerts: the channel, the streamer names, who gets pinged, the text under the title. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// The alerts: utils/server/streams.js.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { replyEmbed, privateReply } = require('../../utils/embeds');
const { PLATFORMS, getConfig, updateConfig, getDescription, setDescription, forgetStream, liveMessage } = require('../../utils/server/streams');

const NAME_OK = { twitch: /^\w{3,25}$/, tiktok: /^[\w.]{2,24}$/ };

// Made-up streams, so staff can see the alerts with their description without going live.
const sample = (platform, login) => (platform === 'twitch'
  ? { name: login, title: '(your stream title goes here)', url: `https://www.twitch.tv/${login}`, game: 'Deadlock' }
  : { name: login, title: '(your stream title goes here)', url: `https://www.tiktok.com/@${login}/live` });

const pingText = (ping) => ({ everyone: '@everyone', here: '@here', none: 'nobody' }[ping] ?? `<@&${ping}>`);

async function showText(guildId) {
  const c = await getConfig(guildId);
  return [
    `**Alerts Channel:** ${c.channelId ? `<#${c.channelId}>` : 'Not set (nothing is posted)'}`,
    `**Twitch:** ${c.twitch ?? 'Not set'}${c.twitch && !PLATFORMS.twitch.enabled() ? ' (the bot has no Twitch keys, so this stays off)' : ''}`,
    `**TikTok:** ${c.tiktok ?? 'Not set'}`,
    `**Ping:** ${pingText(c.ping)}`,
    `**Description:** ${c.description || 'None'}`,
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-config')
    .setDescription('Staff: set up the Twitch and TikTok go-live alerts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('channel').setDescription('Where the alerts are posted')
      .addChannelOption((o) => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('twitch').setDescription('The Twitch channel to watch (empty = stop)')
      .addStringOption((o) => o.setName('name').setDescription('Twitch channel name').setMaxLength(25)))
    .addSubcommand((s) => s.setName('tiktok').setDescription('The TikTok account to watch (empty = stop)')
      .addStringOption((o) => o.setName('name').setDescription('TikTok name, without the @').setMaxLength(24)))
    .addSubcommand((s) => s.setName('ping').setDescription('Who an alert pings')
      .addStringOption((o) => o.setName('who').setDescription('Who to ping').setRequired(true).addChoices({ name: 'Everyone', value: 'everyone' }, { name: 'Here', value: 'here' }, { name: 'Nobody', value: 'none' }, { name: 'A Role (pick it below)', value: 'role' }))
      .addRoleOption((o) => o.setName('role').setDescription('The role, when you chose A Role')))
    .addSubcommand((s) => s.setName('description').setDescription('Edit the text shown under the stream title (empty = none)'))
    .addSubcommand((s) => s.setName('show').setDescription('Show the current alert settings')),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      await updateConfig(guildId, { channelId: channel.id });
      return privateReply(interaction, `Go-live alerts are posted in ${channel}.`);
    }

    if (sub === 'twitch' || sub === 'tiktok') {
      const name = (interaction.options.getString('name') ?? '').trim().replace(/^@/, '');
      if (name && !NAME_OK[sub].test(name)) return privateReply(interaction, `**${name}** isn't a valid ${PLATFORMS[sub].label} name.`);
      await updateConfig(guildId, { [sub]: name || null });
      await forgetStream(guildId, sub); // switching on mid-stream stays quiet
      const note = name && sub === 'twitch' && !PLATFORMS.twitch.enabled() ? ' The bot has no Twitch keys yet, so Twitch alerts stay off until its owner adds them.' : '';
      return privateReply(interaction, name ? `Watching **${name}** on ${PLATFORMS[sub].label}.${(await getConfig(guildId)).channelId ? '' : ' Set a channel with `/stream-config channel` so the alerts have somewhere to go.'}${note}` : `${PLATFORMS[sub].label} alerts are off.`);
    }

    if (sub === 'ping') {
      const who = interaction.options.getString('who');
      const role = interaction.options.getRole('role');
      if (who === 'role' && !role) return privateReply(interaction, 'Pick the role in the **role** option.');
      await updateConfig(guildId, { ping: who === 'role' ? role.id : who });
      return privateReply(interaction, `Alerts ping ${who === 'role' ? role : pingText(who)}.`);
    }

    if (sub === 'show') return privateReply(interaction, await showText(guildId));

    // description
    const modalId = `stream-config:${interaction.id}`;
    const input = new TextInputBuilder()
      .setCustomId('text')
      .setLabel('Description (leave empty for none)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(4000);
    const current = await getDescription(guildId);
    if (current) input.setValue(current); // no pre-fill when there's nothing saved yet
    await interaction.showModal(
      new ModalBuilder().setCustomId(modalId).setTitle('Go-Live Alert Description').addComponents(new ActionRowBuilder().addComponents(input)),
    );

    const submit = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 15 * 60_000 }).catch(() => null);
    if (!submit) return; // closed or timed out
    const text = submit.fields.getTextInputValue('text').trim();
    await setDescription(guildId, text);
    const c = await getConfig(guildId);
    const previews = ['twitch', 'tiktok'].map((p) => liveMessage(p, sample(p, c[p] ?? 'streamer'), text, c.ping).embeds[0]);
    return submit.reply({
      embeds: [replyEmbed(text ? 'Saved. The next go-live alerts look like this:' : 'Description removed. The next go-live alerts look like this:'), ...previews],
      flags: MessageFlags.Ephemeral,
    });
  },
};

module.exports.showText = showText;
