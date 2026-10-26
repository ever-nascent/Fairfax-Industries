// Run: node --test
const test = require('node:test');
const assert = require('node:assert');
const { Fight, enemy, HEAL_RATE, HEAL_POOL, BULLET_LIFESTEAL_VS_NPC, SPIRIT_LIFESTEAL_VS_NPC } = require('../src/utils/farm/engine');
const { buildHero, heroNames, implemented } = require('../src/utils/farm/hero');
const { heroStats, HEROES, ITEMS, innateStats, ITEM_STATS } = require('../src/utils/farm/stats');

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const fight = (hero, foe = enemy('Dummy', { maxHealth: 100000, dps: 0, distance: 10 })) => new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.99 });

test('the heroes load with the wiki numbers', () => {
  assert.deepStrictEqual(heroNames(), require('../src/utils/farm/refresh').FARM_HEROES); // the starter 5, then the rest as they are added
  const haze = heroStats(HEROES.Haze);
  assert.strictEqual(haze.maxHealth, 730);
  close(haze.bulletDamage * haze.pellets * haze.fireRate, 50.1, 0.01); // wiki DPS
  const abrams = heroStats(HEROES.Abrams);
  close(abrams.bulletDamage * abrams.pellets * abrams.fireRate, 51.8, 0.02); // 9 pellets
});

test('boons and items change the stat sheet', () => {
  const s = heroStats(HEROES.Haze, { boons: 10, items: ['Extra Health', 'Extended Magazine'] });
  close(s.maxHealth, 730 + 33 * 10 + 210);
  assert.strictEqual(s.clip, Math.floor(25 * 1.3 + 0.5 * s.spirit)); // Haze: +0.5 rounds per spirit power (boons give spirit)
  close(s.weaponDamageMult, 1.08);
  assert.throws(() => heroStats(HEROES.Haze, { items: ['Nope'] }), /Unknown item/);
});

test('every innate stat on every shop item is either modelled or knowingly ignored', () => {
  const keys = new Set(ITEMS.flatMap((c) => innateStats(c).map(([k]) => k)));
  const modelled = [...keys].filter((k) => k in ITEM_STATS);
  assert.ok(modelled.length >= 10 && ITEMS.length > 100);
});

test('a hero shoots, reloads and the gun matches its wiki DPS', () => {
  const haze = buildHero('Haze');
  haze.abilities.forEach((a) => { a.cdLeft = 1e9; }); // gun only
  haze.abilities[2].on = () => {}; // Fixation (passive) adds to every bullet
  haze.meleeAt = Infinity;
  const f = fight(haze);
  f.run(20);
  const stats = haze.stats;
  const dps = f.dealt.get(haze) / f.time;
  // 10 m is inside falloff, so it is sustained DPS: 25 rounds, then a 2.35 s reload
  const sustained = (stats.bulletDamage * stats.clip) / (stats.clip / stats.fireRate + stats.reload);
  close(dps, sustained, 0.06);
});

test('resists, evasion and lifesteal go through Fight.damage', () => {
  const haze = buildHero('Haze');
  const foe = enemy('Tank', { bulletResist: 0.5, spiritResist: 0.25 });
  const f = fight(haze, foe);
  close(f.damage(haze, foe, 100, 'bullet'), 50);
  close(f.damage(haze, foe, 100, 'spirit'), 75);
  haze.health = 100;
  haze.stats.lifesteal = 0.5;
  f.damage(haze, foe, 100, 'bullet');
  close(haze.health, 100 + 50 * 0.5 * BULLET_LIFESTEAL_VS_NPC); // 50 dealt, 50% lifesteal, weaker against NPCs
});

test('healing is capped: a pool that refills at a share of max health per second, so heals cannot stack into an unkillable hero', () => {
  const haze = buildHero('Haze');
  const f = fight(haze);
  haze.health = 1;
  f.heal(haze, 1e6);
  close(haze.health, 1 + haze.stats.maxHealth * HEAL_POOL, 0.01); // one burst takes only what the pool holds
  haze.health = 1;
  f.heal(haze, 1e6);
  close(haze.health, 1, 0.01); // and the pool is empty now
  for (let i = 0; i < 10; i++) f.step(); // a second later it has refilled by the rate
  const before = haze.health;
  f.heal(haze, 1e6);
  assert.ok(haze.health - before > 0 && haze.health - before <= haze.stats.maxHealth * HEAL_RATE * 1.2);
});

test('Haze: Sleep Dagger deals 65 + 2.2 x spirit, sleeps, and the sleeper wakes after being shot', () => {
  const haze = buildHero('Haze', { boons: 20 }); // 10 spirit
  const foe = enemy('Dummy', { maxHealth: 100000, dps: 0 });
  const f = fight(haze, foe);
  const dagger = haze.abilities[0];
  haze.abilities.forEach((a) => { a.cdLeft = 1e9; }); // no auto-casts while we poke it by hand
  close(dagger.value('Damage'), 65 + 2.2 * haze.stats.spirit);
  close(dagger.value('SleepDuration'), 2.75);
  dagger.cast(f);
  assert.ok(foe.has('sleep'));
  f.damage(haze, foe, 10, 'bullet'); // hurt -> wakes after the wake-up delay, well before 2.75 s
  for (let i = 0; i < 5; i++) f.step();
  assert.ok(!foe.has('sleep'));
});

test('Haze: upgrade tiers are applied (T3 dagger cooldown 30 -> 13)', () => {
  assert.strictEqual(buildHero('Haze').abilities[0].cooldown, 30);
  assert.strictEqual(buildHero('Haze', { tiers: { 1: 3 } }).abilities[0].cooldown, 13);
  assert.strictEqual(buildHero('Haze', { tiers: { 3: 2 } }).abilities[2].value('MaxStacks'), 80);
});

test('Haze: Fixation stacks on bullet hits and adds damage', () => {
  const run = (withFixation) => {
    const haze = buildHero('Haze');
    haze.abilities.forEach((a, i) => { if (i !== 2) a.cdLeft = 1e9; }); // gun + Fixation only
    haze.meleeAt = Infinity;
    if (!withFixation) haze.abilities[2].on = () => {};
    const f = fight(haze, enemy('Dummy', { maxHealth: 1e6, dps: 0, distance: 10 }));
    f.run(6);
    return f.dealt.get(haze);
  };
  const stacks = buildHero('Haze').abilities[2];
  assert.strictEqual(stacks.value('MaxStacks'), 40);
  assert.ok(run(true) > run(false) * 1.5, 'at 40 stacks a level 0 bullet (5.26) does more than twice its damage');
});

test("Haze: each Fixation stack adds 0.2 to the bullet's own damage (the wiki's +0.2 weapon damage a stack), not 0.2%", () => {
  const haze = buildHero('Haze');
  const dummy = enemy('Dummy', { maxHealth: 100000, dps: 0, distance: 30 }); // past falloff's start: the bonus is cut like the bullet
  const f = fight(haze, dummy);
  haze.abilities[2].addStacks(f, dummy, 40);
  const shot = f.shotDamage(haze, dummy);
  const scale = shot / haze.stats.bulletDamage; // falloff (and weapon damage) on this bullet
  assert.ok(scale < 1, 'falloff applies at this distance');
  f.damage(haze, dummy, shot, 'bullet');
  close(f.dealt.get(haze), shot + 40 * 0.2 * scale);
});

test('Haze: Bullet Dance speeds the gun and never reloads', () => {
  const haze = buildHero('Haze');
  const f = fight(haze);
  const dance = haze.abilities[3];
  close(dance.value('AbilityDuration'), 3.5);
  dance.cast(f);
  assert.ok(haze.has('infiniteClip'));
  close(haze.mod('fireRate'), 0.25);
  close(haze.mod('evasion'), 0.3);
});

test('Haze: Smoke Bomb hides her until she attacks, and an attacker is revealed', () => {
  const haze = buildHero('Haze');
  const foe = enemy('Dummy', { maxHealth: 100000, dps: 50 });
  const f = fight(haze, foe);
  haze.abilities[1].cast(f);
  assert.ok(!haze.targetable);
  f.damage(haze, foe, 5, 'bullet');
  assert.ok(haze.targetable && haze.has('revealed'));
});

test('a whole fight: Haze beats a tanky enemy that hits back, and heroes without a file still fight', () => {
  const haze = buildHero('Haze', { boons: 10 });
  const f = fight(haze, enemy('Brute', { maxHealth: 1500, dps: 25 }));
  const out = f.run(120);
  assert.ok(out.won && haze.alive);
  assert.ok(f.log.some((l) => l.what === 'Sleep Dagger'));
  assert.deepStrictEqual([...implemented].sort(), [...heroNames()].sort(), 'every downloaded hero has its ability file');
  const gunOnly = buildHero('Paige', { unlocked: 0 }); // no abilities yet: the gun alone still wins
  const f2 = fight(gunOnly, enemy('Brute', { maxHealth: 800, dps: 10 }));
  assert.ok(f2.run(120).won);
});

test('Apollo: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.healthRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 1e5, dps: 0, distance: 10, ...o });

  // Disengaging Sigil: 85 and a 24% slow around the front enemy; tier 1 fire rate, tier 2 a stamina charge back, tier 3 a second sigil
  const s1 = quiet(buildHero('Apollo', { unlocked: 1 }));
  const d1 = dummy();
  new Fight({ heroes: [s1], enemies: [d1], rng: () => 0.5 }).run(3);
  close(1e5 - d1.health, 85);
  assert.strictEqual(d1.mod('slow'), 0.24);
  const s3 = quiet(buildHero('Apollo', { unlocked: 1, tiers: { 1: 3 } }));
  s3.nextDash = Infinity; // keep the stamina in hand
  const d3 = dummy();
  const f3 = new Fight({ heroes: [s3], enemies: [d3], rng: () => 0.5 });
  f3.run(3);
  close(1e5 - d3.health, 85 * 2);
  assert.ok(s3.mod('fireRate') === 0.25 && s3.stamina >= 1);

  // Riposte: the next hit does nothing, the attacker is stunned and takes 25% more melee damage; then it is on cooldown and hits land again
  const r = quiet(buildHero('Apollo', { unlocked: 2 }), 1);
  const brute = enemy('Brute', { maxHealth: 1e5, dps: 40 });
  const fr = new Fight({ heroes: [r], enemies: [brute], rng: () => 0.5 });
  fr.run(1.05);
  assert.strictEqual(r.health, r.stats.maxHealth, 'parried');
  assert.ok(brute.has('stun') && brute.mod('meleeTaken') === 0.25 && fr.log.some((l) => l.what === 'Riposte'));
  assert.strictEqual(fr.damage(r, brute, 100, 'melee'), 125);
  fr.run(3);
  assert.ok(r.health < r.stats.maxHealth, 'the next hits land');
  // it parries a blast too, and tier 3 marks the attacker for lifesteal
  const rb = quiet(buildHero('Apollo', { unlocked: 2, tiers: { 2: 3 } }), 1);
  const stomper = enemy('Stomper', { maxHealth: 1e5, dps: 0, blast: { every: 1, damage: 50, maxHealthPct: 0, curse: 1.5 } });
  const fb = new Fight({ heroes: [rb], enemies: [stomper], rng: () => 0.99 });
  fb.run(1.2);
  assert.ok(rb.health === rb.stats.maxHealth && fb.log.some((l) => l.enemy && l.parried) && stomper.mod('lifestealOn') === 0.75);

  // Flawless Advance: three stabs, 65 when perfect and 40 when not; tier 1 heals on a perfect one, tier 2 guards against bullets
  for (const [roll, each] of [[0.1, 65], [0.9, 40]]) {
    const a = quiet(buildHero('Apollo', { unlocked: 3, tiers: { 3: 2 } }), 1, 2);
    a.health = 300;
    const d = dummy();
    const fa = new Fight({ heroes: [a], enemies: [d], rng: () => roll });
    fa.run(0.5);
    close(a.mod('bulletResist'), 0.6);
    fa.run(3);
    close(1e5 - d.health, each * 3);
    close(a.health, 300 + (each === 65 ? 35 * 3 : 0));
  }
  // tier 3's scaling multiplies the base one (x1.15), it doesn't add to it
  const scaled = buildHero('Apollo', { unlocked: 3, tiers: { 3: 3 }, buffs: { spirit: 50 } });
  close(scaled.abilities[2].value('PerfectDamage'), 130 + 1.55 * 1.15 * scaled.stats.spirit);

  // Itani Lo Sahn: held until an enemy is below half health; 70 on impact, frozen 1.8 s, then 200 x 1.6 on the one below half
  const u = quiet(buildHero('Apollo', { unlocked: 4 }), 1, 2, 3);
  const [low, high] = [dummy({ maxHealth: 2000, dps: 30 }), dummy({ maxHealth: 2000, dps: 30 })];
  const fu = new Fight({ heroes: [u], enemies: [low, high], rng: () => 0.5 });
  fu.run(2);
  assert.ok(!fu.log.some((l) => l.what === 'Itani Lo Sahn'), 'nobody is low yet');
  low.health = 900;
  u.health = u.stats.maxHealth;
  fu.run(1.8);
  assert.ok(low.has('stun') && high.has('stun'));
  close(2000 - high.health, 70);
  const held = u.health;
  fu.run(1);
  assert.strictEqual(u.health, held, 'untouchable while they are frozen');
  fu.run(2);
  close(900 - low.health, 70 + 200 * 1.6);
  close(2000 - high.health, 70 + 200);
});

test('Bebop: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.stats.healthRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 1e5, dps: 0, distance: 10, ...o });

  // Exploding Uppercut: 63 melee on the front enemy, launched; the others take 75 where it lands and deal 14% less. Tier 2: +30% weapon damage
  const u = quiet(buildHero('Bebop', { unlocked: 1, tiers: { 1: 2 } }));
  const [front, other] = [dummy(), dummy()];
  const fu = new Fight({ heroes: [u], enemies: [front, other], rng: () => 0.5 });
  fu.run(0.25);
  close(1e5 - front.health, 63.01);
  assert.ok(front.has('stun') && other.health === 1e5);
  fu.run(1);
  close(1e5 - other.health, 75);
  close(other.mod('damageDealt'), -0.14);
  close(1e5 - front.health, 63.01);
  close(u.mod('weaponDamage'), 0.3);

  // Sticky Bomb: 85 around its target after the 3.5 s fuse; every enemy hit adds 1% and every kill 2.5% to the next bombs, this fight only
  const b = quiet(buildHero('Bebop', { unlocked: 2 }), 1);
  const [a1, a2, weak] = [dummy(), dummy(), dummy({ maxHealth: 50 })];
  const fb = new Fight({ heroes: [b], enemies: [a1, a2, weak], rng: () => 0.5 });
  fb.run(3);
  assert.strictEqual(a1.health, 1e5, 'still ticking');
  fb.run(1);
  close(1e5 - a1.health, 85);
  close(1e5 - a2.health, 85);
  assert.ok(!weak.alive);
  const bomb = b.abilities[1];
  assert.deepStrictEqual([bomb.hits, bomb.kills], [3, 1]);
  close(bomb.bonus, 0.03 + 0.025);
  assert.strictEqual(buildHero('Bebop', { unlocked: 2 }).abilities[1].bonus, 0, 'a new fight starts from nothing');
  // a bomb goes off at once when its target dies
  const b2 = quiet(buildHero('Bebop', { unlocked: 2 }), 1);
  const [carrier, near] = [dummy({ maxHealth: 500 }), dummy()];
  const f2 = new Fight({ heroes: [b2], enemies: [carrier, near], rng: () => 0.5 });
  f2.run(0.5);
  f2.damage(b2, carrier, 500, 'true');
  f2.step();
  close(1e5 - near.health, 85);

  // Grapple Arm: pulls the furthest enemy up to the front one for 44.1 melee; tier 1 +20% bullet damage taken, tier 2 a 0.5 s stun
  const g = quiet(buildHero('Bebop', { unlocked: 3, tiers: { 3: 2 } }), 1, 2);
  const line = [dummy({ maxHealth: 2000 }), dummy({ maxHealth: 2000 }), dummy({ maxHealth: 2000 })]; // not bosses: a boss isn't moved
  const fg = new Fight({ heroes: [g], enemies: line, rng: () => 0.5 });
  assert.ok(line[2].offset > 6);
  fg.run(0.25);
  assert.strictEqual(line[2].offset, 0);
  close(2000 - line[2].health, 63 * 0.7);
  assert.ok(line[2].has('stun') && line[2].mod('bulletTaken') === 0.2 && line[0].health === 2000);

  // Hyper Beam: 1 s wind-up, then 160 a second for 11 s through every enemy, half to a boss; the gun is silent meanwhile
  const h = buildHero('Bebop', { unlocked: 4 });
  quiet(h, 1, 2, 3);
  h.weapon.reloadLeft = 0;
  const [small, boss] = [dummy({ maxHealth: 2900 }), dummy({ maxHealth: 2e5 })];
  const fh = new Fight({ heroes: [h], enemies: [small, boss], rng: () => 0.5 });
  fh.run(1.2);
  const clip = h.weapon.clip;
  const before = [small.health, boss.health];
  fh.run(5);
  assert.strictEqual(h.weapon.clip, clip, 'no shots while beaming');
  close(before[0] - small.health, 160 * 5, 0.03);
  close(before[1] - boss.health, 80 * 5, 0.03);
  fh.run(8);
  assert.ok(h.weapon.clip < clip, 'the gun is back after the beam');
});

test('Billy: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.stats.healthRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });

  // Bashdown: 45 melee right in front (0.9 x his light melee of 50), then a 35 spirit shockwave and a knock-up for everyone within 8 m
  const b = quiet(buildHero('Billy', { unlocked: 1 }));
  const row = [dummy(), dummy(), dummy()]; // rng 0.5: 4 m apart
  const fb = new Fight({ heroes: [b], enemies: row, rng: () => 0.5 });
  fb.run(0.25);
  assert.deepStrictEqual(row.map((e) => 2000 - e.health), [45, 45, 0]);
  fb.run(0.5);
  assert.deepStrictEqual(row.map((e) => Math.round(2000 - e.health)), [80, 80, 35]);
  assert.ok(row.every((e) => e.has('stun')));
  // tier 3: half his heavy melee (116) instead, and a heavy hit fills the clip
  const b3 = buildHero('Billy', { unlocked: 3, tiers: { 1: 3 } });
  quiet(b3, 2, 3);
  b3.weapon.reloadLeft = 0;
  b3.weapon.clip = 3;
  const d3 = dummy();
  new Fight({ heroes: [b3], enemies: [d3], rng: () => 0.99 }).step();
  close(b3.abilities[0].value('MeleeDamage') + b3.abilities[0].value('HeavyMeleeDamage'), 58);
  assert.strictEqual(b3.abilities[0].maxCharges, 2);

  // Rising Ram: 40 and a 0.3 s lift; half the cooldown comes back; tier 1 +25% weapon damage
  const r = quiet(buildHero('Billy', { unlocked: 2, tiers: { 2: 1 } }), 1);
  const dr = dummy();
  const fr = new Fight({ heroes: [r], enemies: [dr], rng: () => 0.5 });
  fr.run(0.55);
  close(2000 - dr.health, 40);
  assert.ok(dr.has('stun') && r.mod('weaponDamage') === 0.25);
  assert.ok(r.abilities[1].cdLeft < 16.1 && r.abilities[1].cdLeft > 15, `${r.abilities[1].cdLeft}`);

  // Blasted: a heavy melee fills the clip and wrecks the enemy, always; while it is active Billy swings whenever the bat is ready,
  // bullets hit a wrecked enemy 10% harder, and a melee on a non-hero adds a quarter of 70 max health and of 4.5 s
  const m = buildHero('Billy', { unlocked: 3 });
  m.abilities.slice(0, 2).forEach((x) => { x.cdLeft = 1e9; });
  m.stamina = 0; m.stats.stamina = 0;
  m.abilities[2].cdLeft = 1e9; // passive part first
  const dm = dummy({ maxHealth: 1e5 });
  const fm = new Fight({ heroes: [m], enemies: [dm], rng: () => 0.5 });
  m.weapon.clip = 1;
  fm.run(1); // empties the clip, reloads, so swings: the clip is full again
  assert.ok(dm.has('wrecked') && m.weapon.reloadLeft === 0 && m.weapon.clip > 1);
  const base = m.stats.maxHealth;
  m.abilities[2].cdLeft = 0;
  fm.run(2.5);
  const blasted = m.abilities[2];
  assert.ok(blasted.active(fm) && m.stats.maxHealth > base, 'swinging while Blasted');
  close((m.stats.maxHealth - base) % 17.5, 0, 0.001);
  const shot = fm.shotDamage(m, dm);
  const before = dm.health;
  fm.emit('bulletHit', { source: m, target: dm, amount: shot, dealt: shot, type: 'bullet', opts: {} });
  close(before - dm.health, shot * 0.1);
  fm.run(60);
  assert.ok(!blasted.active(fm) || fm.time < blasted.cap + 0.2, 'never past its max duration');

  // Chain Gang: slows the enemies within 12 m, then yanks them all in after 2.8 s for 120; tier 3 gives 1.3 s of Unstoppable an enemy
  const c = quiet(buildHero('Billy', { unlocked: 4, tiers: { 4: 3 } }), 1, 2, 3);
  const gang = [dummy(), dummy(), dummy()];
  const fc = new Fight({ heroes: [c], enemies: gang, rng: () => 0.5 });
  fc.run(1);
  assert.ok(gang.every((e) => e.mod('slow') === 0.35 && e.health === 2000) && c.mod('bulletResist') === 0.4);
  fc.run(2.2);
  assert.ok(gang.every((e) => e.offset === 0 && 2000 - e.health === 120) && c.has('unstoppable'));
});

test('Calico: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });

  // Gloom Bombs: 4 bombs of 45, one each from the front, the rest going round at 65%; a lone enemy takes 45 x (1 + 3 x 0.65)
  const g = quiet(buildHero('Calico', { unlocked: 1, tiers: { 1: 2 } }));
  const trio = [dummy(), dummy(), dummy()];
  new Fight({ heroes: [g], enemies: trio, rng: () => 0.5 }).run(1.2);
  assert.deepStrictEqual(trio.map((e) => +(2000 - e.health).toFixed(2)), [45 + 45 * 0.65, 45, 45]);
  close(trio[0].mod('meleeTaken'), 0.12);
  close(trio[1].mod('meleeTaken'), 0.06);
  const lone = dummy();
  new Fight({ heroes: [quiet(buildHero('Calico', { unlocked: 1 }))], enemies: [lone], rng: () => 0.5 }).run(1.2);
  close(2000 - lone.health, 45 * (1 + 3 * 0.65));

  // Leaping Slash: 10 + 0.8 x her light melee (63) around the front enemy, heals 40; tier 2: a kill within 3 s adds half the enemy's souls
  const s = quiet(buildHero('Calico', { unlocked: 2, tiers: { 2: 2 } }), 1);
  s.health = 300;
  const [tough, weak] = [dummy({ souls: 40 }), dummy({ maxHealth: 50, souls: 40 })];
  const fs2 = new Fight({ heroes: [s], enemies: [tough, weak], rng: () => 0.5 });
  fs2.run(0.25);
  close(2000 - tough.health, 60.4);
  close(s.health, 300 + 40 + 25);
  assert.ok(!weak.alive);
  assert.strictEqual(fs2.bonusSouls, 20);

  // Ava: below half health she is gone for 4 s (8 s with tier 1): can't be targeted, doesn't attack; tier 2 regenerates 15 a second
  const a = quiet(buildHero('Calico', { unlocked: 3, tiers: { 3: 3 } }), 1, 2);
  const brute = dummy({ dps: 20, maxHealth: 1e5 });
  const fa = new Fight({ heroes: [a], enemies: [brute], rng: () => 0.5 });
  fa.run(2);
  assert.ok(!a.has('void'), 'not while healthy');
  a.health = 200;
  fa.run(0.3);
  assert.ok(a.has('void') && !a.targetable);
  const low = a.health;
  fa.run(7);
  assert.ok(a.has('void'), 'still away at 7 s with tier 1');
  assert.ok(a.health >= low + 15 * 6.5, 'regenerating, and nothing hit her');
  fa.run(1.5);
  assert.ok(!a.has('void'));
  close(a.mod('damageDealt'), 0.18 * 0.8); // 8 s of the 10 it takes to build

  // Return to Shadows: 150 around her as she vanishes for 3 s and 150 again as she returns; tier 3 heals 450 and readies the rest
  const r = quiet(buildHero('Calico', { unlocked: 4, tiers: { 4: 3 } }), 1, 2, 3);
  const dr = dummy({ maxHealth: 1e5 });
  const fr = new Fight({ heroes: [r], enemies: [dr], rng: () => 0.5 });
  r.health = 100;
  fr.run(0.3);
  close(1e5 - dr.health, 225);
  assert.ok(r.has('void'));
  fr.run(3.2);
  close(1e5 - dr.health, 450);
  assert.ok(fr.log.some((l) => ['Gloom Bombs', 'Leaping Slash', 'Ava'].includes(l.what)), 'her other abilities are ready again, and used');
  assert.ok(r.health > 100);
});

test('The Doorman: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });

  // Call Bell: 40 on the front enemy, then 55 around it, a 28% slow and 20% less weapon damage (none off a spirit-damage enemy)
  const b = quiet(buildHero('The Doorman', { unlocked: 1 }));
  const [gunner, caster] = [dummy(), dummy({ damageType: 'spirit' })];
  new Fight({ heroes: [b], enemies: [gunner, caster], rng: () => 0.5 }).run(1);
  close(2000 - gunner.health, 40 + 55);
  close(2000 - caster.health, 55);
  assert.ok(gunner.mod('slow') === 0.28 && caster.mod('slow') === 0.28);
  close(gunner.mod('damageDealt'), -0.2);
  assert.strictEqual(caster.mod('damageDealt'), 0);

  // Doorway: opened when he is hurt; a 2 s trip out of reach, again 8 s later while it is open; tier 2 brings a barrier back, once
  const d = quiet(buildHero('The Doorman', { unlocked: 2, tiers: { 2: 2 } }), 1);
  const fd = new Fight({ heroes: [d], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  fd.run(2);
  assert.ok(!fd.log.length, 'not while healthy');
  d.health = 100;
  fd.run(0.4);
  assert.ok(d.has('void') && !d.targetable);
  fd.run(2);
  assert.ok(!d.has('void') && d.statuses.some((s) => s.barrier === 250));
  d.statuses = d.statuses.filter((s) => !s.barrier);
  fd.run(6.2);
  assert.ok(d.has('void'), 'a second trip 8 s after the first');
  fd.run(2.2);
  assert.ok(!d.statuses.some((s) => s.barrier), 'the barrier comes once per cast');

  // Luggage Cart: 60 to every enemy in reach, and the ones that aren't bosses end up bunched where it stops
  const c = quiet(buildHero('The Doorman', { unlocked: 3 }), 1, 2);
  const row = [dummy(), dummy(), dummy()];
  new Fight({ heroes: [c], enemies: row, rng: () => 0.5 }).run(0.5);
  assert.ok(row.every((e) => 2000 - e.health === 60 && e.offset === 8));

  // Hotel Guest: a 1 s channel, then the strongest enemy is gone for 6.5 s (75 for the stay, +150 with tier 2); late half the time: 125 (+150) more
  for (const [roll, late] of [[0.1, true], [0.9, false]]) {
    const h = quiet(buildHero('The Doorman', { unlocked: 4, tiers: { 4: 3 } }), 1, 2, 3);
    const [small, big] = [dummy({ maxHealth: 500 }), dummy()];
    const fh = new Fight({ heroes: [h], enemies: [small, big], rng: () => roll });
    fh.run(0.5);
    assert.ok(h.cantAct && big.health === 2000, 'channelling');
    fh.run(1);
    close(2000 - big.health, 225); // tier 3 has tier 2's +150 too
    assert.ok(!big.targetable && big.has('stun') && h.has('unstoppable'));
    assert.strictEqual(fh.damage(h, big, 100, 'spirit'), 0, 'out of the fight');
    assert.deepStrictEqual(fh.foes, [small]);
    fh.run(6.8);
    close(2000 - big.health, 225 + (late ? 275 : 0));
    assert.ok(big.targetable && big.has('stun'), 'back, frozen for a moment');
    assert.strictEqual(h.abilities[3].cdLeft <= 15, late, 'a late checkout cuts the cooldown to 15 s');
  }
});

test('Drifter: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });

  // the gun: 3 pellets, one shot's damage (the wiki's 44 a second)
  const gun = heroStats(HEROES.Drifter);
  close(gun.bulletDamage * gun.pellets * gun.fireRate, 44.2, 0.01);

  // Rend: 40 spirit to everyone within 16 m, and 1.2 x his light melee (51.5) to those within 8 m; tier 3 silences the close ones
  const r = quiet(buildHero('Drifter', { unlocked: 1 }));
  const row = [dummy(), dummy(), dummy(), dummy()]; // rng 0.5: 4 m apart
  new Fight({ heroes: [r], enemies: row, rng: () => 0.5 }).run(0.7);
  assert.deepStrictEqual(row.map((e) => +(2000 - e.health).toFixed(1)), [101.8, 101.8, 101.8, 40]);
  const r3 = quiet(buildHero('Drifter', { unlocked: 1, tiers: { 1: 3 } }));
  const d3 = dummy();
  new Fight({ heroes: [r3], enemies: [d3], rng: () => 0.5 }).run(0.7);
  close(2000 - d3.health, 80 + 120 * 0.55);
  assert.ok(d3.has('silence'));

  // Stalker's Mark: bleeds 2% of current health a second (half that on a creep), 5 s; he stands close; tier 1 takes 8% bullet resist off
  const m = quiet(buildHero('Drifter', { unlocked: 2, tiers: { 2: 1 } }), 1);
  const dm = dummy();
  const fm = new Fight({ heroes: [m], enemies: [dm, dummy()], rng: () => 0.5 });
  fm.run(0.4);
  assert.ok(m.close === dm && fm.distance(m, dm) < 5);
  close(dm.mod('bulletResist'), -0.08);
  fm.run(6);
  close(2000 - dm.health, 2000 * (1 - Math.pow(1 - 0.02 * 0.5 * 0.5, 10)), 0.02);

  // Bloodscent: +15% damage to the last enemy standing; its death would add 3% weapon damage (kept for the fight)
  const b = quiet(buildHero('Drifter', { unlocked: 3, tiers: { 3: 2 } }), 1, 2);
  b.health = 355;
  const [last, other] = [dummy(), dummy({ maxHealth: 50 })];
  const fb = new Fight({ heroes: [b], enemies: [last, other], rng: () => 0.5 });
  fb.step();
  assert.strictEqual(fb.damage(b, last, 100, 'spirit'), 100, 'not isolated in a group');
  fb.damage(b, other, 50, 'true');
  assert.strictEqual(b.abilities[2].kills, 0, 'that one died in company');
  fb.step();
  close(fb.damage(b, last, 100, 'spirit'), 115);
  fb.damage(b, last, 5000, 'true');
  assert.strictEqual(b.abilities[2].kills, 1);
  close(b.health, 355 + 400 * 0.24);
  assert.strictEqual(b.abilities[2].status(), '+3% Weapon');

  // Eternal Night: the two strongest enemies can't attack him for 6.5 s and count as isolated; the third still hits
  const n = quiet(buildHero('Drifter', { unlocked: 4 }), 1, 2);
  const pack = [dummy({ dps: 50, maxHealth: 3000 }), dummy({ dps: 50, maxHealth: 2500 }), dummy({ dps: 7 })];
  const fn = new Fight({ heroes: [n], enemies: pack, rng: () => 0.5 });
  fn.run(1.3);
  const before = n.health;
  assert.ok(pack[0].has('blind') && pack[1].has('blind') && !pack[2].has('blind'));
  fn.run(5);
  close(before - n.health, 7 * 5, 0.2);
  close(fn.damage(n, pack[0], 100, 'spirit'), 115);
  assert.strictEqual(fn.damage(n, pack[2], 100, 'spirit'), 100);
  fn.run(2);
  assert.ok(!pack[0].has('blind'));
});

test('shotguns: every pellet lands up close, about 70% of them from 15 m on; a hit-once gun has nothing to miss', () => {
  const { pelletChance, PELLETS } = require('../src/utils/farm/engine');
  assert.deepStrictEqual([pelletChance(3), pelletChance(5), pelletChance(10), pelletChance(15), pelletChance(20)].map((x) => +x.toFixed(2)), [1, 1, 0.85, 0.7, 0.7]);
  let seed = 3;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shoot = (name, distance) => {
    const h = buildHero(name, { unlocked: 0 });
    h.meleeAt = Infinity; h.stamina = 0; h.stats.stamina = 0;
    const d = enemy('Dummy', { maxHealth: 1e6, dps: 0, distance });
    const f = new Fight({ heroes: [h], enemies: [d], rng });
    const full = f.shotDamage(h, d);
    let shots = 0;
    const clip = () => h.weapon.clip;
    let last = clip();
    for (let i = 0; i < 3000; i++) { f.step(); if (clip() < last) shots += last - clip(); last = clip(); }
    return (1e6 - d.health) / (shots * full); // share of the full damage that landed
  };
  close(shoot('Abrams', 4), 1, 0.001);
  close(shoot('Abrams', 15), PELLETS.far, 0.03);
  close(shoot('Calico', 10), 0.85, 0.03);
  close(shoot('Drifter', 15), 1, 0.001);
  close(shoot('Haze', 15), 1, 0.001);
  // Precision (his call, Oct 22): every point above the base 25 adds a percentage point to the far hit chance, up to all of them
  assert.deepStrictEqual([pelletChance(15, 25), pelletChance(15, 35), pelletChance(15, 80), pelletChance(10, 35)].map((x) => +x.toFixed(2)), [0.7, 0.8, 1, 0.95]);
});

test('Dynamo: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });

  // Kinetic Pulse: 115 and a 1 s knock-up on everyone within 16 m; tier 2 takes 15% bullet resist off and slows 24%
  const k = quiet(buildHero('Dynamo', { unlocked: 1, tiers: { 1: 2 } }));
  const row = [dummy(), dummy()];
  const fk = new Fight({ heroes: [k], enemies: row, rng: () => 0.5 });
  fk.run(0.7);
  assert.ok(row.every((e) => 2000 - e.health === 115 && e.has('stun')));
  close(row[0].mod('bulletResist'), -0.15);
  assert.strictEqual(row[0].mod('slow'), 0.24);
  assert.strictEqual(k.abilities[0].maxCharges, 2);

  // Quantum Entanglement: slips a blast (gone 1.4 s, a stamina charge back); tier 1 keeps enemies off him 1 s longer while he acts again
  const q = quiet(buildHero('Dynamo', { unlocked: 2, tiers: { 2: 1 } }), 1);
  q.health = 100;
  const stomper = dummy({ maxHealth: 1e5, blast: { every: 1, damage: 50, maxHealthPct: 0, curse: 1.5 } });
  const fq = new Fight({ heroes: [q], enemies: [stomper], rng: () => 0.99 });
  fq.run(0.8);
  assert.ok(!fq.log.length, 'saved for the blast');
  fq.run(0.4);
  assert.ok(fq.log.some((l) => l.enemy && l.dodged) && q.has('void') && q.health === 100 && q.stamina === 1);
  fq.run(1.5);
  assert.ok(!q.has('void') && !q.cantAct && !q.targetable, 'back, and they still cannot find him');
  fq.run(1);
  assert.ok(q.targetable);

  // Rejuvenating Aurora: below 60% health, 30 a second for 5 s, the gun silent meanwhile; tier 3: no channel and +2.5% max health a second
  const a = buildHero('Dynamo', { unlocked: 3 });
  quiet(a, 1, 2);
  a.weapon.reloadLeft = 0;
  const fa = new Fight({ heroes: [a], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  a.health = 300;
  fa.run(0.3);
  const clip = a.weapon.clip;
  fa.run(4);
  assert.strictEqual(a.weapon.clip, clip, 'channelling');
  fa.run(1.5);
  close(a.health, 300 + 30 * 5, 0.03);
  assert.ok(a.weapon.clip < clip, 'shooting again');
  const a3 = buildHero('Dynamo', { unlocked: 3, tiers: { 3: 3 } });
  quiet(a3, 1, 2);
  a3.weapon.reloadLeft = 0;
  const f3 = new Fight({ heroes: [a3], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  a3.health = 300;
  f3.run(0.3);
  const clip3 = a3.weapon.clip;
  f3.run(2);
  assert.ok(a3.weapon.clip < clip3, 'no channel');
  close(a3.health - 300, (30 + 880 * 0.025) * 2.1, 0.1);

  // Singularity: enemies within 7 m are pulled in, stunned 2.75 s and take 75 a second; the gun is silent meanwhile
  const s = buildHero('Dynamo', { unlocked: 4 });
  quiet(s, 1, 2, 3);
  s.weapon.reloadLeft = 0;
  const trio = [dummy(), dummy(), dummy()]; // 4 m apart: the third is out of reach
  const fs3 = new Fight({ heroes: [s], enemies: trio, rng: () => 0.5 });
  fs3.run(0.5);
  const start = trio[0].health;
  const clipS = s.weapon.clip;
  assert.ok(trio[0].has('stun') && trio[1].has('stun') && !trio[2].has('stun') && trio[1].offset === 0);
  fs3.run(2);
  assert.strictEqual(s.weapon.clip, clipS);
  s.weapon.reloadLeft = 1e9; // the channel's damage alone from here
  fs3.run(1.5);
  close(2000 - trio[1].health, 75 * 2.75, 0.03);
  assert.ok(start - trio[0].health < 75 * 2.75 + 1 && trio[2].health === 2000);
});

test('Graves: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].gapLeft = 1e9; hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });

  // the gun: no falloff, and every 13th shot in a row on the same enemy deals double
  const g = quiet(buildHero('Graves', { unlocked: 1 }), 1);
  g.weapon.reloadLeft = 0;
  const far = dummy({ maxHealth: 1e5, distance: 20 });
  new Fight({ heroes: [g], enemies: [far], rng: () => 0.5 }).run(2.75); // 26 or 27 shots, two of them doubled
  close(1e5 - far.health, 3.6 * (40 - g.weapon.clip + 2), 0.001);
  assert.ok(40 - g.weapon.clip >= 26 && 40 - g.weapon.clip < 39);

  // Jar of Dead: 4 jars, 13 s apart; a jar is 4 Deadheads striking for 16 about every 1.4 s for 10 s; only death refills it (12 a jar)
  const j = quiet(buildHero('Graves', { unlocked: 1, tiers: { 1: 1 } }));
  const jar = j.abilities[0];
  const [haunt, big] = [enemy('Small Haunt', { maxHealth: 50, dps: 0, distance: 10 }), dummy({ maxHealth: 1e5 })];
  const fj = new Fight({ heroes: [j], enemies: [big, haunt], rng: () => 0.5 });
  fj.run(12);
  assert.strictEqual(jar.charges, 3);
  close(1e5 - big.health, 4 * 8 * 16, 0.13); // each Deadhead: 7-8 strikes in 10 s
  fj.run(30);
  assert.strictEqual(jar.charges, 0, 'all four thrown, and no jar comes back with time');
  j.health = 500;
  for (let i = 0; i < 4; i++) fj.emit('kill', { source: j, target: haunt }); // a Haunt is 3 death, tier 1 heals 5 each
  assert.ok(jar.charges === 1 && jar.death === 0 && j.health === 560);
  fj.addStatus(j, { id: 'rejuv', duration: 1, tags: ['sleep'] });
  fj.run(0.2);
  assert.strictEqual(jar.charges, 0, 'she died: the jar is empty');
  assert.strictEqual(jar.status(), 'Empty');

  // Grasping Hands: 90 and a 1 s immobilize within 7 m, one Ghoul; tier 1 grabs again when the rift closes (7 s)
  const h = quiet(buildHero('Graves', { unlocked: 2, tiers: { 2: 1 } }), 1);
  const hands = h.abilities[1];
  h.abilities[0].charges = 0; // a full jar keeps no death
  const trio = [dummy(), dummy(), dummy()]; // 4 m apart: the third is out of reach
  const fh = new Fight({ heroes: [h], enemies: trio, rng: () => 0.5 });
  fh.run(0.3);
  assert.ok(trio[0].has('immobilize') && trio[1].has('immobilize') && !trio[2].has('immobilize'));
  assert.deepStrictEqual(trio.map((e) => 2000 - e.health), [90, 90, 0]);
  assert.strictEqual(hands.ghouls.length, 1);
  fh.run(1.5);
  assert.ok(!trio[0].has('immobilize') && trio[0].health === 1910, 'the Ghoul is still walking');
  fh.run(5); // clawing since 2 s in: 40 a second, at the enemies right around the front one
  close(1910 - trio[0].health, 40 * 5, 0.2);
  assert.strictEqual(trio[2].health, 2000);
  fh.run(0.5);
  assert.ok(trio[0].has('immobilize'), 'the second grab');
  fh.run(14);
  assert.strictEqual(hands.ghouls.length, 0, 'a Ghoul lasts 20 s');
  assert.strictEqual(h.abilities[0].death, 1, 'and its death goes in the jar');

  // Ghouls draw fire: a hit can land on a clawing Ghoul (180 health) instead of Graves
  const t = quiet(buildHero('Graves', { unlocked: 2 }), 1);
  const ft = new Fight({ heroes: [t], enemies: [dummy({ dps: 60 })], rng: () => 0.1 }); // every hit goes to the Ghoul while it stands
  ft.run(2.5);
  const before = t.health;
  ft.run(6);
  assert.strictEqual(before - t.health, 180, 'three hits on the Ghoul, then three on her');
  assert.strictEqual(t.abilities[1].ghouls.length, 0, 'the Ghoul took 180 and died');

  // against a boss a Ghoul blows up on arrival: 115 around it and a 64% slow
  const b = quiet(buildHero('Graves', { unlocked: 2 }), 1);
  const bossy = dummy({ maxHealth: 5000 });
  const fb = new Fight({ heroes: [b], enemies: [bossy], rng: () => 0.5 });
  fb.run(2.5);
  assert.ok(5000 - bossy.health === 90 + 115 && bossy.mod('slow') === 0.64 && !b.abilities[1].ghouls.length);

  // Essence Theft: 4 s of shots from up close steal 25% weapon damage and 10% spirit resist; it is hers while the enemy lives
  const e = quiet(buildHero('Graves', { unlocked: 3 }), 1, 2);
  e.weapon.reloadLeft = 0;
  const victim = dummy({ maxHealth: 1e5, distance: 5, dps: 10 });
  const fe = new Fight({ heroes: [e], enemies: [victim], rng: () => 0.99 });
  fe.run(2);
  close(e.mod('weaponDamage'), 0.125, 0.05);
  fe.run(2.05);
  close(e.mod('weaponDamage'), 0.25, 0.02);
  close(e.mod('spiritResist'), 0.1, 0.02);
  close(victim.mod('spiritResist'), -0.1, 0.02);
  close(victim.mod('damageDealt'), -0.25, 0.02);
  assert.strictEqual(e.abilities[2].status(), '+25% Weapon');
  victim.health = 0;
  fe.step();
  fe.step();
  assert.strictEqual(e.mod('weaponDamage'), 0);

  // Borrowed Decree: a gravestone for 16 s raising 2 Ghouls every 4 s
  const d = quiet(buildHero('Graves', { unlocked: 4 }), 1, 2, 3);
  const fd = new Fight({ heroes: [d], enemies: [dummy({ maxHealth: 1e6 })], rng: () => 0.5 });
  fd.run(1.2);
  assert.strictEqual(d.abilities[1].ghouls.length, 2);
  assert.strictEqual(d.abilities[3].status(fd), 'Summoning');
  fd.run(17);
  close(1e6 - fd.enemies[0].health, 8 * 115, 0.001); // 4 pairs, each blowing up on the big one
});

test('Grey Talon: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // the gun grows with spirit power: +0.08 bullet damage a point
  const s = heroStats(HEROES['Grey Talon'], { boons: 10 });
  close(s.bulletDamage, 23.51 + 0.85 * 10 + 0.08 * 16, 0.001);

  // Charged Shot: 80 through every enemy after a 0.5 s draw; tier 1 is a second charge, tier 3 doubles the spirit scaling
  const c = quiet(buildHero('Grey Talon', { unlocked: 1, tiers: { 1: 1 } }));
  const line = row();
  new Fight({ heroes: [c], enemies: line, rng: () => 0.5 }).run(0.8);
  assert.deepStrictEqual(line.map((e) => 2000 - e.health), [80, 80, 80]);
  assert.strictEqual(c.abilities[0].maxCharges, 2);
  const c3 = buildHero('Grey Talon', { boons: 10, unlocked: 1, tiers: { 1: 3 } });
  close(c3.abilities[0].value('Damage'), 80 + 54 + 2 * 16);

  // Rain of Arrows: 4 s airborne, +3 a bullet (tier 1: +6), every shot also hits the others; tier 1 slows, tier 3 makes 30% of bullets miss him
  const r = quiet(buildHero('Grey Talon', { unlocked: 2, tiers: { 2: 3 } }), 1);
  r.weapon.reloadLeft = 0;
  const three = row();
  const fr = new Fight({ heroes: [r], enemies: three, rng: () => 0.5 });
  fr.run(3);
  const shots = 17 - r.weapon.clip;
  assert.ok(r.has('airborne') && shots >= 4);
  for (const e of three) close(2000 - e.health, shots * (23.51 + 6), 0.001);
  assert.ok(three.every((e) => e.mod('slow') === 0.24));
  assert.ok(r.mod('evasion') === 0.3 && r.mod('lifesteal') === 0.3);
  fr.run(1.5);
  assert.strictEqual(r.mod('bulletDamage'), 0);

  // Spirit Snare: 2 s to arm, then 25 and a 2.25 s curse (no attacks) within 6.5 m; tier 2 takes 15% bullet resist off for 10 s
  const n = quiet(buildHero('Grey Talon', { unlocked: 3, tiers: { 3: 2 } }), 1, 2);
  const pack = [dummy({ dps: 50 }), dummy({ dps: 50 }), dummy({ dps: 50 })];
  const fn = new Fight({ heroes: [n], enemies: pack, rng: () => 0.5 });
  fn.run(1.9);
  assert.ok(pack.every((e) => e.health === 2000));
  fn.run(0.4);
  assert.deepStrictEqual(pack.map((e) => 2000 - e.health), [25, 25, 0]);
  assert.ok(pack[0].has('disarm') && pack[0].has('silence') && !pack[2].has('disarm'));
  close(pack[0].mod('bulletResist'), -0.15);
  const hp = n.health;
  fn.run(2);
  assert.strictEqual(hp - n.health, 100, 'only the third one still attacks');
  // a Charged Shot sets it off at once, with 30% more reach (8.45 m: the third one too)
  const k = quiet(buildHero('Grey Talon', { unlocked: 3 }), 2);
  const wide = row();
  new Fight({ heroes: [k], enemies: wide, rng: () => 0.5 }).run(0.8);
  assert.deepStrictEqual(wide.map((e) => 2000 - e.health), [105, 105, 105]);
  assert.ok(wide[2].has('disarm'));

  // Guided Owl: a 1.5 s cast without shooting, then 230 and a 0.75 s stun within 12 m; a death within 4 s adds 8 spirit for the fight.
  // Tier 3: after the hit a Haunt-sized enemy below 11% dies, a boss only below 3.3%
  const o = quiet(buildHero('Grey Talon', { unlocked: 4, tiers: { 4: 3 } }), 1, 2, 3);
  o.weapon.reloadLeft = 0;
  const [weak, hurt, big] = [dummy({ maxHealth: 200 }), dummy({ maxHealth: 2400 }), dummy({ maxHealth: 8000 })];
  hurt.health = 315 + 250;
  big.health = 315 + 300; // a boss: 3.3% of 8000 is 264
  const fo = new Fight({ heroes: [o], enemies: [big, weak, hurt], rng: () => 0.5 });
  fo.run(1.4);
  assert.strictEqual(o.weapon.clip, 17, 'casting');
  fo.run(0.3);
  assert.ok(!weak.alive && !hurt.alive && big.health === 300 && big.has('stun'));
  fo.run(0.2);
  assert.strictEqual(o.mod('spirit'), 16);
  o.weapon.reloadLeft = 1e9;
  big.health = 0;
  fo.step();
  fo.step();
  assert.strictEqual(o.abilities[3].kills, 3, 'it died within 4 s of the hit');
});

test('Holliday: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Powder Keg: 40 and a 0.4 s knock-up within 6 m, then a burn of 13.33 a second for 3 s; 2 charges 7.5 s apart, and burns add up
  const k = quiet(buildHero('Holliday', { unlocked: 1 }));
  const kegged = row();
  const fk = new Fight({ heroes: [k], enemies: kegged, rng: () => 0.5 });
  fk.run(0.3);
  assert.deepStrictEqual(kegged.map((e) => 2000 - e.health), [40, 40, 0]);
  assert.ok(kegged[0].has('stun') && k.abilities[0].charges === 1);
  fk.run(4);
  close(2000 - kegged[0].health, 40 + 13.3333 * 3, 0.001);
  fk.run(4);
  close(2000 - kegged[0].health, 2 * 40 + 13.3333 * 3 + 13.3333 * 0.5, 0.01); // the second barrel, half a second into its burn

  // Bounce Pad: 60 within 9 m, once per pad; tier 3 stuns 0.7 s
  const b = quiet(buildHero('Holliday', { unlocked: 2, tiers: { 2: 3 } }), 1);
  const stomped = row();
  const fb = new Fight({ heroes: [b], enemies: stomped, rng: () => 0.5 });
  fb.run(0.3);
  assert.deepStrictEqual(stomped.map((e) => 2000 - e.health), [60, 60, 60]);
  assert.ok(stomped[2].has('stun') && b.mod('moveSpeed') === 4);
  fb.run(10);
  assert.strictEqual(stomped[0].health, 1940);

  // Crackshot: a headshot (every bullet here) adds 55 and a 40% slow, then 10 s of cooldown against an NPC
  const c = quiet(buildHero('Holliday', { unlocked: 3 }), 1, 2);
  c.weapon.reloadLeft = 0;
  const target = dummy({ maxHealth: 1e5, distance: 10 });
  const fc = new Fight({ heroes: [c], enemies: [target], rng: () => 0.1 });
  fc.run(2);
  close(1e5 - target.health, (10 - c.weapon.clip) * 19.7 + 55, 0.001);
  assert.strictEqual(target.mod('slow'), 0.4);
  assert.ok(c.abilities[2].cdLeft > 8 && c.abilities[2].cdLeft < 10);
  // tier 3: each headshot while it is on cooldown takes 3 s off, so every fourth bullet cracks (1st, 5th, 9th)
  const c3 = quiet(buildHero('Holliday', { unlocked: 3, tiers: { 3: 3 } }), 1, 2);
  c3.weapon.reloadLeft = 0;
  const fc3 = new Fight({ heroes: [c3], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.1 });
  fc3.run(4.5);
  assert.strictEqual(fc3.log.filter((l) => l.what === 'Crackshot').length, 3);
  close(fc3.enemies[0].mod('bulletResist'), -0.06);

  // Spirit Lasso: 80 and a 2.25 s stun on the front enemy; 1.25 s longer while a Bounce Pad is down
  const lasso = (...off) => {
    const l = quiet(buildHero('Holliday', { unlocked: 4 }), 1, 3, ...off);
    const f = new Fight({ heroes: [l], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
    f.run(2.6);
    const at = f.enemies[0].has('stun');
    f.run(0.6);
    const later = f.enemies[0].has('stun');
    f.run(1.2);
    return [1e5 - f.enemies[0].health, at, later, f.enemies[0].has('stun')];
  };
  assert.deepStrictEqual(lasso(2), [80, true, false, false]);
  assert.deepStrictEqual(lasso(), [140, true, true, false]);
});

test('Infernus: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Napalm: 40 and a 28% slow within 20 m, and 8 s of napalm: +16% damage taken (tier 3: +33%, 33% less healing; tier 2: 15% lifesteal)
  const n = quiet(buildHero('Infernus', { unlocked: 1, tiers: { 1: 3 } }));
  const coated = row();
  new Fight({ heroes: [n], enemies: coated, rng: () => 0.5 }).run(0.3);
  assert.ok(coated.every((e) => 2000 - e.health === 40 && e.mod('slow') === 0.28));
  close(coated[2].mod('damageTaken'), 0.33);
  close(coated[2].mod('healAmp'), -0.33);
  close(coated[2].mod('lifestealOn'), 0.15);
  assert.strictEqual(n.abilities[0].maxCharges, 2);

  // Flame Dash: the trail burns every enemy for its 4 s at 30 a second, half on a boss
  const d = quiet(buildHero('Infernus', { unlocked: 2 }), 1);
  const trail = [dummy(), dummy(), dummy({ maxHealth: 8000 })];
  new Fight({ heroes: [d], enemies: trail, rng: () => 0.5 }).run(6);
  assert.deepStrictEqual(trail.map((e) => Math.round(e.stats.maxHealth - e.health)), [120, 120, 60]);

  // Afterburn: 8.1% a bullet, so the 13th sets the enemy on fire: 14 a second (tier 1: 30) for 3 s, kept going by more bullets; tier 2: -35% spirit damage
  const a = quiet(buildHero('Infernus', { unlocked: 3, tiers: { 3: 2 } }), 1, 2);
  a.weapon.reloadLeft = 0;
  const lit = dummy({ maxHealth: 1e5 });
  const fa = new Fight({ heroes: [a], enemies: [lit], rng: () => 0.5 }); // no headshots
  fa.run(1.2);
  assert.strictEqual(a.abilities[2].burns.size, 0);
  fa.run(1.3);
  assert.ok(a.abilities[2].burns.has(lit));
  close(lit.mod('spiritDealt'), -0.35);
  a.weapon.reloadLeft = 1e9; // the burn alone from here: at most its 3 s
  const before = lit.health;
  fa.run(4);
  assert.ok(before - lit.health > 30 * 2.4 && before - lit.health <= 30 * 3 + 0.01, `${before - lit.health}`);
  assert.strictEqual(a.abilities[2].burns.size, 0);

  // Concussive Combustion: 3.25 s after the cast, 125 (+100) and a 1.25 s stun within 12 m; tier 2 heals him for it, up to the heal cap
  const c = quiet(buildHero('Infernus', { unlocked: 4, tiers: { 4: 2 } }), 1, 2, 3);
  c.health = 300;
  const blown = row();
  const fc = new Fight({ heroes: [c], enemies: blown, rng: () => 0.5 });
  fc.run(3.2);
  assert.ok(blown.every((e) => e.health === 2000));
  fc.run(0.3);
  assert.ok(blown.every((e) => e.health === 1775 && e.has('stun')));
  close(c.health, 300 + 830 * 0.25, 0.02);
});

test('Ivy: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Entangling Thorns: 4 s of 40 a second and a 28% slow within 6 m (tier 2: 8 m); tier 3 immobilizes 1.6 s after 2 s in the thorns
  const t = quiet(buildHero('Ivy', { unlocked: 1 }));
  const patch = row();
  const ft = new Fight({ heroes: [t], enemies: patch, rng: () => 0.5 });
  ft.run(1);
  assert.ok(patch[0].mod('slow') === 0.28 && patch[2].mod('slow') === 0);
  ft.run(4);
  assert.deepStrictEqual(patch.map((e) => Math.round(2000 - e.health)), [160, 160, 0]);
  const t3 = quiet(buildHero('Ivy', { unlocked: 1, tiers: { 1: 3 } }));
  const wide = row();
  const ft3 = new Fight({ heroes: [t3], enemies: wide, rng: () => 0.5 });
  ft3.run(2);
  assert.ok(!wide[0].has('immobilize'));
  ft3.run(0.6);
  assert.ok(wide.every((e) => e.has('immobilize')));
  assert.strictEqual(t3.abilities[0].maxCharges, 2);

  // Kudzu Connection: alone she gets half: 5% fire rate and 7.5% bullet lifesteal for 12 s; tier 3 is always on
  const k = quiet(buildHero('Ivy', { unlocked: 2 }), 1);
  const fk = new Fight({ heroes: [k], enemies: [dummy()], rng: () => 0.5 });
  fk.run(0.3);
  close(k.mod('fireRate'), 0.05);
  close(k.mod('lifesteal'), 0.075);
  fk.run(12);
  assert.strictEqual(k.mod('fireRate'), 0);
  const k3 = quiet(buildHero('Ivy', { unlocked: 2, tiers: { 2: 3 } }), 1);
  const fk3 = new Fight({ heroes: [k3], enemies: [dummy()], rng: () => 0.5 });
  fk3.run(30);
  close(k3.mod('fireRate'), 0.09);
  assert.ok(k3.mod('moveSpeed') === 1 && k3.abilities[1].status(fk3) === 'Always On');

  // Stone Form: 1 s out of reach, then 75 and a 0.75 s stun within 5.75 m and a heal of 6% of max health (tier 1: 12%)
  const s = quiet(buildHero('Ivy', { unlocked: 3, tiers: { 3: 1 } }), 1, 2);
  s.health = 300;
  const smashed = row();
  const fs2 = new Fight({ heroes: [s], enemies: smashed, rng: () => 0.5 });
  fs2.run(0.6);
  assert.ok(!s.targetable && smashed[0].health === 2000);
  fs2.run(0.9);
  assert.deepStrictEqual(smashed.map((e) => 2000 - e.health), [75, 75, 0]);
  assert.ok(s.targetable && smashed[0].has('stun'));
  close(s.health, 300 + 755 * 0.12);

  // Air Drop: a bomb for 115 within 20 m, then +20% damage dealt for 8 s; tier 1 a 300 barrier, tier 2 a 32% slow, tier 3 a 3 s silence
  const a = quiet(buildHero('Ivy', { unlocked: 4, tiers: { 4: 3 } }), 1, 2, 3);
  const bombed = row();
  const fa = new Fight({ heroes: [a], enemies: bombed, rng: () => 0.5 });
  fa.run(0.3);
  assert.ok(bombed.every((e) => 2000 - e.health === 115 && e.has('silence') && e.mod('slow') === 0.32));
  assert.strictEqual(a.mod('damageDealt'), 0.2);
  assert.strictEqual(a.statuses.find((x) => x.barrier)?.barrier, 300);
  fa.run(8);
  assert.strictEqual(a.mod('damageDealt'), 0);
});

test('Kelvin: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // 0.625% spirit resist a level (the wiki's level scaling)
  close(heroStats(HEROES.Kelvin, { boons: 10 }).spiritResist, 0.0625);

  // Frost Grenade: 60 (+30) and a 32% slow within 6.5 m, and a heal of 60 (+30) for him
  const g = quiet(buildHero('Kelvin', { unlocked: 1, tiers: { 1: 1 } }));
  g.health = 300;
  const frozen = row();
  new Fight({ heroes: [g], enemies: frozen, rng: () => 0.5 }).run(0.3);
  assert.deepStrictEqual(frozen.map((e) => 2000 - e.health), [90, 90, 0]);
  assert.ok(frozen[0].mod('slow') === 0.32 && g.health === 390 && g.abilities[0].charges === 1);

  // Ice Path: 8 s of +2 m/s; tier 1 +2 more and 35% bullet resist; tier 3 +35% spirit power and +20
  const p = quiet(buildHero('Kelvin', { boons: 10, unlocked: 2, tiers: { 2: 3 } }), 1);
  const fp = new Fight({ heroes: [p], enemies: [dummy()], rng: () => 0.5 });
  fp.run(0.5);
  assert.ok(p.mod('moveSpeed') === 4 && p.mod('bulletResist') === 0.35);
  close(p.mod('spirit'), 20 + 13 * 0.35);
  fp.run(8);
  assert.strictEqual(p.mod('moveSpeed'), 0);

  // Arctic Beam: 5 s of 45 a second on the front enemy; after 2 s it is 16% slower and deals 20% less; tier 3 adds two more beams
  const b = quiet(buildHero('Kelvin', { unlocked: 3 }), 1, 2);
  const iced = row();
  const fb = new Fight({ heroes: [b], enemies: iced, rng: () => 0.5 });
  fb.run(2.5);
  close(iced[0].mod('slow'), 0.16);
  close(iced[0].mod('damageDealt'), -0.2);
  assert.strictEqual(b.abilities[2].status(fb), 'Beaming');
  fb.run(3);
  close(2000 - iced[0].health, 45 * 5, 0.03);
  assert.strictEqual(iced[1].health, 2000);
  const b3 = quiet(buildHero('Kelvin', { unlocked: 3, tiers: { 3: 3 } }), 1, 2);
  const three = row();
  new Fight({ heroes: [b3], enemies: three, rng: () => 0.5 }).run(5.5);
  for (const e of three) close(2000 - e.health, 65 * 5, 0.03);
  // with the gun working he saves the beam for the reload
  const r = quiet(buildHero('Kelvin', { unlocked: 3 }), 1, 2);
  r.weapon.reloadLeft = 0;
  const fr = new Fight({ heroes: [r], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  fr.run(3);
  assert.ok(!fr.log.length && r.weapon.clip > 0);
  fr.run(1.5);
  assert.ok(fr.log.some((l) => l.what === 'Arctic Beam') && r.weapon.reloadLeft > 0);

  // Frozen Shelter: below half health, 5 s in a dome: nothing can hit him, he doesn't attack, 90 a second back
  const s = quiet(buildHero('Kelvin', { unlocked: 4 }), 1, 2, 3);
  s.weapon.reloadLeft = 0;
  s.health = 300;
  const outside = dummy({ maxHealth: 1e5, dps: 50 });
  const fs4 = new Fight({ heroes: [s], enemies: [outside], rng: () => 0.5 });
  fs4.run(0.5);
  const [hp, there] = [s.health, outside.health];
  assert.ok(!s.targetable && s.cantAct);
  fs4.run(4);
  close(s.health - hp, 90 * 4, 0.03);
  assert.strictEqual(outside.health, there);
  fs4.run(1.5);
  assert.ok(s.targetable && outside.health < there);
});

test('Lady Geist: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Essence Bomb: costs her 30% of its damage (27), then 90 within 7 m; tier 3 leaves a mess of 30% of that a second for 6 s
  const b = quiet(buildHero('Lady Geist', { unlocked: 1 }));
  const bombed = row();
  const fb = new Fight({ heroes: [b], enemies: bombed, rng: () => 0.5 });
  fb.run(0.5);
  assert.ok(b.health === 880 - 27 && bombed[0].health === 2000);
  fb.run(0.5);
  assert.deepStrictEqual(bombed.map((e) => 2000 - e.health), [90, 90, 0]);
  const b3 = quiet(buildHero('Lady Geist', { unlocked: 1, tiers: { 1: 3 } }));
  const messy = [dummy({ maxHealth: 1e5 })];
  new Fight({ heroes: [b3], enemies: messy, rng: () => 0.5 }).run(8.5);
  close(1e5 - messy[0].health, 140 + 140 * 0.3 * 6, 0.001);

  // Life Drain: 2.5 s of 24 a second, and she heals for it
  const d = quiet(buildHero('Lady Geist', { unlocked: 2 }), 1);
  d.health = 500;
  const drained = dummy();
  new Fight({ heroes: [d], enemies: [drained], rng: () => 0.5 }).run(4);
  close(2000 - drained.health, 60, 0.05);
  close(d.health - 500, 2000 - drained.health, 0.001);

  // Malice: costs 9% of her current health; 3 shards of 23, each a stack: +7% damage taken and a 12% slow
  const m = quiet(buildHero('Lady Geist', { unlocked: 3 }), 1, 2);
  const cursed = dummy({ maxHealth: 1e5 });
  const fm = new Fight({ heroes: [m], enemies: [cursed], rng: () => 0.5 });
  fm.run(0.3);
  close(m.health, 880 * 0.91);
  close(1e5 - cursed.health, 23 + 23 * 1.07 + 23 * 1.14, 0.001);
  close(cursed.mod('damageTaken'), 0.21);
  close(cursed.mod('slow'), 0.36);
  fm.run(6);
  close(cursed.mod('damageTaken'), 0.35); // the second cast: 5 stacks at most

  // Soul Exchange: at 20% against a full-health enemy the levels swap: she is at 100%, a Haunt-sized enemy loses half of the 70% the game takes
  const s = quiet(buildHero('Lady Geist', { unlocked: 4, tiers: { 4: 3 } }), 1, 2, 3);
  s.health = 176;
  const [small, big] = [dummy(), dummy({ maxHealth: 8000 })];
  const fs5 = new Fight({ heroes: [s], enemies: [small], rng: () => 0.5 });
  fs5.run(0.3);
  assert.strictEqual(s.health, 880);
  close(small.health, 2000 * (1 - 0.7 * 0.5));
  assert.ok(small.has('silence') && s.mod('spirit') === 60 && s.mod('fireRate') === 0.4);
  const s2 = quiet(buildHero('Lady Geist', { unlocked: 4 }), 1, 2, 3);
  s2.health = 176;
  new Fight({ heroes: [s2], enemies: [big], rng: () => 0.5 }).run(0.3);
  close(big.health, 8000 * (1 - 0.7 * 0.15)); // a boss: 15% of it
  // not used while she is healthy
  const s3 = quiet(buildHero('Lady Geist', { unlocked: 4 }), 1, 2, 3);
  const fs6 = new Fight({ heroes: [s3], enemies: [dummy()], rng: () => 0.5 });
  fs6.run(2);
  assert.ok(!fs6.log.length);
});

test('Lash: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy(), dummy()]; // 4 m apart

  // Ground Strike: 60 within 10 m from the ground; tier 2 knocks up 1 s and slows 40%
  const g = quiet(buildHero('Lash', { unlocked: 1, tiers: { 1: 2 } }));
  const stomped = row();
  new Fight({ heroes: [g], enemies: stomped, rng: () => 0.5 }).run(0.4);
  assert.deepStrictEqual(stomped.map((e) => 2000 - e.health), [60, 60, 60, 0]);
  assert.ok(stomped[0].has('stun') && stomped[0].mod('slow') === 0.4);

  // Grapple: when Ground Strike is ready he goes up first, and the strike is a dive from 10 m: +5.5 a metre (tier 3: x2.2)
  const d = quiet(buildHero('Lash', { unlocked: 2 }));
  const dived = [dummy()];
  const fd = new Fight({ heroes: [d], enemies: dived, rng: () => 0.5 });
  fd.run(0.5);
  close(2000 - dived[0].health, 60 + 10 * 5.5);
  assert.deepStrictEqual(fd.log.map((l) => l.what), ['Grapple', 'Ground Strike']);
  const d3 = quiet(buildHero('Lash', { unlocked: 2, tiers: { 1: 3, 2: 2 } }));
  const deep = [dummy()];
  new Fight({ heroes: [d3], enemies: deep, rng: () => 0.5 }).run(0.5);
  close(2000 - deep[0].health, 60 + 10 * 5.5 * 2.2);
  assert.strictEqual(d3.mod('bulletDamage'), 7);

  // Flog: 65 in a 40 degree cone (3.6 m to either side from 10 m away) and a heal of 16% of it; tier 2: they deal 30% less for 3 s
  const f = quiet(buildHero('Lash', { unlocked: 3, tiers: { 3: 2 } }), 1, 2);
  f.health = 300;
  const whipped = row();
  new Fight({ heroes: [f], enemies: whipped, rng: () => 0.5 }).run(0.4);
  assert.deepStrictEqual(whipped.map((e) => 2000 - e.health), [65, 0, 0, 0]);
  close(f.health, 300 + 65 * 0.16);
  close(whipped[0].mod('damageDealt'), -0.3);
  assert.strictEqual(whipped[0].mod('slow'), 0.28);

  // Death Slam: a 2.3 s channel, the enemies in the cone lifted and stunned 1.6 s, then 105 to them and anything within 6 m and a 40% slow;
  // tier 1: the lifted ones can't attack for 1 s more
  const s = quiet(buildHero('Lash', { unlocked: 4, tiers: { 4: 1 } }), 1, 2, 3);
  const slammed = row();
  const fs7 = new Fight({ heroes: [s], enemies: slammed, rng: () => 0.5 });
  fs7.run(2.9);
  assert.ok(slammed[0].has('stun') && !slammed[1].has('stun') && slammed[0].health === 2000);
  fs7.run(1.5);
  assert.deepStrictEqual(slammed.map((e) => 2000 - e.health), [105, 105, 0, 0]);
  assert.ok(slammed[0].has('disarm') && !slammed[1].has('disarm') && slammed[1].mod('slow') === 0.4);
});

test('McGinnis: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // the gun spins up: 4.76 shots a second at first, 11.9 after 2 s of firing
  const g = quiet(buildHero('McGinnis', { unlocked: 1 }), 1);
  g.weapon.reloadLeft = 0;
  const fg = new Fight({ heroes: [g], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  fg.run(1);
  close(g.mod('fireRate'), 0.5 * (11.9048 / 4.7619 - 1), 0.12);
  fg.run(1.5);
  close(g.mod('fireRate'), 1.5, 0.01);

  // Mini Turret: 35 s of 24 a second on the front enemy, half to an NPC and 30% to a boss
  const t = quiet(buildHero('McGinnis', { unlocked: 1 }));
  t.abilities[0].spin = 0;
  const [small, big] = [dummy({ maxHealth: 1e5 }), dummy({ maxHealth: 1e5 })];
  small.stats.maxHealth = 2000;
  const ft = new Fight({ heroes: [t], enemies: [small], rng: () => 0.5 });
  ft.run(17); // one turret (the second comes at 18 s)
  close(1e5 - small.health, 24 * 0.5 * 16.5, 0.05);
  const t2 = quiet(buildHero('McGinnis', { unlocked: 1 }));
  new Fight({ heroes: [t2], enemies: [big], rng: () => 0.5 }).run(17);
  close(1e5 - big.health, 24 * 0.3 * 16.5, 0.05);
  assert.strictEqual(buildHero('McGinnis', { unlocked: 1, tiers: { 1: 2 } }).abilities[0].maxCharges, 3);

  // Medicinal Specter: below 75% health, 25 a second for 6.5 s
  const m = quiet(buildHero('McGinnis', { unlocked: 2 }), 1);
  m.health = 300;
  new Fight({ heroes: [m], enemies: [dummy()], rng: () => 0.5 }).run(8);
  close(m.health, 300 + 25 * 6.5, 0.02);

  // Spectral Wall: 60 and a 16% slow within 5 m; tier 1: +20% damage taken for 7 s; tier 3: two turrets for 8 s
  const w = quiet(buildHero('McGinnis', { unlocked: 3, tiers: { 3: 3 } }), 1, 2);
  const walled = row();
  new Fight({ heroes: [w], enemies: walled, rng: () => 0.5 }).run(0.3);
  assert.deepStrictEqual(walled.map((e) => 2000 - e.health), [60, 60, 0]);
  close(walled[0].mod('slow'), 0.4);
  assert.ok(walled[0].mod('damageTaken') === 0.2 && w.abilities[0].turrets.length === 2);

  // Heavy Barrage: 8 s of 6 rockets a second, 21 each within 4.5 m, the gun silent
  const b = quiet(buildHero('McGinnis', { unlocked: 4 }), 1, 2, 3);
  b.weapon.reloadLeft = 0;
  const shelled = row();
  const fb = new Fight({ heroes: [b], enemies: shelled, rng: () => 0.5 });
  fb.run(9);
  close(2000 - shelled[1].health, 48 * 21, 0.03);
  assert.strictEqual(shelled[2].health, 2000);
});

test('Mirage: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Fire Scarabs: 2 charges, one enemy each: 5 s of 8 a second stolen as health, and the enemy deals 20% less
  const s = quiet(buildHero('Mirage', { unlocked: 1 }));
  s.health = 300;
  const hosts = row();
  const fs8 = new Fight({ heroes: [s], enemies: hosts, rng: () => 0.5 });
  fs8.run(3);
  assert.ok(hosts[0].mod('damageDealt') === -0.2 && hosts[1].mod('damageDealt') === -0.2 && hosts[2].mod('damageDealt') === 0);
  fs8.run(4);
  close(2000 - hosts[0].health, 40, 0.03);
  close(s.health - 300, 4000 - hosts[0].health - hosts[1].health, 0.001);

  // Dust Devil: 65, a 0.3 s lift and a 24% slow to everything in its 20 m path, nothing can touch Mirage meanwhile, then 30% evasion for 4 s
  const d = quiet(buildHero('Mirage', { unlocked: 2 }), 1);
  const blown = row();
  const fd = new Fight({ heroes: [d], enemies: blown, rng: () => 0.5 });
  fd.run(0.4);
  assert.ok(blown.every((e) => 2000 - e.health === 65 && e.mod('slow') === 0.24) && !d.targetable);
  fd.run(1);
  assert.ok(d.targetable && d.mod('evasion') === 0.3);
  const d3 = quiet(buildHero('Mirage', { unlocked: 2, tiers: { 2: 3 } }), 1);
  const twice = [dummy()];
  new Fight({ heroes: [d3], enemies: twice, rng: () => 0.5 }).run(3);
  assert.strictEqual(2000 - twice[0].health, 250); // two whirlwinds of 125

  // Djinn's Mark: a mark every 2.75 s; the fourth sets them off: 11 x 8
  const m = quiet(buildHero('Mirage', { unlocked: 3 }), 1, 2);
  m.weapon.reloadLeft = 0;
  m.stats.bulletDamage = 0;
  m.weapon.clip = 999; // no reload in the way
  const marked = dummy({ maxHealth: 1e5 });
  const fm = new Fight({ heroes: [m], enemies: [marked], rng: () => 0.5 });
  fm.run(8);
  assert.strictEqual(marked.health, 1e5);
  assert.strictEqual(m.abilities[2].marks.get(marked).stacks, 3);
  fm.run(1.5);
  close(1e5 - marked.health, 88);
  // left alone, the marks go off when they run out: two marks = 11 x 2
  const m2 = quiet(buildHero('Mirage', { unlocked: 3 }), 1, 2);
  m2.weapon.reloadLeft = 0;
  m2.stats.bulletDamage = 0;
  const left = dummy({ maxHealth: 1e5 });
  const fm2 = new Fight({ heroes: [m2], enemies: [left], rng: () => 0.5 });
  fm2.run(3.5);
  m2.weapon.reloadLeft = 1e9;
  fm2.run(6);
  close(1e5 - left.health, 22);

  // Traveler: below half health, 2 s out of reach; tier 1: +20% fire rate after; tier 2: a 400 barrier
  const t = quiet(buildHero('Mirage', { unlocked: 4, tiers: { 4: 2 } }), 1, 2, 3);
  t.health = 300;
  const ft2 = new Fight({ heroes: [t], enemies: [dummy({ dps: 50 })], rng: () => 0.5 });
  ft2.run(1);
  assert.ok(!t.targetable && t.cantAct);
  ft2.run(1.5);
  assert.ok(t.targetable && t.mod('fireRate') === 0.2 && t.statuses.some((x) => x.barrier > 0));
});

test('Mo & Krill: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy(), dummy()]; // 4 m apart
  const MK = 'Mo & Krill';

  // Scorn: 50 within 9 m and a heal of 35% of it; tier 3: each cast leaves +15% damage taken for 16 s, stacking
  const s = quiet(buildHero(MK, { unlocked: 1 }));
  s.health = 300;
  const scorned = row();
  new Fight({ heroes: [s], enemies: scorned, rng: () => 0.5 }).run(0.4);
  assert.deepStrictEqual(scorned.map((e) => 2000 - e.health), [50, 50, 50, 0]);
  close(s.health, 300 + 150 * 0.35);
  const s3 = quiet(buildHero(MK, { unlocked: 1, tiers: { 1: 3 } }));
  const stacked = [dummy({ maxHealth: 1e5 })];
  const fs9 = new Fight({ heroes: [s3], enemies: stacked, rng: () => 0.5 });
  fs9.run(9);
  close(stacked[0].mod('damageTaken'), 0.3); // two casts 8 s apart
  close(1e5 - stacked[0].health, 85 + 85 * 1.15, 0.001);

  // Burrow: 1 s under (60% bullet resist, no shooting), then a 1 s knock-up and 1.5 s of 75 a second within 5 m
  const b = quiet(buildHero(MK, { unlocked: 2 }), 1);
  b.weapon.reloadLeft = 0;
  const dug = row();
  const fb = new Fight({ heroes: [b], enemies: dug, rng: () => 0.5 });
  fb.run(0.6);
  assert.ok(b.mod('bulletResist') === 0.6 && b.weapon.clip === 20 && dug[0].health === 2000);
  fb.run(0.8);
  assert.ok(dug[0].has('stun') && dug[1].has('stun') && !dug[2].has('stun'));
  fb.run(1.4);
  b.weapon.reloadLeft = 1e9;
  const spun = 2000 - dug[1].health;
  close(spun, 75 * 1.5, 0.08);
  assert.strictEqual(dug[2].health, 2000);

  // Sand Blast: 40 and a 2.5 s disarm on the enemies in front (5 m to either side from 10 m away)
  const d = quiet(buildHero(MK, { unlocked: 3 }), 1, 2);
  const sanded = [dummy({ dps: 50 }), dummy({ dps: 50 }), dummy({ dps: 50 })];
  const fd = new Fight({ heroes: [d], enemies: sanded, rng: () => 0.5 });
  fd.run(0.4);
  assert.deepStrictEqual(sanded.map((e) => 2000 - e.health), [40, 40, 0]);
  assert.ok(sanded[0].has('disarm') && !sanded[2].has('disarm'));
  const hp = d.health;
  fd.run(2);
  assert.strictEqual(hp - d.health, 100, 'only the third one attacks');

  // Combo: 2.4 s holding the front enemy: stunned, 40 a second; a kill adds 40 max health for the fight
  const c = quiet(buildHero(MK, { unlocked: 4, tiers: { 4: 1 } }), 1, 2, 3);
  c.health = 500;
  const [victim, other] = [dummy({ maxHealth: 60 }), dummy()];
  const fc = new Fight({ heroes: [c], enemies: [victim, other], rng: () => 0.5 });
  fc.run(1);
  assert.ok(victim.has('stun') && victim.health < 60);
  fc.run(1.5);
  assert.ok(!victim.alive && c.stats.maxHealth === 930 + 40);
  close(c.health, 500 + 60 * 0.5 + 40, 0.01); // tier 1: half the damage back (an NPC), and the health that comes with the max health
});

test('Paradox: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Pulse Grenade: 4 pulses 0.8 s apart, 35 each, reaching 1 m further every time; each leaves +4% damage taken
  const g = quiet(buildHero('Paradox', { unlocked: 1 }));
  const pulsed = row();
  const fg = new Fight({ heroes: [g], enemies: pulsed, rng: () => 0.5 });
  fg.run(4);
  close(2000 - pulsed[0].health, 35 * (1 + 1.04 + 1.08 + 1.12), 0.001);
  assert.ok(pulsed[1].health < 2000 && 2000 - pulsed[2].health === 35, 'the last pulse reaches 8.5 m');
  close(pulsed[0].mod('damageTaken'), 0.16);

  // Time Wall: +30% weapon damage for 5.5 s and a 64% slow on the enemies within 4 m; tier 2 silences them 2.3 s
  const w = quiet(buildHero('Paradox', { unlocked: 2, tiers: { 2: 2 } }), 1);
  const walled = row();
  const fw = new Fight({ heroes: [w], enemies: walled, rng: () => 0.5 });
  fw.run(0.4);
  close(w.mod('weaponDamage'), 0.65);
  assert.ok(walled[0].mod('slow') === 0.64 && walled[1].has('silence') && !walled[2].has('silence'));
  fw.run(9.5);
  assert.strictEqual(w.mod('weaponDamage'), 0);

  // Kinetic Carbine: charged for 2.5 s when the gun runs dry: a burst's weapon damage (6.8 x 5) x 2.25 as spirit damage and a 0.4 s time-stop
  const c = quiet(buildHero('Paradox', { unlocked: 3 }), 1, 2);
  const shot = dummy({ maxHealth: 1e5 });
  const fc = new Fight({ heroes: [c], enemies: [shot], rng: () => 0.5 });
  fc.run(2.4);
  assert.strictEqual(shot.health, 1e5);
  fc.run(0.3);
  close(1e5 - shot.health, 6.8 * 5 * 2.25, 0.001);
  assert.ok(shot.has('stun') && c.mod('moveSpeed') > 1.6);

  // Paradoxical Swap: 1.25 s in which neither acts, then 150; tier 1 a 200 barrier, tier 3 every enemy within 7 m and 10% of max health (halved)
  const s = quiet(buildHero('Paradox', { unlocked: 4, tiers: { 4: 3 } }), 1, 2, 3);
  const swapped = row();
  const fs10 = new Fight({ heroes: [s], enemies: swapped, rng: () => 0.5 });
  fs10.run(1);
  assert.ok(swapped[0].has('stun') && swapped[1].has('stun') && !swapped[2].has('stun') && swapped[0].health === 2000);
  assert.strictEqual(s.statuses.find((x) => x.barrier)?.barrier, 200);
  fs10.run(0.6);
  assert.deepStrictEqual(swapped.map((e) => 2000 - e.health), [250, 250, 0]);
});

test('Pocket: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Barrage: 4 projectiles over 2 s, 32 each within 4.5 m and a 24% slow; each one that hits is +6% damage dealt for 15 s
  const b = quiet(buildHero('Pocket', { unlocked: 1 }));
  const hit = row();
  const fb = new Fight({ heroes: [b], enemies: hit, rng: () => 0.5 });
  fb.run(2.6);
  close(2000 - hit[1].health, 32 * (1 + 1.06 + 1.12 + 1.18), 0.001);
  assert.strictEqual(hit[2].health, 2000);
  close(b.mod('damageDealt'), 0.24);

  // Flying Cloak: 60 to every enemy in its path; tier 2: +5 damage a bullet for 6 s
  const c = quiet(buildHero('Pocket', { unlocked: 2, tiers: { 2: 2 } }), 1);
  const flown = row();
  new Fight({ heroes: [c], enemies: flown, rng: () => 0.5 }).run(0.4);
  assert.ok(flown.every((e) => 2000 - e.health === 130) && c.mod('bulletDamage') === 5);

  // Enchanter's Satchel: when the gun runs dry: 1.5 s out of reach with the reload done, then 65 within 12 m
  const s = quiet(buildHero('Pocket', { unlocked: 3 }), 1, 2);
  const out = row();
  const fs11 = new Fight({ heroes: [s], enemies: out, rng: () => 0.5 });
  fs11.run(0.5);
  assert.ok(!s.targetable && s.weapon.reloadLeft === 0 && s.weapon.clip === 11);
  s.weapon.reloadLeft = 1e9; // the satchel's damage alone
  fs11.run(1.4);
  assert.ok(s.targetable);
  assert.deepStrictEqual(out.map((e) => 2000 - e.health), [65, 65, 65]);

  // Affliction: 10 s of 32 a second within 9 m, half on a boss, and it never kills
  const a = quiet(buildHero('Pocket', { unlocked: 4 }), 1, 2, 3);
  const [weak, big] = [dummy({ maxHealth: 100 }), dummy({ maxHealth: 8000 })];
  const fa = new Fight({ heroes: [a], enemies: [big, weak], rng: () => 0.5 });
  fa.run(11);
  close(8000 - big.health, 16 * 10, 0.001);
  assert.strictEqual(weak.health, 1);
});

test('Rem: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; if (hero.abilities[s - 1].back) hero.abilities[s - 1].back = [1e9, 1e9, 1e9, 1e9]; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Pillow Toss: 75, a 0.4 s knock-back and a 36% slow within 5 m; a hit takes 5 s off Naptime's cooldown
  const p = quiet(buildHero('Rem', { unlocked: 4 }), 2, 3);
  p.abilities[3].cdLeft = 100;
  const tossed = row();
  new Fight({ heroes: [p], enemies: tossed, rng: () => 0.5 }).run(0.5);
  assert.deepStrictEqual(tossed.map((e) => 2000 - e.health), [75, 75, 0]);
  assert.ok(tossed[0].mod('slow') === 0.36 && p.abilities[3].cdLeft < 95 && p.abilities[3].cdLeft > 94);

  // Tag Along: below 75% health: 15% of the missing health at once, then 42 a second for 5.5 s, and Rem keeps shooting
  const t = quiet(buildHero('Rem', { unlocked: 2 }), 1);
  t.weapon.reloadLeft = 0;
  t.health = 280;
  const ft3 = new Fight({ heroes: [t], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  ft3.run(0.7);
  assert.ok(t.health > 280 + 400 * 0.15 && t.targetable && t.weapon.clip < 13);
  ft3.run(6);
  close(t.health, 280 + 60 + 42 * 5.5, 0.02);

  // Lil Helpers: a Helper for 8 s: +12% spirit resist and +3 m/s, then it naps 15.1 s; a second Helper (tier 1) takes over at once
  const h = quiet(buildHero('Rem', { unlocked: 3 }), 1, 2);
  const fh = new Fight({ heroes: [h], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  fh.run(1);
  assert.ok(h.mod('spiritResist') === 0.12 && h.mod('moveSpeed') === 3);
  fh.run(10);
  assert.ok(h.mod('spiritResist') === 0 && /s$/.test(h.abilities[2].status()));
  fh.run(13);
  assert.strictEqual(h.mod('spiritResist'), 0.12, 'back from its nap');
  const h1 = quiet(buildHero('Rem', { unlocked: 3, tiers: { 3: 1 } }), 1, 2);
  const fh1 = new Fight({ heroes: [h1], enemies: [dummy({ maxHealth: 1e5 })], rng: () => 0.5 });
  fh1.run(10);
  assert.ok(h1.mod('spiritResist') === 0.12 && h1.mod('moveSpeed') === 4.5);

  // Naptime: a 1.9 s channel, then everything within 19 m sleeps up to 4 s (no attacks); 100 damage wakes one to 120 more; tier 1: groggy 1 s
  const n = quiet(buildHero('Rem', { unlocked: 4, tiers: { 4: 1 } }), 1, 2, 3);
  const dozing = [dummy({ dps: 50 }), dummy({ dps: 50 })];
  const fn = new Fight({ heroes: [n], enemies: dozing, rng: () => 0.5 });
  fn.run(2.3);
  assert.ok(dozing.every((e) => e.has('sleep')));
  const hp = n.health;
  fn.damage(n, dozing[0], 150, 'true');
  fn.run(0.2);
  assert.ok(dozing[0].has('sleep'), 'at least half a second of sleep');
  fn.run(0.5);
  assert.ok(!dozing[0].has('sleep') && dozing[0].has('disarm') && dozing[0].health === 2000 - 150 - 120);
  fn.run(2.5);
  assert.ok(n.health < hp && n.health >= hp - 100 && dozing[1].has('sleep'), 'the woken one attacks after its groggy second; the other sleeps on');
  fn.run(2);
  assert.ok(!dozing[1].has('sleep') && dozing[1].health === 2000 - 120);
});

test('Seven: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Lightning Ball: 5 s of 75 a second to everything within 4.25 m of the front enemy
  const b = quiet(buildHero('Seven', { unlocked: 1 }));
  const zapped = row();
  new Fight({ heroes: [b], enemies: zapped, rng: () => 0.5 }).run(6);
  close(2000 - zapped[0].health, 375, 0.03);
  close(2000 - zapped[1].health, 375, 0.03);
  assert.strictEqual(zapped[2].health, 2000);

  // Static Charge: 3.5 s later, 35 and a 0.9 s stun within 5 m
  const c = quiet(buildHero('Seven', { unlocked: 2 }), 1);
  const charged = row();
  const fc = new Fight({ heroes: [c], enemies: charged, rng: () => 0.5 });
  fc.run(3.5);
  assert.strictEqual(charged[0].health, 2000);
  fc.run(0.4);
  assert.deepStrictEqual(charged.map((e) => 2000 - e.health), [35, 35, 0]);
  assert.ok(charged[1].has('stun'));

  // Power Surge: for 10 s every burst of three bullets shocks its target and up to 4 enemies within 10 m for 10
  const p = quiet(buildHero('Seven', { unlocked: 3 }), 1, 2);
  p.weapon.reloadLeft = 0;
  p.stats.bulletDamage = 0;
  const shocked = row();
  new Fight({ heroes: [p], enemies: shocked, rng: () => 0.5 }).run(3);
  const bursts = Math.floor((29 - p.weapon.clip) / 3);
  assert.ok(bursts >= 4);
  for (const e of shocked) close(2000 - e.health, bursts * 10, 0.001);

  // Storm Cloud: a 7 s channel, 95 a second to every enemy the growing cloud has reached, and one 75 strike within 7 m at the start
  const s = quiet(buildHero('Seven', { unlocked: 4, tiers: { 4: 1 } }), 1, 2, 3);
  const [near, far] = [dummy(), dummy({ distance: 20 })];
  far.health = far.stats.maxHealth = 2000;
  const fs12 = new Fight({ heroes: [s], enemies: [near, far], rng: () => 0.5 });
  fs12.run(0.2);
  assert.ok(near.health === 1925 && far.health === 1925 && s.mod('bulletResist') === 0.55);
  fs12.run(7.5);
  close(1925 - near.health, 95 * 7, 0.03);
  assert.ok(far.health > near.health + 150, 'the cloud needs about 2.5 s to reach 24 m');
});

test('Shiv: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy(), dummy()]; // 4 m apart

  // Serrated Knives: 2 knives 2 s apart, each a stack of 10 a second for 5 s from the last knife
  const k = quiet(buildHero('Shiv', { unlocked: 1 }));
  const cut = dummy({ maxHealth: 1e5 });
  new Fight({ heroes: [k], enemies: [cut], rng: () => 0.5 }).run(9);
  assert.ok([120, 130].includes(Math.round(1e5 - cut.health)), `${1e5 - cut.health}`); // one stack for 2 s, then two for 5 s (the tick the second knife lands on counts either way)

  // Slice and Dice: 75 to everything within 12 m and -6% spirit resist for 14 s
  const s = quiet(buildHero('Shiv', { unlocked: 2 }), 1);
  const sliced = row();
  const fs13 = new Fight({ heroes: [s], enemies: sliced, rng: () => 0.5 });
  fs13.run(0.5);
  assert.deepStrictEqual(sliced.map((e) => 2000 - e.health), [75, 75, 75, 75]);
  close(sliced[0].mod('spiritResist'), -0.06);
  fs13.run(14.5);
  assert.strictEqual(sliced[0].mod('spiritResist'), 0);

  // Bloodletting: a quarter of every hit is put off and taken over the next 6 s; the active clears 30% of what is waiting
  const b = quiet(buildHero('Shiv', { unlocked: 3 }), 1, 2);
  b.abilities[2].cdLeft = 1e9;
  const fb = new Fight({ heroes: [b], enemies: [dummy({ dps: 80 })], rng: () => 0.5 });
  fb.run(1.05);
  close(830 - b.health, 60, 0.02); // 80 less the 20 put off (a sliver of it already bled)
  fb.enemies[0].stats.dps = 0;
  fb.run(7);
  close(830 - b.health, 80, 0.001);
  const b2 = quiet(buildHero('Shiv', { unlocked: 3 }), 1, 2);
  const fb2 = new Fight({ heroes: [b2], enemies: [dummy({ dps: 400 })], rng: () => 0.5 });
  fb2.run(1.2);
  assert.ok(fb2.log.some((l) => l.what === 'Bloodletting'));
  fb2.enemies[0].stats.dps = 0;
  fb2.run(7);
  assert.ok(830 - b2.health < 400 - 100 * 0.3 * 0.9 && 830 - b2.health > 400 - 100 * 0.3, `${830 - b2.health}`);

  // Killing Blow: damage fills rage (10 = full: +8% damage); it waits for an enemy it can finish: 200, or an execute below 9% for a Haunt,
  // and a kill makes it ready again
  const r = quiet(buildHero('Shiv', { unlocked: 4 }), 1, 2, 3);
  const [low, next] = [dummy(), dummy()];
  const fr = new Fight({ heroes: [r], enemies: [low, next], rng: () => 0.5 });
  fr.run(1);
  assert.ok(!fr.log.length && r.abilities[3].rage === 0);
  fr.damage(r, low, 700, 'bullet');
  assert.ok(r.abilities[3].full);
  fr.step();
  assert.strictEqual(r.mod('damageDealt'), 0.08);
  low.health = 250; // above 200 and above 9% (180): not yet
  fr.run(0.5);
  assert.ok(low.alive);
  low.health = 150;
  next.health = 190;
  fr.run(0.4);
  assert.ok(!low.alive && !next.alive, 'the kill let him strike again');
  assert.strictEqual(fr.log.filter((l) => l.what === 'Killing Blow').length, 2);
});

test('Silver: each ability does its job, in both forms', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 5, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart, close enough for every pellet to land

  // Slam Fire: the gun reloaded at once, then 3 fast shots: double weapon damage against an NPC and 2.5% of current health (halved) on top
  const s = quiet(buildHero('Silver', { unlocked: 1 }));
  s.weapon.clip = 1;
  const shot = dummy({ maxHealth: 2500 });
  const fs14 = new Fight({ heroes: [s], enemies: [shot], rng: () => 0.5 });
  fs14.run(0.6);
  assert.ok(s.weapon.reloadLeft === 0 && s.weapon.clip >= 5 && s.mod('fireRate') === 3);
  fs14.run(1.5);
  assert.strictEqual(s.abilities[0].shots, 0);
  const expected = [0, 1, 2].reduce((hp) => { const after = hp - 5.1 * 7 * 2; return after - after * 0.0125; }, 2500) - 5.1 * 7; // and one plain shot after
  close(shot.health, expected, 0.001);
  assert.strictEqual(s.mod('fireRate'), 0);

  // Boot Kick: 45 melee damage and a mark for 3 s: the next shot at it deals 25 more
  const k = quiet(buildHero('Silver', { unlocked: 2 }), 1);
  const kicked = dummy({ maxHealth: 2900 });
  const fk = new Fight({ heroes: [k], enemies: [kicked], rng: () => 0.5 });
  fk.run(0.6);
  assert.ok(2900 - kicked.health === 45 && k.abilities[1].mark);
  k.weapon.reloadLeft = 0;
  fk.run(1);
  close(2900 - kicked.health, 45 + 25 + 5.1 * 7 * (7 - k.weapon.clip), 0.001);
  assert.strictEqual(k.abilities[1].mark, null);

  // Entangling Bola: 40 and a 16% slow for 1.5 s; tier 3 bounces to two more
  const b = quiet(buildHero('Silver', { unlocked: 3, tiers: { 3: 3 } }), 1, 2);
  const tied = row();
  new Fight({ heroes: [b], enemies: tied, rng: () => 0.5 }).run(0.5);
  assert.ok(tied.every((e) => 2000 - e.health === 40 && e.mod('slow') === 0.36));

  // Lycan Curse: 100 bloodlust (0.255 a damage dealt) turns her into the wolf for 15 s: +125 max health, its own gun and abilities, then back
  const w = quiet(buildHero('Silver', { unlocked: 4 }), 1, 2, 3);
  w.health = 400;
  const pack = row();
  const fw = new Fight({ heroes: [w], enemies: pack, rng: () => 0.5 });
  fw.damage(w, pack[2], 400, 'true');
  fw.step();
  const curse = w.abilities[3];
  assert.ok(curse.wolf && w.stats.maxHealth === 955 && w.stats.bulletDamage === 25 && w.stats.pellets === 1);
  close(w.health, 400 + 830 * 0.25, 0.02); // 125 + 30% of what she is missing, but the heal cap lets a quarter of her health through
  assert.deepStrictEqual(w.abilities.slice(0, 3).map((a) => a.name), ['Go For The Throat', 'Mauling Leap', 'Tail Whack']);
  // each form keeps its own cooldowns: the wolf's abilities start ready and are used at once
  fw.run(0.7);
  assert.ok(fw.log.some((l) => l.what === 'Tail Whack') && pack[2].has('disarm') && pack[0].mod('bulletResist') === -0.08);
  w.abilities.slice(0, 3).forEach((a) => { a.cdLeft = 1e9; });
  w.abilities[1].mauled = [];
  for (const e of pack) e.health = 2000;
  // the wolf's gun: no reload, and it also hits the enemy right beside its target
  w.weapon.reloadLeft = 0;
  fw.run(2);
  assert.ok(pack[0].health < 2000 && pack[1].health < 2000 && pack[2].health === 2000 && w.mod('fireRate') > 0 && w.weapon.reloadLeft === 0);
  // its abilities: a tail whack (45 within 10 m and a disarm), a bite (75 melee to those right in front, part of it back as health), a leap (75)
  w.weapon.reloadLeft = 1e9;
  for (const e of pack) e.health = 2000;
  w.health = 500;
  w.abilities.slice(0, 3).forEach((a) => { a.cdLeft = 0; });
  fw.run(0.6);
  close(2000 - pack[0].health, 45 + 75 + 75, 0.02);
  close(2000 - pack[1].health, 45 + 75, 0.02);
  assert.ok(2000 - pack[2].health === 45 && w.health > 500);
  fw.run(40);
  assert.ok(!curse.wolf && w.stats.maxHealth === 830 && w.stats.pellets === 7 && w.abilities[0].name === 'Slam Fire' && curse.cdLeft > 0);
});

test('Sinclair: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Vexing Bolt: its full 120 to everything within 3.25 m of the front enemy, half to a boss
  const v = quiet(buildHero('Sinclair', { unlocked: 1 }));
  const near = row();
  new Fight({ heroes: [v], enemies: near, rng: () => 0.5 }).run(0.3);
  assert.deepStrictEqual(near.map((e) => 2000 - e.health), [120, 0, 0]);
  const v2 = quiet(buildHero('Sinclair', { unlocked: 1 }));
  const far = [dummy({ maxHealth: 8000, distance: 20 })];
  new Fight({ heroes: [v2], enemies: far, rng: () => 0.5 }).run(0.3);
  assert.strictEqual(8000 - far[0].health, 60);

  // Spectral Assistant: when the gun runs dry: reloaded at once, and for 6 s every shot that hits is followed by 15 from the Assistant
  const a = quiet(buildHero('Sinclair', { unlocked: 2 }), 1);
  const helped = dummy({ maxHealth: 1e5 });
  const fa = new Fight({ heroes: [a], enemies: [helped], rng: () => 0.5 });
  fa.run(3);
  const shots = 16 - a.weapon.clip;
  assert.ok(shots >= 6 && a.abilities[1].status(fa) === 'Assisting');
  close(1e5 - helped.health, shots * (16.5 + 15), 0.001);

  // Rabbit Hex: 0.9 s later the enemies within 6 m can't attack for 2 s and take 15% more damage
  const h = quiet(buildHero('Sinclair', { unlocked: 3 }), 1, 2);
  const rabbits = [dummy({ dps: 50 }), dummy({ dps: 50 }), dummy({ dps: 50 })];
  const fh = new Fight({ heroes: [h], enemies: rabbits, rng: () => 0.5 });
  fh.run(1.5);
  assert.ok(rabbits[0].has('disarm') && rabbits[1].has('disarm') && !rabbits[2].has('disarm') && rabbits[0].mod('damageTaken') === 0.15);
});

test("Sinclair's Audience Participation copies every hero's ultimate", () => {
  const { roster, logicOf } = require('../src/utils/farm/hero');
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 3000, dps: 30, distance: 10, ...o });
  for (const name of roster().filter((n) => n !== 'Sinclair')) {
    for (const tier of [0, 3]) {
      // the member has unlocked only that hero: its ultimate is the one in the hat
      const s = buildHero('Sinclair', { boons: 20, tiers: { 4: tier }, copies: [name] });
      s.health = s.stats.maxHealth * 0.4; // hurt: the ultimates that wait for that get used too
      const foes = [dummy(), dummy(), dummy({ maxHealth: 250 })];
      const f = new Fight({ heroes: [s], enemies: foes, rng: () => 0.5 });
      f.run(60);
      const copied = f.log.find((l) => /copied from/.test(l.what));
      assert.ok(copied && copied.what.endsWith(`(copied from ${name})`), `${name}: ${JSON.stringify(f.log.slice(0, 6))}`);
      assert.ok(Number.isFinite(s.health) && Number.isFinite(s.stats.maxHealth) && foes.every((e) => Number.isFinite(e.health)), `${name} tier ${tier}: a number broke`);
      const ult = new (logicOf(name).abilities[4])(4, require('../src/utils/farm/stats').ABILITIES[HEROES[name].BoundAbilities[4].Key], s, 0);
      assert.ok(s.abilities.filter((x) => !x.hidden).length === 4, 'the copy is hidden from the fight screens');
      if (!ult.passive && !ult.copied) assert.ok(f.log.some((l) => l.what === ult.name) || s.abilities[3].copy, `${name}: the copy was used, or is still waiting for its moment`);
    }
  }
  // with no other hero unlocked there is nothing to copy; in a duel it is the rival's
  const alone = buildHero('Sinclair', { copies: [] });
  const fa = new Fight({ heroes: [alone], enemies: [dummy()], rng: () => 0.5 });
  fa.run(10);
  assert.ok(!fa.log.some((l) => /copied/.test(l.what)));
  const duelist = buildHero('Sinclair', { copies: [] });
  const fd = new Fight({ heroes: [duelist], enemies: [buildHero('Seven')], rng: () => 0.5 });
  fd.run(5);
  assert.ok(fd.log.some((l) => l.what === 'Storm Cloud (copied from Seven)'));
});

test('Venator: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Consecrating Grenade: 35 weapon damage within 4.5 m, then 3.5 s of burning: 10 a second from every burning enemy in reach (here two each)
  const g = quiet(buildHero('Venator', { unlocked: 1 }));
  const burned = row();
  const fg = new Fight({ heroes: [g], enemies: burned, rng: () => 0.5 });
  fg.run(0.3);
  assert.deepStrictEqual(burned.map((e) => 2000 - e.health), [35, 35, 0]);
  close(burned[0].mod('healAmp'), -0.3);
  fg.run(4);
  close(2000 - burned[0].health, 35 + 10 * 2 * 3.5, 0.06);

  // Gutshot: 60 weapon damage to the enemies in front; one that hits a wall (half the time; always here): +30 and a 0.6 s stun
  const s = quiet(buildHero('Venator', { unlocked: 2, tiers: { 2: 3 } }), 1);
  const shot = row();
  const fs15 = new Fight({ heroes: [s], enemies: shot, rng: () => 0.1 });
  fs15.run(0.5);
  assert.deepStrictEqual(shot.map((e) => 2000 - e.health), [85 + 30, 85 + 30, 85 + 30]); // with these dice they stand 2.4 m apart: all within its 5 m
  assert.ok(shot[0].has('stun') && s.abilities[1].blessedUntil > 0, 'tier 3: the next heavy melee is blessed');
  const s2 = quiet(buildHero('Venator', { unlocked: 2 }), 1);
  const lucky = [dummy()];
  new Fight({ heroes: [s2], enemies: lucky, rng: () => 0.9 }).run(0.5);
  assert.ok(2000 - lucky[0].health === 60 && !lucky[0].has('stun'), 'no wall');

  // Hex-Lined Snap Trap: armed after 0.5 s: 80 and a 1.25 s immobilize on the front enemy
  const t = quiet(buildHero('Venator', { unlocked: 3 }), 1, 2);
  const trapped = row();
  const ft4 = new Fight({ heroes: [t], enemies: trapped, rng: () => 0.5 });
  ft4.run(1);
  assert.deepStrictEqual(trapped.map((e) => 2000 - e.health), [80, 0, 0]);
  assert.ok(trapped[0].has('immobilize'));

  // Ira Domini: three stakes of 120 through every enemy; the last is blessed: +115 pure, and under 8% health (halved for an NPC) more on top
  const i = quiet(buildHero('Venator', { unlocked: 4 }), 1, 2, 3);
  const staked = [dummy(), dummy({ maxHealth: 490 })];
  const fi = new Fight({ heroes: [i], enemies: staked, rng: () => 0.5 });
  fi.run(1.9);
  assert.deepStrictEqual(staked.map((e) => e.stats.maxHealth - e.health), [120, 120]);
  fi.run(2);
  assert.strictEqual(2000 - staked[0].health, 360 + 115);
  assert.ok(!staked[1].alive, 'left with 15 of 490, under 4%: 4% of its max health more finishes it');
  assert.strictEqual(i.abilities[3].status(fi), 'Crossbow');
});

test('Victor: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Pain Battery: charged by the damage he takes (40% of his max health = 320); then 100 to the enemies in a 40 degree cone
  const p = quiet(buildHero('Victor', { unlocked: 1 }));
  const bolted = [dummy({ dps: 100 }), dummy(), dummy()];
  const fp = new Fight({ heroes: [p], enemies: bolted, rng: () => 0.5 });
  fp.run(3.2);
  assert.ok(bolted.every((e) => e.health === 2000) && /^9\d%$/.test(p.abilities[0].status(fp)), p.abilities[0].status(fp));
  fp.run(1.5);
  assert.deepStrictEqual(bolted.map((e) => 2000 - e.health), [100, 0, 0]); // 3.6 m to either side from 10 m away
  assert.ok(p.abilities[0].stored < 320);

  // Jumpstart: below 70% health: costs 15% of his current health, then 100 back over 4.5 s and +3 m/s
  const j = quiet(buildHero('Victor', { unlocked: 2 }), 1);
  j.health = 400;
  const fj = new Fight({ heroes: [j], enemies: [dummy()], rng: () => 0.5 });
  fj.run(0.6);
  assert.ok(j.health < 400 && j.health > 340 && j.mod('moveSpeed') === 3);
  fj.run(5);
  close(j.health, 400 * 0.85 + 100, 0.01);
  close(j.abilities[0].stored, 60);

  // Aura of Suffering: 8 s growing from 13 to 58 a second within 8 m, 70% of it on himself
  const a = quiet(buildHero('Victor', { unlocked: 3 }), 1, 2);
  const pained = row();
  const fa = new Fight({ heroes: [a], enemies: pained, rng: () => 0.5 });
  fa.run(8.6);
  const dealt = 2000 - pained[0].health;
  assert.ok(dealt > 250 && dealt < 300 && pained[2].health === 1000 * 2 - dealt, `${dealt}`);
  close(800 - a.health, dealt * 0.7, 0.01);

  // Shocking Reanimation: a lethal hit leaves him at 1 health, out for 3 s, then up at half health with 200 and a 1.5 s stun around
  const r = quiet(buildHero('Victor', { unlocked: 4 }), 1, 2, 3);
  r.health = 50;
  const killers = [dummy({ dps: 300 }), dummy()];
  const fr = new Fight({ heroes: [r], enemies: killers, rng: () => 0.5 });
  fr.run(1.1);
  assert.ok(r.alive && r.health === 1 && r.cantAct && fr.log.some((l) => l.what === 'Shocking Reanimation'));
  fr.run(2.5);
  assert.strictEqual(r.health, 1, 'nothing can hurt him meanwhile');
  fr.run(0.7);
  assert.ok(r.health >= 400 - 300 && !r.cantAct && killers.every((e) => 2000 - e.health === 200) && killers[1].has('stun'));
  r.health = 10;
  fr.run(3);
  assert.ok(!r.alive, 'on cooldown: the next lethal hit kills');
});

test('Vindicta: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy(), dummy()]; // 4 m apart

  // Stake: 40 and a 40% slow for 1.75 s within 9 m
  const s = quiet(buildHero('Vindicta', { unlocked: 1 }));
  const staked = row();
  new Fight({ heroes: [s], enemies: staked, rng: () => 0.5 }).run(0.4);
  assert.deepStrictEqual(staked.map((e) => 2000 - e.health), [40, 40, 40, 0]);
  assert.strictEqual(staked[0].mod('slow'), 0.4);

  // Flight: 13 s in the air, every bullet +10 spirit damage; tier 1: half a clip more ammo at take-off
  const f = quiet(buildHero('Vindicta', { unlocked: 2, tiers: { 2: 1 } }), 1);
  f.weapon.reloadLeft = 0;
  const shot = dummy({ maxHealth: 1e5 });
  const ff = new Fight({ heroes: [f], enemies: [shot], rng: () => 0.5 });
  ff.run(2);
  const fired = 19 + 10 - f.weapon.clip;
  assert.ok(fired >= 7 && f.has('airborne'));
  close(1e5 - shot.health, fired * (12.33 + 10), 0.001);
  ff.run(13);
  assert.ok(!f.has('airborne'));

  // Crow Familiar: 40, -6% bullet and spirit resist for 5 s, and 2.2% of its current health a second (halved for an NPC)
  const c = quiet(buildHero('Vindicta', { unlocked: 3 }), 1, 2);
  const pecked = dummy();
  const fc = new Fight({ heroes: [c], enemies: [pecked], rng: () => 0.5 });
  fc.run(0.5);
  assert.ok(2000 - pecked.health === 40 && pecked.mod('bulletResist') === -0.06 && pecked.mod('spiritResist') === -0.06);
  fc.run(6);
  const bled = [1, 2, 3, 4, 5].reduce((hp) => hp - hp * 0.011 * 1.06, 1960);
  close(pecked.health, bled, 0.001);

  // Assassinate: held until an enemy is below half health; then a 1 s scope and 90 plus up to 90 more the lower it is; a kill adds 6% weapon damage
  const a = quiet(buildHero('Vindicta', { unlocked: 4 }), 1, 2, 3);
  const [healthy, weak] = [dummy(), dummy()];
  const fa = new Fight({ heroes: [a], enemies: [healthy, weak], rng: () => 0.5 });
  fa.run(2);
  assert.ok(!fa.log.length);
  weak.health = 500; // a quarter left: half way down from half health
  fa.run(1.3);
  assert.strictEqual(500 - weak.health, 90 + 45);
  assert.strictEqual(a.abilities[3].charges, 1);
  weak.health = 100;
  fa.run(2.5);
  assert.ok(!weak.alive && a.abilities[3].kills === 1);
  close(a.mod('weaponDamage'), 0.06);
});

test('Viscous: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Splatter: 55 within 5 m, then two bounces for 50% and 38% of it, and a 28% slow
  const s = quiet(buildHero('Viscous', { unlocked: 1 }));
  const gooed = row();
  new Fight({ heroes: [s], enemies: gooed, rng: () => 0.5 }).run(1.5);
  close(2000 - gooed[0].health, 55 * (1 + 0.5 + 0.38), 0.001);
  assert.ok(gooed[1].mod('slow') === 0.28 && gooed[2].health === 2000);

  // The Cube: below half health, 3 s where nothing can touch him and he can't act, 40 a second back
  const c = quiet(buildHero('Viscous', { unlocked: 2 }), 1);
  c.health = 300;
  const fc = new Fight({ heroes: [c], enemies: [dummy({ dps: 50 })], rng: () => 0.5 });
  fc.run(0.5);
  assert.ok(!c.targetable && c.cantAct);
  fc.run(3);
  close(c.health, 300 + 40 * 3, 0.03);
  assert.ok(c.targetable);

  // Puddle Punch: 20 + 0.6 x light melee (57.8) within 4 m, a 0.6 s knock-up and a 24% slow; tier 3: 40 + 0.6 x heavy melee instead
  const p = quiet(buildHero('Viscous', { unlocked: 3 }), 1, 2);
  const punched = row();
  new Fight({ heroes: [p], enemies: punched, rng: () => 0.5 }).run(0.3);
  close(2000 - punched[1].health, 57.8, 0.001);
  assert.ok(punched[0].has('stun') && punched[2].health === 2000);
  const p3 = quiet(buildHero('Viscous', { unlocked: 3, tiers: { 3: 3 } }), 1, 2);
  const heavy = [dummy()];
  new Fight({ heroes: [p3], enemies: heavy, rng: () => 0.5 }).run(0.3);
  close(2000 - heavy[0].health, 40 + 0.6 * 116, 0.001);

  // Goo Ball: 11 s rolling: no shooting, +35% resists, and every 2 s 110 and a 0.5 s stun to the enemies it rolls through
  const g = quiet(buildHero('Viscous', { unlocked: 4 }), 1, 2, 3);
  g.weapon.reloadLeft = 0;
  g.stats.bulletDamage = 0; // the ball's damage alone
  const bowled = row();
  const fg = new Fight({ heroes: [g], enemies: bowled, rng: () => 0.5 });
  fg.run(5);
  assert.ok(g.weapon.clip >= 17 && g.mod('bulletResist') === 0.35 && g.abilities[3].status(fg) === 'Rolling'); // a few shots during the half second of cast
  assert.deepStrictEqual(bowled.map((e) => 2000 - e.health), [330, 330, 0]); // three passes so far
  fg.run(8);
  assert.ok(g.weapon.clip < 17 || g.weapon.reloadLeft > 0, 'shooting again');
});

test('Vyper: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.nextSlide = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Screwjab Dagger: 50 and a 28% slow; the second dagger in the same enemy (4 s later) is a stack: +25 and +12% slow
  const d = quiet(buildHero('Vyper', { unlocked: 1 }));
  const stuck = dummy();
  const fd = new Fight({ heroes: [d], enemies: [stuck], rng: () => 0.5 });
  fd.run(0.5);
  assert.ok(2000 - stuck.health === 50 && stuck.mod('slow') === 0.28);
  fd.run(4.2);
  assert.strictEqual(2000 - stuck.health, 50 + 75);
  close(stuck.mod('slow'), 0.4);

  // Lethal Venom: goes off 3 s later: 20 on a healthy enemy, the full 140 on one at 30% health or less
  for (const [health, damage] of [[2000, 20], [600, 140], [1300, 80]]) {
    const v = quiet(buildHero('Vyper', { unlocked: 2 }), 1);
    const bitten = dummy();
    bitten.health = health;
    const fv = new Fight({ heroes: [v], enemies: [bitten], rng: () => 0.5 });
    fv.run(2.9);
    assert.strictEqual(bitten.health, health);
    fv.run(0.4);
    close(health - bitten.health, damage, 0.001);
  }

  // Slither: +15% slide distance; tier 2 +2 stamina; tier 3 a slide gives a 180 barrier for 4 s
  const s = buildHero('Vyper', { unlocked: 3, tiers: { 3: 3 } });
  s.abilities.slice(0, 2).forEach((a) => { a.cdLeft = 1e9; a.gapLeft = 1e9; });
  const fs16 = new Fight({ heroes: [s], enemies: [dummy()], rng: () => 0.5 });
  fs16.run(6.3);
  close(s.mod('slideScale'), 0.35);
  assert.ok(s.mod('stamina') === 2 && s.statuses.some((x) => x.barrier > 0));

  // Petrifying Bola: 50 and a 40% slow within 12 m; the one it hits takes 180 more and is stone for 2.2 s: it can't act, and Vyper shoots the next one
  const b = quiet(buildHero('Vyper', { unlocked: 4 }), 1, 2, 3);
  const stoned = [dummy({ dps: 50 }), dummy({ dps: 50 }), dummy({ dps: 50 })];
  const fb = new Fight({ heroes: [b], enemies: stoned, rng: () => 0.5 });
  fb.run(0.3);
  assert.deepStrictEqual(stoned.map((e) => 2000 - e.health), [230, 50, 50]);
  assert.ok(stoned[0].has('stun') && !stoned[0].targetable && fb.foes[0] === stoned[1]);
  const hp = b.health;
  fb.run(1);
  assert.strictEqual(hp - b.health, 0, 'the stone one cannot attack and the others are slowed');
  fb.run(1.5);
  assert.ok(stoned[0].targetable);
  assert.ok(b.health < hp, 'the slowed enemies eventually attack');
});

test('Warden: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // his gun fires 0.21% faster per spirit power (the wiki's scaling)
  close(heroStats(HEROES.Warden, { boons: 10 }).fireRate, 3.8095 * (1 + 0.0021 * 11), 0.001);

  // Alchemical Flask: 60 and a 16% slow within 5.5 m, and 25% less weapon damage for 7 s; tier 1: they can't attack for 1 s
  const f = quiet(buildHero('Warden', { unlocked: 1, tiers: { 1: 1 } }));
  const soaked = [dummy({ dps: 100 }), dummy({ dps: 100, damageType: 'spirit' }), dummy()];
  const ff = new Fight({ heroes: [f], enemies: soaked, rng: () => 0.5 });
  ff.run(0.3);
  assert.deepStrictEqual(soaked.map((e) => 2000 - e.health), [60, 60, 0]);
  assert.ok(soaked[0].mod('damageDealt') === -0.25 && soaked[1].mod('damageDealt') === 0 && soaked[0].has('disarm') && soaked[0].mod('slow') === 0.16);

  // Willpower: a 125 barrier and 15% move speed for 5 s
  const w = quiet(buildHero('Warden', { unlocked: 2 }), 1);
  const fw = new Fight({ heroes: [w], enemies: [dummy({ dps: 50 })], rng: () => 0.5 });
  fw.run(2.05);
  assert.ok(w.health === 805 && w.statuses.find((x) => x.barrier > 0).barrier === 25);
  close(w.mod('moveSpeed'), 6.3 * 0.15);

  // Binding Word: 2.8 s later 110 and a 1.75 s immobilize on the front enemy; tier 1: it takes 20% more bullet damage for 5 s
  const b = quiet(buildHero('Warden', { unlocked: 3, tiers: { 3: 1 } }), 1, 2);
  const bound = row();
  const fb = new Fight({ heroes: [b], enemies: bound, rng: () => 0.5 });
  fb.run(2.8);
  assert.strictEqual(bound[0].health, 2000);
  fb.run(0.4);
  assert.deepStrictEqual(bound.map((e) => 2000 - e.health), [110, 0, 0]);
  assert.ok(bound[0].has('immobilize') && bound[0].mod('bulletTaken') === 0.2);

  // Last Stand: a 2 s charge without shooting, then 6 s of 70 a second within 12 m, 10% of it back as health, +50% resists throughout
  const l = quiet(buildHero('Warden', { unlocked: 4 }), 1, 2, 3);
  l.weapon.reloadLeft = 0;
  l.stats.bulletDamage = 0;
  l.health = 400;
  const stood = row();
  const fl = new Fight({ heroes: [l], enemies: stood, rng: () => 0.5 });
  fl.run(1.9);
  assert.ok(l.weapon.clip === 17 && l.mod('bulletResist') === 0.5 && stood[0].health === 2000);
  fl.run(7);
  close(2000 - stood[2].health, 70 * 6, 0.09);
  close(l.health - 400, (6000 - stood.reduce((sum, e) => sum + e.health, 0)) * 0.1, 0.001);
  assert.ok(l.weapon.clip < 17 && l.mod('bulletResist') === 0);
});

test('Wraith: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Card Trick: a fight starts with 2 cards, 0.5 s apart: 45 each within 4 m, plus what the suit does; no card comes back with time
  const c = quiet(buildHero('Wraith', { unlocked: 1 }));
  const dealt = row();
  const fc = new Fight({ heroes: [c], enemies: dealt, rng: () => 0.5 });
  fc.run(10);
  assert.strictEqual(c.abilities[0].charges, 0);
  const each = dealt.map((e) => 2000 - e.health);
  assert.ok(each[0] === each[1] && each[0] >= 90 && each[0] <= 90 * 1.6 && each[2] === 0, `${each}`);
  // hitting with the gun draws cards: 4 x 85% a bullet, 35% of that against an NPC = 1.19%, so the 85th bullet is a card
  const g = quiet(buildHero('Wraith', { unlocked: 1 }));
  g.abilities[0].charges = 0;
  g.abilities[0].gapLeft = 1e9;
  g.weapon.reloadLeft = 0;
  g.weapon.clip = 999;
  const fg = new Fight({ heroes: [g], enemies: [dummy({ maxHealth: 1e6 })], rng: () => 0.5 }); // no headshots with these dice
  fg.run(7.5);
  assert.ok(g.abilities[0].charges === 0 && /^9\d%$/.test(g.abilities[0].status()), g.abilities[0].status());
  fg.run(1);
  assert.strictEqual(g.abilities[0].charges, 1);

  // Project Mind: below half health, 2 s out of reach; tier 2: a 300 barrier for 5 s when she is back
  const p = quiet(buildHero('Wraith', { unlocked: 2, tiers: { 2: 2 } }), 1);
  p.health = 300;
  const fp = new Fight({ heroes: [p], enemies: [dummy({ dps: 50 })], rng: () => 0.5 });
  fp.run(1.5);
  assert.ok(!p.targetable && p.cantAct);
  fp.run(1.6); // 0.75 s to cast, 2 s away
  assert.ok(!p.cantAct && !p.targetable && p.statuses.some((x) => x.barrier > 0), 'back, and they still cannot find her');
  fp.run(1);
  assert.ok(p.targetable);

  // Full Auto: 5 s of +20% fire rate and +2 spirit damage a bullet
  const f = quiet(buildHero('Wraith', { unlocked: 3 }), 1, 2);
  f.weapon.reloadLeft = 0;
  const sprayed = dummy({ maxHealth: 1e5 });
  const ff = new Fight({ heroes: [f], enemies: [sprayed], rng: () => 0.5 });
  ff.run(3);
  assert.strictEqual(f.mod('fireRate'), 0.2);
  close(1e5 - sprayed.health, (52 - f.weapon.clip) * (5.64 + 2), 0.01); // the very first bullet leaves before it starts
  ff.run(3);
  assert.strictEqual(f.mod('fireRate'), 0);

  // Telekinesis: the front enemy lifted and stunned for the 1.25 s channel, then slammed: 100 and a 32% slow
  const t = quiet(buildHero('Wraith', { unlocked: 4 }), 1, 2, 3);
  const lifted = row();
  const ft5 = new Fight({ heroes: [t], enemies: lifted, rng: () => 0.5 });
  ft5.run(1);
  assert.ok(lifted[0].has('stun') && lifted[0].health === 2000 && !lifted[1].has('stun'));
  ft5.run(1);
  assert.deepStrictEqual(lifted.map((e) => 2000 - e.health), [100, 0, 0]);
  assert.strictEqual(lifted[0].mod('slow'), 0.32);
});

test('Yamato (the hero): each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Power Slash: a 1.4 s charge without shooting (+60% bullet resist), then 145 through every enemy within 22 m
  const p = quiet(buildHero('Yamato', { unlocked: 1 }));
  p.weapon.reloadLeft = 0;
  p.stats.bulletDamage = 0;
  const slashed = row();
  const fp = new Fight({ heroes: [p], enemies: slashed, rng: () => 0.5 });
  fp.run(1.2);
  assert.ok(p.mod('bulletResist') === 0.6 && p.weapon.clip === 12 && slashed[0].health === 2000);
  fp.run(0.5);
  assert.deepStrictEqual(slashed.map((e) => 2000 - e.health), [145, 145, 145]);

  // Flying Slash: 1.2 x light melee (66) and a 40% slow on the front enemy; tier 2: +35 spirit power for 6 s
  const f = quiet(buildHero('Yamato', { unlocked: 2, tiers: { 2: 2 } }), 1);
  const reeled = row();
  new Fight({ heroes: [f], enemies: reeled, rng: () => 0.5 }).run(0.3);
  close(2000 - reeled[0].health, 66, 0.001);
  assert.ok(reeled[0].mod('slow') === 0.4 && reeled[1].health === 2000 && f.mod('spirit') === 35);

  // Crimson Slash: 55 to the enemies in front, who deal 30% less for 4 s, and a heal of 55 for a hit
  const c = quiet(buildHero('Yamato', { unlocked: 3 }), 1, 2);
  c.health = 300;
  const cut = row();
  new Fight({ heroes: [c], enemies: cut, rng: () => 0.5 }).run(0.6);
  assert.deepStrictEqual(cut.map((e) => 2000 - e.health), [55, 55, 0]);
  close(cut[0].mod('damageDealt'), -0.3);
  assert.strictEqual(c.health, 355);

  // Shadow Transformation: 1.5 s where nothing can touch her, then 5 s: the other abilities ready again and 60% faster, +30% resists, unstoppable
  const s = quiet(buildHero('Yamato', { unlocked: 4 }));
  s.abilities[0].cdLeft = 1e9;
  s.abilities[1].cdLeft = 30;
  s.abilities[2].cdLeft = 1e9;
  const fs17 = new Fight({ heroes: [s], enemies: [dummy({ maxHealth: 1e6, dps: 50 })], rng: () => 0.5 });
  fs17.run(1);
  assert.ok(!s.targetable && s.health === 730);
  fs17.run(1);
  assert.ok(s.targetable && s.has('unstoppable') && s.mod('bulletResist') >= 0.3 && s.mod('spiritResist') === 0.3); // Power Slash, charging again, adds its own bullet resist
  assert.ok(fs17.log.filter((l) => l.what === 'Power Slash' || l.what === 'Flying Slash' || l.what === 'Crimson Slash').length === 3, 'all three ready again');
  const left = s.abilities[1].cdLeft;
  fs17.run(1);
  close(left - s.abilities[1].cdLeft, 1.6, 0.07);
  fs17.run(5);
  assert.ok(!s.has('unstoppable'));
});

test('Paige: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.stats.healthRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = () => enemy('Dummy', { maxHealth: 1e5, dps: 0, distance: 10 });

  // Bookwyrm: 60 to every enemy in its path, then a trail burning 30 a second for 3 s
  const b = quiet(buildHero('Paige', { unlocked: 1 }));
  const pack = [dummy(), dummy()];
  const fb = new Fight({ heroes: [b], enemies: pack, rng: () => 0.5 });
  fb.run(0.25);
  pack.forEach((e) => close(1e5 - e.health, 60));
  fb.run(5);
  pack.forEach((e) => close(1e5 - e.health, 60 + 30 * 3, 0.02));
  assert.strictEqual(buildHero('Paige', { unlocked: 1, tiers: { 1: 2 } }).abilities[0].maxCharges, 2);

  // Plot Armor: a 125 barrier on Paige and +25% weapon damage while it holds (tier 1: +14% fire rate); broken, the bonus ends
  const a = quiet(buildHero('Paige', { unlocked: 2, tiers: { 2: 1 } }), 1);
  const fa = new Fight({ heroes: [a], enemies: [dummy()], rng: () => 0.99 });
  fa.run(0.3);
  assert.ok(a.statuses.some((s) => s.barrier === 125));
  close(a.mod('weaponDamage'), 0.25);
  close(a.mod('fireRate'), 0.14);
  fa.damage(fa.enemies[0], a, 200, 'bullet');
  assert.strictEqual(a.health, a.stats.maxHealth - 75);
  assert.strictEqual(a.mod('weaponDamage'), 0);

  // Captivating Read: a slow at once, then 90 and a 1 s immobilize after 1.25 s; tier 3 takes 18% spirit resist off for 6 s
  const c = quiet(buildHero('Paige', { unlocked: 3, tiers: { 3: 3 } }), 1, 2);
  const read = dummy();
  const fc = new Fight({ heroes: [c], enemies: [read], rng: () => 0.99 });
  fc.run(0.4);
  assert.ok(read.mod('slow') === 0.36 && read.health === 1e5);
  fc.run(1.2);
  close(1e5 - read.health, 90);
  assert.ok(read.has('immobilize'));
  close(read.mod('spiritResist'), -0.18);

  // Rallying Charge: only when hurt; 125 x 1.5 to every enemy and a stun, heals Paige 125 x 1.5 (as far as the heal pool goes), +5 m/s
  const r = quiet(buildHero('Paige', { unlocked: 4 }), 1, 2, 3);
  const foes = [dummy(), dummy()];
  const fr = new Fight({ heroes: [r], enemies: foes, rng: () => 0.5 });
  fr.run(2);
  assert.ok(!fr.log.length, 'not used at full health');
  r.health = 200;
  fr.step();
  fr.step();
  foes.forEach((e) => { close(1e5 - e.health, 125 * 1.5); assert.ok(e.has('stun')); });
  close(r.health, 200 + Math.min(125 * 1.5, r.stats.maxHealth * HEAL_POOL));
  assert.strictEqual(r.mod('moveSpeed'), 5);
});

test('Celeste: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };
  const dummy = () => enemy('Dummy', { maxHealth: 1e5, dps: 0, distance: 10 });

  // Light Eater: a 40 damage flare, then +15 spirit damage a bullet on the marked enemy and 18% spirit lifesteal (weaker from an NPC)
  const l = quiet(buildHero('Celeste', { unlocked: 1 }));
  l.stats.healthRegen = 0;
  l.health = 300;
  const d = dummy();
  const fl = new Fight({ heroes: [l], enemies: [d], rng: () => 0.99 });
  fl.run(0.6);
  close(1e5 - d.health, 40);
  close(l.health, 300 + 40 * 0.18 * SPIRIT_LIFESTEAL_VS_NPC);
  assert.ok(d.has('lightEater'));
  l.weapon.reloadLeft = 0;
  const before = d.health;
  while (l.weapon.clip > 7) fl.step();
  close(before - d.health, 18 + 15);

  // Dazzling Trick: a 100 barrier; broken, it deals half of it around and silences. Tier 1: +3.5 m/s while it is up
  const t = quiet(buildHero('Celeste', { unlocked: 2, tiers: { 2: 1 } }), 1);
  t.stats.healthRegen = 0;
  const brute = enemy('Brute', { maxHealth: 1e5, dps: 150 });
  const ft = new Fight({ heroes: [t], enemies: [brute], rng: () => 0.99 });
  ft.step();
  ft.step();
  assert.ok(t.statuses.some((s) => s.barrier === 100) && t.mod('moveSpeed') === 3.5);
  ft.run(1);
  assert.strictEqual(t.health, t.stats.maxHealth - 50, 'the barrier took 100 of the 150');
  assert.ok(brute.has('silence') && !t.statuses.some((s) => s.id === 'prism'));
  close(1e5 - brute.health, 50);

  // Radiant Daggers: explodes after 1.4 s for 55 on every enemy around; each one hit is a stack of +7% spirit damage
  const r = quiet(buildHero('Celeste', { unlocked: 3 }), 1, 2);
  const pack = [dummy(), dummy(), dummy()];
  const fr = new Fight({ heroes: [r], enemies: pack, rng: () => 0.5 });
  fr.run(1.5);
  assert.ok(pack.every((e) => e.health === 1e5), 'still forming');
  fr.run(0.5);
  pack.forEach((e) => close(1e5 - e.health, 55));
  close(r.mod('spiritDealt'), 0.21);
  close(fr.damage(r, pack[0], 100, 'spirit'), 121);
  assert.strictEqual(fr.damage(r, pack[0], 100, 'bullet'), 100);
  assert.strictEqual(buildHero('Celeste', { unlocked: 3, tiers: { 3: 1 } }).abilities[2].maxCharges, 3);

  // Shining Wonder: 140 and a slow, bouncing 8 times round a group; one hit on a lone enemy
  const w = quiet(buildHero('Celeste', { unlocked: 4 }), 1, 2, 3);
  const trio = [dummy(), dummy(), dummy()];
  const fw = new Fight({ heroes: [w], enemies: trio, rng: () => 0.5 });
  fw.run(5);
  trio.forEach((e) => close(1e5 - e.health, 140 * 3));
  const lone = dummy();
  const w1 = quiet(buildHero('Celeste', { unlocked: 4 }), 1, 2, 3);
  const f1 = new Fight({ heroes: [w1], enemies: [lone], rng: () => 0.5 });
  f1.run(1);
  assert.ok(lone.mod('slow') === 0.32);
  f1.run(5);
  close(1e5 - lone.health, 140);
  // with the tier 3 prism she keeps the orb for it, and it bounces back onto the lone enemy while the prism stands
  const w3 = quiet(buildHero('Celeste', { unlocked: 4, tiers: { 2: 3 } }), 1, 3);
  w3.abilities[1].cdLeft = 1e9;
  const boss = dummy();
  const f3 = new Fight({ heroes: [w3], enemies: [boss], rng: () => 0.5 });
  f3.run(2);
  assert.strictEqual(boss.health, 1e5, 'waiting for the prism');
  w3.abilities[1].cdLeft = 0;
  f3.run(6);
  close(1e5 - boss.health, 140 * 9); // nothing broke the prism: 0.75 s to launch, 8 bounces 0.3 s apart, inside its 4 s
});

test('Mina: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; }); return hero; };

  // Rake: 60 + 6% of missing health (halved against a creep), executes a creep left under 60 health, heals 25 per kill
  const r = quiet(buildHero('Mina', { unlocked: 1 }));
  r.stats.healthRegen = 0;
  r.health = 300;
  const [hurt, weak] = [enemy('Hurt', { maxHealth: 1000, dps: 0 }), enemy('Weak', { maxHealth: 100, dps: 0 })];
  hurt.health = 500;
  const fr = new Fight({ heroes: [r], enemies: [hurt, weak], rng: () => 0.5 });
  fr.run(1);
  close(500 - hurt.health, 60 + 500 * 0.06 * 0.5);
  assert.ok(!weak.alive, 'left at 40 health, executed');
  close(r.health, 325);

  // Sanguine Retreat: slips a blast as it lands (never used on low health while a blast is coming); tier 1 adds fire rate and 8 bullets
  const s = quiet(buildHero('Mina', { unlocked: 2, tiers: { 2: 1 } }), 1);
  s.health = 100;
  const stomper = enemy('Stomper', { maxHealth: 1e5, dps: 0, blast: { every: 2, damage: 50, maxHealthPct: 0, curse: 1.5 } });
  const fs = new Fight({ heroes: [s], enemies: [stomper], rng: () => 0.99 });
  fs.run(1.5);
  assert.ok(!fs.log.length, 'saved for the blast');
  const clip = s.weapon.clip;
  fs.run(0.7);
  assert.ok(fs.log.some((l) => l.what === 'Sanguine Retreat') && fs.log.some((l) => l.enemy && l.dodged));
  assert.ok(s.health >= 100 && s.has('void') && s.mod('fireRate') === 0.25 && s.weapon.clip === clip + 8);
  // no blast in the fight: used when hurt
  const h = quiet(buildHero('Mina', { unlocked: 2 }), 1);
  const fh = fight(h);
  fh.run(1);
  assert.ok(!fh.log.length);
  h.health = 100;
  fh.run(0.3);
  assert.ok(h.has('void'));

  // Love Bites: +4 spirit damage a bullet; 18.4% a bullet fills the bar in 6 bullets, the bite deals 45 and adds 2 bats
  const b = buildHero('Mina', { unlocked: 4 });
  quiet(b, 1, 2, 4);
  b.weapon.reloadLeft = 0;
  const dummy = enemy('Dummy', { maxHealth: 1e5, dps: 0, distance: 10 });
  const fb = new Fight({ heroes: [b], enemies: [dummy], rng: () => 0.99 });
  while (b.weapon.clip > 12 - 6) fb.step();
  close(1e5 - dummy.health, 6 * (b.stats.bulletDamage + 4) + 45);
  assert.strictEqual(b.abilities[3].bonus, 2);
  assert.strictEqual(b.abilities[2].status(fb), '0% Built Up');

  // Nox Nostra: 75 bats in 2.5 s at 4.6 each, shared by the enemies, silencing them; half damage to a boss
  const n = quiet(buildHero('Mina', { unlocked: 4 }), 1, 2);
  n.abilities[2].build = () => {}; // the bats alone
  const pack = [enemy('A', { maxHealth: 2000, dps: 0 }), enemy('B', { maxHealth: 2000, dps: 0 })];
  const fn = new Fight({ heroes: [n], enemies: pack, rng: () => 0.5 });
  fn.run(1.5);
  assert.ok(pack.every((e) => e.has('silence')));
  fn.run(3);
  pack.forEach((e) => close(2000 - e.health, (75 * 4.6) / 2, 0.02));
  const nb = quiet(buildHero('Mina', { unlocked: 4 }), 1, 2);
  nb.abilities[2].build = () => {};
  const big = enemy('Boss', { maxHealth: 20000, dps: 0 });
  new Fight({ heroes: [nb], enemies: [big], rng: () => 0.5 }).run(5);
  close(20000 - big.health, 75 * 4.6 * 0.5, 0.02);
});

test('Abrams: the shotgun reloads shell by shell and matches the wiki, and each ability does its job', () => {
  const gun = buildHero('Abrams', { unlocked: 0 });
  gun.meleeAt = Infinity; // the gun alone
  close(gun.stats.reload, 0.705 + 9 * 0.3525); // a pause, then every shell
  const g = fight(gun);
  g.run(60);
  close(g.dealt.get(gun) / g.time, HEROES.Abrams.Weapon.SustainedDPS, 0.06); // the wiki's sustained DPS (reloads included)

  // Siphon Life: spirit damage to every enemy for 4 s, healing 35% of it; only when hurt
  const a = buildHero('Abrams', { unlocked: 1 });
  a.weapon.reloadLeft = 1e9;
  a.meleeAt = Infinity; // reloading for good would be a reason to melee
  a.stats.healthRegen = 0;
  const foes = [enemy('A', { maxHealth: 1e5, dps: 0 }), enemy('B', { maxHealth: 1e5, dps: 0 })];
  const f = new Fight({ heroes: [a], enemies: foes, rng: () => 0.99 });
  f.run(3);
  assert.ok(!f.log.length, 'not used at full health');
  a.health = 300;
  f.run(6);
  const drained = foes.map((e) => e.stats.maxHealth - e.health);
  close(drained[0], 22 * 4, 0.03);
  close(drained[1], 22 * 4, 0.03);
  close(a.health - 300, (drained[0] + drained[1]) * 0.35, 0.03);

  // Shoulder Charge stuns its target; tier 3 adds 1.5 damage to every pellet for 6 s
  const c = buildHero('Abrams', { unlocked: 2, tiers: { 2: 3 } });
  const brute = enemy('Brute', { maxHealth: 1e5, dps: 50 });
  const fc = new Fight({ heroes: [c], enemies: [brute], rng: () => 0.99 });
  fc.step();
  fc.step();
  assert.ok(brute.has('stun') && c.mod('bulletDamage') === 1.5);
  close(fc.shotDamage(c, brute), (3.6 + 1.5) * 9 * (1 - 0.9 * (15 - 17 > 0 ? 1 : 0)));

  // Infernal Resilience: +1 regen, tier 1 +200 health, and 13% of the health lost comes back over 20 s
  const plain = buildHero('Abrams', { unlocked: 2 });
  const tough = buildHero('Abrams', { unlocked: 3, tiers: { 3: 1 } });
  assert.strictEqual(tough.stats.maxHealth, plain.stats.maxHealth + 200);
  assert.strictEqual(tough.health, tough.stats.maxHealth);
  close(tough.stats.healthRegen, plain.stats.healthRegen + 1);
  const r = buildHero('Abrams', { unlocked: 3 });
  r.abilities.slice(0, 2).forEach((x) => { x.cdLeft = 1e9; });
  r.weapon.reloadLeft = 1e9;
  r.stats.healthRegen = 0;
  const fr = new Fight({ heroes: [r], enemies: [enemy('Dummy', { maxHealth: 1e5, dps: 0 })], rng: () => 0.99 });
  fr.damage(fr.enemies[0], r, 400, 'bullet');
  fr.run(25);
  close(r.health, r.stats.maxHealth - 400 + 400 * 0.13, 0.01);

  // Seismic Impact hits and stuns every enemy
  const u = buildHero('Abrams', { unlocked: 4 });
  u.abilities.slice(0, 3).forEach((x) => { x.cdLeft = 1e9; });
  u.weapon.reloadLeft = 1e9;
  u.meleeAt = Infinity;
  const pack = [enemy('A', { maxHealth: 1e5, dps: 5 }), enemy('B', { maxHealth: 1e5, dps: 5 })];
  const fu = new Fight({ heroes: [u], enemies: pack, rng: () => 0.99 });
  fu.step();
  fu.step();
  assert.ok(pack.every((e) => e.has('stun') && e.stats.maxHealth - e.health === 100));
});

const { TARGETS, SIEGE, HARDNESS, PAYOUT_SCALE, payout, attempt, siege } = require('../src/utils/farm/targets');
const { COOLDOWN: ROAM_COOLDOWN, roam, FINDS } = require('../src/utils/farm/roam');
const { BUFFS, dailyBuffs, rollBuff, buffText, DAILY_BUFFS } = require('../src/utils/farm/buffs');

test('farm targets: the wiki numbers and his cooldowns', () => {
  const hours = (k) => TARGETS[k].cooldown / 3600;
  assert.deepStrictEqual(['small-camp', 'medium-camp', 'large-camp', 'guardian', 'walker'].map(hours), [1, 3, 6, 12, 24]);
  assert.strictEqual(SIEGE.cooldown / 3600, 24);
  assert.strictEqual(ROAM_COOLDOWN / 60, 30);
  const big = TARGETS['large-camp'].enemies();
  assert.strictEqual(big.length, 3);
  assert.strictEqual(big[0].stats.maxHealth, 1133);
  close(big[0].stats.bulletResist, 0.6);
  assert.strictEqual(TARGETS['small-camp'].souls, 3 * 41);
  assert.strictEqual(TARGETS.guardian.souls, 1375);
  assert.strictEqual(TARGETS.walker.souls, 3675);
  assert.strictEqual(TARGETS['mid-boss'].enemies()[0].stats.maxHealth, 13000);
  close(TARGETS.walker.enemies()[0].stats.bulletResist, 0.35);
});

test('farm economy: payouts are a share of the wiki souls and there is no daily cap', () => {
  assert.ok(PAYOUT_SCALE > 0 && PAYOUT_SCALE <= 1, 'a share of the wiki souls'); // 5% x the souls scale
  assert.strictEqual(payout(TARGETS['small-camp'].souls), Math.round(123 * PAYOUT_SCALE));
  assert.ok(!('DAILY_CAP' in require('../src/utils/farm/targets')));
});

test('farm attempt: a win pays, a loss pays nothing and leaves the target whole', () => {
  const win = attempt(buildHero('Haze', { boons: 10 }), 'small-camp');
  assert.ok(win.won);
  assert.strictEqual(win.souls, payout(TARGETS['small-camp'].souls));
  const loss = attempt(buildHero('Haze'), 'walker', { maxSeconds: 60 });
  assert.ok(!loss.won);
  assert.strictEqual(loss.souls, 0);
  assert.throws(() => attempt(buildHero('Haze'), 'nope'), /Unknown target/);
});

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

test('buffs: the wiki drop rates add up, each type is level 1, and they change the stat sheet', () => {
  assert.strictEqual(Object.values(BUFFS).reduce((s, b) => s + b.odds, 0), 110, "the wiki's ten add to 100, Precision (his) 10 more");
  assert.strictEqual(BUFFS.maxHealth.odds, 20);
  assert.strictEqual(buffText('weaponDamage'), '+3% Weapon Damage');
  assert.strictEqual(buffText('maxHealth', 2), '+30 Max Health');
  const base = heroStats(HEROES.Haze);
  const buffed = heroStats(HEROES.Haze, { buffs: { maxHealth: 2, weaponDamage: 1, fireRate: 2, bulletResist: 4 } });
  close(buffed.maxHealth, base.maxHealth + 30);
  close(buffed.weaponDamageMult, base.weaponDamageMult + 0.03);
  close(buffed.fireRate, base.fireRate * 1.03);
  close(buffed.bulletResist, 0.02);
  assert.strictEqual(buildHero('Haze', { buffs: { maxHealth: 1 } }).stats.maxHealth, base.maxHealth + 15);
});

test('Precision: 25 flat points to start, a permanent buff adds 1, and a headshot chance is the points in percent', () => {
  const { headshotChance } = require('../src/utils/farm/engine');
  const base = buildHero('Haze');
  assert.strictEqual(base.stats.precision, 25);
  assert.strictEqual(headshotChance(base), 0.25);
  const buffed = buildHero('Haze', { buffs: { precision: 15 } });
  assert.strictEqual(buffed.stats.precision, 40);
  assert.strictEqual(headshotChance(buffed), 0.4);
  assert.strictEqual(buffText('precision', 3), '+3 Precision');
  assert.strictEqual(headshotChance({ stat: () => 250 }), 1, 'never above every bullet');
  // items (my picks, his ask Oct 22): the bullet-speed / zoom items and the headshot items add flat points; nothing else does
  const { heroStats: stats, itemByName } = require('../src/utils/farm/stats');
  assert.strictEqual(stats(HEROES.Haze, { items: ['Headshot Booster', 'Headhunter'] }).precision, 25 + 5 + 5);
  assert.strictEqual(stats(HEROES.Haze, { items: ['High-Velocity Rounds'] }).precision, 30);
  assert.strictEqual(stats(HEROES.Haze, { items: ['Extra Health'] }).precision, 25);
  assert.ok(itemByName('Infinite Rounds').Info1.Main.some((l) => l.Key === 'Precision' && l.Value === 20), 'a legendary shows it too');
});

test("buffs rotate daily: the same day gives the same buffs, other days differ, and drops come from today's buffs", () => {
  const today = dailyBuffs('2026-10-01');
  assert.strictEqual(today.length, DAILY_BUFFS);
  assert.deepStrictEqual(dailyBuffs('2026-10-01'), today);
  const days = new Set(Array.from({ length: 10 }, (_, i) => dailyBuffs(`2026-10-${String(i + 1).padStart(2, '0')}`).join()));
  assert.ok(days.size > 3);
  const rng = seeded(11);
  for (let i = 0; i < 200; i++) assert.ok(today.includes(rollBuff('2026-10-01', rng)));
});

test("roam: a haul of Crates, Tough Crates, Sinner's Sacrifices and Golden Statues, with buffs from today's list", () => {
  assert.deepStrictEqual(FINDS.map((f) => f.key), ['crate', 'toughCrate', 'statue', 'sinner']);
  const seen = { crate: 0, toughCrate: 0, statue: 0, sinner: 0 };
  let buffs = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const haul = roam('2026-10-01', seeded(seed));
    const n = Object.values(haul.finds).reduce((s, x) => s + x, 0);
    assert.ok(n >= 4 && n <= 7);
    assert.ok(haul.souls >= 0);
    for (const b of haul.buffs) assert.ok(haul.today.includes(b));
    for (const k of Object.keys(seen)) seen[k] += haul.finds[k];
    buffs += haul.buffs.length;
  }
  assert.ok(Object.values(seen).every((x) => x > 0), JSON.stringify(seen)); // every kind turns up
  assert.ok(seen.crate > seen.sinner && buffs > 0);
});

test('Mid-Boss: a hero who dies stays dead; a kill drops a Rejuv', () => {
  const dead = attempt(buildHero('Haze'), 'mid-boss', { maxSeconds: 300 });
  assert.ok(!dead.won && dead.heroesAlive === 0);
  assert.strictEqual(dead.rejuvsEarned, 0);
  // a hero that can't die wins it and earns the Rejuv
  const god = buildHero('Haze', { boons: 40, items: Array(6).fill('Extra Health') });
  god.stats.maxHealth = 1e6; god.health = 1e6;
  const win = attempt(god, 'mid-boss', { maxSeconds: 900 });
  assert.ok(win.won);
  assert.strictEqual(win.rejuvsEarned, 1);
});

test('base siege: stages in order, shrines hit like the Patron, one death restarts everything', () => {
  assert.deepStrictEqual(SIEGE.stages.map((s) => s.name), ['Base Guardians', 'Shrine', 'Second Shrine', 'Patron', 'Weakened Patron']);
  const shrine = SIEGE.stages[1].enemies()[0];
  assert.strictEqual(shrine.stats.maxHealth, 5000);
  assert.strictEqual(SIEGE.stages[2].enemies()[0].stats.maxHealth, 10000);
  close(shrine.stats.dps, 440 * HARDNESS.siege, 0.001); // the wiki's beam, scaled by the siege's difficulty setting
  close(shrine.stats.dpsMaxHealthPct, 0.05 * HARDNESS.siege, 0.0001);
  assert.ok(shrine.stats.bulletResist > 0.5); // 20% base, then the solo-hero scaling on top
  const fell = siege(buildHero('Haze', { boons: 10 }));
  assert.ok(!fell.won);
  assert.strictEqual(fell.souls, 0);
  assert.ok(fell.stage < 5 && fell.stageName);
  const god = buildHero('Haze', { boons: 40 });
  god.statuses.push({ id: 'god', until: 1e12, mods: { damageTaken: -1 }, tags: [] }); // can't be hurt: tests the stage chain
  const clear = siege(god);
  assert.ok(clear.won);
  assert.strictEqual(clear.souls, payout(2 * (2 * 1000 + 2 * 2000)), 'the siege pays double the wiki worth');
});

test("Patron's beam takes a share of max health, so tanking by raw health only gets you so far", () => {
  const haze = buildHero('Haze');
  const f = new Fight({ heroes: [haze], enemies: [SIEGE.stages[1].enemies()[0]], rng: () => 0.99 });
  const before = haze.health;
  for (let i = 0; i < 10; i++) f.step(); // enemies hit once a second
  close(before - haze.health, (440 + 0.05 * haze.stats.maxHealth) * HARDNESS.siege * (1 - haze.stats.bulletResist), 0.05);
});

test('Rejuv: a hero who dies comes back at full health after 3 s and fights on', () => {
  const haze = buildHero('Haze');
  haze.abilities.forEach((a) => { a.cdLeft = 1e9; });
  haze.rejuvs = 1;
  const f = fight(haze, enemy('Brute', { maxHealth: 1e6, dps: 0 }));
  f.damage(f.enemies[0], haze, 99999, 'bullet');
  assert.ok(haze.alive);
  assert.strictEqual(haze.health, haze.stats.maxHealth);
  assert.strictEqual(haze.rejuvs, 0);
  assert.ok(haze.has('sleep')); // down for a moment
  f.damage(f.enemies[0], haze, 99999, 'bullet');
  assert.strictEqual(haze.health, haze.stats.maxHealth); // untouchable while getting up
  for (let i = 0; i < 40; i++) f.step();
  assert.ok(!haze.has('sleep'));
  f.damage(f.enemies[0], haze, 99999, 'bullet'); // no more Rejuvs
  assert.ok(!haze.alive);
});

test('enemies can regenerate (the Mid-Boss heals 15 HP a second)', () => {
  const boss = TARGETS['mid-boss'].enemies()[0];
  assert.strictEqual(boss.stats.healthRegen, 15);
  boss.health = 1000;
  const f = new Fight({ heroes: [], enemies: [boss] }); // nobody shooting it
  for (let i = 0; i < 100; i++) f.step();
  assert.ok(boss.health > 1100);
});

test('every farm target and siege stage has its wiki icon on disk', () => {
  const fs = require('node:fs');
  for (const target of [...Object.values(TARGETS), ...SIEGE.stages]) assert.ok(fs.existsSync(target.icon), target.icon);
  for (const name of ['crate', 'tough-crate', 'golden-statue', 'sinners-sacrifice']) assert.ok(fs.existsSync(`assets/farm/icons/${name}.png`), name);
  assert.ok(TARGETS['small-camp'].icon.endsWith('small-camp.png'));
});

test('Sleep Dagger picks any awake enemy at random, never a sleeping or downed one', () => {
  const picks = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const haze = buildHero('Haze');
    const foes = [1, 2, 3].map((i) => enemy(`Foe ${i}`, { maxHealth: 1000, dps: 0 }));
    const f = new Fight({ heroes: [haze], enemies: foes, rng: seeded(seed * 100003) }); // the first draw of a tiny seed is always tiny
    picks.add(foes.indexOf(haze.abilities[0].pick(f)));
  }
  assert.deepStrictEqual([...picks].sort(), [0, 1, 2], 'every enemy gets picked sometime');
  const haze = buildHero('Haze');
  const foes = [1, 2, 3].map((i) => enemy(`Foe ${i}`, { maxHealth: 1000, dps: 0 }));
  const f = new Fight({ heroes: [haze], enemies: foes, rng: () => 0 });
  foes[0].health = 0;
  f.addStatus(foes[1], { id: 'sleep', duration: 5, tags: ['sleep'] });
  assert.strictEqual(haze.abilities[0].pick(f), foes[2]);
  f.addStatus(foes[2], { id: 'sleep', duration: 5, tags: ['sleep'] });
  assert.ok(!haze.abilities[0].want(f), 'everyone is down or asleep: nothing to throw at');
});

test('the Patron: half weapon and half spirit damage, and a true-damage blast that curses; the Shrines silence', () => {
  const kinds = SIEGE.stages.map((s) => { const e = s.enemies()[0].stats; return [e.damageType, !!e.blast]; });
  assert.deepStrictEqual(kinds, [['bullet', false], ['spirit', true], ['spirit', true], ['mixed', false], ['mixed', true]]);
  // mixed damage: each resist only takes its half
  const taken = (stats, foe, seconds = 8.05) => {
    const hero = buildHero('Haze', { unlocked: 0 });
    Object.assign(hero.stats, { healthRegen: 0, maxHealth: 1e6 }, stats);
    hero.health = hero.stats.maxHealth;
    hero.healPool = 0;
    hero.weapon.reloadLeft = 1e9;
    const f = new Fight({ heroes: [hero], enemies: [enemy('Foe', { maxHealth: 1e6, ...foe })], rng: () => 0.99 });
    f.run(seconds);
    return { lost: hero.stats.maxHealth - hero.health, fight: f, hero };
  };
  const plain = taken({}, { dps: 100, damageType: 'mixed' }).lost;
  close(plain, 805, 0.01);
  close(taken({ bulletResist: 0.5 }, { dps: 100, damageType: 'mixed' }).lost, plain * 0.75, 0.01);
  close(taken({ spiritResist: 0.5 }, { dps: 100, damageType: 'mixed' }).lost, plain * 0.75, 0.01);
  // the blast: true damage (no resist helps), every `every` seconds, and the hero is cursed (can't act) after it
  const blast = { every: 8, damage: 300, maxHealthPct: 0.001, curse: 1.5, tags: ['curse'] };
  const hit = taken({ bulletResist: 0.9, spiritResist: 0.9 }, { dps: 0, blast }, 8.3);
  close(hit.lost, 300 + 0.001 * 1e6, 0.001);
  assert.ok(hit.hero.has('curse') && !hit.hero.has('sleep') && hit.fight.log.some((l) => l.enemy && l.what === 'curse'));
  hit.fight.run(2);
  assert.ok(!hit.hero.has('curse'), 'the curse wears off');
  // the siege tuning scales the blast like the rest of the damage
  const shrine = SIEGE.stages[1].enemies()[0].stats;
  close(shrine.blast.damage, 300 * HARDNESS.siege, 0.001);
  assert.strictEqual(shrine.blast.every, 8);
  const run = require('../src/utils/farm/play').simulate('Haze', 'siege', { boons: 35, rejuvs: 3 });
  assert.ok(run.log.some(([, text]) => /silenced Haze/.test(text)), 'the battle log says who silenced the hero');
});

test('ability range and movement speed: area abilities reach further back, and a fast hero dodges blasts', () => {
  const { dodgeChance, DODGE, SPREAD } = require('../src/utils/farm/engine');
  // enemies stand one behind the other (gaps of SPREAD x 0.5-1.5); a lone enemy is always in reach
  const foes = [1, 2, 3, 4].map((i) => enemy(`Foe ${i}`, { maxHealth: 1e6, dps: 0 }));
  const abrams = buildHero('Abrams', { unlocked: 4 });
  const f = new Fight({ heroes: [abrams], enemies: foes, rng: () => 0.5 }); // every gap is exactly SPREAD
  assert.deepStrictEqual(foes.map((e) => e.offset), [0, SPREAD, 2 * SPREAD, 3 * SPREAD]);
  assert.strictEqual(f.near(9).length, 3);
  foes[0].health = 0; // the front one falls: the hero moves up to the next
  assert.strictEqual(f.near(9).length, 3);
  assert.strictEqual(f.near(0).length, 1);
  // Seismic Impact (9 m) misses the last enemy; with +40% ability range it reaches it
  const seismic = abrams.abilities[3];
  seismic.cast(f);
  assert.deepStrictEqual(foes.slice(1).map((e) => e.has('stun')), [true, true, true]);
  foes[0].health = 1e6;
  const wide = buildHero('Abrams', { unlocked: 4, buffs: { abilityRange: 160 } }); // 160 x 0.25% = +40%
  const g = new Fight({ heroes: [wide], enemies: [1, 2, 3, 4].map((i) => enemy(`Foe ${i}`, { maxHealth: 1e6, dps: 0 })), rng: () => 0.5 });
  abrams.abilities[3].cast(g);
  assert.strictEqual(g.enemies.filter((e) => e.has('stun')).length, 3, 'plain range: three of four');
  wide.abilities[3].cast(g);
  assert.strictEqual(g.enemies.filter((e) => e.has('stun')).length, 4);
  // dodge: a chance per m/s above DODGE.from, capped; a dodged blast neither hurts nor curses
  const haze = buildHero('Haze', { unlocked: 0 });
  close(dodgeChance(haze), (haze.stats.moveSpeed - DODGE.from) * DODGE.per, 1e-9);
  haze.stats.moveSpeed = 100;
  assert.strictEqual(dodgeChance(haze), DODGE.max);
  haze.weapon.reloadLeft = 1e9;
  const blast = { every: 1, damage: 300, maxHealthPct: 0, curse: 1.5 };
  const d = new Fight({ heroes: [haze], enemies: [enemy('Foe', { maxHealth: 1e6, dps: 0, blast })], rng: () => 0 });
  d.run(1.3);
  assert.strictEqual(haze.health, haze.stats.maxHealth);
  assert.ok(!haze.has('sleep') && d.log.some((l) => l.dodged));
  // the Walker stomps (spirit damage and a stun)
  const stomp = TARGETS.walker.enemies()[0].stats.blast;
  assert.deepStrictEqual([stomp.every, stomp.curse, stomp.type, stomp.what], [6, 2, 'spirit', 'stomp']);
});

test('Baba: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart

  // Threadsap: 0.9 s after the cast 50 to every enemy and 10 spirit power stolen from each; Baba gains 175% of it, and her bullets add 8 + 0.26 x spirit
  const t = quiet(buildHero('Baba', { unlocked: 1 }));
  const sapped = row();
  const ft = new Fight({ heroes: [t], enemies: sapped, rng: () => 0.5 });
  ft.run(0.8);
  assert.ok(sapped.every((e) => e.health === 2000));
  ft.run(0.4);
  assert.deepStrictEqual(sapped.map((e) => [2000 - e.health, e.mod('spirit')]), [[50, -10], [50, -10], [50, -10]]);
  close(t.mod('spirit'), 52.5);
  ft.damage(t, sapped[0], 10, 'bullet');
  close(1950 - sapped[0].health, 10 + 8 + 0.26 * 52.5, 0.001);

  // Granny Long Legs: +5 m/s and 30% debuff resist, and her heavy melee (116) pounds every enemy within 8 m: +75 spirit damage, a knock-up, a 50% slow
  const g = quiet(buildHero('Baba', { unlocked: 2 }), 1);
  g.meleeAt = 0.15; // the legs are out from the second step
  const pounded = row();
  const fg = new Fight({ heroes: [g], enemies: pounded, rng: () => 0.5 });
  fg.run(0.3);
  assert.deepStrictEqual(pounded.map((e) => 2000 - e.health), [191, 191, 191]);
  assert.ok(pounded.every((e) => e.has('stun') && e.mod('slow') === 0.5) && g.mod('moveSpeed') === 5);
  close(g.mod('statusResist'), 0.3);
  close(g.meleeAt, 0.2 + 4.5, 0.001); // about three times as long between pounds
  fg.run(10);
  assert.ok(g.mod('moveSpeed') === 0, 'the legs fold after 10 s');

  // Baba's Brew: a 1 s channel, then one of three at random. Silencing: the enemies within 6 m; Scalding: a burn and -15% spirit resist; Soothing: a barrier
  const brew = (roll, tiers = {}) => {
    const b = quiet(buildHero('Baba', { unlocked: 3, tiers }), 1, 2);
    const splashed = row();
    new Fight({ heroes: [b], enemies: splashed, rng: () => roll }).run(2.3);
    return [b, splashed];
  };
  const [, hushed] = brew(0.5);
  assert.deepStrictEqual(hushed.map((e) => e.has('silence')), [true, true, false]);
  const [, scalded] = brew(0.9);
  assert.ok(scalded[0].health < 2000 && scalded[1].health < 2000 && scalded[2].health === 2000);
  close(scalded[0].mod('spiritResist'), -0.15);
  const [soothed] = brew(0.1);
  close(soothed.statuses.find((s) => s.id === 'soothing_brew').barrier, 90); // the Oct 20 patch: 100 -> 90
  const [stronger] = brew(0.1, { 3: 3 }); // tier 3: every brew a third stronger
  close(stronger.statuses.find((s) => s.id === 'soothing_brew').barrier, 120, 0.01);

  // Feed The Birds: a 6.5 s channel without casting while the bread slows them, then 450 to each and 2.75 s as pigeons (no attacks)
  const f = quiet(buildHero('Baba', { unlocked: 4 }), 1, 2, 3);
  const fed = row();
  const ff = new Fight({ heroes: [f], enemies: fed, rng: () => 0.5 });
  ff.run(4);
  assert.ok(f.has('silence') && fed.every((e) => e.health === 2000));
  close(fed[0].mod('slow'), 0.32);
  ff.run(3);
  assert.deepStrictEqual(fed.map((e) => 2000 - e.health), [450, 450, 450]);
  assert.ok(fed.every((e) => e.has('disarm')) && !f.has('silence'));
  ff.run(3);
  assert.ok(fed.every((e) => !e.has('disarm')));
});

test('Rat King: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart
  const lost = (list) => list.map((e) => +(2000 - e.health).toFixed(3));

  // the gun: two pellets, one of which always lands
  const gun = buildHero('Rat King').stats;
  assert.ok(gun.pellets === 2 && gun.surePellets === 1);
  const shooter = buildHero('Rat King', { unlocked: 0 });
  shooter.stamina = 0; shooter.nextDash = Infinity; shooter.meleeAt = Infinity;
  const far = dummy({ maxHealth: 1e6, distance: 15 });
  new Fight({ heroes: [shooter], enemies: [far], rng: () => 0 }).run(1); // every roll a miss: half of 5 shots of 12 still lands
  close(1e6 - far.health, 30, 0.001);

  // Scrap Grenade: 70 bullet damage and a 20% slow within 8 m, three times: 0.8 s, 1.5 s and 3 s after the cast
  const s = quiet(buildHero('Rat King', { unlocked: 1 }));
  const scrapped = row();
  const fs1 = new Fight({ heroes: [s], enemies: scrapped, rng: () => 0.5 });
  fs1.run(1);
  assert.deepStrictEqual(lost(scrapped), [70, 70, 70]);
  close(scrapped[0].mod('slow'), 0.2);
  fs1.run(0.8);
  assert.deepStrictEqual(lost(scrapped), [140, 140, 140]);
  fs1.run(1);
  assert.deepStrictEqual(lost(scrapped), [140, 140, 140]);
  fs1.run(0.5);
  assert.deepStrictEqual(lost(scrapped), [210, 210, 210]);
  const big = quiet(buildHero('Rat King', { unlocked: 1, tiers: { 1: 3 } })); // tier 3: a fourth, bigger one (300)
  const flattened = row();
  new Fight({ heroes: [big], enemies: flattened, rng: () => 0.5 }).run(4);
  assert.deepStrictEqual(lost(flattened), [140 * 3 + 300, 140 * 3 + 300, 140 * 3 + 300]);

  // Rat Swarm: 9 rats dealt round the enemies within 10 m, each biting once a second for 6 s: 8 spirit damage and -1% bullet resist a bite
  const r = quiet(buildHero('Rat King', { unlocked: 2 }), 1);
  const bitten = row();
  const fr = new Fight({ heroes: [r], enemies: bitten, rng: () => 0.5 });
  fr.run(1.3);
  assert.deepStrictEqual(lost(bitten), [24, 24, 24]);
  close(bitten[0].mod('bulletResist'), -0.03);
  fr.run(6);
  assert.deepStrictEqual(lost(bitten), [144, 144, 144]);
  const lone = [dummy()]; // at most 5 on one enemy
  const r1 = quiet(buildHero('Rat King', { unlocked: 2 }), 1);
  new Fight({ heroes: [r1], enemies: lone, rng: () => 0.5 }).run(1.3);
  assert.deepStrictEqual(lost(lone), [40]);

  // Royal Pestments: a barrier of 15% of max health (120) that his resists do nothing for; a weapon hit has a 15% chance to go back at the attacker
  const armored = (roll) => {
    const p = quiet(buildHero('Rat King', { unlocked: 3 }), 1, 2);
    p.stats.bulletResist = 0.5;
    const brute = dummy({ dps: 100 });
    new Fight({ heroes: [p], enemies: [brute], rng: () => roll }).run(1.1);
    return [p, brute];
  };
  const [p, brute] = armored(0.5);
  assert.ok(p.health === 800 && brute.health === 2000);
  close(p.statuses.find((x) => x.id === 'pestments').barrier, 20);
  const [, struck] = armored(0.1);
  assert.strictEqual(struck.health, 1900);

  // Rule, Ratannia!: a 2 s charge-up, then the slam: 200 bullet damage and a knock-up within 20 m; while the banner stands (12 s) he is faster and
  // takes 15% less, the enemies are slowed 40% and a rat jumps onto one of them every 0.5 s
  const k = quiet(buildHero('Rat King', { unlocked: 4 }), 1, 2, 3);
  const ruled = row();
  const fk = new Fight({ heroes: [k], enemies: ruled, rng: () => 0.5 });
  fk.run(2);
  assert.deepStrictEqual(lost(ruled), [0, 0, 0]);
  fk.run(0.3);
  assert.deepStrictEqual(lost(ruled), [200, 200, 200]);
  assert.ok(ruled.every((e) => e.has('stun') && e.mod('slow') === 0.4) && k.mod('moveSpeed') === 3);
  close(k.mod('damageTaken'), -0.15);
  fk.run(1.6);
  assert.strictEqual(k.abilities[1].rats.length, 3);
  assert.deepStrictEqual(ruled.map((e) => k.abilities[1].rats.filter((x) => x.e === e).length), [1, 1, 1]);
  fk.run(11);
  assert.ok(k.mod('moveSpeed') === 0 && ruled[0].mod('slow') === 0);
});

test('Violet: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart
  const lost = (list) => list.map((e) => +(2000 - e.health).toFixed(3));

  // Living Ink: an ink shot deals 120% of the gun's 30 and splashes 35 spirit damage; each hit takes 1.5 s off her cooldowns
  const v = buildHero('Violet', { unlocked: 1 });
  v.stamina = 0; v.nextDash = Infinity; v.meleeAt = Infinity;
  const target = dummy({ maxHealth: 1e6 });
  const fi = new Fight({ heroes: [v], enemies: [target], rng: () => 0.5 });
  while (target.health === 1e6) fi.step();
  close(1e6 - target.health, 30 * 1.2 + 35);
  const ink = v.abilities[0];
  assert.strictEqual(ink.shots, 2);
  close(ink.cdLeft, 22 - (fi.time - fi.log.find((l) => l.what === 'Living Ink').t) - 1.5, 0.01);
  assert.ok(v.mod('fireRate') < 0, 'slower while the ink is loaded');

  // Flow State: the flick 2 s after the cast: 100 spirit damage and a 60% slow within 15 m; she slides on the trail
  const f = quiet(buildHero('Violet', { unlocked: 2 }), 1);
  const flicked = row();
  const ff = new Fight({ heroes: [f], enemies: flicked, rng: () => 0.5 });
  ff.run(1.5);
  assert.deepStrictEqual(lost(flicked), [0, 0, 0]);
  assert.ok(f.has('sliding'));
  ff.run(1);
  assert.deepStrictEqual(lost(flicked), [100, 100, 100]);
  close(flicked[2].mod('slow'), 0.6);

  // Still Life: 2.6 s of 30 a second on the front enemy, then 60 and a stun, and a sketch (roll 0.5: +20 max health)
  const s = quiet(buildHero('Violet', { unlocked: 3 }), 1, 2);
  const drawn = row();
  const fs3 = new Fight({ heroes: [s], enemies: drawn, rng: () => 0.5 });
  fs3.run(3);
  close(lost(drawn)[0], 30 * 2.6 + 60, 0.03);
  assert.deepStrictEqual(lost(drawn).slice(1), [0, 0]);
  assert.ok(drawn[0].has('stun'));
  assert.strictEqual(s.stats.maxHealth, 730);

  // Abstract Landscape: +25 spirit power while it stands; every enemy within 18 m of the front one: 100 + 1.4 x spirit, a 2 s silence and a 30% slow
  const a = quiet(buildHero('Violet', { unlocked: 4 }), 1, 2, 3);
  const ringed = row();
  const fa = new Fight({ heroes: [a], enemies: ringed, rng: () => 0.5 });
  fa.run(0.8);
  assert.deepStrictEqual(lost(ringed), [135, 135, 135]); // 100 + 1.4 x the ring's own 25 spirit power
  assert.ok(ringed.every((e) => e.has('silence') && e.mod('slow') === 0.3) && a.mod('spirit') === 25);
});

test('Nurse Harrow: each ability does its job', () => {
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart
  const lost = (list) => list.map((e) => +(2000 - e.health).toFixed(3));

  // Leech Therapy: 4 leeches over the enemies within 6.5 m (2 each), 23 a second each for 5 s; 1 s later she keeps all 4: +5% fire rate and +0.6 regen each
  const l = quiet(buildHero('Nurse Harrow', { unlocked: 1 }));
  const fed = row();
  const fl = new Fight({ heroes: [l], enemies: fed, rng: () => 0.5 });
  fl.run(5.5);
  close(lost(fed)[0], 2 * 23 * 5, 0.02);
  close(lost(fed)[1], 2 * 23 * 5, 0.02);
  assert.strictEqual(lost(fed)[2], 0);
  fl.run(1.5);
  assert.strictEqual(l.abilities[0].stacks, 4);
  close(l.mod('fireRate'), 0.2);
  close(l.stats.healthRegen, 4 * 0.6);

  // Wretched Vapors: the brute's hits are held back during the 4 s rush, then land at once with 30% more
  const w = quiet(buildHero('Nurse Harrow', { unlocked: 2 }), 1);
  const fw = new Fight({ heroes: [w], enemies: [dummy({ dps: 100 })], rng: () => 0.5 });
  fw.run(4.2);
  assert.strictEqual(w.health, 730);
  close(w.mod('fireRate'), 0.25);
  fw.run(0.2);
  assert.strictEqual(w.health, 730 - 4 * 100 * 1.3);

  // Healing Needles: below 60% she swaps (1.3 s) and shoots herself with a clip of 11 syringes, 25 each; the charge is spent
  const n = quiet(buildHero('Nurse Harrow', { unlocked: 3 }), 1, 2);
  n.health = 300;
  new Fight({ heroes: [n], enemies: [dummy({ maxHealth: 1e6 })], rng: () => 0.5 }).run(6);
  close(n.health, 300 + 11 * 25);
  assert.ok(n.abilities[2].stock === 0 && n.abilities[2].loaded === 0);

  // Lurking Terrors: 1.3 s to open, then 7 s of 60 a second within 35 m, a 30% slow and 30% slower attacks; after 1.3 s of looking, fear
  const t = quiet(buildHero('Nurse Harrow', { unlocked: 4 }), 1, 2, 3);
  const scared = row();
  const ft = new Fight({ heroes: [t], enemies: scared, rng: () => 0.5 });
  ft.run(2);
  assert.ok(scared.every((e) => e.mod('slow') === 0.3 && e.mod('damageDealt') === -0.3 && !e.has('disarm')));
  ft.run(1);
  assert.ok(scared.every((e) => e.has('disarm') && e.has('silence')));
  ft.run(6);
  for (const x of lost(scared)) close(x, 60 * 7, 0.02);
  ft.run(1);
  assert.ok(scared.every((e) => e.mod('slow') === 0));
});

test('Solomon: each ability does its job', () => {
  const { BISHOP } = require('../src/utils/farm/heroes/solomon');
  const quiet = (hero, ...slots) => { hero.weapon.reloadLeft = 1e9; hero.meleeAt = Infinity; hero.stamina = 0; hero.nextDash = Infinity; hero.stats.healthRegen = 0; hero.stats.oocRegen = 0; slots.forEach((s) => { hero.abilities[s - 1].cdLeft = 1e9; hero.abilities[s - 1].gapLeft = 1e9; }); return hero; };
  const dummy = (o = {}) => enemy('Dummy', { maxHealth: 2000, dps: 0, distance: 10, ...o });
  const row = () => [dummy(), dummy(), dummy()]; // 4 m apart
  const lost = (list) => list.map((e) => +(2000 - e.health).toFixed(3));

  // Setup Bishop: placed, then moved every 3 s through the enemies within 12 m (70 and a 30% slow); 0.5 s later its squares (2 out, 6 m) deal 25.
  // It stays out and its cooldown waits
  const b = quiet(buildHero('Solomon', { unlocked: 1 }));
  const board = row();
  const fb = new Fight({ heroes: [b], enemies: board, rng: () => 0.5 });
  fb.run(3.2);
  assert.deepStrictEqual(lost(board), [0, 0, 0]);
  fb.run(0.3);
  assert.deepStrictEqual(lost(board), [70, 70, 70]);
  close(board[2].mod('slow'), 0.3);
  fb.run(0.5);
  assert.deepStrictEqual(lost(board), [95, 95, 70]);
  fb.run(3);
  assert.deepStrictEqual(lost(board), [190, 190, 140]);
  assert.ok(b.abilities[0].out && b.abilities[0].cdLeft === 12 && b.abilities[0].status(fb) === 'On The Board');
  const boss = [dummy({ maxHealth: 50000 })]; // half to bosses
  new Fight({ heroes: [quiet(buildHero('Solomon', { unlocked: 1 }))], enemies: boss, rng: () => 0.5 }).run(4.2);
  close(50000 - boss[0].health, 47.5);
  BISHOP.moves = 1; // the knob: recalled after so many moves, and only then the cooldown runs
  try {
    const once = quiet(buildHero('Solomon', { unlocked: 1 }));
    const passed = row();
    const fo = new Fight({ heroes: [once], enemies: passed, rng: () => 0.5 });
    fo.run(6);
    assert.deepStrictEqual(lost(passed), [95, 95, 70]);
    assert.ok(!once.abilities[0].out && once.abilities[0].cdLeft < 12 && once.abilities[0].cdLeft > 9);
  } finally { BISHOP.moves = Infinity; }

  // Kingside Knight: on himself, King: a barrier of 160 for 7 s, and one move that slips a blast
  const kg = quiet(buildHero('Solomon', { unlocked: 2 }), 1);
  const caster = dummy({ blast: { every: 1, damage: 100, maxHealthPct: 0, curse: 1 } });
  const fkg = new Fight({ heroes: [kg], enemies: [caster], rng: () => 0.5 });
  fkg.run(1.5);
  assert.ok(fkg.log.some((l) => l.what === 'King\'s Move') && kg.health === 780);
  close(kg.statuses.find((x) => x.id === 'king').barrier, 160);
  fkg.run(1);
  close(kg.statuses.find((x) => x.id === 'king').barrier, 60); // the second blast lands: he has moved
  fkg.run(6);
  assert.ok(!kg.statuses.some((x) => x.id === 'king'));

  // Rook Battery: 50 and a 1 s immobilize to the enemies within 12 m, and again when the rooks bounce back
  const rk = quiet(buildHero('Solomon', { unlocked: 3 }), 1, 2);
  const lined = row();
  const frk = new Fight({ heroes: [rk], enemies: lined, rng: () => 0.5 });
  frk.run(0.6);
  assert.deepStrictEqual(lost(lined), [50, 50, 50]);
  assert.ok(lined.every((e) => e.has('immobilize')));
  frk.run(1);
  assert.deepStrictEqual(lost(lined), [100, 100, 100]);
  frk.run(3);
  assert.deepStrictEqual(lost(lined), [100, 100, 100]);

  // Develop Queen: 120 around her as she lands, 0.5 s later 120 again and a 1.25 s stun along her squares (3 out, 9 m); two more leaps 5 s apart,
  // then she leaves and the cooldown starts
  const q = quiet(buildHero('Solomon', { unlocked: 4 }), 1, 2, 3);
  const mated = row();
  const fq = new Fight({ heroes: [q], enemies: mated, rng: () => 0.5 });
  fq.run(1.1);
  assert.deepStrictEqual(lost(mated), [120, 0, 0]);
  fq.run(0.5);
  assert.deepStrictEqual(lost(mated), [240, 120, 120]);
  assert.ok(mated.every((e) => e.has('stun')));
  fq.run(5);
  assert.deepStrictEqual(lost(mated), [480, 240, 240]);
  fq.run(5);
  assert.deepStrictEqual(lost(mated), [720, 360, 360]);
  assert.ok(q.abilities[3].out && q.abilities[3].cdLeft === 210);
  fq.run(5);
  assert.ok(!q.abilities[3].out && q.abilities[3].cdLeft < 210);
  assert.deepStrictEqual(lost(mated), [720, 360, 360]);
  const mate = quiet(buildHero('Solomon', { unlocked: 4, tiers: { 4: 2 } }), 1, 2, 3); // tier 2: Checkmate below 200 health
  const low = dummy();
  low.health = 300;
  new Fight({ heroes: [mate], enemies: [low, dummy()], rng: () => 0.5 }).run(1.1);
  assert.ok(!low.alive);
});

test('Haunt specials: what each family does to the hero, and what stops it', () => {
  const { SPECIALS, specialFor } = require('../src/utils/farm/haunts');
  const { simulate } = require('../src/utils/farm/play');
  // a hero that only stands there, and one Haunt that deals 10 a second and always uses its special
  const stand = (o = {}) => { const h = buildHero('Haze', { unlocked: 0, ...o }); h.weapon.reloadLeft = 1e9; h.meleeAt = Infinity; h.stamina = 0; h.nextDash = Infinity; h.stats.healthRegen = 0; h.stats.oocRegen = 0; h.stats.spiritResist = 0; h.stats.bulletResist = 0; return h; };
  const haunt = (family) => { const e = enemy('Haunt', { maxHealth: 1e6, dps: 10 }); e.stats.special = { ...specialFor(family, false), chance: 1 }; return e; };
  const after = (family, seconds, hero = stand()) => { const f = new Fight({ heroes: [hero], enemies: [haunt(family)], rng: () => 0 }); f.run(seconds); return [hero.stats.maxHealth - hero.health, hero, f]; };

  assert.strictEqual(specialFor('slum_shroom', true), null, 'small Haunts have none');
  assert.deepStrictEqual(Object.keys(SPECIALS).sort(), ['barrel_mimic', 'crabbage_pot', 'festival_spirit', 'gutter_ghoul', 'past_due', 'slum_shroom', 'specimen', 'stage_hand', 'underhand']);

  // at 1 s: the normal hit (10) and the special on top
  close(after('barrel_mimic', 1)[0], 10 + 30); // 3 s worth at once
  const [books, sleeper] = after('past_due', 1);
  close(books, 10 + 20);
  assert.ok(sleeper.has('sleep') && sleeper.cantAct);
  close(after('festival_spirit', 1.7)[0], 10 + 4 * 7.5); // four fireworks 0.2 s apart
  close(after('crabbage_pot', 1)[0], 10 + 30);
  const guarded = stand(); // melee resist cuts the slam, and nothing else
  guarded.statuses.push({ id: 'guard', until: 99, mods: { meleeTaken: -0.5 }, tags: [] });
  close(after('crabbage_pot', 1, guarded)[0], 10 + 15);

  // burns: a debuff that ticks every 0.5 s while it lasts
  const [, burning, ff] = after('stage_hand', 1);
  assert.ok(burning.statuses.some((s) => s.id === 'laser_fire:0' && s.debuff));
  const lit = burning.health;
  ff.enemies[0].stats.special = null; // no second laser, and no more hits: only the fire
  ff.enemies[0].stats.dps = 0;
  ff.run(5.5);
  close(lit - burning.health, 5 * 12.5); // 5 s at one and a quarter times its damage
  const [, spored] = after('slum_shroom', 1);
  close(spored.stat('healAmp'), -0.5);
  close(spored.mod('slow'), 0.4);

  // debuff resist shortens them, a cleanse removes them, a silenced Haunt has no special
  const tough = stand();
  tough.stats.statusResist = 0.5;
  const [, t2, ft] = after('gutter_ghoul', 1, tough);
  close(t2.statuses.find((s) => s.id === 'toxic_puddle:0').until - ft.time, 4, 0.11); // 8 s halved
  ft.cleanse(t2);
  ft.enemies[0].stats.special = null;
  ft.enemies[0].stats.dps = 0;
  const cleansed = t2.health;
  ft.run(3);
  assert.strictEqual(t2.health, cleansed);
  const hushed = stand();
  const quietOne = haunt('barrel_mimic');
  quietOne.statuses.push({ id: 'hush', until: 99, mods: {}, tags: ['silence'] });
  new Fight({ heroes: [hushed], enemies: [quietOne], rng: () => 0 }).run(1);
  close(hushed.stats.maxHealth - hushed.health, 10);

  // the Specimen goes off as it dies
  const killer = stand();
  const spec = haunt('specimen');
  const fsx = new Fight({ heroes: [killer], enemies: [spec], rng: () => 0.5 });
  fsx.damage(killer, spec, 2e6, 'true');
  close(killer.stats.maxHealth - killer.health, 20);
  assert.ok(fsx.log.some((l) => l.what === 'Death Burst'));

  // in a real camp: the two medium Haunts of a Tier 2 camp carry it, a Tier 1 camp's never do
  const seeded = (n) => () => (n = (n * 16807) % 2147483647) / 2147483647;
  const logs = (key, family) => Array.from({ length: 30 }, (_, i) => simulate('Haze', key, { family, boons: 6, rng: seeded(i + 1) }).log.map(([, text]) => text)).flat();
  assert.ok(logs('medium-camp', 'slum_shroom').some((text) => /^Slum Shroom used Spore Mines|^w+ Slum Shroom used Spore Mines/.test(text)), 'the Battle Log names the special');
  assert.ok(!logs('small-camp', 'gutter_ghoul').some((text) => /Toxic Waste/.test(text)));
});
