// Ticket buttons: Open A Ticket (on a panel), Close and Claim (in a ticket).
// Button routes: each route has `matches` (is this click mine? by the customId prefix) and `execute`. components/index.js lists every route file.
// The rules and messages: utils/server/tickets.js. The commands: commands/general/ticket.js, commands/admin/ticket-config.js.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const K = require('../utils/server/tickets');
const { privateReply, replyEmbed } = require('../utils/embeds');

const starts = (id) => (interaction) => interaction.isButton() && interaction.customId.startsWith(`${id}:`);

module.exports = [
  {
    name: 'tickets',
    label: 'Open a ticket',
    matches: starts(K.OPEN_ID),
    async execute(interaction) {
      return K.startOpen(interaction, await K.getPanel(interaction.customId.split(':')[1]));
    },
  },
  {
    name: 'tickets',
    label: 'Ticket form',
    matches: (i) => i.isModalSubmit() && i.customId.startsWith(`${K.FORM_ID}:`),
    // The form's answers: opens the ticket and posts them in it.
    async execute(interaction) {
      const panel = await K.getPanel(interaction.customId.split(':')[1]);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await K.openTicket(interaction.guild, interaction.member, panel, panel?.form ? K.answersOf(panel, interaction.fields) : []);
      return interaction.editReply({ embeds: [replyEmbed(result.ok ? `Your ticket is open: ${result.channel}` : K.WHY_NOT[result.reason])] });
    },
  },
  {
    name: 'tickets',
    label: 'Form questions (staff)',
    matches: (i) => i.isModalSubmit() && i.customId.startsWith(`${K.FORMSET_ID}:`),
    // Staff typed a panel's questions.
    async execute(interaction) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return privateReply(interaction, K.WHY_NOT.staff);
      const panel = await K.getPanel(interaction.customId.split(':')[1]);
      if (!panel || panel.guildId !== interaction.guildId) return privateReply(interaction, K.WHY_NOT.gone);
      const questions = await K.setForm(panel.id, interaction.fields.getTextInputValue('questions'));
      if (!questions) return privateReply(interaction, K.WHY_NOT.noQuestions);
      return privateReply(interaction, `**${panel.name}** now asks **${questions.length}** questions before a ticket opens.`);
    },
  },
  {
    name: 'tickets',
    label: 'Tag text (staff)',
    matches: (i) => i.isModalSubmit() && i.customId.startsWith(`${K.TAGSET_ID}:`),
    // A ticket admin typed a tag's text.
    async execute(interaction) {
      const settings = await K.getSettings(interaction.guildId);
      if (!K.isAdmin(settings, interaction.member, interaction.memberPermissions)) return privateReply(interaction, 'Only ticket admins can manage tags.');
      const result = await K.saveTag(interaction.guildId, interaction.customId.split(':')[1], interaction.fields.getTextInputValue('content'));
      return privateReply(interaction, result.ok ? `Saved the tag \`${result.tag.id}\`. Staff send it with \`/tag\`.` : K.WHY_NOT[result.reason]);
    },
  },
  {
    name: 'tickets',
    label: 'Ticket rating',
    matches: starts(K.FEEDBACK_ID),
    // A star button in the opener's DM: saves the rating, then offers the optional comment pop-up. Runs in a DM, so there is no server on the interaction.
    async execute(interaction) {
      const [, guildId, number, stars] = interaction.customId.split(':');
      const saved = await K.saveFeedback(guildId, Number(number), interaction.user.id, { rating: Number(stars) });
      if (!saved) return privateReply(interaction, K.WHY_NOT.noFeedback);
      await K.tellFeedback(interaction.client, saved, `rated ticket **${saved.number}**: **${saved.rating}** out of **5**.`);
      return interaction.showModal(K.commentModal(guildId, saved.number));
    },
  },
  {
    name: 'tickets',
    label: 'Ticket comment',
    matches: (i) => i.isModalSubmit() && i.customId.startsWith(`${K.FEEDBACKC_ID}:`),
    async execute(interaction) {
      const [, guildId, number] = interaction.customId.split(':');
      const comment = interaction.fields.getTextInputValue('comment').trim();
      const saved = await K.saveFeedback(guildId, Number(number), interaction.user.id, { comment: comment || null });
      if (!saved) return privateReply(interaction, K.WHY_NOT.noFeedback);
      if (comment) await K.tellFeedback(interaction.client, saved, `added a comment on ticket **${saved.number}**:\n>>> ${comment.slice(0, 1000)}`);
      const text = `Thank you. You rated the ticket **${saved.rating ?? '-'}** out of **5**.`;
      return interaction.isFromMessage() ? interaction.update({ embeds: [replyEmbed(text)], components: [] }) : privateReply(interaction, text);
    },
  },
  {
    name: 'tickets',
    label: 'Close request answer',
    matches: starts(K.CREQ_ID),
    // Accept closes the ticket, Deny keeps it open. Only the person who opened it.
    async execute(interaction) {
      const [, channelId, answer] = interaction.customId.split(':');
      const ticket = await K.getTicket(channelId);
      if (!ticket?.closeRequest) return privateReply(interaction, K.WHY_NOT.noRequest);
      if (interaction.user.id !== ticket.openerId) return privateReply(interaction, K.WHY_NOT.notOpener);
      if (answer === 'd') {
        await K.clearRequest(channelId);
        return interaction.update({ content: '', embeds: [replyEmbed(`${interaction.user} denied the close request. The ticket stays open.`)], components: [] });
      }
      await interaction.update({ content: '', embeds: [replyEmbed('Closing this ticket. Saving the transcript.')], components: [] });
      return K.closeTicket(interaction.guild, interaction.channel, ticket, interaction.user, ticket.closeRequest.reason ?? 'Close request accepted.');
    },
  },
  {
    name: 'tickets',
    label: 'Close a ticket',
    matches: starts(K.CLOSE_ID),
    async execute(interaction) {
      const ticket = await K.getTicket(interaction.channelId);
      if (!ticket) return privateReply(interaction, K.WHY_NOT.notTicket);
      const settings = await K.getSettings(interaction.guildId);
      const panel = await K.getPanel(ticket.panelId);
      if (ticket.openerId !== interaction.user.id && !K.isStaff(settings, interaction.member, interaction.memberPermissions, panel)) return privateReply(interaction, K.WHY_NOT.staff);
      await interaction.reply({ embeds: [replyEmbed('Closing this ticket. Saving the transcript.')] });
      return K.closeTicket(interaction.guild, interaction.channel, ticket, interaction.user, null);
    },
  },
  {
    name: 'tickets',
    label: 'Claim a ticket',
    matches: starts(K.CLAIM_ID),
    async execute(interaction) {
      const ticket = await K.getTicket(interaction.channelId);
      if (!ticket) return privateReply(interaction, K.WHY_NOT.notTicket);
      const settings = await K.getSettings(interaction.guildId);
      const panel = await K.getPanel(ticket.panelId);
      if (!K.isStaff(settings, interaction.member, interaction.memberPermissions, panel)) return privateReply(interaction, K.WHY_NOT.staff);
      if (ticket.claimedBy) return privateReply(interaction, K.WHY_NOT.claimed);
      await K.changeTicket(ticket.id, (t) => ({ ...t, claimedBy: interaction.user.id }));
      await K.applyAccess(interaction.guild, interaction.channel, await K.getTicket(ticket.id));
      await interaction.message.edit({ components: [K.ticketButtons(ticket.id, true)] }).catch(() => null);
      return interaction.reply({ embeds: [replyEmbed(`${interaction.user} is handling this ticket.`)] });
    },
  },
];
