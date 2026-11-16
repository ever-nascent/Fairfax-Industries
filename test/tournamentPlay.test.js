// Run: node --test. Tournaments after sign-up: verification, the bracket, matches, scrims, ending and cleanup. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const T = require('../src/utils/server/tournaments');
const P = require('../src/utils/server/tournamentPlay');
const V = require('../src/utils/server/verification');
const B = require('../src/utils/server/bracket');
const routes = require('../src/components/tournament');
const tournamentCmd = require('../src/commands/general/tournament');
const teamCmd = require('../src/commands/general/team');
const scrimCmd = require('../src/commands/general/scrim');

const HOUR = 3_600_000;
const route = (label) => routes.find((r) => r.label === label);

// A stand-in server: remembers what was sent, made, deleted and given.
function fakeGuild(id) {
  const log = [];
  const dms = [];
  let n = 0;
  const channel = (cid, name = cid) => {
    const c = {
      id: cid, name, guild: null, sent: [], history: [],
      send: async (p) => { const m = { id: `msg${++n}`, channelId: cid, payload: p, delete: async () => log.push(`delete ${m.id}`) }; c.sent.push(p); c.last = m; return m; },
      messages: { fetch: async (q) => (typeof q === 'string' ? { id: q, edit: async (p) => { c.edited = p; }, delete: async () => log.push(`delete ${q}`) } : c.page(q)) },
      page: (q) => { const rows = q.before ? [] : c.history; const map = new Map(rows.map((m) => [m.id, m])); map.last = () => rows.at(-1); return map; },
      delete: async () => { log.push(`delete ${cid}`); guild.channels.cache.delete(cid); },
    };
    guild.channels.cache.set(cid, c);
    return c;
  };
  const guild = {
    id, name: 'Test Server', log, dms, channel, emojis: { cache: { find: () => undefined } },
    client: { users: { fetch: async (uid) => ({ id: uid, send: async (text) => dms.push([uid, text]) }) } },
    roles: { everyone: { id }, cache: new Map(), create: async (o) => { const r = { id: `role${++n}`, name: o.name, delete: async () => { log.push(`delete ${r.id}`); guild.roles.cache.delete(r.id); } }; guild.roles.cache.set(r.id, r); return r; } },
    members: { me: { id: 'bot' }, addRole: async ({ user, role }) => log.push(`give ${role} ${user}`), removeRole: async ({ user, role }) => log.push(`take ${role} ${user}`) },
    channels: { cache: new Map(), create: async (o) => Object.assign(channel(`chan${++n}`, o.name), { children: { cache: new Map() } }) },
  };
  for (const cid of ['signup', 'review', 'export']) channel(cid);
  return guild;
}

// A stand-in click, pop-up answer or command in `guild` by `userId`.
function act(guild, userId, { customId, fields = {}, sub, options = {}, organizer = false, channelId = 'elsewhere' } = {}) {
  const get = (k) => options[k] ?? null;
  const i = {
    guild, guildId: guild.id, channelId, client: guild.client, customId, out: [],
    user: { id: userId, toString: () => `<@${userId}>` },
    memberPermissions: new PermissionsBitField(organizer ? [PermissionFlagsBits.ManageGuild] : []), member: { roles: { cache: new Map() } },
    isButton: () => true, isModalSubmit: () => false,
    fields: { getTextInputValue: (k) => fields[k] },
    options: {
      getSubcommand: () => sub, getString: get, getInteger: get, getNumber: get, getBoolean: get,
      getUser: (k) => (options[k] ? { id: options[k], bot: false, toString: () => `<@${options[k]}>` } : null),
      getRole: (k) => (options[k] ? { id: options[k], toString: () => `<@&${options[k]}>` } : null),
      getChannel: (k) => (options[k] ? guild.channels.cache.get(options[k]) : null),
    },
    showModal: async (m) => i.out.push({ modal: m.toJSON() }),
    reply: async (p) => i.out.push(p), deferReply: async () => {}, deferUpdate: async () => {}, editReply: async (p) => i.out.push(p), update: async (p) => i.out.push(p),
  };
  return i;
}
const said = (i) => { const p = i.out.at(-1); const e = p.embeds?.[0]?.toJSON?.(); return e ? e.description ?? e.title : p.content ?? JSON.stringify(p); };
const texts = (channel) => channel.sent.map((p) => p.content ?? '').join('\n');

// A tournament in `guild` with one-player teams named after their Captains. approve: every Captain is verified.
async function setup(guild, captains, { change = {}, approve = true } = {}) {
  const now = Date.now();
  const made = await T.createTournament(guild.id, { name: `Cup ${Math.random()}`, format: 'single', seeding: 'staff', teamSize: 1, teamCap: 8, closesAt: now + HOUR, reviewChannelId: 'review', signupChannelId: 'signup', createdBy: 'org', ...change }, now);
  const id = made.tournament.id;
  await T.updateTournament(id, (t) => { t.messageId = 'embed'; });
  for (const [i, cap] of captains.entries()) {
    const { team } = await T.addTeam(id, { name: `Team ${cap}`, captainId: cap }, now + i);
    await T.editTeam(id, team.id, (saved) => {
      Object.assign(saved, { roleId: `role-${cap}`, seed: i + 1 });
      if (approve) Object.assign(saved.members[cap], { status: 'approved', verification: { steamId: `s-${cap}`, badge: 100 - i } });
    });
  }
  return id;
}
const teamId = async (id, cap) => T.teamOf(await T.getTournament(id), cap).id;

// ---------- step 3 ----------

const XML = (id, privacy = 'public') => `<?xml version="1.0"?><profile>\n<steamID64>${id}</steamID64>\n<steamID><![CDATA[Night [Owl]]]></steamID>\n<privacyState>${privacy}</privacyState></profile>`;
function fakeFetch({ privacy = 'public', games = { game_count: 1, games: [{ playtime_forever: 60 * 812 }] }, rank = { rank: 8, subrank: 4, badge: 84 }, missing = false, apiDown = false } = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const body = (data) => ({ ok: true, json: async () => data, text: async () => data });
    if (url.includes('steamcommunity.com')) return body(missing ? '<response><error>The specified profile could not be found.</error></response>' : XML('76561198346079732', privacy));
    if (url.includes('GetOwnedGames')) return body({ response: games });
    if (apiDown) return { ok: false, status: 503 };
    if (url.includes('/players/rank')) return body([rank]);
    if (url.includes('/hero-stats')) return body([{ hero_id: 13, matches_played: 40, wins: 22 }, { hero_id: 6, matches_played: 100, wins: 55 }, { hero_id: 999, matches_played: 1, wins: 0 }]);
    if (url.includes('/assets/heroes')) return body([{ id: 13, name: 'Haze' }, { id: 6, name: 'Abrams' }]);
    throw new Error(`unexpected ${url}`);
  };
  return Object.assign(fetcher, { calls });
}

test('verification lookups: the link, hours, rank, heroes; private profiles, no key, a down API, no such profile', async () => {
  assert.deepStrictEqual(V.parseSteam('https://steamcommunity.com/profiles/76561198346079732/'), { id: '76561198346079732' });
  assert.deepStrictEqual(V.parseSteam(' 76561198346079732 '), { id: '76561198346079732' });
  assert.deepStrictEqual(V.parseSteam('steamcommunity.com/id/Night-Owl_1'), { vanity: 'Night-Owl_1' });
  for (const bad of ['', 'nightowl', 'https://example.com/id/x', '12345']) assert.strictEqual(V.parseSteam(bad), null, bad);
  assert.strictEqual(V.accountIdOf('76561198346079732'), '385814004');

  const fetcher = fakeFetch();
  const r = await V.lookup({ vanity: 'nightowl' }, { fetcher, key: 'SECRET' });
  assert.deepStrictEqual([r.steamId, r.accountId, r.name, r.public, r.hours, r.hoursWhy], ['76561198346079732', '385814004', 'Night [Owl]', true, 812, null]);
  assert.deepStrictEqual([r.rank, r.subrank, r.badge, r.matches, r.wins], ['Oracle', 4, 84, 141, 77]);
  assert.deepStrictEqual(r.heroes.map((h) => [h.name, h.matches]), [['Abrams', 100], ['Haze', 40], ['Hero 999', 1]], 'most played first');
  assert.ok(fetcher.calls[0].startsWith('https://steamcommunity.com/id/nightowl/'));
  assert.deepStrictEqual(V.flagsOf({ minRank: null, maxRank: null }, r), []);
  assert.strictEqual(V.flagsOf({ maxRank: 'Emissary' }, r)[0], 'Rank is above the limit (Emissary).');
  assert.strictEqual(V.flagsOf({ minRank: 'Phantom' }, r)[0], 'Rank is below the limit (Phantom).');
  assert.ok(V.flagsOf({}, r, 'u9')[0].includes('<@u9> already verified with this Steam account'));

  const hidden = await V.lookup({ id: '76561198346079732' }, { fetcher: fakeFetch({ privacy: 'private', games: {}, rank: { rank: 0 } }), key: 'SECRET' });
  assert.deepStrictEqual([hidden.public, hidden.hours, hidden.hoursWhy, hidden.rank], [false, null, 'private', null]);
  assert.deepStrictEqual(V.flagsOf({}, hidden), ['The Steam profile is private.', 'Deadlock hours are hidden. Their game details are private.', 'No rank found for this account.']);
  const noGame = await V.lookup({ id: '76561198346079732' }, { fetcher: fakeFetch({ games: { game_count: 0 } }), key: 'SECRET' });
  assert.strictEqual(noGame.hours, 0, 'a public library without Deadlock is 0 hours');
  const noKey = await V.lookup({ id: '76561198346079732' }, { fetcher: fakeFetch(), key: '' });
  assert.strictEqual(noKey.hoursWhy, 'noKey');
  assert.ok(V.flagsOf({}, noKey)[0].includes('No Steam key'));
  const down = await V.lookup({ id: '76561198346079732' }, { fetcher: fakeFetch({ apiDown: true }), key: 'SECRET' });
  assert.deepStrictEqual(down.failed, ['rank', 'hero stats']);
  assert.strictEqual(V.flagsOf({}, down).length, 2, 'a failed lookup is flagged, not called "no rank"');
  assert.strictEqual(await V.lookup({ vanity: 'nobody' }, { fetcher: fakeFetch({ missing: true }), key: 'SECRET' }), null);
});

const report = (steamId = 's1', extra = {}) => ({ steamId, accountId: '1', name: 'Owl', url: 'https://steamcommunity.com/profiles/1', public: true, hours: 500, hoursWhy: null, rank: 'Oracle', subrank: 2, badge: 82, matches: 200, wins: 110, heroes: [{ name: 'Haze', matches: 80, wins: 50 }], failed: [], ...extra });

test('the review: posted for staff, Approve gives the role, Needs Investigation keeps the buttons, Deny takes the player off', async () => {
  const guild = fakeGuild('g-review');
  const id = await setup(guild, ['cap'], { approve: false, change: { teamSize: 2, maxRank: 'Emissary' } });
  const team = await teamId(id, 'cap');
  await T.invite(id, team, 'cap', 'p1', false);
  await T.answerInvite(id, team, 'p1', true);
  const review = guild.channels.cache.get('review');
  const t = () => T.getTournament(id);

  const sent = await P.submitVerification(guild, await t(), 'cap', report('s1'));
  assert.ok(sent.ok && sent.flags.length === 1, 'Oracle is above the Emissary limit');
  const embed = review.sent[0].embeds[0].toJSON();
  const field = (name) => embed.fields.find((f) => f.name === name)?.value;
  assert.deepStrictEqual([field('Deadlock Hours'), field('Rank'), field('Matches'), field('Win Rate'), field('Main')], ['**500**', 'Oracle 2', '**200**', '**55%**', 'Haze']);
  assert.ok(field('Most Played Heroes').includes('Haze: **80** Matches, **63%** Win Rate'));
  assert.ok(field('Flags').includes('above the limit') && embed.description.includes('Captain'));
  assert.deepStrictEqual(review.sent[0].components[0].toJSON().components.map((b) => b.label), ['Approve', 'Deny', 'Needs Investigation']);
  assert.strictEqual((await P.submitVerification(guild, await t(), 'zz', report())).reason, 'notOnTeam');

  // The same Steam account on a second player is flagged. Sending again replaces the old review.
  const dupe = await P.submitVerification(guild, await t(), 'p1', report('s1'));
  assert.ok(dupe.flags.some((f) => f.includes('<@cap> already verified')));
  const first = (await t()).teams[team].members.p1.verification.messageId;
  await P.submitVerification(guild, await t(), 'p1', report('s2'));
  assert.ok(guild.log.includes(`delete ${first}`), 'the old review is deleted');

  const reviewId = (user, answer) => `${V.REVIEW_ID}:${id}:${team}:${user}:${answer}`;
  const member = act(guild, 'cap', { customId: reviewId('cap', 'a') });
  await route('Tournament review').execute(member);
  assert.strictEqual(said(member), 'Only tournament organizers can review players.');

  const look = act(guild, 'org', { customId: reviewId('cap', 'i'), organizer: true });
  await route('Tournament review').execute(look);
  assert.deepStrictEqual(look.out[0].components[0].toJSON().components.map((b) => b.label), ['Approve', 'Deny'], 'still open after Needs Investigation');
  assert.ok(look.out[0].embeds[0].toJSON().fields.some((f) => f.name === 'Needs Investigation' && f.value.includes('<@org>')));

  const yes = act(guild, 'org', { customId: reviewId('cap', 'a'), organizer: true });
  await route('Tournament review').execute(yes);
  assert.deepStrictEqual(yes.out[0].components, [], 'the buttons go once it is decided');
  assert.ok(guild.log.includes('give role-cap cap'));
  assert.strictEqual((await t()).teams[team].members.cap.status, 'approved');
  assert.ok(guild.dms.at(-1)[1].includes('<@cap> is verified'), 'no team channel: the Captain hears by DM');
  const again = act(guild, 'org', { customId: reviewId('cap', 'a'), organizer: true });
  await route('Tournament review').execute(again);
  assert.strictEqual(said(again), P.WHY_NOT.notPending);

  const ask = act(guild, 'org', { customId: reviewId('p1', 'd'), organizer: true });
  await route('Tournament review').execute(ask);
  assert.strictEqual(ask.out[0].modal.custom_id, `${V.DENY_MODAL_ID}:${id}:${team}:p1`);
  const no = act(guild, 'org', { customId: ask.out[0].modal.custom_id, fields: { reason: 'Smurf account' }, organizer: true });
  await route('Tournament deny reason').execute(no);
  assert.ok(no.out[0].embeds[0].toJSON().fields.some((f) => f.name === 'Denied' && f.value.includes('Smurf account')));
  assert.strictEqual((await t()).teams[team].members.p1, undefined);
  assert.ok(guild.dms.some(([to, text]) => to === 'p1' && text.includes('Smurf account')), 'the player is told why');
  assert.ok(guild.dms.some(([to, text]) => to === 'cap' && text.includes('was denied') && text.includes('Smurf account')), 'so is the Captain');
  assert.ok(guild.log.includes('take role-cap p1'));
});

test('Verify: only for a pending player; a bad link is refused before anything is looked up', async () => {
  const guild = fakeGuild('g-verify');
  const id = await setup(guild, ['cap'], { approve: false });
  const open = act(guild, 'cap', { customId: `${V.VERIFY_ID}:${id}` });
  await route('Tournament verify').execute(open);
  assert.strictEqual(open.out[0].modal.custom_id, `${V.STEAM_MODAL_ID}:${id}`);
  const stranger = act(guild, 'zz', { customId: `${V.VERIFY_ID}:${id}` });
  await route('Tournament verify').execute(stranger);
  assert.strictEqual(said(stranger), 'You are not on a team in this tournament.');
  const bad = act(guild, 'cap', { customId: `${V.STEAM_MODAL_ID}:${id}`, fields: { steam: 'my name is owl' } });
  await route('Tournament Steam link').execute(bad);
  assert.ok(said(bad).includes('not a Steam profile link'));
  const viaCommand = act(guild, 'cap', { sub: 'verify' });
  await teamCmd.execute(viaCommand);
  assert.ok(viaCommand.out[0].modal, '/team verify opens the same pop-up');
});

// ---------- step 4 ----------

test('the bracket: needs closed sign-ups and 2 ready teams; unready teams are left out; the three seedings', async () => {
  const guild = fakeGuild('g-start');
  const id = await setup(guild, ['a', 'b', 'c', 'd']);
  await T.editTeam(id, await teamId(id, 'd'), (team) => { team.members.d.status = 'pending'; });
  assert.strictEqual((await P.start(id)).reason, 'open');
  const view = P.teamsView(await T.getTournament(id)).toJSON().description;
  assert.ok(view.includes('Team a (<@a>): Ready, Seed **1**') && view.includes('Team d (<@d>): **1** not verified'));
  assert.ok((await P.closeNow(id)).ok);
  assert.strictEqual((await P.closeNow(id)).reason, 'closed');
  assert.strictEqual((await T.addTeam(id, { name: 'Late', captainId: 'z' })).reason, 'closed');

  await P.setSeed(id, await teamId(id, 'c'), 1);
  await P.setSeed(id, await teamId(id, 'a'), 3);
  const started = await P.start(id, { bestOf: 3 });
  assert.ok(started.ok);
  const names = started.t.bracket.seeds.map((x) => started.t.teams[x].name);
  assert.deepStrictEqual(names, ['Team c', 'Team b', 'Team a'], 'staff seeds, sign-up order on a tie');
  assert.deepStrictEqual(started.left.map((x) => x.name), ['Team d']);
  assert.deepStrictEqual([started.t.bestOf, (await P.start(id)).reason, (await P.setSeed(id, 'x', 1)).reason], [3, 'startedAlready', 'startedAlready']);
  assert.strictEqual((await T.disbandTeam(id, await teamId(id, 'a'), 'a')).reason, 'started', 'a team in the bracket stays');

  const t = await T.getTournament(id);
  const teams = Object.values(t.teams).slice(0, 3);
  assert.deepStrictEqual(P.seedTeams({ ...t, seeding: 'rank' }, teams).map((x) => t.teams[x].name), ['Team a', 'Team b', 'Team c'], 'highest average badge first');
  assert.deepStrictEqual(P.seedTeams({ ...t, seeding: 'random' }, teams, () => 0).length, 3);

  const few = await setup(guild, ['solo']);
  await P.closeNow(few);
  assert.strictEqual((await P.start(few)).reason, 'tooFew');

  // /tournament start tells every team its first match or its bye, and the team left out.
  const id2 = await setup(guild, ['e', 'f', 'g', 'h']);
  await T.editTeam(id2, await teamId(id2, 'h'), (team) => { team.members.h.status = 'pending'; });
  await P.closeNow(id2);
  const go = act(guild, 'org', { sub: 'start', options: { tournament: id2 }, organizer: true });
  await tournamentCmd.execute(go);
  const all = texts(guild.channels.cache.get('signup'));
  assert.ok(said(go).includes('**3** teams') && said(go).includes('Left out: **Team h**'));
  assert.ok(all.includes('**Up Next: Match R1-2 (Semifinal)**') && all.includes('**Team e** has a bye') && all.includes('**Team h** is not in it'));
  const member = act(guild, 'e', { sub: 'start', options: { tournament: id2 } });
  await tournamentCmd.execute(member);
  assert.strictEqual(said(member), 'Only tournament organizers can use this.');
  const anyone = act(guild, 'e', { sub: 'bracket', options: { tournament: id2 } });
  await tournamentCmd.execute(anyone);
  assert.ok(anyone.out[0].embeds[0].toJSON().fields[0].value.includes('`R1-2` Team f vs Team g, no time yet'));
});

// ---------- step 5 ----------

test('matches: a time, the ping with Check In, the no-show flag, a reported result confirmed and disputed, an organizer result', async () => {
  const guild = fakeGuild('g-match');
  const id = await setup(guild, ['a', 'b', 'c', 'd'], { change: { pingMinutes: 30 } });
  await T.setOrganizerRole(guild.id, 'orgRole', true);
  guild.roles.cache.set('orgRole', { id: 'orgRole' });
  await P.closeNow(id);
  await P.start(id, { bestOf: 3 }); // R1-1: a vs d, R1-2: b vs c
  const [a, b, c, d] = await Promise.all(['a', 'b', 'c', 'd'].map((x) => teamId(id, x)));
  const signup = guild.channels.cache.get('signup');
  const review = guild.channels.cache.get('review');
  const now = Date.now();

  assert.strictEqual((await P.schedule(id, 'R9-9', now + HOUR)).reason, 'noMatch');
  assert.strictEqual((await P.schedule(id, 'R1-1', null)).reason, 'time');
  assert.strictEqual((await P.schedule(id, 'R1-1', now - 1)).reason, 'past');
  assert.ok((await P.schedule(id, 'R1-1', now + HOUR, 1)).ok);
  assert.strictEqual((await P.schedule(id, 'R2-1', now + 2 * HOUR)).state, 'waiting', 'a later match can get its time early');

  await P.sweep(guild, id, now);
  assert.ok(!texts(signup).includes('Check In'), 'not yet: the ping is 30 minutes before');
  await P.sweep(guild, id, now + HOUR - 29 * 60_000);
  const pings = signup.sent.filter((p) => p.content?.includes('press **Check In**'));
  assert.strictEqual(pings.length, 2);
  assert.ok(pings[0].content.startsWith('<@&role-a>') && pings[0].allowedMentions.roles.includes('role-a'), 'the team role is pinged');
  await P.sweep(guild, id, now + HOUR - 28 * 60_000);
  assert.strictEqual(signup.sent.filter((p) => p.content?.includes('press **Check In**')).length, 2, 'pinged once');

  const checkId = pings[0].components[0].toJSON().components[0].custom_id;
  const wrong = act(guild, 'd', { customId: checkId });
  await route('Tournament check-in').execute(wrong);
  assert.strictEqual(said(wrong), T.TEAM_WHY_NOT.notCaptain);
  const inA = act(guild, 'a', { customId: checkId });
  await route('Tournament check-in').execute(inA);
  assert.ok(said(inA).includes('**Team a** is checked in') && !said(inA).includes('Both teams'));
  await P.sweep(guild, id, now + HOUR + 1);
  const flag = review.sent.find((p) => p.content?.includes('did not Check In'));
  assert.ok(flag.content.includes('**Team d**') && !flag.content.includes('**Team a**') && flag.content.startsWith('<@&orgRole>'));
  await P.sweep(guild, id, now + HOUR + 2);
  assert.strictEqual(review.sent.filter((p) => p.content?.includes('did not Check In')).length, 1, 'flagged once');

  // Reports: the score has to be a win that fits the match length (R1-1 is a best of 1, R1-2 a best of 3).
  assert.deepStrictEqual([P.parseScore('2-1', 3), P.parseScore(' 2 : 0 ', 3), P.parseScore('1-2', 3), P.parseScore('3-0', 3), P.parseScore('1-0', 1), P.parseScore('won', 3)], [[2, 1], [2, 0], null, null, [1, 0], null]);
  const rep = async (user, score, match) => { const i = act(guild, user, { sub: 'report', options: { score, match } }); await teamCmd.execute(i); return i; };
  assert.strictEqual(said(await rep('b', '2-3')), P.WHY_NOT.score);
  const reported = await rep('b', '2-1');
  assert.ok(said(reported).includes("**Team c**'s Captain confirms"));
  const ask = signup.sent.at(-2);
  assert.ok(ask.content.includes('<@c>, **Team b** reported a **2-1** win over **Team c**'));
  assert.strictEqual(said(await rep('b', '2-0')), P.WHY_NOT.reported);
  const [confirmId, disputeId] = ask.components[0].toJSON().components.map((x) => x.custom_id);
  const own = act(guild, 'b', { customId: confirmId });
  await route('Tournament result answer').execute(own);
  assert.strictEqual(said(own), P.WHY_NOT.ownReport);
  const outsider = act(guild, 'a', { customId: confirmId });
  await route('Tournament result answer').execute(outsider);
  assert.strictEqual(said(outsider), T.TEAM_WHY_NOT.notCaptain);
  const dispute = act(guild, 'c', { customId: disputeId });
  await route('Tournament result answer').execute(dispute);
  assert.ok(said(dispute).includes('is disputed'));
  assert.ok(review.sent.at(-1).content.includes('is disputed by <@c>'));
  assert.strictEqual(B.resolve((await T.getTournament(id)).bracket)['R1-2'].state, 'ready', 'a disputed result does not count');

  // The organizer settles it for c; then a wins by forfeit; the final is announced to both.
  const settle = act(guild, 'org', { sub: 'result', options: { tournament: id, match: 'r1-2', winner: c, score: '2-1' }, organizer: true });
  await tournamentCmd.execute(settle);
  assert.ok(said(settle).includes('**Team c** won'));
  const notIn = act(guild, 'org', { sub: 'result', options: { tournament: id, match: 'R1-1', winner: b }, organizer: true });
  await tournamentCmd.execute(notIn);
  assert.strictEqual(said(notIn), P.WHY_NOT.notInMatch);
  const forfeit = act(guild, 'org', { sub: 'result', options: { tournament: id, match: 'R1-1', winner: a }, organizer: true });
  await tournamentCmd.execute(forfeit);
  assert.ok(texts(signup).includes('**Match R1-1 (Semifinal):** **Team a** beat **Team d**.'));
  assert.strictEqual(signup.sent.filter((p) => p.content?.startsWith('**Up Next: Match R2-1 (Final)**')).length, 2);

  // The final: a reports, c confirms. The winner is announced and the organizers are told to end it.
  await rep('a', '2-0');
  const finalAsk = signup.sent.at(-2);
  const confirm = act(guild, 'c', { customId: finalAsk.components[0].toJSON().components[0].custom_id });
  await route('Tournament result answer').execute(confirm);
  assert.ok(said(confirm).includes('is confirmed'));
  assert.ok(texts(signup).includes('**Team a** won **Cup'));
  assert.ok(review.sent.at(-1).content.includes('End it with `/tournament end`'));
  assert.strictEqual(said(await rep('a', '2-0')), P.WHY_NOT.noOpenMatch);
  assert.ok(P.bracketView(await T.getTournament(id)).toJSON().fields.at(-1).value.includes('Team a'));
  void d;
});

// ---------- step 6 ----------

test('scrims: a challenge is answered by that Captain, an open one by any other Captain; both teams are pinged before it', async () => {
  const guild = fakeGuild('g-scrim');
  const id = await setup(guild, ['a', 'b', 'c']);
  const [a, b] = await Promise.all(['a', 'b'].map((x) => teamId(id, x)));
  const signup = guild.channels.cache.get('signup');
  const now = Date.now();
  const run = async (user, sub, options) => { const i = act(guild, user, { sub, options }); await scrimCmd.execute(i); return i; };

  assert.strictEqual(said(await run('zz', 'open', { time: '2099-01-01 10:00' })), 'You are not on a team. Press **Sign Up** on a tournament to make one.');
  assert.strictEqual(said(await run('a', 'challenge', { team: a, time: '2099-01-01 10:00' })), P.WHY_NOT.sameTeam);
  assert.strictEqual(said(await run('a', 'challenge', { team: b, time: 'whenever' })), P.WHY_NOT.time);
  assert.strictEqual(said(await run('a', 'challenge', { team: b, time: '2001-01-01 10:00' })), P.WHY_NOT.past);
  assert.ok(said(await run('a', 'challenge', { team: 'team b', time: '2099-01-01 10:00' })).includes('**Team b** was asked'));
  assert.ok(signup.sent.at(-1).content.startsWith('<@b>, **Team a** challenges **Team b**'));
  assert.strictEqual(said(await run('a', 'open', { time: '2099-01-01 10:00' })), P.WHY_NOT.scrimOpen);
  const [acceptId, declineId] = signup.sent.at(-1).components[0].toJSON().components.map((x) => x.custom_id);
  const nosy = act(guild, 'c', { customId: acceptId });
  await route('Tournament scrim answer').execute(nosy);
  assert.strictEqual(said(nosy), T.TEAM_WHY_NOT.notCaptain);
  const declined = act(guild, 'b', { customId: declineId });
  await route('Tournament scrim answer').execute(declined);
  assert.ok(said(declined).includes("**Team b** declined **Team a**'s scrim."));
  assert.deepStrictEqual((await T.getTournament(id)).scrims, {});

  // An open scrim: its own Captain can't take it, another one can. The ping comes 30 minutes before; it is forgotten 3 hours after.
  const made = await P.scrimNew(id, 'a', null, now + HOUR, now);
  const view = P.scrimView(made.t, made.scrim);
  assert.deepStrictEqual(view.components[0].toJSON().components.map((x) => x.label), ['Accept']);
  const openId = view.components[0].toJSON().components[0].custom_id;
  const self = act(guild, 'a', { customId: openId });
  await route('Tournament scrim answer').execute(self);
  assert.strictEqual(said(self), P.WHY_NOT.ownScrim);
  const taken = act(guild, 'c', { customId: openId });
  await route('Tournament scrim answer').execute(taken);
  assert.ok(said(taken).includes('**Team a** and **Team c** scrim'));
  const late = act(guild, 'b', { customId: openId });
  await route('Tournament scrim answer').execute(late);
  assert.strictEqual(said(late), P.WHY_NOT.noScrim);
  await P.sweep(guild, id, now + HOUR - 31 * 60_000);
  assert.ok(!texts(signup).includes('starts <t:'));
  await P.sweep(guild, id, now + HOUR - 29 * 60_000);
  await P.sweep(guild, id, now + HOUR - 28 * 60_000);
  assert.strictEqual(signup.sent.filter((p) => p.content?.includes('Your scrim against') && p.content.includes('starts <t:')).length, 2, 'each team once');
  await P.sweep(guild, id, now + 5 * HOUR);
  assert.deepStrictEqual((await T.getTournament(id)).scrims, {});
});

// ---------- step 7 ----------

test('ending: places are saved, the winner role is given, history lists it; cleanup exports the chats and deletes everything', async () => {
  const guild = fakeGuild('g-end');
  const id = await setup(guild, ['a', 'b', 'c'], { change: { name: 'Winter Cup' } });
  for (const cap of ['a', 'b', 'c']) {
    const text = guild.channel(`text-${cap}`);
    text.history = [
      { id: '2', createdTimestamp: Date.UTC(2026, 10, 15, 18, 5), author: { username: 'bob' }, member: { displayName: 'Bob' }, cleanContent: 'gg', embeds: [], attachments: new Map() },
      { id: '1', createdTimestamp: Date.UTC(2026, 10, 15, 18, 0), author: { username: 'ann' }, cleanContent: 'ready?', embeds: [{ title: 'Up Next', fields: [] }], attachments: new Map([['f', { url: 'https://cdn/x.png' }]]) },
    ];
    await T.editTeam(id, await teamId(id, cap), (team) => { team.textId = `text-${cap}`; });
  }
  await T.updateTournament(id, (t) => { t.categoryIds = ['cat']; });
  guild.channel('cat');
  await P.closeNow(id);
  await P.start(id);
  const [a, b] = await Promise.all(['a', 'b'].map((x) => teamId(id, x)));

  assert.strictEqual((await P.cleanup(guild, id)).reason, 'notEnded');
  await P.organizerResult(id, 'R1-2', b, null);
  await P.organizerResult(id, 'R2-1', a, null);
  const end = act(guild, 'org', { sub: 'end', options: { tournament: id, 'winner-role': 'champ' }, organizer: true });
  await tournamentCmd.execute(end);
  assert.ok(said(end).includes('**Team a** won') && said(end).includes('<@&champ> was given to **1** of its players'));
  assert.ok(guild.log.includes('give champ a'));
  const t = await T.getTournament(id);
  assert.deepStrictEqual([t.champion, t.standings], ['Team a', [{ place: 1, teams: ['Team a'] }, { place: 2, teams: ['Team b'] }, { place: 3, teams: ['Team c'] }]]);
  assert.strictEqual(guild.channels.cache.get('signup').edited.embeds[0].toJSON().description, 'This tournament is over.');
  assert.strictEqual((await P.end(guild, id)).reason, 'gone', 'only once');
  assert.deepStrictEqual(await T.running(guild.id).then((list) => list.filter((x) => x.id === id)), []);

  const list = act(guild, 'anyone', { sub: 'history' });
  await tournamentCmd.execute(list);
  assert.ok(said(list).includes('**Winter Cup**') && said(list).includes('won by **Team a**'));
  const one = act(guild, 'anyone', { sub: 'history', options: { tournament: 'winter cup' } });
  await tournamentCmd.execute(one);
  assert.ok(said(one).includes('**1.** Team a') && said(one).includes('**3.** Team c'));

  const chat = await P.exportText(guild.channels.cache.get('text-a'));
  assert.deepStrictEqual([chat.count, chat.cut], [2, false]);
  assert.strictEqual(chat.text, '[2026-11-15 18:00 UTC] ann: ready?\nUp Next\n[File: https://cdn/x.png]\n[2026-11-15 18:05 UTC] Bob: gg');
  assert.strictEqual((await P.exportText(guild.channels.cache.get('text-a'), 40)).cut, true);

  const ask = act(guild, 'org', { sub: 'cleanup', options: { tournament: id, 'export-channel': 'export' }, organizer: true });
  await tournamentCmd.execute(ask);
  assert.ok(said(ask).includes('all **3** teams') && said(ask).includes('posted in'));
  const cleanupId = ask.out[0].components[0].toJSON().components[0].custom_id;
  const other = act(guild, 'org2', { customId: cleanupId, organizer: true });
  await route('Tournament cleanup').execute(other);
  assert.strictEqual(said(other), 'Only the organizer who ran the command can press this.');
  const done = act(guild, 'org', { customId: cleanupId, organizer: true });
  await route('Tournament cleanup').execute(done);
  assert.ok(said(done).includes('**3** teams are deleted') && said(done).includes('**3** team chats were saved'));
  const files = guild.channels.cache.get('export').sent;
  assert.deepStrictEqual(files.map((p) => p.files[0].name), ['Team_a.txt', 'Team_b.txt', 'Team_c.txt']);
  assert.ok(files[0].files[0].attachment.toString().includes('Bob: gg'));
  for (const gone of ['text-a', 'text-b', 'text-c', 'cat']) assert.ok(guild.log.includes(`delete ${gone}`), `${gone} is deleted`);
  assert.strictEqual((await P.cleanup(guild, id)).reason, 'cleaned');
  assert.strictEqual((await T.getTournament(id)).standings.length, 3, 'the history stays');

  // Ending before any bracket: no winner, and it still shows in the history.
  const early = await setup(guild, ['x']);
  const ended = await P.end(guild, early, 'champ');
  assert.deepStrictEqual([ended.champion, ended.given, ended.t.standings], [null, 0, []]);
});

test('every command fits Discord: required options first, descriptions short enough', () => {
  for (const command of [tournamentCmd, teamCmd, scrimCmd]) {
    const json = command.data.toJSON();
    assert.ok(json.options.length <= 25);
    for (const sub of json.options) {
      assert.ok(sub.description.length <= 100, `${json.name} ${sub.name}`);
      const opts = sub.options ?? [];
      assert.ok(opts.length <= 25);
      assert.ok(opts.findLastIndex((o) => o.required) < (opts.findIndex((o) => !o.required) + 1 || Infinity), `/${json.name} ${sub.name}: required options come first`);
      for (const o of opts) assert.ok(o.description.length <= 100, `/${json.name} ${sub.name} ${o.name}`);
    }
  }
  for (const key of Object.keys(P.WHY_NOT)) assert.ok(P.WHY_NOT[key], key);
});
