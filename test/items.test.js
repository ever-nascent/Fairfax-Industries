// Run: node --test
const test = require('node:test');
const assert = require('node:assert');
const { Fight, enemy, SPIRIT_LIFESTEAL_VS_NPC } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');
const { ITEM_POOL } = require('../src/utils/farm/levels');
const { FX, makeItems } = require('../src/utils/farm/items');
const { itemByName } = require('../src/utils/farm/stats');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
// A hero with only its gun (abilities on cooldown for good) and some items, against dummies that never hurt unless given dps.
// No melee and no dashes unless asked for (`move`): those are tested on their own.
function setup(items, { foes = 1, dps = 0, hp = 1e6, distance = 15, rng = () => 0.5, boons = 0, move = false, hero: name = 'Haze', ...kit } = {}) {
  const hero = buildHero(name, { items, boons, ...kit });
  hero.abilities.forEach((a) => { a.cdLeft = 1e9; });
  if (!move) { hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.nextSlide = Infinity; }
  const enemies = Array.from({ length: foes }, (_, i) => enemy(`Dummy ${i + 1}`, { maxHealth: hp, dps, distance }));
  return { hero, enemies, fight: new Fight({ heroes: [hero], enemies, rng }) };
}
const run = (fight, seconds) => fight.run(seconds);

test('bullet lifesteal heals from the damage the gun deals', () => {
  const plain = setup([]);
  const steal = setup(['Leech']); // 28% bullet lifesteal
  for (const s of [plain, steal]) s.hero.health = s.hero.stats.maxHealth * 0.4;
  const before = steal.hero.health;
  run(plain.fight, 5);
  run(steal.fight, 5);
  const gained = steal.hero.health - before;
  const dealt = steal.fight.dealt.get(steal.hero);
  assert.ok(gained > plain.hero.health - before + dealt * 0.1, `healed ${gained.toFixed(0)} from ${dealt.toFixed(0)} damage`);
});

test('Return Fire sends part of the bullet damage taken back at the attacker', () => {
  const { hero, enemies, fight } = setup(['Return Fire'], { dps: 100 });
  hero.weapon.reloadLeft = 1e9; // no shooting: only the reflection deals damage
  run(fight, 5);
  assert.ok(fight.log.some((l) => l.what === 'Return Fire'), 'it was used');
  assert.ok(enemies[0].health < enemies[0].stats.maxHealth, 'the attacker was hurt');
});

test('resists multiply instead of adding, and an enemy that deals spirit damage is slowed by spirit resist, not bullet resist', () => {
  const two = buildHero('Haze', { items: ['Bullet Resilience', 'Cultist Sacrifice'] }).stats.bulletResist; // 30% and 30%
  assert.ok(Math.abs(two - 0.51) < 1e-9, `30% and 30% make 51%, got ${two}`);
  const taken = (items, damageType) => {
    const hero = buildHero('Haze', { items, unlocked: 0 });
    const foe = enemy('Dummy', { maxHealth: 1e6, dps: 50, damageType });
    hero.weapon.reloadLeft = 1e9;
    hero.stats.healthRegen = 0;
    new Fight({ heroes: [hero], enemies: [foe], rng: seeded(3) }).run(2);
    return hero.stats.maxHealth - hero.health;
  };
  const plain = taken(['Extra Health'], 'spirit') ;
  assert.ok(taken(['Extra Health', 'Spirit Resilience'], 'spirit') < plain * 0.75, 'spirit resist cuts spirit damage');
  assert.ok(Math.abs(taken(['Extra Health', 'Bullet Resilience'], 'spirit') - plain) < 1, 'bullet resist does nothing against it');
  assert.ok(taken(['Extra Health', 'Bullet Resilience'], 'bullet') < plain * 0.75, 'and still cuts weapon damage');
});

test('spirit lifesteal heals from ability and item damage, not from bullets', () => {
  const { hero, enemies, fight } = setup(['Spirit Lifesteal', 'Cold Front'], { hp: 1e6 });
  hero.weapon.reloadLeft = 1e9; // no shooting: only the item deals damage
  hero.health = hero.stats.maxHealth * 0.5;
  const before = hero.health;
  run(fight, 1);
  const dealt = enemies[0].stats.maxHealth - enemies[0].health;
  assert.ok(dealt > 90, 'Cold Front hit');
  assert.ok(Math.abs(hero.health - before - dealt * hero.stats.spiritLifesteal * SPIRIT_LIFESTEAL_VS_NPC - hero.stats.healthRegen * 1) < 1, `healed ${(hero.health - before).toFixed(1)} of ${dealt.toFixed(1)} damage`);
  assert.ok(hero.stats.spiritLifesteal > 0.12);
});

test('item damage scales with spirit power, as the card says (Cold Front: 95 + 0.465 per spirit)', () => {
  const dmg = (spirit) => {
    const { hero, enemies, fight } = setup(['Cold Front']);
    hero.stats.spirit = spirit;
    hero.weapon.reloadLeft = 1e9;
    run(fight, 0.5);
    return enemies[0].stats.maxHealth - enemies[0].health;
  };
  assert.ok(Math.abs(dmg(0) - 95) < 0.5);
  assert.ok(Math.abs(dmg(100) - (95 + 46.5)) < 0.5);
});

test('reload speed: a reload buff finishes a reload sooner', () => {
  const timeToRefill = (reloadSpeed) => {
    const { hero, fight } = setup([]);
    if (reloadSpeed) fight.addStatus(hero, { id: 'fast', duration: 99, mods: { reloadSpeed } });
    hero.weapon.clip = 0;
    hero.weapon.reloadLeft = hero.stats.reload;
    while (hero.weapon.reloadLeft > 0) fight.step();
    return fight.time;
  };
  assert.ok(Math.abs(timeToRefill(0) - 2.3) < 0.2, `base reload ${timeToRefill(0)}`);
  assert.ok(timeToRefill(1) < timeToRefill(0) * 0.6);
});

test('Active Reload: a finished reload starts a fire rate and lifesteal buff, then waits out its cooldown', () => {
  const { hero, fight } = setup(['Active Reload'], { rng: () => 0 });
  const item = hero.items[0];
  hero.weapon.clip = 0;
  run(fight, 6);
  assert.ok(item.cdLeft > 0 || hero.has('x') === false);
  const { fire, steal } = (() => { const s = hero.statuses.find((x) => x.id === 'Active Reload:active'); return { fire: s?.mods.fireRate, steal: s?.mods.lifesteal }; })();
  assert.ok(fire > 0.2 && steal > 0.1, 'the buff is on after the reload');
});

test('distance items: Close Quarters up close, Long Range far away', () => {
  const hit = (items, distance) => {
    const { hero, fight, enemies } = setup(items, { distance });
    return fight.shotDamage(hero, enemies[0]);
  };
  assert.ok(hit(['Close Quarters'], 10) > hit([], 10) * 1.15);
  assert.ok(Math.abs(hit(['Close Quarters'], 25) - hit([], 25)) < 1e-9);
  assert.ok(hit(['Long Range'], 25) > hit([], 25) * 1.3);
  assert.ok(Math.abs(hit(['Long Range'], 10) - hit([], 10)) < 1e-9);
});

test('Intensifying Magazine builds damage while shooting and resets on a reload', () => {
  const { hero, fight, enemies } = setup(['Intensifying Magazine']);
  const base = fight.shotDamage(hero, enemies[0]);
  run(fight, 2.5);
  assert.ok(fight.shotDamage(hero, enemies[0]) > base * 1.35, 'ramped up');
});

test('barriers soak damage first: Grit', () => {
  const { hero, fight } = setup(['Grit'], { dps: 100 });
  hero.health = hero.stats.maxHealth * 0.6; // hurt enough for the item to want to fire
  run(fight, 1.9);
  assert.ok(hero.has('Grit:barrier') || hero.statuses.some((s) => s.barrier > 0), 'barrier up');
  const barrierLeft = hero.statuses.find((s) => s.id === 'Grit:barrier')?.barrier ?? 0;
  assert.ok(barrierLeft < 200 && barrierLeft > 0, `barrier soaked some: ${barrierLeft.toFixed(0)} left of 200`);
});

test('Cheat Death keeps the holder alive once, then waits out its cooldown', () => {
  const { hero, fight } = setup(['Cheat Death'], { dps: 1e6 });
  for (let i = 0; i < 10; i++) fight.step(); // the enemy's first hit lands after a second
  assert.ok(hero.alive && hero.health >= 1, 'survived the killing blow');
  const item = hero.items[0];
  assert.ok(item.cdLeft > 80);
  for (let i = 0; i < 60; i++) fight.step(); // 4.5 s of immunity run out
  assert.ok(!hero.alive, 'and dies when it is not ready');
});

test('debuffs: Hunter\'s Aura and Bullet Resist Shredder lower enemy bullet resist', () => {
  const aura = setup(["Hunter's Aura"], { foes: 2 });
  run(aura.fight, 0.5);
  assert.ok(aura.enemies.every((e) => e.mod('bulletResist') < 0 && e.mod('damageDealt') < 0));
  const shred = setup(['Bullet Resist Shredder', 'Mystic Shot']); // it follows spirit damage (the card): Mystic Shot's proc
  run(shred.fight, 0.5);
  assert.ok(shred.enemies[0].mod('bulletResist') <= -0.1 + 1e-9);
});

test('procs: Mystic Shot adds spirit damage once per cooldown; Ricochet hits the other enemies', () => {
  const ms = setup(['Mystic Shot']);
  const plain = setup([]);
  run(ms.fight, 7);
  run(plain.fight, 7);
  const extra = ms.fight.dealt.get(ms.hero) - plain.fight.dealt.get(plain.hero);
  assert.ok(extra > 35 && extra < 60, `one proc in 7 s: ${extra.toFixed(0)}`);
  const ric = setup(['Ricochet'], { foes: 3, hp: 2000 }); // camp-sized: bullets don't bounce off a boss
  run(ric.fight, 3);
  assert.ok(ric.enemies[1].health < ric.enemies[1].stats.maxHealth && ric.enemies[2].health < ric.enemies[2].stats.maxHealth);
});

test('Arctic Blast stuns: enemies stop hitting for its freeze', () => {
  const { hero, fight, enemies } = setup(['Arctic Blast'], { dps: 1000 });
  hero.stats.maxHealth = 1e9; hero.health = 1e9;
  hero.weapon.reloadLeft = 1e9;
  fight.step(); // the blast goes off
  assert.ok(enemies[0].has('stun'));
  const before = hero.health;
  for (let i = 0; i < 8; i++) fight.step();
  assert.strictEqual(hero.health, before, 'frozen enemies do nothing');
  for (let i = 0; i < 30; i++) fight.step(); // the slow remains after the freeze, so the next hit takes longer
  assert.ok(hero.health < before, 'and the slowed enemy eventually hits again');
});

test('Berserker, Spellslinger and Glass Cannon stack', () => {
  const { hero, fight, enemies } = setup(['Berserker'], { dps: 300 });
  hero.stats.maxHealth = 1e9; hero.health = 1e9;
  const base = fight.shotDamage(hero, enemies[0]);
  run(fight, 3);
  assert.ok(fight.shotDamage(hero, enemies[0]) > base, 'damage taken stacks weapon damage');
  const gc = setup(['Glass Cannon'], { hp: 50 });
  assert.ok(gc.hero.stats.maxHealth < buildHero('Haze').stats.maxHealth, 'Glass Cannon costs 13% max health');
});

test('Haze\'s ammo grows with spirit power (+0.5 rounds each)', () => {
  const clip = (items) => buildHero('Haze', { items }).stats.clip;
  assert.strictEqual(clip(['Extra Spirit']), clip([]) + 5);
});

test('every item in the shop builds, and a fight with it runs without errors', () => {
  const unknownKeys = [];
  for (const name of ITEM_POOL) {
    const card = itemByName(name);
    const hero = buildHero('Haze', { items: [name], boons: 10 });
    const fight = new Fight({ heroes: [hero], enemies: [enemy('A', { maxHealth: 5000, dps: 40 }), enemy('B', { maxHealth: 5000, dps: 40 })], rng: seeded(7) });
    fight.run(30);
    assert.ok(Number.isFinite(hero.health) && hero.health <= hero.stats.maxHealth + 1e-6, `${name}: health ${hero.health}`);
    for (const it of hero.items) {
      for (const key of Object.keys(it.entries)) if (Number.isNaN(it.value(key))) unknownKeys.push(`${name}.${key}`);
    }
    assert.strictEqual(hero.items.length, FX[name] ? 1 : 0, name);
    assert.ok(card);
  }
  assert.deepStrictEqual(unknownKeys, []);
});

test('items work together: a full kit beats the same hero with none', () => {
  const kit = ['Titanic Magazine', 'Rapid Rounds', 'Extra Health', 'Bullet Lifesteal', 'Cold Front', 'Extra Spirit'];
  const fightWith = (items) => {
    const hero = buildHero('Haze', { items, boons: 15 });
    hero.abilities[2].on = () => {}; // without Fixation: it alone clears these dummies, and the items are what's tested
    const f = new Fight({ heroes: [hero], enemies: [enemy('A', { maxHealth: 3000, dps: 18 }), enemy('B', { maxHealth: 3000, dps: 18 })], rng: seeded(3) });
    const out = f.run(120);
    return { ...out, time: f.time, health: hero.health };
  };
  const bare = fightWith([]);
  const full = fightWith(kit);
  assert.ok(full.won && !bare.won, 'the kitted hero clears both dummies, the bare one is worn down first');
  assert.ok(full.health > bare.health);
});

test('Infinite Rounds (legendary): never reloads', () => {
  const reloads = (items) => {
    const hero = buildHero('Haze', { items, boons: 20 });
    const f = new Fight({ heroes: [hero], enemies: [enemy('Boss', { maxHealth: 1e6, dps: 0, distance: 20 })], rng: () => 0.5 });
    let n = 0;
    const emit = f.emit.bind(f);
    f.emit = (event, p) => { if (event === 'reloadStart') n++; return emit(event, p); };
    f.run(30);
    return n;
  };
  assert.ok(reloads([]) > 0);
  assert.strictEqual(reloads(['Infinite Rounds']), 0);
});

test('"vs. NPCs" items do nothing against a rival hero: Monster Rounds; Restorative Shot heals its hero amount from one', () => {
  const duel = (items) => {
    const hero = buildHero('Haze', { items });
    const rival = buildHero('Abrams', { items });
    return { hero, rival, fight: new Fight({ heroes: [hero], enemies: [rival], rng: () => 0.5 }) };
  };
  const plain = duel([]);
  const monster = duel(['Monster Rounds']);
  assert.strictEqual(monster.fight.shotDamage(monster.hero, monster.rival), plain.fight.shotDamage(plain.hero, plain.rival), 'no extra weapon damage on a hero');
  const npc = setup(['Monster Rounds']);
  assert.ok(npc.fight.shotDamage(npc.hero, npc.enemies[0]) > setup([]).fight.shotDamage(setup([]).hero, setup([]).enemies[0]), 'extra weapon damage on an NPC');
  const taken = ({ fight, hero, rival }) => { const before = hero.health; fight.damage(rival, hero, 100, 'bullet'); return before - hero.health; };
  assert.ok(Math.abs(taken(monster) - taken(plain)) < 1e-9, 'no bullet resist against a hero');

  const shot = duel(['Restorative Shot']);
  shot.hero.health = 100;
  shot.fight.emit('bulletHit', { source: shot.hero, target: shot.rival, amount: 1, opts: {} });
  assert.strictEqual(shot.hero.health, 150);
});

test('item audit batch 2: Slowing Bullets builds like the wiki table, Stalker procs on a melee, Kinetic Dash rounds refresh instead of adding up', () => {
  const slow = setup(['Slowing Bullets']);
  const hit = () => slow.fight.emit('bulletHit', { source: slow.hero, target: slow.enemies[0], amount: 1, dealt: 1, opts: {} });
  const slowed = () => slow.enemies[0].statuses.some((st) => st.id === 'Slowing Bullets:slow');
  for (let i = 0; i < 7; i++) hit();
  assert.ok(!slowed(), 'not after 7 bullets');
  hit();
  assert.ok(slowed(), 'Haze: 13.6% a bullet (the wiki), so the 8th bullet slows');

  const stalk = setup(['Stalker'], { distance: 5 });
  stalk.fight.emit('melee', { source: stalk.hero, target: stalk.enemies[0], amount: 50, dealt: 50 });
  assert.ok(stalk.enemies[0].statuses.some((st) => st.id === 'Stalker:wound'), 'a melee at close range wounds');

  const dash = setup(['Kinetic Dash']);
  const clip = dash.hero.weapon.clip;
  dash.fight.emit('dash', { source: dash.hero });
  dash.fight.emit('dash', { source: dash.hero });
  assert.strictEqual(dash.hero.weapon.clip, clip + 6);
});
