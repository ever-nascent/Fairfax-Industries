// /team: a tournament team's own commands (invite, remove, transfer, disband and report for its Captain; roster, verify and leave for everyone on it).
// A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it; `autocomplete` lists the member's tournaments.
// The rules and every message: utils/server/tournaments.js. Accept / Decline and Disband Team buttons: components/tournament.js.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { privateReply, replyEmbed } = require('../../utils/embeds');
const T = require('../../utils/server/tournaments');
const P = require('../../utils/server/tournamentPlay');
const V = require('../../utils/server/verification');
const B = require('../../utils/server/bracket');

const withTournament = (s) => s.addStringOption((o) => o.setName('tournament').setDescription('Which tournament (only needed when you are in more than one)').setAutocomplete(true));
const withMember = (s, about) => s.addUserOption((o) => o.setName('member').setDescription(about).setRequired(true));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Your tournament team')
    .addSubcommand((s) => withTournament(withMember(s.setName('invite').setDescription('Captain: invite a member to your team'), 'Who to invite')
      .addBooleanOption((o) => o.setName('substitute').setDescription('Invite them as a Substitute (default: a Player)'))))
    .addSubcommand((s) => withTournament(withMember(s.setName('remove').setDescription('Captain: take a player off your team, or take an invite back'), 'Who to remove')))
    .addSubcommand((s) => withTournament(withMember(s.setName('transfer').setDescription('Captain: hand your team to another player on it'), 'The new Captain')))
    .addSubcommand((s) => withTournament(s.setName('disband').setDescription('Captain: remove your team from the tournament')))
    .addSubcommand((s) => withTournament(s.setName('roster').setDescription('Your team: players, Substitutes and invites')))
    .addSubcommand((s) => withTournament(s.setName('verify').setDescription('Verify your Steam account so an organizer can approve you')))
    .addSubcommand((s) => withTournament(s.setName('report').setDescription('Captain: report a match your team won')
      .addStringOption((o) => o.setName('score').setDescription('Wins first, like 2-1').setRequired(true))
      .addStringOption((o) => o.setName('match').setDescription('Which match (only needed when more than one is waiting)').setAutocomplete(true))))
    .addSubcommand((s) => withTournament(s.setName('leave').setDescription('Leave your team'))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = focused.value.toLowerCase();
    if (focused.name === 'match') {
      const { t, team } = await P.findMine(interaction);
      if (!t?.bracket) return interaction.respond([]);
      const now = B.resolve(t.bracket);
      const mine = t.bracket.order.filter((id) => now[id].state === 'ready' && (now[id].a === team.id || now[id].b === team.id));
      return interaction.respond(mine.slice(0, 25).map((id) => ({ name: `${id}: against ${P.teamName(t, now[id].a === team.id ? now[id].b : now[id].a)}`.slice(0, 100), value: id })));
    }
    const mine = (await T.running(interaction.guildId)).filter((t) => T.teamOf(t, interaction.user.id) && t.name.toLowerCase().includes(typed));
    return interaction.respond(mine.slice(0, 25).map((t) => ({ name: t.name, value: t.id })));
  },

  async execute(interaction) {
    const { guild, user } = interaction;
    const sub = interaction.options.getSubcommand();
    const found = await P.findMine(interaction);
    if (found.error) return privateReply(interaction, found.error);
    const { t, team } = found;
    const member = interaction.options.getUser('member');
    const refuse = (result) => privateReply(interaction, T.TEAM_WHY_NOT[result.reason]);

    if (sub === 'verify') {
      if (team.members[user.id].status === 'approved') return privateReply(interaction, 'You are already verified.');
      return interaction.showModal(V.steamModal(t.id));
    }

    if (sub === 'report') {
      const result = await P.report(t.id, user.id, interaction.options.getString('score'), interaction.options.getString('match'));
      if (!result.ok) return privateReply(interaction, P.WHY_NOT[result.reason]);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const title = P.matchTitle(result.t, result.matchId);
      const score = `**${result.score[0]}-${result.score[1]}**`;
      await P.tellMatch(guild, result.t, result.other, { content: `<@${result.other.captainId}>, **${team.name}** reported a ${score} win over **${result.other.name}** in **${title}**. Press **Confirm** if that is right, or **Dispute**.`, components: [P.resultRow(result.t, result.matchId)] });
      await P.tellMatch(guild, result.t, team, `${user} reported a ${score} win in **${title}**. It counts once **${result.other.name}**'s Captain confirms it.`);
      return interaction.editReply({ embeds: [replyEmbed(`Reported. It counts once **${result.other.name}**'s Captain confirms it.`)] });
    }

    if (sub === 'roster') return interaction.reply({ embeds: [T.rosterView(t, team)], flags: MessageFlags.Ephemeral });

    if (sub === 'invite') {
      if (member.bot) return privateReply(interaction, "A bot can't play.");
      const asSub = interaction.options.getBoolean('substitute') ?? false;
      const result = await T.invite(t.id, team.id, user.id, member.id, asSub);
      if (!result.ok) return refuse(result);
      const message = await guild.channels.cache.get(t.signupChannelId)?.send(T.inviteView(t, team, member.id, asSub)).catch((e) => console.error('[tournament] Invite post failed:', e.message));
      if (!message) {
        await T.removeMember(t.id, team.id, user.id, member.id);
        return privateReply(interaction, `I could not post the invite in <#${t.signupChannelId}>. Tell an organizer.`);
      }
      await T.editTeam(t.id, team.id, (saved) => { if (saved.invites[member.id]) saved.invites[member.id].messageId = message.id; });
      return privateReply(interaction, `${member} is invited as a ${asSub ? 'Substitute' : 'Player'}. Their invite is in <#${t.signupChannelId}>.`);
    }

    if (sub === 'remove') {
      const result = await T.removeMember(t.id, team.id, user.id, member.id);
      if (!result.ok) return refuse(result);
      if (result.wasInvite) {
        await T.deleteMessage(guild, t.signupChannelId, result.messageId);
        return privateReply(interaction, `${member}'s invite is taken back.`);
      }
      await T.takeRole(guild, team, member.id);
      await T.tellTeam(guild, team, `${member} was taken off the team.`);
      return privateReply(interaction, `${member} is off **${team.name}**.`);
    }

    if (sub === 'transfer') {
      const result = await T.transferTeam(t.id, team.id, user.id, member.id);
      if (!result.ok) return refuse(result);
      await T.giveRole(guild, team, member.id);
      await T.tellTeam(guild, team, `${member} is the Captain of **${team.name}** now.`);
      return privateReply(interaction, `${member} is the Captain of **${team.name}** now. You are still on the team.`);
    }

    if (sub === 'disband') {
      if (team.captainId !== user.id) return privateReply(interaction, T.TEAM_WHY_NOT.notCaptain);
      const button = new ButtonBuilder().setCustomId(`${T.DISBAND_ID}:${t.id}:${team.id}:${user.id}`).setLabel('Disband Team').setStyle(ButtonStyle.Danger);
      const text = `This removes **${team.name}** from **${t.name}**. Its role${team.textId ? ' and channels are' : ' is'} deleted. It can't be undone.`;
      return interaction.reply({ embeds: [replyEmbed(text)], components: [new ActionRowBuilder().addComponents(button)], flags: MessageFlags.Ephemeral });
    }

    // leave
    const result = await T.leaveTeam(t.id, user.id);
    if (!result.ok) return refuse(result);
    await T.takeRole(guild, team, user.id);
    await T.tellTeam(guild, team, `${user} left the team.`);
    return privateReply(interaction, `You left **${team.name}**.`);
  },
};
