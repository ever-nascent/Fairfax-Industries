// /jackpot-config channel (Manage Server): where the Weekly Jackpot's winner is announced. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// The jackpot itself: utils/economy/jackpot.js.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply } = require('../../utils/embeds');
const { setChannel } = require('../../utils/economy/jackpot');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jackpot-config')
    .setDescription('Staff: the Weekly Jackpot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Where the weekly winner is announced (leave empty to turn the post off)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    ),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const channel = interaction.options.getChannel('channel');
    await setChannel(interaction.guildId, channel?.id ?? null);
    return privateReply(interaction, channel ? `The Weekly Jackpot's winner is announced in ${channel}.` : "The Weekly Jackpot's winner is no longer announced. `/jackpot` still shows last week's.");
  },
};
