// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { Fight } = require('../src/utils/farm/engine');
const { buildHero, roster } = require('../src/utils/farm/hero');
const { rollRival, rivalKit, duel, ENCOUNTER_CHANCE, DUEL_SECONDS } = require('../src/utils/farm/encounter');
const { itemByName } = require('../src/utils/farm/stats');
const { TIER_COSTS } = require('../src/utils/farm/levels');
const { chooseHero, getFarmUser, updateFarmUser, play, setCooldowns, offerFor, walkAway, fightRival, OFFER_MS } = require('../src/utils/farm/play');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

test('a rival hero on the enemy side fights with its own gun and abilities, and each side only hears its own actions', () => {
  const haze = buildHero('Haze', { boons: 10 });
  const abrams = buildHero('Abrams', { boons: 10 });
  const f = new Fight({ heroes: [haze], enemies: [abrams], rng: seeded(7) });
  const out = f.run(120);
  assert.ok(!haze.alive || !abrams.alive, 'someone went down');
  assert.strictEqual(out.won, !abrams.alive);
  assert.ok(f.dealt.get(abrams) > 0 && f.dealt.get(haze) > 0, 'both dealt damage');
  assert.ok(f.log.some((l) => l.who === 'Abrams' && l.what === 'Shoulder Charge'), 'the rival casts');
  assert.ok(f.log.some((l) => l.who === 'Haze'), 'so does the hero');

  // a stunned hero does nothing: Abrams' charge stuns Haze, whose clip doesn't move while it lasts
  const h = buildHero('Haze');
  const a = buildHero('Abrams', { unlocked: 2 });
  const g = new Fight({ heroes: [h], enemies: [a], rng: () => 0.99 });
  while (!h.has('stun') && g.time < 5) g.step();
  assert.ok(h.has('stun'));
  const clip = h.weapon.clip;
  g.step();
  g.step();
  assert.strictEqual(h.weapon.clip, clip);

  // a hidden rival can't be shot: Haze's Smoke Bomb takes her out of the hero's sights
  const p = buildHero('Paige', { unlocked: 0 });
  const hidden = buildHero('Haze', { unlocked: 0 });
  const k = new Fight({ heroes: [p], enemies: [hidden], rng: () => 0.99 });
  k.addStatus(hidden, { id: 'smoke', duration: 2, tags: ['invisible'] });
  const before = hidden.health;
  k.run(1);
  assert.strictEqual(hidden.health, before);
});

test('who shows up: only heroes the member lacks, only some of the time', () => {
  const has = (name) => name === 'Haze';
  assert.strictEqual(rollRival(has, () => ENCOUNTER_CHANCE), null, 'the roll missed');
  const seen = new Set(Array.from({ length: 200 }, (_, i) => rollRival(has, seeded(i + 1), 1)));
  assert.deepStrictEqual([...seen].sort(), roster().filter((n) => n !== 'Haze').sort());
  assert.strictEqual(rollRival(() => true, () => 0, 1), null, 'nobody left to meet');
});

test("the rival's kit mirrors the member's: level, buffs, as many items of the same tiers, its points spent", () => {
  const kit = { boons: 20, unlocked: 4, points: 14, tiers: { 1: 3 }, items: ['Extra Health', 'Extended Magazine', 'Toxic Bullets', 'Leech'], buffs: { fireRate: 3 } };
  const theirs = rivalKit(kit, seeded(3));
  assert.deepStrictEqual([theirs.boons, theirs.unlocked, theirs.buffs], [20, 4, { fireRate: 3 }]);
  assert.deepStrictEqual(theirs.items.map((n) => itemByName(n).Tier), kit.items.map((n) => itemByName(n).Tier));
  assert.strictEqual(new Set(theirs.items).size, theirs.items.length);
  const spent = Object.values(theirs.tiers).reduce((sum, t) => sum + TIER_COSTS.slice(0, t).reduce((a, b) => a + b, 0), 0);
  assert.ok(spent <= 14 && spent >= 13, `spent ${spent} of 14`); // 1 may be left when nothing costs 1 any more
  assert.deepStrictEqual(rivalKit({ boons: 0, unlocked: 1, points: 0, items: [], buffs: {} }, seeded(1)), { boons: 0, unlocked: 1, tiers: {}, items: [], buffs: {} });
});

test('every hero can duel every other hero, with any kit, and the duel always ends', () => {
  const rng = seeded(11);
  for (const mine of roster()) {
    for (const theirs of roster()) {
      for (const kit of [{ boons: 0, unlocked: 1, points: 0, items: [], buffs: {} }, { boons: 24, unlocked: 4, points: 20, tiers: { 1: 2, 2: 2, 3: 2, 4: 2 }, items: ['Toxic Bullets', 'Leech', 'Extra Health', 'Mystic Burst', 'Ricochet', 'Metal Skin'], buffs: { maxHealth: 5 } }]) {
        const run = duel(mine, kit, theirs, rivalKit(kit, rng), { rng });
        assert.ok(run.encounter && run.hero === mine && run.rival === theirs);
        assert.ok(run.seconds <= DUEL_SECONDS + 0.2 && run.frames.length >= 2 && run.frames.length <= 14);
        assert.strictEqual(run.won, run.frames.at(-1).enemies[0].hp <= 0 && run.frames.at(-1).hero.hp > 0);
        assert.strictEqual(run.frames[0].enemies[0].name, theirs);
      }
    }
  }
});

test('the offer: after a won fight, kept 5 minutes, Fight unlocks the rival on a win, Walk Away drops it', async () => {
  const id = 'enc1';
  await chooseHero(id, 'Paige');
  await updateFarmUser(id, (r) => { r.earned = 1e6; r.tiers = { 1: 3, 2: 3, 3: 3, 4: 3 }; }); // a high level hero with its points spent (the rival spends as many): wins its camp, and a duel now and then
  setCooldowns(false); // the testing switch: every won fight brings an encounter
  try {
    const t0 = Date.parse('2026-10-03T12:00:00Z');
    const { run } = await play(id, 'small-camp', { now: t0, rng: seeded(5) });
    assert.ok(run.won && roster().includes(run.rival) && run.rival !== 'Paige');
    assert.strictEqual(offerFor(id, t0 + OFFER_MS - 1), run.rival);
    assert.strictEqual(offerFor(id, t0 + OFFER_MS), null, 'the rival left');
    assert.strictEqual(walkAway(id, t0), run.rival);
    assert.strictEqual(offerFor(id, t0), null);
    assert.deepStrictEqual(await fightRival(id, { now: t0 }), { error: 'gone' });

    // fight until one is beaten: the rival is unlocked at level 0 with nothing, the hero and the souls are untouched
    let won = null;
    for (let i = 0; i < 40 && !won; i++) {
      const next = (await play(id, 'small-camp', { now: t0, rng: seeded(100 + i) })).run;
      const out = await fightRival(id, { now: t0, rng: seeded(200 + i) });
      assert.strictEqual(out.run.rival, next.rival);
      assert.strictEqual(offerFor(id, t0), null, 'one fight per offer');
      const r = await getFarmUser(id);
      assert.strictEqual(!!r.heroes[next.rival], out.run.won, 'unlocked only by a win');
      if (out.run.won) won = next.rival;
    }
    assert.ok(won, 'a win within 40 encounters');
    const r = await getFarmUser(id);
    assert.deepStrictEqual([r.hero, r.heroes[won]], ['Paige', { earned: 0, tiers: {}, items: {} }]);
    // Rejuvs work in a duel and are used up; the rival has none (his calls, Oct 10)
    const kit = { boons: 0, unlocked: 1, tiers: {}, items: [], buffs: {} };
    const strong = { boons: 35, unlocked: 4, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 }, items: [], buffs: {} };
    const bare = duel('Haze', kit, 'Abrams', strong, { rng: seeded(1) });
    const revived = duel('Haze', kit, 'Abrams', strong, { rng: seeded(1), rejuvs: 2 });
    assert.deepStrictEqual([bare.won, bare.rejuvsUsed, revived.rejuvsUsed], [false, 0, 2]);
    assert.ok(revived.seconds > bare.seconds && revived.log.some(([, text]) => text === 'Haze used a Rejuv'));
    await updateFarmUser(id, (rec) => { rec.rejuvs = 3; });
    let spent = 0;
    for (let i = 0; i < 40 && !spent; i++) {
      const next = (await play(id, 'small-camp', { now: t0, rng: seeded(400 + i) })).run;
      if (!next.rival) break;
      const before = (await getFarmUser(id)).rejuvs;
      const out = await fightRival(id, { now: t0, rng: seeded(500 + i) });
      assert.strictEqual((await getFarmUser(id)).rejuvs, before - out.run.rejuvsUsed);
      spent += out.run.rejuvsUsed;
    }
    assert.ok(spent > 0, 'a duel used a Rejuv');
    // an unlocked hero never shows up again
    for (let i = 0; i < 30; i++) assert.notStrictEqual((await play(id, 'small-camp', { now: t0, rng: seeded(300 + i) })).run.rival, won);
  } finally { setCooldowns(true); }
});

test('no encounter after a loss or a roam; with cooldowns on it is the 5% roll', async () => {
  const id = 'enc2';
  await chooseHero(id, 'Haze');
  const t0 = Date.parse('2026-10-03T12:00:00Z');
  const lost = (await play(id, 'mid-boss', { now: t0, rng: seeded(1) })).run; // level 0 against the Mid-Boss
  assert.ok(!lost.won && lost.rival === null && offerFor(id, t0) === null);
  await updateFarmUser(id, (r) => { r.earned = 1e6; r.cooldowns = {}; });
  const miss = (await play(id, 'small-camp', { now: t0, rng: () => 0.5 })).run;
  assert.ok(miss.won && miss.rival === null, 'the roll missed');
  await updateFarmUser(id, (r) => { r.cooldowns = {}; });
  const { haul } = await play(id, 'roam', { now: t0, rng: () => 0 });
  assert.ok(haul && offerFor(id, t0) === null);
});

test('Cultist Sacrifice never eats a rival hero', () => {
  const kit = { boons: 24, unlocked: 4, points: 0, tiers: {}, buffs: {} };
  for (let i = 1; i <= 10; i++) {
    assert.ok(duel('Paige', { ...kit, items: ['Cultist Sacrifice'] }, 'Abrams', { ...kit, items: [] }, { rng: seeded(i) }).seconds > 2);
    assert.ok(duel('Paige', { ...kit, items: [] }, 'Abrams', { ...kit, items: ['Cultist Sacrifice'] }, { rng: seeded(i) }).seconds > 2);
  }
});

test('a duel: heroes deal half damage to each other and a quarter of their gun shots miss; NPC fights are untouched', () => {
  const { DUEL, enemy } = require('../src/utils/farm/engine');
  assert.deepStrictEqual(DUEL, { damage: 0.5, miss: 0.25 });
  const quiet = (name) => { const h = buildHero(name, { unlocked: 0 }); h.meleeAt = Infinity; h.stamina = 0; h.stats.stamina = 0; return h; };
  const [a, b] = [quiet('Paige'), quiet('Abrams')];
  b.weapon.reloadLeft = 1e9;
  b.stats.healthRegen = 0;
  const f = new Fight({ heroes: [a], enemies: [b], rng: () => 0.99 }); // 0.99: no shot misses
  assert.strictEqual(f.damage(a, b, 100, 'spirit'), 50);
  const before = b.health;
  while (a.weapon.clip > 13) f.step();
  assert.ok(Math.abs(before - b.health - f.shotDamage(a, b) * 0.5) < 0.01, 'one shot, half its damage');
  // every shot misses when the dice say so, and the clip still empties
  const [c, d] = [quiet('Paige'), quiet('Abrams')];
  d.weapon.reloadLeft = 1e9;
  const g = new Fight({ heroes: [c], enemies: [d], rng: () => 0.1 });
  g.run(3);
  assert.ok(d.health === d.stats.maxHealth && c.weapon.clip < 14);
  // an NPC takes full damage and is never missed
  const e = quiet('Paige');
  const dummy = enemy('Dummy', { maxHealth: 1e5, dps: 0, distance: 10 });
  const k = new Fight({ heroes: [e], enemies: [dummy], rng: () => 0.1 });
  assert.strictEqual(k.damage(e, dummy, 100, 'spirit'), 100);
  k.run(2);
  assert.ok(dummy.health < 1e5 - 100);
});
