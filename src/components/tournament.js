// Tournament buttons and pop-ups: Sign Up and its team name pop-up, an invite's Accept / Decline, Disband Team, Verify and its Steam link pop-up,
// the staff review (Approve / Deny / Needs Investigation), Check In, Confirm / Dispute on a result, a scrim's Accept / Decline, and cleanup's Delete Everything.
// Button routes: each route has `matches` (is this click mine? by the customId prefix) and `execute`. components/index.js lists every route file.
// The rules and every message: utils/server/tournaments.js (teams), tournamentPlay.js (reviews, matches, scrims, cleanup), verification.js (lookups).
// The commands: commands/general/tournament.js, team.js, scrim.js.
const { MessageFlags } = require('discord.js');
const T = require('../utils/server/tournaments');
const P = require('../utils/server/tournamentPlay');
const V = require('../utils/server/verification');
const { findPhrase, getPhrases } = require('../utils/server/censor');
const { privateReply, replyEmbed } = require('../utils/embeds');

const starts = (id) => (interaction) => (interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(`${id}:`);
const why = (result) => T.TEAM_WHY_NOT[result.reason];

module.exports = [
  {
    name: 'tournament',
    label: 'Tournament sign-up',
    matches: starts(T.SIGNUP_ID),
    // Sign Up: opens the team name pop-up.
    async execute(interaction) {
      const t = await T.getTournament(interaction.customId.split(':')[1]);
      if (!t || t.endedAt) return privateReply(interaction, T.TEAM_WHY_NOT.gone);
      if (T.isClosed(t)) return privateReply(interaction, T.TEAM_WHY_NOT.closed);
      if (T.teamOf(t, interaction.user.id)) return privateReply(interaction, T.TEAM_WHY_NOT.youOnTeam);
      return interaction.showModal(T.teamModal(t));
    },
  },
  {
    name: 'tournament',
    label: 'Tournament team name',
    matches: starts(T.TEAM_MODAL_ID),
    // The pop-up's answer: saves the team, makes its role (and channels), updates the embed.
    async execute(interaction) {
      const { guild, user } = interaction;
      const id = interaction.customId.split(':')[1];
      const name = interaction.fields.getTextInputValue('name');
      if (findPhrase(name, await getPhrases(guild.id))) return privateReply(interaction, 'That team name is not allowed here. Pick another.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const say = (text) => interaction.editReply({ embeds: [replyEmbed(text)] });

      const made = await T.addTeam(id, { name, captainId: user.id });
      if (!made.ok) return say(why(made));
      const t = await T.getTournament(id);
      let team;
      try {
        team = await T.makeTeamSpaces(guild, t, made.team);
      } catch (error) {
        console.error('[tournament] Team setup failed:', error);
        await T.disbandTeam(id, made.team.id);
        return say('I could not make the team role or its channels. An admin has to check that I can Manage Roles and Manage Channels. Your team was not signed up.');
      }
      await T.refreshSignup(guild, id);
      await T.tellTeam(guild, team, { content: T.welcomeText(t, team, made.waiting), components: [V.verifyButton(id)] });

      const where = team.textId ? ` Your team channel is <#${team.textId}>.` : '';
      const waiting = made.waiting ? `\n\nThe tournament is full. Your team is **#${made.waiting}** on the waiting list. It moves up when a team drops out.` : '';
      const text = `**${team.name}** is signed up for **${t.name}** and you are its Captain.${where}${waiting}\n\nInvite your players with \`/team invite\`. Everyone on the team has to be verified, you too. Press **Verify**.`;
      return interaction.editReply({ embeds: [replyEmbed(text)], components: [V.verifyButton(id)] });
    },
  },
  {
    name: 'tournament',
    label: 'Tournament invite',
    matches: starts(T.INVITE_ID),
    // Accept / Decline on an invite. Only the invited member.
    async execute(interaction) {
      const [, id, teamId, userId, answer] = interaction.customId.split(':');
      if (interaction.user.id !== userId) return privateReply(interaction, 'This invite is not for you.');
      const result = await T.answerInvite(id, teamId, userId, answer === 'a');
      if (!result.ok && result.reason !== 'noInvite') return privateReply(interaction, why(result));
      await interaction.message.delete().catch(() => null);
      if (!result.ok) return privateReply(interaction, why(result));
      const { team, sub } = result;
      const as = sub ? 'Substitute' : 'Player';
      if (!result.accepted) {
        await T.tellTeam(interaction.guild, team, `<@${userId}> declined the invite.`);
        return privateReply(interaction, `You declined **${team.name}**'s invite.`);
      }
      await T.tellTeam(interaction.guild, team, `<@${userId}> accepted the invite as a ${as}. They get the team role once an organizer approves their verification.`);
      const text = `You joined **${team.name}** as a ${as}. Press **Verify** and paste your Steam profile link. You get the team role once an organizer approves you.\n\nYou can also run \`/team verify\` later.`;
      return interaction.reply({ embeds: [replyEmbed(text)], components: [V.verifyButton(id)], flags: MessageFlags.Ephemeral });
    },
  },
  {
    name: 'tournament',
    label: 'Tournament disband',
    matches: starts(T.DISBAND_ID),
    // The Disband Team button under /team disband.
    async execute(interaction) {
      const [, id, teamId, userId] = interaction.customId.split(':');
      if (interaction.user.id !== userId) return privateReply(interaction, T.TEAM_WHY_NOT.notCaptain);
      await interaction.deferUpdate();
      const result = await T.disbandTeam(id, teamId, userId);
      if (!result.ok) return interaction.editReply({ embeds: [replyEmbed(why(result))], components: [] });
      const t = await T.getTournament(id);
      await interaction.editReply({ embeds: [replyEmbed(`**${result.team.name}** is disbanded and out of **${t.name}**.`)], components: [] }).catch(() => null); // first: the reply may sit in the channel about to go
      return T.afterDisband(interaction.guild, t, result.team, result.promoted);
    },
  },
  {
    name: 'tournament',
    label: 'Tournament verify',
    matches: starts(V.VERIFY_ID),
    // Verify: opens the Steam link pop-up.
    async execute(interaction) {
      const t = await T.getTournament(interaction.customId.split(':')[1]);
      if (!t || t.endedAt) return privateReply(interaction, T.TEAM_WHY_NOT.gone);
      const member = T.teamOf(t, interaction.user.id)?.members[interaction.user.id];
      if (!member) return privateReply(interaction, 'You are not on a team in this tournament.');
      if (member.status === 'approved') return privateReply(interaction, 'You are already verified.');
      return interaction.showModal(V.steamModal(t.id));
    },
  },
  {
    name: 'tournament',
    label: 'Tournament Steam link',
    matches: starts(V.STEAM_MODAL_ID),
    // The Steam link: looks the account up and posts the review for the organizers.
    async execute(interaction) {
      const id = interaction.customId.split(':')[1];
      const steam = V.parseSteam(interaction.fields.getTextInputValue('steam'));
      if (!steam) return privateReply(interaction, 'That is not a Steam profile link. It looks like `https://steamcommunity.com/id/yourname` or `https://steamcommunity.com/profiles/7656119...`.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const say = (text) => interaction.editReply({ embeds: [replyEmbed(text)] });
      const t = await T.getTournament(id);
      if (!t || t.endedAt) return say(T.TEAM_WHY_NOT.gone);
      let report;
      try {
        report = await V.lookup(steam);
      } catch (error) {
        console.error('[tournament] Steam lookup failed:', error.message);
        return say('I could not reach Steam. Try again in a minute.');
      }
      if (!report) return say('I could not find that Steam profile. Check the link and try again.');
      const result = await P.submitVerification(interaction.guild, t, interaction.user.id, report);
      if (!result.ok) return say(P.WHY_NOT[result.reason]);
      const fix = [
        !report.public && 'Your Steam profile is private. Set it to public and press **Verify** again, or an organizer may deny you.',
        report.hoursWhy === 'private' && 'Your game details are private, so your Deadlock hours are hidden. Set them to public and verify again.',
      ].filter(Boolean);
      return say(`Your Steam account **${report.name}** was sent to the organizers. You get the team role once one of them approves you.${fix.length ? `\n\n${fix.join('\n')}` : ''}`);
    },
  },
  {
    name: 'tournament',
    label: 'Tournament review',
    matches: starts(V.REVIEW_ID),
    // Approve / Deny / Needs Investigation on a review. Organizers only.
    async execute(interaction) {
      const [, id, teamId, userId, answer] = interaction.customId.split(':');
      if (!(await T.isOrganizer(interaction))) return privateReply(interaction, 'Only tournament organizers can review players.');
      if (answer === 'd') return interaction.showModal(V.denyModal(id, teamId, userId));
      const result = await P.decide(id, teamId, userId, answer === 'a' ? 'approved' : 'investigating', interaction.user.id);
      if (!result.ok) return privateReply(interaction, P.WHY_NOT[result.reason]);
      const { t, team, member } = result;
      await interaction.update(P.reviewAfter(interaction.guild, t, team, userId, member));
      await P.auditDecision(interaction.guild, t, team, userId, member.verification.decision);
      if (answer !== 'a') return null;
      await T.giveRole(interaction.guild, team, userId);
      const ready = P.teamReady(t, team) ? ` Every player is verified. **${team.name}** is ready.` : '';
      return P.tellCaptain(interaction.guild, team, `<@${userId}> is verified and has the team role.${ready}`);
    },
  },
  {
    name: 'tournament',
    label: 'Tournament deny reason',
    matches: starts(V.DENY_MODAL_ID),
    // The Deny pop-up's reason: the player comes off the team, and they and their Captain are told why.
    async execute(interaction) {
      const [, id, teamId, userId] = interaction.customId.split(':');
      if (!(await T.isOrganizer(interaction))) return privateReply(interaction, 'Only tournament organizers can review players.');
      const reason = interaction.fields.getTextInputValue('reason').trim();
      const result = await P.deny(id, teamId, userId, interaction.user.id, reason);
      if (!result.ok) return privateReply(interaction, P.WHY_NOT[result.reason]);
      const { guild } = interaction;
      await interaction.update(P.reviewAfter(guild, result.t, result.teamWas, userId, result.member));
      await P.auditDecision(guild, result.t, result.teamWas, userId, result.member.verification.decision);
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      await user?.send(`You were denied for **${result.t.name}** in ${guild.name} and are off **${result.teamWas.name}**.\nReason: ${reason}`).catch(() => null); // closed DMs: the Captain still hears it
      return P.afterDrop(guild, result, userId, `<@${userId}> was denied by an organizer and is off the team. Reason: ${reason}`);
    },
  },
  {
    name: 'tournament',
    label: 'Tournament check-in',
    matches: starts(P.CHECKIN_ID),
    // Check In before a match. Only that team's Captain.
    async execute(interaction) {
      const [, id, matchId, teamId] = interaction.customId.split(':');
      const result = await P.checkIn(id, matchId, teamId, interaction.user.id);
      if (!result.ok) return privateReply(interaction, result.reason === 'played' ? 'This match is not waiting for a Check-In any more.' : P.WHY_NOT[result.reason]);
      const team = result.t.teams[teamId];
      return interaction.update({ content: `**${team.name}** is checked in for **${P.matchTitle(result.t, matchId)}**.${result.both ? ' Both teams are in.' : ''}`, components: [], allowedMentions: { parse: [] } });
    },
  },
  {
    name: 'tournament',
    label: 'Tournament result answer',
    matches: starts(P.RESULT_ID),
    // Confirm / Dispute on a reported result. Only the other team's Captain.
    async execute(interaction) {
      const [, id, matchId, answer] = interaction.customId.split(':');
      const result = await P.answerReport(id, matchId, interaction.user.id, answer === 'c');
      if (!result.ok) return privateReply(interaction, P.WHY_NOT[result.reason]);
      const { t, winner, loser, score } = result;
      const line = `**${P.teamName(t, winner)}**'s **${score[0]}-${score[1]}** win over **${P.teamName(t, loser)}** in **${P.matchTitle(t, matchId)}**`;
      if (!result.confirmed) {
        await interaction.update({ content: `${line} is disputed. The organizers decide.`, components: [], allowedMentions: { parse: [] } });
        await P.tellMatch(interaction.guild, t, t.teams[winner], `**${P.teamName(t, loser)}** disputed your result in **${P.matchTitle(t, matchId)}**. The organizers decide.`);
        return P.tellOrganizers(interaction.guild, t, `${line} in **${t.name}** is disputed by <@${interaction.user.id}>. Settle it with \`/tournament result\`.`, { ping: true });
      }
      await interaction.update({ content: `${line} is confirmed.`, components: [], allowedMentions: { parse: [] } });
      return P.afterResult(interaction.guild, t, matchId, result);
    },
  },
  {
    name: 'tournament',
    label: 'Tournament scrim answer',
    matches: starts(P.SCRIM_ID),
    // Accept / Decline on a scrim. A Captain of the challenged team, or of any other team for an open one.
    async execute(interaction) {
      const [, id, scrimId, answer] = interaction.customId.split(':');
      const result = await P.scrimAnswer(id, scrimId, interaction.user.id, answer === 'a');
      if (!result.ok) return privateReply(interaction, P.WHY_NOT[result.reason]);
      const { t, scrim } = result;
      const [a, b] = [P.teamName(t, scrim.a), P.teamName(t, scrim.b)];
      if (!result.accepted) {
        await interaction.update({ content: `**${b}** declined **${a}**'s scrim.`, components: [], allowedMentions: { parse: [] } });
        return P.tellMatch(interaction.guild, t, t.teams[scrim.a], `**${b}** declined your scrim.`);
      }
      await interaction.update({ content: `**${a}** and **${b}** scrim ${P.stamp(scrim.time)}.`, components: [], allowedMentions: { parse: [] } });
      for (const [mine, theirs] of [[scrim.a, b], [scrim.b, a]]) await P.tellMatch(interaction.guild, t, t.teams[mine], `Your scrim against **${theirs}** is on. ${P.stamp(scrim.time)}\nYou are pinged **${t.pingMinutes}** minutes before.`);
      return null;
    },
  },
  {
    name: 'tournament',
    label: 'Tournament cleanup',
    matches: starts(P.CLEANUP_ID),
    // Delete Everything under /tournament cleanup. Only the organizer who ran it.
    async execute(interaction) {
      const [, id, userId, channelId] = interaction.customId.split(':');
      if (interaction.user.id !== userId) return privateReply(interaction, 'Only the organizer who ran the command can press this.');
      await interaction.update({ embeds: [replyEmbed('Cleaning up. This can take a minute.')], components: [] });
      const result = await P.cleanup(interaction.guild, id, interaction.guild.channels.cache.get(channelId) ?? null);
      if (!result.ok) return interaction.editReply({ embeds: [replyEmbed(P.WHY_NOT[result.reason])] });
      const saved = result.exported ? ` **${result.exported}** team chats were saved in <#${channelId}>.` : '';
      const failed = result.failed.length ? `\n\nI could not save the chat of ${result.failed.map((n) => `**${n}**`).join(', ')}, so their channels and roles are still there. Run it again.` : '';
      return interaction.editReply({ embeds: [replyEmbed(`The roles and channels of **${result.teams}** teams are deleted.${saved}${failed}`)] }).catch(() => null); // the reply may have sat in a channel that is gone now
    },
  },
];
