// Hero Farming: a bug sweep over every hero that has ability logic (`node tools/hero-smoke.js [hero]`; never touches data/: it runs in a temp
// DATA_DIR). Run it after adding a hero or touching engine.js / ability.js. Five checks:
//   1. tiers     every upgrade tier of every ability changes at least one fight (his rule: every tier does something); dead tiers are listed
//   2. fuzz      random kits (level, tiers, up to 12 items, a legendary, buffs) in the scenes below, with the fight's numbers checked every step:
//                health between 0 and max, nothing NaN, charges / stamina / cooldowns in bounds, and the fight ends
//   3. targets   every real target (camps, lanes, Mid-Boss, siege, waves) through play.simulate with random kits: frames and souls make sense
//   4. duels     every hero against every hero with random kits (encounters): it ends, nothing breaks
//   5. screens   the pick, hero, fight and result messages of every hero stay inside Discord's limits and attach their pictures
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-smoke-'));
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero, roster } = require('../src/utils/farm/hero');
const { ITEM_POOL, LEGENDARY_NAMES, MAX_ITEMS } = require('../src/utils/farm/levels');
const { BUFFS } = require('../src/utils/farm/buffs');
const { simulate } = require('../src/utils/farm/play');
const { TARGETS } = require('../src/utils/farm/targets');
const { duel, rivalKit } = require('../src/utils/farm/encounter');
const views = require('../src/utils/farm/views');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const only = process.argv[2];
const HEROES = roster().filter((n) => !only || n.toLowerCase() === only.toLowerCase());
const problems = [];
const note = (what) => { if (!problems.includes(what)) problems.push(what); };

// The same kinds of fights item-smoke.js uses: a boss that blasts and mixes damage with two adds, a crowd, a lone spirit tank that stomps, a brute.
const SCENES = [
  () => [
    enemy('Boss', { maxHealth: 6000, dps: 25, damageType: 'mixed', blast: { every: 5, damage: 120, maxHealthPct: 0.05, curse: 1.5 }, souls: 50 }),
    enemy('Caster', { maxHealth: 900, dps: 12, damageType: 'spirit', healthRegen: 8, souls: 30 }),
    enemy('Gunner', { maxHealth: 900, dps: 12, souls: 30 }),
  ],
  () => Array.from({ length: 5 }, (_, i) => enemy(`Haunt ${i + 1}`, { maxHealth: 500, dps: 6, distance: 10, souls: 41 })),
  () => [enemy('Tank', { maxHealth: 20000, dps: 35, distance: 20, healthRegen: 15, blast: { every: 6, damage: 300, maxHealthPct: 0.1, curse: 2, type: 'spirit', what: 'stomp' }, damageType: 'spirit' })],
  () => [enemy('Brute', { maxHealth: 60000, dps: 300, distance: 8, blast: { every: 3, damage: 50, maxHealthPct: 0, curse: 0.5 } })],
];
// Two long ones for the tiers check only (cooldown tiers of 100 s+ abilities need a fight long enough to cast twice; the hero keeps getting back up):
// a lone sponge that blasts, and a crowd of them.
const LONG = [
  Object.assign(() => { const e = enemy('Sponge', { maxHealth: 5e6, dps: 60, distance: 15, blast: { every: 7, damage: 150, maxHealthPct: 0, curse: 1 }, souls: 10 }); e.health *= 0.45; return [e]; }, { seconds: 420, rejuvs: 99 }), // below half health: "finisher" abilities get used
  Object.assign(() => Array.from({ length: 4 }, (_, i) => enemy(`Sponge ${i + 1}`, { maxHealth: 5e6, dps: 18, distance: 12, damageType: i % 2 ? 'spirit' : 'bullet', blast: i ? null : { every: 9, damage: 120, maxHealthPct: 0, curse: 1, what: 'stomp' }, souls: 10 })), { seconds: 420, rejuvs: 99 }),
];

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
// What must hold after every step of any fight.
function invariants(f, units, where) {
  for (const u of units) {
    const max = u.stats.maxHealth;
    if (!finite(u.health) || !finite(max) || max <= 0) return note(`${where}: ${u.name} health ${u.health} / ${max}`);
    if (u.health < -1e-6 || u.health > max + 1e-6) note(`${where}: ${u.name} health ${u.health.toFixed(2)} outside 0..${max.toFixed(2)}`);
    if (!finite(u.offset ?? 0)) note(`${where}: ${u.name} offset ${u.offset}`);
    for (const s of u.statuses) {
      if (Number.isNaN(s.until)) note(`${where}: status ${s.id} on ${u.name} never ends properly (${s.until})`);
      for (const [k, v] of Object.entries(s.mods ?? {})) if (!finite(v)) note(`${where}: status ${s.id} on ${u.name} has ${k} = ${v}`);
      if (s.barrier !== undefined && !finite(s.barrier)) note(`${where}: barrier of ${s.id} is ${s.barrier}`);
    }
    if (u.team !== 'hero') continue;
    const w = u.weapon;
    if (!finite(w.clip) || w.clip < 0 || !finite(w.reloadLeft) || !finite(w.charge)) note(`${where}: ${u.name} gun clip ${w.clip}, reload ${w.reloadLeft}, charge ${w.charge}`);
    if (!finite(u.stamina) || u.stamina < 0) note(`${where}: ${u.name} stamina ${u.stamina}`);
    if (!finite(u.healPool) || u.healPool < -1e-6) note(`${where}: ${u.name} heal pool ${u.healPool}`);
    for (const k of ['bulletDamage', 'fireRate', 'clip', 'reload', 'spirit', 'moveSpeed', 'bulletResist', 'spiritResist']) if (!finite(u.stats[k])) note(`${where}: ${u.name} stat ${k} = ${u.stats[k]}`);
    for (const a of u.abilities) {
      if (!finite(a.cdLeft) || a.cdLeft < -0.2) note(`${where}: ${a.name} cooldown ${a.cdLeft}`);
      if (a.maxCharges > 1 && (a.charges < 0 || a.charges > a.maxCharges)) note(`${where}: ${a.name} charges ${a.charges} of ${a.maxCharges}`);
      const c = a.passive ? 1 : a.cooldown;
      if (!finite(c) || (!a.passive && c <= 0)) note(`${where}: ${a.name} cooldown value ${c}`);
    }
  }
  if (!finite(f.bonusSouls) || f.bonusSouls < 0) note(`${where}: bonus souls ${f.bonusSouls}`);
}

// One fight to the end; returns a line that changes whenever anything about the fight does.
function run(hero, foes, seed, where, { check = false, seconds = 90 } = {}) {
  const f = new Fight({ heroes: [hero], enemies: foes, rng: seeded(seed) });
  const started = Date.now();
  let steps = 0;
  while (f.time < seconds && hero.alive && foes.some((e) => e.alive)) {
    f.step();
    if (check) invariants(f, [hero, ...foes], where);
    if (++steps > seconds * 10 + 50 || Date.now() - started > 5000) { note(`${where}: the fight hangs`); break; }
  }
  return [f.time.toFixed(1), hero.health.toFixed(1), ...foes.map((e) => e.health.toFixed(1)), f.bonusSouls.toFixed(2), f.log.length, hero.stats.maxHealth.toFixed(1)].join(' ');
}

const pickN = (rng, list, n) => { const out = []; while (out.length < Math.min(n, list.length)) { const x = list[Math.floor(rng() * list.length)]; if (!out.includes(x)) out.push(x); } return out; };
function randomKit(rng) {
  const boons = Math.floor(rng() * 36);
  const unlocked = boons >= 7 ? 4 : boons >= 4 ? 3 : boons >= 2 ? 2 : 1;
  const tiers = {};
  for (let s = 1; s <= unlocked; s++) tiers[s] = Math.floor(rng() * 4);
  const items = pickN(rng, ITEM_POOL, Math.floor(rng() * (MAX_ITEMS + 1)));
  if (rng() < 0.3 && items.length) items[items.length - 1] = LEGENDARY_NAMES[Math.floor(rng() * LEGENDARY_NAMES.length)];
  const buffs = Object.fromEntries(pickN(rng, Object.keys(BUFFS), 4).map((k) => [k, Math.floor(rng() * 12)]));
  return { boons, unlocked, tiers, items, buffs, points: 32 };
}
const try_ = (where, fn) => { try { return fn(); } catch (e) { note(`${where}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); return null; } };

// ---- 1. tiers ----
const dead = [];
for (const name of HEROES) {
  for (let slot = 1; slot <= 4; slot++) {
    for (let tier = 1; tier <= 3; tier++) {
      let changed = false;
      for (const [i, scene] of [...SCENES, ...LONG].entries()) {
        for (const [seed, hurt, boons] of [[7, 0.6, 20], [11, 1, 35], [3, 0.35, 10]]) {
          if (changed) break;
          const outcome = (t) => try_(`${name} ability ${slot} tier ${t} (scene ${i + 1})`, () => {
            const h = buildHero(name, { boons, tiers: { 1: 2, 2: 2, 3: 2, 4: 2, [slot]: t }, items: ['Extra Stamina', 'Mystic Burst', 'Melee Lifesteal'] });
            h.health *= hurt;
            h.rejuvs = scene.rejuvs ?? 0;
            return run(h, scene(), seed, `${name} ability ${slot} tier ${t}`, { check: true, seconds: scene.seconds ?? 90 });
          });
          if (outcome(tier) !== outcome(tier - 1)) changed = true;
        }
      }
      if (!changed) dead.push(`${name}: ${buildHero(name).abilities[slot - 1].name} tier ${tier}`);
    }
  }
}

// ---- 2. fuzz ----
let fights = 0;
for (const name of HEROES) {
  const rng = seeded(101 + name.length * 7);
  for (let i = 0; i < 60; i++) {
    const kit = randomKit(rng);
    const scene = SCENES[i % SCENES.length];
    const where = `${name} fuzz ${i} (level ${kit.boons}, ${kit.items.join(', ') || 'no items'}, tiers ${JSON.stringify(kit.tiers)})`;
    try_(where, () => {
      const h = buildHero(name, kit);
      h.rejuvs = i % 7 === 0 ? 1 : 0;
      h.health *= 0.3 + rng() * 0.7;
      run(h, scene(), 1 + i, where, { check: true });
      fights++;
    });
  }
}

// ---- 3. real targets ----
let trips = 0;
for (const name of HEROES) {
  const rng = seeded(55 + name.length);
  for (const key of [...Object.keys(TARGETS), 'siege', 'waves']) {
    for (let i = 0; i < 3; i++) {
      const kit = { ...randomKit(rng), clears: Math.floor(rng() * 11), walkersDown: Math.floor(rng() * 3) };
      const where = `${name} at ${key} (level ${kit.boons}, ${kit.items.join(', ') || 'no items'})`;
      const out = try_(where, () => simulate(name, key, { rng: seeded(9 + i), rejuvs: key === 'siege' ? 2 : 0, ...kit }));
      if (!out) continue;
      trips++;
      if (!Number.isInteger(out.souls) || out.souls < 0) note(`${where}: souls ${out.souls}`);
      if (!out.frames.length || out.frames.length > 14) note(`${where}: ${out.frames.length} frames`);
      if (!finite(out.seconds) || out.seconds <= 0) note(`${where}: ${out.seconds} seconds`);
      for (const fr of out.frames) {
        if (!finite(fr.hero.hp) || !finite(fr.hero.max) || fr.enemies.some((e) => !finite(e.hp) || !finite(e.max))) note(`${where}: a frame has a broken health number`);
        if (fr.abilities.some((a) => typeof a.status !== 'string' || /NaN|undefined|Infinity/.test(a.status))) note(`${where}: ability status "${fr.abilities.map((a) => a.status).join(' / ')}"`);
      }
      if (out.log.some(([t, text]) => !finite(t) || /undefined|NaN/.test(text))) note(`${where}: a battle log line is broken`);
    }
  }
}

// ---- 4. duels ----
let duels = 0;
let timedOut = 0;
for (const mine of HEROES) {
  const rng = seeded(31 + mine.length);
  for (const theirs of roster()) {
    for (let i = 0; i < 3; i++) {
      const kit = randomKit(rng);
      const where = `duel ${mine} against ${theirs} (level ${kit.boons}, ${kit.items.join(', ') || 'no items'})`;
      const out = try_(where, () => duel(mine, kit, theirs, rivalKit(kit, rng), { rng }));
      if (!out) continue;
      duels++;
      if (out.timedOut) timedOut++;
      const last = out.frames.at(-1);
      if (!finite(last.hero.hp) || !finite(last.enemies[0].hp)) note(`${where}: broken health at the end`);
      if (out.won && last.enemies[0].hp > 0) note(`${where}: won, but the rival has ${last.enemies[0].hp} health`);
    }
  }
}

// ---- 5. screens ----
function limits(payload, what) {
  for (const e of payload.embeds ?? []) {
    const j = e.toJSON();
    const size = (j.title?.length ?? 0) + (j.description?.length ?? 0) + (j.footer?.text.length ?? 0) + (j.author?.name.length ?? 0) + (j.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
    if ((j.title?.length ?? 0) > 256 || (j.description?.length ?? 0) > 4096 || size > 6000) note(`${what}: the embed is too long (${size} characters)`);
    if ((j.fields ?? []).length > 25) note(`${what}: ${j.fields.length} fields`);
    for (const f of j.fields ?? []) if (!f.name.length || f.name.length > 256 || !f.value.length || f.value.length > 1024) note(`${what}: field "${f.name}" is ${f.value.length} characters`);
    if (/undefined|NaN|\[object/.test(JSON.stringify(j))) note(`${what}: the text has a broken value in it`);
    const names = (payload.files ?? []).map((f) => f.name);
    for (const url of [j.thumbnail?.url, j.author?.icon_url, j.image?.url].filter(Boolean)) if (!names.includes(url.replace('attachment://', ''))) note(`${what}: ${url} isn't attached`);
  }
  const rows = (payload.components ?? []).map((r) => r.toJSON());
  if (rows.length > 5) note(`${what}: ${rows.length} rows of buttons`);
  for (const r of rows) for (const c of r.components) {
    if (c.custom_id.length > 100) note(`${what}: a button id is ${c.custom_id.length} characters`);
    if ((c.options ?? []).length > 25) note(`${what}: a dropdown has ${c.options.length} options`);
    for (const o of c.options ?? []) if (o.label.length > 100 || (o.description ?? '').length > 100 || !o.label.length) note(`${what}: dropdown option "${o.label}"`);
  }
}
async function screens() {
  const member = { id: '100000000000000001', guild: { emojis: { cache: { find: () => undefined } } }, toString: () => '<@100000000000000001>' };
  let shown = 0;
  for (const name of HEROES) {
    const record = { hero: name, heroes: { [name]: {} }, earned: 9000, tiers: { 1: 2, 2: 1 }, items: { weapon: ['Toxic Bullets', 'Ricochet'], vitality: ['Extra Health'], spirit: ['Mystic Burst'] },
      cooldowns: {}, down: {}, rejuvs: 1, buffs: { fireRate: 2 }, bridge: [], clears: {}, tokens: 1, siegeTokens: [], imbues: {}, gifts: {}, egg: 0, giftTime: 0, legendary: null, corrupted: null };
    const check = async (what, make) => { try { limits(await make(), `${name}: ${what}`); shown++; } catch (e) { note(`${name}: ${what}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); } };
    await check('the pick screen', () => views.pickView(member, name));
    await check('the switch screen', () => views.pickView(member, name, { ...record, hero: roster().find((n) => n !== name) ?? name, heroes: {} }));
    await check('the hero screen', () => views.heroView(member, record, 50000));
    await check('the home screen', () => views.homeView(member, record));
    const out = try_(`${name}: a trip for the fight screens`, () => simulate(name, 'medium-camp', { rng: seeded(5), boons: 20, unlocked: 4, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 }, items: ['Toxic Bullets'] }));
    if (!out) continue;
    for (const [i, frame] of out.frames.entries()) await check(`the fight screen, frame ${i + 1}`, () => views.fightView(out, frame));
    await check('the result screen', () => views.resultView(out));
  }
  return shown;
}

screens().then((shown) => {
  console.log(`Heroes: ${HEROES.join(', ')}`);
  console.log(`Ran ${fights} random-kit fights, ${trips} trips to real targets, ${duels} duels (${timedOut} ran out of time) and ${shown} screens.`);
  console.log(dead.length ? `Upgrade tiers that changed nothing in any fight:\n  ${dead.join('\n  ')}` : 'Every upgrade tier changes its fights.');
  console.log(problems.length ? `Problems (${problems.length}):\n  ${problems.slice(0, 60).join('\n  ')}${problems.length > 60 ? `\n  ... and ${problems.length - 60} more` : ''}` : 'No problems found.');
  process.exitCode = dead.length || problems.length ? 1 : 0;
}).catch((e) => { console.error(e); process.exitCode = 1; });
