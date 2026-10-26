// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/utils/farm/descent');
const dviews = require('../src/utils/farm/descentViews');
const { getFarmUser, chooseHero, updateFarmUser } = require('../src/utils/farm/play');
const { MAX_ITEMS, countItems, POOL, SLOTS, LEGENDARY_NAMES } = require('../src/utils/farm/levels');
const { itemByName } = require('../src/utils/farm/stats');
const routes = require('../src/components/farm');
const descend = require('../src/commands/farm/descend');

const guild = { emojis: { cache: { find: () => undefined } } };
const STREAK = ['left', 'mid', 'right'].flatMap((p) => ['on', 'off'].map((s) => `streak_${p}_${s}`));
require('../src/utils/trivia').loadStreakEmojis({
  emojis: { cache: { find: (fn) => STREAK.map((name) => ({ name, toString: () => `<:${name}:1554307832742940715>` })).find(fn) } },
});
const member = (id) => ({ id, guild, toString: () => `<@${id}>` });
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const route = (label) => routes.find((r) => r.label === label);
function fake(userId, customId = '', extra = {}) {
  const log = [];
  return {
    customId, user: { id: userId }, member: member(userId), values: [], log,
    deferUpdate: async () => log.push(['deferUpdate']), deferReply: async () => log.push(['deferReply']),
    editReply: async (p) => { log.push(['editReply', p]); return p; }, followUp: async (p) => log.push(['followUp', p]),
    reply: async (p) => log.push(['reply', p]), ...extra,
  };
}
// Discord's limits on one message (the same checks as farmcmd.test.js)
function checkLimits(payload, what) {
  for (const e of payload.embeds ?? []) {
    const j = e.toJSON();
    const size = (j.title?.length ?? 0) + (j.description?.length ?? 0) + (j.footer?.text.length ?? 0) + (j.author?.name.length ?? 0) +
      (j.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
    assert.ok((j.title?.length ?? 0) <= 256 && (j.description?.length ?? 0) <= 4096, `${what}: title or description`);
    assert.ok((j.fields ?? []).length <= 25, `${what}: field count`);
    for (const f of j.fields ?? []) assert.ok(f.name.length > 0 && f.name.length <= 256 && f.value.length > 0 && f.value.length <= 1024, `${what}: field "${f.name}"`);
    assert.ok(size <= 6000, `${what}: embed is ${size} characters`);
  }
  const rows = (payload.components ?? []).map((r) => r.toJSON());
  assert.ok(rows.length <= 5, `${what}: rows`);
  for (const r of rows) {
    assert.ok(r.components.length <= 5, `${what}: buttons in a row`);
    for (const c of r.components) {
      assert.ok(c.custom_id.length <= 100, `${what}: custom id`);
      if (c.label) assert.ok(c.label.length <= 80, `${what}: label`);
      for (const o of c.options ?? []) assert.ok(o.label.length <= 100 && (o.description ?? '').length <= 100, `${what}: option`);
      assert.ok((c.options ?? []).length <= 25);
    }
    const ids = r.components.map((c) => c.custom_id);
    assert.strictEqual(new Set(ids).size, ids.length, `${what}: duplicate ids`);
  }
  const names = (payload.files ?? []).map((f) => f.name);
  for (const e of payload.embeds ?? []) {
    const j = e.toJSON();
    for (const url of [j.thumbnail?.url, j.author?.icon_url, j.image?.url].filter(Boolean)) assert.ok(names.includes(url.replace('attachment://', '')), `${what}: ${url} is attached`);
  }
}

test('rooms come from the seed: the same seed gives the same rooms and offers', () => {
  for (let room = 1; room <= 40; room++) assert.deepStrictEqual(D.roomSpec(99, room, 'Haze'), D.roomSpec(99, room, 'Haze'));
  const a = D.newRun('Haze', 5);
  const b = D.newRun('Haze', 5);
  const spec = D.roomSpec(5, 1, 'Haze');
  assert.deepStrictEqual(D.rollOffer(a, spec), D.rollOffer(b, spec));
  assert.notDeepStrictEqual([1, 2, 3, 4, 6, 7].map((r) => D.roomSpec(1, r, 'Haze')), [1, 2, 3, 4, 6, 7].map((r) => D.roomSpec(2, r, 'Haze')));
});

test('every 5th room is a boss, rivals come from room 3, a room holds at most 6 enemies, the Patron is the last', () => {
  let rivals = 0;
  for (let seed = 1; seed <= 40; seed++) {
    assert.deepStrictEqual(D.roomSpec(seed, D.LAST_ROOM, 'Haze'), { room: 40, floor: 8, kind: 'boss', boss: 'patron', final: true });
    for (let room = 1; room < D.LAST_ROOM; room++) {
      const spec = D.roomSpec(seed, room, 'Haze');
      assert.strictEqual(spec.kind === 'boss', room % 5 === 0, `room ${room}`);
      assert.strictEqual(spec.floor, Math.ceil(room / 5));
      if (spec.kind === 'rival') { rivals++; assert.ok(room >= 3); assert.notStrictEqual(spec.rival, 'Haze'); }
      if (spec.kind === 'fight') {
        const units = D.unitsOf(spec);
        assert.ok(units.length >= 1 && units.length <= 6, `${units.length} enemies`);
        for (const u of units) assert.ok(u.stats.maxHealth > 0 && u.stats.dps > 0 && u.stats.bulletResist <= 0.9);
        assert.ok(D.roomLine(spec).length > 0);
      }
      if (spec.kind === 'boss') assert.ok(!spec.final && spec.boss !== 'patron', 'the Patron waits at the bottom');
      if (spec.kind === 'boss') { const b = D.bossFor(spec.boss, room); assert.ok(b.stats.maxHealth > 0 && b.health === b.stats.maxHealth && b.stats.dps > 0); }
    }
  }
  assert.ok(rivals > 0, 'rivals show up');
  assert.ok(D.bossFor('walker', 30).stats.maxHealth > D.bossFor('walker', 5).stats.maxHealth, 'deeper bosses are tougher');
});

test('an item offer: one of each kind, nothing held or left out of runs, upgrades of held items', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const d = D.newRun('Haze', seed);
    d.room = 1 + (seed % 30);
    d.items = { weapon: ['Extended Magazine'], vitality: ['Extra Health'], spirit: ['Extra Spirit'] };
    const offer = D.rollOffer(d, { room: d.room, floor: D.floorOf(d.room), kind: 'fight' });
    assert.strictEqual(offer.kind, 'items');
    assert.deepStrictEqual(offer.choices.map((n) => SLOTS.find((s) => POOL[s].includes(n))), ['vitality', 'weapon', 'spirit']);
    for (const n of offer.choices) {
      assert.ok(!D.NO_RUN_ITEMS.has(n) && !Object.values(d.items).flat().includes(n), n);
      assert.ok(itemByName(n).Tier <= 4);
    }
  }
  // floor 1 never offers tier 4
  for (let seed = 1; seed <= 60; seed++) assert.ok(D.rollOffer(D.newRun('Haze', seed), { room: 1, floor: 1, kind: 'fight' }).choices.every((n) => itemByName(n).Tier <= 2));
  // a boss: buffs, and legendaries on odd floors from 3 (never Eternal Gift)
  const d = D.newRun('Haze', 3);
  assert.strictEqual(D.rollOffer(d, { room: 5, floor: 1, kind: 'boss' }).kind, 'buffs');
  const legend = D.rollOffer(d, { room: 15, floor: 3, kind: 'boss' });
  assert.strictEqual(legend.kind, 'legendaries');
  assert.ok(legend.choices.every((n) => LEGENDARY_NAMES.includes(n) && !D.NO_RUN_LEGENDARIES.has(n)));
});

test('picks: an upgrade replaces its part in place, a full build needs an item given up, skip heals', () => {
  const d = D.newRun('Haze', 1);
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Extended Magazine', 'Extra Health', 'Extra Spirit'], room: 1 };
  assert.deepStrictEqual(D.takeChoice(d, 0), { ok: true, kind: 'items', name: 'Extended Magazine', used: [], replaced: null });
  assert.strictEqual(d.phase, 'ready');
  assert.deepStrictEqual(D.takeChoice(d, 1), { error: 'none' }, 'one pick per offer');
  // the upgrade takes Extended Magazine's place
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Healing Rite', 'Titanic Magazine', 'Mystic Burst'], room: 2 };
  const up = D.takeChoice(d, 1);
  assert.deepStrictEqual(up.used, ['Extended Magazine']);
  assert.deepStrictEqual(d.items.weapon, ['Titanic Magazine']);
  // 12 items: a new one needs `replace`, an upgrade doesn't
  const fill = POOL.vitality.filter((n) => !D.NO_RUN_ITEMS.has(n)).slice(0, MAX_ITEMS - 1);
  d.items.vitality = fill;
  assert.strictEqual(countItems(d.items), MAX_ITEMS);
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Mystic Burst'], room: 3 };
  assert.deepStrictEqual(D.takeChoice(d, 0), { error: 'full' });
  assert.strictEqual(d.phase, 'offer', 'nothing changed');
  assert.deepStrictEqual(D.takeChoice(d, 0, 'Nope'), { error: 'missing' });
  const swap = D.takeChoice(d, 0, fill[0]);
  assert.strictEqual(swap.replaced, fill[0]);
  assert.ok(d.items.spirit.includes('Mystic Burst') && !d.items.vitality.includes(fill[0]));
  assert.strictEqual(countItems(d.items), MAX_ITEMS);
  // a boss's buff pick and a legendary
  d.phase = 'offer';
  d.offer = { kind: 'buffs', choices: ['fireRate', 'maxHealth', 'spiritPower'], room: 5 };
  D.takeChoice(d, 1);
  assert.deepStrictEqual(d.buffs, { maxHealth: D.BOSS_BUFFS });
  d.phase = 'offer';
  d.offer = { kind: 'legendaries', choices: LEGENDARY_NAMES.slice(0, 3), room: 15 };
  D.takeChoice(d, 2);
  assert.strictEqual(d.legendary, LEGENDARY_NAMES[2]);
  // skip
  d.health = 0.5;
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Extra Spirit'], room: 6 };
  assert.ok(D.skipChoice(d).ok);
  assert.strictEqual(d.health, 0.5 + D.SKIP_HEAL);
  assert.strictEqual(d.offer, null);
});

test('ability points follow the level: unlocks at 0 / 2 / 4 / 7, tier costs 1 / 2 / 5', () => {
  const d = D.newRun('Haze', 1);
  assert.deepStrictEqual(D.spendPoint(d, 1), { error: 'points' }, 'level 0 has no points');
  d.level = 1;
  assert.deepStrictEqual(D.spendPoint(d, 2), { error: 'locked' });
  assert.deepStrictEqual(D.spendPoint(d, 1), { ok: true, tier: 1 });
  d.level = 8;
  assert.ok(D.spendPoint(d, 4).ok, 'the ultimate unlocks at 7');
  assert.strictEqual(D.pointsLeft(d), 5 - 2);
});

test('a won room: a level, health carried with a breather, the offer; a boss adds a Rejuv', () => {
  const d = D.newRun('Haze', 11);
  const spec = D.roomSpec(11, 1, 'Haze');
  D.afterWin(d, { spec, health: 0.4, rejuvsUsed: 0, kept: {} });
  assert.strictEqual(d.level, 1);
  assert.strictEqual(d.room, 2);
  assert.strictEqual(d.phase, 'offer');
  assert.ok(Math.abs(d.health - (0.4 + D.REST)) < 1e-9);
  assert.strictEqual(d.offer.room, 1);
  const boss = D.newRun('Haze', 11);
  boss.room = 5;
  D.afterWin(boss, { spec: D.roomSpec(11, 5, 'Haze'), health: 1, rejuvsUsed: 0, kept: {} });
  assert.strictEqual(boss.rejuvs, 1);
  assert.strictEqual(boss.health, 1);
});

test('a fight room plays with the run\'s health, and a rival is a full hero', () => {
  const d = D.newRun('Haze', 3);
  d.health = 0.5;
  const run = D.fightRoom(d, D.roomSpec(3, 1, 'Haze'), seeded(4));
  assert.ok(Math.abs(run.frames[0].hero.hp - run.frames[0].hero.max * 0.5) < 1, 'it starts at the run\'s health');
  assert.ok(run.health >= 0 && run.health <= 1);
  const rival = D.fightRoom(D.newRun('Haze', 3), { room: 3, floor: 1, kind: 'rival', rival: 'Abrams' }, seeded(9));
  assert.strictEqual(rival.frames[0].enemies[0].name, 'Abrams');
  assert.ok(rival.frames.length >= 2);
});

test('the run on the member\'s record: start, fight, pick, the end, the best, abandon', async () => {
  const id = 'd1';
  assert.deepStrictEqual(await D.startRun(id, 'Haze'), { error: 'locked' }, 'no hero yet');
  await chooseHero(id, 'Haze');
  assert.deepStrictEqual(await D.startRun(id, 'Abrams'), { error: 'locked' }, 'not unlocked');
  assert.deepStrictEqual(await D.startRun(id, 'Haze', 1234), { ok: true });
  assert.deepStrictEqual(await D.startRun(id, 'Haze'), { error: 'running' });
  const before = await getFarmUser(id);
  const { run } = await D.fight(id, { rng: seeded(3) });
  assert.ok(run.won, 'room 1 is won with a fresh hero');
  const d = await D.getRun(id);
  assert.strictEqual(d.phase, 'offer');
  assert.deepStrictEqual(await D.fight(id), { error: 'offer' }, 'pick first');
  assert.deepStrictEqual(await D.choose(id, 99, 0), { error: 'none' }, "an old message's pick does nothing");
  assert.ok((await D.choose(id, 1, 0)).ok);
  assert.strictEqual((await D.getRun(id)).phase, 'ready');
  const after = await getFarmUser(id);
  assert.deepStrictEqual([after.souls, after.earned, after.items], [before.souls, before.earned, before.items], "the hero's own farm record is untouched");
  assert.strictEqual(after.bestDescent.rooms, 1);
  // a run that can't win: a hero at almost no health, deep down
  await updateFarmUser(id, (r) => { r.descent.room = 39; r.descent.health = 0.01; });
  const lost = (await D.fight(id, { rng: seeded(8) })).run;
  assert.ok(!lost.won && lost.over);
  assert.strictEqual(await D.getRun(id), null, 'the run is over');
  assert.deepStrictEqual((await getFarmUser(id)).bestDescent, { rooms: 38, hero: 'Haze' });
  assert.deepStrictEqual(await D.fight(id), { error: 'none' });
  // abandon
  await D.startRun(id, 'Haze', 77);
  assert.strictEqual((await D.abandon(id)).hero, 'Haze');
  assert.strictEqual(await D.getRun(id), null);
  assert.strictEqual(await D.abandon(id), null);
  // a fight claim stops a second Fight
  await D.startRun(id, 'Haze', 78);
  await updateFarmUser(id, (r) => { r.descent.phase = 'fighting'; r.descent.fightingAt = Date.now(); });
  assert.deepStrictEqual(await D.fight(id), { error: 'busy' });
  assert.ok((await D.fight(id, { now: Date.now() + 2 * 60 * 1000 })).run, 'a stale claim (the bot stopped mid-fight) can be fought again');
  const rows = await D.leaderboard();
  assert.deepStrictEqual(rows[0], { id, rooms: 38, hero: 'Haze', clears: 0 });
});

test('the token: clearing room 25 pays one Character Unlock Token, once per member', async () => {
  const id = 'd2';
  await chooseHero(id, 'Haze');
  const t4 = (kind) => POOL[kind].filter((n) => itemByName(n).Tier === 4 && !D.NO_RUN_ITEMS.has(n)).slice(0, 4);
  const strong = (r) => { Object.assign(r.descent, { room: D.TOKEN_ROOM, level: 35, health: 1, rejuvs: 3, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 }, items: { weapon: t4('weapon'), vitality: t4('vitality'), spirit: t4('spirit') } }); };
  const winRoom25 = async () => {
    for (let s = 1; s <= 12; s++) {
      await D.abandon(id);
      await D.startRun(id, 'Haze', s);
      await updateFarmUser(id, strong);
      const { run } = await D.fight(id, { rng: seeded(s) });
      if (run.won) return run;
    }
    return null;
  };
  const first = await winRoom25();
  assert.ok(first, 'a full kit wins room 25');
  assert.ok(first.token);
  assert.strictEqual((await getFarmUser(id)).tokens, 1);
  const second = await winRoom25();
  assert.ok(second && !second.token, 'once per member');
  assert.strictEqual((await getFarmUser(id)).tokens, 1);
});

test('the last room: the Patron then the Weakened Patron in one fight; beating it clears the descent', async () => {
  const id = 'd5';
  await chooseHero(id, 'Haze');
  await D.startRun(id, 'Haze', 9);
  await updateFarmUser(id, (r) => { r.descent.room = D.LAST_ROOM; });
  const saved = { ...D.TUNE };
  Object.assign(D.TUNE, { health: 1e-4, dps: 0 }); // enemies that can't win, so the clear itself is what is tested
  try {
    const { run } = await D.fight(id, { rng: seeded(3) });
    assert.ok(run.won && run.complete);
    assert.deepStrictEqual(run.stageNames, ['Patron', 'Weakened Patron']);
    assert.strictEqual(run.complete.clears, 1);
    const r = await getFarmUser(id);
    assert.strictEqual(r.descent, undefined, 'the run is over');
    assert.deepStrictEqual([r.bestDescent.rooms, r.descentClears], [D.LAST_ROOM, 1]);
    const top = (await D.leaderboard()).find((row) => row.id === id);
    assert.deepStrictEqual(top, { id, rooms: 40, hero: 'Haze', clears: 1 });
    checkLimits(await dviews.completeView(member(id), run), 'cleared');
    for (const frame of run.frames) checkLimits(await dviews.fightView(run, frame), 'last room');
  } finally { Object.assign(D.TUNE, saved); }
});

test('every /descend screen fits the Discord limits and attaches what it points to', async () => {
  const id = 'd3';
  await chooseHero(id, 'Haze');
  const record = await getFarmUser(id);
  checkLimits(await dviews.startView(member(id), record), 'start');
  checkLimits(await dviews.startView(member(id), record, 'Haze'), 'start with a hero');
  for (let seed = 1; seed <= 8; seed++) {
    const d = D.newRun('Haze', seed);
    for (const room of [1, 3, 4, 5, 9, 12, 15, 30, 40]) {
      d.room = room;
      d.level = room;
      checkLimits(await dviews.roomView(member(id), d), `room ${room}`);
      const spec = D.roomSpec(seed, room, 'Haze');
      const run = D.fightRoom(d, spec, seeded(seed));
      for (const frame of run.frames) checkLimits(await dviews.fightView(run, frame), `fight ${room}`);
      if (run.won && spec.final) checkLimits(await dviews.completeView(member(id), { ...run, complete: { ...d, clears: 1 } }), 'cleared');
      else if (run.won) {
        const next = structuredClone(d);
        D.afterWin(next, run);
        checkLimits(await dviews.offerView(member(id), next, { run }), `offer ${room} (${next.offer.kind})`);
      } else checkLimits(await dviews.overView(member(id), { ...run, over: { ...d }, best: { rooms: room - 1, hero: 'Haze' } }), `over ${room}`);
    }
  }
  const d = D.newRun('Haze', 1);
  d.room = 16; d.level = 15; d.phase = 'offer';
  d.items = { weapon: POOL.weapon.slice(0, 4), vitality: POOL.vitality.slice(0, 4), spirit: POOL.spirit.slice(0, 4) };
  d.legendary = LEGENDARY_NAMES[0];
  d.buffs = { fireRate: 3 };
  d.offer = { kind: 'items', choices: [POOL.vitality[10], POOL.weapon[10], POOL.spirit[10]], room: 15 };
  const over = await dviews.overView(member(id), { over: d, spec: D.roomSpec(d.seed, d.room, d.hero), best: { rooms: 15, hero: d.hero }, log: [], cleared: 0 });
  checkLimits(over, 'over build card');
  assert.strictEqual(over.embeds[0].toJSON().image.url, 'attachment://hero.png');
  assert.ok(over.files.some((f) => f.name === 'hero.png'), 'run-over screen shows the build card');
  assert.ok(!(over.embeds[0].toJSON().fields ?? []).some((f) => f.name === 'Build'), 'run-over screen drops the text build');
  const replace = await dviews.offerView(member(id), d, { replace: 1 });
  checkLimits(replace, 'replace');
  assert.strictEqual(replace.embeds[0].toJSON().image.url, 'attachment://hero.png');
  assert.ok(replace.files.some((f) => f.name === 'hero.png'), 'replacement screen shows the current build card');
  const animated = await dviews.offerView(member(id), d, { animate: true });
  checkLimits(animated, 'animated offer');
  assert.strictEqual(animated.embeds[0].toJSON().image.url, 'attachment://pick.gif');
  checkLimits(await dviews.offerView(member(id), { ...d, offer: { kind: 'legendaries', choices: LEGENDARY_NAMES.slice(0, 3), room: 15 } }), 'legendaries');
  checkLimits(await dviews.buildView(member(id), d), 'build');
  checkLimits(await dviews.roomView(member(id), { ...d, phase: 'ready' }, { quit: true, note: 'Took **X**.' }), 'abandon');
  checkLimits(dviews.leaderboardView(member(id), [{ id, rooms: 12, hero: 'Haze' }], { ...record, bestDescent: { rooms: 12, hero: 'Haze' }, descentBest: { Haze: 12 } }), 'leaderboard');
  checkLimits(dviews.tokenView('Haze'), 'token');
});

test('the buttons: begin, fight, pick, build, back, abandon; only the runner may press them', async () => {
  const id = 'd4';
  const cmd = fake(id);
  await descend.execute({ ...cmd, options: { getSubcommand: () => 'run' } });
  assert.match(cmd.log.at(-1)[1].embeds[0].toJSON().title, /Pick Your Hero/, 'a first hero comes from /base');
  await chooseHero(id, 'Haze');
  const start = fake(id);
  await descend.execute({ ...start, options: { getSubcommand: () => 'run' } });
  assert.strictEqual(start.log.at(-1)[1].embeds[0].toJSON().footer.text, 'Pick a Hero you have unlocked.');
  const sel = fake(id, `farm_dhero:${id}`, { values: ['Haze'] });
  await route('Descend hero select').execute(sel);
  assert.strictEqual(sel.log.at(-1)[1].components.at(-1).toJSON().components[0].custom_id, `farm_dbegin:${id}:Haze`);
  const begin = fake(id, `farm_dbegin:${id}:Haze`);
  await route('Descend begin button').execute(begin);
  assert.match(begin.log.at(-1)[1].embeds[0].toJSON().title, /^Floor 1 {2}- {2}Room 1/);
  const stranger = fake('someone', `farm_dfight:${id}:1`);
  await route('Descend fight button').execute(stranger);
  assert.ok(stranger.log.some(([k]) => k === 'reply'), 'not theirs');
  assert.strictEqual((await D.getRun(id)).room, 1);
  const go = fake(id, `farm_dfight:${id}:1`);
  await route('Descend fight button').execute(go);
  const [, result] = go.log.findLast(([k]) => k === 'followUp');
  if ((await D.getRun(id))?.phase === 'offer') {
    assert.match(result.embeds[0].toJSON().title, /Room 1 Cleared/);
    assert.ok(result.files.some((f) => f.name === 'pick.gif'), 'the cylinder spins the first time');
    const rows = result.components.map((r) => r.toJSON().components.map((c) => c.label).filter(Boolean));
    assert.ok(rows.some((labels) => labels.length === 4 && labels.some((label) => label.startsWith('Skip'))), 'the three picks and Skip share a row');
    assert.ok(rows.some((labels) => labels.includes('Build') && labels.includes('Damage Breakdown')), 'Build and Damage Breakdown share a row');
    const take = fake(id, `farm_dtake:${id}:1:1`);
    await route('Descend pick button').execute(take);
    assert.match(take.log.at(-1)[1].embeds[0].toJSON().description, /^Took \*\*/);
    const build = fake(id, `farm_dbuild:${id}`);
    await route('Descend build button').execute(build);
    assert.match(build.log.at(-1)[1].embeds[0].toJSON().title, /This Run/);
    const back = fake(id, `farm_dback:${id}`);
    await route('Descend back button').execute(back);
    assert.match(back.log.at(-1)[1].embeds[0].toJSON().title, /Room 2/);
  }
  const quit = fake(id, `farm_dquit:${id}`);
  await route('Descend abandon button').execute(quit);
  assert.match(quit.log.at(-1)[1].embeds[0].toJSON().description, /Abandon the run\?/);
  const yes = fake(id, `farm_dquit:${id}:yes`);
  await route('Descend abandon button').execute(yes);
  assert.strictEqual(await D.getRun(id), null);
  const board = fake(id);
  await descend.execute({ ...board, options: { getSubcommand: () => 'leaderboard' } });
  assert.strictEqual(board.log.at(-1)[1].embeds[0].toJSON().title, 'Descend Leaderboard');
});
