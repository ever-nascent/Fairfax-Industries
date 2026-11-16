// Run: node --test. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const T = require('../src/utils/server/tournaments');
const command = require('../src/commands/general/tournament');
const config = require('../src/commands/admin/tournament-config');
const routes = require('../src/components/tournament');

const NOW = Date.parse('2026-11-15T12:00:00Z');
const base = { name: 'Fairfax Cup', format: 'single', seeding: 'rank', teamSize: 6, teamCap: 8, closesAt: NOW + 86_400_000, reviewChannelId: 'rev', signupChannelId: 'sign', createdBy: 'u1' };
const member = (roles, perms = []) => ({ guildId: 'g1', memberPermissions: new PermissionsBitField(perms), member: { roles: { cache: new Map(roles.map((r) => [r, true])) } } });

test('organizer roles: added, removed, per server; Manage Server always passes', async () => {
  assert.deepStrictEqual(await T.organizerRoles('g1'), []);
  assert.deepStrictEqual(await T.setOrganizerRole('g1', 'r1', true), ['r1']);
  assert.deepStrictEqual(await T.setOrganizerRole('g1', 'r1', true), ['r1'], 'adding twice keeps one');
  assert.deepStrictEqual(await T.setOrganizerRole('g1', 'r2', true), ['r1', 'r2']);
  assert.deepStrictEqual(await T.setOrganizerRole('g1', 'r1', false), ['r2']);
  assert.deepStrictEqual(await T.organizerRoles('g2'), []);
  assert.strictEqual(await T.isOrganizer(member(['r2'])), true);
  assert.strictEqual(await T.isOrganizer(member(['r1'])), false);
  assert.strictEqual(await T.isOrganizer(member([], [PermissionFlagsBits.ManageGuild])), true);
});

test('parseTime: a date in the typed offset, a Discord timestamp, Unix seconds; nonsense is null', () => {
  assert.strictEqual(T.parseTime('2026-11-20 18:00'), Date.UTC(2026, 10, 20, 18, 0));
  assert.strictEqual(T.parseTime('2026-11-20 18:00', -5), Date.UTC(2026, 10, 20, 23, 0));
  assert.strictEqual(T.parseTime('2026-11-20 00:30', 5.5), Date.UTC(2026, 10, 19, 19, 0));
  assert.strictEqual(T.parseTime(' 2026-11-20T18:00 '), Date.UTC(2026, 10, 20, 18, 0));
  assert.strictEqual(T.parseTime('<t:1763661600:F>'), 1763661600000);
  assert.strictEqual(T.parseTime('1763661600'), 1763661600000);
  for (const bad of ['tomorrow', '2026-02-31 10:00', '2026-11-20 25:00', '2026-11-20 10:75', '2026-13-01 10:00', '']) assert.strictEqual(T.parseTime(bad), null, bad);
});

test('createTournament: saved with its defaults; bad input is refused with a reason', async () => {
  const made = await T.createTournament('g1', base, NOW);
  assert.ok(made.ok);
  const t = made.tournament;
  assert.deepStrictEqual([t.substitutes, t.pingMinutes, t.teamChannels, t.minRank, t.maxRank, t.messageId], [0, T.DEFAULT_PING_MINUTES, false, null, null, null]);
  assert.deepStrictEqual(await T.getTournament(t.id), t);
  const why = async (change, guild = 'g1') => (await T.createTournament(guild, { ...base, name: 'Other', ...change }, NOW)).reason;
  assert.strictEqual(await why({ name: '  ' }), 'name');
  assert.strictEqual(await why({ name: 'x'.repeat(T.MAX_NAME + 1) }), 'name');
  assert.strictEqual(await why({ name: 'fairfax cup' }), 'taken');
  assert.strictEqual(await why({ closesAt: null }), 'time');
  assert.strictEqual(await why({ closesAt: NOW }), 'past');
  assert.strictEqual(await why({ minRank: 'Oracle', maxRank: 'Seeker' }), 'ranks');
  assert.ok((await T.createTournament('g2', base, NOW)).ok, 'another server can use the same name');
  for (const reason of ['name', 'taken', 'time', 'past', 'ranks']) assert.ok(T.WHY_NOT[reason]);
  await T.updateTournament(t.id, (saved) => { saved.messageId = 'm1'; });
  assert.strictEqual((await T.getTournament(t.id)).messageId, 'm1');
});

test('the sign-up embed: fields, rank limit wording, the button closes with sign-ups', () => {
  const t = { ...base, id: 'abc', substitutes: 2, teams: { a: {} }, minRank: 'Seeker', maxRank: 'Oracle' };
  const view = T.signupView(t, NOW);
  const embed = view.embeds[0].toJSON();
  const field = (name) => embed.fields.find((f) => f.name === name)?.value;
  assert.strictEqual(embed.title, 'Fairfax Cup');
  assert.strictEqual(field('Format'), 'Single Elimination');
  assert.strictEqual(field('Team Size'), '**6** Players, **2** Substitutes');
  assert.strictEqual(field('Teams'), '**1** / **8**');
  assert.strictEqual(field('Rank Limit'), 'Seeker to Oracle');
  assert.ok(field('Sign-Ups Close').includes(`<t:${Math.floor(t.closesAt / 1000)}:F>`));
  const button = view.components[0].toJSON().components[0];
  assert.deepStrictEqual([button.custom_id, button.label, button.disabled], ['tournament_signup:abc', 'Sign Up', false]);
  const closed = T.signupView(t, t.closesAt);
  assert.strictEqual(closed.components[0].toJSON().components[0].disabled, true);
  assert.strictEqual(closed.embeds[0].toJSON().description, 'Sign-ups are closed.');
  assert.strictEqual(T.teamSizeText({ teamSize: 1, substitutes: 1 }), '**1** Player, **1** Substitute');
  assert.strictEqual(T.teamSizeText({ teamSize: 4, substitutes: 0 }), '**4** Players');
  assert.deepStrictEqual(
    [{ maxRank: 'Oracle' }, { minRank: 'Seeker' }, { minRank: 'Oracle', maxRank: 'Oracle' }, {}].map(T.rankLimitText),
    ['Oracle and Below', 'Seeker and Above', 'Oracle Only', 'None'],
  );
});

// A stand-in for a /tournament create interaction.
function createInteraction(values, { perms = [PermissionFlagsBits.ManageGuild], sendFails = false } = {}) {
  const sent = [];
  const channel = { id: 'here', toString: () => '<#here>', send: async (payload) => { if (sendFails) throw new Error('Missing Access'); sent.push(payload); return { id: 'msg1' }; } };
  const get = (name) => values[name] ?? null;
  const i = {
    ...member([], perms), user: { id: 'u1' }, channel, sent, replies: [],
    options: { getSubcommand: () => 'create', getString: get, getInteger: get, getNumber: get, getBoolean: get, getChannel: (name) => (values[name] ? { id: values[name], toString: () => `<#${values[name]}>` } : null) },
    reply: async (payload) => i.replies.push(payload),
    deferReply: async () => {},
    editReply: async (payload) => i.replies.push(payload),
  };
  return i;
}
const text = (i) => JSON.stringify(i.replies.at(-1).embeds[0].toJSON());
const input = { name: 'Winter Cup', format: 'double', seeding: 'random', 'team-size': 6, 'team-cap': 16, closes: '2099-01-01 18:00', 'review-channel': 'rev' };

test('/tournament create: organizers only; posts the embed and saves its message; a failed post leaves nothing', async () => {
  const stranger = createInteraction(input, { perms: [] });
  await command.execute(stranger);
  assert.ok(text(stranger).includes('Only tournament organizers'));
  assert.strictEqual(stranger.sent.length, 0);

  const ok = createInteraction(input);
  await command.execute(ok);
  assert.strictEqual(ok.sent.length, 1);
  const id = ok.sent[0].components[0].toJSON().components[0].custom_id.split(':')[1];
  const saved = await T.getTournament(id);
  assert.deepStrictEqual([saved.name, saved.format, saved.messageId, saved.signupChannelId, saved.reviewChannelId], ['Winter Cup', 'double', 'msg1', 'here', 'rev']);
  assert.ok(text(ok).includes('Winter Cup') && text(ok).includes('Double Elimination'));

  const badTime = createInteraction({ ...input, name: 'Bad', closes: 'soon' });
  await command.execute(badTime);
  assert.ok(text(badTime).includes('could not read that time'));

  const failed = createInteraction({ ...input, name: 'Spring Cup' }, { sendFails: true });
  await command.execute(failed);
  assert.ok(text(failed).includes('could not post'));
  const again = createInteraction({ ...input, name: 'Spring Cup' });
  await command.execute(again);
  assert.strictEqual(again.sent.length, 1, 'the name is free again after a failed post');
});

test('the commands fit Discord and the Sign Up button answers', async () => {
  assert.doesNotThrow(() => command.data.toJSON());
  assert.doesNotThrow(() => config.data.toJSON());
  const create = command.data.toJSON().options[0].options;
  assert.ok(create.length <= 25);
  assert.ok(create.findIndex((o) => !o.required) > create.findLastIndex((o) => o.required), 'required options come first');
  const replies = [];
  const click = (customId) => ({ isButton: () => true, customId, reply: async (p) => replies.push(p.embeds[0].toJSON().description) });
  assert.ok(routes[0].matches(click('tournament_signup:x')));
  await routes[0].execute(click('tournament_signup:nope'));
  assert.strictEqual(replies.at(-1), 'This tournament is over.');
});

// ---------- step 2: teams ----------
const teamCmd = require('../src/commands/general/team');
const leftEvent = require('../src/events/tournamentMemberLeft');

const fresh = async (change = {}) => (await T.createTournament(`g-${Math.random()}`, { ...base, substitutes: 1, teamSize: 2, teamCap: 2, ...change }, NOW)).tournament;
const LATER = base.closesAt + 1;

test('teams: sign-up, one team per member, names, the waiting list', async () => {
  const t = await fresh();
  const a = await T.addTeam(t.id, { name: '  Night   Shift ', captainId: 'c1' }, NOW);
  assert.ok(a.ok && a.waiting === 0);
  assert.deepStrictEqual([a.team.name, a.team.captainId, a.team.members.c1], ['Night Shift', 'c1', { sub: false, status: 'pending', at: NOW }]);
  const why = async (input, now = NOW) => (await T.addTeam(t.id, input, now)).reason;
  assert.strictEqual(await why({ name: 'Other', captainId: 'c1' }), 'youOnTeam');
  assert.strictEqual(await why({ name: 'night shift', captainId: 'c2' }), 'teamTaken');
  assert.strictEqual(await why({ name: 'x', captainId: 'c2' }), 'teamName');
  assert.strictEqual(await why({ name: 'x'.repeat(T.MAX_TEAM_NAME + 1), captainId: 'c2' }), 'teamName');
  assert.strictEqual(await why({ name: 'Late', captainId: 'c2' }, LATER), 'closed');
  assert.strictEqual((await T.addTeam('nope', { name: 'Ghosts', captainId: 'c2' }, NOW)).reason, 'gone');
  const b = await T.addTeam(t.id, { name: 'Bravo', captainId: 'c2' }, NOW + 1);
  const c = await T.addTeam(t.id, { name: 'Charlie', captainId: 'c3' }, NOW + 2);
  const d = await T.addTeam(t.id, { name: 'Delta', captainId: 'c4' }, NOW + 3);
  assert.deepStrictEqual([b.waiting, c.waiting, d.waiting], [0, 1, 2], 'the cap is 2');
  const gone = await T.disbandTeam(t.id, c.team.id, 'c1');
  assert.strictEqual(gone.reason, 'notCaptain');
  const out = await T.disbandTeam(t.id, a.team.id, 'c1');
  assert.strictEqual(out.promoted.id, c.team.id, 'the first waiting team moves up');
  const now = await T.getTournament(t.id);
  assert.deepStrictEqual([T.waitingPlace(now, c.team.id), T.waitingPlace(now, d.team.id)], [0, 1]);
  assert.strictEqual((await T.disbandTeam(t.id, d.team.id)).promoted, null, 'a waiting team leaving promotes nobody');
  for (const key of Object.keys(T.TEAM_WHY_NOT)) assert.ok(T.TEAM_WHY_NOT[key]);
});

test('invites: Captain only, spots counted with open invites, Accept / Decline, locked once sign-ups close', async () => {
  const t = await fresh();
  const { team } = await T.addTeam(t.id, { name: 'Alpha', captainId: 'c1' }, NOW);
  const other = (await T.addTeam(t.id, { name: 'Bravo', captainId: 'c2' }, NOW + 1)).team;
  const inv = async (by, user, sub, now = NOW) => { const r = await T.invite(t.id, team.id, by, user, sub, now); return r.ok || r.reason; };
  assert.strictEqual(await inv('p1', 'p2', false), 'notCaptain');
  assert.strictEqual(await inv('c1', 'c2', false), 'onTeam');
  assert.strictEqual(await inv('c1', 'p1', false, LATER), 'locked');
  assert.strictEqual(await inv('c1', 'p1', false), true);
  assert.strictEqual(await inv('c1', 'p1', false), 'invited');
  assert.strictEqual(await inv('c1', 'p2', false), 'full', 'the Captain and the open invite fill both Player spots');
  assert.strictEqual(await inv('c1', 'p2', true), true);
  assert.strictEqual(await inv('c1', 'p3', true), 'subsFull');
  assert.strictEqual((await T.answerInvite(t.id, team.id, 'p9', true, NOW)).reason, 'noInvite');
  assert.strictEqual((await T.answerInvite(t.id, team.id, 'p1', true, LATER)).reason, 'closed');
  assert.ok((await T.invite(t.id, other.id, 'c2', 'p1', false, NOW)).ok, 'two teams can invite the same member');
  const yes = await T.answerInvite(t.id, team.id, 'p1', true, NOW + 5);
  assert.deepStrictEqual([yes.accepted, yes.sub, yes.team.members.p1], [true, false, { sub: false, status: 'pending', at: NOW + 5 }]);
  assert.strictEqual((await T.answerInvite(t.id, other.id, 'p1', true, NOW)).reason, 'youOnTeam');
  const nope = await T.answerInvite(t.id, team.id, 'p2', false, LATER);
  assert.ok(nope.ok && !nope.accepted && !nope.team.members.p2 && !nope.team.invites.p2, 'declining works after the lock too');
  assert.strictEqual(await inv('c1', 'p3', true), true, 'the declined spot is free again');
});

test('remove, leave, transfer; a member who leaves the server', async () => {
  const t = await fresh({ teamSize: 3 });
  const { team } = await T.addTeam(t.id, { name: 'Alpha', captainId: 'c1' }, NOW);
  for (const [i, p] of ['p1', 'p2'].entries()) { await T.invite(t.id, team.id, 'c1', p, false, NOW); await T.answerInvite(t.id, team.id, p, true, NOW + 1 + i); }
  await T.invite(t.id, team.id, 'c1', 'p3', true, NOW);
  await T.editTeam(t.id, team.id, (saved) => { saved.invites.p3.messageId = 'm3'; });
  const rm = async (by, user, now = NOW) => { const r = await T.removeMember(t.id, team.id, by, user, now); return r.ok ? r : r.reason; };
  assert.strictEqual(await rm('p1', 'p2'), 'notCaptain');
  assert.strictEqual(await rm('c1', 'c1'), 'self');
  assert.strictEqual(await rm('c1', 'zz'), 'notOnTeam');
  assert.strictEqual(await rm('c1', 'p2', LATER), 'locked');
  const back = await rm('c1', 'p3');
  assert.deepStrictEqual([back.wasInvite, back.messageId], [true, 'm3']);
  assert.strictEqual((await T.leaveTeam(t.id, 'c1')).reason, 'captain');
  assert.strictEqual((await T.leaveTeam(t.id, 'zz')).reason, 'notOnTeam');
  assert.strictEqual((await T.transferTeam(t.id, team.id, 'p1', 'p2')).reason, 'notCaptain');
  assert.strictEqual((await T.transferTeam(t.id, team.id, 'c1', 'zz')).reason, 'notOnTeam');
  assert.strictEqual((await T.transferTeam(t.id, team.id, 'c1', 'p2')).team.captainId, 'p2');
  assert.ok((await T.leaveTeam(t.id, 'c1')).ok, 'the old Captain can leave now');

  // p2 (Captain) leaves the server: p1 has been on the team longest. Then p1 leaves: the team is gone.
  const first = await T.memberLeft(t.guildId, 'p2');
  assert.deepStrictEqual([first.length, first[0].newCaptainId, first[0].disbanded], [1, 'p1', undefined]);
  const last = await T.memberLeft(t.guildId, 'p1');
  assert.strictEqual(last[0].disbanded, true);
  assert.deepStrictEqual((await T.getTournament(t.id)).teams, {});
  assert.deepStrictEqual(await T.memberLeft(t.guildId, 'p1'), []);
});

// A stand-in server: remembers the roles and channels made, deleted and given.
function fakeGuild(id) {
  const log = [];
  let n = 0;
  const thing = (kind, options, extra = {}) => {
    const x = { id: `${kind}${++n}`, name: options.name, options, sent: [], ...extra, delete: async () => { log.push(`delete ${x.id}`); guild.channels.cache.delete(x.id); guild.roles.cache.delete(x.id); } };
    return x;
  };
  const guild = {
    id, log,
    roles: { everyone: { id }, cache: new Map(), create: async (o) => { if (guild.failRoles) throw new Error('Missing Permissions'); const r = thing('role', o); guild.roles.cache.set(r.id, r); return r; } },
    members: { me: { id: 'bot' }, addRole: async ({ user, role }) => log.push(`give ${role} ${user}`), removeRole: async ({ user, role }) => log.push(`take ${role} ${user}`) },
    channels: {
      cache: new Map(),
      create: async (o) => {
        const c = thing('chan', o, { children: { cache: new Map() }, send: async (p) => { c.sent.push(p); return { id: `msg${++n}`, delete: async () => log.push('delete invite') }; }, messages: { fetch: async (mid) => ({ id: mid, edit: async (p) => { c.edited = p; }, delete: async () => log.push(`delete ${mid}`) }) } });
        guild.channels.cache.set(c.id, c);
        if (o.parent) guild.channels.cache.get(o.parent).children.cache.set(c.id, c);
        return c;
      },
    },
  };
  return guild;
}
// A stand-in click, pop-up answer or /team command in `guild` by `userId`.
function act(guild, userId, { customId, name, sub, options = {}, channelId = 'elsewhere' } = {}) {
  const i = {
    guild, guildId: guild.id, channelId, user: { id: userId, toString: () => `<@${userId}>` }, customId, out: [],
    isButton: () => true, isModalSubmit: () => false,
    fields: { getTextInputValue: () => name },
    options: { getSubcommand: () => sub, getString: (k) => options[k] ?? null, getBoolean: (k) => options[k] ?? null, getUser: (k) => (options[k] ? { id: options[k], bot: options[k] === 'robot', toString: () => `<@${options[k]}>` } : null) },
    message: { delete: async () => guild.log.push('delete invite') },
    showModal: async (m) => i.out.push({ modal: m.toJSON() }),
    reply: async (p) => i.out.push(p), deferReply: async () => {}, deferUpdate: async () => {}, editReply: async (p) => i.out.push(p),
  };
  return i;
}
const said = (i) => { const p = i.out.at(-1); return p.embeds?.[0]?.toJSON ? p.embeds[0].toJSON().description ?? p.embeds[0].toJSON().title : JSON.stringify(p); };
const route = (label) => routes.find((r) => r.label === label);

test('in Discord: Sign Up makes the role and channels, an invite is answered, the team is disbanded', async () => {
  const guild = fakeGuild('g-discord');
  await T.setOrganizerRole(guild.id, 'orgRole', true);
  guild.roles.cache.set('orgRole', { id: 'orgRole' });
  const signup = await guild.channels.create({ name: 'sign-ups' });
  const t = (await T.createTournament(guild.id, { ...base, substitutes: 1, teamChannels: true, signupChannelId: signup.id }, NOW)).tournament;
  await T.updateTournament(t.id, (saved) => { saved.closesAt = Date.now() + 3_600_000; saved.messageId = 'embed1'; });

  const open = act(guild, 'cap', { customId: `${T.SIGNUP_ID}:${t.id}` });
  await route('Tournament sign-up').execute(open);
  assert.strictEqual(open.out[0].modal.custom_id, `${T.TEAM_MODAL_ID}:${t.id}`);

  const named = act(guild, 'cap', { customId: `${T.TEAM_MODAL_ID}:${t.id}`, name: 'Night Shift' });
  await route('Tournament team name').execute(named);
  let team = Object.values((await T.getTournament(t.id)).teams)[0];
  assert.ok(team.roleId && team.textId && team.voiceId, 'ids are saved');
  assert.ok(said(named).includes('you are its Captain') && said(named).includes(`<#${team.textId}>`));
  assert.ok(guild.log.includes(`give ${team.roleId} cap`), 'the Captain has the role at once');
  const text = guild.channels.cache.get(team.textId);
  const allowed = text.options.permissionOverwrites.filter((o) => o.allow).map((o) => o.id);
  assert.deepStrictEqual(allowed, ['bot', team.roleId, 'orgRole'], 'the team, the organizers and the bot see the channel');
  assert.strictEqual(text.options.permissionOverwrites[0].id, guild.id, '@everyone is denied');
  assert.ok(text.sent[0].content.includes('/team invite'));
  assert.ok(signup.edited.embeds[0].toJSON().fields.find((f) => f.name === 'Teams').value.startsWith('**1**'), 'the embed counts the team');

  const twice = act(guild, 'cap', { customId: `${T.SIGNUP_ID}:${t.id}` });
  await route('Tournament sign-up').execute(twice);
  assert.strictEqual(said(twice), T.TEAM_WHY_NOT.youOnTeam);

  // /team invite, then the wrong member and the right member press Accept.
  const inv = act(guild, 'cap', { sub: 'invite', options: { member: 'p1' }, channelId: team.textId });
  await teamCmd.execute(inv);
  const post = signup.sent.at(-1);
  const acceptId = post.components[0].toJSON().components[0].custom_id;
  assert.ok(post.content.includes('<@p1>') && post.content.includes('as a Player') && said(inv).includes('is invited'));
  const bot = act(guild, 'cap', { sub: 'invite', options: { member: 'robot' } });
  await teamCmd.execute(bot);
  assert.strictEqual(said(bot), "A bot can't play.");
  const nosy = act(guild, 'p2', { customId: acceptId });
  await route('Tournament invite').execute(nosy);
  assert.strictEqual(said(nosy), 'This invite is not for you.');
  const yes = act(guild, 'p1', { customId: acceptId });
  await route('Tournament invite').execute(yes);
  assert.ok(said(yes).includes('You joined **Night Shift** as a Player'));
  assert.ok(!guild.log.includes(`give ${team.roleId} p1`), 'no role before verification');
  assert.ok(text.sent.at(-1).content.includes('<@p1> accepted'));

  const roster = act(guild, 'p1', { sub: 'roster' });
  await teamCmd.execute(roster);
  const fields = roster.out[0].embeds[0].toJSON().fields;
  assert.strictEqual(fields[0].name, 'Players (2 / 6)');
  assert.ok(fields[0].value.includes('<@cap> (Captain)') && fields[0].value.includes('<@p1>, not verified yet'));

  // Not the Captain: refused. The Captain: a confirm button, then everything is deleted.
  const notCap = act(guild, 'p1', { sub: 'disband' });
  await teamCmd.execute(notCap);
  assert.strictEqual(said(notCap), T.TEAM_WHY_NOT.notCaptain);
  const ask = act(guild, 'cap', { sub: 'disband' });
  await teamCmd.execute(ask);
  const disbandId = ask.out[0].components[0].toJSON().components[0].custom_id;
  const done = act(guild, 'cap', { customId: disbandId });
  await route('Tournament disband').execute(done);
  assert.ok(said(done).includes('is disbanded'));
  for (const id of [team.textId, team.voiceId, team.roleId]) assert.ok(guild.log.includes(`delete ${id}`), `${id} is deleted`);
  assert.deepStrictEqual((await T.getTournament(t.id)).teams, {});
  assert.ok(signup.edited.embeds[0].toJSON().fields.find((f) => f.name === 'Teams').value.startsWith('**0**'));

  // A failed role leaves no team behind. Then a lone Captain leaving the server removes their team.
  guild.failRoles = true;
  const failed = act(guild, 'cap', { customId: `${T.TEAM_MODAL_ID}:${t.id}`, name: 'Second Try' });
  await route('Tournament team name').execute(failed);
  assert.ok(said(failed).includes('was not signed up'));
  assert.deepStrictEqual((await T.getTournament(t.id)).teams, {});
  guild.failRoles = false;
  await route('Tournament team name').execute(act(guild, 'cap', { customId: `${T.TEAM_MODAL_ID}:${t.id}`, name: 'Second Try' }));
  team = Object.values((await T.getTournament(t.id)).teams)[0];
  const lost = act(guild, 'nobody', { sub: 'roster' });
  await teamCmd.execute(lost);
  assert.ok(said(lost).includes('You are not on a team'));
  await leftEvent.execute({ id: 'cap', guild });
  assert.deepStrictEqual((await T.getTournament(t.id)).teams, {});
  assert.ok(guild.log.includes(`delete ${team.roleId}`));
  assert.doesNotThrow(() => teamCmd.data.toJSON());
});
