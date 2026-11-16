// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
process.env.DESCEND_V = '7'; // these checks are about the fixed rooms from before Two Doors (test/doors.test.js has the doors)
const test = require('./group')(__filename);
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
require('../src/utils/games/trivia').loadStreakEmojis({
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
    assert.deepStrictEqual(D.roomSpec(seed, D.LAST_ROOM, 'Haze'), { room: 40, floor: 8, ascension: 0, kind: 'boss', boss: 'patron', final: true });
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
  // A tier-4 offer recognises a tier-2 component even if its tier-3 middle item was never held.
  d.phase = 'offer';
  d.items = { weapon: [], vitality: [], spirit: ['Compress Cooldown'] };
  d.offer = { kind: 'items', choices: ['Transcendent Cooldown'], room: 3 };
  const nested = D.takeChoice(d, 0);
  assert.deepStrictEqual(nested.used, ['Compress Cooldown']);
  assert.deepStrictEqual(d.items.spirit, ['Transcendent Cooldown']);
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
  // At a full build an upgrade takes its component's place and there is no BONUS (no question asked); with room left, the BONUS comes too.
  d.items = { weapon: POOL.weapon.filter((n) => !D.NO_RUN_ITEMS.has(n)).slice(0, 4), vitality: POOL.vitality.filter((n) => !D.NO_RUN_ITEMS.has(n)).slice(0, 4), spirit: ['Compress Cooldown', ...POOL.spirit.filter((n) => !D.NO_RUN_ITEMS.has(n) && n !== 'Compress Cooldown').slice(0, 3)] };
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Transcendent Cooldown'], bonuses: { 0: 'Mystic Burst' }, room: 4 };
  d.items.spirit = d.items.spirit.filter((n) => n !== 'Mystic Burst').concat('Spirit Strike'); // keep the fill clear of the BONUS
  const upgradeFull = D.takeChoice(d, 0);
  assert.ok(upgradeFull.ok && !upgradeFull.bonus && d.phase === 'ready');
  assert.ok(d.items.spirit.includes('Transcendent Cooldown') && !d.items.spirit.includes('Compress Cooldown') && !d.items.spirit.includes('Mystic Burst'));
  assert.strictEqual(countItems(d.items), MAX_ITEMS);
  d.items.weapon.pop(); // room for the BONUS
  d.items.spirit = ['Compress Cooldown', ...d.items.spirit.filter((n) => n !== 'Transcendent Cooldown')];
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Transcendent Cooldown'], bonuses: { 0: 'Mystic Burst' }, room: 4 };
  assert.strictEqual(D.takeChoice(d, 0).bonus, 'Mystic Burst');
  assert.strictEqual(countItems(d.items), MAX_ITEMS);
  // an offer never carries a BONUS the build has no room for
  for (let seed = 1; seed <= 60; seed++) {
    const run = D.newRun('Haze', seed);
    run.items = { weapon: POOL.weapon.filter((n) => !D.NO_RUN_ITEMS.has(n)).slice(0, 4), vitality: POOL.vitality.filter((n) => !D.NO_RUN_ITEMS.has(n)).slice(0, 4), spirit: ['Compress Cooldown', ...POOL.spirit.filter((n) => !D.NO_RUN_ITEMS.has(n) && n !== 'Compress Cooldown').slice(0, 3)] }; // 12 items: an upgrade (-1 +1) leaves no room
    assert.deepStrictEqual(D.itemOffer(run, D.dice(run.seed, 1, 'offer'), 3, 20).bonuses, {}, 'no room, no BONUS');
  }
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
  const skipped = D.skipChoice(d);
  assert.ok(skipped.ok);
  assert.strictEqual(d.health, 0.5 + D.SKIP_HEAL);
  assert.strictEqual(skipped.buffs.length, D.SKIP_BUFFS);
  assert.strictEqual(Object.values(d.buffs).reduce((sum, count) => sum + count, 0), D.BOSS_BUFFS + D.SKIP_BUFFS);
  assert.strictEqual(d.offer, null);
  // skipping a boss's buff pick only heals: no buffs, or skipping would beat taking it
  const before = Object.values(d.buffs).reduce((sum, count) => sum + count, 0);
  d.health = 0.5;
  d.phase = 'offer';
  d.offer = { kind: 'buffs', choices: ['fireRate', 'maxHealth', 'spiritPower'], room: 10 };
  assert.deepStrictEqual(D.skipChoice(d).buffs, []);
  assert.strictEqual(d.health, 0.5 + D.SKIP_HEAL);
  assert.strictEqual(Object.values(d.buffs).reduce((sum, count) => sum + count, 0), before);
  // skipping a legendary (after a boss's full heal): 6 buffs, no heal
  d.phase = 'offer';
  d.offer = { kind: 'legendaries', choices: LEGENDARY_NAMES.slice(0, 3), room: 15 };
  assert.strictEqual(D.skipChoice(d).buffs.length, D.LEGEND_SKIP_BUFFS);
  assert.strictEqual(d.health, 0.5 + D.SKIP_HEAL);
});

test('rerolls: 3 a floor, the same new offer every time for a seed, never below 0, boss rewards stay, a boss win refills them', () => {
  const win = (d, room) => { d.room = room; D.afterWin(d, { spec: D.roomSpec(d.seed, room, 'Haze'), health: 1, rejuvsUsed: 0, kept: {} }); };
  const a = D.newRun('Haze', 21);
  const b = D.newRun('Haze', 21);
  assert.strictEqual(a.rerolls, D.REROLLS_PER_FLOOR);
  win(a, 1); win(b, 1);
  const first = a.offer;
  assert.deepStrictEqual(D.rerollChoice(a), { ok: true });
  D.rerollChoice(b);
  assert.deepStrictEqual(a.offer, b.offer, 'the rerolled offer comes from the seed, so a restart cannot farm it');
  assert.notDeepStrictEqual(a.offer.choices, first.choices);
  assert.strictEqual(a.offer.room, 1);
  D.rerollChoice(a); D.rerollChoice(a);
  assert.strictEqual(a.rerolls, 0);
  const kept = JSON.stringify(a.offer);
  assert.deepStrictEqual(D.rerollChoice(a), { error: 'empty' });
  assert.strictEqual(a.rerolls, 0, 'never below 0');
  assert.strictEqual(JSON.stringify(a.offer), kept, 'an empty reroll changes nothing');
  win(a, 4);
  assert.strictEqual(a.rerolls, 0, 'rerolls do not refill mid-floor');
  win(a, 5);
  assert.strictEqual(a.rerolls, D.REROLLS_PER_FLOOR, 'the boss ends the floor: the next one starts with 3');
  assert.deepStrictEqual(D.rerollChoice(a), { error: 'none' }, 'a boss reward (buffs or legendaries) is not rerolled');
});

test('buff finds: a seeded roll after a fight (about 10% little, 5% big), none after a boss, little ones stay, big ones last the floor', () => {
  const finds = { little: 0, big: 0, none: 0 };
  const firstSeed = {};
  for (let seed = 1; seed <= 2000; seed++) {
    const d = D.newRun('Haze', seed);
    const spec = D.roomSpec(seed, 1, 'Haze');
    const find = D.rollFind(d, spec);
    assert.deepStrictEqual(find, D.rollFind(d, spec), 'the same seed finds the same thing, so a restart cannot reroll it');
    finds[find?.kind ?? 'none']++;
    if (find) firstSeed[find.kind] ??= seed;
  }
  assert.ok(finds.little > 140 && finds.little < 260, `little finds ${finds.little} of 2000`);
  assert.ok(finds.big > 55 && finds.big < 145, `big finds ${finds.big} of 2000`);
  const boss = D.newRun('Haze', 3);
  assert.strictEqual(D.rollFind(boss, D.roomSpec(3, 5, 'Haze')), null, 'a boss gives its own reward, not a find');
  // a little find is a permanent stack
  const little = D.newRun('Haze', firstSeed.little);
  D.afterWin(little, { spec: D.roomSpec(firstSeed.little, 1, 'Haze'), health: 1, rejuvsUsed: 0, kept: {} });
  assert.strictEqual(little.buffs[little.find.key], 1);
  // a big find is held, never twice, in the fight kit, and used up by the floor's boss
  const big = D.newRun('Haze', firstSeed.big);
  D.afterWin(big, { spec: D.roomSpec(firstSeed.big, 1, 'Haze'), health: 1, rejuvsUsed: 0, kept: {} });
  assert.deepStrictEqual(big.bridge, [big.find.key]);
  assert.deepStrictEqual(D.runKit(big).bridge, big.bridge);
  const again = D.rollFind({ ...big, seed: firstSeed.big }, D.roomSpec(firstSeed.big, 1, 'Haze'));
  assert.ok(!again || again.kind !== 'big' || again.key !== big.find.key, 'a Bridge type already held is not found again');
  big.room = 5;
  D.afterWin(big, { spec: D.roomSpec(firstSeed.big, 5, 'Haze'), health: 1, rejuvsUsed: 0, kept: {} });
  assert.deepStrictEqual(big.bridge, [], 'the boss uses the floor Bridge buffs up');
});

test('an imbue item pauses Descend until an unlocked ability is chosen', () => {
  const d = D.newRun('Haze', 1);
  d.level = 2; // abilities one and two are unlocked after the room clear
  d.phase = 'offer';
  d.offer = { kind: 'items', choices: ['Mystic Expansion'], room: 2 };
  const taken = D.takeChoice(d, 0);
  assert.ok(taken.ok);
  assert.strictEqual(d.phase, 'imbue');
  assert.strictEqual(d.imbuing, 'Mystic Expansion');
  assert.strictEqual(d.imbues['Mystic Expansion'], undefined, 'never silently assigned to ability one');
  assert.deepStrictEqual(D.setImbue(d, 3), { error: 'locked' });
  assert.deepStrictEqual(D.setImbue(d, 2), { ok: true, name: 'Mystic Expansion', slot: 2, more: undefined });
  assert.strictEqual(d.phase, 'ready');
  assert.strictEqual(d.imbues['Mystic Expansion'], 2);
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
  assert.deepStrictEqual(rows[0], { id, rooms: 38, hero: 'Haze', ascension: 0, clears: 0 });
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
    assert.ok(D.PATRONS.includes(run.spec.patron), 'the Archmother or the Hidden King (Nov 4)');
    assert.deepStrictEqual(run.stageNames, [D.BOSSES[run.spec.patron].name, D.BOSSES[`${run.spec.patron}-weak`].name]);
    assert.strictEqual(run.complete.clears, 1);
    const r = await getFarmUser(id);
    assert.strictEqual(r.descent, undefined, 'the run is over');
    assert.deepStrictEqual([r.bestDescent.rooms, r.descentClears], [D.LAST_ROOM, 1]);
    const top = (await D.leaderboard()).find((row) => row.id === id);
    assert.deepStrictEqual(top, { id, rooms: 40, hero: 'Haze', ascension: 0, clears: 1 });
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
      if (spec.kind === 'broker') continue; // (a stall has no fight: its own test below)
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
  assert.strictEqual(over.embeds[0].toJSON().image.url, 'attachment://hero.jpg');
  assert.ok(over.files.some((f) => f.name === 'hero.jpg'), 'run-over screen shows the build card');
  assert.ok(!(over.embeds[0].toJSON().fields ?? []).some((f) => f.name === 'Build'), 'run-over screen drops the text build');
  const replace = await dviews.offerView(member(id), d, { replace: 1 });
  checkLimits(replace, 'replace');
  assert.strictEqual(replace.embeds[0].toJSON().image.url, 'attachment://hero.jpg');
  assert.ok(replace.files.some((f) => f.name === 'hero.jpg'), 'replacement screen shows the current build card');
  assert.equal(replace.components[0].toJSON().components[0].options.length, MAX_ITEMS, 'replacement lists all twelve held items');
  const animated = await dviews.offerView(member(id), d, { animate: true });
  checkLimits(animated, 'animated offer');
  assert.strictEqual(animated.embeds[0].toJSON().image.url, 'attachment://pick.gif');
  const enhancedOffer = await dviews.offerView(member(id), { ...d, offer: { kind: 'items', choices: ['Extra Health'], enhanced: ['Extra Health'], room: 1 } });
  assert.strictEqual(enhancedOffer.embeds[0].toJSON().fields.find((field) => field.name === 'Item Choices').value, 'Select an Item in the drop\ndown below to view its effect.');
  const viewMenu = enhancedOffer.components.map((r) => r.toJSON().components[0]).find((c) => c.custom_id?.startsWith(dviews.DVIEW_ID));
  assert.deepStrictEqual(viewMenu.options.map((o) => o.label), ['[Enhanced] Extra Health'], 'View Item lists the choices');
  assert.ok(enhancedOffer.components.findIndex((r) => r.toJSON().components[0].custom_id === viewMenu.custom_id) <enhancedOffer.components.findIndex((r) => r.toJSON().components[0].custom_id?.startsWith(dviews.DTAKE_ID)), 'View Item sits above the picks');
  const about = (offer, i = 0) => dviews.choiceAbout({ ...d, offer }, i);
  assert.match(about({ kind: 'items', choices: ['Extra Health'], enhanced: ['Extra Health'], room: 1 }), /^\[Enhanced\] \*\*Extra Health\*\*\n\*\*Vitality\*\* ; __Tier 1__/);
  assert.doesNotMatch(about({ kind: 'items', choices: ['Diviner\'s Kevlar'], room: 1 }), /\*\*Enhanced:\*\*/);
  const ballisticChoices = about({ kind: 'items', choices: ['Ballistic Enchantment'], enhanced: ['Ballistic Enchantment'], room: 1 });
  assert.match(ballisticChoices, /Weapon Damage per Hero Hit: \*\*\+20% → \+35%\*\*/);
  assert.match(ballisticChoices, /Ability Range: \*\*\+22% → \+37%\*\*/);
  assert.doesNotMatch(ballisticChoices, /Improved effect/);
  assert.ok(require('../src/utils/farm/descentCard').choicesOf({ kind: 'legendaries', choices: LEGENDARY_NAMES.slice(0, 2), enhanced: [LEGENDARY_NAMES[1]] }).map((c) => c.enhanced).join() === 'false,true', 'an enhanced legendary is drawn enhanced');
  const buffOffer = await dviews.offerView(member(id), { ...d, offer: { kind: 'buffs', choices: ['maxHealth'], room: 5 } });
  assert.ok(buffOffer.embeds[0].toJSON().fields.some((field) => field.name === 'Buff Choices'));
  checkLimits(await dviews.offerView(member(id), { ...d, offer: { kind: 'legendaries', choices: LEGENDARY_NAMES.slice(0, 3), room: 15 } }), 'legendaries');
  checkLimits(await dviews.buildView(member(id), d), 'build');
  checkLimits(await dviews.roomView(member(id), { ...d, phase: 'ready' }, { quit: true, note: 'Took **X**.' }), 'abandon');
  checkLimits(dviews.leaderboardView(member(id), [{ id, rooms: 12, hero: 'Haze' }], { ...record, bestDescent: { rooms: 12, hero: 'Haze' }, descentBest: { Haze: 12 } }), 'leaderboard');
  checkLimits(dviews.tokenView('Haze'), 'token');
});

test('the start screen uses the requested paragraphs and separates the best run from the others', async () => {
  const record = { bestDescent: { hero: 'Vyper', rooms: 29 }, descentBest: { Vyper: 29, Haze: 18, Abrams: 7 }, hero: 'Vyper', heroes: {} };
  const view = await dviews.startView(member('start-format'), record);
  const e = view.embeds[0].toJSON();
  assert.match(e.description, /\*\*8 Floors, 40 Rooms,\*\* starting/);
  assert.match(e.description, /Room\*\* is \*\*Cleared/);
  assert.match(e.description, /A \*\*Patron\*\* \(the Archmother or the\nHidden King\) waits at the bottom/);
  assert.deepStrictEqual(e.fields.map((f) => [f.name, f.value]), [
    ['Your Best Runs', 'Vyper  -  **29 Rooms**'],
    ['Other Runs.', 'Haze  -  **18 Rooms**\nAbrams  -  **7 Rooms**'],
  ]);
  assert.strictEqual(e.footer.text, 'Pick a Hero that you have unlocked.');
});

test('the buttons: begin, fight, pick, build, back, abandon; only the runner may press them', async () => {
  const id = 'd4';
  const cmd = fake(id);
  await descend.execute({ ...cmd, options: { getSubcommand: () => 'run', getString: () => null, getInteger: () => null } });
  assert.match(cmd.log.at(-1)[1].embeds[0].toJSON().title, /Pick Your Hero/, 'a first hero comes from /base');
  await chooseHero(id, 'Haze');
  const start = fake(id);
  await descend.execute({ ...start, options: { getSubcommand: () => 'run', getString: () => null, getInteger: () => null } });
  assert.strictEqual(start.log.at(-1)[1].embeds[0].toJSON().footer.text, 'Pick a Hero that you have unlocked.');
  const sel = fake(id, `farm_dhero:${id}`, { values: ['Haze'] });
  await route('Descend hero select').execute(sel);
  assert.strictEqual(sel.log.at(-1)[1].components.at(-1).toJSON().components[0].custom_id, `farm_dbegin:${id}:Haze:0`);
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
    const resultEmbed = result.embeds[0].toJSON();
    assert.equal(resultEmbed.author.name, 'Descend  -  Ascension 0');
    assert.equal(resultEmbed.title, undefined);
    assert.match(resultEmbed.description, /reached \*\*Level 1\*\*\.(?:\n\nFound[\s\S]+?)?\n\nPick \*\*1 of 3\*\* items, or Skip: Heal \*\*25%\*\* and \*\*3 Perma-Buffs\*\*\./);
    assert.equal(resultEmbed.fields.find((field) => field.name === 'Level').value, '**1**');
    assert.ok(result.files.some((f) => f.name === 'pick.gif'), 'the cylinder spins the first time');
    const rows = result.components.map((r) => r.toJSON().components.map((c) => c.label).filter(Boolean));
    assert.ok(rows.some((labels) => labels.length === 3 && !labels.some((label) => label.startsWith('Skip'))), 'the three item picks share the first row');
    assert.ok(rows.some((labels) => labels.includes('Skip ; Heal 25% and gain 3 Buffs') && labels.includes('Your Build') && labels.includes('Reroll (3 Left)')), 'Skip, Build and Reroll share the second row');
    assert.ok(go.log.some(([kind, payload]) => kind === 'editReply' && payload.components?.some((r) => r.toJSON().components.some((c) => c.label === 'Damage Breakdown'))), 'the completed fight holds Damage Breakdown');
    const reroll = fake(id, `farm_dreroll:${id}:1`);
    await route('Descend reroll button').execute(reroll);
    assert.ok(reroll.log.at(-1)[1].files.some((f) => f.name === 'pick.gif'), 'a reroll spins the cylinder again');
    assert.ok(reroll.log.at(-1)[1].components.some((r) => r.toJSON().components.some((c) => c.label === 'Reroll (2 Left)')));
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

test('an upgrade with room for its BONUS, an imbue item: the screens and selects walk through without stranding the run', async () => {
  const id = 'd9';
  await chooseHero(id, 'Haze');
  await D.startRun(id, 'Haze', 3);
  await updateFarmUser(id, (r) => {
    const d = r.descent;
    d.level = 2;
    d.phase = 'offer';
    d.items = { weapon: POOL.weapon.filter((n) => !D.NO_RUN_ITEMS.has(n)).slice(0, 3), vitality: POOL.vitality.filter((n) => !D.NO_RUN_ITEMS.has(n)).slice(0, 4), spirit: ['Compress Cooldown', ...POOL.spirit.filter((n) => !D.NO_RUN_ITEMS.has(n) && n !== 'Compress Cooldown').slice(0, 3)] };
    d.offer = { kind: 'items', choices: ['Transcendent Cooldown'], bonuses: { 0: 'Mystic Expansion' }, enhanced: [], room: 1 };
  });
  const taken = await D.choose(id, 1, 0);
  assert.ok(taken.ok && taken.bonus === 'Mystic Expansion');
  let d = await D.getRun(id);
  assert.strictEqual(d.phase, 'imbue', 'both are in; the imbue item asks for its ability');
  assert.strictEqual(countItems(d.items), MAX_ITEMS);
  checkLimits(await dviews.screen(member(id), await getFarmUser(id)), 'the imbue screen');
  assert.deepStrictEqual(await D.fight(id), { error: 'offer' });
  const imbue = fake(id, `farm_dimbue:${id}`, { values: ['2'] });
  await route('Descend imbue ability select').execute(imbue);
  d = await D.getRun(id);
  assert.strictEqual(d.phase, 'ready');
  assert.strictEqual(d.imbues['Mystic Expansion'], 2);
  checkLimits(await dviews.screen(member(id), await getFarmUser(id)), 'the next room');
  await D.abandon(id);
});

test('View Enemy Build in a room: Fight / Flee / Your Build, then View Enemy Build / Abandon Run; each room kind answers privately', async () => {
  const id = 'd-enemy';
  await chooseHero(id, 'Haze');
  await route('Descend begin button').execute(fake(id, `farm_dbegin:${id}:Haze`));
  const room = await dviews.roomView(member(id), await D.getRun(id));
  assert.deepStrictEqual(room.components.map((r) => r.toJSON().components.map((c) => c.label)), [['Fight', 'Abandon Run'], ['Your Build', "Enemy's Build"]]);
  const ask = async (customId) => { const i = fake(id, customId); await route('Descend enemy build button').execute(i); return i.log.find(([k]) => k === 'editReply')[1]; };
  const fight = await ask(`farm_denemy:${id}:1`);
  checkLimits(fight, 'fight room build');
  assert.match(fight.embeds[0].toJSON().title, /^Enemy Build {2}- {2}Room 1/);
  assert.ok(fight.embeds[0].toJSON().fields.filter((f) => f.name !== 'Counters').every((f) => /^- \*\*Health:\*\* /.test(f.value)), 'each enemy is bullet points, health first');
  const stranger = fake('someone', `farm_denemy:${id}:1`); // anyone may look: the owner's room, privately
  await route('Descend enemy build button').execute(stranger);
  assert.match(stranger.log.find(([k]) => k === 'editReply')[1].embeds[0].toJSON().title, /^Enemy Build {2}- {2}Room 1/);
  const theirBuild = fake('someone', `farm_dbuild:${id}`);
  await route('Descend build button').execute(theirBuild);
  const built = theirBuild.log.find(([k]) => k === 'editReply')[1];
  assert.ok(theirBuild.log[0][0] === 'deferReply' && built.components.length === 0 && built.content === `<@${id}>'s run.`);
  // a boss room and a rival room (found by walking the seed): the boss lists its crowd control, the rival draws its card
  const seed = Array.from({ length: 500 }, (_, i) => i + 1).find((n) => Array.from({ length: 12 }, (_, r) => D.roomSpec(n, r + 3, 'Haze', 0, D.newRun('Haze', 1).v)).some((sp) => sp.kind === 'rival')); // a seed with a rival early (the run's own version: hero rooms take some rival rooms)
  await updateFarmUser(id, (r) => { r.descent.seed = seed; });
  const roomOfKind = (kind) => Array.from({ length: 40 }, (_, i) => i + 1).find((r) => D.roomSpec(seed, r, 'Haze', 0, D.newRun('Haze', 1).v).kind === kind);
  for (const kind of ['boss', 'rival']) {
    const n = roomOfKind(kind);
    assert.ok(n, `this seed has a ${kind} room`);
    await updateFarmUser(id, (r) => { r.descent.room = n; });
    const view = await ask(`farm_denemy:${id}:${n}`);
    checkLimits(view, `${kind} room build`);
    if (kind === 'boss') assert.match(view.embeds[0].toJSON().title, /^Enemy Build {2}- {2}The /);
    else assert.ok(view.files.some((f) => f.name === 'rival-build.jpg'), 'a rival shows its drawn card');
  }
  // a room that has moved on is out of date
  await updateFarmUser(id, (r) => { r.descent.room = 2; });
  assert.strictEqual((await ask(`farm_denemy:${id}:1`)).content, 'That screen is out of date. Here is where your run stands.');
});

test('an upgrade of an enhanced item stays enhanced', () => {
  const d = D.newRun('Haze', 1);
  d.items.spirit = ['Compress Cooldown'];
  d.enhanced = ['Compress Cooldown'];
  assert.ok(D.addItem(d, 'Transcendent Cooldown').ok);
  assert.deepStrictEqual(d.items.spirit, ['Transcendent Cooldown']);
  assert.deepStrictEqual(d.enhanced, ['Transcendent Cooldown']);
  const plain = D.newRun('Haze', 1);
  plain.items.spirit = ['Compress Cooldown'];
  D.addItem(plain, 'Transcendent Cooldown');
  assert.deepStrictEqual(plain.enhanced, []);
});

test('View Item: the owner\'s Item Choices text becomes that item; anyone else sees it privately', async () => {
  const id = 'view-item';
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => {
    r.descent = D.newRun('Haze', 7);
    r.descent.phase = 'offer';
    r.descent.offer = { kind: 'items', choices: ['Extra Health', 'Extra Spirit', 'Close Quarters'], enhanced: [], room: 1 };
  });
  const view = await dviews.offerView(member(id), (await getFarmUser(id)).descent);
  // as Discord hands the message back: the embed's pictures are CDN links to the message's attachments
  const sent = view.embeds[0].toJSON();
  const pic = sent.image.url.replace('attachment://', '');
  sent.image.url = `https://cdn.discordapp.com/attachments/1/2/${pic}?ex=1`;
  const message = { embeds: [{ toJSON: () => structuredClone(sent) }], components: view.components, attachments: view.files.map((f) => ({ name: f.name, url: `https://cdn.discordapp.com/attachments/1/2/${f.name}?ex=1` })) };
  const customId = `${dviews.DVIEW_ID}:${id}:1`;
  const select = route('Descend view item select');
  const owner = fake(id, customId, { isStringSelectMenu: () => true, values: ['1'], message });
  assert.ok(select.matches(owner));
  await select.execute(owner);
  assert.strictEqual(owner.log[0][0], 'deferUpdate');
  const [kind, p] = owner.log[1];
  assert.strictEqual(kind, 'editReply');
  // an edit's attachment:// only reaches files uploaded with it (Oct 29: the pictures showed loose above the embed)
  assert.deepStrictEqual(p.files.map((f) => f.name), view.files.map((f) => f.name), "the message's own files go up again");
  assert.deepStrictEqual(p.attachments, [], 'replacing the old ones');
  assert.strictEqual(p.embeds[0].image.url, `attachment://${pic}`, 'and stays inside the embed');
  assert.match(p.embeds[0].fields.find((f) => f.name === 'Item Choices').value, /^\*\*Extra Spirit\*\*/);
  const menu = p.components.flatMap((r) => r.components).find((c) => c.custom_id === customId);
  assert.deepStrictEqual(menu.options.map((o) => !!o.default), [false, true, false]);
  const other = fake('someone-else', customId, { isStringSelectMenu: () => true, values: ['2'], message });
  await select.execute(other);
  assert.strictEqual(other.log[0][0], 'reply');
  assert.match(other.log[0][1].content, /^\*\*Close Quarters\*\*/);
});

test('floors: 1 lane troopers, 2 small Haunts, 3 medium and small, 4 large and medium, 5 camps and troopers, 6 the base, 7 the base and troopers, 8 everything', () => {
  const seen = Array.from({ length: D.FLOORS }, () => new Set());
  for (let seed = 1; seed <= 150; seed++) for (let room = 1; room < D.LAST_ROOM; room++) {
    const spec = D.roomSpec(seed, room, 'Haze');
    if (spec.kind !== 'fight') continue;
    for (const g of spec.groups) {
      seen[spec.floor - 1].add(g.type);
      assert.ok(D.FLOOR_ENEMIES[spec.floor - 1].includes(g.type), `room ${room}: ${g.type}`);
      if (D.ARCHETYPES[g.type].size) assert.ok(D.FAMILIES[D.ARCHETYPES[g.type].size].includes(g.family), 'a Haunt has a family of its size');
      else assert.strictEqual(g.family, undefined);
    }
  }
  assert.deepStrictEqual([...seen[0]].sort(), ['medicTrooper', 'meleeTrooper', 'trooper']);
  assert.deepStrictEqual([...seen[1]], ['small']);
  assert.deepStrictEqual([...seen[2]].sort(), ['medium', 'small']);
  assert.deepStrictEqual([...seen[3]].sort(), ['large', 'medium']);
  // a Haunt fights as its family: the name, the picture, its special (medium and large only, like the game)
  const [sleepy] = D.unitsOf({ room: 12, floor: 3, ascension: 0, groups: [{ type: 'medium', family: 'past_due', affix: null }] });
  assert.strictEqual(sleepy.name, 'Medium Past Due');
  assert.strictEqual(sleepy.stats.special.name, 'Book Barrage');
  const [small] = D.unitsOf({ room: 7, floor: 2, ascension: 0, groups: [{ type: 'small', family: 'past_due', affix: null }] });
  assert.ok(!small.stats.special, 'small Haunts have no special');
  const spec = { room: 12, floor: 3, ascension: 0, kind: 'fight', groups: [{ type: 'medium', family: 'past_due', affix: null }, { type: 'medium', family: 'past_due', affix: null }, { type: 'small', family: 'specimen', affix: null }] };
  assert.strictEqual(D.roomLine(spec), '2 Medium Past Dues, 1 Small Specimen');
  assert.match(D.roomPicture(spec), /past_due_medium\.png$/);
  assert.match(D.groupSpecial(spec.groups[0]), /^Book Barrage: .*asleep/);
  assert.ok(require('node:fs').existsSync(D.roomPicture(spec)));
  for (const [size, families] of Object.entries(D.FAMILIES)) for (const f of families) assert.ok(require('node:fs').existsSync(D.groupPicture({ type: size, family: f })), `${f} ${size}`);
});

test('a beaten rival offers any one of its own items from a dropdown, no reroll; nothing it can take: the usual 3', async () => {
  const d = { ...D.newRun('Haze', 7), room: 4, level: 3, phase: 'offer' };
  d.items.weapon.push('Headshot Booster');
  const spec = { room: 3, floor: 1, kind: 'rival', rival: 'Abrams' };
  const theirs = { boons: 1, unlocked: 2, tiers: {}, items: ['Headshot Booster', 'Extra Health', 'Mystic Burst', 'Extra Health'], buffs: {} };
  d.offer = D.rollOffer(d, spec, 0, theirs);
  assert.deepStrictEqual([d.offer.rival, d.offer.choices], ['Abrams', ['Extra Health', 'Mystic Burst']], 'what it carried, minus what the hero holds');
  assert.strictEqual(D.rerollChoice(d).error, 'none');
  const view = await dviews.offerView(member('rival-offer'), d);
  checkLimits(view, 'rival offer');
  const take = view.components.map((r) => r.toJSON().components[0]).find((c) => c.custom_id === `${dviews.DTAKE_ID}:rival-offer:3`);
  assert.deepStrictEqual(take.options.map((o) => o.label), ['Extra Health', 'Mystic Burst']);
  assert.ok(view.files.some((f) => f.name === 'pick.png'), 'its build card is the picture');
  assert.strictEqual(D.takeChoice(d, 1).name, 'Mystic Burst');
  assert.strictEqual(D.rollOffer({ ...d, offer: null }, spec, 0, { ...theirs, items: ['Headshot Booster'] }).rival, undefined);
});

test('a rival has as many enhanced items as the hero; a beaten rival\'s enhanced item is offered, and taken, enhanced', () => {
  const d = { ...D.newRun('Haze', 7), room: 4, level: 9, phase: 'offer', enhanced: ['Headshot Booster', 'Extra Health'] };
  d.items.weapon.push('Headshot Booster'); d.items.vitality.push('Extra Health');
  const spec = { room: 3, floor: 1, kind: 'rival', rival: 'Abrams' };
  const theirs = D.enemiesOf(d, spec).kit;
  assert.strictEqual(theirs.enhanced.length, 2, 'two, like the hero');
  assert.ok(theirs.enhanced.every((n) => theirs.items.includes(n)), 'on its own items');
  assert.deepStrictEqual(D.enemiesOf(d, spec).kit, theirs, 'rolled from the seed');
  assert.strictEqual(D.enemiesOf({ ...d, enhanced: [] }, spec).kit.enhanced, undefined, 'none when the hero has none');
  const offer = D.rollOffer({ ...d, items: { weapon: [], vitality: [], spirit: [] } }, spec, 0, { ...theirs, items: ['Extra Health', 'Mystic Burst'], enhanced: ['Mystic Burst'] });
  assert.deepStrictEqual(offer.enhanced, ['Mystic Burst']);
  const e = { ...d, items: { weapon: [], vitality: [], spirit: [] }, enhanced: [], offer };
  assert.deepStrictEqual([D.takeChoice(e, 1).enhanced, e.enhanced], [true, ['Mystic Burst']]);
});

test('the Broker\'s stall: from room 6, never a boss room or beside a rival or another stall, at most 3 a run; corrupting costs health and can be done again', async () => {
  const stalls = [];
  let most = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const kinds = Array.from({ length: D.LAST_ROOM }, (_, i) => D.roomSpec(seed, i + 1, 'Haze').kind);
    most = Math.max(most, kinds.filter((k) => k === 'broker').length);
    kinds.forEach((kind, i) => {
      if (kind !== 'broker') return;
      stalls.push([seed, i + 1]);
      assert.ok(i + 1 >= D.BROKER_FROM && (i + 1) % D.ROOMS_PER_FLOOR !== 0, 'not before room 6, not a boss room');
      assert.ok(kinds[i - 1] !== 'rival' && kinds[i - 1] !== 'broker', 'not right after a rival or a stall');
    });
  }
  assert.ok(stalls.length > 0, 'stalls turn up');
  assert.strictEqual(most, D.BROKER_MAX, 'some runs hit the cap, none pass it');
  assert.ok(D.LAST_ROOM - 1 - D.BROKER_MAX >= 35 && D.LAST_ROOM - D.FLOORS - D.BROKER_MAX >= 12, 'the cap leaves rooms for level 35 and 12 items');
  const [seed, room] = stalls[0];

  const eligible = POOL.weapon.concat(POOL.vitality, POOL.spirit).filter((n) => itemByName(n).CorruptedUpgrades);
  const [name, other] = eligible;
  const d = { ...D.newRun('Haze', seed), room, level: 6 };
  assert.deepStrictEqual(D.corrupt(d, name), { error: 'item' }, 'it has to be held');
  const slot = (n) => ({ Weapon: 'weapon', Armor: 'vitality', Tech: 'spirit' }[itemByName(n).Slot]);
  d.items[slot(name)].push(name);
  d.items[slot(other)].push(other);
  const view = await dviews.roomView(member('stall'), d);
  checkLimits(view, 'the stall');
  const json = view.embeds[0].toJSON();
  assert.strictEqual(json.description, 'The Broker\'s stall calls to you. The Broker can corrupt one of your items, but it\'ll cost ya...');
  assert.ok(json.footer.text.length > 0 && !json.footer.text.startsWith('Floor'), 'a line in his voice');
  const ids = view.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
  assert.deepStrictEqual(ids.filter((id) => id.startsWith('farm_dfight')), [], 'no Fight button');
  assert.ok(ids.includes(`${dviews.DCORRUPT_ID}:stall:${room}`) && ids.includes(`${dviews.DWALK_ID}:stall:${room}`), 'a dropdown to corrupt and Leave');
  assert.ok(ids.includes(`${dviews.DBVIEW_ID}:stall:${room}`), 'a View Item dropdown');
  const about = (v) => v.embeds[0].toJSON().fields.find((f) => f.name === 'Corrupted Effects').value;
  assert.match(about(view), /Select an Item/, 'nothing is listed until one is picked');
  const picked = await dviews.roomView(member('stall'), d, { viewing: name });
  checkLimits(picked, 'the stall viewing an item');
  assert.ok(about(picked).startsWith(`**${name}**`), 'the picked item effects');

  const hurt = { ...structuredClone(d), health: D.BROKER_COST };
  assert.deepStrictEqual(D.corrupt(hurt, name), { error: 'health' }, 'too hurt to pay');
  const result = D.corrupt(d, name);
  assert.ok(result.ok && result.drawback && result.amount > 0);
  assert.deepStrictEqual([d.room, d.health, d.corrupted.map((c) => c.name)], [room + 1, 1 - D.BROKER_COST, [name]]);
  assert.deepStrictEqual(D.runKit(d).corrupted, d.corrupted, 'the run fights with it');
  checkLimits(await dviews.roomView(member('stall'), d), 'the next room with a corrupted item');
  checkLimits(await dviews.buildView(member('stall'), d), 'the build with a corrupted item');

  d.room = room; // a second visit: the corrupted one is not offered again, the other can be corrupted too
  assert.deepStrictEqual(D.corruptibles(d), [other]);
  assert.deepStrictEqual(D.corrupt(d, name), { error: 'item' });
  assert.ok(D.corrupt(d, other).ok);
  assert.deepStrictEqual(D.corruptedOf(d).map((c) => c.name), [name, other], 'a run can carry several');
  assert.strictEqual(D.runKit(d).corrupted.length, 2);
  checkLimits(await dviews.roomView(member('stall'), d), 'two corrupted items');
  assert.ok(require('../src/utils/farm/hero').buildHero('Haze', { ...D.runKit(d), boons: 6 }).stats.maxHealth > 0, 'the hero builds with both');
  d.room = room;
  assert.strictEqual(D.corrupt(d, name).error, 'item', 'nothing left to corrupt');
});

test('Fragile Items: a stall forces one on a hero with no tier 3 or 4 item, it is weaker, a Rejuv shatters it, a later stall mends it into an Enhanced one', async () => {
  const { buildHero } = require('../src/utils/farm/hero');
  const { FRAGILE_BREAK } = require('../src/utils/farm/stats');
  let seed = 1;
  let room;
  for (; !room; seed++) room = Array.from({ length: D.LAST_ROOM }, (_, i) => i + 1).find((r) => D.roomSpec(seed, r, 'Haze').kind === 'broker');
  seed -= 1;
  const d = { ...D.newRun('Haze', seed), room, level: 6 };
  assert.ok(D.fragileDue(d), 'nothing worth working on: he forces one');
  const view = await dviews.roomView(member('stall'), d);
  checkLimits(view, 'the forced stall');
  assert.strictEqual(view.embeds[0].toJSON().image.url, 'attachment://fragile.jpg', 'the cracked item is shown');
  assert.ok(view.files.some((f) => f.name === 'fragile.jpg'));
  assert.ok(view.embeds[0].toJSON().description.includes(D.fragileGift(d)), 'it names the item');
  const ids = view.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
  assert.ok(ids.includes(`${dviews.DFRAGILE_ID}:stall:${room}:take`) && !ids.includes(`${dviews.DWALK_ID}:stall:${room}`), 'Take replaces Leave');
  assert.deepStrictEqual(D.mendFragile(structuredClone(d)), { error: 'none' }, 'nothing to mend yet');

  const taken = D.takeFragile(d);
  assert.ok(taken.ok);
  const name = taken.name;
  assert.deepStrictEqual([d.fragile, d.room, D.runKit(d).fragile], [[name], room + 1, [name]]);
  assert.ok(Object.values(d.items).flat().includes(name), 'it is in the build');
  checkLimits(await dviews.buildView(member('stall'), d), 'the build with a Fragile Item');

  const kit = (fragile) => ({ items: ['Extra Health'], fragile });
  assert.ok(buildHero('Haze', kit(['Extra Health'])).stats.maxHealth < buildHero('Haze', kit([])).stats.maxHealth, 'weaker than the real thing');

  d.room = room; // the next stall: he mends it, and the hero stays to deal again
  assert.ok(!D.fragileDue(d), 'one at a time');
  assert.ok(!D.corruptibles(d).includes(name), 'never corrupted while cracked');
  const mend = await dviews.roomView(member('stall'), d);
  checkLimits(mend, 'the mending stall');
  assert.ok(mend.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id)).includes(`${dviews.DFRAGILE_ID}:stall:${room}:mend`));
  const shattering = structuredClone(d);
  assert.deepStrictEqual(D.mendFragile(d), { ok: true, name });
  assert.deepStrictEqual([d.fragile, d.enhanced, d.room], [[], [name], room]);

  const fightRoom = Array.from({ length: D.LAST_ROOM }, (_, i) => i + 1).find((r) => D.roomSpec(seed, r, 'Haze').kind === 'fight');
  Object.assign(shattering, { room: fightRoom, phase: 'fighting' });
  D.afterWin(shattering, { spec: D.specOf(shattering), health: 0.5, rejuvsUsed: 1, kept: {}, stacks: {} });
  assert.deepStrictEqual([shattering.fragile, Object.values(shattering.items).flat().includes(name), shattering.shattered.names], [[], false, [name]], 'a Rejuv shatters it');
  const lowHealth = { ...structuredClone(d), fragile: [name], enhanced: [], room: fightRoom, phase: 'fighting' };
  lowHealth.items[Object.keys(lowHealth.items)[0]].push(name);
  D.afterWin(lowHealth, { spec: D.specOf(lowHealth), health: 0.5, rejuvsUsed: 0, fragileBroke: [name], kept: {}, stacks: {} });
  assert.deepStrictEqual([lowHealth.fragile, lowHealth.shattered.why], [[], 'health'], 'so does one that broke mid-fight');
  const fine = { ...structuredClone(d), fragile: [name], room: fightRoom, phase: 'fighting' };
  D.afterWin(fine, { spec: D.specOf(fine), health: 0.5, rejuvsUsed: 0, fragileBroke: [], kept: {}, stacks: {} });
  assert.deepStrictEqual(fine.fragile, [name], 'but not otherwise');

  // only tier 3 or 4, whatever the seed
  for (let s = 1; s <= 200; s++) assert.ok(itemByName(D.fragileGift({ ...D.newRun('Haze', s), room })).Tier >= 3, 'a gift worth taking');

  // mid-fight: under 10% health the item's stats and effects go, once
  const mid = buildHero('Haze', { items: ['Extra Health', 'Close Quarters'], fragile: ['Extra Health', 'Close Quarters'], boons: 6 });
  const [maxBefore, itemsBefore] = [mid.stats.maxHealth, mid.items.length];
  mid.shatter();
  assert.ok(!mid.fragileBroke && mid.stats.maxHealth === maxBefore, 'healthy: it holds');
  mid.health = maxBefore * (FRAGILE_BREAK - 0.01);
  mid.shatter();
  assert.deepStrictEqual([mid.fragileBroke, mid.items.length, mid.shatter], [['Extra Health', 'Close Quarters'], itemsBefore - 1, null], 'it breaks and is gone (an item with an effect is taken out of the fight)');
  assert.ok(mid.stats.maxHealth < maxBefore && mid.health <= mid.stats.maxHealth && mid.health > 0, 'its max health goes, the hero lives');
  assert.strictEqual(mid.stats.maxHealth, buildHero('Haze', { boons: 6 }).stats.maxHealth, 'the sheet is what it would be without the item');
});

test('Monster Rounds: its vs-NPC bonuses are halved in /descend (npcScale), whole elsewhere', () => {
  const { buildHero } = require('../src/utils/farm/hero');
  const [full, half] = [{}, { npcScale: 0.5 }].map((o) => buildHero('Haze', { items: ['Monster Rounds'], ...o }).stats);
  assert.deepStrictEqual([full.weaponDamageMult, half.weaponDamageMult, full.bulletResist, half.bulletResist], [1.25, 1.125, 0.25, 0.125]);
});

test('/descend run hero: starts at once; a hero not unlocked or an ascension not reached is refused privately (Nov 4)', async () => {
  const id = 'd-direct';
  await chooseHero(id, 'Haze');
  const opts = (hero, asc = null) => ({ getSubcommand: () => 'run', getString: () => hero, getInteger: () => asc });
  const locked = fake(id);
  await descend.execute({ ...locked, options: opts('Abrams') });
  assert.match(locked.log.at(-1)[1].content, /haven't unlocked \*\*Abrams\*\*/);
  const high = fake(id);
  await descend.execute({ ...high, options: opts('haze', 5) });
  assert.match(high.log.at(-1)[1].content, /up to \*\*Ascension 0\*\*/);
  assert.strictEqual((await getFarmUser(id)).descent, undefined, 'nothing started');
  const go = fake(id);
  await descend.execute({ ...go, options: opts('haze') });
  const d = (await getFarmUser(id)).descent;
  assert.ok(d && d.hero === 'Haze' && d.ascension === 0 && d.room === 1, 'the run started with no dropdown');
  assert.match(go.log.at(-1)[1].embeds[0].toJSON().title, /Room 1/);
});
