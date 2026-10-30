// Run: node --test
// /descend's ascensions (descent.js ASCENSIONS, his ask Oct 26, redesigned Oct 29): 20 levels, unlocked per member, fixed for the run.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/utils/farm/descent');
const dviews = require('../src/utils/farm/descentViews');
const { getFarmUser, chooseHero, updateFarmUser } = require('../src/utils/farm/play');
const { buildHero } = require('../src/utils/farm/hero');
const routes = require('../src/components/farm');

const guild = { emojis: { cache: { find: () => undefined } } };
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
// Clears the run's last room with enemies that can't win (the clear itself is what is tested).
async function clearAt(id, ascension) {
  await D.startRun(id, 'Haze', 9, ascension);
  await updateFarmUser(id, (r) => { r.descent.room = D.LAST_ROOM; });
  const saved = { ...D.TUNE };
  Object.assign(D.TUNE, { health: 1e-4, dps: 0 });
  try { return (await D.fight(id, { rng: seeded(3) })).run; } finally { Object.assign(D.TUNE, saved); }
}

test('20 levels, each with a line and no name (his call, Oct 29); ascension 0 keeps every number as it was', () => {
  assert.strictEqual(D.ASCENSIONS.length, D.MAX_ASCENSION + 1);
  for (let a = 1; a <= D.MAX_ASCENSION; a++) assert.ok(!D.ASCENSIONS[a].name && D.ASCENSIONS[a].text.length <= 100, `A${a}`);
  assert.deepStrictEqual(D.rules({ v: 2 }), D.rules({ v: 2, ascension: 0 }));
  const r0 = D.rules({ v: 2, ascension: 0 });
  assert.deepStrictEqual([r0.rest, r0.skipHeal, r0.startHealth, r0.maxItems, r0.maxRejuvs, r0.bossBuffs, r0.skipBuffs, r0.rerolls],
    [D.REST, D.SKIP_HEAL, 1, 12, 3, D.BOSS_BUFFS, D.SKIP_BUFFS, D.REROLLS_PER_FLOOR]);
  assert.ok(!r0.slowFarm && !r0.shortStock && !r0.deniedSouls && !r0.bossRejuv && !r0.walkCost);
  const r20 = D.rules({ v: 2, ascension: 20, room: 31 });
  assert.deepStrictEqual([r20.rest, r20.skipHeal, r20.maxItems, r20.maxRejuvs, r20.walkCost], [D.REST, 0.15, 12, 1, 0.1], 'every level stacks');
  assert.ok(r20.slowFarm && r20.shortStock && r20.deniedSouls && r20.bossRejuv);
  // a level only turns on its own change
  assert.ok(!D.rules({ v: 2, ascension: 4 }).slowFarm && D.rules({ v: 2, ascension: 5 }).slowFarm, 'A5');
  assert.ok(!D.rules({ v: 2, ascension: 8, room: 31 }).deniedSouls && D.rules({ v: 2, ascension: 9 }).deniedSouls, 'A9');
});

test('ascension 0 rooms roll none of the ascension extras; old runs keep their old rooms', () => {
  for (let room = 1; room <= D.LAST_ROOM; room++) {
    const { ascension, ...spec } = D.roomSpec(5, room, 'Haze');
    assert.strictEqual(ascension, 0);
    assert.ok(!spec.first && !spec.siege && !spec.affix && (spec.groups ?? []).every((g) => !g.affix2), `room ${room}`);
    assert.ok(D.specOf({ seed: 5, room, hero: 'Haze', ascension: 0 }, room).legacy, 'an old run (no `v`), ascension 0 too, keeps its old rooms');
  }
});

test('the enemies: more of them (A1), room enemies +health (A2) +damage (A6), healbane (A7), elites (A11), bosses (A12), wards (A16), faster (A17, A19), second affix (A18), the full siege (A20)', () => {
  // A1: from floor 3 a fight room spends more threat points (one more enemy), never on floors 1-2
  const units = (spec) => spec.groups.reduce((n, g) => n + (D.ARCHETYPES[g.type].count ?? 1), 0);
  let more = 0;
  for (let s = 1; s < 200; s++) {
    const [a, b] = [D.roomSpec(s, 12, 'Haze', 0), D.roomSpec(s, 12, 'Haze', 1)];
    if (a.kind === 'fight' && b.kind === 'fight') more += units(b) - units(a);
    const [c, e] = [D.roomSpec(s, 7, 'Haze', 0), D.roomSpec(s, 7, 'Haze', 1)];
    if (c.kind === 'fight') assert.deepStrictEqual(e.groups, c.groups, 'A1 waits for floor 3');
  }
  assert.ok(more > 50, 'A1: bigger rooms from floor 3');
  const one = (type, affix, a) => D.unitsOf({ room: 5, floor: 1, ascension: a, groups: [{ type, affix }] })[0].stats;
  assert.ok(Math.abs(one('tank', null, 2).maxHealth / one('tank', null, 1).maxHealth - 1 - D.ASC.room) < 1e-9, 'A2: room enemies have more health');
  assert.ok(Math.abs(one('tank', null, 6).dps / one('tank', null, 5).dps - 1 - D.ASC.room) < 1e-9, 'A6: room enemies hit harder');
  assert.ok(!one('tank', null, 6).antiHeal && one('tank', null, 7).antiHeal.cut === D.ASC.healbane, 'A7: their hits cut healing');
  assert.strictEqual(one('tank', 'Withering', 7).antiHeal.cut, 0.4, 'a stronger heal cut (Withering) stays');
  assert.ok(Math.abs(one('tank', 'Regenerating', 11).dps / one('tank', 'Regenerating', 10).dps - 1 - D.ASC.elite) < 1e-9, 'A11: elites hit harder');
  assert.strictEqual(one('tank', null, 11).dps, one('tank', null, 10).dps, 'A11: elites only');
  assert.ok(Math.abs(one('tank', null, 16).spiritResist - one('tank', null, 15).spiritResist - D.ASC.wards) < 1e-9, 'A16: enemies resist more');
  const grappler = D.unitsOf({ room: 5, floor: 1, ascension: 17, groups: [{ type: 'grappler', affix: null }] })[0];
  const calm = D.unitsOf({ room: 5, floor: 1, ascension: 16, groups: [{ type: 'grappler', affix: null }] })[0];
  assert.ok(grappler.stats.controls[0].every < calm.stats.controls[0].every, 'A17: controls come more often');
  assert.strictEqual(grappler.stats.controls[0].duration, calm.stats.controls[0].duration + D.ASC.longer, 'A17: a grapple (a stun) lasts longer');
  assert.strictEqual(one('caster', null, 17).blast.curse, one('caster', null, 16).blast.curse + D.ASC.longer, 'A17: a curse lasts longer');
  assert.strictEqual(one('disruptor', null, 18).controls[0].duration, one('disruptor', null, 17).controls[0].duration + D.ASC.longer, 'A18: silences last longer');
  let seed = 1;
  let spec;
  for (; seed < 500; seed++) { spec = D.roomSpec(seed, 12, 'Haze', 18); if (spec.kind === 'fight' && spec.groups.some((g) => g.affix)) break; }
  for (const g of spec.groups.filter((x) => x.affix)) assert.ok(g.affix2 && g.affix2 !== g.affix, 'A18: a second, different affix');

  const boss = (a, affix = null) => D.bossFor('guardian', 10, a, affix);
  assert.ok(Math.abs(boss(12).stats.dps / boss(11).stats.dps - 1.1) < 1e-9 && Math.abs(boss(12).stats.maxHealth / boss(11).stats.maxHealth - 1.1) < 1e-9, 'A12');
  assert.strictEqual(boss(19).stats.controls[0].duration, boss(18).stats.controls[0].duration + D.ASC.longer, 'A19: a boss stun lasts longer');
  for (let s = 1; s < 40; s++) {
    const b = D.roomSpec(s, 15, 'Haze', 19);
    assert.ok(b.affix && b.affix !== 'Shielded', 'A19: a floor boss rolls an affix, never Shielded');
    assert.ok(!D.roomSpec(s, 10, 'Haze', 19).affix, 'A19: not on floors 1-2');
    const last = D.roomSpec(s, D.LAST_ROOM, 'Haze', 20);
    assert.deepStrictEqual(D.finalKeys(last), ['base-guardian', 'shrine', 'patron', 'weakened-patron'], 'A20: the whole siege at the bottom');
  }
});

test('bosses: an escort (A4, from floor 4) and a Rejuv of their own (A10, from floor 5); Denied Souls (A9); one Rejuv at most (A14)', () => {
  const at = (room, a) => ({ ...D.newRun('Haze', 3, a), room });
  const boss = (room, a) => D.enemiesOf(at(room, a), D.specOf(at(room, a), room)).units;
  assert.strictEqual(boss(15, 4).length, 1, 'no escort on floors 1-3');
  assert.deepStrictEqual(boss(20, 4).slice(1).map((e) => e.name), ['Swarmling', 'Swarmling'], 'A4: 2 Swarmlings');
  assert.strictEqual(boss(20, 3).length, 1);
  assert.match(D.roomLine(D.specOf(at(20, 4), 20)), /and 2 Swarmlings$/);
  const stages = (room, a) => { const d = at(room, a); return D.fightRoom({ ...d, level: 35 }, D.specOf(d, room), seeded(2)).stageNames.length; };
  assert.strictEqual(stages(25, 9), 1);
  assert.strictEqual(stages(20, 10), 1, 'A10 waits for floor 5');
  assert.strictEqual(stages(25, 10), 2, 'A10: the boss gets back up');
  // A9: no level from a boss room; A14: no Rejuv from an odd floor's boss
  const win = (room, a) => { const d = { ...at(room, a), level: 4 }; D.afterWin(d, { spec: D.specOf(d, room), health: 1, rejuvsUsed: 0, kept: {} }); return d; };
  assert.strictEqual(win(5, 8).level, 5);
  assert.strictEqual(win(5, 9).level, 4, 'A9');
  assert.strictEqual(win(4, 9).level, 5, 'a fight room still gives one');
  assert.strictEqual({ ...win(5, 13) }.rejuvs, 1);
  const full = (a) => { const d = { ...at(10, a), rejuvs: 2 }; D.afterWin(d, { spec: D.specOf(d, 10), health: 1, rejuvsUsed: 0, kept: {} }); return d.rejuvs; };
  assert.deepStrictEqual([full(13), full(14)], [3, 1], 'A14: carry at most 1');
});

test('the hero: locked item slots (A8), slow farm (A5), short stock (A15), Flee costs health (A3)', () => {
  assert.deepStrictEqual([1, 10, 11, 21, 31].map((room) => D.rules({ v: 2, ascension: 8, room }).maxItems), [9, 9, 10, 11, 12], 'A8: a slot opens after the bosses of floors 2, 4 and 6');
  const d8 = D.newRun('Haze', 1, 8);
  const names = ['Extra Health', 'Extra Regen', 'Extra Stamina', 'Healing Rite', 'Close Quarters', 'Headshot Booster', 'High-Velocity Rounds', 'Monster Rounds', 'Extra Charge'];
  for (const n of names) assert.ok(D.addItem(d8, n).ok, n);
  assert.deepStrictEqual(D.addItem(d8, 'Rapid Rounds'), { error: 'full' });
  d8.room = 11;
  assert.ok(D.addItem(d8, 'Rapid Rounds').ok, 'the 10th slot opens on floor 3');
  // A5: tiers half a floor behind; A15: 2 items from floor 5
  const tiers = (a) => { let t = 0; for (let s = 1; s <= 60; s++) { const d = { ...D.newRun('Haze', s, a), room: 15 }; t += D.rollOffer(d, { ...D.specOf(d, 14), kind: 'fight' }).choices.reduce((n, c) => n + require('../src/utils/farm/stats').itemByName(c).Tier, 0); } return t; };
  assert.ok(tiers(5) < tiers(4), 'A5: lower tiers');
  const count = (a, room) => { const d = { ...D.newRun('Haze', 7, a), room: room + 1 }; const spec = { ...D.specOf(d, room), kind: 'fight' }; return D.rollOffer(d, spec).choices.length; };
  assert.deepStrictEqual([count(14, 22), count(15, 19), count(15, 22)], [3, 3, 2]);
  const d3 = { ...D.newRun('Haze', 1, 3), health: 0.8 };
  D.walkAway(d3);
  assert.ok(Math.abs(d3.health - 0.7) < 1e-9 && d3.room === 2, 'A3: Flee costs 10% health');
  const d2 = { ...D.newRun('Haze', 1, 2), health: 0.8 };
  D.walkAway(d2);
  assert.strictEqual(d2.health, 0.8);
});

test('runs started before the redesign finish on the old rules (his call, Oct 29)', () => {
  const old = { ...D.newRun('Haze', 4, 6) };
  delete old.v;
  assert.ok(D.legacy(old) && !D.legacy(D.newRun('Haze', 4, 6)));
  assert.strictEqual(D.rules(old).startHealth, 0.9, 'the old A6: start damaged');
  assert.strictEqual(D.rules(D.newRun('Haze', 4, 6)).startHealth, 1);
  assert.ok(D.specOf(old).legacy, 'its rooms come from the old rules');
  old.health = 0.8;
  D.walkAway(old);
  assert.strictEqual(old.health, 0.8, 'walking away stays free');
  const run = D.fightRoom(old, D.specOf(old), seeded(5));
  assert.strictEqual(typeof run.won, 'boolean');
  assert.ok(D.roomLine(D.specOf(old)));
});

test('unlocks are per member: clearing at N unlocks N + 1 for every hero; a run can only start at an unlocked level', async () => {
  const id = 'asc1';
  await chooseHero(id, 'Haze');
  assert.deepStrictEqual(await D.startRun(id, 'Haze', 1, 1), { error: 'ascension' });
  assert.deepStrictEqual(await D.startRun(id, 'Haze', 1, -1), { error: 'ascension' });
  let run = await clearAt(id, 0);
  assert.strictEqual(run.complete.unlocked, 1);
  let r = await getFarmUser(id);
  assert.deepStrictEqual([r.descentAscension, r.descentCleared], [1, 0]);
  run = await clearAt(id, 1);
  assert.strictEqual(run.complete.unlocked, 2);
  run = await clearAt(id, 0);
  assert.strictEqual(run.complete.unlocked, undefined, 'a lower clear unlocks nothing new');
  r = await getFarmUser(id);
  assert.deepStrictEqual([r.descentAscension, r.descentCleared], [2, 1], 'never lowered');
  assert.deepStrictEqual(r.bestDescent, { rooms: D.LAST_ROOM, hero: 'Haze', ascension: 1 }, 'the best is the highest ascension first');
  assert.ok((await D.startRun(id, 'Haze', 1, 2)).ok);
  assert.strictEqual((await getFarmUser(id)).descent.ascension, 2, 'fixed on the run');
  await D.abandon(id);
  await updateFarmUser(id, (x) => { x.descentAscension = D.MAX_ASCENSION; });
  run = await clearAt(id, D.MAX_ASCENSION);
  assert.ok(run.won && run.complete.unlocked === undefined, 'nothing past 20');
  assert.deepStrictEqual(run.stageNames, ['Base Guardian', 'Shrine', 'Patron', 'Weakened Patron'], 'A20: the whole siege at the bottom');
  for (const frame of [run.frames[0], run.frames.at(-1)]) assert.strictEqual((await dviews.fightView(run, frame)).embeds[0].toJSON().description, undefined, 'no "is fighting" line (his ask, Oct 29)');
  const done = await dviews.completeView(member(id), run);
  assert.match(done.embeds[0].toJSON().description, /on \*\*Ascension 20\*\*/);
  assert.strictEqual(done.embeds[0].toJSON().image.url, 'attachment://hero.jpg', 'the build is the hero card image');
  assert.ok(done.files.some((f) => f.name === 'hero.jpg'));
});

test('the leaderboard: the highest ascension first, then rooms', async () => {
  for (const [id, ascension, rooms] of [['lb1', 0, 40], ['lb2', 3, 4], ['lb3', 3, 12]]) {
    await chooseHero(id, 'Haze');
    await updateFarmUser(id, (r) => { r.bestDescent = { rooms, hero: 'Haze', ...(ascension ? { ascension } : {}) }; });
  }
  const order = (await D.leaderboard()).map((x) => x.id).filter((x) => x.startsWith('lb'));
  assert.deepStrictEqual(order, ['lb3', 'lb2', 'lb1']);
});

test('the start screen: an ascension dropdown once one is unlocked, the pick goes on the begin button, and the run keeps it', async () => {
  const id = 'asc2';
  await chooseHero(id, 'Haze');
  let view = await dviews.startView(member(id), await getFarmUser(id), 'Haze');
  assert.strictEqual(view.components.length, 2, 'no ascension dropdown before one is unlocked');
  await updateFarmUser(id, (r) => { r.descentAscension = 3; });
  view = await dviews.startView(member(id), await getFarmUser(id), 'Haze');
  const asc = view.components[1].toJSON().components[0];
  assert.deepStrictEqual(asc.options.map((o) => o.value), ['0', '1', '2', '3']);
  assert.strictEqual(asc.options.find((o) => o.default).value, '3', 'the highest unlocked by default');
  const pick = fake(id, `farm_dasc:${id}:Haze`, { values: ['1'] });
  await route('Descend ascension select').execute(pick);
  const shown = pick.log.at(-1)[1];
  assert.strictEqual(shown.components.at(-1).toJSON().components[0].custom_id, `farm_dbegin:${id}:Haze:1`);
  assert.ok(shown.embeds[0].toJSON().fields.some((f) => f.name === 'Ascension 1'));
  const hero = fake(id, `farm_dhero:${id}:1`, { values: ['Haze'] });
  await route('Descend hero select').execute(hero);
  assert.strictEqual(hero.log.at(-1)[1].components.at(-1).toJSON().components[0].custom_id, `farm_dbegin:${id}:Haze:1`, 'the hero pick keeps the ascension');
  const tooHigh = fake(id, `farm_dbegin:${id}:Haze:9`);
  await route('Descend begin button').execute(tooHigh);
  assert.strictEqual((await getFarmUser(id)).descent, undefined);
  await route('Descend begin button').execute(fake(id, `farm_dbegin:${id}:Haze:1`));
  const d = (await getFarmUser(id)).descent;
  assert.strictEqual(d.ascension, 1);
  const room = await dviews.roomView(member(id), d);
  assert.strictEqual(room.embeds[0].toJSON().author.name, 'Descend  -  Ascension 1');
  assert.match(room.embeds[0].toJSON().title, /^Floor 1/);
  assert.ok(room.embeds[0].toJSON().fields.some((f) => f.name === 'Ascension' && f.value === '**1**'));
});

test('tokens (his call, Oct 28): each ascension cleared for the first time is a Character Unlock Token, only while a hero is left to unlock', async () => {
  const { tokenUseful } = require('../src/utils/farm/play');
  const { roster } = require('../src/utils/farm/hero');
  const id = 'asctoken';
  await chooseHero(id, 'Haze');
  const tokens = async () => (await getFarmUser(id)).tokens ?? 0;
  await clearAt(id, 0); // no ascension: only the room 25 token (it ends past room 25)
  const start = await tokens();
  let run = await clearAt(id, 1);
  assert.strictEqual(await tokens(), start + 1, 'Ascension 1 cleared');
  assert.ok(run.complete.token);
  assert.match((await dviews.completeView(member(id), run)).embeds[0].toJSON().fields[0].name, /Character Unlock Token/);
  run = await clearAt(id, 1);
  assert.strictEqual(await tokens(), start + 1, 'not twice for the same ascension');
  assert.ok(!run.complete.token);
  await updateFarmUser(id, (r) => { r.tokens = roster().length - 1; }); // a token for every hero left to unlock already
  assert.ok(!tokenUseful(await getFarmUser(id)));
  await clearAt(id, 2);
  assert.strictEqual(await tokens(), roster().length - 1, 'no token when it could not be used');
});
