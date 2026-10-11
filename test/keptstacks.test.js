// Run: node --test. Kept stacks (his calls, Oct 11): the stacks the game keeps for a whole match stay with the hero from fight to fight.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
const test = require('node:test');
const assert = require('node:assert');
const { KEEP, keptStacks } = require('../src/utils/farm/ability');
const { buildHero, logicOf, keptStacksOf } = require('../src/utils/farm/hero');
const { HIT_CAP } = require('../src/utils/farm/heroes/bebop');
const { rivalKit } = require('../src/utils/farm/encounter');
const { getFarmUser, chooseHero, play, updateFarmUser, updateHero, unlockHero, switchHero, setCooldowns } = require('../src/utils/farm/play');
const views = require('../src/utils/farm/views');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const member = (id) => ({ id, guild: { emojis: { cache: { find: () => undefined } } }, toString: () => `<@${id}>` });
const ult = (unit) => unit.abilities.find((a) => a.slot === 4);
const MAXED = { boons: 35, unlocked: 4, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 } };

test('the first 7 count in full, the rest at half, nothing past the cap (Bebop hits: 60 full, 120 cap)', () => {
  assert.deepStrictEqual([KEEP.full, KEEP.cap, HIT_CAP], [7, 30, 120]);
  assert.deepStrictEqual([0, 5, 7, 9, 30, 45].map((n) => keptStacks(n)), [0, 5, 7, 8, 18.5, 18.5]);
  assert.deepStrictEqual([60, 90, 120, 500].map((n) => keptStacks(n, 60, HIT_CAP)), [60, 75, 90, 90]);
});

test('each hero starts a fight with its kept stacks, capped', () => {
  const owl = ult(buildHero('Grey Talon', { ...MAXED, stacks: { kills: 10 } }));
  assert.strictEqual(owl.bonus, 8.5 * owl.data.BonusTechPowerPerKill, '10 kills: 7 full + 3 at half');
  const vin = ult(buildHero('Vindicta', { ...MAXED, stacks: { kills: 99 } }));
  assert.strictEqual(vin.kills, KEEP.cap);
  assert.strictEqual(vin.bonus, 18.5 * (6 + 4), 'tier 3: 10% a kill');
  const drifter = buildHero('Drifter', { ...MAXED, stacks: { kills: 7 } }).abilities.find((a) => a.slot === 3);
  assert.strictEqual(drifter.bonus, 7 * drifter.data.WeaponDmgPerIsolationKill);
  const plain = buildHero('Mo & Krill', MAXED);
  const kept = buildHero('Mo & Krill', { ...MAXED, stacks: { kills: 7 } });
  assert.strictEqual(kept.stats.maxHealth - plain.stats.maxHealth, 7 * ult(kept).value('BonusHealthOnKill'), 'the health is there from the start');
  assert.strictEqual(kept.health, kept.stats.maxHealth);
  assert.strictEqual(ult(buildHero('Mina', { ...MAXED, stacks: { bats: 80 } })).bonus, 50, "the game's own cap of 50 bats");
  const bomb = buildHero('Bebop', { ...MAXED, stacks: { hits: 500, kills: 3 } }).abilities.find((a) => a.slot === 2);
  assert.deepStrictEqual([bomb.hits, bomb.kills], [HIT_CAP, 3]);
  assert.deepStrictEqual(keptStacksOf(buildHero('Haze', MAXED)), {}, 'a hero without kept stacks keeps nothing');
});

test("a copy (Sinclair's ultimate) neither starts with stacks nor saves them", () => {
  const sinclair = buildHero('Sinclair', { ...MAXED, stacks: { kills: 30 } });
  const Owl = logicOf('Grey Talon').abilities[4];
  const copy = Object.assign(new Owl(4, ult(buildHero('Grey Talon')).data, sinclair, 3), { origin: 'Grey Talon', hidden: true });
  assert.strictEqual(copy.kills, 0);
  sinclair.abilities.push(copy);
  copy.kills = 5;
  assert.deepStrictEqual(keptStacksOf(sinclair), {});
});

test('a trip saves the stacks on the hero that went, won or lost; another hero keeps its own', async () => {
  const id = 'kept1';
  await chooseHero(id, 'Grey Talon');
  await updateFarmUser(id, (r) => { Object.assign(r, { earned: 1e6, tiers: MAXED.tiers, tokens: 1, stacks: { kills: 3 } }); });
  setCooldowns(false);
  try {
    let run;
    for (let s = 1; s <= 30; s++) {
      run = (await play(id, 'medium-camp', { rng: seeded(s) })).run;
      assert.deepStrictEqual((await getFarmUser(id)).stacks, run.stacks, 'saved as the fight left them');
      if (run.stacks.kills > 3) break;
    }
    assert.ok(run.stacks.kills > 3, 'the owl added kills on top of the 3 kept');
    // a lost fight keeps them too: a level 0 Grey Talon loses to the Mid-Boss, and the 3 kept kills are still there
    await chooseHero('kept1-lose', 'Grey Talon');
    await updateFarmUser('kept1-lose', (r) => { r.stacks = { kills: 3 }; });
    const lost = (await play('kept1-lose', 'mid-boss', { rng: seeded(2) })).run;
    assert.ok(!lost.won);
    assert.deepStrictEqual((await getFarmUser('kept1-lose')).stacks, { kills: 3 });
    await unlockHero(id, 'Abrams');
    await switchHero(id, 'Abrams');
    assert.deepStrictEqual((await getFarmUser(id)).stacks, {}, "Abrams starts with none of Grey Talon's");
    await updateHero(id, 'Grey Talon', (h) => { assert.ok(h.stacks.kills > 3); });
  } finally { setCooldowns(true); }
});

test('a rival rolls each kind of stack between half and the full cap', () => {
  const kit = { boons: 35, unlocked: 4, points: 32, items: [], buffs: {} };
  const seen = { kills: new Set(), hits: new Set(), bats: new Set() };
  for (let s = 1; s <= 400; s++) {
    const { stacks } = rivalKit(kit, seeded(s));
    for (const [k, lo, hi] of [['kills', 15, 30], ['hits', 60, 120], ['bats', 25, 50]]) {
      assert.ok(stacks[k] >= lo && stacks[k] <= hi, `${k} ${stacks[k]}`);
      seen[k].add(stacks[k]);
    }
  }
  for (const [k, lo, hi] of [['kills', 15, 30], ['bats', 25, 50]]) assert.ok(seen[k].has(lo) && seen[k].has(hi), `${k}: both ends come up`);
});

test('the hero screen lists the kept stacks', async () => {
  const id = 'kept2';
  await chooseHero(id, 'Vindicta');
  await updateFarmUser(id, (r) => { Object.assign(r, { earned: 1e6, tiers: MAXED.tiers, stacks: { kills: 9 } }); });
  const view = await views.heroView(member(id), await getFarmUser(id));
  const field = view.embeds[0].toJSON().fields.find((f) => f.name === 'Kept Stacks');
  assert.strictEqual(field?.value, 'Assassinate: 9 kills, +80% Weapon Damage');
});
