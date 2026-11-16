// Tournaments: the organizer roles, a tournament's settings and its sign-up embed. Rules and decisions: server-plan.md "Scrims and tournaments".
// Commands: commands/admin/tournament-config.js, commands/general/tournament.js; buttons: components/tournament.js.
// Built so far: step 1 (organizer roles, creating a tournament, the sign-up embed) and step 2 (teams: sign-up, role and channels, invites, the waiting list;
// commands/general/team.js, events/tournamentMemberLeft.js). Verification, brackets and matches come next.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getStore } = require('../../storage');
const { BRAND_COLOR } = require('../../config');
const { shortId } = require('../random');
const { RANKS } = require('./lfg');

const FORMATS = { single: 'Single Elimination', double: 'Double Elimination', robin: 'Round Robin' };
const SEEDINGS = { rank: 'By Team Rank', random: 'Random', staff: 'Staff Set It' };
const DEFAULT_PING_MINUTES = 30; // how long before a match both teams are pinged
const MAX_NAME = 60;
const SIGNUP_ID = 'tournament_signup'; // custom id: tournament_signup:<tournament id>

const settings = () => getStore('tournamentSettings'); // server id -> { organizerRoles: [role id] }
const tournaments = () => getStore('tournaments'); // tournament id -> the tournament (it carries its guildId)

// ---------- organizers ----------

const organizerRoles = async (guildId) => (await settings().get(guildId))?.organizerRoles ?? [];

// Adds (on = true) or removes an organizer role. Returns the new list.
async function setOrganizerRole(guildId, roleId, on) {
  const next = await settings().update(guildId, (current) => {
    const roles = (current?.organizerRoles ?? []).filter((id) => id !== roleId);
    return { ...current, organizerRoles: on ? [...roles, roleId] : roles };
  });
  return next.organizerRoles;
}

// May this member run tournaments? An organizer role, or Manage Server.
async function isOrganizer(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = await organizerRoles(interaction.guildId);
  return roles.some((id) => interaction.member?.roles?.cache?.has(id));
}

// ---------- times ----------

// A time staff typed, as milliseconds: "2026-11-20 18:00" (in their UTC offset, hours), a Discord timestamp (<t:1763661600>) or plain Unix seconds. Null if it is none of those.
function parseTime(text, offsetHours = 0) {
  const unix = /^(?:<t:)?(\d{9,11})(?::[a-zA-Z])?>?$/.exec(text.trim());
  if (unix) return Number(unix[1]) * 1000;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - offsetHours * 3_600_000;
  const back = new Date(ms + offsetHours * 3_600_000); // 2026-02-31 or 25:00 would roll over: refuse them
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && back.getUTCHours() === h && mi < 60 ? ms : null;
}

// ---------- a tournament ----------

const WHY_NOT = {
  name: `The name needs 1 to ${MAX_NAME} characters.`,
  taken: 'A tournament with that name is already running here.',
  time: 'I could not read that time. Write it like `2026-11-20 18:00`, or paste a Discord timestamp.',
  past: 'Sign-ups have to close in the future.',
  ranks: 'The lowest rank allowed is above the highest rank allowed.',
};

// Checks and saves a new tournament. Returns { ok, tournament } or { ok: false, reason } (a key of WHY_NOT).
async function createTournament(guildId, input, now = Date.now()) {
  const name = (input.name ?? '').trim();
  if (!name || name.length > MAX_NAME) return { ok: false, reason: 'name' };
  if (input.closesAt == null) return { ok: false, reason: 'time' };
  if (input.closesAt <= now) return { ok: false, reason: 'past' };
  if (input.minRank && input.maxRank && RANKS.indexOf(input.minRank) > RANKS.indexOf(input.maxRank)) return { ok: false, reason: 'ranks' };
  const running = Object.values(await tournaments().all()).filter((t) => t.guildId === guildId && !t.endedAt);
  if (running.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { ok: false, reason: 'taken' };

  const tournament = {
    id: shortId(),
    guildId,
    name,
    format: input.format,
    seeding: input.seeding,
    teamSize: input.teamSize,
    substitutes: input.substitutes ?? 0,
    teamCap: input.teamCap,
    closesAt: input.closesAt,
    minRank: input.minRank ?? null,
    maxRank: input.maxRank ?? null,
    teamChannels: Boolean(input.teamChannels),
    reviewChannelId: input.reviewChannelId,
    signupChannelId: input.signupChannelId,
    messageId: null, // the sign-up embed, once posted
    matchChannelId: input.matchChannelId ?? null, // where match messages go when teams have no channel (else the sign-up channel)
    utcOffset: input.utcOffset ?? 0, // the organizer's time zone, the default for every time typed later
    pingMinutes: input.pingMinutes ?? DEFAULT_PING_MINUTES,
    createdBy: input.createdBy,
    createdAt: now,
    teams: {}, // filled by sign-ups (step 2)
  };
  await tournaments().set(tournament.id, tournament);
  return { ok: true, tournament };
}

const getTournament = (id) => tournaments().get(id);
const updateTournament = (id, change) => tournaments().update(id, (t) => { const copy = { ...t }; change(copy); return copy; });
const deleteTournament = (id) => tournaments().delete(id);

// "Seeker to Oracle", "Oracle and Below", "Seeker and Above" or "None".
function rankLimitText(t) {
  if (t.minRank && t.maxRank) return t.minRank === t.maxRank ? `${t.minRank} Only` : `${t.minRank} to ${t.maxRank}`;
  if (t.maxRank) return `${t.maxRank} and Below`;
  if (t.minRank) return `${t.minRank} and Above`;
  return 'None';
}

const plural = (n, word) => `**${n}** ${word}${n === 1 ? '' : 's'}`;
const teamSizeText = (t) => (t.substitutes ? `${plural(t.teamSize, 'Player')}, ${plural(t.substitutes, 'Substitute')}` : plural(t.teamSize, 'Player'));

// The sign-up message for a tournament: a message payload.
function signupView(t, now = Date.now()) {
  const closed = now >= t.closesAt || Boolean(t.endedAt);
  const seconds = Math.floor(t.closesAt / 1000);
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(t.name)
    .setDescription(t.endedAt ? 'This tournament is over.' : closed ? 'Sign-ups are closed.' : 'Press **Sign Up** to enter your team. You become its Captain and invite your players.')
    .addFields(
      { name: 'Format', value: FORMATS[t.format], inline: true },
      { name: 'Team Size', value: teamSizeText(t), inline: true },
      { name: 'Teams', value: `**${Object.keys(t.teams ?? {}).length}** / **${t.teamCap}**`, inline: true },
      { name: closed ? 'Sign-Ups Closed' : 'Sign-Ups Close', value: `<t:${seconds}:F>\n<t:${seconds}:R>`, inline: true },
      { name: 'Rank Limit', value: rankLimitText(t), inline: true },
    );
  const button = new ButtonBuilder().setCustomId(`${SIGNUP_ID}:${t.id}`).setLabel('Sign Up').setStyle(ButtonStyle.Success).setDisabled(closed);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

// ---------- teams (step 2) ----------
// A team: { id, name, captainId, roleId, textId, voiceId, createdAt, members: { userId: { sub, status, at } }, invites: { userId: { sub, at, messageId } } }.
// status is 'pending' until staff approve the player's verification (step 3). Only an approved player gets the team role; the Captain has it from the start.

const MAX_TEAM_NAME = 32;
const TEAM_MODAL_ID = 'tournament_team'; // custom id: tournament_team:<tournament id>
const INVITE_ID = 'tournament_invite'; // custom id: tournament_invite:<tournament id>:<team id>:<user id>:<a|d>
const DISBAND_ID = 'tournament_disband'; // custom id: tournament_disband:<tournament id>:<team id>:<user id>

const allRunning = async () => Object.values(await tournaments().all()).filter((t) => !t.endedAt); // every server's
const running = async (guildId) => Object.values(await tournaments().all()).filter((t) => t.guildId === guildId && !t.endedAt);
const isClosed = (t, now = Date.now()) => now >= t.closesAt; // sign-ups closed: rosters are locked
const teamOf = (t, userId) => Object.values(t.teams).find((team) => team.members[userId]) ?? null;
const teamsInOrder = (t) => Object.values(t.teams).sort((a, b) => a.createdAt - b.createdAt);
// 0 = in the tournament; 1, 2, ... = its place on the waiting list.
const waitingPlace = (t, teamId) => Math.max(0, teamsInOrder(t).findIndex((team) => team.id === teamId) - t.teamCap + 1);
const count = (team, sub) => [...Object.values(team.members), ...Object.values(team.invites)].filter((m) => Boolean(m.sub) === sub).length;

// Runs fn(tournament) inside the store's lock and saves the tournament only when fn returns { ok: true }. Returns fn's result.
async function change(id, fn) {
  let result = { ok: false, reason: 'gone' };
  await tournaments().update(id, (t) => {
    if (!t || t.endedAt) return t;
    const copy = structuredClone(t);
    result = fn(copy);
    return result.ok ? copy : t;
  });
  return result;
}
const no = (reason) => ({ ok: false, reason });

const TEAM_WHY_NOT = {
  gone: 'This tournament is over.',
  closed: 'Sign-ups are closed.',
  locked: 'Sign-ups are closed, so rosters are locked. Ask an organizer.',
  onTeam: 'They are already on a team in this tournament.',
  youOnTeam: 'You are already on a team in this tournament.',
  teamName: `A team name needs 2 to ${MAX_TEAM_NAME} characters.`,
  teamTaken: 'A team with that name is already signed up.',
  notCaptain: "Only the team's Captain can do that.",
  noTeam: 'That team is gone.',
  invited: 'They already have an invite from your team.',
  full: 'Your team has no Player spot left.',
  subsFull: 'Your team has no Substitute spot left.',
  noInvite: 'That invite is gone.',
  self: "You can't do that to yourself.",
  notOnTeam: 'They are not on your team.',
  started: 'The tournament has started, so the team stays in the bracket. Ask an organizer.',
  captain: 'You are the Captain. Hand the team over with `/team transfer` or end it with `/team disband`.',
};

// A member signs a team up and becomes its Captain.
const addTeam = (id, { name, captainId }, now = Date.now()) => change(id, (t) => {
  name = (name ?? '').trim().replace(/\s+/g, ' ');
  if (isClosed(t, now)) return no('closed');
  if (teamOf(t, captainId)) return no('youOnTeam');
  if (name.length < 2 || name.length > MAX_TEAM_NAME) return no('teamName');
  if (Object.values(t.teams).some((team) => team.name.toLowerCase() === name.toLowerCase())) return no('teamTaken');
  const team = { id: shortId(), name, captainId, roleId: null, textId: null, voiceId: null, createdAt: now, members: { [captainId]: { sub: false, status: 'pending', at: now } }, invites: {} };
  t.teams[team.id] = team;
  return { ok: true, team, waiting: waitingPlace(t, team.id) };
});

// Changes one team in place (its role and channel ids, an invite's message id).
const editTeam = (id, teamId, edit) => change(id, (t) => {
  if (!t.teams[teamId]) return no('noTeam');
  edit(t.teams[teamId], t);
  return { ok: true, team: t.teams[teamId] };
});

// The Captain invites a member as a Player or a Substitute.
const invite = (id, teamId, byId, userId, sub, now = Date.now()) => change(id, (t) => {
  const team = t.teams[teamId];
  if (!team) return no('noTeam');
  if (team.captainId !== byId) return no('notCaptain');
  if (isClosed(t, now)) return no('locked');
  if (teamOf(t, userId)) return no('onTeam');
  if (team.invites[userId]) return no('invited');
  if (count(team, Boolean(sub)) >= (sub ? t.substitutes : t.teamSize)) return no(sub ? 'subsFull' : 'full');
  team.invites[userId] = { sub: Boolean(sub), at: now, messageId: null };
  return { ok: true, team };
});

// The invited member presses Accept or Decline. An accepted invite makes them a pending member.
const answerInvite = (id, teamId, userId, accept, now = Date.now()) => change(id, (t) => {
  const team = t.teams[teamId];
  const inv = team?.invites[userId];
  if (!inv) return no('noInvite');
  if (accept && isClosed(t, now)) return no('closed');
  if (accept && teamOf(t, userId)) return no('youOnTeam');
  delete team.invites[userId];
  if (accept) team.members[userId] = { sub: inv.sub, status: 'pending', at: now };
  return { ok: true, team, accepted: Boolean(accept), sub: inv.sub };
});

// The Captain takes a player off the team, or takes an invite back. messageId: the invite message to delete.
const removeMember = (id, teamId, byId, userId, now = Date.now()) => change(id, (t) => {
  const team = t.teams[teamId];
  if (!team) return no('noTeam');
  if (team.captainId !== byId) return no('notCaptain');
  if (isClosed(t, now)) return no('locked');
  if (userId === byId) return no('self');
  const inv = team.invites[userId];
  if (!inv && !team.members[userId]) return no('notOnTeam');
  delete team.invites[userId];
  delete team.members[userId];
  return { ok: true, team, wasInvite: Boolean(inv), messageId: inv?.messageId ?? null };
});

// A player leaves their team. The Captain can't: they hand it over or disband it.
const leaveTeam = (id, userId) => change(id, (t) => {
  const team = teamOf(t, userId);
  if (!team) return no('notOnTeam');
  if (team.captainId === userId) return no('captain');
  delete team.members[userId];
  return { ok: true, team };
});

// The Captain hands the team to another member of it.
const transferTeam = (id, teamId, byId, userId) => change(id, (t) => {
  const team = t.teams[teamId];
  if (!team) return no('noTeam');
  if (team.captainId !== byId) return no('notCaptain');
  if (userId === byId) return no('self');
  if (!team.members[userId]) return no('notOnTeam');
  team.captainId = userId;
  return { ok: true, team };
});

// The team that moves off the waiting list if `teamId` goes, or null.
const nextUp = (t, teamId) => (waitingPlace(t, teamId) === 0 ? teamsInOrder(t)[t.teamCap] ?? null : null);

// Removes a team (the Captain's own, when byId is given). promoted: the team that moved off the waiting list because of it, if any.
const disbandTeam = (id, teamId, byId = null) => change(id, (t) => {
  const team = t.teams[teamId];
  if (!team) return no('noTeam');
  if (byId && team.captainId !== byId) return no('notCaptain');
  if (byId && t.bracket) return no('started');
  const promoted = nextUp(t, teamId);
  delete t.teams[teamId];
  return { ok: true, team, promoted };
});

// Takes a member off their team in `t` (they left the server, or staff denied them). A Captain's team goes to its longest-standing member,
// or is disbanded if they were alone; once the bracket is made the team is never deleted. Returns { ok, t, team, disbanded, promoted, newCaptainId } (ok: something changed).
function dropFromTeam(t, userId) {
  const out = { ok: false, t };
  for (const other of Object.values(t.teams)) if (other.invites[userId]) { delete other.invites[userId]; out.ok = true; }
  const team = teamOf(t, userId);
  if (!team) return out;
  Object.assign(out, { ok: true, team });
  delete team.members[userId];
  if (team.captainId !== userId) return out;
  const [heir] = Object.entries(team.members).sort((a, b) => a[1].at - b[1].at);
  if (heir) { team.captainId = heir[0]; out.newCaptainId = heir[0]; return out; }
  if (t.bracket) return out;
  out.promoted = nextUp(t, team.id);
  out.disbanded = true;
  delete t.teams[team.id];
  return out;
}

// A member left the server: off every team and invite here. Returns what happened, one entry per tournament they were on a team in.
async function memberLeft(guildId, userId) {
  const done = [];
  for (const { id } of await running(guildId)) {
    const result = await change(id, (t) => dropFromTeam(t, userId));
    if (result.ok && result.team) done.push(result);
  }
  return done;
}

// ---------- teams in Discord: the role, the channels, the messages ----------

const CATEGORY_ROOM = 48; // a Discord category holds 50 channels; a team needs 2

const hidden = (guild, extra = []) => [
  { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
  { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages] },
  ...extra.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] })),
];

// A category of this tournament with room for one more team, made if there is none.
async function categoryWithRoom(guild, t) {
  for (const id of t.categoryIds ?? []) {
    const category = guild.channels.cache.get(id);
    if (category && category.children.cache.size <= CATEGORY_ROOM) return category;
  }
  const n = (t.categoryIds ?? []).length + 1;
  const category = await guild.channels.create({ name: n === 1 ? t.name : `${t.name} ${n}`, type: ChannelType.GuildCategory, permissionOverwrites: hidden(guild), reason: 'Tournament team channels' });
  await updateTournament(t.id, (saved) => { saved.categoryIds = [...(saved.categoryIds ?? []), category.id]; });
  return category;
}

// Makes a new team's role (given to its Captain) and, when the tournament has team channels, its text and voice channel. Saves their ids.
// If anything fails, what was made is removed again and the error is thrown.
async function makeTeamSpaces(guild, t, team) {
  const made = [];
  try {
    const role = await guild.roles.create({ name: team.name, mentionable: false, reason: `Tournament team (${t.name})` });
    made.push(role);
    const ids = { roleId: role.id, textId: null, voiceId: null };
    if (t.teamChannels) {
      const parent = await categoryWithRoom(guild, t);
      const permissionOverwrites = hidden(guild, [role.id, ...(await organizerRoles(guild.id)).filter((id) => guild.roles.cache.has(id))]);
      const text = await guild.channels.create({ name: team.name, type: ChannelType.GuildText, parent: parent.id, permissionOverwrites, reason: 'Tournament team' });
      made.push(text);
      const voice = await guild.channels.create({ name: team.name, type: ChannelType.GuildVoice, parent: parent.id, permissionOverwrites, reason: 'Tournament team' });
      made.push(voice);
      Object.assign(ids, { textId: text.id, voiceId: voice.id });
    }
    await guild.members.addRole({ user: team.captainId, role: role.id, reason: 'Team Captain' });
    await editTeam(t.id, team.id, (saved) => Object.assign(saved, ids));
    return Object.assign(team, ids);
  } catch (error) {
    for (const thing of made) await thing.delete('Team sign-up failed').catch(() => null);
    throw error;
  }
}

async function deleteMessage(guild, channelId, messageId) {
  if (!messageId) return;
  const message = await guild.channels.cache.get(channelId)?.messages.fetch(messageId).catch(() => null);
  await message?.delete().catch(() => null);
}

// Deletes a removed team's channels, role and open invite messages.
async function removeTeamSpaces(guild, t, team) {
  for (const id of [team.textId, team.voiceId]) await guild.channels.cache.get(id)?.delete('Tournament team removed').catch((e) => console.error('[tournament] Channel delete failed:', e.message));
  await guild.roles.cache.get(team.roleId)?.delete('Tournament team removed').catch((e) => console.error('[tournament] Role delete failed:', e.message));
  for (const inv of Object.values(team.invites)) await deleteMessage(guild, t.signupChannelId, inv.messageId);
}

const takeRole = async (guild, team, userId) => (team.roleId ? guild.members.removeRole({ user: userId, role: team.roleId, reason: 'Left the team' }).catch(() => null) : null);
const giveRole = async (guild, team, userId) => (team.roleId ? guild.members.addRole({ user: userId, role: team.roleId, reason: 'Team Captain' }).catch((e) => console.error('[tournament] Role add failed:', e.message)) : null);

// Posts in the team's text channel (nothing when the tournament has no team channels).
const tellTeam = async (guild, team, message) =>
  guild.channels.cache.get(team.textId)?.send({ allowedMentions: { parse: ['users'] }, ...(typeof message === 'string' ? { content: message } : message) }).catch((e) => console.error('[tournament] Team message failed:', e.message)) ?? null;

// Redraws the sign-up embed (the Teams count).
async function refreshSignup(guild, id) {
  const t = await getTournament(id);
  if (!t?.messageId) return;
  const message = await guild.channels.cache.get(t.signupChannelId)?.messages.fetch(t.messageId).catch(() => null);
  await message?.edit(signupView(t)).catch((e) => console.error('[tournament] Sign-up embed edit failed:', e.message));
}

// Everything after a team was removed from the data: its spaces, the embed, and the team that moved up.
async function afterDisband(guild, t, team, promoted) {
  await removeTeamSpaces(guild, t, team);
  await refreshSignup(guild, t.id);
  if (promoted) await tellTeam(guild, promoted, `A team dropped out. **${promoted.name}** is off the waiting list and in **${t.name}**.`);
}

// ---------- team messages ----------

function teamModal(t) {
  return new ModalBuilder().setCustomId(`${TEAM_MODAL_ID}:${t.id}`).setTitle('Sign Up Your Team').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('name').setLabel('Team Name').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(MAX_TEAM_NAME).setRequired(true),
    ),
  );
}

const waitingLine = (place) => (place ? `\n\nThe tournament is full. Your team is **#${place}** on the waiting list. It moves up when a team drops out.` : '');

// The first message in a new team's channel.
function welcomeText(t, team, place) {
  return [
    `**${team.name}** is signed up for **${t.name}**. <@${team.captainId}> is the Captain.${waitingLine(place)}`,
    '',
    '**Captain Commands**',
    '`/team invite` invites a Player or a Substitute.',
    '`/team remove` takes a player off the team or takes an invite back.',
    '`/team transfer` hands the team to another player.',
    '`/team disband` removes the team from the tournament.',
    '',
    '**Everyone**',
    '`/team roster` shows the team.',
    '`/team leave` leaves the team.',
    '',
    'Every player and Substitute has to be verified. Press **Verify** here, or run `/team verify`. A player gets the team role once an organizer approves them.',
    '',
    `Rosters lock when sign-ups close, <t:${Math.floor(t.closesAt / 1000)}:R>.`,
  ].join('\n');
}

// The invite posted in the sign-up channel. Only the invited member can press its buttons.
function inviteView(t, team, userId, sub) {
  const id = (answer) => `${INVITE_ID}:${t.id}:${team.id}:${userId}:${answer}`;
  return {
    content: `<@${userId}>, **${team.name}** invited you to play in **${t.name}** as a ${sub ? 'Substitute' : 'Player'}.`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(id('a')).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(id('d')).setLabel('Decline').setStyle(ButtonStyle.Secondary),
    )],
    allowedMentions: { users: [userId] },
  };
}

// The roster: an embed.
function rosterView(t, team) {
  const line = (id, m) => `<@${id}>${id === team.captainId ? ' (Captain)' : ''}${m.status === 'approved' ? '' : m.verification ? ', in review' : ', not verified yet'}`;
  const of = (sub) => Object.entries(team.members).filter(([, m]) => Boolean(m.sub) === sub).map(([id, m]) => line(id, m));
  const invited = Object.entries(team.invites).map(([id, m]) => `<@${id}> (${m.sub ? 'Substitute' : 'Player'})`);
  const place = waitingPlace(t, team.id);
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(team.name).setDescription(place ? `**${t.name}**\nWaiting List: **#${place}**` : `**${t.name}**`)
    .addFields({ name: `Players (${of(false).length} / ${t.teamSize})`, value: of(false).join('\n') || 'None' });
  if (t.substitutes) embed.addFields({ name: `Substitutes (${of(true).length} / ${t.substitutes})`, value: of(true).join('\n') || 'None' });
  if (invited.length) embed.addFields({ name: 'Invited', value: invited.join('\n') });
  return embed;
}

module.exports = {
  FORMATS,
  SEEDINGS,
  DEFAULT_PING_MINUTES,
  MAX_NAME,
  SIGNUP_ID,
  WHY_NOT,
  organizerRoles,
  setOrganizerRole,
  isOrganizer,
  parseTime,
  createTournament,
  getTournament,
  updateTournament,
  deleteTournament,
  rankLimitText,
  teamSizeText,
  signupView,
  MAX_TEAM_NAME,
  TEAM_MODAL_ID,
  INVITE_ID,
  DISBAND_ID,
  TEAM_WHY_NOT,
  running,
  allRunning,
  isClosed,
  teamOf,
  teamsInOrder,
  waitingPlace,
  addTeam,
  editTeam,
  invite,
  answerInvite,
  removeMember,
  leaveTeam,
  transferTeam,
  disbandTeam,
  memberLeft,
  change,
  no,
  dropFromTeam,
  nextUp,
  count,
  makeTeamSpaces,
  removeTeamSpaces,
  deleteMessage,
  takeRole,
  giveRole,
  tellTeam,
  refreshSignup,
  afterDisband,
  teamModal,
  welcomeText,
  inviteView,
  rosterView,
};
