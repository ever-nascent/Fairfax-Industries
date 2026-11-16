// /ticket-config (Manage Server): set tickets up (`setup`), make and post panels (`panel-*`), choose staff (`addadmin`, `addsupport`, ...), the blacklist and the transcript channel.
// A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it. Rules and messages: utils/server/tickets.js.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply, replyEmbed } = require('../../utils/embeds');
const K = require('../../utils/server/tickets');

const mention = (id) => `<@&${id}>`;
const list = (ids, role) => (ids.length ? ids.map((id) => (role ? mention(id) : `<@${id}>`)).join(', ') : 'None');
const text = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const mentionable = (o) => o.setName('user_or_role').setDescription('A member or a role').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-config')
    .setDescription('Staff: set up tickets, panels, staff and the blacklist')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('setup').setDescription('Make the Ticket Admin and Ticket Support roles, a transcripts channel and a ticket category'))
    .addSubcommand((s) => s.setName('panel-create').setDescription('Make a panel and post it')
      .addStringOption((o) => o.setName('name').setDescription('The panel title').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (empty = here)').addChannelTypes(...text))
      .addChannelOption((o) => o.setName('category').setDescription('Where its tickets are made').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption((o) => o.setName('support_role').setDescription('Staff for this panel only (empty = the server\'s support roles)'))
      .addStringOption((o) => o.setName('message').setDescription('The text on the panel and in each ticket'))
      .addStringOption((o) => o.setName('button').setDescription('The button\'s label'))
      .addBooleanOption((o) => o.setName('thread').setDescription('Make each ticket a private thread in the panel\'s channel instead of a channel')))
    .addSubcommand((s) => s.setName('panel-mode').setDescription('Switch a panel between channel tickets and thread tickets')
      .addStringOption((o) => o.setName('panel').setDescription('The panel').setAutocomplete(true).setRequired(true))
      .addBooleanOption((o) => o.setName('thread').setDescription('True = private threads, false = channels').setRequired(true)))
    .addSubcommand((s) => s.setName('panel-delete').setDescription('Delete a panel and its message').addStringOption((o) => o.setName('panel').setDescription('The panel').setAutocomplete(true).setRequired(true)))
    .addSubcommand((s) => s.setName('panel-list').setDescription('Every panel'))
    .addSubcommand((s) => s.setName('form-set').setDescription('Ask questions before a ticket opens (a pop-up takes the questions)').addStringOption((o) => o.setName('panel').setDescription('The panel').setAutocomplete(true).setRequired(true)))
    .addSubcommand((s) => s.setName('form-clear').setDescription('Remove a panel\'s form').addStringOption((o) => o.setName('panel').setDescription('The panel').setAutocomplete(true).setRequired(true)))
    .addSubcommand((s) => s.setName('feedback').setDescription('Ask members to rate a ticket (and comment) in a DM after it closes').addBooleanOption((o) => o.setName('on').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('autoclose').setDescription('Close tickets by themselves (no options = show the rules)')
      .addIntegerOption((o) => o.setName('inactive_hours').setDescription('Close after this many hours with no message (0 = off)').setMinValue(0).setMaxValue(720))
      .addIntegerOption((o) => o.setName('no_response_hours').setDescription('Close after this many hours with no staff answer (0 = off)').setMinValue(0).setMaxValue(720))
      .addBooleanOption((o) => o.setName('on_leave').setDescription('Close a ticket when its opener leaves the server')))
    .addSubcommand((s) => s.setName('addadmin').setDescription('Give a member or role ticket admin access').addMentionableOption(mentionable))
    .addSubcommand((s) => s.setName('removeadmin').setDescription('Take ticket admin access away').addMentionableOption(mentionable))
    .addSubcommand((s) => s.setName('addsupport').setDescription('Make a role ticket support').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) => s.setName('removesupport').setDescription('Take ticket support away from a role').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) => s.setName('viewstaff').setDescription('Who has ticket admin and support access'))
    .addSubcommand((s) => s.setName('blacklist').setDescription('Stop (or let again) a member or role opening tickets').addMentionableOption(mentionable))
    .addSubcommand((s) => s.setName('transcripts').setDescription('Where closed tickets\' transcripts are posted').addChannelOption((o) => o.setName('channel').setDescription('Channel').addChannelTypes(...text).setRequired(true))),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const panels = (await K.guildPanels(interaction.guildId)).filter((p) => p.name.toLowerCase().includes(typed));
    return interaction.respond(panels.slice(0, 25).map((p) => ({ name: p.name.slice(0, 100), value: p.id })));
  },

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    const say = (t) => privateReply(interaction, t);

    if (sub === 'setup') {
      const have = await K.getSettings(guild.id);
      if (have.adminRoles.length || have.supportRoles.length) return say('Tickets are already set up. Use `viewstaff`, `addsupport` and `transcripts` to change them.');
      await interaction.deferReply({ flags: 64 });
      const admin =await guild.roles.create({ name: 'Ticket Admin', mentionable: false, reason: '/ticket-config setup' });
      const support = await guild.roles.create({ name: 'Ticket Support', mentionable: false, reason: '/ticket-config setup' });
      const staff = [admin.id, support.id, guild.client.user.id];
      const hidden = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, ...staff.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))];
      const transcripts = await guild.channels.create({ name: 'ticket-transcripts', type: ChannelType.GuildText, permissionOverwrites: hidden, reason: '/ticket-config setup' });
      const category = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, reason: '/ticket-config setup' });
      await K.saveSettings(guild.id, (s) => ({ ...s, adminRoles: [...s.adminRoles, admin.id], supportRoles: [...s.supportRoles, support.id], transcriptChannelId: transcripts.id, categoryId: category.id }));
      return interaction.editReply({ embeds: [replyEmbed(`Tickets are set up.\n\n**Roles**\n${admin}, ${support}\n\n**Transcripts**\n${transcripts}\n\n**Category**\n${category}\n\nMake a panel with \`/ticket-config panel-create\`.`)] });
    }

    if (sub === 'panel-create') {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      const role = interaction.options.getRole('support_role');
      await interaction.deferReply({ flags: 64 });
      const panel = await K.createPanel(guild.id, {
        name: interaction.options.getString('name').slice(0, 100), channelId: channel.id, categoryId: interaction.options.getChannel('category')?.id,
        supportRoles: role ? [role.id] : [], welcome: interaction.options.getString('message')?.slice(0, 1500), label: interaction.options.getString('button')?.slice(0, 80), thread: interaction.options.getBoolean('thread'),
      });
      try {
        await K.postPanel(guild, panel);
      } catch (error) {
        console.error('[tickets] Panel post failed:', error);
        await K.deletePanel(guild, panel.id);
        return interaction.editReply({ embeds: [replyEmbed(`I could not post in ${channel}. I need View Channel, Send Messages and Embed Links there.`)] });
      }
      return interaction.editReply({ embeds: [replyEmbed(`Posted the **${panel.name}** panel in ${channel}.`)] });
    }
    if (sub === 'panel-delete') {
      const done = await K.deletePanel(guild, interaction.options.getString('panel'));
      return say(done ? 'Deleted the panel. Tickets already open stay open.' : K.WHY_NOT.gone);
    }
    if (sub === 'form-set' || sub === 'form-clear') {
      const panel = await K.getPanel(interaction.options.getString('panel'));
      if (!panel || panel.guildId !== guild.id) return say(K.WHY_NOT.gone);
      if (sub === 'form-clear') {
        await K.clearForm(panel.id);
        return say(`**${panel.name}** has no form now.`);
      }
      return interaction.showModal(new ModalBuilder().setCustomId(`${K.FORMSET_ID}:${panel.id}`).setTitle('Form Questions').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('questions').setLabel('One question per line (up to 5)').setStyle(TextInputStyle.Paragraph)
          .setValue((panel.form ?? []).join('\n')).setMaxLength(500).setRequired(true))));
    }
    if (sub === 'panel-mode') {
      const panel = await K.getPanel(interaction.options.getString('panel'));
      if (!panel || panel.guildId !== guild.id) return say(K.WHY_NOT.gone);
      const thread = interaction.options.getBoolean('thread');
      await K.setPanelMode(panel.id, thread);
      return say(thread ? `**${panel.name}** makes private threads in <#${panel.channelId}> now. I need Create Private Threads, Send Messages in Threads and Manage Threads there.` : `**${panel.name}** makes channels now.`);
    }
    if (sub === 'panel-list') {
      const panels = await K.guildPanels(guild.id);
      return say(`**Panels**\n${panels.length ? panels.map((p) => `**${p.name}** in <#${p.channelId}>${p.thread ? ' (threads)' : ''}${p.form?.length ? ` (**${p.form.length}** form questions)` : ''}`).join('\n') : 'None. Make one with `/ticket-config panel-create`.'}`);
    }

    const settings = await K.getSettings(guild.id);
    if (sub === 'feedback') {
      const on = interaction.options.getBoolean('on');
      await K.saveSettings(guild.id, (s) => ({ ...s, feedback: on }));
      return say(on ? 'Members are asked to rate their ticket after it closes.' : 'Members are no longer asked to rate their tickets.');
    }
    if (sub === 'autoclose') {
      const o = interaction.options;
      const next = await K.saveSettings(guild.id, (s) => ({ ...s, autoclose: {
        inactiveHours: o.getInteger('inactive_hours') ?? s.autoclose.inactiveHours,
        noResponseHours: o.getInteger('no_response_hours') ?? s.autoclose.noResponseHours,
        onLeave: o.getBoolean('on_leave') ?? s.autoclose.onLeave,
      } }));
      const a = next.autoclose;
      const hours = (n) => (n ? `**${n}** hours` : 'Off');
      return say(`**Auto-Close**\nNo message for: ${hours(a.inactiveHours)}\nNo staff answer for: ${hours(a.noResponseHours)}\nOpener leaves the server: ${a.onLeave ? 'On' : 'Off'}`);
    }
    if (sub === 'viewstaff') return say(`**Ticket Admins**\n${list(settings.adminRoles, true)}\n\n**Ticket Support**\n${list(settings.supportRoles, true)}\n\n**Blacklisted**\n${list(settings.blacklist)}`);
    if (sub === 'transcripts') {
      const channel = interaction.options.getChannel('channel');
      await K.saveSettings(guild.id, (s) => ({ ...s, transcriptChannelId: channel.id }));
      return say(`Transcripts go to ${channel}.`);
    }
    if (sub === 'addsupport' || sub === 'removesupport') {
      const role = interaction.options.getRole('role');
      await K.toggleIn(guild.id, 'supportRoles', role.id, sub === 'addsupport');
      return say(sub === 'addsupport' ? `${role} is now ticket support.` : `${role} is no longer ticket support.`);
    }
    // addadmin / removeadmin / blacklist take a member or a role. Admin roles only: a single member gets no role list entry, so admins are roles.
    const who = interaction.options.getMentionable('user_or_role');
    const isRole = 'permissions' in who && !who.user;
    if (sub === 'blacklist') {
      const on = !settings.blacklist.includes(who.id);
      await K.toggleIn(guild.id, 'blacklist', who.id, on);
      return say(on ? `${who} can no longer open tickets.` : `${who} can open tickets again.`);
    }
    if (!isRole) return say('Ticket admin is given to a role. Pick a role, then give it to the member.');
    await K.toggleIn(guild.id, 'adminRoles', who.id, sub === 'addadmin');
    return say(sub === 'addadmin' ? `${who} is now ticket admin.` : `${who} is no longer ticket admin.`);
  },
};
