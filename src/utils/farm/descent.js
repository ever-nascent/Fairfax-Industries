// /descend: a roguelite mode for Hero Farming (plan: descend-plan.md; his calls Oct 24). One of the member's unlocked heroes goes down room after
// room from level 0 with no items. Every won room is a level (boons, ability points, abilities unlock at 0 / 2 / 4 / 7 as usual) and an offer of
// 3 items (vitality / weapon / spirit, like Street Brawl's pick), pick 1 or skip to heal. 12 item slots, upgrade paths kept: an offered upgrade of
// an item the hero holds replaces it in place. Every 5th room is a boss (one of the real ones, sized to the depth) that gives a bigger pick and a
// Rejuv; now and then a rival hero blocks the way and wants a duel (his ask, Oct 24). One death ends the run (unless a Rejuv). Score: rooms cleared.
// It ends (his calls, Oct 24): 8 floors, 40 rooms; the last is the Patron then the Weakened Patron in one fight, like the siege's end. Clearing it is
// "Descent Cleared" and a place on the leaderboard, nothing more.
// No souls: a run never touches a hero's own souls, items or level (it lives on the member: `descent` on the farm record, next to `bestWave`).
//   descent: { hero, seed, room (the next room to fight, from 1), level, tiers, items: { weapon | vitality | spirit: [names] }, legendary, buffs, bridge, find,
//     rejuvs, health (share of max), kept (kill stacks), imbues, offer: { kind: 'items' | 'buffs' | 'legendaries', choices, room } | null,
//     phase: 'ready' (the next room waits) | 'offer' (picking) | 'fighting' (Fight was pressed), fightingAt }
//   bestDescent: { rooms, hero } (the member's best run), descentBest: { <hero>: rooms }, descentToken: true once the token was paid,
//   descentClears: runs that beat the last room.
// Everything random about a room or an offer comes from `seed` + the room, so closing Discord can't reroll either.
// ponytail: the enemy numbers (TUNE, BOSS), the archetypes and affixes, the tier weights and the rewards are placeholders tuned with
// `node tools/farm-sim.js descend`; his calls to change.
const path = require('node:path');
const { enemy } = require('./engine');
const { TARGETS, SIEGE } = require('./targets');
const { buildHero, roster } = require('./hero');
const { POOL, ITEM_POOL, SLOTS, SLOT_OF, MAX_ITEMS, countItems, priceFor, heldIn, LEGENDARY_NAMES, TIER_COSTS, MAX_TIER, MAX_LEVEL, UNLOCKS, POINTS, pointsSpent } = require('./levels');
const { itemByName } = require('./stats');
const { BUFFS, BRIDGE, rollAnyBuff } = require('./buffs');
const { IMBUES } = require('./items');
const { rivalKit } = require('./encounter');
const { ASSETS } = require('../art');
const { getStore } = require('../../storage');
const { simulate, updateFarmUser, getFarmUser, hasHero, MAX_REJUVS, TRAITS } = require('./play');

const ROOMS_PER_FLOOR = 5; // 4 fights and a boss
const FLOORS = 8; // his call, Oct 24
const LAST_ROOM = FLOORS * ROOMS_PER_FLOOR; // the Patron, then the Weakened Patron
const TOKEN_ROOM = 25; // the end of floor 5: a Character Unlock Token, once per member (my pick from the plan's example; his call)
const SKIP_HEAL = 0.25; // skipping a pick heals this share of max health (his open question; my pick)
const REST = 0.15; // a breather between two rooms, like waves'
const BOSS_BUFFS = 3; // a boss's buff pick gives this many of that permanent buff
const LITTLE_BUFF_CHANCE = 0.10; // his call, Oct 25: a won fight or rival may turn up one permanent stack
const BIG_BUFF_CHANCE = 0.05; // his call: a Bridge buff for the rest of this floor
const RIVAL_FROM = 3; // rivals show up from this room (never on a boss room)
const RIVAL_CHANCE = 0.15;
const AFFIX_FROM = 4; // enemies may roll an affix from this room, more often deeper
const MAX_UNITS = 6; // enemies in one room (the live message has a field per enemy)
const UPGRADE_CHANCE = 0.35; // each pick slot offers an upgrade of a held item this often, when there is one
const STALE_MS = 60 * 1000; // a 'fighting' claim older than this (the bot stopped mid-fight) can be fought again

// How strong a room's enemies are: room 1 at TUNE, then TUNE.growth more every room, compounding (a kitted hero is many times a fresh one, like waves).
const TUNE = { health: 1, dps: 1, growth: 0.14, knee: 15, late: 0.075 };
// `growth` a room up to room `knee`, then `late` a room: steep where a build's picks start to tell, gentler towards the bottom
const power = (room) => (1 + TUNE.growth) ** (Math.min(room, TUNE.knee) - 1) * (1 + TUNE.late) ** Math.max(0, room - TUNE.knee);
const floorOf = (room) => Math.ceil(room / ROOMS_PER_FLOOR);
const budgetOf = (room) => Math.min(10, 5 + Math.floor(room / 4)); // threat points a fight room spends on enemies

// Seeded dice: one stream per (seed, room, what).
function dice(...parts) {
  let h = 2166136261;
  for (const ch of parts.join(':')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const take = (list, n, rng) => { const a = [...list]; const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };

// ---- the enemies ----
// A medic heals everyone standing: a chance each second (the engine's `special`, like a Haunt's).
const MEND = { name: 'Mend', chance: 0.3, use(fight) { for (const e of fight.enemies) if (e.alive && e.team === 'enemy') e.health = Math.min(e.stats.maxHealth, e.health + e.stats.maxHealth * 0.06); } };
const ICONS = path.join(ASSETS, 'farm', 'icons');
// The archetypes a fight room's budget is spent on (room 1 numbers): cost in threat points, count per pick, picture (the trooper renders).
const ARCHETYPES = {
  tank: { name: 'Brute', plural: 'Brutes', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 900, dps: 6, distance: 8, bulletResist: 0.1 }, text: 'lots of health, little damage' },
  swarm: { name: 'Swarmling', plural: 'Swarmlings', cost: 2, count: 2, icon: 'trooper', stats: { maxHealth: 150, dps: 4, distance: 12 }, text: 'small and many' },
  glass: { name: 'Sharpshooter', plural: 'Sharpshooters', cost: 3, icon: 'trooper', stats: { maxHealth: 260, dps: 15, distance: 30 }, text: 'hits hard from far away, little health' },
  healer: { name: 'Medic', plural: 'Medics', cost: 3, icon: 'trooper-medic', stats: { maxHealth: 350, dps: 3, distance: 18 }, special: MEND, text: 'heals the others' },
  bruiser: { name: 'Bruiser', plural: 'Bruisers', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 600, dps: 11, distance: 4 }, text: 'close in, hits hard' },
  caster: { name: 'Hexer', plural: 'Hexers', cost: 4, icon: 'trooper-medic', stats: { maxHealth: 400, dps: 6, distance: 18, damageType: 'spirit', blast: { every: 8, damage: 45, maxHealthPct: 0, curse: 1, type: 'spirit' } }, text: 'spirit damage and a curse' },
};
for (const a of Object.values(ARCHETYPES)) a.icon = path.join(ICONS, `${a.icon}.png`);
// Affixes (the Isaac "champion" idea): the four camp traits plus a few the engine already knows (regen, lifesteal, a heal cut, a curse, more health).
// ponytail: Berserk / Silencing / Armor-breaking from the plan need engine work; left out until he wants them.
const resist = (x) => Math.max(0, Math.min(0.9, x));
const AFFIXES = {
  ...Object.fromEntries(TRAITS.filter((t) => t.name).map((t) => [t.name, { text: t.bullet > 0 && t.spirit > 0 ? 'resists everything' : t.bullet > 0 ? 'resists bullets' : t.spirit > 0 ? 'resists spirit' : 'takes more of everything',
    apply(e) { e.stats.bulletResist = resist(e.stats.bulletResist + t.bullet); e.stats.spiritResist = resist(e.stats.spiritResist + t.spirit); } }])),
  Regenerating: { text: 'heals itself', apply(e) { e.stats.healthRegen += e.stats.maxHealth * 0.015; } },
  Vampiric: { text: 'heals from its hits', apply(e) { e.stats.drain = 0.4; } },
  Withering: { text: 'its hits cut healing', apply(e) { e.stats.antiHeal = { cut: 0.4, seconds: 3 }; } },
  Cursing: { text: 'curses now and then', apply(e) { e.stats.blast ??= { every: 9, damage: e.stats.dps * 2, maxHealthPct: 0, curse: 1, type: 'spirit' }; } },
  Shielded: { text: 'half again the health', apply(e) { e.stats.maxHealth *= 1.5; e.health = e.stats.maxHealth; } },
};
const affixChance = (room) => Math.min(0.6, 0.15 + 0.03 * (room - AFFIX_FROM));

// The bosses (his plan: chosen at random from the real ones), their identity kept (resists, damage type, stomp / curse, sustain, picture) and
// their health and damage set by the depth.
const BOSS = { health: 1800, dps: 15, resist: 0.2 }; // resist: the average resist `health` is meant for
const BOSSES = {
  guardian: { name: 'Guardian', icon: TARGETS.guardian.icon, make: () => TARGETS.guardian.enemies()[0] },
  walker: { name: 'Walker', icon: TARGETS.walker.icon, make: () => TARGETS.walker.enemies()[0] },
  'mid-boss': { name: 'Mid-Boss', icon: TARGETS['mid-boss'].icon, make: () => TARGETS['mid-boss'].enemies()[0] },
  'base-guardian': { name: 'Base Guardian', icon: SIEGE.stages[0].icon, make: () => SIEGE.stages[0].enemies()[0] },
  shrine: { name: 'Shrine', icon: SIEGE.stages[1].icon, make: () => SIEGE.stages[1].enemies()[0] },
  patron: { name: 'Patron', icon: SIEGE.stages[3].icon, make: () => SIEGE.stages[3].enemies()[0] },
  'weakened-patron': { name: 'Weakened Patron', icon: SIEGE.stages[4].icon, make: () => SIEGE.stages[4].enemies()[0] },
};
const FLOOR_BOSSES = ['guardian', 'walker', 'mid-boss', 'base-guardian', 'shrine']; // the Patron waits at the bottom (LAST_ROOM)
const FINAL = ['patron', 'weakened-patron'];
function bossFor(key, room) {
  const e = BOSSES[key].make();
  e.name = BOSSES[key].name;
  const k = power(room);
  const tough = (1 - (e.stats.bulletResist + e.stats.spiritResist) / 2) / (1 - BOSS.resist); // the same health behind its resists for every boss
  const health = BOSS.health * TUNE.health * k * tough;
  const dps = BOSS.dps * TUNE.dps * k * (e.stats.blast ? 1 - e.stats.blast.curse / e.stats.blast.every : 1); // a boss that curses (the Walker's stomp, the Shrine) hits softer
  const grew = dps / (e.stats.dps || dps); // the share of its own numbers it fights with here
  e.stats.healthRegen *= health / e.stats.maxHealth;
  e.stats.maxHealth = health;
  e.health = health;
  e.stats.dps = dps;
  e.stats.dpsMaxHealthPct = Math.min(0.05, e.stats.dpsMaxHealthPct * grew);
  if (e.stats.blast) e.stats.blast = { ...e.stats.blast, damage: e.stats.blast.damage * grew, maxHealthPct: Math.min(0.4, e.stats.blast.maxHealthPct * grew) };
  return e;
}

// What room `room` of a run holds (from the seed alone, so it can be shown before the fight):
//   { room, floor, kind: 'fight', groups: [{ type, affix }] } | { kind: 'boss', boss, final? } | { kind: 'rival', rival }
function roomSpec(seed, room, hero) {
  const rng = dice(seed, room, 'room');
  const base = { room, floor: floorOf(room) };
  if (room === LAST_ROOM) return { ...base, kind: 'boss', boss: 'patron', final: true };
  if (room % ROOMS_PER_FLOOR === 0) return { ...base, kind: 'boss', boss: pick(FLOOR_BOSSES, rng) };
  const rivals = roster().filter((n) => n !== hero);
  if (room >= RIVAL_FROM && rivals.length && rng() < RIVAL_CHANCE) return { ...base, kind: 'rival', rival: pick(rivals, rng) };
  let budget = budgetOf(room);
  let units = 0;
  const groups = [];
  for (;;) {
    const can = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].cost <= budget && units + (ARCHETYPES[k].count ?? 1) <= MAX_UNITS);
    if (!can.length) break;
    const type = pick(can, rng);
    budget -= ARCHETYPES[type].cost;
    units += ARCHETYPES[type].count ?? 1;
    groups.push({ type, affix: room >= AFFIX_FROM && rng() < affixChance(room) ? pick(Object.keys(AFFIXES), rng) : null });
  }
  return { ...base, kind: 'fight', groups };
}

// The enemy units of a fight room.
const unitsOf = (spec) => spec.groups.flatMap(({ type, affix }) => {
  const a = ARCHETYPES[type];
  const k = power(spec.room);
  return Array.from({ length: a.count ?? 1 }, () => {
    const s = a.stats;
    const e = enemy(affix ? `${affix} ${a.name}` : a.name, { ...s, maxHealth: s.maxHealth * TUNE.health * k, dps: s.dps * TUNE.dps * k, blast: s.blast && { ...s.blast, damage: s.blast.damage * TUNE.dps * k } });
    if (a.special) e.stats.special = a.special;
    if (affix) AFFIXES[affix].apply(e);
    return e;
  });
});

// "2 Swarmlings, 1 Armored Brute, 1 Hexer": a room's enemies in a line (the telegraph before the fight).
function roomLine(spec) {
  if (spec.final) return 'the Patron, then the Weakened Patron';
  if (spec.kind === 'boss') return `the ${BOSSES[spec.boss].name}`;
  if (spec.kind === 'rival') return spec.rival;
  const counts = new Map();
  for (const { type, affix } of spec.groups) {
    const key = `${affix ? `${affix} ` : ''}${type}`;
    counts.set(key, (counts.get(key) ?? 0) + (ARCHETYPES[type].count ?? 1));
  }
  return [...counts].map(([key, n]) => { const [type, affix] = key.split(' ').reverse(); const a = ARCHETYPES[type]; return `${n} ${affix ? `${affix} ` : ''}${n === 1 ? a.name : a.plural}`; }).join(', ');
}
// The picture for a room (`stage`: the last room's second fight): the boss, the trooper render of its first enemy, or (a rival) null: the views draw the rival's face.
const roomPicture = (spec, stage = 0) => (spec.final ? BOSSES[FINAL[stage] ?? 'patron'].icon : spec.kind === 'boss' ? BOSSES[spec.boss].icon : spec.kind === 'fight' ? ARCHETYPES[spec.groups[0].type].icon : null);

// ---- the run's hero ----
// What the run's hero fights with (the same shape as play.js fightKit).
const runKit = (d) => ({
  boons: d.level, unlocked: UNLOCKS(d.level), points: POINTS(d.level), tiers: d.tiers,
  items: [...SLOTS.flatMap((s) => d.items[s]), ...(d.legendary ? [d.legendary] : [])], buffs: d.buffs, bridge: d.bridge ?? [], imbues: d.imbues, kept: d.kept,
});
const pointsLeft = (d) => POINTS(d.level) - pointsSpent(d.tiers);

// A rival rolls its kit around the hero's (encounter.js) but RIVAL.levels lower and with RIVAL.health of its health: a fair duel would end half the runs.
const RIVAL = { levels: 2, health: 0.7 };
function rivalFor(spec, d, kit) {
  const theirs = rivalKit({ ...kit, boons: Math.max(0, kit.boons - RIVAL.levels), points: POINTS(Math.max(0, d.level - RIVAL.levels)), unlocked: UNLOCKS(Math.max(0, d.level - RIVAL.levels)) }, dice(d.seed, spec.room, 'rival'));
  const unit = buildHero(spec.rival, theirs);
  unit.stats.maxHealth *= RIVAL.health;
  unit.health = unit.stats.maxHealth;
  return unit;
}

// Plays room `spec` with the run `d` (nothing saved). Returns play.js simulate's run, with `spec`.
function fightRoom(d, spec, rng = Math.random) {
  const kit = runKit(d);
  const enemies = spec.kind === 'boss' ? () => [bossFor(spec.boss, spec.room)]
    : spec.kind === 'rival' ? () => [rivalFor(spec, d, kit)]
      : () => unitsOf(spec);
  const stages = spec.final ? FINAL.map((key) => ({ name: BOSSES[key].name, enemies: () => [bossFor(key, spec.room)] })) // in one go, health carried
    : [{ name: `Room ${spec.room}`, enemies }];
  const run = simulate(d.hero, 'descend', { rng, stages, health: d.health, rejuvs: d.rejuvs, ...kit });
  return { ...run, spec };
}

// ---- offers ----
// Items that need souls or the farm record are left out of a run (the plan): souls items pay nothing here.
const NO_RUN_ITEMS = new Set(['Golden Goose Egg', 'Trophy Collector', 'Cultist Sacrifice']);
const NO_RUN_LEGENDARIES = new Set(['Eternal Gift']); // its permanent buffs come from fight time on the farm record
// The chance of each tier (1-4) in an item offer, by floor (the last row for every floor past it).
const TIER_WEIGHTS = [[60, 40, 0, 0], [20, 50, 30, 0], [5, 40, 45, 10], [0, 20, 50, 30], [0, 5, 45, 50], [0, 0, 35, 65]];
const OFFER_ORDER = ['vitality', 'weapon', 'spirit']; // left, top, right of the pick screen, like Street Brawl's

// 3 items, one of each kind, for room `room` cleared; `bonus` raises the tiers a floor (a beaten rival's stash).
function itemOffer(d, rng, bonus = 0, room = d.room) {
  const weights = TIER_WEIGHTS[Math.min(TIER_WEIGHTS.length - 1, floorOf(room) - 1 + bonus)];
  const top = weights.findLastIndex((w) => w > 0) + 1;
  const owned = SLOTS.flatMap((s) => d.items[s]);
  const ok = (n) => !NO_RUN_ITEMS.has(n) && !owned.includes(n) && !heldIn(n, d.items);
  const tierRoll = () => { let r = rng() * weights.reduce((a, b) => a + b, 0); return weights.findIndex((w) => (r -= w) < 0) + 1 || top; };
  return OFFER_ORDER.map((kind) => {
    const upgrades = POOL[kind].filter((n) => ok(n) && itemByName(n).Tier <= top && priceFor(itemByName(n), d.items).used.length);
    if (upgrades.length && rng() < UPGRADE_CHANCE) return pick(upgrades, rng);
    const tier = tierRoll();
    for (const t of [tier, ...[1, 2, 3, 4].filter((x) => x !== tier).sort((a, b) => Math.abs(a - tier) - Math.abs(b - tier))]) {
      const pool = POOL[kind].filter((n) => ok(n) && itemByName(n).Tier === t);
      if (pool.length) return pick(pool, rng);
    }
    return null;
  }).filter(Boolean);
}

// The reward for room `spec` just cleared: a boss gives 1 of 3 permanent buffs (or on odd floors from 3, 1 of 3 legendaries), anything else 3 items.
function rollOffer(d, spec) {
  const rng = dice(d.seed, spec.room, 'offer');
  if (spec.kind === 'boss') {
    const legends = LEGENDARY_NAMES.filter((n) => !NO_RUN_LEGENDARIES.has(n) && n !== d.legendary);
    if (spec.floor >= 3 && spec.floor % 2 && legends.length >= 3) return { kind: 'legendaries', choices: take(legends, 3, rng), room: spec.room };
    return { kind: 'buffs', choices: take(Object.keys(BUFFS), 3, rng), room: spec.room };
  }
  return { kind: 'items', choices: itemOffer(d, rng, spec.kind === 'rival' ? 1 : 0, spec.room), room: spec.room };
}

// A won fight or rival may uncover one buff. The room's drop stream is fixed by the run seed, even across restarts.
function rollFind(d, spec) {
  if (spec.kind !== 'fight' && spec.kind !== 'rival') return null;
  const rng = dice(d.seed, spec.room, 'drop');
  const chance = rng();
  if (chance < LITTLE_BUFF_CHANCE) return { kind: 'little', key: rollAnyBuff(rng), room: spec.room };
  if (chance < LITTLE_BUFF_CHANCE + BIG_BUFF_CHANCE) {
    const available = Object.keys(BRIDGE).filter((key) => !(d.bridge ?? []).includes(key));
    if (available.length) return { kind: 'big', key: pick(available, rng), room: spec.room };
  }
  return null;
}

// ---- the run's changes (pure: on a run d, inside a record update or in the simulations) ----
function dropItem(d, name) {
  for (const s of SLOTS) d.items[s] = d.items[s].filter((n) => n !== name);
  delete d.imbues[name];
  delete d.kept[name];
}
// Puts item `name` in the build: an upgrade of a held item replaces it in place; with 12 items anything else needs `replace` (lost, no sell-back).
// Returns { ok: true, used: [components replaced], replaced } or { error: 'full' | 'missing' }.
function addItem(d, name, replace = null) {
  const card = itemByName(name);
  const { used } = priceFor(card, d.items);
  let replaced = null;
  if (!used.length && countItems(d.items) >= MAX_ITEMS) {
    if (!replace) return { error: 'full' };
    if (!SLOTS.some((s) => d.items[s].includes(replace))) return { error: 'missing' };
    dropItem(d, replace);
    replaced = replace;
  }
  for (const u of used) dropItem(d, u);
  d.items[SLOT_OF[card.Slot]].push(name);
  if (IMBUES.includes(name)) d.imbues[name] = 1; // ponytail: into the first ability; the farm's imbue picker isn't in a run yet
  return { ok: true, used, replaced };
}
// Takes choice `index` of the offer. Returns { ok, kind, name, used, replaced } or { error: 'none' | 'full' | 'missing' }.
function takeChoice(d, index, replace = null) {
  const name = d.offer?.choices[index];
  if (d.phase !== 'offer' || !name) return { error: 'none' };
  let extra = {};
  if (d.offer.kind === 'buffs') d.buffs[name] = (d.buffs[name] ?? 0) + BOSS_BUFFS;
  else if (d.offer.kind === 'legendaries') d.legendary = name;
  else { extra = addItem(d, name, replace); if (extra.error) return extra; }
  const { kind } = d.offer;
  d.offer = null;
  d.phase = 'ready';
  return { ...extra, ok: true, kind, name };
}
function skipChoice(d) {
  if (d.phase !== 'offer') return { error: 'none' };
  d.health = Math.min(1, d.health + SKIP_HEAL);
  d.offer = null;
  d.phase = 'ready';
  return { ok: true };
}
// One ability point into ability `slot`. Returns { ok, tier } or { error: 'locked' | 'max' | 'points' }.
function spendPoint(d, slot) {
  const tier = d.tiers[slot] ?? 0;
  if (!(slot >= 1 && slot <= UNLOCKS(d.level))) return { error: 'locked' };
  if (tier >= MAX_TIER) return { error: 'max' };
  if (pointsLeft(d) < TIER_COSTS[tier]) return { error: 'points' };
  d.tiers[slot] = tier + 1;
  return { ok: true, tier: tier + 1 };
}
// After a won room: a level, the health it has left plus a breather, Rejuvs used (a boss gives one), kill stacks, and the offer.
function afterWin(d, run) {
  const { spec } = run;
  d.level = Math.min(MAX_LEVEL, d.level + 1);
  d.health = Math.min(1, run.health + REST);
  d.rejuvs = Math.min(MAX_REJUVS, Math.max(0, d.rejuvs - run.rejuvsUsed) + (spec.kind === 'boss' ? 1 : 0));
  d.kept = { ...d.kept, ...run.kept };
  if (spec.kind === 'boss') d.bridge = []; // the Bridge buffs helped against this floor's boss; they expire now
  d.find = rollFind(d, spec);
  if (d.find?.kind === 'little') d.buffs[d.find.key] = (d.buffs[d.find.key] ?? 0) + 1;
  else if (d.find?.kind === 'big') (d.bridge ??= []).push(d.find.key);
  d.offer = spec.final ? null : rollOffer(d, spec);
  d.room = spec.room + 1;
  d.phase = spec.final ? 'done' : 'offer'; // 'done': the last room is beaten (the run is then taken off the record)
}
const newRun = (hero, seed) => ({ hero, seed, room: 1, level: 0, tiers: {}, items: { weapon: [], vitality: [], spirit: [] }, legendary: null, buffs: {}, bridge: [], find: null, rejuvs: 0, health: 1, kept: {}, imbues: {}, offer: null, phase: 'ready' });

// ---- the member's run (data/farm.json) ----
// The best so far (inside a record update): the member's and this hero's, counting rooms behind the run.
function noteBest(r, d) {
  const rooms = d.room - 1;
  if (rooms > (r.bestDescent?.rooms ?? 0)) r.bestDescent = { rooms, hero: d.hero };
  r.descentBest = { ...r.descentBest, [d.hero]: Math.max(r.descentBest?.[d.hero] ?? 0, rooms) };
}

// Starts a run with one of the member's unlocked heroes. Returns { ok } or { error: 'running' | 'locked' }.
const startRun = (userId, hero, seed = Math.floor(Math.random() * 2 ** 31)) => updateFarmUser(userId, (r) => {
  if (r.descent) return { error: 'running' };
  if (!hasHero(r, hero)) return { error: 'locked' };
  r.descent = newRun(hero, seed);
  return { ok: true };
});
const getRun = async (userId) => (await getFarmUser(userId)).descent ?? null;

// Fight: the next room is claimed (a double click can't fight it twice), played at once, then settled. A loss ends the run.
// Returns { run (simulate's, with `spec`, `over`, `token`, `best`) } or { error: 'none' | 'offer' | 'busy' }.
async function fight(userId, { rng = Math.random, now = Date.now() } = {}) {
  const claim = await updateFarmUser(userId, (r) => {
    const d = r.descent;
    if (!d) return { error: 'none' };
    if (d.phase === 'offer') return { error: 'offer' };
    if (d.phase === 'fighting' && now - (d.fightingAt ?? 0) < STALE_MS) return { error: 'busy' };
    d.phase = 'fighting';
    d.fightingAt = now;
    return { d: structuredClone(d) };
  });
  if (claim.error) return claim;
  const spec = roomSpec(claim.d.seed, claim.d.room, claim.d.hero);
  let run;
  try {
    run = fightRoom(claim.d, spec, rng);
  } catch (error) {
    await updateFarmUser(userId, (r) => { if (r.descent) r.descent.phase = 'ready'; });
    throw error;
  }
  await updateFarmUser(userId, (r) => {
    const d = r.descent;
    if (!d) return;
    delete d.fightingAt;
    if (!run.won) { // the run is over: what it reached stays as the best
      run.over = { ...d, room: spec.room };
      noteBest(r, run.over);
      run.best = r.bestDescent;
      delete r.descent;
      return;
    }
    afterWin(d, run);
    noteBest(r, d);
    run.best = r.bestDescent;
    run.next = structuredClone(d);
    if (d.room - 1 >= TOKEN_ROOM && !r.descentToken) { r.descentToken = true; r.tokens = (r.tokens ?? 0) + 1; run.token = true; }
    if (spec.final) { // the descent is cleared: the run ends here
      r.descentClears = (r.descentClears ?? 0) + 1;
      run.complete = { ...run.next, clears: r.descentClears };
      delete r.descent;
    }
  });
  return { run };
}

// Walk Away from a rival: past the room with nothing gained. Returns { ok } or { error: 'none' }.
const walkPast = (userId) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.phase !== 'ready' || roomSpec(d.seed, d.room, d.hero).kind !== 'rival') return { error: 'none' };
  d.room += 1;
  noteBest(r, d);
  return { ok: true };
});
// Takes choice `index` of the offer made for room `room` (an old message's buttons can't take a later offer).
const choose = (userId, room, index, replace = null) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? takeChoice(r.descent, index, replace) : { error: 'none' }));
const skip = (userId, room) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? skipChoice(r.descent) : { error: 'none' }));
const spend = (userId, slot) => updateFarmUser(userId, (r) => (r.descent ? spendPoint(r.descent, slot) : { error: 'none' }));
// Ends the run where it stands (his open question; my pick: a run waits as long as the member likes, and Abandon ends it). Returns the run or null.
const abandon = (userId) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.phase === 'fighting') return null;
  noteBest(r, d);
  delete r.descent;
  return d;
});

// The server's best runs, deepest first, then the most clears: [{ id, rooms, hero, clears }].
async function leaderboard() {
  const all = await getStore('farm').all();
  return Object.entries(all).filter(([, r]) => r?.bestDescent?.rooms).map(([id, r]) => ({ id, ...r.bestDescent, clears: r.descentClears ?? 0 }))
    .sort((a, b) => b.rooms - a.rooms || b.clears - a.clears);
}

module.exports = {
  ROOMS_PER_FLOOR, FLOORS, LAST_ROOM, TOKEN_ROOM, SKIP_HEAL, BOSS_BUFFS, LITTLE_BUFF_CHANCE, BIG_BUFF_CHANCE, REST, TUNE, BOSS, RIVAL, ARCHETYPES, AFFIXES, BOSSES, TIER_WEIGHTS, NO_RUN_ITEMS, NO_RUN_LEGENDARIES,
  dice, power, floorOf, roomSpec, unitsOf, bossFor, roomLine, roomPicture, runKit, pointsLeft, fightRoom, itemOffer, rollOffer, rollFind, addItem, takeChoice, skipChoice, spendPoint, afterWin, newRun,
  startRun, getRun, fight, walkPast, choose, skip, spend, abandon, leaderboard,
};
