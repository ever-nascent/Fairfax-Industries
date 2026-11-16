// /ticket open|close|add|remove|rename|claim|unclaim|transfer|switchpanel: tickets.bot's ticket commands, grouped under one command. A slash command.
// `data` is what Discord shows (name, description, options); `execute` runs when someone uses it. Rules and messages: utils/server/tickets.js; buttons: components/tickets.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const { privateReply, replyEmbed } = require('../../utils/embeds');
const K = require('../../utils/server/tickets');

const target = (s) => s.addMentionableOption((o) => o.setName('user_or_role').setDescription('A member or a role').setRequired(true));
const panelOption = (o) => o.setName('panel').setDescription('The panel').setAutocomplete(true).setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open and manage support tickets')
    .addSubcommand((s) => s.setName('open').setDescription('Open a new ticket').addStringOption(panelOption))
    .addSubcommand((s) => s.setName('close').setDescription('Close this ticket and save its transcript').addStringOption((o) => o.setName('reason').setDescription('Why it is closed')))
    .addSubcommand((s) => s.setName('closerequest').setDescription('Ask the person who opened this ticket to confirm it can close')
      .addIntegerOption((o) => o.setName('close_delay').setDescription(`Hours until it closes by itself if they don't answer (max ${K.MAX_DELAY_HOURS})`).setMinValue(1).setMaxValue(K.MAX_DELAY_HOURS))
      .addStringOption((o) => o.setName('reason').setDescription('Why it can close')))
    .addSubcommand((s) => target(s.setName('add').setDescription('Add a member or role to this ticket')))
    .addSubcommand((s) => target(s.setName('remove').setDescription('Remove a member or role from this ticket')))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename this ticket').addStringOption((o) => o.setName('name').setDescription('The new name').setRequired(true)))
    .addSubcommand((s) => s.setName('reopen').setDescription('Open a closed thread ticket again').addIntegerOption((o) => o.setName('ticket_id').setDescription('The ticket number (ticket-0007 is 7)').setMinValue(1).setRequired(true)))
    .addSubcommand((s) => s.setName('on-call').setDescription('Be added and pinged on new thread tickets (run again to stop)'))
    .addSubcommand((s) => s.setName('autoclose-exclude').setDescription('Stop (or start again) auto-close for this ticket'))
    .addSubcommand((s) => s.setName('claim').setDescription('Take this ticket'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('Give this ticket back'))
    .addSubcommand((s) => s.setName('transfer').setDescription('Hand a claimed ticket to another staff member').addUserOption((o) => o.setName('user').setDescription('Who takes it').setRequired(true)))
    .addSubcommand((s) => s.setName('switchpanel').setDescription('Move this ticket to another panel').addStringOption(panelOption)),

  // The panel list as they type.
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const panels = (await K.guildPanels(interaction.guildId)).filter((p) => p.name.toLowerCase().includes(typed));
    return interaction.respond(panels.slice(0, 25).map((p) => ({ name: p.name.slice(0, 100), value: p.id })));
  },

  async execute(interaction) {
    const { guild, member, channel } = interaction;
    const sub = interaction.options.getSubcommand();
    const settings = await K.getSettings(guild.id);

    if (sub === 'open') {
      return K.startOpen(interaction, await K.getPanel(interaction.options.getString('panel')));
    }

    if (sub === 'on-call' || sub === 'reopen') {
      if (!K.isStaff(settings, member, interaction.memberPermissions)) return privateReply(interaction, K.WHY_NOT.staff);
      if (sub === 'on-call') {
        const on = await K.toggleOnCall(guild.id, member.id);
        return privateReply(interaction, on ? 'You are on call. You are added and pinged in new thread tickets.' : 'You are off call.');
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await K.reopenTicket(guild, interaction.options.getInteger('ticket_id'));
      return interaction.editReply({ embeds: [replyEmbed(result.ok ? `Reopened ${result.thread}.` : K.WHY_NOT[result.reason])] });
    }

    // Everything else works inside a ticket.
    const ticket = await K.getTicket(channel.id);
    if (!ticket) return privateReply(interaction, K.WHY_NOT.notTicket);
    const panel = await K.getPanel(ticket.panelId);
    const staff = K.isStaff(settings, member, interaction.memberPermissions, panel);
    const owner = ticket.openerId === member.id;

    if (sub === 'close') {
      if (!staff && !owner) return privateReply(interaction, K.WHY_NOT.staff);
      await interaction.reply({ embeds: [replyEmbed('Closing this ticket. Saving the transcript.')] });
      return K.closeTicket(guild, channel, ticket, interaction.user, interaction.options.getString('reason'));
    }
    if (!staff) return privateReply(interaction, K.WHY_NOT.staff);

    if (sub === 'closerequest') {
      const result = await K.requestClose(channel, ticket, interaction.user, { delayHours: interaction.options.getInteger('close_delay'), reason: interaction.options.getString('reason') });
      return result.ok ? interaction.reply({ embeds: [replyEmbed('Sent the close request.')], flags: MessageFlags.Ephemeral }) : privateReply(interaction, K.WHY_NOT[result.reason]);
    }

    if (sub === 'add' || sub === 'remove') {
      const who = interaction.options.getMentionable('user_or_role');
      const isRole = 'permissions' in who && !who.user; // a Role has no `user`
      if (!isRole && who.id === ticket.openerId && sub === 'remove') return privateReply(interaction, 'You can\'t remove the person who opened the ticket.');
      if (ticket.thread) {
        // A thread has a member list, no roles.
        if (isRole) return privateReply(interaction, 'A thread ticket takes members one at a time, not roles.');
        const done = await (sub === 'add' ? channel.members.add(who.id) : channel.members.remove(who.id)).then(() => true, () => false);
        return done ? interaction.reply({ embeds: [replyEmbed(sub === 'add' ? `Added ${who} to this ticket.` : `Removed ${who} from this ticket.`)] }) : privateReply(interaction, 'I could not change that member. They may not be on this server.');
      }
      if (isRole) {
        if (sub === 'add') await channel.permissionOverwrites.edit(who.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
        else await channel.permissionOverwrites.delete(who.id);
      } else {
        const id = who.id ?? who.user?.id;
        await K.changeTicket(channel.id, (t) => ({ ...t, users: [...t.users.filter((x) => x !== id), ...(sub === 'add' ? [id] : [])] }));
        await K.applyAccess(guild, channel, await K.getTicket(channel.id));
      }
      return interaction.reply({ embeds: [replyEmbed(sub === 'add' ? `Added ${who} to this ticket.` : `Removed ${who} from this ticket.`)] });
    }

    if (sub === 'autoclose-exclude') {
      const kept = !ticket.noAutoclose;
      await K.changeTicket(channel.id, (t) => ({ ...t, noAutoclose: kept }));
      return interaction.reply({ embeds: [replyEmbed(kept ? 'This ticket will not close by itself.' : 'This ticket can close by itself again.')] });
    }

    if (sub === 'rename') {
      const name = interaction.options.getString('name').trim();
      if (!name || name.length > 90) return privateReply(interaction, K.WHY_NOT.rename);
      await channel.setName(name);
      return interaction.reply({ embeds: [replyEmbed(`Renamed this ticket to **${channel.name}**.`)] });
    }

    if (ticket.thread && ['claim', 'unclaim', 'transfer', 'switchpanel'].includes(sub)) return privateReply(interaction, K.WHY_NOT.channelOnly);

    if (sub === 'claim') {
      if (ticket.claimedBy) return privateReply(interaction, K.WHY_NOT.claimed);
      return claim(interaction, ticket, member.id);
    }
    if (sub === 'unclaim' || sub === 'transfer') {
      if (!ticket.claimedBy) return privateReply(interaction, K.WHY_NOT.notClaimed);
      if (ticket.claimedBy !== member.id && !K.isAdmin(settings, member, interaction.memberPermissions)) return privateReply(interaction, K.WHY_NOT.notYours);
      if (sub === 'unclaim') {
        await K.changeTicket(channel.id, (t) => ({ ...t, claimedBy: null }));
        await K.applyAccess(guild, channel, await K.getTicket(channel.id));
        return interaction.reply({ embeds: [replyEmbed(`${interaction.user} gave this ticket back. Any staff member can claim it.`)] });
      }
      const to = interaction.options.getMember('user');
      if (!to || !K.isStaff(settings, to, to.permissions, panel)) return privateReply(interaction, 'That person is not ticket staff.');
      return claim(interaction, ticket, to.id);
    }

    if (sub === 'switchpanel') {
      const next = await K.getPanel(interaction.options.getString('panel'));
      if (!next || next.guildId !== guild.id) return privateReply(interaction, K.WHY_NOT.gone);
      await K.changeTicket(channel.id, (t) => ({ ...t, panelId: next.id }));
      const parent = next.categoryId ?? settings.categoryId;
      if (parent) await channel.setParent(parent, { lockPermissions: false });
      await K.applyAccess(guild, channel, await K.getTicket(channel.id));
      return interaction.reply({ embeds: [replyEmbed(`Moved this ticket to **${next.name}**.`)] });
    }
  },
};

// Sets the claimer, updates who can write and says so.
async function claim(interaction, ticket, userId) {
  await K.changeTicket(ticket.id, (t) => ({ ...t, claimedBy: userId }));
  await K.applyAccess(interaction.guild, interaction.channel, await K.getTicket(ticket.id));
  return interaction.reply({ embeds: [replyEmbed(`<@${userId}> is handling this ticket.`)] });
}
