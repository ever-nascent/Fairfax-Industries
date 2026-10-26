// Run: node --test test/warpstone.test.js
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-warp-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');
const { FX } = require('../src/utils/farm/items');
const { simulate } = require('../src/utils/farm/play');
const { duel } = require('../src/utils/farm/encounter');
const D = require('../src/utils/farm/descent');
const { SPECIALS } = require('../src/utils/farm/haunts');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, actual + ' vs ' + expected);

function setup(foeStats = {}) {
  const hero = buildHero('Haze', { items: ['Warp Stone'], unlocked: 0 });
  hero.stats.healthRegen = 0;
  hero.weapon.reloadLeft = Infinity;
  hero.meleeAt = hero.nextSlide = Infinity;
  hero.stamina = hero.stats.stamina = 0;
  const foe = enemy('Dummy', { maxHealth: 1e6, dps: 0, ...foeStats });
  const fight = new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.99 });
  return { hero, foe, fight, warp: hero.items[0] };
}

test('Warp Stone waits for an incoming hit, even while hurt; zero damage and DoT do not spend it', () => {
  const { hero, foe, fight, warp } = setup();
  hero.health /= 2;
  const before = hero.health;
  fight.run(2);
  assert.equal(warp.cdLeft, 0);
  assert.equal(hero.health, before);
  assert.equal(fight.damage(foe, hero, 0, 'bullet', { attack: true }), 0);
  fight.addStatus(hero, { id: 'burn', duration: 2, dot: { source: foe, next: fight.time, every: 1, perSecond: 10, type: 'spirit' } });
  fight.step();
  assert.ok(hero.health < before, 'the burn still deals damage');
  assert.equal(warp.cdLeft, 0);
  assert.equal(fight.log.length, 0);
});

test('Warp Stone cancels one hit, stacks 30% bullet resist for six seconds and waits sixteen seconds', () => {
  const { hero, foe, fight, warp } = setup();
  hero.stats.bulletResist = 0.2;
  const before = hero.health;
  const opts = { attack: true };
  assert.equal(fight.damage(foe, hero, 100, 'bullet', opts), 0);
  assert.equal(hero.health, before);
  assert.equal(opts.dodged, true);
  near(warp.cdLeft, 16);
  const buff = hero.statuses.find((s) => s.id === 'Warp Stone:resist');
  near(buff.mods.bulletResist, 0.3);
  near(buff.until - fight.time, 6);
  near(fight.damage(foe, hero, 100, 'bullet', { attack: true }), 56);
  assert.deepEqual(fight.log, [
    { t: 0, who: 'Haze', what: 'Warp Stone' },
    { t: 0, who: 'Haze', what: 'attack', from: 'Dummy', warped: true },
  ]);
  fight.run(6.1);
  assert.ok(warp.cdLeft > 0);
  near(fight.damage(foe, hero, 100, 'bullet', { attack: true }), 80);
  fight.run(10);
  assert.equal(warp.cdLeft, 0);
  assert.equal(fight.damage(foe, hero, 100, 'bullet', { attack: true }), 0);
  assert.equal(fight.log.filter((l) => l.warped).length, 2);
});

test('Warp Stone obeys item suppression and inability to act', () => {
  for (const tag of ['noItems', 'stun', 'blind', 'sleep', 'void', 'hold']) {
    const { hero, foe, fight, warp } = setup();
    fight.addStatus(hero, { id: 'blocked', duration: 5, tags: [tag] });
    assert.ok(fight.damage(foe, hero, 100, 'bullet', { attack: true }) > 0, tag);
    assert.equal(warp.cdLeft, 0, tag);
    assert.equal(fight.log.length, 0, tag);
    fight.removeStatus(hero, 'blocked');
    assert.equal(fight.damage(foe, hero, 100, 'bullet', { attack: true }), 0, tag + ' ended');
  }
});

test('Warp Stone avoids a blast and its crowd control, but not a second blast on cooldown', () => {
  const { hero, foe, fight, warp } = setup({
    blast: { every: 8, damage: 100, maxHealthPct: 0.1, curse: 2, type: 'spirit', what: 'stomp' },
  });
  foe.name = 'Walker';
  foe.blastAt = 0;
  const before = hero.health;
  fight.step();
  assert.equal(hero.health, before);
  assert.equal(hero.has('sleep'), false);
  assert.ok(warp.cdLeft > 0);
  assert.equal(fight.log.filter((l) => l.warped).length, 1);
  assert.deepEqual(fight.log.find((l) => l.warped), { t: 0.1, who: 'Haze', what: 'stomp', from: 'Walker', warped: true });
  foe.blastAt = 0;
  fight.step();
  assert.ok(hero.health < before);
  assert.equal(hero.has('sleep'), true);
});

test('Warp Stone leaves an already dodged or parried blast alone', () => {
  for (const flag of ['dodged', 'parried']) {
    const { hero, foe, fight, warp } = setup();
    fight.emit('blast', { source: foe, target: hero, what: 'stomp', [flag]: true });
    assert.equal(warp.cdLeft, 0, flag);
    assert.equal(fight.log.length, 0, flag);
  }
});

test('one Warp Stone dodge cancels both halves of a mixed NPC attack', () => {
  const { hero, foe, fight } = setup({ dps: 100, damageType: 'mixed' });
  foe.swing = 0.9;
  const before = hero.health;
  fight.step();
  assert.equal(hero.health, before);
  assert.equal(fight.log.filter((l) => l.warped).length, 1);
  foe.swing = 0.9;
  fight.step();
  near(before - hero.health, 50 * 0.7 + 50);
});

test('Warp Stone reacts to rival gunfire and melee for either side of a duel', () => {
  for (const side of ['member', 'rival']) for (const attack of ['gun', 'melee']) {
    const holder = buildHero('Haze', { items: ['Warp Stone'], unlocked: 0 });
    const attacker = buildHero('Abrams', { unlocked: 0 });
    const fight = new Fight({
      heroes: [side === 'member' ? holder : attacker],
      enemies: [side === 'member' ? attacker : holder],
      rng: () => 0.99,
    });
    attacker.stats.pellets = 1;
    const view = fight.views.get(attacker);
    const strike = () => {
      if (attack === 'melee') view.melee(attacker, holder);
      else { attacker.weapon.charge = 1; view.fireWeapon(attacker, holder); }
    };
    const before = holder.health;
    strike();
    assert.equal(holder.health, before, side + ' ' + attack);
    assert.deepEqual(fight.log.find((l) => l.warped), { t: 0, who: 'Haze', what: attack === 'melee' ? 'melee' : 'attack', from: 'Abrams', warped: true });
    strike();
    assert.ok(holder.health < before, 'the next ' + attack + ' lands for the ' + side);
  }
});

test('every active item still records its activation through useItem', () => {
  let checked = 0;
  for (const name of Object.keys(FX)) {
    const hero = buildHero('Haze', { items: [name], unlocked: 0 });
    const item = hero.items[0];
    if (!item.active) continue;
    const fight = new Fight({ heroes: [hero], enemies: [enemy('Dummy')], rng: () => 0.99 });
    item.cast = () => {}; // Activation logging is shared; each item's effect has its own tests.
    fight.useItem(item);
    assert.deepEqual(fight.log[0], { t: 0, who: 'Haze', what: name });
    checked++;
  }
  assert.ok(checked > 20, 'the active-item list was exercised');
});

test('Shiv does not defer damage from a Warp Stone dodge', () => {
  const hero = buildHero('Shiv', { items: ['Warp Stone'] });
  const foe = enemy('Dummy');
  const fight = new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.99 });
  const bloodletting = hero.abilities.find((a) => a.slot === 3);
  const before = hero.health;
  assert.equal(fight.damage(foe, hero, 100, 'bullet', { attack: true }), 0);
  bloodletting.tick(fight, 0.1);
  assert.equal(hero.health, before);
  assert.equal(bloodletting.waiting(fight), 0);
  fight.damage(foe, hero, 100, 'bullet', { attack: true });
  assert.ok(bloodletting.waiting(fight) > 0, 'the next hit is deferred normally');
});

test('a Warp-dodged melee does not trigger Spirit Strike damage or its debuff', () => {
  const holder = buildHero('Haze', { items: ['Warp Stone'], unlocked: 0 });
  const rival = buildHero('Abrams', { items: ['Spirit Strike'], unlocked: 0 });
  const fight = new Fight({ heroes: [holder], enemies: [rival], rng: () => 0.99 });
  const view = fight.views.get(rival);
  const before = holder.health;
  view.melee(rival, holder);
  assert.equal(holder.health, before);
  assert.equal(holder.statuses.some((s) => s.id === 'Spirit Strike:strike'), false);
  assert.equal(rival.items[0].cdLeft, 0);
  view.melee(rival, holder);
  assert.ok(holder.health < before);
  assert.ok(holder.statuses.some((s) => s.id === 'Spirit Strike:strike'));
});

test('a Warp-dodged Book Barrage causes neither damage nor sleep', () => {
  const { hero, foe, fight } = setup({ dps: 20 });
  foe.name = 'Past Due';
  foe.stats.special = SPECIALS.past_due;
  const before = hero.health;
  SPECIALS.past_due.use(fight, foe, hero);
  assert.equal(hero.health, before);
  assert.equal(hero.has('sleep'), false);
  assert.equal(fight.log.find((l) => l.warped).what, 'Book Barrage');
  SPECIALS.past_due.use(fight, foe, hero);
  assert.ok(hero.health < before);
  assert.equal(hero.has('sleep'), true);
});

const busyItems = ['Warp Stone', 'Healing Nova', 'Colossus', 'Return Fire', 'Metal Skin', 'Grit', 'Guardian Ward', 'Divine Barrier', 'Healing Rite', 'Fortitude', 'Leech', 'Transcendent Cooldown'];
const busyKit = { boons: 24, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 }, items: busyItems };

function retainedWarp(run) {
  const warped = run.log.filter(([, text]) => text.includes(' warped away from '));
  assert.ok(warped.length, 'the fight produced a Warp Stone dodge');
  assert.ok(run.log.some(([, text]) => text.endsWith(' used Warp Stone')), 'the activation is still logged');
  assert.ok(run.frames.length <= 14);
  assert.ok(run.frames.every((frame) => frame.log.length <= 4));
  assert.ok(run.frames.at(-1).log.some((line) => line[0] === warped.at(-1)[0] && line[1] === warped.at(-1)[1]), 'the final replay retains the latest dodge');
  return warped.at(-1);
}

test('a busy farm result keeps the dodge after four later kills would push it out', () => {
  const run = simulate('Mina', 'medium-camp', { ...busyKit, rng: seeded(14) });
  const latest = retainedWarp(run);
  assert.ok(run.log.length - run.log.indexOf(latest) - 1 >= 4, 'the fixture exercises four-line log eviction');
});

test('a long encounter retains the newest dodge after replay downsampling', () => {
  const kit = { ...busyKit, buffs: { maxHealth: 200 }, unlocked: 0 };
  const run = duel('Haze', kit, 'Abrams', kit, { rng: seeded(1) });
  retainedWarp(run);
  assert.ok(run.seconds > 14, 'the fixture has more snapshots than the replay limit');
  assert.equal(run.frames.length, 14);
  assert.ok(run.log.some(([, text]) => text.startsWith('Haze warped away from Abrams')));
  assert.ok(run.log.some(([, text]) => text.startsWith('Abrams warped away from Haze')));
});

test('Descend room replay retains Warp Stone dodges through the shared simulator', () => {
  const d = D.newRun('Haze', 'warp-preview');
  d.level = 24;
  d.tiers = busyKit.tiers;
  d.items.vitality = busyItems;
  d.buffs = { maxHealth: 200 };
  const run = D.fightRoom(d, { room: 20, floor: 4, kind: 'boss', boss: 'walker' }, seeded(1));
  assert.equal(run.descend, true);
  retainedWarp(run);
});
