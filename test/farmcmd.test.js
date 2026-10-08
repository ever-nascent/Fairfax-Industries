// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
const test = require('node:test');
const assert = require('node:assert');
const { getUser, changeSouls } = require('../src/utils/xp');
const { getFarmUser, chooseHero, play, simulate, cooldownLeft } = require('../src/utils/farm/play');
const views = require('../src/utils/farm/views');
const routes = require('../src/components/farm');
const base = require('../src/commands/farm/base');
const jungle = require('../src/commands/farm/jungle');
const lane = require('../src/commands/farm/lane');
const siegeCommand = require('../src/commands/farm/siege');
const { roam } = require('../src/utils/farm/roam');
const { buildHero } = require('../src/utils/farm/hero');

const guild = { emojis: { cache: { find: () => undefined } } };
// the server's bar emojis, as long as the real ones: <:streak_mid_on:1554307832742940715> (a bar of them is about 380 characters)
const STREAK = ['left', 'mid', 'right'].flatMap((p) => ['on', 'off'].map((s) => `streak_${p}_${s}`));
require('../src/utils/trivia').loadStreakEmojis({
  emojis: { cache: { find: (fn) => STREAK.map((name) => ({ name, toString: () => `<:${name}:1554307832742940715>` })).find(fn) } },
});
const member = (id) => ({ id, guild, toString: () => `<@${id}>` });
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const KEYS = ['small-camp', 'medium-camp', 'large-camp', 'guardian', 'walker', 'mid-boss', 'siege'];

// Discord's limits on one message
function checkLimits(payload, what) {
  for (const e of payload.embeds ?? []) {
    const j = e.toJSON();
    const size = (j.title?.length ?? 0) + (j.description?.length ?? 0) + (j.footer?.text.length ?? 0) + (j.author?.name.length ?? 0) +
      (j.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
    assert.ok(j.title?.length <= 256 && (j.description?.length ?? 0) <= 4096, `${what}: title or description`);
    assert.ok((j.fields ?? []).length <= 25, `${what}: field count`);
    for (const f of j.fields ?? []) assert.ok(f.name.length > 0 && f.name.length <= 256 && f.value.length > 0 && f.value.length <= 1024, `${what}: field "${f.name}"`);
    assert.ok(size <= 6000, `${what}: embed is ${size} characters`);
  }
  const rows = (payload.components ?? []).map((r) => r.toJSON());
  assert.ok(rows.length <= 5, `${what}: rows`);
  for (const r of rows) {
    for (const c of r.components) {
      assert.ok(c.custom_id.length <= 100, `${what}: custom id`);
      for (const o of c.options ?? []) assert.ok(o.label.length <= 100 && (o.description ?? '').length <= 100, `${what}: option`);
      assert.ok((c.options ?? []).length <= 25);
    }
  }
  const names = (payload.files ?? []).map((f) => f.name);
  for (const e of payload.embeds ?? []) {
    const j = e.toJSON();
    for (const url of [j.thumbnail?.url, j.author?.icon_url, j.image?.url].filter(Boolean)) assert.ok(names.includes(url.replace('attachment://', '')), `${what}: ${url} is attached`);
  }
}

// a fake component / command interaction that records what the bot sends
function fake(userId, customId = '', extra = {}) {
  const log = [];
  return {
    customId, user: { id: userId }, member: member(userId), values: [], log,
    deferUpdate: async () => log.push(['deferUpdate']), deferReply: async () => log.push(['deferReply']),
    editReply: async (p) => { log.push(['editReply', p]); return p; }, followUp: async (p) => log.push(['followUp', p]),
    reply: async (p) => log.push(['reply', p]), ...extra,
  };
}
const route = (label) => routes.find((r) => r.label === label);
const homeCommand = (i) => base.execute(i);
const sub = (name, option) => ({ options: { getSubcommand: () => name, getInteger: () => option, getString: () => option } });

test('every farm screen fits the Discord limits and attaches what it points to', async () => {
  const record = { hero: 'Haze', cooldowns: { 'large-camp': Date.now() + 90 * 60000 }, rejuvs: 1, buffs: {} };
  checkLimits(await views.pickView(member('1')), 'pick list');
  checkLimits(await views.pickView(member('1'), 'Haze'), 'pick preview');
  checkLimits(await views.homeView(member('1'), record), 'home');
  for (const key of KEYS) checkLimits(await views.targetView(member('1'), key, record), `details ${key}`);
  for (const key of KEYS) {
    const run = simulate('Haze', key, { rng: seeded(5), rejuvs: 1 });
    for (const frame of run.frames) checkLimits(views.fightView(run, frame), `live ${key}`);
    checkLimits(views.resultView(run), `result ${key}`);
  }
  for (let s = 1; s <= 30; s++) checkLimits(await views.roamView({ ...roam('2026-10-01', seeded(s)), hero: 'Haze' }), 'roam');
});

test('a defeated enemy shows "Down" in red (an ansi code block)', () => {
  const run = simulate('Haze', 'small-camp', { rng: seeded(7) });
  const frame = run.frames.find((f) => f.enemies.some((e) => e.hp <= 0));
  assert.ok(frame, 'some frame has a downed enemy');
  const values = views.fightView(run, frame).embeds[0].toJSON().fields.map((f) => f.value);
  assert.ok(values.includes('```ansi\n\u001b[31mDown\u001b[0m\n```'));
});

test('the commands: /base, /jungle (camp, roam, midboss), /lane (guardian, walker), /siege', async () => {
  const names = (c) => c.data.toJSON().options?.map((o) => o.name);
  assert.deepStrictEqual([base, jungle, lane, siegeCommand].map((c) => c.data.name), ['base', 'jungle', 'lane', 'siege']);
  assert.deepStrictEqual(names(jungle), ['camp', 'roam', 'midboss']);
  assert.deepStrictEqual(names(lane), ['guardian', 'walker', 'wave']);
  assert.strictEqual(await (async () => { const i = fake('cmd0'); await chooseHero('cmd0', 'Haze'); await lane.execute({ ...i, ...sub('wave', 'park') }); return i.log.at(-1)[1].embeds[0].toJSON().title; })(), 'Park Waves');
  assert.deepStrictEqual(jungle.data.toJSON().options[0].options[0].choices.map((c) => c.value), [1, 2, 3]);
  const id = 'cmd1';
  const blank = fake(id);
  await lane.execute({ ...blank, ...sub('walker') });
  assert.match(blank.log.at(-1)[1].embeds[0].toJSON().title, /Pick Your Hero/, 'no hero yet: pick one first');
  await chooseHero(id, 'Haze');
  const open = async (c, s, option) => { const i = fake(id); await c.execute({ ...i, ...sub(s, option) }); return i.log.at(-1)[1]; };
  const title = async (c, s, option) => (await open(c, s, option)).embeds[0].toJSON().title;
  assert.strictEqual(await title(jungle, 'camp', 1), 'Tier 1 Camp');
  assert.strictEqual(await title(jungle, 'camp', 2), 'Tier 2 Camp');
  assert.strictEqual(await title(jungle, 'camp', 3), 'Tier 3 Camp');
  assert.strictEqual(await title(jungle, 'midboss'), 'Mid-Boss');
  assert.strictEqual(await title(lane, 'guardian', 'broadway'), 'Broadway Guardian');
  assert.strictEqual(await title(lane, 'walker', 'park'), 'Park Walker');
  assert.deepStrictEqual(lane.data.toJSON().options[0].options[0].choices.map((c) => c.value), ['york', 'broadway', 'park']);
  assert.strictEqual(await title(siegeCommand), 'Base Siege');
  const details = await open(lane, 'walker', 'york');
  assert.deepStrictEqual(details.components.at(-1).toJSON().components.map((b) => [b.label, !!b.disabled]), [['Send', true], ['Back', false]], "locked: York's Guardian is still up");
  assert.strictEqual(details.components.at(-1).toJSON().components[0].custom_id, `farm_send:${id}:walker:york`);
  assert.match(details.embeds[0].toJSON().footer.text, /^Locked: York's Guardian Must Fall First\./);
});

test('pick a hero, select it, then the home screen; the pick sticks', async () => {
  const id = 'p1';
  const first = fake(id);
  await homeCommand(first);
  assert.match(first.log.at(-1)[1].embeds[0].toJSON().title, /Pick Your Hero/);
  const preview = fake(id, `farm_hero:${id}`, { values: ['Haze'] });
  await route('Hero select').execute(preview);
  const p = preview.log.at(-1)[1];
  assert.match(p.embeds[0].toJSON().description, /Select Haze as your Hero\?/);
  assert.strictEqual(p.components.at(-1).toJSON().components[0].label, 'Select');
  assert.strictEqual((await getFarmUser(id)).hero, null, 'nothing is saved before Select');
  const pick = fake(id, `farm_pick:${id}:Haze`);
  await route('Hero Select button').execute(pick);
  assert.strictEqual((await getFarmUser(id)).hero, 'Haze');
  assert.strictEqual(pick.log.at(-1)[1].embeds[0].toJSON().title, 'Haze  -  Level 0');
  assert.strictEqual(await chooseHero(id, 'Haze'), false); // already picked
  assert.strictEqual(await chooseHero('p2', 'Nobody'), false); // not on the roster, so not pickable (every hero has its ability logic now)
  const again = fake(id);
  await homeCommand(again);
  const home = again.log.at(-1)[1].embeds[0].toJSON();
  assert.strictEqual(home.title, 'Haze  -  Level 0');
  assert.ok(!home.description && !home.footer, 'no text in the home embed but the stats');
  assert.deepStrictEqual(home.fields.map((f) => f.name), ['Health', 'Bullet Damage', 'Fire Rate', 'Ammo', 'Spirit Power', 'Cooldown Reduction', 'Rejuvs']);
});

test("only the owner can use a member's buttons", async () => {
  const other = fake('intruder', 'farm_back:owner');
  await route('Back button').execute(other);
  assert.strictEqual(other.log[0][0], 'reply');
  assert.match(other.log[0][1].content, /not your farm/);
});

test('Send plays the fight as a live message, pays once, and the cooldown blocks a second try', async () => {
  const id = 'f1';
  await chooseHero(id, 'Haze');
  const send = fake(id, `farm_send:${id}:small-camp`);
  await route('Send button').execute(send);
  const edits = send.log.filter((l) => l[0] === 'editReply').map((l) => l[1]);
  assert.ok(edits.length >= 3, 'frames, then the result');
  assert.match(edits[0].embeds[0].toJSON().description, /is fighting/);
  const result = edits.at(-1).embeds[0].toJSON();
  assert.match(result.title, /Cleared|Defeated/);
  if (result.title.endsWith('Cleared')) assert.ok((await getUser(id)).souls > 0);
  assert.ok(cooldownLeft(await getFarmUser(id), 'small-camp') > 59 * 60000, 'the cooldown started');
  const before = (await getUser(id)).souls;
  const second = fake(id, `farm_send:${id}:small-camp`);
  await route('Send button').execute(second);
  assert.strictEqual((await getUser(id)).souls, before, 'a second Send pays nothing');
  assert.ok(second.log.some((l) => l[0] === 'followUp' && /isn't ready/.test(l[1].content)));
});

test('a double click on Send can only claim the cooldown once', async () => {
  const id = 'd1';
  await chooseHero(id, 'Haze');
  const [a, b] = await Promise.all([play(id, 'small-camp', { rng: seeded(3) }), play(id, 'small-camp', { rng: seeded(3) })]);
  assert.strictEqual([a, b].filter((r) => r.run).length, 1);
  assert.strictEqual([a, b].filter((r) => r.error === 'cooldown').length, 1);
});

test('a failed attempt pays nothing and still uses the cooldown', async () => {
  const id = 'l1';
  await chooseHero(id, 'Haze');
  const r = await play(id, 'mid-boss', { rng: seeded(2) });
  assert.ok(r.run && !r.run.won && r.run.souls === 0);
  assert.strictEqual((await getUser(id)).souls, 0);
  assert.ok(cooldownLeft(await getFarmUser(id), 'mid-boss') > 11 * 3600 * 1000);
});

test('Rejuvs: only the siege uses them, and a spent Rejuv shows in the battle log', () => {
  assert.strictEqual(simulate('Haze', 'mid-boss', { rejuvs: 3 }).rejuvsUsed, 0, 'a held Rejuv does nothing against the Mid-Boss');
  const siege = simulate('Haze', 'siege', { rejuvs: 1 });
  assert.strictEqual(siege.rejuvsUsed, 1);
  assert.ok(siege.frames.length >= 2 && siege.log.some(([, t]) => /Rejuvenator has expired/.test(t)));
});

test('roam: a haul with buffs that stay on the hero, once every 30 minutes', async () => {
  const id = 'roam1';
  await chooseHero(id, 'Haze');
  const now = Date.parse('2026-10-01T12:00:00Z');
  const first = await play(id, 'roam', { now, rng: seeded(9) });
  assert.ok(first.haul && first.haul.hero === 'Haze');
  const record = await getFarmUser(id);
  assert.strictEqual(Object.values(record.buffs).reduce((s, n) => s + n, 0), first.haul.buffs.length);
  assert.strictEqual((await getUser(id)).souls, first.haul.souls);
  assert.strictEqual((await play(id, 'roam', { now: now + 10 * 60000 })).error, 'cooldown');
  assert.ok(!(await play(id, 'roam', { now: now + 31 * 60000, rng: seeded(10) })).error);
  const cmd = fake('roam2');
  await jungle.execute({ ...cmd, ...sub('roam') });
  assert.match(cmd.log.at(-1)[1].embeds[0].toJSON().title, /Pick Your Hero/, 'no hero yet: pick one first');
});

test('a roam is one drawn card, with the buffs and bridge buff written under it', async () => {
  const base = { finds: { crate: 1, toughCrate: 0, statue: 2, sinner: 0 }, today: ['weaponDamage'], souls: 3, bridge: null, bridgeNow: 'gun', hero: 'Haze' };
  const withBuffs = await views.roamView({ ...base, buffs: ['weaponDamage', 'weaponDamage', 'fireRate'] });
  const j = withBuffs.embeds[0].toJSON();
  assert.strictEqual(j.image.url, 'attachment://roam.png');
  assert.ok(withBuffs.files.some((f) => f.name === 'roam.png'));
  assert.match(j.fields.find((f) => f.name.startsWith('Buffs Gained')).value, /\+6% Weapon Damage[\s\S]*\+1.5% Fire Rate/);
  assert.match(j.footer.text, /bridge buff: Gun/);
  const bridge = (await views.roamView({ ...base, buffs: [], bridge: 'survival', bridgeNow: 'survival' })).embeds[0].toJSON();
  assert.ok(bridge.fields.some((f) => f.name.startsWith('Survival Bridge Buff')));
  const none = (await views.roamView({ ...base, buffs: [] })).embeds[0].toJSON();
  assert.ok(!none.fields);
  for (const key of Object.keys(require('../src/utils/farm/buffs').BUFFS)) assert.ok(require('node:fs').existsSync(`assets/farm/buffs/${key}.png`), key);
  for (const key of Object.keys(require('../src/utils/farm/buffs').BRIDGE)) assert.ok(require('node:fs').existsSync(`assets/farm/bridge/${key}.png`), key);
});

test('buffs from roaming make the hero stronger in fights', () => {
  const plain = buildHero('Haze').stats.maxHealth;
  assert.strictEqual(buildHero('Haze', { buffs: { maxHealth: 4 } }).stats.maxHealth, plain + 60);
  assert.strictEqual(simulate('Haze', 'small-camp', { rng: seeded(1), buffs: { maxHealth: 4 } }).frames[0].hero.max, plain + 60);
});

test('bridge buff: rotates every hour, a roam may find it, the next fight uses it up', async () => {
  const { bridgeNow } = require('../src/utils/farm/buffs');
  const h = 3600 * 1000;
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((i) => bridgeNow(i * h)), ['casting', 'gun', 'movement', 'survival', 'casting']);
  const day = '2026-10-01';
  assert.strictEqual(roam(day, () => 0, 5 * h).bridge, 'gun'); // low roll finds this hour's buff
  assert.strictEqual(roam(day, () => 0.99, 5 * h).bridge, null);
  const stats = (bridge) => require('../src/utils/farm/stats').heroStats(require('../src/utils/farm/stats').HEROES.Haze, { bridge });
  assert.strictEqual(stats(['survival']).maxHealth, stats([]).maxHealth + 200);
  const id = 'bridge1';
  await chooseHero(id, 'Haze');
  const found = await play(id, 'roam', { now: Date.parse('2026-10-01T12:00:00Z'), rng: () => 0 });
  assert.strictEqual(found.haul.bridge, bridgeNow(Date.parse('2026-10-01T12:00:00Z')));
  assert.deepStrictEqual((await getFarmUser(id)).bridge, [found.haul.bridge]);
  await play(id, 'small-camp', { now: Date.parse('2026-10-01T13:00:00Z') });
  assert.deepStrictEqual((await getFarmUser(id)).bridge, [], 'the fight used it up');
});

test('cooldowns can be switched off for testing, and back on', async () => {
  const { setCooldowns } = require('../src/utils/farm/play');
  const id = 'cdswitch';
  await chooseHero(id, 'Haze');
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.ok(!(await play(id, 'roam', { now, rng: seeded(3) })).error);
  assert.strictEqual((await play(id, 'roam', { now: now + 1000 })).error, 'cooldown');
  setCooldowns(false);
  try {
    assert.ok(!(await play(id, 'roam', { now: now + 2000, rng: seeded(4) })).error, 'off: ready again at once');
    assert.ok(!(await play(id, 'roam', { now: now + 3000, rng: seeded(5) })).error);
  } finally { setCooldowns(true); }
  assert.strictEqual((await play(id, 'roam', { now: now + 4000 })).error, 'cooldown', 'on again: the first roam is still cooling down');
});

test('more heroes: unlock once with a token, switch once a day, and each hero keeps its own progress', async () => {
  const { unlockHero, switchHero, updateFarmUser, buyItem, SWITCH_WAIT } = require('../src/utils/farm/play');
  const id = 'sw1';
  const labels = (p) => p.components.at(-1).toJSON().components.map((b) => [b.label, !!b.disabled]);
  const press = async (label, customId, values = []) => { const i = fake(id, customId, { values }); await route(label).execute(i); return i; };
  await chooseHero(id, 'Haze');
  await changeSouls(id, 10000);
  await updateFarmUser(id, (r) => { r.earned = 3000; r.tiers = { 1: 1 }; r.buffs = { fireRate: 2 }; });
  await buyItem(id, 'Extra Health');
  const home = fake(id);
  await homeCommand(home);
  assert.deepStrictEqual(labels(home.log.at(-1)[1]), [['Hero', false], ['Switch Hero', false]]);

  // the switch screen lists every hero with its level or its price
  const list = (await press('Switch Hero button', `farm_switch:${id}`)).log.at(-1)[1];
  checkLimits(list, 'switch list');
  assert.strictEqual(list.embeds[0].toJSON().title, 'Switch Hero');
  assert.match(list.embeds[0].toJSON().description, /\*\*Haze\*\* {2}- {2}Level \d+ {2}- {2}Current Hero\n[\s\S]*\*\*Abrams\*\* {2}- {2}Locked/);

  // locked and no token: Unlock is greyed out, and pressing it anyway does nothing
  const locked = (await press('Hero select', `farm_hero:${id}`, ['Abrams'])).log.at(-1)[1];
  checkLimits(locked, 'unlock preview');
  assert.deepStrictEqual(labels(locked), [['Unlock (1 Token)', true], ['Back', false]]);
  assert.strictEqual((await unlockHero(id, 'Abrams')).error, 'token');
  assert.strictEqual((await switchHero(id, 'Abrams')).error, 'locked');
  assert.strictEqual((await unlockHero(id, 'Nobody')).error, 'unknown', 'not on the roster');

  // unlock: uses one token and no souls, doesn't switch
  await updateFarmUser(id, (r) => { r.tokens = 2; });
  const before = (await getUser(id)).souls;
  const bought = await press('Unlock button', `farm_unlock:${id}:Abrams`);
  assert.strictEqual((await getUser(id)).souls, before, 'no souls');
  assert.strictEqual((await getFarmUser(id)).tokens, 1);
  assert.strictEqual((await getFarmUser(id)).hero, 'Haze', 'unlocking does not switch');
  assert.deepStrictEqual(labels(bought.log.at(-1)[1]), [['Switch', false], ['Back', false]]);
  assert.strictEqual((await unlockHero(id, 'Abrams')).error, 'owned');
  assert.strictEqual((await getFarmUser(id)).tokens, 1, 'never charged twice');

  // switch: the new hero starts from nothing, the member's buffs come along
  const t0 = Date.parse('2026-10-03T12:00:00Z');
  assert.deepStrictEqual(await switchHero(id, 'Abrams', t0), { ok: true });
  const abrams = await getFarmUser(id);
  assert.deepStrictEqual([abrams.hero, abrams.earned, abrams.tiers, abrams.items.vitality, abrams.buffs], ['Abrams', 0, {}, [], { fireRate: 2 }]);
  await updateFarmUser(id, (r) => { r.earned = 500; });

  // once a day
  const soon = await switchHero(id, 'Haze', t0 + 3600000);
  assert.strictEqual(soon.error, 'wait');
  assert.strictEqual(soon.left, SWITCH_WAIT - 3600000);
  assert.strictEqual((await switchHero(id, 'Abrams', t0)).error, 'same');
  const waiting = await views.pickView(member(id), 'Haze', await getFarmUser(id), t0 + 3600000);
  assert.deepStrictEqual(labels(waiting), [['Switch', true], ['Back', false]]);
  assert.match(waiting.embeds[0].toJSON().footer.text, /switch again in 23h 0m/);

  // back to Haze a day later: everything it had is still there, and Abrams keeps what it earned
  assert.deepStrictEqual(await switchHero(id, 'Haze', t0 + SWITCH_WAIT), { ok: true });
  const haze = await getFarmUser(id);
  assert.deepStrictEqual([haze.hero, haze.earned, haze.tiers, haze.items.vitality], ['Haze', 3000, { 1: 1 }, ['Extra Health']]);
  assert.strictEqual(haze.heroes.Abrams.earned, 500);

  // the Switch button itself: goes to the new hero's home screen
  await updateFarmUser(id, (r) => { r.switchedAt = 0; });
  const done = await press('Switch button', `farm_switchto:${id}:Abrams`);
  assert.match(done.log.at(-1)[1].embeds[0].toJSON().title, /^Abrams {2}- {2}Level \d+$/);
  const blocked = await press('Switch button', `farm_switchto:${id}:Haze`);
  assert.match(blocked.log.at(-1)[1].content, /Switching isn't ready yet/);
  assert.strictEqual((await getFarmUser(id)).hero, 'Abrams');
});

test('a camp screen: the triangle is the author icon, a Haunt is in the corner, Title Case text, and Send fights the Haunt shown', async () => {
  const id = 'camp1';
  await chooseHero(id, 'Haze');
  const view = await views.targetView(member(id), 'small-camp', await getFarmUser(id), Date.now(), 'gutter_ghoul');
  checkLimits(view, 'camp details');
  const j = view.embeds[0].toJSON();
  assert.deepStrictEqual([j.author.icon_url, j.thumbnail.url, view.files.map((f) => f.name)], ['attachment://icon.png', 'attachment://thumb.png', ['icon.png', 'thumb.png']]);
  assert.match(view.files[1].attachment, /gutter_ghoul_small\.png$/);
  assert.strictEqual(j.description, 'Three Small Haunts Guard This Camp.');
  assert.strictEqual(j.footer.text, 'If Haze Dies, Nothing Is Paid and the Cooldown Still Starts.');
  const value = (name) => j.fields.find((f) => f.name === name).value;
  assert.deepStrictEqual([value('Enemies'), value('Health'), value('Cooldown'), value('Grown Stronger')], ['3 Small Haunts', '129 Each', 'Every Hour', '0%  (0 / 10 Clears)']);
  const sendId = view.components.at(-1).toJSON().components[0].custom_id;
  assert.strictEqual(sendId, `farm_send:${id}:small-camp:gutter_ghoul`);
  const sent = fake(id, sendId);
  await route('Send button').execute(sent);
  assert.match(sent.log.at(-1)[1].files.at(-1).attachment, /gutter_ghoul_small\.png$/, 'the fight is against the Haunt the screen showed');
  const waiting = await views.targetView(member(id), 'small-camp', await getFarmUser(id));
  assert.match(waiting.embeds[0].toJSON().footer.text, /^Not Ready Yet: (1h 0m|\d+m) Left\. If Haze Dies/);
  const walker = (await views.targetView(member(id), 'walker', await getFarmUser(id))).embeds[0].toJSON();
  assert.strictEqual(walker.author.icon_url, 'attachment://icon.png', "a lane target has its lane's badge");
  assert.strictEqual((await views.targetView(member(id), 'mid-boss', await getFarmUser(id))).embeds[0].toJSON().author.icon_url, 'attachment://souls.png', 'other targets keep the souls icon');
  assert.strictEqual(walker.description, 'A Giant Walker, the Second Line of Defense.');
  assert.match(walker.fields.find((f) => f.name === 'Damage').value, /^\d+(\.\d)? per Second \(Spirit\)$/);
  const siege = (await views.targetView(member(id), 'siege', await getFarmUser(id))).embeds[0].toJSON();
  assert.deepStrictEqual(siege.fields.map((f) => f.name), ['Pays', 'Cooldown', 'Rejuvs', 'Grown Stronger']);
  assert.strictEqual(siege.fields[1].value, 'Once a Day');
});

test('lanes: a Guardian stays down 12 h, its Walker opens only then and stays down 24 h, and the siege needs all three Walkers down', async () => {
  const { updateFarmUser, isDown, walkersDown, lockedBy } = require('../src/utils/farm/play');
  const { LANES, WALKER_STEP, TARGETS: T } = require('../src/utils/farm/targets');
  assert.deepStrictEqual(Object.values(LANES).map((l) => `${l.name} ${l.color}`), ['York Yellow', 'Broadway Blue', 'Park Green']);
  const id = 'lane1';
  const HOUR = 3600000;
  const t0 = Date.parse('2026-10-04T00:00:00Z');
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => { r.earned = 1e6; r.tiers = { 1: 3, 2: 3, 3: 3, 4: 3 }; r.rejuvs = 3; r.buffs = { weaponDamage: 400, maxHealth: 400, fireRate: 100 }; }); // a hero that wins everything
  const go = (key, lane, now) => play(id, key, { lane, now, rng: seeded(4) });

  assert.strictEqual((await go('guardian', undefined, t0)).error, 'lane', 'a Guardian needs its lane');
  assert.strictEqual((await go('guardian', 'nowhere', t0)).error, 'lane');
  assert.deepStrictEqual(await go('walker', 'york', t0), { error: 'locked', by: 'guardian' });
  assert.deepStrictEqual(await go('siege', undefined, t0), { error: 'locked', by: 'walkers' });

  // York's Guardian falls: only York's Walker opens
  const g = await go('guardian', 'york', t0);
  assert.ok(g.run.won && g.run.lane === 'york');
  let r = await getFarmUser(id);
  assert.ok(isDown(r, 'guardian', 'york', t0 + 11 * HOUR) && !isDown(r, 'guardian', 'york', t0 + 12 * HOUR) && !isDown(r, 'guardian', 'broadway', t0));
  assert.strictEqual((await go('guardian', 'york', t0 + HOUR)).error, 'cooldown');
  assert.strictEqual(lockedBy(r, 'walker', 'york', t0), null);
  assert.strictEqual(lockedBy(r, 'walker', 'broadway', t0), 'guardian');

  // each Walker is tougher for every other Walker already down (6000 / 9000 / 12000)
  const health = [];
  for (const [i, lane] of Object.keys(LANES).entries()) {
    if (lane !== 'york') assert.ok((await go('guardian', lane, t0)).run.won);
    const w = await go('walker', lane, t0 + i);
    assert.ok(w.run.won);
    health.push(Math.round(w.run.frames[0].enemies[0].max));
  }
  const base = Math.round(T.walker.enemies()[0].stats.maxHealth);
  const grow = (n) => require('../src/utils/farm/targets').clearPower(n, 'walker');
  assert.deepStrictEqual(health, [0, 1, 2].map((n) => Math.round((base + WALKER_STEP * n) * grow(n))), 'more health for each Walker down (and the usual growth per clear)');
  r = await getFarmUser(id);
  assert.strictEqual(walkersDown(r, t0 + 10), 3);
  assert.ok(isDown(r, 'walker', 'york', t0 + 23 * HOUR) && !isDown(r, 'walker', 'york', t0 + 24 * HOUR + 10));

  // the siege is open while all three are down, shut again once one comes back
  assert.strictEqual(lockedBy(r, 'siege', undefined, t0 + 23 * HOUR), null);
  assert.strictEqual(lockedBy(r, 'siege', undefined, t0 + 24 * HOUR + 1), 'walkers');
  const s = await go('siege', undefined, t0 + HOUR);
  assert.ok(s.run && s.run.siege);
  r = await getFarmUser(id);
  assert.strictEqual(walkersDown(r, t0 + 2 * HOUR), 3, 'a siege does not bring the lanes back early');

  // a lost fight starts the cooldown but leaves the Guardian standing
  const weak = 'lane2';
  await chooseHero(weak, 'Haze');
  const lost = await play(weak, 'guardian', { lane: 'york', now: t0, rng: seeded(4) });
  assert.ok(!lost.run.won);
  const w = await getFarmUser(weak);
  assert.ok(!isDown(w, 'guardian', 'york', t0) && cooldownLeft(w, 'guardian:york', t0) > 11 * HOUR);
  assert.strictEqual(cooldownLeft(w, 'guardian:broadway', t0), 0, 'the other lanes are not on cooldown');
});

test('lane screens: the dropdown lists every lane, a Walker shows its lane, health and why it is locked, and Send carries the lane', async () => {
  const { updateFarmUser } = require('../src/utils/farm/play');
  const id = 'lane3';
  const now = Date.parse('2026-10-04T00:00:00Z');
  const HOUR = 3600000;
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => { r.down = { 'guardian:york': now + 12 * HOUR, 'walker:broadway': now + 20 * HOUR, 'guardian:broadway': now + 2 * HOUR }; r.cooldowns = { ...r.down }; });
  const record = await getFarmUser(id);
  const home = await views.homeView(member(id), record, now);
  checkLimits(home, 'home with lanes');
  const options = home.components[0].toJSON().components[0].options;
  assert.deepStrictEqual(options.map((o) => o.value), ['small-camp', 'medium-camp', 'large-camp', 'guardian:york', 'guardian:broadway', 'guardian:park', 'walker:york', 'walker:broadway', 'walker:park', 'waves:york', 'waves:broadway', 'waves:park', 'mid-boss', 'siege', 'shop']); // the item shop is the last option (his call, Oct 3)
  const said = (value) => options.find((o) => o.value === value).description.split('  -  ')[0];
  assert.deepStrictEqual(['guardian:york', 'guardian:park', 'walker:york', 'walker:broadway', 'walker:park', 'siege'].map(said),
    ['Down, back in 12h 0m', 'Ready', 'Ready', 'Down, back in 20h 0m', 'Locked', 'Locked']);

  // York's Walker: open (its Guardian is down), and 9,000 health because Broadway's Walker is down
  const york = await views.targetView(member(id), 'walker', record, now, 'york');
  checkLimits(york, 'walker details');
  const j = york.embeds[0].toJSON();
  const value = (name) => j.fields.find((f) => f.name === name).value;
  assert.deepStrictEqual([j.title, value('Lane'), value('Health'), value('Cooldown')], ['York Walker', 'York (Yellow)', '9,000', 'Once a Day']);
  assert.deepStrictEqual(york.components.at(-1).toJSON().components.map((b) => [b.custom_id, !!b.disabled])[0], [`farm_send:${id}:walker:york`, false]);
  const down = (await views.targetView(member(id), 'guardian', record, now, 'york')).embeds[0].toJSON();
  assert.match(down.footer.text, /^Down: Back in 12h 0m\./);
  const siege = (await views.targetView(member(id), 'siege', record, now)).embeds[0].toJSON();
  assert.strictEqual(siege.image.url, 'attachment://siege.png', 'the lanes and stages are a drawn card');
  assert.match(siege.footer.text, /^Locked: All Three Walkers Must Be Down First\./);

  // the dropdown opens a lane's screen, and pressing Send on a locked Walker is refused
  const pick = fake(id, `farm_target:${id}`, { values: ['walker:park'] });
  await route('Target select').execute(pick);
  assert.strictEqual(pick.log.at(-1)[1].embeds[0].toJSON().title, 'Park Walker');
  const refused = fake(id, `farm_send:${id}:walker:park`);
  await route('Send button').execute(refused);
  assert.match(refused.log.at(-1)[1].content, /Guardian must fall first/);
  const sent = fake(id, `farm_send:${id}:guardian:park`);
  await route('Send button').execute(sent);
  assert.match(sent.log.at(-1)[1].embeds[0].toJSON().title, /Park Guardian|Haze Was Defeated/);
});

test('waves: an endless run down a lane, every wave cleared pays, once a day per lane', async () => {
  const { updateFarmUser } = require('../src/utils/farm/play');
  const { WAVES, wavePay, wavesPay } = require('../src/utils/farm/targets');
  assert.deepStrictEqual([wavePay(1), wavesPay(0), wavesPay(2), WAVES.cooldown / 3600], [100, 0, 100 + wavePay(2), 24]);
  assert.ok(wavePay(5) > wavePay(4), 'later waves pay more');
  const names = (n) => WAVES.stages[n - 1].enemies().map((e) => e.name);
  assert.deepStrictEqual(names(1), ['Trooper', 'Trooper', 'Trooper', 'Medic Trooper']);
  assert.deepStrictEqual(names(11), ['Trooper', 'Trooper', 'Melee Trooper', 'Medic Trooper'], 'a melee trooper joins after wave 10');
  assert.ok(WAVES.stages[4].enemies()[0].stats.maxHealth > WAVES.stages[3].enemies()[0].stats.maxHealth, 'each wave is stronger');

  // a stronger hero gets further, and is paid for exactly the waves it cleared
  const weak = simulate('Haze', 'waves', { rng: seeded(3) });
  const strong = simulate('Haze', 'waves', { rng: seeded(3), boons: 30, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 }, items: ['Fortitude', 'Extra Health', 'Rapid Rounds', 'Healing Nova'] });
  assert.ok(weak.waves && !weak.siege && strong.cleared > weak.cleared && strong.cleared < WAVES.max);
  assert.strictEqual(strong.souls, wavesPay(strong.cleared));
  assert.strictEqual(strong.stageNames[strong.cleared], `Wave ${strong.cleared + 1}`);

  const id = 'wv1';
  const t0 = Date.parse('2026-10-05T00:00:00Z');
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => { r.earned = 5000; r.tiers = { 1: 2, 2: 1, 3: 1, 4: 1 }; });
  assert.strictEqual((await play(id, 'waves', { now: t0 })).error, 'lane');
  const before = (await getUser(id)).souls;
  const out = await play(id, 'waves', { lane: 'york', now: t0, rng: seeded(5) });
  assert.ok(out.run.waves && out.run.lane === 'york' && out.run.cleared >= 1);
  assert.strictEqual((await getUser(id)).souls, before + wavesPay(out.run.cleared), 'falling loses nothing');
  const r = await getFarmUser(id);
  assert.deepStrictEqual([r.bestWave, r.earned, r.clears.waves, Object.keys(r.down)], [out.run.cleared, 5000 + out.run.souls, undefined, []]);
  assert.strictEqual((await play(id, 'waves', { lane: 'york', now: t0 + 3600000 })).error, 'cooldown');
  assert.ok((await play(id, 'waves', { lane: 'park', now: t0 + 3600000, rng: seeded(6) })).run, 'another lane is its own run');

  // the screens
  const details = await views.targetView(member(id), 'waves', r, t0 + 25 * 3600000, 'york');
  checkLimits(details, 'waves details');
  const j = details.embeds[0].toJSON();
  assert.deepStrictEqual([j.title, j.author.icon_url], ['York Waves', 'attachment://icon.png']);
  assert.match(j.fields.find((f) => f.name === 'Best Run').value, new RegExp(`^${out.run.cleared} Waves?`));
  assert.strictEqual(details.components.at(-1).toJSON().components[0].custom_id, `farm_send:${id}:waves:york`);
  for (const frame of out.run.frames) checkLimits(views.fightView(out.run, frame), 'waves live');
  assert.match(details.files.at(-1).attachment, /trooper\.png$/, 'the corner picture is a trooper');
  assert.match(views.fightView(out.run, out.run.frames[0]).files.at(-1).attachment, /trooper\.png$/);
  const medicLeft = { ...out.run.frames[0], enemies: out.run.frames[0].enemies.map((e) => ({ ...e, hp: e.name.startsWith('Medic') ? 10 : 0 })) };
  assert.match(views.fightView(out.run, medicLeft).files.at(-1).attachment, /trooper-medic\.png$/, 'the picture is the trooper still standing');
  const result = views.resultView(out.run);
  checkLimits(result, 'waves result');
  assert.match(result.embeds[0].toJSON().title, /^York Waves: \d+ Waves? Cleared$/);
  assert.match(result.embeds[0].toJSON().description, /^Haze (fell|ran out of time) on Wave \d+\.$/);
});

test('buying an upgrade says which components it used up; a component of an owned item is refused', async () => {
  const id = 'cmd-upgrade';
  await chooseHero(id, 'Haze');
  await changeSouls(id, 100000);
  const buy = async (name) => {
    const i = fake(id, `${views.BUY_ID}:${id}:weapon:1:${name}`);
    await route('Buy item').execute(i);
    return i.log.find((l) => l[0] === 'followUp')?.[1].content;
  };
  assert.strictEqual(await buy('High-Velocity Rounds'), undefined);
  assert.match(await buy('Opening Rounds'), /^Upgraded High-Velocity Rounds Into Opening Rounds for [\d,]+ Souls\.$/);
  assert.strictEqual(await buy('High-Velocity Rounds'), 'You Already Have That in Opening Rounds.');
});

test('every legendary drop message fits the Discord limits and attaches its picture', () => {
  for (const name of require('../src/utils/farm/levels').LEGENDARY_NAMES) checkLimits(views.legendaryView(name), `legendary ${name}`);
});

test('Character Unlock Token: each hero earns one from its first siege win, and the message fits', async () => {
  const { updateFarmUser, setCooldowns } = require('../src/utils/farm/play');
  const id = 'tok1';
  await chooseHero(id, 'Abrams');
  const far = Date.now() + 1e9;
  const strong = (r) => { // a full late kit, every Walker down, so the siege can be won
    r.earned = 1e9; r.tiers = { 1: 3, 2: 3, 3: 3, 4: 3 }; r.rejuvs = 3;
    r.items = { weapon: ['Crippling Headshot', 'Leech'], vitality: ['Colossus', 'Spirit Resilience', 'Bullet Resilience', 'Unstoppable', 'Healing Tempo', 'Fortitude'], spirit: ['Boundless Spirit', 'Superior Duration', 'Improved Spirit', 'Spirit Snatch'] };
    for (const lane of Object.keys(require('../src/utils/farm/targets').LANES)) r.down[`walker:${lane}`] = far;
  };
  setCooldowns(false);
  try {
    const win = async () => { for (let s = 1; s <= 40; s++) { await updateFarmUser(id, strong); const { run } = await play(id, 'siege', { rng: seeded(s) }); if (run.won) return run; } throw new Error('no siege win in 40 tries'); };
    assert.strictEqual((await win()).token, true);
    assert.deepStrictEqual([(await getFarmUser(id)).tokens, (await getFarmUser(id)).siegeTokens], [1, ['Abrams']]);
    assert.ok(!(await win()).token, 'only the first siege win of a hero');
    assert.strictEqual((await getFarmUser(id)).tokens, 1);
  } finally { setCooldowns(true); }
  checkLimits(views.tokenView('Abrams'), 'token message');
});

test('item shop: the /base dropdown opens it, every tab fits the limits, buying and selling redraw their tab', async () => {
  const id = 'cmd-shop';
  await chooseHero(id, 'Haze');
  await changeSouls(id, 100000);
  const open = fake(id, `${views.TARGET_ID}:${id}`, { values: ['shop'] });
  await route('Target select').execute(open);
  const first = open.log.find((l) => l[0] === 'editReply')[1];
  checkLimits(first, 'shop weapon');
  assert.match(first.embeds[0].toJSON().title, /Item Shop {2}- {2}Weapon/);
  for (const tab of ['vitality', 'spirit', 'broker', 'sell']) {
    const i = fake(id, `${views.SHOPTAB_ID}:${id}:${tab}`);
    await route('Shop tab').execute(i);
    checkLimits(i.log.find((l) => l[0] === 'editReply')[1], `shop ${tab}`);
  }
  const pick = fake(id, `${views.ITEM_ID}:${id}:vitality:1`, { values: ['Extra Health'] });
  await route('Pick item').execute(pick);
  const shown = pick.log.find((l) => l[0] === 'editReply')[1];
  checkLimits(shown, 'shop item page');
  assert.match(shown.embeds[0].toJSON().description, /Extra Health[\s\S]*You Will Have/, 'picking shows the item and does not buy it');
  assert.deepStrictEqual(shown.components.at(-1).toJSON().components.map((c) => c.label), ['Back', 'Hero', 'Buy (800)']);
  assert.ok(!(await getFarmUser(id)).items.vitality.includes('Extra Health'));
  const buy = fake(id, `${views.BUY_ID}:${id}:vitality:1:Extra Health`);
  await route('Buy item').execute(buy);
  assert.ok((await getFarmUser(id)).items.vitality.includes('Extra Health'));
  assert.match(buy.log.find((l) => l[0] === 'editReply')[1].embeds[0].toJSON().title, /Vitality {2}- {2}800/, 'back on the tab and price it was bought from');
  const price = fake(id, `${views.SHOPTAB_ID}:${id}:spirit:3`);
  await route('Shop tab').execute(price);
  assert.match(price.log.find((l) => l[0] === 'editReply')[1].embeds[0].toJSON().title, /Spirit {2}- {2}3,200/);
  const sell = fake(id, `${views.SELL_ID}:${id}`, { values: ['Extra Health'] });
  await route('Sell item').execute(sell);
  assert.match(sell.log.find((l) => l[0] === 'editReply')[1].embeds[0].toJSON().title, /Sell/);
  const hero = await views.heroView(member(id), await getFarmUser(id), 5);
  assert.deepStrictEqual(hero.components.at(-1).toJSON().components.map((c) => c.label), ['Back', 'Item Shop'], 'selling and the Broker moved to the shop');
});

test('encounters: a rival shows on the result with Fight / Walk Away, the duel is replayed, a win unlocks it', async () => {
  const { setCooldowns, updateFarmUser } = require('../src/utils/farm/play');
  const id = 'rival-ui';
  const press = async (label, customId, who = id) => { const i = fake(who, customId); i.reply = async (p) => i.log.push(['reply', p]); await route(label).execute(i); return i; };
  const buttons = (p) => (p.components ?? []).flatMap((r) => r.toJSON().components.map((b) => b.label));
  await chooseHero(id, 'Lady Geist'); // a good duellist (Haze wins about one duel in seven)
  await updateFarmUser(id, (r) => { r.earned = 1e6; r.tiers = { 1: 3, 2: 3, 3: 3, 4: 3 }; });
  setCooldowns(false); // the testing switch: every won fight brings a rival
  try {
    // the offer: on the fight's result
    const sent = await press('Send button', `farm_send:${id}:small-camp`);
    const result = sent.log.at(-1)[1];
    checkLimits(result, 'result with a rival');
    const offer = result.embeds[0].toJSON().fields.find((f) => f.name === 'A Rival Appears');
    const rival = buttons(result)[0].replace('Fight ', '');
    assert.ok(offer && offer.value.includes(rival) && buttons(result)[1] === 'Walk Away' && rival !== 'Lady Geist');

    // someone else can't press it
    const stranger = await press('Rival Fight button', `farm_duel:${id}`, 'someone-else');
    assert.ok(stranger.log.some(([kind, p]) => kind === 'reply' && /not your farm/.test(p.content)));

    // Walk Away: the buttons go, and the rival with them
    const walked = await press('Rival Walk Away button', `farm_walk:${id}`);
    assert.deepStrictEqual(walked.log.find(([kind]) => kind === 'editReply')[1].components, []);
    assert.ok(walked.log.some(([kind, p]) => kind === 'followUp' && p.content === `You let ${rival} go.`));
    const late = await press('Rival Fight button', `farm_duel:${id}`);
    assert.ok(late.log.some(([kind, p]) => kind === 'followUp' && p.content === 'That rival has already left.'));

    // Fight: every screen of the duel fits, and it ends on a result; keep going until one is won
    let won = null;
    for (let n = 0; n < 40 && !won; n++) {
      const again = await press('Send button', `farm_send:${id}:small-camp`);
      const name = buttons(again.log.at(-1)[1])[0].replace('Fight ', '');
      const duel = await press('Rival Fight button', `farm_duel:${id}`);
      const screens = duel.log.filter(([kind]) => kind === 'editReply').map(([, p]) => p);
      assert.ok(screens.length >= 2);
      screens.forEach((p, k) => checkLimits(p, `duel screen ${k}`));
      assert.strictEqual(screens[0].embeds[0].toJSON().title, `Lady Geist vs ${name}`);
      const title = screens.at(-1).embeds[0].toJSON().title;
      assert.ok([`${name} Unlocked`, 'Lady Geist Was Defeated', `${name} Got Away`].includes(title), title);
      assert.strictEqual(!!(await getFarmUser(id)).heroes[name], title === `${name} Unlocked`);
      if (title === `${name} Unlocked`) won = name;
    }
    assert.ok(won, 'a duel won within 40 tries');
  } finally { setCooldowns(true); }
});
