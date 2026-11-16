// /welcome-config (Manage Server): this server's welcome message: on or off, the channel, the text. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// The message itself: events/welcome.js, settings in utils/server/welcome.js.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { replyEmbed, privateReply } = require('../../utils/embeds');
const { isHomeGuild } = require('../../utils/guild');
const { getWelcome, updateWelcome, render, MAX_TEXT } = require('../../utils/server/welcome');

async function showText(guild) {
  const c = await getWelcome(guild.id);
  const role = `**Join Role:** ${c.roleId ? `<@&${c.roleId}>` : 'Not set'}`;
  if (isHomeGuild(guild.id)) return `**Welcome Messages:** ${c.on ? 'On' : 'Off'}\n${role}\nThis server keeps its own walk-through (#welcome, #rules, #roles).`;
  return [`**Welcome Message:** ${c.on ? 'On' : 'Off'}`, `**Channel:** ${c.channelId ? `<#${c.channelId}>` : 'Not set (nothing is posted)'}`, `**Text:** ${c.text}`, role].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome-config')
    .setDescription('Staff: set up the welcome message for new members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('toggle').setDescription('Turn the welcome message on or off')
      .addBooleanOption((o) => o.setName('on').setDescription('True = on, false = off').setRequired(true)))
    .addSubcommand((s) => s.setName('channel').setDescription('Where the welcome message is posted')
      .addChannelOption((o) => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('role').setDescription('A role every new member gets when they join (leave the role empty to turn it off)')
      .addRoleOption((o) => o.setName('role').setDescription('The role to give')))
    .addSubcommand((s) => s.setName('message').setDescription('Edit the welcome text. {member}, {server} and {count} are filled in'))
    .addSubcommand((s) => s.setName('show').setDescription('Show the welcome settings and a preview')),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();

    if (sub === 'toggle') {
      const on = interaction.options.getBoolean('on');
      await updateWelcome(guild.id, { on });
      const needs = on && !isHomeGuild(guild.id) && !(await getWelcome(guild.id)).channelId ? ' Pick a channel with `/welcome-config channel` so it has somewhere to go.' : '';
      return privateReply(interaction, `The welcome message is **${on ? 'on' : 'off'}**.${needs}`);
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      await updateWelcome(guild.id, { channelId: channel.id });
      return privateReply(interaction, `New members are welcomed in ${channel}.`);
    }

    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      if (!role) {
        await updateWelcome(guild.id, { roleId: null });
        return privateReply(interaction, 'New members no longer get a role when they join.');
      }
      const me = guild.members.me;
      if (role.id === guild.id || role.managed || role.comparePositionTo(me.roles.highest) >= 0) {
        return privateReply(interaction, `I can't give ${role}. It has to be a normal role below my highest role.`);
      }
      await updateWelcome(guild.id, { roleId: role.id });
      return privateReply(interaction, `New members get ${role} when they join.`);
    }

    if (sub === 'show') {
      const c = await getWelcome(guild.id);
      const preview = isHomeGuild(guild.id) ? [] : [replyEmbed(render(c.text, interaction.member))];
      return interaction.reply({ embeds: [replyEmbed(await showText(guild)), ...preview], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    // message
    if (isHomeGuild(guild.id)) return privateReply(interaction, "This server's welcome messages are written in the bot's own code (events/welcome.js).");
    const modalId = `welcome-config:${interaction.id}`;
    const input = new TextInputBuilder().setCustomId('text').setLabel('Welcome Text').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(MAX_TEXT)
      .setValue((await getWelcome(guild.id)).text.slice(0, MAX_TEXT)).setPlaceholder('Welcome to {server}, {member}!');
    await interaction.showModal(new ModalBuilder().setCustomId(modalId).setTitle('Welcome Message').addComponents(new ActionRowBuilder().addComponents(input)));
    const submit = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 15 * 60_000 }).catch(() => null);
    if (!submit) return;
    const text = submit.fields.getTextInputValue('text').trim();
    await updateWelcome(guild.id, { text });
    return submit.reply({ embeds: [replyEmbed('Saved. New members will see:'), replyEmbed(render(text, interaction.member))], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};

module.exports.showText = showText;
