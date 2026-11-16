// /export-chat [channel] (Manage Messages): saves a whole channel as one HTML file, sent privately to the moderator who asked. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// The export itself: utils/server/chatExport.js.
const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply, replyEmbed } = require('../../utils/embeds');
const { fmt } = require('../../utils/format');
const { exportChannel } = require('../../utils/server/chatExport');

const NEEDS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export-chat')
    .setDescription('Staff: save a whole channel as an HTML file')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption((o) => o.setName('channel').setDescription('The channel to export (empty = this one)')),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageMessages))) return;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!channel?.messages) return privateReply(interaction, `${channel} has no messages to export.`);
    // A moderator can only export a channel they can read themselves.
    if (!channel.permissionsFor(interaction.member)?.has(NEEDS)) return privateReply(interaction, `You can't read ${channel}.`);
    if (!channel.permissionsFor(interaction.guild.members.me)?.has(NEEDS)) return privateReply(interaction, `I can't read ${channel}.`);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { html, count, cut } = await exportChannel(channel, interaction.user.username);
    const file = new AttachmentBuilder(Buffer.from(html), { name: `${channel.name}-${new Date().toISOString().slice(0, 10)}.html` });
    const text = `Exported **${fmt(count)}** messages from ${channel}.${cut ? ' The channel was too long for one file. This holds the newest messages.' : ''}`;
    return interaction.editReply({ embeds: [replyEmbed(text)], files: [file] });
  },
};
