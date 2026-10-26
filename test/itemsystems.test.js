// Run: node --test
// Hero Farming: the systems that let every item work (his calls, Oct 3; server-plan.md "Every item in fights, corruption"): melee, dashes, charges,
// imbues, crowd control on the hero, silence and slows on enemies, healing, parries, souls items, corruption, the egg and Eternal Gift.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { Fight, enemy, MELEE, dodgeChance } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');
const { heroStats, HEROES, itemByName, corruptCard, effectValue, DRAWBACKS } = require('../src/utils/farm/stats');
const { brokerOpen, brokerNext, rollDrawback, sellPrice, ITEM_POOL } = require('../src/utils/farm/levels');
const { getFarmUser, chooseHero, buyItem, sellItem, corruptItem, setImbue, hatchEgg, afterFight, updateFarmUser, setCooldowns, simulate } = require('../src/utils/farm/play');
const views = require('../src/utils/farm/views');
// the current hero's own souls (his call, Oct 11: farm souls are per hero, apart from the server balance)
const giveSouls = (id, n) => updateFarmUser(id, (r) => { r.souls += n; });
const heroSouls = async (id) => (await getFarmUser(id)).souls;

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const member = (id) => ({ id, guild: { emojis: { cache: { find: () => undefined } } }, toString: () => `<@${id}>` });
const steps = (f, n) => { for (let i = 0; i < n; i++) f.step(); };
// A hero with its gun only (abilities waiting) and no dashing unless asked; dummies that never hurt unless given dps.
function setup(items = [], { foes = 1, dps = 0, hp = 1e6, distance = 15, hero: name = 'Haze', move = false, rng = () => 0.5, ...kit } = {}) {
  const hero = buildHero(name, { items, ...kit });
  hero.abilities.forEach((a) => { a.cdLeft = 1e9; });
  if (!move) { hero.stamina = 0; hero.stats.stamina = 0; hero.nextSlide = Infinity; }
  const enemies = Array.from({ length: foes }, (_, i) => enemy(`Dummy ${i + 1}`, { maxHealth: hp, dps, distance }));
  return { hero, enemies, fight: new Fight({ heroes: [hero], enemies, rng }) };
}

// ---- melee ----
test('melee only with a reason: a helpless enemy, a reload, or a ready melee item', () => {
  const idle = setup();
  steps(idle.fight, 10);
  assert.ok(idle.hero.meleeAt === 0, 'shooting a healthy enemy with ammo: no swing');

  const stunned = setup();
  stunned.fight.addStatus(stunned.enemies[0], { id: 'stun', duration: 5, tags: ['stun'] });
  stunned.fight.step();
  assert.ok(stunned.hero.meleeAt > 0, 'a stunned enemy gets meleed');
  assert.strictEqual(stunned.hero.close, stunned.enemies[0], 'and the hero stands next to it');
  assert.strictEqual(stunned.fight.distance(stunned.hero, stunned.enemies[0]), MELEE.closeDistance);

  const reloading = setup();
  reloading.hero.weapon.reloadLeft = 2;
  reloading.fight.step();
  assert.ok(reloading.hero.meleeAt > 0, 'a reload is a reason');

  const item = setup(['Spirit Strike']);
  item.fight.step();
  assert.ok(item.hero.meleeAt > 0 && item.hero.items[0].cdLeft > 0, 'a ready melee item is a reason, and it procs');
  assert.ok(item.enemies[0].mod('spiritResist') < 0, 'Spirit Strike shreds spirit resist');
});

test('a heavy melee deals the wiki melee damage, more with melee items, and Lifestrike / Abrams T2 heal from it', () => {
  const plain = setup();
  plain.fight.melee(plain.hero, plain.enemies[0]);
  const base = plain.enemies[0].stats.maxHealth - plain.enemies[0].health;
  assert.strictEqual(base, HEROES.Haze.HeavyMeleeDamage);
  const charged = setup(['Melee Charge']); // +25% heavy melee on its cooldown, and its innate melee damage
  charged.fight.melee(charged.hero, charged.enemies[0]);
  assert.ok(charged.enemies[0].stats.maxHealth - charged.enemies[0].health > base * 1.3);
  const life = setup(['Lifestrike']);
  life.hero.health = 300;
  life.fight.melee(life.hero, life.enemies[0]);
  assert.ok(life.hero.health > 300 && life.enemies[0].mod('slow') > 0, 'Lifestrike heals and slows');
  const abrams = setup([], { hero: 'Abrams', tiers: { 3: 2 } });
  abrams.hero.health = 300;
  abrams.fight.melee(abrams.hero, abrams.enemies[0]);
  assert.ok(abrams.hero.health > 300, 'Infernal Resilience tier 2: melee lifesteal');
});

test('close range after a melee: Close Quarters and Stalker work up close, and the gun hurts more inside falloff', () => {
  const s = setup(['Close Quarters', 'Stalker'], { distance: 40 });
  const far = s.fight.shotDamage(s.hero, s.enemies[0]);
  s.fight.melee(s.hero, s.enemies[0]);
  assert.ok(s.fight.shotDamage(s.hero, s.enemies[0]) > far * 1.2);
  s.fight.damage(s.hero, s.enemies[0], 10, 'bullet');
  assert.ok(s.enemies[0].mod('bulletResist') < 0, 'Stalker wounds');
});

// ---- movement ----
test('dashes: one per stamina charge, airborne after each; Kinetic Dash and Seraphim Wings work from them; a stamina drawback means fewer', () => {
  const dashes = (items, corrupted) => {
    const s = setup(items, { move: true, corrupted });
    let n = 0;
    const emit = s.fight.emit.bind(s.fight);
    s.fight.emit = (event, p) => { if (event === 'dash') n++; return emit(event, p); };
    steps(s.fight, 100);
    return { n, s };
  };
  const plain = dashes([]);
  assert.ok(plain.n >= HEROES.Haze.Stamina, `${plain.n} dashes in 10 s`);
  const kinetic = setup(['Kinetic Dash'], { move: true });
  kinetic.fight.step();
  assert.ok(kinetic.hero.has('airborne') && kinetic.hero.mod('fireRate') > 0, 'airborne, and Kinetic Dash fire rate');
  const wings = setup(['Seraphim Wings'], { move: true });
  steps(wings.fight, 2); // the dash, then the wings' bonus on the next step
  assert.ok(wings.hero.mod('damageTaken') < 0 && wings.hero.mod('damageDealt') > 0, 'Seraphim Wings in the air');
  assert.ok(dashes(['Seraphim Wings']).n >= 9, 'its stamina recharge keeps the hero dashing every second, so in the air');
  const lessStamina = dashes(['Hollow Point'], { name: 'Hollow Point', drawback: 'stamina', amount: 2 });
  assert.ok(lessStamina.n < plain.n);
});

test('slides: Electric Slippers zap enemies around and dodge bullets while sliding', () => {
  const s = setup(['Electric Slippers'], { move: true, foes: 2 });
  s.hero.nextSlide = 0;
  steps(s.fight, 3);
  assert.ok(s.hero.has('sliding') && s.hero.mod('evasion') > 0);
  assert.ok(s.enemies.every((e) => e.health < e.stats.maxHealth));
});

// ---- charges and imbues ----
test('charges: Smoke Bomb tier 2 has two, Extra Charge adds one, Recharging Rush and Refresher give them back', () => {
  const smoke = (items) => buildHero('Haze', { items, tiers: { 2: 2 } }).abilities[1];
  assert.strictEqual(smoke([]).maxCharges, 2);
  assert.strictEqual(smoke(['Extra Charge']).maxCharges, 3);
  assert.strictEqual(buildHero('Haze', { items: ['Extra Charge'] }).abilities[0].maxCharges, 1, 'an ability without charges gets none');
  const a = smoke([]);
  a.use();
  assert.ok(a.charges === 1 && a.gapLeft > 0 && a.cdLeft > 0);
  assert.ok(!a.ready(), 'a gap between two charges');
  a.tickCooldown(a.gapLeft + 0.01);
  assert.ok(a.ready(), 'the second charge is there');
  const rush = setup(['Recharging Rush'], { tiers: { 2: 2 } });
  rush.hero.abilities[1].charges = 0;
  for (let i = 0; i < 20; i++) rush.fight.damage(rush.hero, rush.enemies[0], 50, 'bullet');
  assert.strictEqual(rush.hero.abilities[1].charges, 1, 'Recharging Rush: a charge back');
  const r = buildHero('Haze', { items: ['Refresher'], tiers: { 2: 2 } });
  r.abilities[1].charges = 0; r.abilities[0].cdLeft = 9;
  r.items[0].cast();
  assert.ok(r.abilities[1].charges === 2 && r.abilities[0].cdLeft === 0);
});

test('imbues: only the chosen ability gets them (cooldown, range, spirit, charges); Echo Shard resets it', () => {
  const plain = buildHero('Haze', { tiers: { 1: 3 } });
  const comp = buildHero('Haze', { items: ['Compress Cooldown'], imbues: { 'Compress Cooldown': 1 }, tiers: { 1: 3 } });
  assert.ok(Math.abs(comp.abilities[0].cooldown - plain.abilities[0].cooldown * (1 - 0.18)) < 0.01);
  assert.strictEqual(comp.abilities[3].cooldown, plain.abilities[3].cooldown, 'the others are untouched');
  const other = buildHero('Haze', { items: ['Compress Cooldown'], imbues: { 'Compress Cooldown': 4 } });
  assert.ok(other.abilities[3].cooldown < plain.abilities[3].cooldown && other.abilities[0].cooldown === buildHero('Haze').abilities[0].cooldown);
  const surge = buildHero('Haze', { items: ['Surge of Power'], imbues: { 'Surge of Power': 1 } });
  assert.ok(surge.abilities[0].value('Damage') > buildHero('Haze').abilities[0].value('Damage'), 'Surge of Power: imbued spirit power');
  const omni = buildHero('Haze', { items: ['Omnicharge Signet'], imbues: { 'Omnicharge Signet': 1 } });
  assert.strictEqual(omni.abilities[0].maxCharges, 3, 'Omnicharge: +2 charges on an ability without them');
  const echo = setup(['Echo Shard'], { imbues: { 'Echo Shard': 2 } });
  echo.hero.abilities[1].cdLeft = 30;
  assert.ok(echo.hero.items[0].want(echo.fight));
  echo.hero.items[0].cast(echo.fight);
  assert.strictEqual(echo.hero.abilities[1].cdLeft, 0);
});

test('imbued procs: Frostbite Charm freezes on the imbued ability\'s hit, Mystic Burst adds damage to a big ability hit', () => {
  const s = setup(['Frostbite Charm'], { imbues: { 'Frostbite Charm': 1 } });
  s.fight.running(s.hero.abilities[0], () => s.fight.damage(s.hero, s.enemies[0], 100, 'spirit'));
  assert.ok(s.enemies[0].has('stun'), 'frozen');
  const b = setup(['Mystic Burst']);
  b.fight.running(b.hero.abilities[0], () => b.fight.damage(b.hero, b.enemies[0], 100, 'spirit'));
  assert.ok(b.enemies[0].stats.maxHealth - b.enemies[0].health > 100 + 30, 'Mystic Burst');
});

// ---- crowd control on the hero (the blast's curse) ----
const blaster = (items, opts = {}) => {
  const s = setup(items, { ...opts });
  const boss = enemy('Boss', { maxHealth: 1e6, dps: 0, blast: { every: 1, damage: 50, maxHealthPct: 0, curse: 2, tags: ['curse'] } });
  s.fight.enemies = [boss];
  s.hero.stats.moveSpeed = 0; // no dodging
  return { ...s, boss };
};
test('curse: debuff resist shortens it, Unstoppable and Cloak of Opportunity block it, Reactive Barrier answers it, Counterspell parries the blast', () => {
  const curseLeft = (items) => { const s = blaster(items); steps(s.fight, 13); const c = s.hero.statuses.find((st) => st.id === 'curse'); return c ? c.until - s.fight.time : 0; };
  const plain = curseLeft([]);
  assert.ok(plain > 1.5);
  assert.ok(curseLeft(['Debuff Reducer']) < plain * 0.8, 'Debuff Reducer');
  const u = blaster(['Unstoppable']);
  u.boss.blastAt = 1.2; // Unstoppable is used just before a blast
  steps(u.fight, 15);
  assert.ok(!u.hero.has('curse') && u.fight.log.some((l) => l.what === 'Unstoppable'), 'Unstoppable');
  const cloak = blaster(['Cloak of Opportunity']);
  steps(cloak.fight, 13);
  assert.ok(!cloak.hero.has('curse') && cloak.hero.statuses.some((st) => st.barrier > 0), 'Cloak blocks and gives a barrier');
  const rb = blaster(['Reactive Barrier']);
  steps(rb.fight, 13);
  assert.ok(rb.hero.has('curse') && rb.hero.statuses.some((st) => st.barrier > 0), 'Reactive Barrier');
  const cs = blaster(['Counterspell']);
  const before = cs.hero.health;
  steps(cs.fight, 13);
  assert.ok(!cs.hero.has('curse') && cs.hero.health >= before && cs.fight.log.some((l) => l.parried), 'Counterspell parries');
});

test('silence holds an enemy\'s blast; a slow makes its blast easier to dodge (Mystic Slow); stun and disarm stop its attacks', () => {
  const s = blaster(['Silence Wave']);
  s.hero.items[0].cast(s.fight);
  steps(s.fight, 15);
  assert.ok(!s.fight.log.some((l) => l.enemy), 'no blast while silenced');
  steps(s.fight, 30);
  assert.ok(s.fight.log.some((l) => l.enemy), 'it comes once the silence ends');
  const slow = setup(['Mystic Slow']);
  const boss = slow.enemies[0];
  slow.hero.stats.moveSpeed = 7;
  const before = dodgeChance(slow.hero, boss);
  slow.fight.damage(slow.hero, boss, 10, 'spirit');
  assert.ok(Math.abs(dodgeChance(slow.hero, boss) - before - 0.24) < 1e-9, 'its slow adds to the dodge chance');
  const d = setup([], { dps: 100 });
  d.fight.addStatus(d.enemies[0], { id: 'x', duration: 5, tags: ['disarm'] });
  d.hero.meleeAt = Infinity;
  const hp = d.hero.health;
  steps(d.fight, 20);
  assert.strictEqual(d.hero.health, hp, 'disarmed: no hits');
});

test('enemy spirit power taken (Spirit Sap) lowers its spirit damage 1% a point', () => {
  const s = setup(['Spirit Sap']);
  const caster = enemy('Caster', { maxHealth: 1e6, dps: 0, damageType: 'spirit' });
  s.fight.enemies = [caster];
  s.hero.items[0].cast(s.fight);
  s.hero.stats.spiritResist = 0;
  const hp = s.hero.health;
  s.fight.damage(caster, s.hero, 100, 'spirit');
  assert.ok(Math.abs(hp - s.hero.health - 70) < 1e-6, `${hp - s.hero.health} of 100`);
});

// ---- healing ----
test('heal amp: Healing Booster heals more; Toxic Bullets and Nullification Burst cut an enemy\'s regen; Healing Tempo hears heals', () => {
  const healed = (items) => { const s = setup(items); s.hero.health = 100; s.fight.heal(s.hero, 100); return s.hero.health - 100; };
  assert.ok(healed(['Healing Booster']) > healed([]) * 1.15);
  const n = setup(['Nullification Burst'], { hp: 1000 });
  n.enemies[0].stats.healthRegen = 50;
  n.hero.items[0].cast(n.fight);
  const hp = n.enemies[0].health;
  steps(n.fight, 5);
  assert.ok(n.enemies[0].health <= hp, 'no regen');
  const t = setup(['Healing Tempo']);
  t.hero.health = 100;
  t.fight.heal(t.hero, 50);
  assert.ok(t.hero.mod('fireRate') > 0);
});

// ---- hits: parries, deflects, softening ----
test('hits: Rebuttal parries and returns one, Plated Armor deflects some, Spellbreaker softens a big spirit hit, Juggernaut slows a shooter', () => {
  const r = setup(['Rebuttal'], { dps: 100 });
  r.hero.meleeAt = Infinity;
  const hp = r.hero.health;
  steps(r.fight, 10);
  assert.ok(r.hero.health >= hp && r.enemies[0].health < r.enemies[0].stats.maxHealth && r.hero.mod('damageDealt') > 0, 'parried, returned, stronger');
  const plated = setup(['Plated Armor'], { dps: 100, rng: seeded(5) });
  plated.hero.stats.maxHealth = plated.hero.health = 1e6;
  const bare = setup([], { dps: 100, rng: seeded(5) });
  bare.hero.stats.maxHealth = bare.hero.health = 1e6;
  steps(plated.fight, 300); steps(bare.fight, 300);
  assert.ok(1e6 - plated.hero.health < (1e6 - bare.hero.health) * 0.85);
  const sb = setup(['Spellbreaker']);
  sb.hero.stats.spiritResist = 0;
  const caster = enemy('Caster', { maxHealth: 1e6, dps: 0, damageType: 'spirit' });
  const before = sb.hero.health;
  sb.fight.damage(caster, sb.hero, 400, 'spirit', { attack: true });
  assert.ok(before - sb.hero.health < 400 * 0.5);
  const j = setup(['Juggernaut'], { dps: 100 });
  steps(j.fight, 11);
  assert.ok(j.enemies[0].mod('damageDealt') < 0);
});

// ---- void, escapes, concoction ----
test('Ethereal Shift / Prism Blast: untouchable; Magic Carpet flies off when low; Unstable Concoction explodes and leaves 1 health', () => {
  const e = setup(['Ethereal Shift'], { dps: 100 });
  e.hero.health = 100;
  e.fight.step();
  assert.ok(!e.hero.targetable && e.hero.cantAct);
  const p = setup(['Prism Blast'], { foes: 2 });
  p.fight.step();
  steps(p.fight, 10);
  assert.ok(p.enemies.every((x) => x.health < x.stats.maxHealth) && !p.hero.targetable);
  const c = setup(['Magic Carpet'], { dps: 100 });
  c.hero.health = 100;
  steps(c.fight, 20);
  assert.ok(!c.hero.targetable && c.hero.has('hold'));
  const u = setup(['Unstable Concoction'], { hp: 5000 });
  u.hero.health = 100;
  u.fight.step();
  assert.ok(u.hero.stats.maxHealth > 3000 && u.hero.has('unstoppable'));
  steps(u.fight, 45);
  assert.ok(u.hero.alive && u.hero.health < 10, 'left at 1 health (plus a moment of regen)');
  assert.ok(u.enemies[0].health < 5000 - 1000 && u.enemies[0].has('stun'), 'the explosion hurt and stunned');
  assert.ok(u.hero.stats.maxHealth < 3000, 'the bonus health is gone');
});

// ---- souls ----
test('souls items: Cultist Sacrifice eats a small enemy for 170% of its souls (never a boss); Trophy Collector earns per kill; a won trip pays them', () => {
  const s = setup(['Cultist Sacrifice'], { hp: 500 });
  s.enemies[0].stats.souls = 100;
  s.fight.step();
  assert.ok(!s.enemies[0].alive && Math.abs(s.fight.bonusSouls - 170) < 1e-9);
  const boss = setup(['Cultist Sacrifice'], { hp: 9000 });
  assert.ok(!boss.hero.items[0].want(boss.fight), 'never a boss');
  const camp = simulate('Haze', 'small-camp', { rng: seeded(2), boons: 20, items: ['Cultist Sacrifice'] });
  assert.ok(camp.won && camp.itemSouls > 0, `${camp.itemSouls} souls from the item`);
  const plain = simulate('Haze', 'small-camp', { rng: seeded(2), boons: 20, items: ['Extra Health'] });
  assert.ok(camp.souls > plain.souls);
});

// ---- corruption ----
test('corruption: the card gains its corrupted bonuses, the hero carries one drawback in its tier\'s range; the Broker keeps his hours', () => {
  const hp = itemByName('Hollow Point');
  const c = corruptCard(hp);
  assert.strictEqual(effectValue(c, 'BaseAttackDamagePercent'), 35 + 30);
  assert.strictEqual(effectValue(c, 'LifeThreshold'), 65 - 15);
  const cult = Object.values(corruptCard(itemByName('Cultist Sacrifice'))).find((i) => i?.Type === 'Active');
  assert.strictEqual(cult.Cooldown, 270 - 210, 'a cooldown change lands on the active');
  const plain = heroStats(HEROES.Haze, { items: ['Hollow Point'] });
  const corrupted = heroStats(HEROES.Haze, { items: ['Hollow Point'], corrupted: { name: 'Hollow Point', drawback: 'fireRate', amount: 25 } });
  assert.ok(corrupted.maxHealth > plain.maxHealth + 150 && Math.abs(corrupted.fireRate - plain.fireRate * 0.75) < 1e-9);
  const rng = seeded(9);
  for (let i = 0; i < 200; i++) {
    const card = itemByName(i % 2 ? 'Plated Armor' : 'Hollow Point');
    const { drawback, amount } = rollDrawback(card, rng);
    const [lo, hi] = DRAWBACKS[drawback].range[card.Tier >= 4 ? 1 : 0];
    assert.ok(amount >= lo && amount <= hi, `${drawback} ${amount}`);
    if (card.Name === 'Plated Armor') assert.notStrictEqual(drawback, 'bulletResist');
  }
  const hour = 3600 * 1000;
  assert.ok(brokerOpen(Date.UTC(2026, 9, 3, 3, 10)) && !brokerOpen(Date.UTC(2026, 9, 3, 3, 40)) && !brokerOpen(Date.UTC(2026, 9, 3, 4, 0)));
  assert.strictEqual(brokerNext(Date.UTC(2026, 9, 3, 4, 0)), Date.UTC(2026, 9, 3, 6, 0));
  assert.ok(brokerNext(0) === 0 && hour > 0);
  assert.strictEqual(sellPrice(hp, { name: 'Hollow Point' }), hp.Cost, 'half of item + corruption');
  assert.ok(ITEM_POOL.length === 156); // every shop item (Silencer back Oct 22)
});

test('corrupting: only while the Broker is open, one per hero, costs the price again, nothing taken when refused; its components can\'t be upgraded away', async () => {
  const id = 'corrupt1';
  await chooseHero(id, 'Haze');
  await giveSouls(id, 100000);
  await buyItem(id, 'Hollow Point');
  const open = Date.UTC(2026, 9, 3, 6, 5);
  assert.strictEqual((await corruptItem(id, 'Hollow Point', { now: Date.UTC(2026, 9, 3, 7, 0) })).error, 'closed');
  assert.strictEqual((await corruptItem(id, 'Extra Health', { now: open })).error, 'unknown', 'tier 1: nothing to corrupt');
  const before = (await heroSouls(id));
  const done = await corruptItem(id, 'Hollow Point', { now: open, rng: seeded(3) });
  assert.ok(done.ok && done.paid === 3200);
  assert.strictEqual((await heroSouls(id)), before - 3200);
  const r = await getFarmUser(id);
  assert.strictEqual(r.corrupted.name, 'Hollow Point');
  await buyItem(id, 'Battle Vest');
  await buyItem(id, 'Spirit Resilience');
  const broke = await corruptItem(id, 'Spirit Resilience', { now: open });
  assert.strictEqual(broke.error, 'one');
  assert.strictEqual((await heroSouls(id)), before - 3200 - itemByName('Battle Vest').Cost - itemByName('Spirit Resilience').Cost, 'nothing taken for a refused one');
  const view = await views.shopView(member(id), await getFarmUser(id), 'broker', open);
  assert.match(view.embeds[0].toJSON().description, /already has a corrupted item/i);
  const sold = await sellItem(id, 'Hollow Point');
  assert.strictEqual(sold.refund, 3200);
  assert.strictEqual((await getFarmUser(id)).corrupted, null);
  setCooldowns(false); // the testing switch opens the Broker too
  try { assert.ok((await corruptItem(id, 'Spirit Resilience', { now: Date.UTC(2026, 9, 3, 7, 0) })).ok); } finally { setCooldowns(true); }
  const record = await getFarmUser(id);
  assert.ok(record.items.vitality.includes('Spirit Resilience'));
});

// ---- imbue, egg, gift: the member's side ----
test('imbue items ask for an ability when bought, can be moved for free, and fight with it', async () => {
  const id = 'imbue1';
  await chooseHero(id, 'Haze');
  await giveSouls(id, 100000);
  const bought = await buyItem(id, 'Compress Cooldown');
  assert.ok(bought.ok && bought.imbue);
  const ask = await views.heroView(member(id), await getFarmUser(id), 'imbue:Compress Cooldown');
  assert.strictEqual(ask.components[0].toJSON().components[0].options.length, 4);
  assert.ok((await setImbue(id, 'Compress Cooldown', 2)).ok);
  assert.strictEqual((await getFarmUser(id)).imbues['Compress Cooldown'], 2);
  assert.strictEqual((await setImbue(id, 'Extra Health', 2)).error, 'missing');
  const main = await views.heroView(member(id), await getFarmUser(id));
  assert.deepStrictEqual(main.embeds[0].toJSON().fields.find((f) => f.name === 'Imbued').value, '> Compress Cooldown\nInto Smoke Bomb');
  assert.ok(main.components.length <= 5);
});

test('Golden Goose Egg grows with fight time and hatches for souls and a buff per 80 souls grown; Eternal Gift keeps a buff every 165 s of fights', async () => {
  const id = 'egg1';
  await chooseHero(id, 'Haze');
  await giveSouls(id, 100000);
  await buyItem(id, 'Golden Goose Egg');
  await buyItem(id, 'Eternal Gift'); // not for sale: refused
  await updateFarmUser(id, (r) => { r.items.vitality.push('Eternal Gift'); afterFight(r, { seconds: 300 }, seeded(4)); });
  const r = await getFarmUser(id);
  assert.ok(Math.abs(r.egg - 400) < 1e-9, '80 a minute for 5 minutes');
  assert.strictEqual(Object.values(r.gifts).reduce((a, b) => a + b, 0), 1, 'one Eternal Gift buff in 300 s');
  assert.ok(Math.abs(r.giftTime - 135) < 1e-9);
  const before = (await heroSouls(id));
  const hatch = await hatchEgg(id, seeded(2));
  assert.ok(hatch.ok && hatch.buffs.length === 5);
  assert.strictEqual((await heroSouls(id)), before + hatch.souls);
  const after = await getFarmUser(id);
  assert.ok(!after.items.spirit.includes('Golden Goose Egg') && after.egg === 0);
  assert.strictEqual(Object.values(after.buffs).reduce((a, b) => a + b, 0), 5);
  assert.strictEqual((await hatchEgg(id)).error, 'missing');
});
