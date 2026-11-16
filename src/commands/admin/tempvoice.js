// /tempvoice (staff): Creator Channels for temporary voice channels. Logic: utils/server/tempVoice.js.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply } = require('../../utils/embeds');
const tv = require('../../utils/server/tempVoice');

const cat = (o) => o.addChannelOption((c) => c.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory));
const creator = (o) => o.addChannelOption((c) => c.setName('channel').setDescription('The Creator Channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempvoice')
    .setDescription('Staff: set up temporary voice channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) => cat(s.setName('setup').setDescription('Make a category with a Creator Channel and the control panel')))
    .addSubcommand((s) => cat(creator(s.setName('add').setDescription('Make an existing voice channel a Creator Channel'))))
    .addSubcommand((s) => creator(s.setName('remove').setDescription('Stop a channel making temporary channels (the ones already made stay until empty)')))
    .addSubcommand((s) => cat(creator(s.setName('edit').setDescription("Change what a Creator Channel's channels start with")))
      .addStringOption((o) => o.setName('name').setDescription("Name, with {user} and {number} (default: {user}'s Channel)").setMaxLength(100))
      .addIntegerOption((o) => o.setName('user-limit').setDescription('Starting user limit (0 = none)').setMinValue(0).setMaxValue(99))
      .addIntegerOption((o) => o.setName('bitrate').setDescription('Starting bitrate in kbps').setMinValue(8).setMaxValue(384)))
    .addSubcommand((s) => s.setName('panel').setDescription('Post the control panel here'))
    .addSubcommand((s) => s.setName('show').setDescription('List the Creator Channels')),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageChannels))) return;
    const { guild, options } = interaction;
    const sub = options.getSubcommand();
    if (sub === 'panel') {
      await interaction.channel.send(tv.panelView());
      return privateReply(interaction, 'Posted the panel.');
    }
    if (sub === 'show') {
      const list = Object.entries(await tv.configs().all()).filter(([, c]) => c.guildId === guild.id);
      return privateReply(interaction, list.length ? list.map(([id, c]) => `<#${id}>: ${c.template}, limit **${c.limit || 'none'}**${c.bitrate ? `, **${c.bitrate / 1000}** kbps` : ''}`).join('\n') : 'No Creator Channels yet. Run `/tempvoice setup`.');
    }
    await interaction.deferReply({ flags: 64 });
    const reply = (text) => interaction.editReply({ embeds: [require('../../utils/embeds').replyEmbed(text)] });
    if (sub === 'setup') {
      const { creator: c, controls } = await tv.setup(guild, options.getChannel('category'));
      return reply(`Done. Join ${c} to get a channel. The controls are in ${controls}.`);
    }
    const channel = options.getChannel('channel');
    if (sub === 'add') {
      await tv.addCreator(guild, channel, options.getChannel('category'));
      return reply(`${channel} is a Creator Channel now. Use \`/tempvoice panel\` to post the controls.`);
    }
    if (!(await tv.configs().get(channel.id))) return reply(`${channel} isn't a Creator Channel.`);
    if (sub === 'remove') {
      await tv.configs().delete(channel.id);
      return reply(`${channel} no longer makes channels.`);
    }
    const category = options.getChannel('category');
    const bitrate = options.getInteger('bitrate');
    await tv.configs().update(channel.id, (c) => ({
      ...c,
      template: options.getString('name') ?? c.template,
      limit: options.getInteger('user-limit') ?? c.limit,
      bitrate: bitrate ? bitrate * 1000 : c.bitrate,
      categoryId: category?.id ?? c.categoryId,
    }));
    return reply(`Updated ${channel}.`);
  },
};
