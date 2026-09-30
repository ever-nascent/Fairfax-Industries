const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply } = require('../../utils/embeds');
const { setCategory, removeHideout } = require('../../utils/hideout');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hideout-config')
    .setDescription('Staff: manage Hideouts')
    // Hidden from members without Manage Channels (checked again below).
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) =>
      s
        .setName('category')
        .setDescription('Category Hideouts are made in (existing ones move there too)')
        .addChannelOption((o) => o.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription("Delete a member's Hideout for good (no refund). Deleting its channels by hand just remakes them")
        .addUserOption((o) => o.setName('member').setDescription('Whose Hideout').setRequired(true)),
    ),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
    if (interaction.options.getSubcommand() === 'remove') {
      const member = interaction.options.getUser('member');
      const removed = await removeHideout(interaction.guild, member.id);
      return privateReply(interaction, removed ? `Removed ${member}'s Hideout. No Souls were refunded.` : `${member} doesn't have a Hideout.`);
    }
    const category = interaction.options.getChannel('category');
    await setCategory(interaction.guild, category);
    return privateReply(interaction, `Hideouts now go under the **${category.name}** category.`);
  },
};
