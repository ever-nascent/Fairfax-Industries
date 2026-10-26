// Run: node --test test/descentBuffs.test.js
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-descend-buffs-'));
process.env.FARM_FRAME_MS = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/utils/farm/descent');
const views = require('../src/utils/farm/descentViews');
const { buildHero } = require('../src/utils/farm/hero');
const { BUFFS, BRIDGE } = require('../src/utils/farm/buffs');

const member = { id: 'buff-preview', guild: { emojis: { cache: { find: () => undefined } } } };
const fightSpec = (seed, room = 3) => D.roomSpec(seed, room, 'Haze');
const won = (spec) => ({ spec, health: 1, rejuvsUsed: 0, kept: {} });
const findSeed = (kind, key, room = 3) => {
  for (let seed = 1; seed <= 20000; seed++) {
    const spec = fightSpec(seed, room);
    const find = D.rollFind(D.newRun('Haze', seed), spec);
    if (spec.kind === 'fight' && find?.kind === kind && (!key || find.key === key)) return { seed, spec, find };
  }
  throw new Error(`No ${kind} find seed`);
};

test('won fight and rival finds are seeded at 10% little and 5% big, bosses do not roll', () => {
  const counts = { little: 0, big: 0, none: 0 };
  const spec = { room: 3, floor: 1, kind: 'fight' };
  for (let seed = 1; seed <= 10000; seed++) {
    const d = D.newRun('Haze', seed);
    const find = D.rollFind(d, spec);
    assert.deepEqual(find, D.rollFind(structuredClone(d), spec), 'restart cannot reroll the find');
    counts[find?.kind ?? 'none']++;
  }
  assert.ok(counts.little > 900 && counts.little < 1100, JSON.stringify(counts));
  assert.ok(counts.big > 400 && counts.big < 600, JSON.stringify(counts));
  assert.equal(D.rollFind(D.newRun('Haze', 1), { ...spec, kind: 'boss' }), null);
  const rival = { ...spec, kind: 'rival', rival: 'Abrams' };
  const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((i) => D.rollFind(D.newRun('Haze', i), rival));
  assert.ok(seed, 'rival wins can yield a find');
  const d = D.newRun('Haze', seed);
  D.afterWin(d, won(rival));
  assert.equal(d.find.room, 3);
  assert.equal(d.offer.kind, 'items', 'the normal item choice stays');
});

test('little finds add one permanent stack and appear on the result and Build screens', async () => {
  const { seed, spec, find } = findSeed('little');
  const d = D.newRun('Haze', seed);
  D.afterWin(d, won(spec));
  assert.equal(d.buffs[find.key], 1);
  assert.equal(D.runKit(d).buffs[find.key], 1);
  assert.notDeepEqual(buildHero('Haze', D.runKit(d)).stats, buildHero('Haze', { ...D.runKit(d), buffs: {} }).stats);
  const result = await views.offerView(member, d, { run: { seconds: 2 } });
  assert.match(result.embeds[0].toJSON().description, /Found a Buff\.\n\*\*.+\*\*\nPermanent for this run\./);
  const redraw = await views.offerView(member, d);
  assert.match(redraw.embeds[0].toJSON().description, /Found a Buff\.\n\*\*.+\*\*\nPermanent for this run\./);
  const build = await views.buildView(member, d);
  assert.match(build.embeds[0].toJSON().fields.find((f) => f.name === 'Permanent Buffs (This Run)').value, new RegExp(BUFFS[find.key].name));
  D.afterWin(d, won({ room: 5, floor: 1, kind: 'boss', boss: 'guardian' }));
  assert.equal(d.buffs[find.key], 1, 'little buffs survive the floor');
  assert.equal(d.find, null, 'the boss did not produce a random find');
});

test('big finds boost the remaining floor fights, then expire after its boss', async () => {
  const { seed, spec } = findSeed('big', 'survival');
  const d = D.newRun('Haze', seed);
  D.afterWin(d, won(spec));
  assert.deepEqual(d.bridge, ['survival']);
  assert.deepEqual(D.runKit(d).bridge, ['survival']);
  assert.equal(buildHero('Haze', D.runKit(d)).stats.maxHealth - buildHero('Haze', { ...D.runKit(d), bridge: [] }).stats.maxHealth, 200);
  const nextFight = D.fightRoom(d, fightSpec(seed, 4), () => 0.5);
  assert.equal(nextFight.frames[0].hero.max, buildHero('Haze', D.runKit(d)).stats.maxHealth);
  const result = await views.offerView(member, d, { run: { seconds: 2 } });
  assert.match(result.embeds[0].toJSON().description, /reached \*\*Level 1\*\*\.\n\nFound a Buff\.\n\*\*Survival Bridge Buff\*\*\n\+200 Max Health, \+4 Health Regen\nLasts through Floor \*\*1\*\*\.\n\nPick/);
  const build = await views.buildView(member, d);
  assert.match(build.embeds[0].toJSON().fields.find((f) => f.name === 'Big Buffs (This Floor)').value, new RegExp(BRIDGE.survival.name));
  D.afterWin(d, won({ room: 5, floor: 1, kind: 'boss', boss: 'guardian' }));
  assert.deepEqual(d.bridge, []);
  assert.equal(buildHero('Haze', D.runKit(d)).stats.maxHealth, buildHero('Haze', { ...D.runKit(d), bridge: [] }).stats.maxHealth);
  const nextBuild = await views.buildView(member, d);
  assert.equal((nextBuild.embeds[0].toJSON().fields ?? []).some((f) => f.name === 'Big Buffs (This Floor)'), false);
});
