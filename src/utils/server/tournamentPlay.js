// Tournaments after sign-up (steps 3 to 7 of server-plan.md "Scrims and tournaments"): verification reviews, closing sign-ups, making the bracket,
// match times, pings, Check-In, results, scrims, ending a tournament, its history and cleanup.
// Teams and sign-up: tournaments.js. Bracket maths: bracket.js. Lookups and the review embed: verification.js.
// Commands: commands/general/tournament.js, team.js, scrim.js. Buttons: components/tournament.js. The minute sweep: events/tournamentReady.js.
const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { BRAND_COLOR } = require('../../config');
const { shuffle, shortId } = require('../random');
const T = require('./tournaments');
const B = require('./bracket');
const V = require('./verification');

const CHECKIN_ID = 'tournament_checkin'; // tournament_checkin:<tournament id>:<match id>:<team id>
const RESULT_ID = 'tournament_result'; // tournament_result:<tournament id>:<match id>:<c|x> (Confirm / Dispute)
const SCRIM_ID = 'tournament_scrim'; // tournament_scrim:<tournament id>:<scrim id>:<a|d>
const CLEANUP_ID = 'tournament_cleanup'; // tournament_cleanup:<tournament id>:<user id>:<export channel id or 0>
const BEST_OF = [1, 3, 5];
const SCRIM_KEEP_MS = 3 * 3_600_000; // an accepted scrim is forgotten this long after its time
const EXPORT_MAX_BYTES = 8 * 1024 * 1024; // a Discord upload is 10 MB

const WHY_NOT = {
  ...T.TEAM_WHY_NOT,
  notPending: 'This player is not waiting for a review any more.',
  noBracket: 'The bracket is not made yet. An organizer makes it with `/tournament start`.',
  startedAlready: 'The bracket is already made.',
  open: 'Sign-ups are still open. Close them first with `/tournament close`.',
  tooFew: 'A bracket needs **2** ready teams. A team is ready when every player on it is verified and it has enough Players. `/tournament teams` shows who is not.',
  noMatch: 'There is no match with that code. `/tournament bracket` shows them.',
  played: 'That match is already played.',
  notReady: 'That match does not have both its teams yet.',
  notInMatch: 'That team is not in that match.',
  time: 'I could not read that time. Write it like `2026-11-20 18:00`, or paste a Discord timestamp.',
  past: 'That time is in the past.',
  score: 'Write the score from your side, wins first, like `2-1`. It has to be a win that fits the match length.',
  noOpenMatch: 'Your team has no match waiting for a result.',
  pickMatch: 'Your team has more than one match waiting. Pick one with the `match` option.',
  reported: 'A result for that match is already waiting for the other Captain.',
  noReport: 'There is no reported result to answer.',
  ownReport: "Your own team reported this. The other team's Captain answers it.",
  noScrim: 'That scrim is gone.',
  scrimOpen: 'Your team already has a scrim waiting for an answer.',
  ownScrim: "That is your own team's scrim.",
  sameTeam: "You can't scrim your own team.",
  notEnded: 'End the tournament first with `/tournament end`.',
  cleaned: 'That tournament is already cleaned up.',
};

const teamName = (t, id) => t.teams[id]?.name ?? 'Unknown Team';
const stamp = (ms) => `<t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)`;
const bestOfText = (n) => `Best of **${n}**`;
const players = (team) => Object.values(team.members).filter((m) => !m.sub).length;
const unverified = (team) => Object.values(team.members).filter((m) => m.status !== 'approved').length;
// Every player verified and enough Players to field a team.
const teamReady = (t, team) => unverified(team) === 0 && players(team) >= t.teamSize;

// ---------- where a team is told things ----------

// Posts to a team: its own channel, else the tournament's match channel, else the sign-up channel. `ping` mentions the team role.
async function tellMatch(guild, t, team, message, { ping = false } = {}) {
  const channel = guild.channels.cache.get(team.textId) ?? guild.channels.cache.get(t.matchChannelId) ?? guild.channels.cache.get(t.signupChannelId);
  const payload = typeof message === 'string' ? { content: message } : { ...message };
  if (ping && team.roleId) payload.content = `<@&${team.roleId}> ${payload.content ?? ''}`.trim();
  payload.allowedMentions = { parse: ['users'], roles: ping && team.roleId ? [team.roleId] : [] };
  return (await channel?.send(payload).catch((e) => console.error('[tournament] Team message failed:', e.message))) ?? null;
}

// Posts to the organizers in the review channel. `ping` mentions the organizer roles.
async function tellOrganizers(guild, t, message, { ping = false } = {}) {
  const roles = ping ? (await T.organizerRoles(guild.id)).filter((id) => guild.roles.cache.has(id)) : [];
  const payload = typeof message === 'string' ? { content: message } : { ...message };
  if (roles.length) payload.content = `${roles.map((id) => `<@&${id}>`).join(' ')} ${payload.content ?? ''}`.trim();
  payload.allowedMentions = { parse: [], roles };
  return (await guild.channels.cache.get(t.reviewChannelId)?.send(payload).catch((e) => console.error('[tournament] Organizer message failed:', e.message))) ?? null;
}

const tellPublic = async (guild, t, content) =>
  (await guild.channels.cache.get(t.signupChannelId)?.send({ content, allowedMentions: { parse: [] } }).catch((e) => console.error('[tournament] Announcement failed:', e.message))) ?? null;

// Tells a team's Captain something only the team should read: in the team channel, or by DM when the team has none.
async function tellCaptain(guild, team, line) {
  if (guild.channels.cache.get(team.textId)) return T.tellTeam(guild, team, line);
  const user = await guild.client?.users.fetch(team.captainId).catch(() => null);
  return (await user?.send(`**${team.name}** (${guild.name}): ${line}`).catch(() => null)) ?? null;
}

// After a member was taken off a team (dropFromTeam's result `r`): their role goes, and the team is told `line`, handed over or removed.
async function afterDrop(guild, r, userId, line) {
  await T.takeRole(guild, r.teamWas ?? r.team, userId);
  if (r.disbanded) return T.afterDisband(guild, r.t, r.team, r.promoted);
  if (r.newCaptainId) await T.giveRole(guild, r.team, r.newCaptainId);
  return tellCaptain(guild, r.team, r.newCaptainId ? `${line} <@${r.newCaptainId}> is the Captain now.` : line);
}

// ---------- which tournament and team a command is about ----------

// For a member's own commands (/team, /scrim): the `tournament` option, else the team channel it is run in, else their only team.
// Returns { t, team } or { error } (a line for the member).
async function findMine(interaction) {
  const mine = (await T.running(interaction.guildId)).filter((t) => T.teamOf(t, interaction.user.id));
  const picked = interaction.options.getString('tournament');
  const here = mine.find((t) => T.teamOf(t, interaction.user.id).textId === interaction.channelId);
  const t = picked ? mine.find((x) => x.id === picked || x.name.toLowerCase() === picked.toLowerCase()) : here ?? (mine.length === 1 ? mine[0] : null);
  if (t) return { t, team: T.teamOf(t, interaction.user.id) };
  if (picked) return { error: 'You are not on a team in that tournament.' };
  return { error: mine.length ? 'You are in more than one tournament. Pick one with the `tournament` option, or run this in your team channel.' : 'You are not on a team. Press **Sign Up** on a tournament to make one.' };
}

// For organizer commands: the tournament named by `value` (its id from the autocomplete, or its name) out of `list`, or the only one in `list`.
// Returns { t } or { error }.
function pick(list, value) {
  const t = value ? list.find((x) => x.id === value || x.name.toLowerCase() === value.toLowerCase()) : list.length === 1 ? list[0] : null;
  if (t) return { t };
  if (value) return { error: 'I could not find that tournament here.' };
  return { error: list.length ? 'Pick which tournament with the `tournament` option.' : 'There is no tournament for that here.' };
}

// A team of `t` by its id (from the autocomplete) or its name.
const findTeam = (t, value) => Object.values(t.teams).find((team) => team.id === value || team.name.toLowerCase() === (value ?? '').toLowerCase()) ?? null;

// ---------- step 3: verification ----------

// Saves a member's lookup and posts its review for staff. Returns { ok, flags } or { ok: false, reason }.
async function submitVerification(guild, t, userId, report) {
  const team = T.teamOf(t, userId);
  if (!team) return T.no('notOnTeam');
  if (team.members[userId].status === 'approved') return T.no('notPending');
  const usedBy = Object.values(t.teams).flatMap((x) => Object.entries(x.members)).find(([id, m]) => id !== userId && m.verification?.steamId === report.steamId)?.[0] ?? null;
  const flags = V.flagsOf(t, report, usedBy);
  const message = await tellOrganizers(guild, t, V.reviewView(guild, t, team, userId, report, flags));
  if (!message) return T.no('noReview');
  const old = team.members[userId].verification?.messageId;
  const saved = await T.change(t.id, (now) => {
    const member = T.teamOf(now, userId)?.members[userId];
    if (!member || member.status === 'approved') return T.no('notPending');
    member.verification = { steamId: report.steamId, badge: report.badge, rank: report.rank, messageId: message.id, at: Date.now(), report, flags };
    return { ok: true };
  });
  if (!saved.ok) { await message.delete().catch(() => null); return saved; }
  await T.deleteMessage(guild, t.reviewChannelId, old);
  return { ok: true, flags };
}
WHY_NOT.noReview = 'I could not post your review for the organizers. Tell an organizer.';

// A review button: 'approved' gives the role, 'investigating' only marks the review. Returns { ok, t, team, member } or a reason.
const decide = (id, teamId, userId, kind, byId) => T.change(id, (t) => {
  const team = t.teams[teamId];
  const member = team?.members[userId];
  if (!member?.verification || member.status === 'approved') return T.no('notPending');
  member.verification.decision = { kind, by: byId };
  if (kind === 'approved') member.status = 'approved';
  return { ok: true, t, team, member };
});

// Deny: the player comes off the team. Returns dropFromTeam's result plus the `member` as they were.
const deny = (id, teamId, userId, byId, reason) => T.change(id, (t) => {
  const member = t.teams[teamId]?.members[userId];
  if (!member?.verification || member.status === 'approved') return T.no('notPending');
  const was = structuredClone(member);
  was.verification.decision = { kind: 'denied', by: byId, reason };
  const teamWas = structuredClone(t.teams[teamId]);
  return { ...T.dropFromTeam(t, userId), member: was, teamWas };
});

// The review message as it reads after a decision.
const reviewAfter = (guild, t, team, userId, member) => V.reviewView(guild, t, team, userId, member.verification.report, member.verification.flags, member.verification.decision);

// The server's audit log (when it has one: /audit-log-config channel) gets every decision.
async function auditDecision(guild, t, team, userId, decision) {
  const audit = require('../audit/auditLog');
  const what = { approved: 'approved', denied: 'denied', investigating: 'needs investigation' }[decision.kind];
  const embed = audit.entryEmbed({
    color: decision.kind === 'approved' ? audit.COLOR.add : decision.kind === 'denied' ? audit.COLOR.remove : audit.COLOR.edit,
    title: `Tournament verification: ${what}`,
    fields: [
      { name: 'Staff', value: `<@${decision.by}>`, inline: true },
      { name: 'Player', value: `<@${userId}>`, inline: true },
      { name: 'Team', value: `${team.name} (${t.name})`, inline: true },
      ...(decision.reason ? [{ name: 'Reason', value: decision.reason }] : []),
    ],
  });
  await audit.log(guild, 'staff-edit', embed, { userIds: [decision.by, userId] }).catch((e) => console.error('[tournament] Audit log failed:', e.message));
}

// ---------- step 4: closing sign-ups, the teams list, the bracket ----------

// The teams as organizers need them: who is ready, who is not and why, who is waiting.
function teamsView(t) {
  const lines = T.teamsInOrder(t).map((team, i) => {
    const seeded = t.bracket ? t.bracket.seeds.indexOf(team.id) : -1;
    const short = players(team) < t.teamSize ? `**${players(team)}** of **${t.teamSize}** Players` : null;
    const waiting = unverified(team) ? `**${unverified(team)}** not verified` : null;
    const state = t.bracket ? (seeded >= 0 ? `Seed **${seeded + 1}**` : 'Not in the Bracket') : [short, waiting].filter(Boolean).join(', ') || 'Ready';
    const place = !t.bracket && T.waitingPlace(t, team.id) ? `, Waiting List **#${T.waitingPlace(t, team.id)}**` : '';
    const seed = !t.bracket && t.seeding === 'staff' && team.seed ? `, Seed **${team.seed}**` : '';
    return `**${i + 1}.** ${team.name} (<@${team.captainId}>): ${state}${place}${seed}`;
  });
  let text = lines.join('\n') || 'No teams yet.';
  if (text.length > 4000) text = `${text.slice(0, text.lastIndexOf('\n', 3900))}\nMore teams are not shown.`;
  return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${t.name}: Teams`).setDescription(text);
}

// Closes sign-ups now. Returns { ok } or 'closed' when they already are.
const closeNow = (id, now = Date.now()) => T.change(id, (t) => {
  if (T.isClosed(t, now)) return T.no('closed');
  t.closesAt = now;
  return { ok: true, t };
});

// The team ids in seeding order. `rnd`: the dice for Random.
function seedTeams(t, teams, rnd) {
  if (t.seeding === 'random') return shuffle(teams, rnd).map((team) => team.id);
  if (t.seeding === 'staff') return [...teams].sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity) || a.createdAt - b.createdAt).map((team) => team.id);
  const strength = (team) => { const badges = Object.values(team.members).map((m) => m.verification?.badge ?? 0); return badges.reduce((n, x) => n + x, 0) / (badges.length || 1); };
  return [...teams].sort((a, b) => strength(b) - strength(a) || a.createdAt - b.createdAt).map((team) => team.id);
}

// Makes the bracket from the ready teams (up to the cap, by sign-up order). Returns { ok, t, left: [teams not in it] }.
const start = (id, { bestOf = 1, rnd, now = Date.now() } = {}) => T.change(id, (t) => {
  if (t.bracket) return T.no('startedAlready');
  if (!T.isClosed(t, now)) return T.no('open');
  const ready = T.teamsInOrder(t).filter((team) => teamReady(t, team)).slice(0, t.teamCap);
  if (ready.length < 2) return T.no('tooFew');
  t.bracket = B.build(t.format, seedTeams(t, ready, rnd));
  t.bestOf = bestOf;
  t.startedAt = now;
  return { ok: true, t, left: Object.values(t.teams).filter((team) => !t.bracket.seeds.includes(team.id)) };
});

const setSeed = (id, teamId, seed) => T.change(id, (t) => {
  if (t.bracket) return T.no('startedAlready');
  if (!t.teams[teamId]) return T.no('noTeam');
  t.teams[teamId].seed = seed;
  return { ok: true, team: t.teams[teamId] };
});

// An organizer puts a member on a team (also after the roster lock). They still have to verify.
const organizerAdd = (id, teamId, userId, sub, now = Date.now()) => T.change(id, (t) => {
  const team = t.teams[teamId];
  if (!team) return T.no('noTeam');
  if (T.teamOf(t, userId)) return T.no('onTeam');
  if (T.count(team, Boolean(sub)) >= (sub ? t.substitutes : t.teamSize)) return T.no(sub ? 'subsFull' : 'full');
  delete team.invites[userId];
  team.members[userId] = { sub: Boolean(sub), status: 'pending', at: now };
  return { ok: true, team };
});

// An organizer takes a member off a team (also after the roster lock).
const organizerRemove = (id, teamId, userId) => T.change(id, (t) => {
  if (!t.teams[teamId]?.members[userId]) return T.no('notOnTeam');
  const teamWas = structuredClone(t.teams[teamId]);
  return { ...T.dropFromTeam(t, userId), teamWas };
});

// ---------- matches: what they read as ----------

const matchTitle = (t, id) => `Match ${id} (${B.roundName(t.bracket, t.bracket.matches[id])})`;
const scoreText = (score) => (score ? ` **${score[0]}-${score[1]}**` : '');

// One line of the bracket list.
function matchLine(t, id, now) {
  const m = t.bracket.matches[id];
  const name = (side) => (side === undefined ? 'To Be Decided' : teamName(t, side));
  if (now.state === 'done') return `\`${id}\` **${teamName(t, now.winner)}** beat ${teamName(t, now.loser)}${scoreText(m.score)}`;
  const when = now.state === 'ready' ? (m.time ? `, <t:${Math.floor(m.time / 1000)}:f>` : ', no time yet') : '';
  return `\`${id}\` ${name(now.a)} vs ${name(now.b)}${when}`;
}

// The bracket as embeds: one field per round, byes and matches nobody is in yet left out.
function bracketView(t) {
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${t.name}: ${T.FORMATS[t.format]}`);
  if (!t.bracket) return embed.setDescription(WHY_NOT.noBracket);
  const now = B.resolve(t.bracket);
  if (t.format === 'robin') {
    embed.setDescription(B.table(t.bracket).map((r, i) => `**${i + 1}.** ${teamName(t, r.team)}: **${r.wins}** Won, **${r.losses}** Lost`).join('\n').slice(0, 4000));
  }
  const rounds = new Map();
  for (const id of t.bracket.order) {
    if (now[id].state === 'bye' || (now[id].a === undefined && now[id].b === undefined)) continue;
    const key = B.roundName(t.bracket, t.bracket.matches[id]);
    rounds.set(key, [...(rounds.get(key) ?? []), matchLine(t, id, now[id])]);
  }
  let room = 5000 - (embed.data.description?.length ?? 0);
  let cut = false;
  for (const [name, lines] of rounds) {
    let value = lines.join('\n');
    if (value.length > 1024) value = `${value.slice(0, value.lastIndexOf('\n', 990))}\nMore matches are not shown.`;
    if (value.length + name.length > room || (embed.data.fields?.length ?? 0) >= 24) { cut = true; break; }
    room -= value.length + name.length;
    embed.addFields({ name, value });
  }
  if (cut) embed.setFooter({ text: 'Later rounds are not shown.' });
  if (B.complete(t.bracket)) {
    const [first] = B.standings(t.bracket);
    embed.addFields({ name: 'Winner', value: `**${teamName(t, first.teams[0])}**` });
  }
  return embed;
}

// Tells both teams of each match in `ids` that it is theirs to play.
async function announceReady(guild, t, ids) {
  const now = B.resolve(t.bracket);
  for (const id of ids) {
    const m = t.bracket.matches[id];
    for (const [mine, theirs] of [[now[id].a, now[id].b], [now[id].b, now[id].a]]) {
      if (!t.teams[mine]) continue;
      const when = m.time ? stamp(m.time) : 'An organizer will set the time.';
      await tellMatch(guild, t, t.teams[mine], `**Up Next: ${matchTitle(t, id)}**\n**${teamName(t, mine)}** vs **${teamName(t, theirs)}**\n${when}\n${bestOfText(m.bestOf ?? t.bestOf)}`);
    }
  }
}

const readyIds = (bracket) => { const now = B.resolve(bracket); return bracket.order.filter((id) => now[id].state === 'ready'); };

// ---------- step 5: times, Check-In, results ----------

// Sets a match's time (and its length). Returns { ok, t, state }.
const schedule = (id, matchId, time, bestOf = null, now = Date.now()) => T.change(id, (t) => {
  if (!t.bracket) return T.no('noBracket');
  const m = t.bracket.matches[matchId];
  if (!m) return T.no('noMatch');
  const state = B.resolve(t.bracket)[matchId].state;
  if (state === 'done' || state === 'bye') return T.no('played');
  if (time == null) return T.no('time');
  if (time <= now) return T.no('past');
  Object.assign(m, { time, ...(bestOf ? { bestOf } : {}) });
  for (const key of ['pinged', 'flagged', 'checkedIn']) delete m[key];
  return { ok: true, t, state };
});

const checkInRow = (t, matchId, teamId) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${CHECKIN_ID}:${t.id}:${matchId}:${teamId}`).setLabel('Check In').setStyle(ButtonStyle.Success));

// The Captain presses Check In. Returns { ok, both } (both: the other team is in too).
const checkIn = (id, matchId, teamId, byId) => T.change(id, (t) => {
  const m = t.bracket?.matches[matchId];
  const now = m && B.resolve(t.bracket)[matchId];
  if (!m || now.state !== 'ready' || (now.a !== teamId && now.b !== teamId)) return T.no('played');
  if (t.teams[teamId]?.captainId !== byId) return T.no('notCaptain');
  m.checkedIn = { ...m.checkedIn, [teamId]: true };
  return { ok: true, t, both: Boolean(m.checkedIn[now.a] && m.checkedIn[now.b]) };
});

// "2-1" -> [2, 1] when it is a win that fits a best of `bestOf`; else null.
function parseScore(text, bestOf) {
  const m = /^\s*(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$/.exec(text ?? '');
  if (!m) return null;
  const [w, l] = [Number(m[1]), Number(m[2])];
  return w === Math.ceil(bestOf / 2) && l < w ? [w, l] : null;
}

// The winning Captain reports. `matchId` is only needed when the team has several matches waiting (Round Robin).
const report = (id, byId, text, matchId = null) => T.change(id, (t) => {
  if (!t.bracket) return T.no('noBracket');
  const team = T.teamOf(t, byId);
  if (!team) return T.no('notOnTeam');
  if (team.captainId !== byId) return T.no('notCaptain');
  const now = B.resolve(t.bracket);
  const mine = t.bracket.order.filter((x) => now[x].state === 'ready' && (now[x].a === team.id || now[x].b === team.id));
  const pick = matchId ? mine.find((x) => x.toLowerCase() === matchId.toLowerCase()) : mine.length === 1 ? mine[0] : null;
  if (!pick) return T.no(!mine.length || matchId ? 'noOpenMatch' : 'pickMatch');
  const m = t.bracket.matches[pick];
  if (m.report && !m.report.disputed) return T.no('reported');
  const score = parseScore(text, m.bestOf ?? t.bestOf);
  if (!score) return T.no('score');
  m.report = { by: team.id, score, at: Date.now() };
  const other = now[pick].a === team.id ? now[pick].b : now[pick].a;
  return { ok: true, t, matchId: pick, team, other: t.teams[other], score };
});

const resultRow = (t, matchId) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${RESULT_ID}:${t.id}:${matchId}:c`).setLabel('Confirm').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`${RESULT_ID}:${t.id}:${matchId}:x`).setLabel('Dispute').setStyle(ButtonStyle.Danger),
);

// The other Captain answers a report. Confirm records it; Dispute hands it to the organizers. Returns { ok, t, before, confirmed, ... }.
const answerReport = (id, matchId, byId, confirm) => T.change(id, (t) => {
  const m = t.bracket?.matches[matchId];
  if (!m?.report || m.report.disputed) return T.no('noReport');
  const team = T.teamOf(t, byId);
  const now = B.resolve(t.bracket)[matchId];
  if (!team || team.captainId !== byId || (now.a !== team.id && now.b !== team.id)) return T.no('notCaptain');
  if (team.id === m.report.by) return T.no('ownReport');
  const { by, score } = m.report;
  if (!confirm) { m.report.disputed = true; return { ok: true, t, confirmed: false, winner: by, loser: team.id, score }; }
  const before = readyIds(t.bracket);
  const set = B.setResult(t.bracket, matchId, by, score);
  if (!set.ok) return T.no(set.reason);
  return { ok: true, t, confirmed: true, before, cleared: set.cleared, winner: by, loser: team.id, score };
});

// An organizer sets or corrects a result (a forfeit, a dispute, a mistake).
const organizerResult = (id, matchId, winnerId, text) => T.change(id, (t) => {
  if (!t.bracket) return T.no('noBracket');
  const key = t.bracket.order.find((x) => x.toLowerCase() === (matchId ?? '').toLowerCase());
  if (!key) return T.no('noMatch');
  const m = t.bracket.matches[key];
  const score = text ? parseScore(text, m.bestOf ?? t.bestOf) : null;
  if (text && !score) return T.no('score');
  const before = readyIds(t.bracket);
  const wasDone = B.complete(t.bracket);
  const set = B.setResult(t.bracket, key, winnerId, score);
  if (!set.ok) return T.no(set.reason);
  const now = B.resolve(t.bracket)[key];
  return { ok: true, t, matchId: key, before, wasDone, cleared: set.cleared, winner: now.winner, loser: now.loser, score };
});

// After a result is in: both teams are told, the next matches are announced, and a finished bracket names its winner.
async function afterResult(guild, t, matchId, { winner, loser, score, before, cleared = [] }) {
  const line = `**${matchTitle(t, matchId)}:** **${teamName(t, winner)}** beat **${teamName(t, loser)}**${scoreText(score)}.`;
  for (const id of [winner, loser]) if (t.teams[id]) await tellMatch(guild, t, t.teams[id], line);
  if (cleared.length) await tellOrganizers(guild, t, `A corrected result in **${t.name}** changed who plays later. These results were cleared and have to be played or entered again: ${cleared.map((id) => `\`${id}\``).join(', ')}.`);
  await announceReady(guild, t, readyIds(t.bracket).filter((id) => !before.includes(id)));
  if (B.complete(t.bracket)) {
    const champion = teamName(t, B.standings(t.bracket)[0].teams[0]);
    await tellPublic(guild, t, `**${champion}** won **${t.name}**.`);
    await tellOrganizers(guild, t, `**${t.name}** is played out. **${champion}** won. End it with \`/tournament end\`.`);
  }
}

// ---------- step 6: scrims ----------

// A Captain sets a scrim up: against `otherId`, or open to any team (otherId null). Returns { ok, t, scrim, team }.
const scrimNew = (id, byId, otherId, time, now = Date.now()) => T.change(id, (t) => {
  const team = T.teamOf(t, byId);
  if (!team) return T.no('notOnTeam');
  if (team.captainId !== byId) return T.no('notCaptain');
  if (otherId && !t.teams[otherId]) return T.no('noTeam');
  if (otherId === team.id) return T.no('sameTeam');
  if (time == null) return T.no('time');
  if (time <= now) return T.no('past');
  t.scrims ??= {};
  if (Object.values(t.scrims).some((s) => s.a === team.id && !s.accepted)) return T.no('scrimOpen');
  const scrim = { id: shortId(), a: team.id, b: otherId ?? null, open: !otherId, time, accepted: false, channelId: null, messageId: null };
  t.scrims[scrim.id] = scrim;
  return { ok: true, t, scrim, team };
});

function scrimView(t, scrim) {
  const id = (answer) => `${SCRIM_ID}:${t.id}:${scrim.id}:${answer}`;
  const buttons = [new ButtonBuilder().setCustomId(id('a')).setLabel('Accept').setStyle(ButtonStyle.Success)];
  if (!scrim.open) buttons.push(new ButtonBuilder().setCustomId(id('d')).setLabel('Decline').setStyle(ButtonStyle.Secondary));
  const content = scrim.open
    ? `**${teamName(t, scrim.a)}** is looking for a scrim in **${t.name}**.\n${stamp(scrim.time)}\nA Captain of another team can press **Accept**.`
    : `<@${t.teams[scrim.b].captainId}>, **${teamName(t, scrim.a)}** challenges **${teamName(t, scrim.b)}** to a scrim.\n${stamp(scrim.time)}`;
  return { content, components: [new ActionRowBuilder().addComponents(buttons)] };
}

// A Captain presses Accept or Decline on a scrim. Returns { ok, t, scrim, accepted }.
const scrimAnswer = (id, scrimId, byId, accept, now = Date.now()) => T.change(id, (t) => {
  const scrim = t.scrims?.[scrimId];
  if (!scrim || scrim.accepted || scrim.time <= now) return T.no('noScrim');
  const team = T.teamOf(t, byId);
  if (!team || team.captainId !== byId) return T.no('notCaptain');
  if (team.id === scrim.a) return T.no('ownScrim');
  if (scrim.b && scrim.b !== team.id) return T.no('notCaptain');
  if (!accept) { delete t.scrims[scrimId]; return { ok: true, t, scrim, accepted: false }; }
  Object.assign(scrim, { b: team.id, accepted: true });
  return { ok: true, t, scrim, accepted: true };
});

// ---------- the minute sweep ----------

// Everything that happens by the clock in one tournament: the note when sign-ups close, match pings with Check In, no-show flags, scrim pings.
async function sweep(guild, id, now = Date.now()) {
  let t = await T.getTournament(id);
  if (!t || t.endedAt) return;

  if (T.isClosed(t, now) && !t.closedNoted) {
    await T.updateTournament(id, (saved) => { saved.closedNoted = true; });
    await T.refreshSignup(guild, id);
    if (!t.bracket) await tellOrganizers(guild, t, { content: `Sign-ups for **${t.name}** are closed. Make the bracket with \`/tournament start\`. Teams that are not ready are left out.`, embeds: [teamsView(t)] }, { ping: true });
  }

  const ping = t.pingMinutes * 60_000;
  if (t.bracket) {
    const state = B.resolve(t.bracket);
    for (const matchId of t.bracket.order) {
      const m = t.bracket.matches[matchId];
      if (!m.time || state[matchId].state !== 'ready') continue;
      const sides = [state[matchId].a, state[matchId].b];
      if (!m.pinged && now >= m.time - ping) {
        await T.change(id, (saved) => { saved.bracket.matches[matchId].pinged = true; return { ok: true }; });
        for (const [mine, theirs] of [sides, [...sides].reverse()]) {
          await tellMatch(guild, t, t.teams[mine], { content: `**${matchTitle(t, matchId)}** against **${teamName(t, theirs)}** starts <t:${Math.floor(m.time / 1000)}:R>. Captain, press **Check In**.`, components: [checkInRow(t, matchId, mine)] }, { ping: true });
        }
      } else if (m.pinged && !m.flagged && now >= m.time) {
        await T.change(id, (saved) => { saved.bracket.matches[matchId].flagged = true; return { ok: true }; });
        const missing = sides.filter((team) => !m.checkedIn?.[team]);
        if (missing.length) {
          const names = missing.map((team) => `**${teamName(t, team)}**`).join(' and ');
          await tellOrganizers(guild, t, `${names} did not Check In for **${matchTitle(t, matchId)}** in **${t.name}**. You can wait, move it with \`/tournament schedule\`, or give the win with \`/tournament result\`.`, { ping: true });
        }
      }
    }
  }

  for (const scrim of Object.values(t.scrims ?? {})) {
    if (scrim.accepted && !scrim.pinged && now >= scrim.time - ping) {
      await T.change(id, (saved) => { if (saved.scrims?.[scrim.id]) saved.scrims[scrim.id].pinged = true; return { ok: true }; });
      for (const [mine, theirs] of [[scrim.a, scrim.b], [scrim.b, scrim.a]]) {
        if (t.teams[mine]) await tellMatch(guild, t, t.teams[mine], `Your scrim against **${teamName(t, theirs)}** starts <t:${Math.floor(scrim.time / 1000)}:R>.`, { ping: true });
      }
    } else if ((!scrim.accepted && now >= scrim.time) || now >= scrim.time + SCRIM_KEEP_MS) {
      await T.change(id, (saved) => { delete saved.scrims?.[scrim.id]; return { ok: true }; });
      if (!scrim.accepted) await T.deleteMessage(guild, scrim.channelId, scrim.messageId);
    }
  }
}

// ---------- step 7: ending, history, cleanup ----------

// Ends a tournament: saves the final places by team name and gives `winnerRoleId` to the winning team's verified players.
// Returns { ok, t, champion (a team or null), given (how many got the role) }.
async function end(guild, id, winnerRoleId = null, now = Date.now()) {
  const t = await T.getTournament(id);
  if (!t || t.endedAt) return T.no('gone');
  const places = t.bracket ? B.standings(t.bracket).map((p) => ({ place: p.place, teams: p.teams.map((team) => teamName(t, team)) })) : [];
  const champion = t.bracket && B.complete(t.bracket) ? t.teams[B.standings(t.bracket)[0].teams[0]] ?? null : null;
  let given = 0;
  if (champion && winnerRoleId) {
    for (const [userId, m] of Object.entries(champion.members)) {
      if (m.status !== 'approved') continue;
      const ok = await guild.members.addRole({ user: userId, role: winnerRoleId, reason: `Won ${t.name}` }).then(() => true).catch((e) => { console.error('[tournament] Winner role failed:', e.message); return false; });
      if (ok) given += 1;
    }
  }
  const ended = await T.updateTournament(id, (saved) => Object.assign(saved, { endedAt: now, standings: places, champion: champion?.name ?? null, teamCount: Object.keys(saved.teams).length, scrims: {} }));
  await T.refreshSignup(guild, id);
  return { ok: true, t: ended, champion, given };
}

const ended = async (guildId) => Object.values(await require('../../storage').getStore('tournaments').all()).filter((t) => t.guildId === guildId && t.endedAt).sort((a, b) => b.endedAt - a.endedAt);

// Past tournaments: the list, or one tournament's final places.
function historyView(list, one = null) {
  const embed = new EmbedBuilder().setColor(BRAND_COLOR);
  const day = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;
  if (!one) {
    const lines = list.slice(0, 25).map((t) => `**${t.name}**, ${day(t.endedAt)}: ${t.champion ? `won by **${t.champion}**` : 'no winner'}`);
    return embed.setTitle('Past Tournaments').setDescription(lines.join('\n') || 'No tournament has ended here yet.');
  }
  const places = (one.standings ?? []).map((p) => `${p.place ? `**${p.place}.**` : 'Not Finished:'} ${p.teams.join(', ')}`);
  let text = places.join('\n') || 'It ended before a bracket was made.';
  if (text.length > 3900) text = `${text.slice(0, text.lastIndexOf('\n', 3800))}\nMore teams are not shown.`;
  return embed.setTitle(one.name).setDescription(`${T.FORMATS[one.format]}, ended ${day(one.endedAt)}\n\n${text}`);
}

// A channel's messages as plain text, oldest first. Returns { text, count, cut } (cut: too long, only the newest are in it).
async function exportText(channel, maxBytes = EXPORT_MAX_BYTES) {
  const lines = [];
  let bytes = 0;
  let before;
  let cut = false;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const m of batch.values()) {
      const name = m.member?.displayName ?? m.author?.displayName ?? m.author?.username ?? 'Unknown';
      const parts = [m.cleanContent, ...(m.embeds ?? []).map((e) => [e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`)].filter(Boolean).join(' | ')), ...[...(m.attachments?.values() ?? [])].map((a) => `[File: ${a.url}]`)].filter(Boolean);
      const line = `[${new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 16)} UTC] ${name}: ${parts.join('\n')}`;
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > maxBytes) { cut = true; break; }
      lines.push(line);
    }
    if (cut) break;
    before = batch.last().id;
  }
  return { text: lines.reverse().join('\n'), count: lines.length, cut };
}

// Deletes every team channel, role and category of an ended tournament. With `exportChannel`, each team's chat is posted there first as a .txt file.
// Returns { ok, teams, exported, failed: [team names whose chat could not be exported; their channels are kept] }.
async function cleanup(guild, id, exportChannel = null) {
  const t = await T.getTournament(id);
  if (!t) return T.no('gone');
  if (!t.endedAt) return T.no('notEnded');
  if (t.cleanedAt) return T.no('cleaned');
  let exported = 0;
  const failed = [];
  for (const team of Object.values(t.teams)) {
    const text = guild.channels.cache.get(team.textId);
    if (exportChannel && text) {
      try {
        const chat = await exportText(text);
        const file = new AttachmentBuilder(Buffer.from(`${team.name} in ${t.name}. ${chat.count} messages.${chat.cut ? ' Too long for one file: only the newest messages are here.' : ''}\n\n${chat.text}\n`), { name: `${team.name.replace(/[^\w-]+/g, '_')}.txt` });
        await exportChannel.send({ content: `**${team.name}** (${t.name})`, files: [file], allowedMentions: { parse: [] } });
        exported += 1;
      } catch (error) {
        console.error(`[tournament] Export of ${team.name} failed:`, error.message);
        failed.push(team.name);
        continue; // never delete a chat that was meant to be saved and wasn't
      }
    }
    await T.removeTeamSpaces(guild, t, team);
  }
  if (!failed.length) for (const categoryId of t.categoryIds ?? []) await guild.channels.cache.get(categoryId)?.delete('Tournament cleanup').catch((e) => console.error('[tournament] Category delete failed:', e.message));
  if (!failed.length) await T.updateTournament(id, (saved) => { saved.cleanedAt = Date.now(); });
  return { ok: true, teams: Object.keys(t.teams).length - failed.length, exported, failed };
}

module.exports = {
  CHECKIN_ID, RESULT_ID, SCRIM_ID, CLEANUP_ID, BEST_OF, WHY_NOT,
  teamName, stamp, bestOfText, teamReady, tellMatch, tellOrganizers, tellPublic, tellCaptain, afterDrop, findMine, pick, findTeam,
  submitVerification, decide, deny, reviewAfter, auditDecision,
  teamsView, closeNow, seedTeams, start, setSeed, organizerAdd, organizerRemove,
  matchTitle, matchLine, bracketView, announceReady, readyIds,
  schedule, checkInRow, checkIn, parseScore, report, resultRow, answerReport, organizerResult, afterResult,
  scrimNew, scrimView, scrimAnswer, sweep,
  end, ended, historyView, exportText, cleanup,
};
