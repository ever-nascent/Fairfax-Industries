// Run: node --test
// The Damage Breakdown's new pages (his ask, Oct 26): what each enemy dealt the hero (engine.js enemyDamage) and what healed the hero, and when (healBreakdown).
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { Fight, enemy, enemyDamage, healBreakdown } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');
const { runStages } = require('../src/utils/farm/targets');
const views = require('../src/utils/farm/views');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

test("every point an enemy deals is counted under its attack, blast or special, and two of a kind are numbered", () => {
  const hero = buildHero('Haze', { boons: 4 });
  const mend = { name: 'Bite', chance: 0.5, use(fight, e, target) { fight.damage(e, target, 20, 'bullet'); } };
  const a = enemy('Brute', { maxHealth: 1e6, dps: 30, blast: { every: 4, damage: 50, maxHealthPct: 0, curse: 0.5, type: 'spirit', what: 'stomp', tags: ['stun'] } });
  const b = enemy('Brute', { maxHealth: 1e6, dps: 10 });
  b.stats.special = mend;
  const fight = new Fight({ heroes: [hero], enemies: [a, b], rng: seeded(7) });
  fight.run(20);
  const taken = enemyDamage([fight]);
  assert.deepStrictEqual(taken.map((x) => x.name).sort(), ['Brute 1', 'Brute 2']);
  for (const [i, unit] of [a, b].entries()) {
    const row = taken.find((x) => x.name === `Brute ${i + 1}`);
    assert.ok(Math.abs(row.dealt - fight.dealt.get(unit)) <= row.by.length, `${row.dealt} vs ${fight.dealt.get(unit)}`); // each line is rounded
  }
  assert.ok(taken.find((x) => x.name === 'Brute 1').by.some((m) => m.name === 'Stomp'), 'the blast by name');
  assert.ok(taken.find((x) => x.name === 'Brute 2').by.some((m) => m.name === 'Bite'), 'the special by name');
  assert.ok(taken.every((x) => x.by.some((m) => m.name === 'Attack')));
});

test('healing is counted by what healed, with when it landed; a fight through runStages carries it, the enemies and the enemy damage', () => {
  const hero = buildHero('Abrams', { boons: 10, items: ['Healing Rite', 'Extra Regen'] });
  const stages = [{ name: 'One', enemies: () => [enemy('Hitter', { maxHealth: 4000, dps: 60 })] }, { name: 'Two', enemies: () => [enemy('Hitter', { maxHealth: 4000, dps: 60 })] }];
  const out = runStages(hero, stages, { rng: seeded(3), maxSecondsPerStage: 60 });
  const rite = out.healing.by.find((x) => x.name === 'Healing Rite');
  assert.ok(rite && rite.healed > 0 && rite.times.length > 0, 'the item that healed, and when');
  assert.ok(rite.times.every(([t, n]) => Number.isInteger(t) && n > 0));
  assert.ok(out.healing.by.some((x) => x.name === 'Health Regen' && x.times.length === 0), 'plain regen: a total, no timeline');
  assert.strictEqual(out.healing.total, out.healing.by.reduce((s, x) => s + x.healed, 0));
  assert.deepStrictEqual(out.foes.map((f) => f.label), ['One', 'Two'].slice(0, out.foes.length));
  assert.ok(out.foes[0].units[0].stats.maxHealth === 4000, 'the enemies as they started');
  assert.ok(out.taken.length > 0);
  // the pages fit Discord
  const run = { hero: 'Abrams', seconds: out.time, damage: out.damage, taken: out.taken, healing: out.healing };
  for (const page of [views.healingView(run), views.enemyDamageView(run)]) {
    const e = page.embeds[0].toJSON();
    assert.ok(e.fields.length <= 25 && e.fields.every((f) => f.value.length <= 1024 && f.value.length > 0));
  }
  assert.match(views.healingView(run).embeds[0].toJSON().fields.find((f) => f.name.startsWith('Healing Rite')).value, /^\d+:\d\d(-\d+:\d\d)? {2}\+/);
  assert.match(views.healingView({ hero: 'Haze', seconds: 3, healing: { total: 0, by: [] } }).embeds[0].toJSON().description, /Nothing healed Haze/);
});

test('lifesteal is shared out by the item behind it: Leech and Vampiric Burst show under Bullet / Spirit Lifesteal', () => {
  const hero = buildHero('Billy', { boons: 20, items: ['Leech', 'Vampiric Burst'] });
  const out = runStages(hero, [{ name: 'One', enemies: () => [enemy('Hitter', { maxHealth: 6000, dps: 80 })] }], { rng: seeded(5), maxSecondsPerStage: 40 });
  for (const label of ['Bullet Lifesteal', 'Spirit Lifesteal']) {
    const line = out.healing.by.find((x) => x.name === label);
    assert.ok(line && line.parts.length > 0, `${label} has parts`);
    assert.ok(line.parts.some((p) => p.name === 'Leech'), `${label}: Leech named`);
    assert.ok(Math.abs(line.parts.reduce((s, p) => s + p.healed, 0) - line.healed) <= line.parts.length, 'the parts add up to the line');
  }
  const run = { hero: 'Billy', seconds: out.time, damage: out.damage, taken: out.taken, healing: out.healing };
  const field = views.healingView(run).embeds[0].toJSON().fields.find((f) => f.name.startsWith('Bullet Lifesteal'));
  assert.match(field.value, /^Leech {2}- {2}[\d,]+ {2}\(/);
});

test('the Gun and spirit-scaled damage name the items behind them, and the parts add up', () => {
  const hero = buildHero('Billy', { boons: 20, items: ['Leech', 'Improved Spirit', 'Mystic Burst'] });
  const out = runStages(hero, [{ name: 'One', enemies: () => [enemy('Hitter', { maxHealth: 9000, dps: 60 })] }], { rng: seeded(7), maxSecondsPerStage: 40 });
  const gun = out.damage.find((d) => d.name === 'Gun');
  assert.ok(gun.parts.some((p) => p.name === 'Leech'), 'Leech named under Gun');
  assert.ok(gun.parts.some((p) => p.name === 'Base'));
  assert.ok(Math.abs(gun.parts.reduce((s, p) => s + p.dealt, 0) - gun.dealt) <= gun.parts.length, 'the Gun parts add up');
  const spirit = out.damage.filter((d) => d.kind === 'ability' && d.parts.some((p) => p.name === 'Improved Spirit'));
  assert.ok(spirit.length > 0, 'a spirit-scaled ability names Improved Spirit');
  for (const d of spirit) assert.ok(Math.abs(d.parts.reduce((s, p) => s + p.dealt, 0) - d.dealt) <= d.parts.length + 1, `${d.name} parts add up`);
  const run = { hero: 'Billy', seconds: out.time, damage: out.damage, taken: out.taken, healing: out.healing };
  const fields = views.damageView(run).embeds[0].toJSON().fields;
  assert.ok(fields.every((f) => f.value.length <= 1024));
  assert.match(fields.find((f) => f.value.startsWith('Gun')).value, /\n> Leech {2}- {2}[\d,]+/);
});
