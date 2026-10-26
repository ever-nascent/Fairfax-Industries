// Run: node --test
// The item audit (server-plan.md "Item audit"): each item's effect, checked with the wiki's exact numbers (his ask, Oct 22: "make sure that their
// exact effects are taking place"). One test per item, grouped by audit batch.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-')); // never the live data/
const test = require('node:test');
const assert = require('node:assert');
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');

// A Haze at level 0 (no spirit power, no boons) with only `items`, abilities and moves off, against dummies that never hurt.
function setup(items, { foes = 1, hp = 1e6, distance = 15, rng = () => 0.5, hero: name = 'Haze', ...kit } = {}) {
  const hero = buildHero(name, { items, ...kit });
  hero.abilities.forEach((a) => { a.cdLeft = 1e9; });
  hero.meleeAt = Infinity; hero.stamina = 0; hero.stats.stamina = 0; hero.nextSlide = Infinity;
  const enemies = Array.from({ length: foes }, (_, i) => enemy(`Dummy ${i + 1}`, { maxHealth: hp, dps: 0, distance, souls: 100 }));
  const fight = new Fight({ heroes: [hero], enemies, rng });
  const it = (n = items[0]) => hero.items.find((i) => i.name === n);
  const hit = (target = enemies[0], amount = 10) => fight.emit('bulletHit', { source: hero, target, amount, dealt: amount, type: 'bullet', opts: {} });
  return { hero, enemies, fight, it, hit };
}
const status = (unit, id) => unit.statuses.find((s) => s.id === id);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} vs ${b}`);

// ===== Batch 3: Weapon tier 3 =====
test('Cultist Sacrifice: eats an NPC for 170% bonus souls, then +10% weapon damage, +50 health, +12% ability range for 160 s', () => {
  const { hero, enemies, fight, it } = setup(['Cultist Sacrifice'], { foes: 2, hp: 500 });
  const health = hero.stats.maxHealth;
  it().cast(fight);
  assert.strictEqual(enemies.filter((e) => e.alive).length, 1, 'one enemy eaten');
  near(fight.bonusSouls, 170);
  const buff = status(hero, 'Cultist Sacrifice:cult');
  near(buff.mods.weaponDamage, 0.1); near(buff.mods.rangeMult, 0.12); near(buff.until - fight.time, 160);
  near(hero.stats.maxHealth - health, 50);
});

test('Tesla Bullets: a 15% chance to shock for 33 spirit damage, jumping to enemies within 8 m (4 in all), at most every 0.2 s', () => {
  const lucky = setup(['Tesla Bullets'], { foes: 5, rng: () => 0.1 });
  lucky.enemies.forEach((e) => { e.offset = 0; });
  lucky.hit();
  assert.deepStrictEqual(lucky.enemies.map((e) => 1e6 - e.health), [33, 33, 33, 33, 0]);
  lucky.hit();
  assert.ok(1e6 - lucky.enemies[0].health < 34, 'no second shock within 0.2 s'); // (Haze's Fixation adds a sliver of its own)
  const unlucky = setup(['Tesla Bullets'], { rng: () => 0.2 });
  unlucky.hit();
  near(unlucky.enemies[0].health, 1e6, 'no shock at 20%');
});

test('Hollow Point: above 65% health, +35% weapon damage and bullets take 10% bullet resist for 8 s', () => {
  const { hero, enemies, fight, it, hit } = setup(['Hollow Point']);
  assert.deepStrictEqual(it().dynamicMods(fight), { weaponDamage: 0.35 });
  hit();
  const shred = status(enemies[0], 'Hollow Point:shred');
  near(shred.mods.bulletResist, -0.1); near(shred.until - fight.time, 8);
  hero.health = hero.stats.maxHealth * 0.6;
  assert.strictEqual(it().dynamicMods(fight), null);
});

test('Weighted Shots: Haze builds 13.6% a bullet (the wiki table): the 8th bullet slows 24% for 3.5 s', () => {
  const { enemies, fight, hit } = setup(['Weighted Shots']);
  for (let i = 0; i < 7; i++) hit();
  assert.ok(!status(enemies[0], 'Weighted Shots:slow'));
  hit();
  const slow = status(enemies[0], 'Weighted Shots:slow');
  near(slow.mods.slow, 0.24); near(slow.until - fight.time, 3.5);
});

test('Heroic Aura: +17% bullet resist always; the active gives +26% fire rate and +2.25 m/s for 7 s', () => {
  const plain = setup([]);
  const { hero, fight, it } = setup(['Heroic Aura']);
  near(1 - (1 - hero.stats.bulletResist) / (1 - plain.hero.stats.bulletResist), 0.17);
  it().cast(fight);
  const buff = status(hero, 'Heroic Aura:aura');
  near(buff.mods.fireRate, 0.26); near(buff.mods.moveSpeed, 2.25); near(buff.until - fight.time, 7);
});

test('Berserker: +7% weapon damage per 120 damage taken (before resists), up to 10, none while the holder cannot be hurt', () => {
  const { hero, enemies, fight, it } = setup(['Berserker']);
  const take = (amount) => fight.emit('damage', { source: enemies[0], target: hero, amount, dealt: amount / 2, type: 'bullet', opts: {} });
  take(250);
  near(it().weaponBonus(fight, enemies[0]), 0.14);
  for (let i = 0; i < 20; i++) take(120);
  near(it().weaponBonus(fight, enemies[0]), 0.7, 'capped at 10 stacks');
  const shifted = setup(['Berserker']);
  shifted.hero.statuses.push({ id: 'void', until: 99, mods: { damageTaken: -1 } });
  shifted.fight.emit('damage', { source: shifted.enemies[0], target: shifted.hero, amount: 500, dealt: 0, type: 'bullet', opts: {} });
  near(shifted.it().weaponBonus(shifted.fight, shifted.enemies[0]), 0);
});

test('Sharpshooter: +60% weapon damage from 15 m on, nothing closer', () => {
  const far = setup(['Sharpshooter'], { distance: 20 });
  near(far.it().weaponBonus(far.fight, far.enemies[0]), 0.6);
  const close = setup(['Sharpshooter'], { distance: 10 });
  near(close.it().weaponBonus(close.fight, close.enemies[0]), 0);
});

test('Headhunter: a headshot adds 75 damage, heals 4% of max health and gives +1.75 m/s for 3 s, every 8 s', () => {
  const { hero, enemies, fight, it, hit } = setup(['Headhunter'], { rng: () => 0.1 });
  hero.health = 100;
  hit();
  near(1e6 - enemies[0].health, 75);
  near(hero.health, 100 + 0.04 * hero.stats.maxHealth);
  const speed = status(hero, 'Headhunter:speed');
  near(speed.mods.moveSpeed, 1.75); near(speed.until - fight.time, 3);
  near(it().cdLeft, 8);
});

test('Spirit Rend: bullets take 8% spirit resist for 8 s; a headshot every 2 s adds -7% more, up to 4 stacks', () => {
  const { enemies, fight, hit } = setup(['Spirit Rend'], { rng: () => 0.1 });
  for (let i = 0; i < 6; i++) { hit(); fight.time += 2; fight.heroes[0].items[0].procLeft = 0; }
  near(status(enemies[0], 'Spirit Rend:spirit').mods.spiritResist, -0.08);
  near(status(enemies[0], 'Spirit Rend:spirit').mods.spiritLifestealOn, 0.1);
  near(status(enemies[0], 'Spirit Rend:rend').mods.spiritResist, -0.28);
  const body = setup(['Spirit Rend'], { rng: () => 0.9 });
  body.hit();
  assert.ok(!status(body.enemies[0], 'Spirit Rend:rend'), 'a body shot adds no stack');
});

test('Point Blank: within 15 m, +50% weapon damage and bullets slow 20% for 2 s', () => {
  const { enemies, fight, it, hit } = setup(['Point Blank'], { distance: 10 });
  near(it().weaponBonus(fight, enemies[0]), 0.5);
  hit();
  const slow = status(enemies[0], 'Point Blank:slow');
  near(slow.mods.slow, 0.2); near(slow.until - fight.time, 2);
  const far = setup(['Point Blank'], { distance: 20 });
  near(far.it().weaponBonus(far.fight, far.enemies[0]), 0);
});

test('Toxic Bullets: Haze builds 7.4% a bullet; the 14th bleeds 1.9% of max health a second for 4 s (half on a camp creep), 35% less healing', () => {
  const { enemies, fight, it, hit } = setup(['Toxic Bullets'], { hp: 2000 }); // a camp creep, not a boss
  for (let i = 0; i < 13; i++) hit();
  assert.strictEqual(it().dots.length, 0);
  hit();
  const [dot] = it().dots;
  near(dot.perSecond, 0.019 * 2000 * 0.5); near(dot.until - fight.time, 4);
  near(status(enemies[0], 'Toxic Bullets:heal').mods.healAmp, -0.35);
});

test("Hunter's Aura: enemies within 15 m lose 10% bullet resist and fire 15% slower; doubled on a lone enemy", () => {
  const two = setup(["Hunter's Aura"], { foes: 2 });
  two.enemies.forEach((e) => { e.offset = 0; });
  two.it().tick(two.fight, 0.05);
  near(status(two.enemies[0], "Hunter's Aura:aura").mods.bulletResist, -0.1);
  near(status(two.enemies[0], "Hunter's Aura:aura").mods.damageDealt, -0.15);
  const one = setup(["Hunter's Aura"]);
  one.it().tick(one.fight, 0.05);
  near(status(one.enemies[0], "Hunter's Aura:aura").mods.bulletResist, -0.2);
  near(status(one.enemies[0], "Hunter's Aura:aura").mods.damageDealt, -0.3);
});

test('Shadow Weave: invisible for 13 s; attacking out of it gives +25% fire rate, +25 spirit power and +25% melee damage for 5 s', () => {
  const { hero, enemies, fight, it } = setup(['Shadow Weave']);
  it().cast(fight);
  assert.ok(hero.has('invisible'));
  near(status(hero, 'Shadow Weave:stealth').until - fight.time, 13);
  fight.damage(hero, enemies[0], 10, 'bullet');
  assert.ok(!hero.has('invisible'), 'attacking ends it');
  const ambush = status(hero, 'Shadow Weave:ambush');
  near(ambush.mods.fireRate, 0.25); near(ambush.mods.spirit, 25); near(ambush.mods.meleeDamage, 0.25); near(ambush.until - fight.time, 5);
});

test('Alchemical Fire: 45 spirit damage a second rising 7 a 0.5 s tick (all + spirit scaling) to 95, for 5 s; half on NPCs; bullet resist -7%', () => {
  const { enemies, fight, it } = setup(['Alchemical Fire'], { distance: 5 });
  const at = (t) => { // damage per second at time t after the throw
    fight.time = t;
    const before = enemies[0].health;
    it().tick(fight, 1);
    return before - enemies[0].health;
  };
  it().cast(fight);
  const spirit = 10; // its own +10 spirit power
  near(at(0), (45 + 0.2 * spirit) * 0.5);
  near(at(1), (45 + 0.2 * spirit + 2 * (7 + 0.04 * spirit)) * 0.5);
  near(at(4), (95 + 0.4 * spirit) * 0.5, 'its max by about 3.5 s');
  near(status(enemies[0], 'Alchemical Fire:shred').mods.bulletResist, -0.07 - 0.00055 * spirit);
  near(at(5), 0, 'over after 5 s');
});

test('Blood Tribute: while on, -50 health a second (never below 1) for +35% fire rate, +35% debuff resist and +2 m/s', () => {
  const { hero, fight, it } = setup(['Blood Tribute']);
  const full = hero.health;
  it().tick(fight, 1);
  near(full - hero.health, 50);
  assert.deepStrictEqual(it().dynamicMods(fight), { fireRate: 0.35, statusResist: 0.35, moveSpeed: 2 });
  hero.health = 30;
  it().on_ = true;
  it().tick(fight, 1);
  assert.ok(hero.health >= 1);
});

test('Burst Fire: a bullet hit gives +32% fire rate and +1.25 m/s for 4.5 s, every 9 s', () => {
  const { hero, fight, it, hit } = setup(['Burst Fire']);
  hit();
  const buff = status(hero, 'Burst Fire:burst');
  near(buff.mods.fireRate, 0.32); near(buff.mods.moveSpeed, 1.25); near(buff.until - fight.time, 4.5);
  near(it().cdLeft, 9);
});

test('Escalating Resilience: +2% bullet resist a hit for 24 s, at most 30%', () => {
  const { fight, it, hit } = setup(['Escalating Resilience']);
  hit();
  near(it().dynamicMods(fight).bulletResist, 0.02);
  for (let i = 0; i < 30; i++) hit();
  near(it().dynamicMods(fight).bulletResist, 0.3);
});

test('Express Shot: the next shot fires again at 125% damage, using 1 more round, every 8 s', () => {
  const { hero, enemies, it, hit } = setup(['Express Shot']);
  const clip = hero.weapon.clip;
  hit(enemies[0], 40);
  near(1e6 - enemies[0].health, 50);
  assert.strictEqual(hero.weapon.clip, clip - 1);
  near(it().cdLeft, 8);
});

test('Ballistic Enchantment: the imbued ability gives +5% weapon damage per NPC hit (up to 8) and +20% per rival hero, for 20 s', () => {
  const { hero, enemies, fight, it } = setup(['Ballistic Enchantment'], { foes: 10 });
  const ability = it().imbued;
  for (const e of enemies) fight.emit('damage', { source: hero, target: e, amount: 10, dealt: 10, type: 'spirit', opts: { ability } });
  const buff = status(hero, 'Ballistic Enchantment:ballistic');
  near(buff.mods.weaponDamage, 0.4); near(buff.until - fight.time, 20);
  const rival = buildHero('Abrams', {});
  rival.team = 'hero';
  fight.emit('damage', { source: hero, target: rival, amount: 10, dealt: 10, type: 'spirit', opts: { ability } });
  near(status(hero, 'Ballistic Enchantment:ballistic').mods.weaponDamage, 0.6);
});

// ===== Batch 4: Weapon tier 4 (Silencer is not sold here) =====
test('Capacitor: a 20% chance to shock for 43 spirit damage, 6 enemies within 10 m; the active hits for 100 and slows 60% for 3 s', () => {
  const { enemies, fight, it, hit } = setup(['Capacitor'], { foes: 7, rng: () => 0.1 });
  enemies.forEach((e) => { e.offset = 0; });
  hit();
  assert.deepStrictEqual(enemies.map((e) => Math.round(1e6 - e.health)), [43, 43, 43, 43, 43, 43, 0]);
  it().cast(fight);
  near(1e6 - enemies[0].health, 143);
  const slow = status(enemies[0], 'Capacitor:slow');
  near(slow.mods.slow, 0.6); near(slow.until - fight.time, 3);
});

test('Frenzy: below 50% health, +4 m/s, +40% fire rate and +40% debuff resist for 10 s, every 16 s', () => {
  const { hero, fight, it } = setup(['Frenzy']);
  it().tick(fight, 0.05);
  assert.ok(!status(hero, 'Frenzy:fervor'), 'nothing above half health');
  hero.health = hero.stats.maxHealth * 0.4;
  it().tick(fight, 0.05);
  const buff = status(hero, 'Frenzy:fervor');
  near(buff.mods.moveSpeed, 4); near(buff.mods.fireRate, 0.4); near(buff.mods.statusResist, 0.4); near(buff.until - fight.time, 10);
  near(it().cdLeft, 16);
});

test('Crippling Headshot: a headshot takes 16% bullet and spirit resist and 35% healing for 12 s', () => {
  const { enemies, fight, hit } = setup(['Crippling Headshot'], { rng: () => 0.1 });
  hit();
  const shred = status(enemies[0], 'Crippling Headshot:shred');
  near(shred.mods.bulletResist, -0.16); near(shred.mods.spiritResist, -0.16); near(shred.mods.healAmp, -0.35); near(shred.until - fight.time, 12);
});

test('Lucky Shot: 25% of bullets deal 100% bonus weapon damage, which cannot be evaded', () => {
  const lucky = setup(['Lucky Shot'], { rng: () => 0.2 });
  lucky.enemies[0].statuses.push({ id: 'dodgy', until: 99, mods: { evasion: 0.5 } });
  lucky.hit(lucky.enemies[0], 40);
  near(1e6 - lucky.enemies[0].health, 40);
  const not = setup(['Lucky Shot'], { rng: () => 0.3 });
  not.hit(not.enemies[0], 40);
  near(not.enemies[0].health, 1e6);
});

test('Ricochet: bullets bounce to 2 enemies within 13 m for 65%; a bounce never headshots or bounces off a boss', () => {
  const { enemies, hit } = setup(['Ricochet', 'Weakening Headshot'], { foes: 4, hp: 2000, rng: () => 0.1 });
  enemies.forEach((e) => { e.offset = 0; });
  hit(enemies[0], 100);
  assert.deepStrictEqual(enemies.map((e) => Math.round(2000 - e.health)), [0, 65, 65, 0]); // (the first hit was only an event, no damage)
  assert.ok(status(enemies[0], 'Weakening Headshot:shred') && !status(enemies[1], 'Weakening Headshot:shred'), 'only the real bullet headshots');
  const boss = setup(['Ricochet'], { foes: 2, hp: 1e6 });
  boss.enemies.forEach((e) => { e.offset = 0; e.stats.maxHealth = 20000; });
  boss.hit(boss.enemies[0], 100);
  near(boss.enemies[1].health, 1e6, 'no bounce off an objective');
});

test('Spiritual Overflow: Haze builds 8.8% a bullet (the wiki table): the 12th gives +25% fire rate, +30 spirit power, +10% spirit lifesteal for 15 s; no build-up meanwhile', () => {
  const { hero, fight, it, hit } = setup(['Spiritual Overflow']);
  for (let i = 0; i < 11; i++) hit();
  assert.ok(!status(hero, 'Spiritual Overflow:overflow'));
  hit();
  const buff = status(hero, 'Spiritual Overflow:overflow');
  near(buff.mods.fireRate, 0.25); near(buff.mods.spirit, 30); near(buff.mods.spiritLifesteal, 0.1); near(buff.until - fight.time, 15 * 1.13, '15 s, longer by its own +13% ability duration');
  for (let i = 0; i < 20; i++) hit();
  near(it().bars.get(fight.enemies[0]) ?? 0, 0, 'nothing builds while it runs');
});

test('Glass Cannon: +80% weapon damage, -13% max health; each kill +7% fire rate, up to 8', () => {
  const plain = setup([]);
  const { hero, enemies, fight, it } = setup(['Glass Cannon']);
  near(hero.stats.weaponDamageMult - plain.hero.stats.weaponDamageMult, 0.8);
  near(hero.stats.maxHealth / plain.hero.stats.maxHealth, 0.87);
  for (let i = 0; i < 10; i++) fight.emit('kill', { source: hero, target: enemies[0] });
  near(it().dynamicMods(fight).fireRate, 0.56);
});

test('Crushing Fists: a heavy melee adds 2 stacks of -5% bullet resist for 8 s; at 6 stacks the enemy is stunned 0.75 s', () => {
  const { hero, enemies, fight } = setup(['Crushing Fists']);
  const melee = () => fight.emit('melee', { source: hero, target: enemies[0], amount: 50, dealt: 50 });
  melee();
  near(status(enemies[0], 'Crushing Fists:crush').mods.bulletResist, -0.1);
  melee();
  near(status(enemies[0], 'Crushing Fists:crush').mods.bulletResist, -0.2);
  near(status(enemies[0], 'Crushing Fists:crush').until - fight.time, 8);
  melee();
  const stun = status(enemies[0], 'Crushing Fists:stun');
  assert.ok(stun, 'stunned at 6 stacks'); near(stun.until - fight.time, 0.75);
});

test('Armor Piercer: 55% of bullets ignore bullet resist, evasion and barriers, and pierce to the enemy behind', () => {
  const { hero, enemies, fight } = setup(['Armor Piercer'], { foes: 2, rng: () => 0.5 });
  const opts = {};
  for (const [k, v] of Object.entries(hero.items[0].shotOpts(fight, enemies[0]))) opts[k] ||= v;
  assert.deepStrictEqual(opts, { ignoreBulletResist: true, unavoidable: true, pierce: true });
  enemies[0].stats.bulletResist = 0.5;
  enemies[0].statuses.push({ id: 'shield', until: 99, barrier: 1000, mods: { evasion: 1 } });
  fight.damage(hero, enemies[0], 100, 'bullet', opts);
  near(1e6 - enemies[0].health, 100, 'full damage through resist, evasion and the barrier');
  near(1e6 - enemies[1].health, 100, 'and the enemy behind');
  const miss = setup(['Armor Piercer'], { rng: () => 0.6 });
  assert.strictEqual(miss.it().shotOpts(miss.fight, miss.enemies[0]).pierce, false);
});

test('Spellslinger: each cast in a fight adds a stack (up to 6, 18 s, each refreshing): +11% fire rate and -10% reload time a stack', () => {
  const { hero, fight, it } = setup(['Spellslinger']);
  for (let i = 0; i < 8; i++) fight.emit('cast', { source: hero });
  const mods = it().dynamicMods(fight);
  near(mods.fireRate, 0.66); near(1 / (1 + mods.reloadSpeed), 0.4, 'reload time at 40%');
  near(it().until - fight.time, 18);
});

// ===== Asked about by him (Oct 22); the full Spirit tier 2 check comes in its batch =====
test('Quicksilver Reload: casting the imbued ability when charged (18 s) reloads, +10% fire rate for a fixed 12 s, +44 spirit damage on its first hit', () => {
  const { hero, enemies, fight, it } = setup(['Quicksilver Reload', 'Superior Duration']);
  const ability = it().imbued;
  hero.weapon.clip = 0;
  fight.emit('cast', { source: hero, ability });
  assert.strictEqual(hero.weapon.clip, hero.stats.clip, 'reloaded');
  const buff = status(hero, 'Quicksilver Reload:quick');
  near(buff.mods.fireRate, 0.1); near(buff.until - fight.time, 12, 'not stretched by Superior Duration');
  near(it().cdLeft, 18);
  const strike = () => fight.emit('damage', { source: hero, target: enemies[0], amount: 10, dealt: 10, type: 'spirit', opts: { ability } });
  strike(); strike();
  near(1e6 - enemies[0].health, 44, 'once, on the first hit');
  fight.emit('cast', { source: hero, ability });
  strike();
  near(1e6 - enemies[0].health, 44, 'a cast while it charges adds nothing');
});

test('Lucky Shot works in a real fight: its bonus adds about 25% to the gun damage', () => {
  const { hero, fight } = setup(['Lucky Shot'], { distance: 10, rng: ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(7) });
  let shots = 0;
  let bonus = 0;
  const deal = fight.damage.bind(fight);
  fight.damage = (src, t, a, type, o = {}) => {
    const d = deal(src, t, a, type, o);
    if (src === hero && type === 'bullet') { if (o.noEvade) bonus += d; else if (o.events !== false) shots += d; }
    return d;
  };
  fight.run(30);
  assert.ok(bonus / shots > 0.18 && bonus / shots < 0.32, `+${(100 * bonus / shots).toFixed(0)}%`);
});

// ===== His calls, Oct 22: Silencer back in the shop, Glass Cannon's stacks kept until death =====
test('Silencer: every bullet cuts the enemy\'s spirit damage 25% for 6 s; Haze builds 9.1% a bullet (the wiki table): the 11th silences 2.5 s, then 10 s immune', () => {
  const { enemies, fight, hit } = setup(['Silencer']);
  hit();
  const cut = status(enemies[0], 'Silencer:suppress');
  near(cut.mods.spiritDealt, -0.25); near(cut.until - fight.time, 6);
  for (let i = 0; i < 9; i++) hit();
  assert.ok(!enemies[0].has('silence'), 'not after 10 bullets');
  hit();
  near(status(enemies[0], 'Silencer:silence').until - fight.time, 2.5);
  enemies[0].statuses = enemies[0].statuses.filter((s) => s.id !== 'Silencer:silence');
  fight.time += 12;
  for (let i = 0; i < 11; i++) hit();
  assert.ok(!enemies[0].has('silence'), 'still immune 12 s on (2.5 + 10)');
  fight.time += 1;
  for (let i = 0; i < 11; i++) hit();
  assert.ok(enemies[0].has('silence'), 'built up again once the immunity ends');
  const { ITEM_POOL } = require('../src/utils/farm/levels');
  assert.ok(Object.values(ITEM_POOL).flat().includes('Silencer'), 'sold in the shop');
});

test('Glass Cannon: kill stacks carry into the next fight; a death (even one a Rejuv gets up from) loses them all', () => {
  const { hero, enemies, fight, it } = setup(['Glass Cannon'], { kept: { 'Glass Cannon': 3 } });
  near(it().dynamicMods(fight).fireRate, 0.21, 'starts with the 3 it brought');
  fight.emit('kill', { source: hero, target: enemies[0] });
  assert.strictEqual(it().kills, 4);
  hero.rejuvs = 1;
  fight.damage(enemies[0], hero, 1e9, 'true');
  assert.strictEqual(it().kills, 0, 'died and got back up: none left');
});

test('Glass Cannon and Trophy Collector on a real trip: the stacks are saved on the hero, and selling an item drops its own', async () => {
  const { chooseHero, updateFarmUser, getFarmUser, play, setCooldowns, sellItem } = require('../src/utils/farm/play');
  const id = 'glass1';
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => { r.earned = 1e6; r.items.weapon = ['Glass Cannon']; r.items.vitality = ['Trophy Collector']; r.kept = { 'Glass Cannon': 2, 'Trophy Collector': 5 }; });
  setCooldowns(false);
  try {
    const { run } = await play(id, 'small-camp', { rng: ((x) => () => (x = (x * 16807) % 2147483647) / 2147483647)(5) });
    assert.ok(run.won, 'a level 35 Haze wins a small camp');
    const glass = run.kept['Glass Cannon'];
    const trophies = run.kept['Trophy Collector'];
    assert.ok(glass > 2 && glass <= 8, `2 + its kills: ${glass}`);
    assert.ok(trophies > 5 && trophies <= 16, `5 + its kills: ${trophies}`);
    assert.deepStrictEqual((await getFarmUser(id)).kept, run.kept, 'saved');
    await sellItem(id, 'Glass Cannon');
    assert.deepStrictEqual((await getFarmUser(id)).kept, { 'Trophy Collector': trophies }, 'selling drops that item\'s');
  } finally { setCooldowns(true); }
});

// ===== Batch 5: Vitality tier 1 =====
test('Melee Lifesteal: +12% melee damage; the next melee heals 100 (30% of it off a non-hero, all of it off a rival hero), every 8 s', () => {
  const plain = setup([]);
  const { hero, enemies, fight, it } = setup(['Melee Lifesteal']);
  near(hero.stats.meleeDamage - plain.hero.stats.meleeDamage, 0.12);
  hero.health = 100;
  fight.emit('melee', { source: hero, target: enemies[0], amount: 50, dealt: 50 });
  near(hero.health, 130);
  near(it().cdLeft, 8);
  const rival = buildHero('Abrams', {});
  it().cdLeft = 0;
  fight.emit('melee', { source: hero, target: rival, amount: 50, dealt: 50 });
  near(hero.health, 230);
});

test('Rebuttal: +75 health; parries the front enemy\'s hit every 2.75 s (4.5 - 1.75): heals it, sends it back, +30% damage for 6 s', () => {
  const plain = setup([]);
  const { hero, enemies, fight, it } = setup(['Rebuttal']);
  near(hero.stats.maxHealth - plain.hero.stats.maxHealth, 75);
  hero.health = 100;
  fight.damage(enemies[0], hero, 40, 'bullet', { attack: true });
  near(hero.health, 140, 'no damage taken, healed the 40');
  near(1e6 - enemies[0].health, 40, 'sent back');
  const buff = status(hero, 'Rebuttal:rebuttal');
  near(buff.mods.damageDealt, 0.3); near(buff.until - fight.time, 6);
  near(it().cdLeft, 2.75);
  const parried = status(enemies[0], 'Rebuttal:parried'); // the parry itself (his call, Oct 22)
  assert.ok(enemies[0].has('stun')); near(parried.until - fight.time, 2.75); near(parried.mods.damageTaken, 0.25);
  for (const name of ['Walker', 'Mid-Boss', 'Shrine', 'Second Shrine', 'Patron', 'Weakened Patron']) { // his call, Oct 22
    const boss = setup(['Rebuttal']);
    boss.enemies[0].name = name;
    boss.fight.damage(boss.enemies[0], boss.hero, 40, 'bullet', { attack: true });
    assert.ok(!status(boss.enemies[0], 'Rebuttal:parried') && boss.it().cdLeft === 0, `${name} cannot be parried`);
  }
});

test('Extra Health +210, Sprint Boots +2 m/s and +2 out-of-combat regen, Extra Stamina +1 and +12% recovery, Extra Regen +2.5 and +1.5', () => {
  const { hero: plain } = setup([]);
  const sheet = (items) => setup(items).hero.stats;
  near(sheet(['Extra Health']).maxHealth - plain.stats.maxHealth, 210);
  near(sheet(['Sprint Boots']).moveSpeed - plain.stats.moveSpeed, 2); near(sheet(['Sprint Boots']).oocRegen, 2);
  near(buildHero('Haze', { items: ['Extra Stamina'] }).stats.stamina - buildHero('Haze').stats.stamina, 1); near(sheet(['Extra Stamina']).staminaCdr, 0.12);
  near(sheet(['Extra Regen']).healthRegen - plain.stats.healthRegen, 2.5); near(sheet(['Extra Regen']).oocRegen, 1.5);
});

test('Grit: +1 out-of-combat regen; a 200 barrier for 4 s, every 60 s', () => {
  const { hero, fight, it } = setup(['Grit']);
  near(hero.stats.oocRegen, 1);
  it().cast(fight);
  const barrier = status(hero, 'Grit:barrier');
  near(barrier.barrier, 200); near(barrier.until - fight.time, 4);
  near(it().cooldown, 60);
});

test('Healing Rite: 300 health over 20 s and +2 m/s; damage from a boss or a rival hero ends it, a camp creep\'s does not', () => {
  const { hero, enemies, fight, it } = setup(['Healing Rite'], { hp: 2000 });
  hero.health = 100;
  it().cast(fight);
  near(status(hero, 'Healing Rite:speed').mods.moveSpeed, 2); near(status(hero, 'Healing Rite:speed').until - fight.time, 20);
  const regen = status(hero, 'Healing Rite:regen');
  near(regen.regen * 20, 300);
  fight.damage(enemies[0], hero, 1, 'bullet');
  assert.ok(status(hero, 'Healing Rite:regen'), 'a creep\'s hit leaves it');
  const rival = buildHero('Abrams', {});
  fight.damage(rival, hero, 1, 'bullet');
  assert.ok(!status(hero, 'Healing Rite:regen'), 'a rival hero\'s hit ends it');
});

// ===== Batch 6: Vitality tier 2 =====
const sheet = (items) => buildHero('Haze', { items }).stats;
const BASE = buildHero('Haze').stats;

test('Bullet Lifesteal: +13% lifesteal, +90 health, +6% weapon damage; lifesteals stack multiplicatively (the wiki)', () => {
  const s = sheet(['Bullet Lifesteal']);
  near(s.lifesteal, 0.13); near(s.maxHealth - BASE.maxHealth, 90); near(s.weaponDamageMult - BASE.weaponDamageMult, 0.06);
  near(sheet(['Bullet Lifesteal', 'Leech']).lifesteal, 1 - 0.87 * (1 - sheet(['Leech']).lifesteal));
});

test('lifesteal heals in full off a rival hero; off an NPC bullet lifesteal works at 60%, spirit at 40% (the wiki)', () => {
  const { hero, enemies, fight } = setup(['Bullet Lifesteal']);
  hero.health = 100;
  fight.damage(hero, enemies[0], 100, 'bullet');
  near(hero.health, 100 + 100 * 0.13 * 0.6);
  const rival = buildHero('Abrams', {});
  hero.health = 100; hero.healPool = 1e9;
  const dealt = fight.damage(hero, rival, 100, 'bullet');
  near(hero.health, 100 + dealt * 0.13);
});

test('Debuff Reducer: +90 health, +25% debuff resist', () => {
  const s = sheet(['Debuff Reducer']);
  near(s.maxHealth - BASE.maxHealth, 90); near(s.statusResist, 0.25);
});

test('Healing Booster: +3 health regen, +1 out-of-combat regen, +20% healing (heals and temporary regen, not the constant regen)', () => {
  const s = sheet(['Healing Booster']);
  near(s.healthRegen - BASE.healthRegen, 3); near(s.oocRegen, 1); near(s.healAmp, 0.2);
  const { hero, fight } = setup(['Healing Booster']);
  hero.health = 100;
  fight.heal(hero, 50);
  near(hero.health, 160);
  fight.heal(hero, 10, 'constant');
  near(hero.health, 170);
});

test('Trophy Collector: -15% weapon damage vs NPCs, +2 m/s, +2 out-of-combat regen; each kill +0.15 m/s, +0.75% ability range, 16 souls a minute, up to 16', () => {
  const s = sheet(['Trophy Collector']);
  near(s.weaponDamageMult - BASE.weaponDamageMult, -0.15); near(s.moveSpeed - BASE.moveSpeed, 2); near(s.oocRegen, 2);
  const { hero, enemies, fight, it } = setup(['Trophy Collector']);
  for (let i = 0; i < 20; i++) fight.emit('kill', { source: hero, target: enemies[0] });
  const mods = it().dynamicMods(fight);
  near(mods.moveSpeed, 16 * 0.15); near(mods.rangeMult, 16 * 0.0075);
  it().tick(fight, 60);
  near(fight.bonusSouls, 16 * 16);
});

test('Enduring Speed: +2 m/s, +2 out-of-combat regen, 25% slow resist', () => {
  const s = sheet(['Enduring Speed']);
  near(s.moveSpeed - BASE.moveSpeed, 2); near(s.oocRegen, 2); near(s.slowResist, 0.25);
  const { dodgeChance } = require('../src/utils/farm/engine');
  const slowedBy = (items) => { const { hero } = setup(items); hero.statuses.push({ id: 'spores', until: 99, mods: { slow: 0.6 } }); return dodgeChance(hero); };
  assert.ok(slowedBy(['Enduring Speed', 'Fleetfoot']) >= slowedBy(['Fleetfoot']));
});

test('Weapon Shielding: 250 weapon (or melee) damage within 4 s puts up a 300 barrier and +18% bullet resist for 8 s, every 35 s', () => {
  const { hero, enemies, fight, it } = setup(['Weapon Shielding']);
  near(hero.stats.oocRegen, 2.5);
  fight.emit('damage', { source: enemies[0], target: hero, amount: 150, dealt: 150, type: 'melee', opts: {} });
  fight.emit('damage', { source: enemies[0], target: hero, amount: 150, dealt: 150, type: 'bullet', opts: {} });
  const b = status(hero, 'Weapon Shielding:barrier');
  near(b.barrier, 300); near(b.mods.bulletResist, 0.18); near(b.until - fight.time, 8); near(it().cdLeft, 35);
});

test('Spirit Shielding: 225 spirit damage within 3.5 s puts up a 300 barrier and +18% spirit resist for 8 s, every 45 s', () => {
  const { hero, enemies, fight, it } = setup(['Spirit Shielding']);
  fight.emit('damage', { source: enemies[0], target: hero, amount: 230, dealt: 230, type: 'spirit', opts: {} });
  const b = status(hero, 'Spirit Shielding:barrier');
  near(b.barrier, 300); near(b.mods.spiritResist, 0.18); near(b.until - fight.time, 8); near(it().cdLeft, 45);
});

test('Battle Vest: +18% bullet resist, +3 out-of-combat regen; above 65% health +18% weapon damage and +7% fire rate', () => {
  const { hero, fight, it } = setup(['Battle Vest']);
  near(1 - (1 - hero.stats.bulletResist) / (1 - BASE.bulletResist), 0.18); near(hero.stats.oocRegen, 3);
  assert.deepStrictEqual(it().dynamicMods(fight), { weaponDamage: 0.18, fireRate: 0.07 });
  hero.health = hero.stats.maxHealth * 0.6;
  assert.strictEqual(it().dynamicMods(fight), null);
});

test("Enchanter's Emblem: +18% spirit resist, +2 out-of-combat regen; above 65% health +15 spirit power and 5% cooldown reduction", () => {
  const { hero, fight, it } = setup(["Enchanter's Emblem"]);
  near(hero.stats.oocRegen, 2);
  assert.deepStrictEqual(it().dynamicMods(fight), { spirit: 15, cdr: 0.05 });
  hero.health = hero.stats.maxHealth * 0.6;
  assert.strictEqual(it().dynamicMods(fight), null);
});

test('Return Fire: for 6.5 s, +10% bullet resist; 65% of bullet and 25% of spirit damage (before resists) goes back, every 23 s', () => {
  const { hero, enemies, fight, it } = setup(['Return Fire']);
  it().cast(fight);
  const buff = status(hero, 'Return Fire:reflect');
  near(buff.mods.bulletResist, 0.1); near(buff.until - fight.time, 6.5); near(it().cooldown, 23);
  fight.emit('damage', { source: enemies[0], target: hero, amount: 100, dealt: 0, type: 'bullet', opts: {} });
  near(1e6 - enemies[0].health, 65, 'in full, even when nothing got through');
  fight.emit('damage', { source: enemies[0], target: hero, amount: 100, dealt: 50, type: 'spirit', opts: {} });
  near(1e6 - enemies[0].health, 90);
});

test('Spirit Lifesteal: +13% spirit lifesteal, +90 health, +6 spirit power', () => {
  const s = sheet(['Spirit Lifesteal']);
  near(s.spiritLifesteal, 0.13); near(s.maxHealth - BASE.maxHealth, 90); near(s.spirit - BASE.spirit, 6);
});

test('Healbane: +7 spirit power; spirit damage cuts healing 35% for 8 s; a kill under it heals 275', () => {
  const { hero, enemies, fight } = setup(['Healbane'], { hp: 100 });
  near(hero.stats.spirit - BASE.spirit, 7);
  hero.health = 100; hero.healPool = 1e9; // past the heal cap (engine.js HEAL_POOL)
  fight.damage(hero, enemies[0], 50, 'spirit');
  const bane = status(enemies[0], 'Healbane:bane');
  near(bane.mods.healAmp, -0.35); near(bane.until - fight.time, 8);
  fight.damage(hero, enemies[0], 100, 'spirit');
  assert.ok(!enemies[0].alive);
  near(hero.health, 375);
});

test('Restorative Locket: +8% spirit resist; a stack per enemy blast or spirit hit (max 25); the active heals 16 a stack and gives back 0.12 stamina a stack', () => {
  const { hero, enemies, fight, it } = setup(['Restorative Locket']);
  near(1 - (1 - hero.stats.spiritResist) / (1 - BASE.spiritResist), 0.08);
  for (let i = 0; i < 30; i++) fight.emit('damage', { source: enemies[0], target: hero, amount: 1, dealt: 1, type: 'spirit', opts: { attack: true } });
  assert.strictEqual(it().stacks, 25);
  hero.health = 100; hero.stamina = 0; hero.healPool = 1e9; // past the heal cap
  it().cast(fight);
  near(hero.health, 500); assert.strictEqual(hero.stamina, 3);
  near(it().cooldown, 20);
});

test('Guardian Ward: +8% ability range, +1.5 out-of-combat regen; a 250 barrier and +2.75 m/s for 6 s, every 60 s', () => {
  const { hero, fight, it } = setup(['Guardian Ward']);
  near(hero.stats.rangeMult - BASE.rangeMult, 0.08); near(hero.stats.oocRegen, 1.5);
  it().cast(fight);
  near(status(hero, 'Guardian Ward:barrier').barrier, 250); near(status(hero, 'Guardian Ward:barrier').until - fight.time, 6);
  near(status(hero, 'Guardian Ward:speed').mods.moveSpeed, 2.75); near(it().cooldown, 60);
});

test('Reactive Barrier: +1 out-of-combat regen; crowd control on the holder puts up a 325 barrier for 10 s, every 55 s', () => {
  const { hero, fight, it } = setup(['Reactive Barrier']);
  near(hero.stats.oocRegen, 1);
  fight.emit('ccLanded', { target: hero });
  const b = status(hero, 'Reactive Barrier:barrier');
  near(b.barrier, 325); near(b.until - fight.time, 10); near(it().cdLeft, 55);
});

// ===== Batch 7: Vitality tier 3 =====
test('Counterspell: +50 health, +5 spirit power; parries the next enemy blast (no damage, no curse): heals 150, +20 spirit power and +1.75 m/s for 6 s, every 23 s', () => {
  const s = sheet(['Counterspell']);
  near(s.maxHealth - BASE.maxHealth, 50); near(s.spirit - BASE.spirit, 5);
  const { hero, fight, it } = setup(['Counterspell']);
  hero.health = 100;
  const blast = { target: hero, parried: false };
  fight.emit('blast', blast);
  assert.ok(blast.parried); near(hero.health, 250);
  const buff = status(hero, 'Counterspell:parry');
  near(buff.mods.spirit, 20); near(buff.mods.moveSpeed, 1.75); near(buff.until - fight.time, 6); near(it().cdLeft, 23);
});

test('Dispel Magic: +10% spirit resist; used on a debuff: purges it, heals 250 and +2 m/s for 3 s; nothing to purge, no heal; every 45 s', () => {
  const plain = setup(['Dispel Magic']);
  near(1 - (1 - plain.hero.stats.spiritResist) / (1 - BASE.spiritResist), 0.1);
  assert.ok(!plain.it().want(plain.fight), 'not used with nothing on the hero');
  const { hero, fight, it } = setup(['Dispel Magic']);
  fight.addStatus(hero, { id: 'curse', duration: 5, tags: ['stun'], debuff: true });
  hero.health = 100; hero.healPool = 1e9;
  assert.ok(it().want(fight));
  it().cast(fight);
  assert.ok(!hero.has('stun') || status(hero, 'curse').until <= fight.time, 'purged');
  near(hero.health, 350); near(status(hero, 'Dispel Magic:speed').mods.moveSpeed, 2); near(status(hero, 'Dispel Magic:speed').until - fight.time, 3);
  near(it().cooldown, 45);
});

test('Bullet / Spirit Resilience: +30% resist and +3 out-of-combat regen; below 50% health the item gives 45% (one bonus, not stacked)', () => {
  for (const [name, stat] of [['Bullet Resilience', 'bulletResist'], ['Spirit Resilience', 'spiritResist']]) {
    const { hero, fight, it } = setup([name]);
    near(1 - (1 - hero.stats[stat]) / (1 - BASE[stat]), 0.3); near(hero.stats.oocRegen, 3);
    assert.strictEqual(it().dynamicMods(fight), null);
    hero.health = hero.stats.maxHealth * 0.4;
    const extra = it().dynamicMods(fight)[stat];
    near(1 - (1 - hero.stats[stat]) * (1 - extra) / (1 - BASE[stat]), 0.45, name);
  }
});

test('Metal Skin: +12% bullet resist; immune to bullets for 5 s, 1.5 m/s slower, every 24 s', () => {
  const { hero, enemies, fight, it } = setup(['Metal Skin']);
  near(1 - (1 - hero.stats.bulletResist) / (1 - BASE.bulletResist), 0.12);
  it().cast(fight);
  const buff = status(hero, 'Metal Skin:metal');
  near(buff.mods.moveSpeed, -1.5); near(buff.until - fight.time, 5); near(it().cooldown, 24);
  const before = hero.health;
  fight.damage(enemies[0], hero, 100, 'bullet');
  near(hero.health, before);
});

test('Fortitude: +375 health; after 10 s without damage, 2.25% of max health a second; above 75% health +1.5 m/s', () => {
  const { hero, fight, it } = setup(['Fortitude']);
  near(hero.stats.maxHealth - BASE.maxHealth, 375);
  assert.deepStrictEqual(it().dynamicMods(fight), { moveSpeed: 1.5 });
  hero.health = hero.stats.maxHealth * 0.5; hero.healPool = 1e9;
  hero.lastHit = fight.time - 9;
  it().tick(fight, 1);
  near(hero.health, hero.stats.maxHealth * 0.5, 'not before 10 s');
  assert.strictEqual(it().dynamicMods(fight), null);
  hero.lastHit = fight.time - 10;
  it().tick(fight, 1);
  near(hero.health, hero.stats.maxHealth * 0.5225);
});

test('Stamina Mastery: +2 stamina, +18% stamina recovery', () => {
  near(buildHero('Haze', { items: ['Stamina Mastery'] }).stats.stamina - BASE.stamina, 2);
  near(sheet(['Stamina Mastery']).staminaCdr, 0.18);
});

test('Rescue Beam: +0.75 m/s, +6% ability range; heals 20% of max health over its 2.5 s channel, every 60 s', () => {
  const { hero, fight, it } = setup(['Rescue Beam']);
  near(hero.stats.moveSpeed - BASE.moveSpeed, 0.75); near(hero.stats.rangeMult - BASE.rangeMult, 0.06);
  it().cast(fight);
  const regen = status(hero, 'Rescue Beam:regen');
  near(regen.regen * 2.5, 0.2 * hero.stats.maxHealth); near(regen.until - fight.time, 2.5); near(it().cooldown, 60);
});

test('Warp Stone: dodges an incoming hit, then +30% bullet resist for 6 s, every 16 s', () => {
  const { hero, enemies, fight, it } = setup(['Warp Stone']);
  const health = hero.health;
  near(fight.damage(enemies[0], hero, 100, 'bullet', { attack: true }), 0);
  near(hero.health, health);
  near(it().cdLeft, 16);
  assert.strictEqual(it().want(fight), false, 'waits for a hit instead of a health threshold');
  const buff = status(hero, 'Warp Stone:resist');
  near(buff.mods.bulletResist, 0.3); near(buff.until - fight.time, 6); near(it().cooldown, 16);
});

test('Majestic Leap: a 200 barrier for 8 s and a leap; the landing slows the enemies within 10 m 32% for 2.5 s; every 45 s', () => {
  const { hero, enemies, fight, it } = setup(['Majestic Leap'], { distance: 5 });
  it().cast(fight);
  near(status(hero, 'Majestic Leap:barrier').barrier, 200); near(status(hero, 'Majestic Leap:barrier').until - fight.time, 8);
  assert.ok(hero.has('airborne')); near(it().cooldown, 45);
  fight.run(3.1);
  const slow = status(enemies[0], 'Majestic Leap:slow');
  near(slow.mods.slow, 0.32);
});

test('Healing Nova: +5% ability range, +8 spirit power; heals 325 over 2 s, every 60 s', () => {
  const { hero, fight, it } = setup(['Healing Nova']);
  near(hero.stats.rangeMult - BASE.rangeMult, 0.05); near(hero.stats.spirit - BASE.spirit, 8);
  it().cast(fight);
  const regen = status(hero, 'Healing Nova:regen');
  near(regen.regen * 2, 325); near(regen.until - fight.time, 2); near(it().cooldown, 60);
});

test('Fury Trance: +14% lifesteal, +100 health, +6% weapon damage; +32% fire rate, +40% spirit resist, +1 m/s for 6.5 s, silenced meanwhile; used when no ability is ready; every 18 s', () => {
  const s = sheet(['Fury Trance']);
  near(s.lifesteal, 0.14); near(s.maxHealth - BASE.maxHealth, 100); near(s.weaponDamageMult - BASE.weaponDamageMult, 0.06);
  const { hero, fight, it } = setup(['Fury Trance']); // its abilities are on cooldown (setup)
  assert.ok(it().want(fight));
  it().cast(fight);
  const buff = status(hero, 'Fury Trance:trance');
  near(buff.mods.fireRate, 0.32); near(buff.mods.spiritResist, 0.4); near(buff.mods.moveSpeed, 1); near(buff.until - fight.time, 6.5);
  assert.ok(hero.has('silence')); near(it().cooldown, 18);
  hero.abilities[0].cdLeft = 0;
  hero.statuses = [];
  assert.ok(!it().want(fight) || !hero.abilities[0].ready(), 'not while an ability is ready');
});

test('Lifestrike: +16% melee damage, +125 health; a melee heals 120 + 35% of its damage (40% of that off a non-hero) and slows 48% for 2.5 s, every 4 s', () => {
  const s = sheet(['Lifestrike']);
  near(s.meleeDamage - BASE.meleeDamage, 0.16); near(s.maxHealth - BASE.maxHealth, 125);
  const { hero, enemies, fight, it } = setup(['Lifestrike']);
  hero.health = 100; hero.healPool = 1e9;
  fight.emit('melee', { source: hero, target: enemies[0], amount: 100, dealt: 100 });
  near(hero.health, 100 + (120 + 35) * 0.4);
  const slow = status(enemies[0], 'Lifestrike:slow');
  near(slow.mods.slow, 0.48); near(slow.until - fight.time, 2.5); near(it().cdLeft, 4);
  it().cdLeft = 0;
  hero.health = 100;
  fight.emit('melee', { source: hero, target: buildHero('Abrams', {}), amount: 100, dealt: 100 });
  near(hero.health, 100 + 155, 'all of it off a rival hero');
});

test('Veil Walker: +125 health, +6 spirit power; every 15 s a veil heals 85 and gives 8 s of invisibility with +3.5 m/s, both ending when the hero attacks', () => {
  const s = sheet(['Veil Walker']);
  near(s.maxHealth - BASE.maxHealth, 125); near(s.spirit - BASE.spirit, 6);
  const { hero, enemies, fight, it } = setup(['Veil Walker']);
  hero.health = 100; hero.healPool = 1e9;
  it().tick(fight, 0.05);
  near(hero.health, 185);
  const veil = status(hero, 'Veil Walker:veil');
  near(veil.mods.moveSpeed, 3.5); near(veil.until - fight.time, 8); assert.ok(hero.has('invisible')); near(it().cdLeft, 15);
  fight.damage(hero, enemies[0], 10, 'bullet');
  assert.ok(!hero.has('invisible') && !status(hero, 'Veil Walker:veil'), 'attacking ends both');
});

test('spirit lifesteal off an NPC works at 40% (the wiki); Trophy Collector brings its kept stacks and loses them on a death', () => {
  const { hero, enemies, fight } = setup(['Spirit Lifesteal']);
  hero.health = 100;
  fight.damage(hero, enemies[0], 100, 'spirit');
  near(hero.health, 100 + 100 * 0.13 * 0.4);
  const t = setup(['Trophy Collector'], { kept: { 'Trophy Collector': 4 } });
  near(t.it().dynamicMods(t.fight).moveSpeed, 4 * 0.15, 'starts with the 4 it brought');
  t.hero.rejuvs = 1;
  t.fight.damage(t.enemies[0], t.hero, 1e9, 'true');
  assert.strictEqual(t.it().stacks, 0, 'died and got back up: none left');
});

// ===== Batch 8: Vitality tier 4 =====
test('Inhibitor: +10% weapon damage, +150 health; Haze builds 12.3% a bullet (the wiki table): the 9th cuts its damage 30% and healing 40% for 5 s; hits refresh it', () => {
  const s = sheet(['Inhibitor']);
  near(s.weaponDamageMult - BASE.weaponDamageMult, 0.1); near(s.maxHealth - BASE.maxHealth, 150);
  const { enemies, fight, hit } = setup(['Inhibitor']);
  for (let i = 0; i < 8; i++) hit();
  assert.ok(!status(enemies[0], 'Inhibitor:inhibit'));
  hit();
  const d = status(enemies[0], 'Inhibitor:inhibit');
  near(d.mods.damageDealt, -0.3); near(d.mods.healAmp, -0.4); near(d.until - fight.time, 5);
  fight.time += 4;
  hit();
  near(status(enemies[0], 'Inhibitor:inhibit').until - fight.time, 5, 'refreshed');
});

test('Siphon Bullets: +15% weapon damage, +10% bullet resist; a hit steals 2.5% of max health (half on a camp creep) and deals as much, every 1.2 s; it all comes back 17 s after the last steal', () => {
  const s = sheet(['Siphon Bullets']);
  near(s.weaponDamageMult - BASE.weaponDamageMult, 0.15);
  const { hero, enemies, fight, it, hit } = setup(['Siphon Bullets'], { hp: 2000 });
  hero.weapon.reloadLeft = 1e9; // no shooting of its own: only the hits below
  const max = hero.stats.maxHealth;
  hit();
  const steal = 0.025 * 2000 * 0.5;
  near(hero.stats.maxHealth - max, steal); near(enemies[0].stats.maxHealth, 2000 - steal);
  near(2000 - enemies[0].health, 2 * steal, 'the max it lost (it was full) and the flat damage');
  near(it().cdLeft, 1.2);
  fight.run(10); it().cdLeft = 0; hit();
  fight.run(8);
  assert.ok(hero.stats.maxHealth > max, 'refreshed by the second steal');
  fight.run(10);
  near(hero.stats.maxHealth, max, 'all back');
});

test('Leech: +28% bullet and spirit lifesteal, +180 health, +12% weapon damage, +12 spirit power', () => {
  const s = sheet(['Leech']);
  near(s.lifesteal, 0.28); near(s.spiritLifesteal, 0.28); near(s.maxHealth - BASE.maxHealth, 180); near(s.weaponDamageMult - BASE.weaponDamageMult, 0.12); near(s.spirit - BASE.spirit, 12);
});

test('Phantom Strike: +15% weapon damage, +8 spirit power; 75 + 0.93 x spirit damage, disarmed and slowed 40% for 3 s, every 35 s', () => {
  const { enemies, fight, it } = setup(['Phantom Strike']);
  it().cast(fight);
  near(1e6 - enemies[0].health, 75 + 0.93 * 8);
  assert.ok(enemies[0].has('disarm')); near(status(enemies[0], 'Phantom Strike:slow').mods.slow, 0.4); near(status(enemies[0], 'Phantom Strike:disarm').until - fight.time, 3);
  near(it().cooldown, 35);
});

test('Cheat Death: +200 health, +15% bullet resist; a lethal hit leaves it at 1, unkillable for 4.5 s dealing 60% less and healing 60% less; non-stun debuffs end; every 90 s', () => {
  const s = sheet(['Cheat Death']);
  near(s.maxHealth - BASE.maxHealth, 200);
  const { hero, enemies, fight, it } = setup(['Cheat Death']);
  fight.addStatus(hero, { id: 'antiheal', duration: 9, mods: { healAmp: -0.2 }, debuff: true });
  fight.damage(enemies[0], hero, 1e9, 'true');
  assert.strictEqual(hero.health, 1);
  const buff = status(hero, 'Cheat Death:immune');
  near(buff.mods.damageDealt, -0.6); near(buff.mods.healAmp, -0.6); near(buff.until - fight.time, 4.5); near(it().cdLeft, 90);
  assert.ok(status(hero, 'antiheal').until <= fight.time, 'debuff ended');
});

test('Infuser: +13% spirit lifesteal, +10% spirit resist, +100 health, +6 spirit power; the active +70% spirit lifesteal and +30 spirit power for 7 s, every 30 s', () => {
  const s = sheet(['Infuser']);
  near(s.spiritLifesteal, 0.13); near(s.maxHealth - BASE.maxHealth, 100); near(s.spirit - BASE.spirit, 6);
  const { hero, fight, it } = setup(['Infuser']);
  it().cast(fight);
  const buff = status(hero, 'Infuser:infuse');
  near(buff.mods.spiritLifesteal, 0.7); near(buff.mods.spirit, 30); near(buff.until - fight.time, 7); near(it().cooldown, 30);
});

test('Divine Barrier: +10% ability range, +1.5 out-of-combat regen; a 600 barrier and +2.75 m/s for 6 s, non-stun debuffs end, every 45 s', () => {
  const { hero, fight, it } = setup(['Divine Barrier']);
  near(hero.stats.rangeMult - BASE.rangeMult, 0.1);
  fight.addStatus(hero, { id: 'antiheal', duration: 9, mods: { healAmp: -0.2 }, debuff: true });
  fight.addStatus(hero, { id: 'curse', duration: 9, tags: ['stun'], debuff: true });
  it().cast(fight);
  near(status(hero, 'Divine Barrier:barrier').barrier, 600); near(status(hero, 'Divine Barrier:speed').mods.moveSpeed, 2.75); near(status(hero, 'Divine Barrier:speed').until - fight.time, 6);
  assert.ok(status(hero, 'antiheal').until <= fight.time && status(hero, 'curse').until > fight.time, 'the stun stays');
  near(it().cooldown, 45);
});

test('Unstoppable: +25% debuff resist, +125 health; 5.5 s immune to crowd control, existing debuffs end; every 60 s', () => {
  const s = sheet(['Unstoppable']);
  near(s.statusResist, 0.25); near(s.maxHealth - BASE.maxHealth, 125);
  const { hero, fight, it } = setup(['Unstoppable']);
  it().cast(fight);
  assert.ok(hero.has('unstoppable')); near(status(hero, 'Unstoppable:unstoppable').until - fight.time, 5.5); near(it().cooldown, 60);
});

test('Colossus: +25% base health, +15% weapon damage; the active +35% bullet and spirit resist and +30% melee damage, enemies within 14 m slowed 24%, for 7 s; every 37 s', () => {
  const s = sheet(['Colossus']);
  near(s.maxHealth / BASE.maxHealth, 1.25); near(s.weaponDamageMult - BASE.weaponDamageMult, 0.15);
  const { hero, enemies, fight, it } = setup(['Colossus'], { distance: 10 });
  it().cast(fight);
  const buff = status(hero, 'Colossus:resist');
  near(buff.mods.bulletResist, 0.35); near(buff.mods.spiritResist, 0.35); near(buff.mods.meleeDamage, 0.3); near(buff.until - fight.time, 7);
  near(status(enemies[0], 'Colossus:slow').mods.slow, 0.24); near(it().cooldown, 37);
});

test('Vampiric Burst: +13% lifesteal, +10% bullet resist, +100 health, +6% weapon damage; the active +70% lifesteal and +34% fire rate for 5 s and 75% more rounds past the clip, every 30 s', () => {
  const s = sheet(['Vampiric Burst']);
  near(s.lifesteal, 0.13); near(s.maxHealth - BASE.maxHealth, 100);
  const { hero, fight, it } = setup(['Vampiric Burst']);
  hero.weapon.reloadLeft = 1;
  it().cast(fight);
  const buff = status(hero, 'Vampiric Burst:burst');
  near(buff.mods.lifesteal, 0.7); near(buff.mods.fireRate, 0.34); near(buff.until - fight.time, 5);
  assert.strictEqual(hero.weapon.reloadLeft, 0);
  assert.strictEqual(hero.weapon.clip, hero.stats.clip + Math.round(hero.stats.clip * 0.75));
  near(it().cooldown, 30);
});

test("Diviner's Kevlar: +15% ability duration, +10% ultimate cooldown cut; casting the ultimate gives a 1000 barrier and +40 spirit power for 20 s, every 40 s", () => {
  const s = sheet(["Diviner's Kevlar"]);
  near(s.durationMult - BASE.durationMult, 0.15); near(s.ultCdr, 0.1);
  const { hero, fight, it } = setup(["Diviner's Kevlar"]);
  fight.emit('cast', { source: hero, ability: { ultimate: true } });
  near(status(hero, "Diviner's Kevlar:barrier").barrier, 1000); near(status(hero, "Diviner's Kevlar:spirit").mods.spirit, 40);
  near(status(hero, "Diviner's Kevlar:spirit").until - fight.time, 20 * 1.15, '20 s, stretched by its own ability duration'); near(it().cdLeft, 40);
});

test('Indomitable: +10% bullet and spirit resist, +2 out-of-combat regen; the next curse or stomp is cleansed, a 325 barrier for 10 s and running ability cooldowns 20% shorter, every 55 s', () => {
  const { hero, fight, it } = setup(['Indomitable']);
  near(hero.stats.oocRegen, 2);
  hero.abilities[0].cdLeft = 10;
  const landed = fight.cc(hero, { id: 'curse', duration: 2, tags: ['stun'] });
  assert.strictEqual(landed, false, 'cleansed before it takes hold');
  near(status(hero, 'Indomitable:barrier').barrier, 325); near(status(hero, 'Indomitable:barrier').until - fight.time, 10);
  near(hero.abilities[0].cdLeft, 8); near(it().cdLeft, 55);
});

test('Witchmail: +22% spirit resist, +14 spirit power, 7% cooldown reduction; a spirit hit of 75+ (before resists) takes 4 s off a running ability cooldown, at most every 1 s', () => {
  const s = sheet(['Witchmail']);
  near(s.spirit - BASE.spirit, 14); near(s.cdr, 0.07);
  const { hero, enemies, fight, it } = setup(['Witchmail']);
  hero.abilities.forEach((a, i) => { a.cdLeft = i === 0 ? 10 : 0; });
  fight.emit('damage', { source: enemies[0], target: hero, amount: 80, dealt: 40, type: 'spirit', opts: {} });
  near(hero.abilities[0].cdLeft, 6); near(it().cdLeft, 1);
});

test('Healing Tempo: +25% healing, +10% spirit resist, +6 regen, +4 out-of-combat regen; a cast heal gives +35% fire rate and +1.25 m/s for 7 s', () => {
  const s = sheet(['Healing Tempo']);
  near(s.healAmp, 0.25); near(s.healthRegen - BASE.healthRegen, 6); near(s.oocRegen, 4);
  const { hero, fight } = setup(['Healing Tempo']);
  hero.health = 100;
  fight.heal(hero, 50);
  const buff = status(hero, 'Healing Tempo:tempo');
  near(buff.mods.fireRate, 0.35); near(buff.mods.moveSpeed, 1.25); near(buff.until - fight.time, 7);
});

test('Plated Armor: +130 health; 30% of bullets are deflected (an Armor Piercer one is not)', () => {
  const s = sheet(['Plated Armor']);
  near(s.maxHealth - BASE.maxHealth, 130);
  const lucky = setup(['Plated Armor'], { rng: () => 0.2 });
  const before = lucky.hero.health;
  lucky.fight.damage(lucky.enemies[0], lucky.hero, 100, 'bullet', { attack: true });
  near(lucky.hero.health, before, 'deflected');
  lucky.fight.damage(lucky.enemies[0], lucky.hero, 100, 'bullet', { attack: true, unavoidable: true });
  assert.ok(lucky.hero.health < before, 'Armor Piercer goes through');
});

test('Spellbreaker: +18% spirit resist, +25% debuff resist, +90 health; the next spirit hit of 175+ is cut 65%, every 9 s', () => {
  const s = sheet(['Spellbreaker']);
  near(s.statusResist, 0.25); near(s.maxHealth - BASE.maxHealth, 90);
  const { hero, enemies, fight, it } = setup(['Spellbreaker']);
  const hitFor = (n) => { const h = { source: enemies[0], target: hero, amount: n, type: 'spirit', opts: { attack: true } }; fight.emit('attacked', h); return h.amount; };
  near(hitFor(100), 100);
  near(hitFor(200), 70); near(it().cdLeft, 9);
});

test('Juggernaut: 50% slow resist, +2.5 m/s, +8 regen; an enemy that shoots the holder fires 40% slower for 4 s', () => {
  const s = sheet(['Juggernaut']);
  near(s.slowResist, 0.5); near(s.moveSpeed - BASE.moveSpeed, 2.5); near(s.healthRegen - BASE.healthRegen, 8);
  const { hero, enemies, fight } = setup(['Juggernaut']);
  fight.emit('damage', { source: enemies[0], target: hero, amount: 10, dealt: 10, type: 'bullet', opts: { attack: true } });
  const d = status(enemies[0], 'Juggernaut:slowfire');
  near(d.mods.damageDealt, -0.4); near(d.until - fight.time, 4);
});

// ===== Batch 9: Spirit tier 1 (Golden Goose Egg's growth and hatch: test/itemsystems.test.js) =====
test('Extra Spirit: +10 spirit power', () => near(sheet(['Extra Spirit']).spirit - BASE.spirit, 10));

test('Mystic Regeneration: +50 health; spirit damage gives 4 regen for 7 s, one stack per enemy damaged', () => {
  near(sheet(['Mystic Regeneration']).maxHealth - BASE.maxHealth, 50);
  const { hero, enemies, fight } = setup(['Mystic Regeneration'], { foes: 2 });
  fight.damage(hero, enemies[0], 10, 'spirit');
  fight.damage(hero, enemies[0], 10, 'spirit');
  fight.damage(hero, enemies[1], 10, 'spirit');
  fight.damage(hero, enemies[0], 10, 'bullet');
  const regens = hero.statuses.filter((s) => s.id.startsWith('Mystic Regeneration:'));
  assert.strictEqual(regens.length, 2, 'one per enemy');
  for (const r of regens) { near(r.regen, 4); near(r.until - fight.time, 7); }
});

test('Mystic Expansion: the imbued ability gets +20% range and radius', () => {
  const hero = buildHero('Haze', { items: ['Mystic Expansion'], imbues: { 'Mystic Expansion': 2 } });
  near(hero.abilities[1].imbued().range, 0.2);
  assert.ok(!hero.abilities[0].imbued().range, 'only the imbued one');
});

test('Extra Charge: +1 charge and +7 spirit power for charged abilities only', () => {
  const hero = buildHero('Haze', { items: ['Extra Charge'], tiers: { 2: 2 } });
  const smoke = hero.abilities[1];
  assert.strictEqual(smoke.maxCharges, 3);
  near(smoke.spirit() - hero.stats.spirit, 7);
  near(hero.abilities[0].spirit() - hero.stats.spirit, 0, 'not a charged ability');
});

test('Mystic Burst: charges for 14 s; an ability spirit hit of more than 80 (before resists) deals 40 more', () => {
  const { hero, enemies, fight, it } = setup(['Mystic Burst']);
  const e = enemies[0];
  const ab = hero.abilities[0];
  const taken = () => 1e6 - e.health;
  fight.running(ab, () => fight.damage(hero, e, 80, 'spirit'));
  near(taken(), 80, '80 is not more than 80');
  fight.running(ab, () => fight.damage(hero, e, 100, 'bullet'));
  near(taken(), 180, 'spirit damage only');
  fight.damage(hero, e, 100, 'spirit');
  near(taken(), 280, 'abilities only');
  e.stats.spiritResist = 0.5;
  fight.running(ab, () => fight.damage(hero, e, 100, 'spirit'));
  near(taken(), 280 + 50 + 20, 'its 100 counts before the resist; the bonus is resisted too');
  near(it().cdLeft, 14);
  fight.running(ab, () => fight.damage(hero, e, 100, 'spirit'));
  near(taken(), 350 + 50, 'charging');
});

test('Rusted Barrel: +60 health; the active takes 32% off fire rate (an NPC deals that much less) and 8% bullet resist for 5 s, every 16 s', () => {
  near(sheet(['Rusted Barrel']).maxHealth - BASE.maxHealth, 60);
  const { enemies, fight, it } = setup(['Rusted Barrel']);
  it().cast(fight);
  const d = status(enemies[0], 'Rusted Barrel:rust');
  near(d.mods.damageDealt, -0.32); near(d.mods.bulletResist, -0.08); near(d.until - fight.time, 5);
  near(it().cooldown, 16);
  const rival = buildHero('Abrams', {});
  const duel = setup(['Rusted Barrel']);
  duel.fight.enemies = [rival];
  duel.it().cast(duel.fight);
  const r = status(rival, 'Rusted Barrel:rust');
  near(r.mods.fireRate, -0.32); assert.ok(!('damageDealt' in r.mods), 'a rival hero: its gun, not its spirit');
});

test('Spirit Strike: a melee hit deals 40 (+0.372 x spirit) spirit damage and takes 6% spirit resist for 6 s, every 8 s', () => {
  const { hero, enemies, fight, it } = setup(['Spirit Strike']);
  fight.emit('melee', { source: hero, target: enemies[0], amount: 50, dealt: 50 });
  near(1e6 - enemies[0].health, 40);
  const d = status(enemies[0], 'Spirit Strike:strike');
  near(d.mods.spiritResist, -0.06); near(d.until - fight.time, 6); near(it().cdLeft, 8);
  hero.stats.spirit = 100;
  it().cdLeft = 0;
  fight.emit('melee', { source: hero, target: enemies[0], amount: 50, dealt: 50 });
  near(1e6 - enemies[0].health, 40 + (40 + 37.2) * 1.06, 'scales with spirit (and the first hit took 6% resist)');
});

test('Golden Goose Egg: -15% damage dealt, +1 m/s, +1 out-of-combat regen', () => {
  const s = sheet(['Golden Goose Egg']);
  near(s.damageDealt - BASE.damageDealt, -0.15); near(s.moveSpeed - BASE.moveSpeed, 1); near(s.oocRegen - BASE.oocRegen, 1);
});

// ===== Batch 10: Spirit tier 2 (Quicksilver Reload: above) =====
test('Improved Spirit: +18 spirit power, +1.5 out-of-combat regen (no health: the data\'s leftover 75 is not on the card)', () => {
  const s = sheet(['Improved Spirit']);
  near(s.spirit - BASE.spirit, 18); near(s.oocRegen - BASE.oocRegen, 1.5); near(s.maxHealth, BASE.maxHealth);
});

test('Bullet Resist Shredder: +9% bullet resist, +9% weapon damage; spirit damage takes 10% bullet resist for 8 s (refreshes, no stacking)', () => {
  const s = sheet(['Bullet Resist Shredder']);
  near(1 - (1 - s.bulletResist) / (1 - BASE.bulletResist), 0.09); near(s.weaponDamageMult - BASE.weaponDamageMult, 0.09);
  const { hero, enemies, fight } = setup(['Bullet Resist Shredder']);
  fight.damage(hero, enemies[0], 10, 'bullet');
  assert.ok(!status(enemies[0], 'Bullet Resist Shredder:shred'), 'not bullets');
  fight.damage(hero, enemies[0], 10, 'spirit'); fight.damage(hero, enemies[0], 10, 'spirit');
  near(enemies[0].mod('bulletResist'), -0.1, 'no stacking');
  near(status(enemies[0], 'Bullet Resist Shredder:shred').until - fight.time, 8);
});

test('Mystic Vulnerability: +8% spirit resist; spirit damage takes 8% spirit resist for 7 s (refreshes, no stacking)', () => {
  near(1 - (1 - sheet(['Mystic Vulnerability']).spiritResist) / (1 - BASE.spiritResist), 0.08);
  const { hero, enemies, fight } = setup(['Mystic Vulnerability']);
  fight.damage(hero, enemies[0], 10, 'spirit'); fight.damage(hero, enemies[0], 10, 'spirit');
  near(enemies[0].mod('spiritResist'), -0.08);
  near(status(enemies[0], 'Mystic Vulnerability:vuln').until - fight.time, 7);
});

test('Mystic Slow: +50 health, +0.75 m/s; spirit damage slows 24% for 2 s', () => {
  const s = sheet(['Mystic Slow']);
  near(s.maxHealth - BASE.maxHealth, 50); near(s.moveSpeed - BASE.moveSpeed, 0.75);
  const { hero, enemies, fight } = setup(['Mystic Slow']);
  fight.damage(hero, enemies[0], 10, 'spirit');
  const d = status(enemies[0], 'Mystic Slow:slow');
  near(d.mods.slow, 0.24); near(d.until - fight.time, 2);
});

test('Compress Cooldown / Duration Extender: the imbued ability gets 18% cooldown reduction / 22% duration', () => {
  const hero = buildHero('Haze', { items: ['Compress Cooldown', 'Duration Extender'], imbues: { 'Compress Cooldown': 1, 'Duration Extender': 3 } });
  near(hero.abilities[0].imbued().cdr, 0.18); near(hero.abilities[2].imbued().duration, 0.22);
  assert.ok(!hero.abilities[0].imbued().duration && !hero.abilities[2].imbued().cdr);
});

test('Slowing Hex: +0.5 m/s; the active slows one enemy 16% for 3.5 s, every 29 s', () => {
  near(sheet(['Slowing Hex']).moveSpeed - BASE.moveSpeed, 0.5);
  const { enemies, fight, it } = setup(['Slowing Hex']);
  it().cast(fight);
  const d = status(enemies[0], 'Slowing Hex:slow');
  near(d.mods.slow, 0.16); near(d.until - fight.time, 3.5); near(it().cooldown, 29);
});

test('Spirit Sap: +50 health; the active takes 9% spirit resist and 30 spirit power off an enemy for 12 s, every 18 s', () => {
  near(sheet(['Spirit Sap']).maxHealth - BASE.maxHealth, 50);
  const { enemies, fight, it } = setup(['Spirit Sap']);
  it().cast(fight);
  const d = status(enemies[0], 'Spirit Sap:sap');
  near(d.mods.spiritResist, -0.09); near(d.mods.spirit, -30); near(d.until - fight.time, 12); near(it().cooldown, 18);
});

test('Arcane Surge: +1 stamina, +12% stamina recovery; a dash-jump gives the next ability cast within 7 s +12% range, +15% duration, +20 spirit, kept by that cast', () => {
  const s = sheet(['Arcane Surge']);
  near(s.stamina - BASE.stamina, 1); near(s.staminaCdr - (BASE.staminaCdr ?? 0), 0.12);
  const { hero, fight } = setup(['Arcane Surge']);
  const [a, b] = hero.abilities;
  fight.emit('cast', { source: hero, ability: a });
  assert.deepStrictEqual(a.imbued(), {}, 'no dash, nothing');
  fight.emit('dash', { source: hero });
  fight.emit('cast', { source: hero, ability: a });
  near(a.imbued().spirit, 20); near(a.imbued().range, 0.12); near(a.imbued().duration, 0.15);
  near(a.spirit() - hero.stats.spirit, 20);
  fight.emit('cast', { source: hero, ability: b });
  assert.deepStrictEqual(b.imbued(), {}, 'used up by the first cast');
  near(a.imbued().spirit, 20, 'kept while the first cast lasts');
  fight.emit('cast', { source: hero, ability: a });
  assert.deepStrictEqual(a.imbued(), {}, 'gone at its next cast');
  fight.emit('dash', { source: hero });
  fight.time += 7.1;
  fight.emit('cast', { source: hero, ability: b });
  assert.deepStrictEqual(b.imbued(), {}, 'the 7 s window passed');
});

test('Cold Front: +6% spirit resist; the active deals 95 (+0.465 x spirit) spirit damage and slows 48% for 4 s within 10 m, every 25 s', () => {
  near(1 - (1 - sheet(['Cold Front']).spiritResist) / (1 - BASE.spiritResist), 0.06);
  const { enemies, fight, it } = setup(['Cold Front'], { foes: 4 });
  it().cast(fight);
  assert.deepStrictEqual(enemies.map((e) => +(1e6 - e.health).toFixed(6)), [95, 95, 95, 0], 'the 4th stands 12 m back');
  const d = status(enemies[0], 'Cold Front:slow');
  near(d.mods.slow, 0.48); near(d.until - fight.time, 4); near(it().cooldown, 25);
});

test('Suppressor: +6 spirit, +8% bullet resist; spirit damage cuts fire rate 28% for 4.5 s (a rival hero\'s gun; an NPC deals that much less)', () => {
  const s = sheet(['Suppressor']);
  near(s.spirit - BASE.spirit, 6); near(1 - (1 - s.bulletResist) / (1 - BASE.bulletResist), 0.08);
  const { hero, enemies, fight } = setup(['Suppressor']);
  fight.damage(hero, enemies[0], 10, 'spirit');
  const d = status(enemies[0], 'Suppressor:suppress');
  near(d.mods.damageDealt, -0.28); near(d.until - fight.time, 4.5);
  const rival = buildHero('Abrams', {});
  fight.emit('damage', { source: hero, target: rival, amount: 10, dealt: 10, type: 'spirit', opts: {} });
  near(status(rival, 'Suppressor:suppress').mods.fireRate, -0.28);
});

// ===== Batch 11: Spirit tier 3 =====
test('Silence Wave: +50 health; the active deals 75 (+0.7 x spirit) spirit damage and silences every enemy in its path for 3 s, every 42 s', () => {
  near(sheet(['Silence Wave']).maxHealth - BASE.maxHealth, 50);
  const { enemies, fight, it } = setup(['Silence Wave'], { foes: 3 });
  it().cast(fight);
  for (const e of enemies) { near(1e6 - e.health, 75); assert.ok(e.has('silence')); near(status(e, 'Silence Wave:silence').until - fight.time, 3); }
  near(it().cooldown, 42);
});

test('Greater Expansion: +30% ability (and item) range, +10% spirit resist', () => {
  const s = sheet(['Greater Expansion']);
  near(s.rangeMult - BASE.rangeMult, 0.3); near(1 - (1 - s.spiritResist) / (1 - BASE.spiritResist), 0.1);
});

test('Tankbuster: +50 health; charges for 14 s; an ability spirit hit of more than 165 deals 40 + 7.5% of current health (a share on NPCs), ignoring spirit resist', () => {
  near(sheet(['Tankbuster']).maxHealth - BASE.maxHealth, 50);
  const { hero, enemies, fight, it } = setup(['Tankbuster'], { hp: 2000 });
  const e = enemies[0];
  const ab = hero.abilities[0];
  fight.running(ab, () => fight.damage(hero, e, 165, 'spirit'));
  near(e.health, 1835, '165 is not more than 165');
  e.stats.spiritResist = 0.5;
  fight.running(ab, () => fight.damage(hero, e, 200, 'spirit'));
  near(e.health, 1735 - (40 + 0.075 * 1735 * 0.5), 'half of 7.5% on a camp enemy, no resist');
  near(it().cdLeft, 14);
});

test('Rapid Recharge: +2 charges, 30% less time between charges, 14% cooldown reduction and +14 spirit for charged abilities', () => {
  const s = sheet(['Rapid Recharge']);
  near(s.bonusCharges, 2); near(s.chargeGapCut, 0.3); near(s.chargedCdr, 0.14); near(s.chargedSpirit, 14);
  const hero = buildHero('Haze', { items: ['Rapid Recharge'], tiers: { 2: 2 } });
  assert.strictEqual(hero.abilities[1].maxCharges, 4);
});

test('Superior Cooldown: +20% ability cooldown reduction, +4 out-of-combat regen; Superior Duration: +28% duration, +8% bullet resist', () => {
  const c = sheet(['Superior Cooldown']);
  near(c.cdr - BASE.cdr, 0.2); near(c.oocRegen - BASE.oocRegen, 4);
  const d = sheet(['Superior Duration']);
  near(d.durationMult - BASE.durationMult, 0.28); near(1 - (1 - d.bulletResist) / (1 - BASE.bulletResist), 0.08);
});

test('Disarming Hex: +75 health, +0.75 m/s; the active disarms one enemy and takes 13% bullet resist for 4.25 s, every 16 s', () => {
  const s = sheet(['Disarming Hex']);
  near(s.maxHealth - BASE.maxHealth, 75); near(s.moveSpeed - BASE.moveSpeed, 0.75);
  const { enemies, fight, it } = setup(['Disarming Hex']);
  it().cast(fight);
  const d = status(enemies[0], 'Disarming Hex:disarm');
  assert.ok(enemies[0].has('disarm')); near(d.mods.bulletResist, -0.13); near(d.until - fight.time, 4.25); near(it().cooldown, 16);
});

test('Decay: +8 spirit, +65 health; 1.95% (+0.003 x spirit) of current health a second for 12 s (a share on NPCs), non-lethal, -50% healing, every 30 s', () => {
  const s = sheet(['Decay']);
  near(s.spirit - BASE.spirit, 8); near(s.maxHealth - BASE.maxHealth, 65);
  const { enemies, fight, it } = setup(['Decay'], { hp: 2000 });
  it().cast(fight);
  const dot = it().dots[0];
  near(dot.perSecond, (0.0195 + 0.00003 * 8) * 0.5); near(dot.until - fight.time, 12); assert.ok(dot.ofCurrent && dot.nonLethal);
  const d = status(enemies[0], 'Decay:heal');
  near(d.mods.healAmp, -0.5); near(d.until - fight.time, 12); near(it().cooldown, 30);
  enemies[0].health = 1;
  it().tick(fight, 1);
  assert.ok(enemies[0].alive, 'non-lethal');
});

test('Knockdown: +75 health, +5% ability range; the active stuns one enemy for 0.5 s after 2 s, every 35 s', () => {
  const s = sheet(['Knockdown']);
  near(s.maxHealth - BASE.maxHealth, 75); near(s.rangeMult - BASE.rangeMult, 0.05);
  const { enemies, fight, it } = setup(['Knockdown']);
  it().cast(fight);
  const start = fight.time;
  while (fight.time - start < 1.85) fight.step();
  assert.ok(!enemies[0].has('stun'), 'not yet');
  while (!enemies[0].has('stun') && fight.time - start < 2.2) fight.step();
  assert.ok(Math.abs(status(enemies[0], 'Knockdown:stun').until - (start + 2.5)) < 0.15, 'stunned at 2 s for 0.5 s');
  near(it().cooldown, 35);
});

test('Torment Pulse: +100 health; every 1.4 s, 25 (+0.23 x spirit) spirit damage to the two closest awake enemies within 9 m', () => {
  near(sheet(['Torment Pulse']).maxHealth - BASE.maxHealth, 100);
  const { enemies, fight, it } = setup(['Torment Pulse'], { foes: 4 });
  fight.addStatus(enemies[0], { id: 'nap', duration: 10, tags: ['sleep'] });
  it().tick(fight);
  assert.deepStrictEqual(enemies.map((e) => +(1e6 - e.health).toFixed(6)), [0, 25, 25, 0]);
  near(it().cdLeft, 1.4);
});

test('Spirit Snatch: +7% melee, +75 health; a melee hit deals 50 (+0.84 x spirit) and steals 12% spirit resist and 25 spirit for 10 s, every 6 s; lost when that enemy dies', () => {
  const s = sheet(['Spirit Snatch']);
  near(s.meleeDamage - BASE.meleeDamage, 0.07); near(s.maxHealth - BASE.maxHealth, 75);
  const { hero, enemies, fight, it } = setup(['Spirit Snatch'], { foes: 2 });
  fight.emit('melee', { source: hero, target: enemies[0], amount: 50, dealt: 50 });
  near(1e6 - enemies[0].health, 50);
  const d = status(enemies[0], 'Spirit Snatch:snatched');
  near(d.mods.spiritResist, -0.12); near(d.mods.spirit, -25); near(d.until - fight.time, 10);
  const b = status(hero, 'Spirit Snatch:snatch');
  near(b.mods.spiritResist, 0.12); near(b.mods.spirit, 25); near(it().cdLeft, 6);
  fight.emit('kill', { source: hero, target: enemies[1] });
  assert.ok(status(hero, 'Spirit Snatch:snatch'), 'another enemy dying changes nothing');
  fight.damage(hero, enemies[0], 2e6, 'true');
  assert.ok(!status(hero, 'Spirit Snatch:snatch'), 'gone with the enemy it came from');
});

test('Radiant Regeneration: +90 health; spirit damage gives 4 (+0.035 x spirit) regen for 7 s per enemy; a cast heals 65 (+1.7 a boon) and gives +1.75 m/s for 3 s, every 6 s', () => {
  near(sheet(['Radiant Regeneration']).maxHealth - BASE.maxHealth, 90);
  const { hero, enemies, fight, it } = setup(['Radiant Regeneration'], { foes: 2 });
  fight.damage(hero, enemies[0], 10, 'spirit'); fight.damage(hero, enemies[1], 10, 'spirit'); fight.damage(hero, enemies[0], 10, 'spirit');
  const regens = hero.statuses.filter((st) => st.id.startsWith('Radiant Regeneration:regen'));
  assert.strictEqual(regens.length, 2);
  for (const r of regens) { near(r.regen, 4); near(r.until - fight.time, 7); }
  hero.health = 100; hero.healPool = 1e9;
  fight.emit('cast', { source: hero, ability: hero.abilities[0] });
  near(hero.health, 165);
  const sp = status(hero, 'Radiant Regeneration:speed');
  near(sp.mods.moveSpeed, 1.75); near(sp.until - fight.time, 3); near(it().procLeft, 6);
  fight.emit('cast', { source: hero, ability: hero.abilities[0] });
  near(hero.health, 165, 'not again within 6 s');
});

test('Surge of Power: the imbued ability gets +28 spirit; casting it gives +20% fire rate and +1.75 m/s for 8 s, every 14 s', () => {
  const { hero, fight, it } = setup(['Surge of Power'], { imbues: { 'Surge of Power': 1 } });
  near(hero.abilities[0].imbued().spirit, 28);
  fight.emit('cast', { source: hero, ability: hero.abilities[1] });
  assert.ok(!status(hero, 'Surge of Power:surge'), 'only the imbued ability');
  fight.emit('cast', { source: hero, ability: hero.abilities[0] });
  const b = status(hero, 'Surge of Power:surge');
  near(b.mods.fireRate, 0.2); near(b.mods.moveSpeed, 1.75); near(b.until - fight.time, 8); near(it().cdLeft, 14);
});

// ===== Batch 12: Spirit tier 4 =====
// Lets `seconds` of fight go by with the hero's gun idle (only scheduled item effects happen).
const wait = (fight, hero, seconds) => {
  hero.weapon.clip = 0; hero.weapon.reloadLeft = 1e9; hero.stats.healthRegen = 0;
  const end = fight.time + seconds - 1e-9;
  while (fight.time < end) fight.step();
};

test('Mystic Reverb: +8% spirit lifesteal; the imbued ability heals 22% more (multiplying), and its hit echoes 50% 3 s later onto enemies within 16 m with a 32% slow, every 6.25 s', () => {
  near(sheet(['Mystic Reverb']).spiritLifesteal - BASE.spiritLifesteal, 0.08);
  const { hero, enemies, fight, it } = setup(['Mystic Reverb'], { foes: 2, imbues: { 'Mystic Reverb': 1 } });
  const ab = hero.abilities[0];
  hero.health = 100; hero.healPool = 1e9;
  fight.running(ab, () => fight.damage(hero, enemies[0], 100, 'melee'));
  near(hero.health, 100, 'melee: nothing'); near(it().cdLeft, 0);
  fight.running(ab, () => fight.damage(hero, enemies[0], 100, 'spirit'));
  near(hero.health, 100 + 100 * 0.08 * 0.4 + 100 * 0.22 * (1 - 0.08) * 0.4, 'its 8% and the imbue 22% stack like 8% + 22% x 92%, at the NPC 40%');
  near(it().cdLeft, 6.25);
  wait(fight, hero, 3);
  near(1e6 - enemies[1].health, 50, 'the echo reaches the one behind');
  const slow = status(enemies[1], 'Mystic Reverb:slow');
  near(slow.mods.slow, 0.32);
  assert.ok(hero.health > 100 + 3.2 + 8.096, 'the echo heals too');
});

test('Escalating Exposure: +17% spirit resist; spirit damage takes 8% spirit resist and adds a 4.5% amp stack (one every 0.7 s, up to 12) for 12 s', () => {
  near(1 - (1 - sheet(['Escalating Exposure']).spiritResist) / (1 - BASE.spiritResist), 0.17);
  const { hero, enemies, fight, it } = setup(['Escalating Exposure']);
  const e = enemies[0];
  const amp = () => status(e, 'Escalating Exposure:amp')?.mods.spiritAmp ?? 0;
  fight.damage(hero, e, 10, 'spirit');
  near(e.mod('spiritResist'), -0.08); near(amp(), 0.045); near(it().cdLeft, 0.7);
  fight.damage(hero, e, 10, 'spirit');
  near(amp(), 0.045, 'one stack every 0.7 s');
  for (let i = 0; i < 15; i++) { it().cdLeft = 0; fight.damage(hero, e, 10, 'spirit'); }
  near(amp(), 0.54, '12 stacks at most'); near(status(e, 'Escalating Exposure:amp').until - fight.time, 12);
  fight.removeStatus(e, 'Escalating Exposure:amp');
  it().cdLeft = 0;
  fight.damage(hero, e, 10, 'spirit');
  near(amp(), 0.045, 'run out: from one again');
});

test('Transcendent Cooldown: +25% ability and +25% item cooldown reduction, +4 out-of-combat regen; charge-up items are not shortened', () => {
  const s = sheet(['Transcendent Cooldown']);
  near(s.cdr - BASE.cdr, 0.25); near(s.itemCdr, 0.25); near(s.oocRegen - BASE.oocRegen, 4);
  const hero = buildHero('Haze', { items: ['Transcendent Cooldown', 'Rusted Barrel', 'Mercurial Magnum'] });
  near(hero.items.find((i) => i.name === 'Rusted Barrel').cooldown, 12);
  near(hero.items.find((i) => i.name === 'Mercurial Magnum').cooldown, 14);
});

test('Focus Lens: +10% fire rate; silences an enemy 4.5 s and then deals 35% of the damage it took meanwhile; -9% spirit resist and -30 spirit for 12 s; every 45 s', () => {
  near(sheet(['Focus Lens']).fireRate / BASE.fireRate, 1.1);
  const { hero, enemies, fight, it } = setup(['Focus Lens']);
  const e = enemies[0];
  it().cast(fight);
  assert.ok(e.has('silence')); near(status(e, 'Focus Lens:silence').until - fight.time, 4.5);
  const d = status(e, 'Focus Lens:focus');
  near(d.mods.spiritResist, -0.09); near(d.mods.spirit, -30); near(d.until - fight.time, 12); near(it().cooldown, 45);
  fight.damage(hero, e, 1000, 'true');
  wait(fight, hero, 4.5);
  near(1e6 - e.health, 1000 + 350 * 1.09, '35% of it, through the -9% spirit resist');
});

test('Scourge: +100 health; for 10 s, +40% spirit resist, +20% debuff resist and 2.3% (+0.0055 x spirit) of max health a second to enemies within 10 m (a share on NPCs); every 35 s', () => {
  near(sheet(['Scourge']).maxHealth - BASE.maxHealth, 100);
  const { hero, enemies, fight, it } = setup(['Scourge'], { foes: 4, hp: 2000 });
  it().cast(fight);
  const b = status(hero, 'Scourge:resist');
  near(b.mods.spiritResist, 0.4); near(b.mods.statusResist, 0.2); near(b.until - fight.time, 10); near(it().cooldown, 35);
  it().tick(fight, 1);
  assert.deepStrictEqual(enemies.map((e) => +(2000 - e.health).toFixed(6)), [23, 23, 23, 0], '2.3% of 2,000, half on a camp enemy... x 0.5');
});

test('Vortex Web: +8% ability range, +0.75 m/s; pulls the enemies within 12 m together, holds them 0.5 s and slows them 28% for 4 s; every 42 s', () => {
  const s = sheet(['Vortex Web']);
  near(s.rangeMult - BASE.rangeMult, 0.08); near(s.moveSpeed - BASE.moveSpeed, 0.75);
  const { enemies, fight, it } = setup(['Vortex Web'], { foes: 3 });
  it().cast(fight);
  assert.strictEqual(new Set(enemies.map((e) => e.offset ?? 0)).size, 1, 'pulled to one spot');
  for (const e of enemies) {
    near(status(e, 'Vortex Web:pull').until - fight.time, 0.5); assert.ok(e.has('immobilize'));
    near(status(e, 'Vortex Web:slow').mods.slow, 0.28); near(status(e, 'Vortex Web:slow').until - fight.time, 4);
  }
  near(it().cooldown, 42);
});

test('Refresher: every ability cooldown and charge back, not item cooldowns; every 300 s', () => {
  const { hero, fight, it } = setup(['Refresher', 'Rusted Barrel']);
  it('Rusted Barrel').cdLeft = 10;
  it().cast(fight);
  assert.ok(hero.abilities.every((a) => a.cdLeft === 0));
  near(it('Rusted Barrel').cdLeft, 10, 'items keep theirs');
  near(it().cooldown, 300);
});

test('Echo Shard: +5% bullet and spirit resist; resets the imbued non-ultimate ability (a charged one gets one charge); its cooldown is 30 s + that ability\'s', () => {
  const s = sheet(['Echo Shard']);
  near(1 - (1 - s.bulletResist) / (1 - BASE.bulletResist), 0.05); near(1 - (1 - s.spiritResist) / (1 - BASE.spiritResist), 0.05);
  const { hero, fight, it } = setup(['Echo Shard'], { imbues: { 'Echo Shard': 2 }, tiers: { 2: 2 } });
  const smoke = hero.abilities[1];
  near(it().cooldown, 30 + smoke.cooldown);
  smoke.charges = 0;
  assert.ok(it().want(fight));
  it().cast(fight);
  assert.strictEqual(smoke.charges, 1, 'one charge');
  const ult = setup(['Echo Shard'], { imbues: { 'Echo Shard': 4 } });
  ult.hero.abilities[3].cdLeft = 60;
  assert.ok(!ult.it().want(ult.fight), 'not an ultimate');
});

test('Arctic Blast: +10% spirit resist; 175 (+0.6975 x spirit) spirit damage within 16 m, a 1 s freeze and a 48% slow for 4 s starting with it; every 24 s', () => {
  near(1 - (1 - sheet(['Arctic Blast']).spiritResist) / (1 - BASE.spiritResist), 0.1);
  const { enemies, fight, it } = setup(['Arctic Blast'], { foes: 6 });
  it().cast(fight);
  assert.deepStrictEqual(enemies.map((e) => +(1e6 - e.health).toFixed(6)), [175, 175, 175, 175, 175, 0], 'the 6th stands 20 m back');
  const f = status(enemies[0], 'Arctic Blast:freeze');
  const sl = status(enemies[0], 'Arctic Blast:slow');
  assert.ok(enemies[0].has('stun')); near(f.until - fight.time, 1); near(sl.mods.slow, 0.48); near(sl.until - fight.time, 4); near(it().cooldown, 24);
});

test('Ethereal Shift: 4 s where nothing can hurt the hero, then +20 spirit, +30% spirit resist, +3 m/s for 5 s; every 37 s', () => {
  const { hero, fight, it } = setup(['Ethereal Shift']);
  it().cast(fight);
  const v = status(hero, 'Ethereal Shift:void');
  assert.ok(hero.has('void')); near(v.mods.damageTaken, -1); near(v.until - fight.time, 4); near(it().cooldown, 37);
  wait(fight, hero, 4.05);
  const a = status(hero, 'Ethereal Shift:after');
  near(a.mods.spirit, 20); near(a.mods.spiritResist, 0.3); near(a.mods.moveSpeed, 3); assert.ok(Math.abs(a.until - fight.time - 5) < 0.11);
});

test('Cursed Relic: a 0.3 s stun, then 3.25 s silenced, disarmed and no items, and its buffs gone (not its ultimate\'s, none if unstoppable); the holder deals 25% less; every 55 s', () => {
  const rival = buildHero('Abrams', {});
  const { hero, fight, it } = setup(['Cursed Relic']);
  fight.enemies = [rival];
  const ult = rival.abilities.find((a) => a.ultimate).name;
  fight.addStatus(rival, { id: 'Some Item:buff', duration: 10, mods: { spirit: 10 } });
  fight.addStatus(rival, { id: `${ult}:buff`, duration: 10, mods: { spirit: 10 } });
  fight.addStatus(rival, { id: 'Other:slow', duration: 10, mods: { slow: 0.2 }, debuff: true });
  it().cast(fight);
  assert.ok(!status(rival, 'Some Item:buff'), 'a buff: removed');
  assert.ok(status(rival, `${ult}:buff`) && status(rival, 'Other:slow'), 'its ultimate\'s and the debuffs stay');
  near(status(rival, 'Cursed Relic:stun').until - fight.time, 0.3);
  const c = status(rival, 'Cursed Relic:curse');
  assert.deepStrictEqual(c.tags, ['silence', 'disarm', 'noItems']); near(c.until - fight.time, 3.25);
  near(status(hero, 'Cursed Relic:penalty').mods.damageDealt, -0.25); near(it().cooldown, 55);
  const tough = buildHero('Abrams', {});
  const t = setup(['Cursed Relic']);
  t.fight.enemies = [tough];
  t.fight.addStatus(tough, { id: 'Unstoppable:buff', duration: 10, tags: ['unstoppable'] });
  t.fight.addStatus(tough, { id: 'Some Item:buff', duration: 10, mods: { spirit: 10 } });
  t.it().cast(t.fight);
  assert.ok(status(tough, 'Some Item:buff'), 'unstoppable: keeps its buffs');
});

test('Boundless Spirit: +30 spirit, +15% spirit power (of every source, temporary too), +75 health, +4 out-of-combat regen', () => {
  const s = sheet(['Boundless Spirit']);
  near(s.spirit - BASE.spirit, 34.5); near(s.maxHealth - BASE.maxHealth, 75); near(s.oocRegen - BASE.oocRegen, 4);
  const { hero, fight } = setup(['Boundless Spirit']);
  fight.addStatus(hero, { id: 'x', duration: 10, mods: { spirit: 20 } });
  near(hero.abilities[0].spirit() - hero.stats.spirit, 23);
});

test('Mercurial Magnum: +7 spirit, 14 s charge-up; casting the imbued ability reloads, +22% fire rate for 12 s, +60 (+0.16 x spirit) on its hit; after any imbued cast bullets deal 20 (+0.38 x spirit) until a reload', () => {
  near(sheet(['Mercurial Magnum']).spirit - BASE.spirit, 7);
  const { hero, enemies, fight, it } = setup(['Mercurial Magnum'], { imbues: { 'Mercurial Magnum': 1 } });
  const e = enemies[0];
  near(it().cooldown, 14);
  it().cdLeft = 5;
  fight.emit('cast', { source: hero, ability: hero.abilities[0] });
  assert.ok(!status(hero, 'Mercurial Magnum:quick'), 'still charging: no fire rate');
  fight.emit('bulletHit', { source: hero, target: e, amount: 10, dealt: 10, type: 'bullet', opts: {} });
  near(1e6 - e.health, 20 + 0.38 * 7, 'the bullets have it anyway');
  fight.emit('reloadStart', { source: hero });
  fight.emit('bulletHit', { source: hero, target: e, amount: 10, dealt: 10, type: 'bullet', opts: {} });
  assert.ok(1e6 - e.health < 20 + 0.38 * 7 + 1, 'until the reload'); // (Haze's Fixation adds a sliver of its own)
  it().cdLeft = 0;
  fight.emit('cast', { source: hero, ability: hero.abilities[0] });
  near(status(hero, 'Mercurial Magnum:quick').mods.fireRate, 0.22);
  const hp = e.health;
  fight.emit('damage', { source: hero, target: e, amount: 10, dealt: 10, type: 'spirit', opts: { ability: hero.abilities[0] } });
  near(hp - e.health, 60 + 0.16 * 7, 'its hit');
  const was = 1e6 - e.health;
  fight.emit('damage', { source: hero, target: e, amount: 10, dealt: 10, type: 'spirit', opts: { ability: hero.abilities[0] } });
  near(1e6 - e.health - was, 0, 'once');
});

test('Magic Carpet: +125 health, +14 spirit, +15% ability duration; every 32 s', () => {
  const s = sheet(['Magic Carpet']);
  near(s.maxHealth - BASE.maxHealth, 125); near(s.spirit - BASE.spirit, 14); near(s.durationMult - BASE.durationMult, 0.15);
  near(buildHero('Haze', { items: ['Magic Carpet'] }).items[0].cooldown, 32);
});

test('Spirit Burn: +6% ability range; 500 spirit damage to one enemy within 5 s explodes for 50 and burns 24 (+0.06 x spirit) a second for 8 s with -70% healing; half on non-heroes; each enemy once per 20 s', () => {
  near(sheet(['Spirit Burn']).rangeMult - BASE.rangeMult, 0.06);
  const { hero, enemies, fight, it } = setup(['Spirit Burn']);
  const e = enemies[0];
  fight.damage(hero, e, 499, 'spirit');
  near(1e6 - e.health, 499);
  fight.damage(hero, e, 1, 'spirit');
  near(1e6 - e.health, 500 + 25, 'half the explosion on an NPC');
  near(it().dots[0].perSecond, 12); near(status(e, 'Spirit Burn:burn').mods.healAmp, -0.7);
  fight.damage(hero, e, 500, 'spirit');
  near(1e6 - e.health, 1025, 'immune for 20 s');
  const rival = buildHero('Abrams', {});
  fight.emit('damage', { source: hero, target: rival, amount: 500, dealt: 500, type: 'spirit', opts: {} });
  near(it().dots.find((d) => d.target === rival).perSecond, 24, 'in full on a hero');
});

test('Lightning Scroll: +50 health, +0.75 m/s; spirit damage slows 24% for 2 s (Mystic Slow); the ultimate\'s hit slows 64%, then 3 s later stuns 0.75 s and deals 150', () => {
  const s = sheet(['Lightning Scroll']);
  near(s.maxHealth - BASE.maxHealth, 50); near(s.moveSpeed - BASE.moveSpeed, 0.75);
  const { hero, enemies, fight } = setup(['Lightning Scroll']);
  const e = enemies[0];
  const slow = () => status(e, 'Lightning Scroll:slow');
  fight.damage(hero, e, 10, 'spirit');
  near(slow().mods.slow, 0.24); near(slow().until - fight.time, 2);
  fight.running(hero.abilities[3], () => fight.damage(hero, e, 10, 'spirit'));
  near(slow().mods.slow, 0.64, 'the ultimate\'s');
  fight.damage(hero, e, 10, 'spirit');
  near(slow().mods.slow, 0.64, 'Mystic Slow does not weaken it');
  const before = e.health;
  wait(fight, hero, 3.05);
  near(before - e.health, 150);
  assert.ok(Math.abs(status(e, 'Lightning Scroll:stun').until - fight.time - 0.75) < 0.11);
});

// ===== Batch 13: the 17 legendaries (deadlock-api.com's cards; Eternal Gift's buffs: test/itemsystems.test.js) =====
test('Omnicharge Signet: +4 charges on a charged ability, +2 on one without (then it counts as charged), not an ultimate; +50 spirit, 30% cooldown cut, 70% shorter gaps for charged abilities', () => {
  const s = sheet(['Omnicharge Signet']);
  near(s.chargedSpirit, 50); near(s.chargedCdr, 0.3); near(s.chargeGapCut, 0.7);
  const charged = buildHero('Haze', { items: ['Omnicharge Signet'], imbues: { 'Omnicharge Signet': 2 }, tiers: { 2: 2 } });
  assert.strictEqual(charged.abilities[1].maxCharges, 6);
  const plain = buildHero('Haze', { items: ['Omnicharge Signet', 'Extra Charge'], imbues: { 'Omnicharge Signet': 1 } });
  const dagger = plain.abilities[0];
  assert.ok(dagger.charged); assert.strictEqual(dagger.maxCharges, 1 + 2 + 1, 'Extra Charge adds to it too');
  near(dagger.spirit() - plain.stats.spirit, 50 + 7);
  const ult = buildHero('Haze', { items: ['Omnicharge Signet'], imbues: { 'Omnicharge Signet': 4 } });
  assert.strictEqual(ult.abilities[3].maxCharges, 1, 'an ultimate gets nothing');
});

test('Shrink Ray: +5 m/s and +20% fire rate (and the evasion placeholder) for 60 s, every 30 s', () => {
  const { hero, fight, it } = setup(['Shrink Ray']);
  it().cast(fight);
  const b = status(hero, 'Shrink Ray:shrink');
  near(b.mods.moveSpeed, 5); near(b.mods.fireRate, 0.2); near(b.until - fight.time, 60); near(it().cooldown, 30);
});

test('Infinite Rounds: +35% fire rate, a clip that never runs out; 65% of bullets ignore bullet resist and evasion and pierce', () => {
  near(sheet(['Infinite Rounds']).fireRate / BASE.fireRate, 1.35);
  const { hero, fight, it } = setup(['Infinite Rounds'], { rng: () => 0.6 });
  it().tick(fight);
  assert.ok(hero.has('infiniteClip'));
  assert.deepStrictEqual(it().shotOpts(fight), { ignoreBulletResist: true, unavoidable: true, pierce: true });
  const miss = setup(['Infinite Rounds'], { rng: () => 0.7 });
  assert.strictEqual(miss.it().shotOpts(miss.fight).pierce, false);
});

test('Seraphim Wings: +120% stamina recovery; airborne, +40% damage dealt and -40% taken', () => {
  near(sheet(['Seraphim Wings']).staminaCdr - (BASE.staminaCdr ?? 0), 1.2);
  const { hero, fight, it } = setup(['Seraphim Wings']);
  assert.strictEqual(it().dynamicMods(fight), null);
  fight.addStatus(hero, { id: 'jump', duration: 1, tags: ['airborne'] });
  assert.deepStrictEqual(it().dynamicMods(fight), { damageDealt: 0.4, damageTaken: -0.4 });
});

test('Mystical Piano: 1.7 s later, enemies within 12 m are stunned 2 s, then dazed 2 s (slowed, disarmed, silenced, no items); every 23 s', () => {
  const { hero, enemies, fight, it } = setup(['Mystical Piano'], { foes: 5 });
  it().cast(fight);
  wait(fight, hero, 1.75);
  assert.deepStrictEqual(enemies.map((e) => e.has('stun')), [true, true, true, true, false], 'the 5th stands 16 m back');
  wait(fight, hero, 2);
  assert.deepStrictEqual(status(enemies[0], 'Mystical Piano:daze').tags, ['disarm', 'silence', 'noItems']);
  near(it().cooldown, 23);
});

test('Nullification Burst: +40% debuff resist, +300 health; 250 (+0.465 x spirit) spirit damage within 20 m, buffs taken off, no healing for 7 s; every 18 s', () => {
  const s = sheet(['Nullification Burst']);
  near(s.statusResist - BASE.statusResist, 0.4); near(s.maxHealth - BASE.maxHealth, 300);
  const { hero, enemies, fight, it } = setup(['Nullification Burst'], { foes: 2 });
  hero.stats.spirit = 100;
  fight.addStatus(enemies[0], { id: 'Boss:shield', duration: 10, mods: { damageTaken: -0.5 } });
  it().cast(fight);
  assert.ok(!status(enemies[0], 'Boss:shield'), 'buff gone');
  near(1e6 - enemies[0].health, 250 + 46.5); near(1e6 - enemies[1].health, 250 + 46.5);
  const d = status(enemies[0], 'Nullification Burst:null');
  near(d.mods.healAmp, -1); near(d.until - fight.time, 7); near(it().cooldown, 18);
});

test('Celestial Blessing: below half health, heals 60% of max health (at least 400), cleanses, +5 m/s and +100% stamina recovery for 6 s; every 30 s', () => {
  const { hero, fight, it } = setup(['Celestial Blessing']);
  hero.healPool = 1e9; hero.health = 1;
  fight.addStatus(hero, { id: 'Enemy:slow', duration: 10, mods: { slow: 0.3 }, debuff: true });
  it().cast(fight);
  near(hero.health, 1 + Math.max(400, 0.6 * hero.stats.maxHealth));
  assert.ok(status(hero, 'Enemy:slow').until <= fight.time, 'cleansed');
  const b = status(hero, 'Celestial Blessing:blessing');
  near(b.mods.moveSpeed, 5); near(b.mods.staminaCdr, 1); near(b.until - fight.time, 6); near(it().cooldown, 30);
});

test('Eternal Gift: a permanent buff every 165 s of fights (play.js); a Rejuv\'s wait is 70% shorter once per 165 s', () => {
  const { fight, it } = setup(['Eternal Gift']);
  near(it().cooldown, 165);
  near(it().respawnCut(fight), 0.7);
  near(it().respawnCut(fight), 0, 'once per cooldown');
});

test('Mystic Conduit: +40% ability range and cooldown reduction; 300 damage within 5 s heals 700, every 25 s', () => {
  const s = sheet(['Mystic Conduit']);
  near(s.rangeMult - BASE.rangeMult, 0.4); near(s.cdr - BASE.cdr, 0.4);
  const { hero, enemies, fight, it } = setup(['Mystic Conduit']);
  hero.healPool = 1e9; hero.health = 20;
  fight.damage(hero, enemies[0], 299, 'true');
  near(hero.health, 20);
  fight.damage(hero, enemies[0], 1, 'true');
  near(hero.health, 720); near(it().cdLeft, 25);
});

test('Haunting Shot: every 2.5 s a bullet deals 10% of current health (a share on NPCs) and curses for 4 s: -40% damage, -40% healing, 32% slow; it goes through to the one behind', () => {
  const { hero, enemies, fight, it, hit } = setup(['Haunting Shot'], { foes: 2, hp: 2000 });
  hit();
  for (const e of enemies) {
    near(2000 - e.health, 0.1 * 2000 * 0.5);
    const d = status(e, 'Haunting Shot:haunt');
    near(d.mods.damageDealt, -0.4); near(d.mods.healAmp, -0.4); near(d.mods.slow, 0.32); near(d.until - fight.time, 4);
  }
  near(it().cdLeft, 2.5);
  hit();
  assert.ok(2000 - enemies[0].health < 101, 'not again within 2.5 s'); // (Haze's Fixation adds a sliver of its own)
  assert.ok(hero.alive);
});

test('Cloak of Opportunity: blocks the next curse or stomp, then 4 s unstoppable and a 500 barrier with +3 m/s for 6 s; every 12 s', () => {
  const { hero, fight, it } = setup(['Cloak of Opportunity']);
  const cc = { target: hero, blocked: false };
  fight.emit('cc', cc);
  assert.ok(cc.blocked);
  near(status(hero, 'Cloak of Opportunity:unstoppable').until - fight.time, 4); assert.ok(hero.has('unstoppable'));
  const b = status(hero, 'Cloak of Opportunity:barrier');
  near(b.barrier, 500); near(b.mods.moveSpeed, 3); near(b.until - fight.time, 6); near(it().cdLeft, 12);
});

test('Runed Gauntlets: +30% melee damage; a heavy melee cuts every running ability cooldown 16% (at least 4 s), every 10 s', () => {
  near(sheet(['Runed Gauntlets']).meleeDamage - BASE.meleeDamage, 0.3);
  const { hero, enemies, fight, it } = setup(['Runed Gauntlets']);
  hero.abilities[0].cdLeft = 50; hero.abilities[1].cdLeft = 10; hero.abilities[2].cdLeft = 0; hero.abilities[3].cdLeft = 2;
  fight.emit('melee', { source: hero, target: enemies[0], amount: 50, dealt: 50 });
  assert.deepStrictEqual(hero.abilities.map((a) => +a.cdLeft.toFixed(6)), [42, 6, 0, 0]);
  near(it().cdLeft, 10);
});

test('Electric Slippers: +2 stamina, +80% slide; sliding, 60% evasion and +60% fire rate, and 100 spirit damage to each enemy within 12 m, each at most every 0.3 s', () => {
  const s = sheet(['Electric Slippers']);
  near(s.stamina - BASE.stamina, 2); near(s.slideScale, 0.8);
  const { hero, enemies, fight, it } = setup(['Electric Slippers'], { foes: 4 });
  fight.addStatus(hero, { id: 'sliding', duration: 1, tags: ['sliding'] });
  assert.deepStrictEqual(it().dynamicMods(fight), { evasion: 0.6, fireRate: 0.6 });
  it().tick(fight); it().tick(fight);
  assert.deepStrictEqual(enemies.map((e) => +(1e6 - e.health).toFixed(6)), [100, 100, 100, 100]);
});

test('Prism Blast: 6 s untouchable, its beams dealing 270 (+1.75 x spirit) a second to enemies within 30 m of the hero; every 40 s', () => {
  const { hero, enemies, fight, it } = setup(['Prism Blast'], { foes: 6, distance: 10 });
  it().cast(fight);
  assert.ok(hero.has('void')); near(status(hero, 'Prism Blast:void').until - fight.time, 6); near(it().cooldown, 40);
  it().tick(fight, 1);
  assert.deepStrictEqual(enemies.map((e) => +(1e6 - e.health).toFixed(6)), [270, 270, 270, 270, 270, 270], '10 m + 20 m back: all in reach');
  const far = setup(['Prism Blast'], { foes: 6, distance: 15 });
  far.it().cast(far.fight); far.it().tick(far.fight, 1);
  assert.deepStrictEqual(far.enemies.map((e) => +(1e6 - e.health).toFixed(6)), [270, 270, 270, 270, 0, 0], '15 m away: the last two are past 30 m');
});

test('Unstable Concoction: 4 s unstoppable with +3000 health, +10 m/s, +150 spirit, +150% weapon damage, then 30% of max health to enemies within 22 m, a 3 s stun, and the hero at 1 health; every 25 s', () => {
  const { hero, enemies, fight, it } = setup(['Unstable Concoction'], { foes: 2 });
  const max = hero.stats.maxHealth;
  fight.useItem(it());
  near(hero.stats.maxHealth, max + 3000);
  const b = status(hero, 'Unstable Concoction:concoction');
  near(b.mods.moveSpeed, 10); near(b.mods.spirit, 150); near(b.mods.weaponDamage, 1.5); assert.ok(hero.has('unstoppable')); near(it().cooldown, 25);
  wait(fight, hero, 4.05);
  for (const e of enemies) { near(1e6 - e.health, 0.3 * (max + 3000)); assert.ok(e.has('stun')); }
  near(hero.health, 1); near(hero.stats.maxHealth, max);
});

test('Frostbite Charm: the imbued ability gets 50% cooldown reduction and +70 spirit; its hit freezes 1 s and deals 200, each enemy at most every 10 s', () => {
  const { hero, enemies, fight } = setup(['Frostbite Charm'], { imbues: { 'Frostbite Charm': 1 } });
  near(hero.abilities[0].imbued().cdr, 0.5); near(hero.abilities[0].imbued().spirit, 70);
  fight.running(hero.abilities[0], () => fight.damage(hero, enemies[0], 10, 'spirit'));
  near(1e6 - enemies[0].health, 210); near(status(enemies[0], 'Frostbite Charm:freeze').until - fight.time, 1);
  fight.running(hero.abilities[0], () => fight.damage(hero, enemies[0], 10, 'spirit'));
  near(1e6 - enemies[0].health, 220, 'not again within 10 s');
});

test('Shadow Strike: +3 stamina, +350 health; a dash makes the hero invisible 3 s; a melee out of it steals 40% bullet and spirit resist for 6 s and burns 125 (+0.4 x spirit) a second', () => {
  const s = sheet(['Shadow Strike']);
  near(s.stamina - BASE.stamina, 3); near(s.maxHealth - BASE.maxHealth, 350);
  const { hero, enemies, fight, it } = setup(['Shadow Strike']);
  hero.stats.spirit = 100;
  fight.emit('dash', { source: hero });
  near(status(hero, 'Shadow Strike:shadow').until - fight.time, 3); assert.ok(hero.has('invisible'));
  fight.damage(hero, enemies[0], 50, 'melee', { melee: true });
  const d = status(enemies[0], 'Shadow Strike:stolen');
  near(d.mods.bulletResist, -0.4); near(d.mods.spiritResist, -0.4); near(d.until - fight.time, 6);
  near(status(hero, 'Shadow Strike:steal').mods.bulletResist, 0.4);
  near(it().dots[0].perSecond, 125 + 40);
});
