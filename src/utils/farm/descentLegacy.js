// FROZEN: descent.js as it was before the ascension redesign. Only runs started before then (no `v`, an ascension above 0) are played
// with it, through descent.js RUN (they finish on the old rules). Never change it; delete it once no such run is left.
// /descend: a roguelite mode for Hero Farming (plan: descend-plan.md). One of the member's unlocked heroes goes down room after
// room from level 0 with no items. Every won room is a level (boons, ability points, abilities unlock at 0 / 2 / 4 / 7 as usual) and an offer of
// 3 items (vitality / weapon / spirit, like Street Brawl's pick), pick 1 or skip to heal. 12 item slots, upgrade paths kept: an offered upgrade of
// an item the hero holds replaces it in place. Every 5th room is a boss (one of the real ones, sized to the depth) that gives a bigger pick and a
// Rejuv; now and then a rival hero blocks the way and wants a duel. One death ends the run (unless a Rejuv). Score: rooms cleared.
// It ends: 8 floors, 40 rooms; the last is the Patron then the Weakened Patron in one fight, like the siege's end. Clearing it is
// "Descent Cleared" and a place on the leaderboard, nothing more.
// No souls: a run never touches a hero's own souls, items or level (it lives on the member: `descent` on the farm record, next to `bestWave`).
//   descent: { hero, seed, room (the next room to fight, from 1), level, tiers, items: { weapon | vitality | spirit: [names] }, legendary, buffs, bridge, find,
//     rejuvs, health (share of max), kept (kill stacks), imbues, offer: { kind: 'items' | 'buffs' | 'legendaries', choices, room } | null,
//     phase: 'ready' (the next room waits) | 'offer' (picking) | 'fighting' (Fight was pressed), fightingAt }
//   bestDescent: { rooms, hero } (the member's best run), descentBest: { <hero>: rooms }, descentToken: true once the token was paid,
//   descentClears: runs that beat the last room.
// Everything random about a room or an offer comes from `seed` + the room, so closing Discord can't reroll either.
// the enemy numbers (TUNE, BOSS), the archetypes and affixes, the tier weights and the rewards are placeholders tuned with
// `node tools/farm-sim.js descend`.
const path = require('node:path');
const { enemy } = require('./engine');
const { TARGETS, SIEGE } = require('./targets');
const { buildHero, roster } = require('./hero');
const { POOL, ITEM_POOL, SLOTS, SLOT_OF, MAX_ITEMS, countItems, priceFor, heldIn, LEGENDARY_NAMES, TIER_COSTS, MAX_TIER, MAX_LEVEL, UNLOCKS, POINTS, pointsSpent } = require('./levels');
const { itemByName } = require('./stats');
const { BUFFS, BRIDGE, rollAnyBuff } = require('./buffs');
const { IMBUES, NO_ULT_IMBUE } = require('./items');
const { rivalKit } = require('./encounter');
const { ASSETS } = require('../art');
const { getStore } = require('../../storage');
const { simulate, updateFarmUser, getFarmUser, hasHero, tokenUseful, MAX_REJUVS, TRAITS } = require('./play');

const ROOMS_PER_FLOOR = 5; // 4 fights and a boss
const FLOORS = 8;
const LAST_ROOM = FLOORS * ROOMS_PER_FLOOR; // the Patron, then the Weakened Patron
const TOKEN_ROOM = 25; // the end of floor 5: a Character Unlock Token, once per member
const SKIP_HEAL = 0.25; // skipping a pick heals this share of max health
const SKIP_BUFFS = 3; // every skipped reward also grants three permanent buffs
const REST = 0.15; // a breather between two rooms, like waves'
const BOSS_BUFFS = 3; // a boss's buff pick gives this many of that permanent buff
const LITTLE_BUFF_CHANCE = 0.10; // a won fight or rival may turn up one permanent stack
const BIG_BUFF_CHANCE = 0.05; // a Bridge buff for the rest of this floor
const REROLLS_PER_FLOOR = 3;
const ENHANCED_CHANCE = 0.10; // each displayed item; +3 points after a row with none, reset when one is picked
const ENHANCED_STEP = 0.03;
const RIVAL_FROM = 3; // rivals show up from this room (never on a boss room)
const RIVAL_CHANCE = 0.15;
const AFFIX_FROM = 4; // enemies may roll an affix from this room, more often deeper
const MAX_UNITS = 6; // enemies in one room (the live message has a field per enemy)
const UPGRADE_CHANCE = 0.35; // each pick slot offers an upgrade of a held item this often, when there is one
const STALE_MS = 60 * 1000; // a 'fighting' claim older than this (the bot stopped mid-fight) can be fought again

// Ascensions (after Slay the Spire's 20; 20 levels, unlocked per member, picked on the start screen and fixed once the
// run starts). Each level keeps every level below it. Clearing the descent at level N unlocks N + 1 for all of the member's heroes.
// "Elites" are affixed enemies and rivals (like StS's elites: tougher, better rewards); "normal" enemies are the rest of a fight room.
// the sizes in ASC are placeholders tuned with `node tools/farm-sim.js descend --ascension=20` so good picks still clear it; .
const MAX_ASCENSION = 20;
const ASC = { hit: 0.1, health: 0.1, bossHit: 0.1, bossHealth: 0.1, faster: 0.8, longer: 1 };
const ASCENSIONS = [
  null,
  { name: 'More Elites', text: 'Enemies roll affixes from room 2, and 60% more often.' },
  { name: 'Deadlier Enemies', text: `Normal enemies deal ${ASC.hit * 100}% more damage.` },
  { name: 'Deadlier Elites', text: `Affixed enemies deal ${ASC.hit * 100}% more damage; rivals are 1 level below you instead of 2.` },
  { name: 'Deadlier Bosses', text: `Bosses deal ${ASC.bossHit * 100}% more damage.` },
  { name: 'Less Rest', text: 'The breather between rooms heals 11% instead of 15%, and Skip heals 20% instead of 25%.' },
  { name: 'Start Damaged', text: 'Every run starts at 90% health.' },
  { name: 'Tougher Enemies', text: `Normal enemies have ${ASC.health * 100}% more health.` },
  { name: 'Tougher Elites', text: `Affixed enemies have ${ASC.health * 100}% more health; rivals keep 80% of their health instead of 70%.` },
  { name: 'Tougher Bosses', text: `Bosses have ${ASC.bossHealth * 100}% more health.` },
  { name: 'Bane', text: `A cursed item slot: ${MAX_ITEMS - 1} items instead of ${MAX_ITEMS}.` },
  { name: 'Fewer Rejuvs', text: `Carry at most ${MAX_REJUVS - 1} Rejuvs.` },
  { name: 'Fewer Enhanced', text: 'Enhanced items show up half as often.' },
  { name: 'Poor Bosses', text: `A boss's buff pick gives ${BOSS_BUFFS - 1} stacks instead of ${BOSS_BUFFS}.` },
  { name: 'Lower Max Health', text: 'Your hero has 5% less max health.' },
  { name: 'Unlucky Finds', text: `Buffs are found half as often, and Skip gives ${SKIP_BUFFS - 1} buffs instead of ${SKIP_BUFFS}.` },
  { name: 'Costly Rerolls', text: `${REROLLS_PER_FLOOR - 1} rerolls a floor instead of ${REROLLS_PER_FLOOR}.` },
  { name: 'Harder Enemies', text: `Enemies curse, control and heal 25% more often; their curses and stuns last ${ASC.longer} s longer.` },
  { name: 'Harder Elites', text: `Affixed enemies get a 2nd affix; rivals are your level; silences and disarms last ${ASC.longer} s longer.` },
  { name: 'Harder Bosses', text: `Bosses control 25% more often, curses and stuns last ${ASC.longer} s longer; floor bosses get an affix.` },
  { name: 'Double Boss', text: 'Room 40 opens with a floor boss before the Patron and the Weakened Patron, in one fight.' },
];
// The run's own numbers at its ascension (`d.ascension`, 0 for runs from before ascensions).
function rules(d) {
  const at = (n) => (d?.ascension ?? 0) >= n;
  return {
    ascension: d?.ascension ?? 0,
    rest: at(5) ? 0.11 : REST,
    skipHeal: at(5) ? 0.2 : SKIP_HEAL,
    startHealth: at(6) ? 0.9 : 1,
    maxItems: MAX_ITEMS - (at(10) ? 1 : 0),
    maxRejuvs: MAX_REJUVS - (at(11) ? 1 : 0),
    enhanced: ENHANCED_CHANCE * (at(12) ? 0.5 : 1),
    enhancedStep: ENHANCED_STEP * (at(12) ? 0.5 : 1),
    bossBuffs: BOSS_BUFFS - (at(13) ? 1 : 0),
    healthScale: at(14) ? 0.95 : 1,
    little: LITTLE_BUFF_CHANCE * (at(15) ? 0.5 : 1),
    big: BIG_BUFF_CHANCE * (at(15) ? 0.5 : 1),
    skipBuffs: SKIP_BUFFS - (at(15) ? 1 : 0),
    rerolls: REROLLS_PER_FLOOR - (at(16) ? 1 : 0),
  };
}
// Blasts, controls and specials come `ASC.faster` as far apart (A17 for room enemies, A19 for bosses).
function faster(e) {
  if (e.stats.blast) e.stats.blast = { ...e.stats.blast, every: e.stats.blast.every * ASC.faster };
  e.stats.controls = (e.stats.controls ?? []).map((c) => ({ ...c, every: c.every * ASC.faster }));
  if (e.stats.special?.chance) e.stats.special = { ...e.stats.special, chance: Math.min(1, e.stats.special.chance / ASC.faster) };
}
// The hero's crowd control with one of `tags` lasts `ASC.longer` seconds more (A17 room enemies' and A19 bosses' curses and stuns
// (a grapple is a stun), A18 room enemies' silences and disarms).
const CURSE_STUN = ['curse', 'stun'];
const SILENCE_DISARM = ['silence', 'disarm'];
function longer(e, tags) {
  const hits = (t) => t.some((x) => tags.includes(x));
  const b = e.stats.blast;
  if (b?.curse > 0 && hits(b.tags ?? ['sleep'])) e.stats.blast = { ...b, curse: b.curse + ASC.longer }; // the engine's default blast tag
  e.stats.controls = (e.stats.controls ?? []).map((c) => (c.duration > 0 && hits(c.tags) ? { ...c, duration: c.duration + ASC.longer } : c));
}

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
const MEND = { name: 'Mend', text: 'heals every enemy for 6% of its health.', chance: 0.3, use(fight) { for (const e of fight.enemies) if (e.alive && e.team === 'enemy') e.health = Math.min(e.stats.maxHealth, e.health + e.stats.maxHealth * 0.06); } };
const ICONS = path.join(ASSETS, 'farm', 'icons');
// The archetypes a fight room's budget is spent on (room 1 numbers): cost in threat points, count per pick, picture (the trooper renders).
const ARCHETYPES = {
  tank: { name: 'Brute', plural: 'Brutes', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 900, dps: 6, distance: 8, bulletResist: 0.1 }, text: 'lots of health, little damage' },
  swarm: { name: 'Swarmling', plural: 'Swarmlings', cost: 2, count: 2, icon: 'trooper', stats: { maxHealth: 150, dps: 4, distance: 12 }, text: 'small and many' },
  glass: { name: 'Sharpshooter', plural: 'Sharpshooters', cost: 3, icon: 'trooper', stats: { maxHealth: 260, dps: 15, distance: 30 }, text: 'hits hard from far away, little health' },
  healer: { name: 'Medic', plural: 'Medics', cost: 3, icon: 'trooper-medic', stats: { maxHealth: 350, dps: 3, distance: 18 }, special: MEND, text: 'heals the others' },
  bruiser: { name: 'Bruiser', plural: 'Bruisers', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 600, dps: 11, distance: 4 }, text: 'close in, hits hard' },
  caster: { name: 'Hexer', plural: 'Hexers', cost: 4, icon: 'trooper-medic', stats: { maxHealth: 400, dps: 6, distance: 18, damageType: 'spirit', blast: { every: 8, damage: 45, maxHealthPct: 0, curse: 1, type: 'spirit', tags: ['curse'] } }, text: 'spirit damage and a curse' },
  disruptor: { name: 'Disruptor', plural: 'Disruptors', cost: 4, icon: 'trooper-medic', stats: { maxHealth: 420, dps: 7, distance: 18, controls: [{ id: 'silence', every: 9, duration: 1.2, tags: ['silence'], verb: 'silenced' }] }, text: 'silences abilities' },
  grappler: { name: 'Grappler', plural: 'Grapplers', cost: 4, icon: 'trooper-melee', stats: { maxHealth: 550, dps: 9, distance: 5, controls: [{ id: 'grapple', every: 10, duration: 1, tags: ['stun', 'immobilize'], verb: 'grappled' }] }, text: 'grapples and interrupts' },
};
for (const a of Object.values(ARCHETYPES)) a.icon = path.join(ICONS, `${a.icon}.png`);
// Affixes (the Isaac "champion" idea): the four camp traits plus a few the engine already knows (regen, lifesteal, a heal cut, a curse, more health).
// Berserk / Armor-breaking from the plan still need engine work; left out until needed.
const resist = (x) => Math.max(0, Math.min(0.9, x));
const AFFIXES = {
  ...Object.fromEntries(TRAITS.filter((t) => t.name).map((t) => [t.name, { text: t.bullet > 0 && t.spirit > 0 ? 'resists everything' : t.bullet > 0 ? 'resists bullets' : t.spirit > 0 ? 'resists spirit' : 'takes more of everything',
    apply(e) { e.stats.bulletResist = resist(e.stats.bulletResist + t.bullet); e.stats.spiritResist = resist(e.stats.spiritResist + t.spirit); } }])),
  Regenerating: { text: 'heals itself', apply(e) { e.stats.healthRegen += e.stats.maxHealth * 0.015; } },
  Vampiric: { text: 'heals from its hits', apply(e) { e.stats.drain = 0.4; } },
  Withering: { text: 'its hits cut healing', apply(e) { e.stats.antiHeal = { cut: 0.4, seconds: 3 }; } },
  Cursing: { text: 'curses now and then', apply(e) { e.stats.blast ??= { every: 9, damage: e.stats.dps * 2, maxHealthPct: 0, curse: 1, type: 'spirit', tags: ['curse'] }; } },
  Stunning: { text: 'stuns now and then', apply(e) { e.stats.controls.push({ id: 'stun', every: 10, duration: 0.8, tags: ['stun'], verb: 'stunned' }); } },
  Silencing: { text: 'silences abilities', apply(e) { e.stats.controls.push({ id: 'silence', every: 10, duration: 1, tags: ['silence'], verb: 'silenced' }); } },
  Grappling: { text: 'grapples and interrupts', apply(e) { e.stats.controls.push({ id: 'grapple', every: 11, duration: 1, tags: ['stun', 'immobilize'], verb: 'grappled' }); } },
  Disarming: { text: 'disarms: no shooting for a moment', apply(e) { e.stats.controls.push({ id: 'disarm', every: 10, duration: 1.5, tags: ['disarm'], verb: 'disarmed' }); } }, // and numbers, Oct 28
  Shielded: { text: 'half again the health', apply(e) { e.stats.maxHealth *= 1.5; e.health = e.stats.maxHealth; } },
};
// An affixed enemy's name shows its affixes in brackets, bold where Discord renders it: "**[Armored]** Brute"; `plain` for titles and buttons.
const affixTag = (affix, plain = false) => (plain ? `[${affix}]` : `**[${affix}]**`);
const affixChance = (room, a = 0) => (a >= 1 ? Math.min(0.8, 1.6 * (0.15 + 0.03 * (room - AFFIX_FROM))) : Math.min(0.6, 0.15 + 0.03 * (room - AFFIX_FROM)));
const BOSS_AFFIXES = Object.keys(AFFIXES).filter((k) => k !== 'Shielded'); // A19: half again a boss's health would be too much on top

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
function bossFor(key, room, a = 0, affix = null) {
  const e = BOSSES[key].make();
  e.name = affix ? `${affixTag(affix)} ${BOSSES[key].name}` : BOSSES[key].name;
  const k = power(room) * (a >= 9 ? 1 + ASC.bossHealth : 1);
  const hit = a >= 4 ? 1 + ASC.bossHit : 1;
  const tough = (1 - (e.stats.bulletResist + e.stats.spiritResist) / 2) / (1 - BOSS.resist); // the same health behind its resists for every boss
  const health = BOSS.health * TUNE.health * k * tough;
  const dps = BOSS.dps * TUNE.dps * power(room) * hit * (e.stats.blast ? 1 - e.stats.blast.curse / e.stats.blast.every : 1); // a boss that curses (the Walker's stomp, the Shrine) hits softer
  const grew = dps / (e.stats.dps || dps); // the share of its own numbers it fights with here
  e.stats.healthRegen *= health / e.stats.maxHealth;
  e.stats.maxHealth = health;
  e.health = health;
  e.stats.dps = dps;
  e.stats.dpsMaxHealthPct = Math.min(0.05, e.stats.dpsMaxHealthPct * grew);
  if (e.stats.blast) e.stats.blast = { ...e.stats.blast, damage: e.stats.blast.damage * grew, maxHealthPct: Math.min(0.4, e.stats.blast.maxHealthPct * grew) };
  if (a >= 19) faster(e);
  if (affix) AFFIXES[affix].apply(e);
  if (a >= 19) longer(e, CURSE_STUN); // after the affix, so a Stunning boss's stun lasts longer too
  return e;
}

// What room `room` of a run holds (from the seed and the ascension alone, so it can be shown before the fight):
//   { room, floor, ascension, kind: 'fight', groups: [{ type, affix, affix2? }] } | { kind: 'boss', boss, affix?, final?, first? } | { kind: 'rival', rival }
// (the rolls an ascension adds come after the others, so a room at ascension 0 is the same as before ascensions)
function roomSpec(seed, room, hero, ascension = 0) {
  const rng = dice(seed, room, 'room');
  const base = { room, floor: floorOf(room), ascension };
  if (room === LAST_ROOM) return { ...base, kind: 'boss', boss: 'patron', final: true, ...(ascension >= 20 ? { first: pick(FLOOR_BOSSES, rng) } : {}) };
  if (room % ROOMS_PER_FLOOR === 0) {
    const boss = pick(FLOOR_BOSSES, rng);
    return { ...base, kind: 'boss', boss, ...(ascension >= 19 ? { affix: pick(BOSS_AFFIXES, rng) } : {}) };
  }
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
    groups.push({ type, affix: room >= (ascension >= 1 ? 2 : AFFIX_FROM) && rng() < affixChance(room, ascension) ? pick(Object.keys(AFFIXES), rng) : null });
  }
  if (ascension >= 18) for (const g of groups) if (g.affix) g.affix2 = pick(Object.keys(AFFIXES).filter((k) => k !== g.affix), rng);
  return { ...base, kind: 'fight', groups };
}
const specOf = (d, room = d.room) => roomSpec(d.seed, room, d.hero, d.ascension ?? 0);
const affixesOf = (g) => [g.affix, g.affix2].filter(Boolean);
// The bottom room's bosses, in order (A20 puts a floor boss first).
const finalKeys = (spec) => (spec.first ? [spec.first, ...FINAL] : FINAL);

// The enemy units of a fight room.
const unitsOf = (spec) => spec.groups.flatMap((g) => {
  const a = ARCHETYPES[g.type];
  const asc = spec.ascension ?? 0;
  const affixes = affixesOf(g);
  const elite = affixes.length > 0;
  const k = power(spec.room);
  const health = k * (asc >= (elite ? 8 : 7) ? 1 + ASC.health : 1);
  const hit = k * (asc >= (elite ? 3 : 2) ? 1 + ASC.hit : 1);
  return Array.from({ length: a.count ?? 1 }, () => {
    const s = a.stats;
    const e = enemy([...affixes.map((x) => affixTag(x)), a.name].join(' '), { ...s, maxHealth: s.maxHealth * TUNE.health * health, dps: s.dps * TUNE.dps * hit, blast: s.blast && { ...s.blast, damage: s.blast.damage * TUNE.dps * hit } });
    if (a.special) e.stats.special = a.special;
    for (const affix of affixes) AFFIXES[affix].apply(e);
    if (asc >= 17) faster(e);
    if (asc >= 17) longer(e, CURSE_STUN);
    if (asc >= 18) longer(e, SILENCE_DISARM);
    return e;
  });
});

// "2 Swarmlings, 1 Armored Brute, 1 Hexer": a room's enemies in a line (the telegraph before the fight).
function roomLine(spec) {
  if (spec.final) return finalKeys(spec).map((key) => `the ${BOSSES[key].name}`).join(', then ');
  if (spec.kind === 'boss') return `the ${bossName(spec)}`;
  if (spec.kind === 'rival') return spec.rival;
  const counts = new Map();
  for (const g of spec.groups) {
    const key = [...affixesOf(g), g.type].join(' ');
    counts.set(key, (counts.get(key) ?? 0) + (ARCHETYPES[g.type].count ?? 1));
  }
  return [...counts].map(([key, n]) => { const words = key.split(' '); const a = ARCHETYPES[words.pop()]; return [n, ...words.map((x) => affixTag(x)), n === 1 ? a.name : a.plural].join(' '); }).join(', ');
}
const bossName = (spec, plain = false) => [spec.affix && affixTag(spec.affix, plain), BOSSES[spec.boss].name].filter(Boolean).join(' ');
// The picture for a room (`stage`: the last room's second fight): the boss, the trooper render of its first enemy, or (a rival) null: the views draw the rival's face.
const roomPicture = (spec, stage = 0) => (spec.final ? BOSSES[finalKeys(spec)[stage] ?? 'patron'].icon : spec.kind === 'boss' ? BOSSES[spec.boss].icon : spec.kind === 'fight' ? ARCHETYPES[spec.groups[0].type].icon : null);

// ---- the run's hero ----
// What the run's hero fights with (the same shape as play.js fightKit).
const runKit = (d) => ({
  healthScale: rules(d).healthScale, boons: d.level, unlocked: UNLOCKS(d.level), points: POINTS(d.level), tiers: d.tiers,
  items: [...SLOTS.flatMap((s) => d.items[s]), ...(d.legendary ? [d.legendary] : [])], enhanced: d.enhanced ?? [], buffs: d.buffs, bridge: d.bridge ?? [], imbues: d.imbues, kept: d.kept,
});
const pointsLeft = (d) => POINTS(d.level) - pointsSpent(d.tiers);

// A rival rolls its kit around the hero's (encounter.js) but RIVAL.levels lower and with RIVAL.health of its health: a fair duel would end half the runs.
// Ascensions: 1 level lower from A3, at the hero's level from A18; 80% of its health from A8.
const RIVAL = { levels: 2, health: 0.7 };
const rivalLevels = (a) => (a >= 18 ? 0 : a >= 3 ? RIVAL.levels - 1 : RIVAL.levels);
const rivalHealth = (a) => (a >= 8 ? RIVAL.health + 0.1 : RIVAL.health);
function rivalKitFor(spec, d, kit = runKit(d)) {
  const lower = rivalLevels(d.ascension ?? 0);
  return rivalKit({ ...kit, boons: Math.max(0, kit.boons - lower), points: POINTS(Math.max(0, d.level - lower)), unlocked: UNLOCKS(Math.max(0, d.level - lower)) }, dice(d.seed, spec.room, 'rival'));
}
function rivalFor(spec, d, kit) {
  const unit = buildHero(spec.rival, rivalKitFor(spec, d, kit));
  unit.stats.maxHealth *= rivalHealth(d.ascension ?? 0);
  unit.health = unit.stats.maxHealth;
  return unit;
}
// What room `spec` holds, for View Enemy Build: { units } (the enemies, as the fight will build them) or { rival, kit, health } (a rival hero's kit is rolled from the run's seed, so it is the one it fights with).
const bossesOf = (spec) => (spec.final ? finalKeys(spec).map((key) => bossFor(key, spec.room, spec.ascension)) : [bossFor(spec.boss, spec.room, spec.ascension, spec.affix)]);
const enemiesOf = (d, spec) => (spec.kind === 'rival' ? { rival: spec.rival, kit: rivalKitFor(spec, d), health: rivalHealth(d.ascension ?? 0) }
  : { units: spec.kind === 'boss' ? bossesOf(spec) : unitsOf(spec) });

// Plays room `spec` with the run `d` (nothing saved). Returns play.js simulate's run, with `spec`.
function fightRoom(d, spec, rng = Math.random) {
  const kit = runKit(d);
  const enemies = spec.kind === 'boss' ? () => bossesOf(spec)
    : spec.kind === 'rival' ? () => [rivalFor(spec, d, kit)]
      : () => unitsOf(spec);
  const stages = spec.final ? finalKeys(spec).map((key) => ({ name: BOSSES[key].name, enemies: () => [bossFor(key, spec.room, spec.ascension)] })) // in one go, health carried
    : [{ name: `Room ${spec.room}`, enemies }];
  const run = simulate(d.hero, 'descend', { rng, stages, health: d.health, rejuvs: d.rejuvs, ...kit });
  return { ...run, spec, ...(spec.kind === 'rival' ? { theirs: rivalKitFor(spec, d, kit), theirHealth: rivalHealth(d.ascension ?? 0) } : {}) };
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
  const { maxItems } = rules(d);
  const ok = (n) => !NO_RUN_ITEMS.has(n) && !owned.includes(n) && !heldIn(n, d.items);
  const tierRoll = () => { let r = rng() * weights.reduce((a, b) => a + b, 0); return weights.findIndex((w) => (r -= w) < 0) + 1 || top; };
  const choices = OFFER_ORDER.map((kind) => {
    const upgrades = POOL[kind].filter((n) => ok(n) && itemByName(n).Tier <= top && priceFor(itemByName(n), d.items).used.length);
    if (upgrades.length && rng() < UPGRADE_CHANCE) return pick(upgrades, rng);
    const tier = tierRoll();
    for (const t of [tier, ...[1, 2, 3, 4].filter((x) => x !== tier).sort((a, b) => Math.abs(a - tier) - Math.abs(b - tier))]) {
      const pool = POOL[kind].filter((n) => ok(n) && itemByName(n).Tier === t);
      if (pool.length) return pick(pool, rng);
    }
    return null;
  }).filter(Boolean);
  const bonuses = {};
  choices.forEach((name, i) => {
    const card = itemByName(name);
    const { used } = priceFor(card, d.items);
    if (!used.length || countItems(d.items) - used.length + 1 >= maxItems) return; // a BONUS only comes with room left once the upgrade is in
    const pool = POOL[SLOT_OF[card.Slot]].filter((n) => ok(n) && !choices.includes(n) && itemByName(n).Tier < card.Tier);
    if (pool.length) bonuses[i] = pick(pool, rng);
  });
  return { choices, bonuses };
}

// The reward for room `spec` just cleared: a boss gives 1 of 3 permanent buffs (or on odd floors from 3, 1 of 3 legendaries), anything else 3 items.
function rollOffer(d, spec, roll = 0) {
  const rng = dice(d.seed, spec.room, 'offer', roll);
  const decorate = (offer) => {
    if (offer.kind === 'buffs') return offer;
    const { enhanced, enhancedStep } = rules(d);
    offer.enhanced = offer.choices.filter(() => rng() < (d.enhancedChance ?? enhanced));
    if (!offer.enhanced.length) d.enhancedChance = Math.min(1, (d.enhancedChance ?? enhanced) + enhancedStep);
    // An upgrade of an enhanced held item shows as enhanced too (addItem carries it over).
    if (offer.kind === 'items') offer.enhanced.push(...offer.choices.filter((n) => !offer.enhanced.includes(n) && priceFor(itemByName(n), d.items).used.some((u) => d.enhanced?.includes(u))));
    return offer;
  };
  if (spec.kind === 'boss') {
    const legends = LEGENDARY_NAMES.filter((n) => !NO_RUN_LEGENDARIES.has(n) && n !== d.legendary);
    if (spec.floor >= 3 && spec.floor % 2 && legends.length >= 3) return decorate({ kind: 'legendaries', choices: take(legends, 3, rng), room: spec.room, roll });
    return { kind: 'buffs', choices: take(Object.keys(BUFFS), 3, rng), room: spec.room };
  }
  const { choices, bonuses } = itemOffer(d, rng, spec.kind === 'rival' ? 1 : 0, spec.room);
  return decorate({ kind: 'items', choices, bonuses, room: spec.room, roll });
}

// A won fight or rival may uncover one buff. The room's drop stream is fixed by the run seed, even across restarts.
function rollFind(d, spec) {
  if (spec.kind !== 'fight' && spec.kind !== 'rival') return null;
  const rng = dice(d.seed, spec.room, 'drop');
  const chance = rng();
  const { little, big } = rules(d);
  if (chance < little) return { kind: 'little', key: rollAnyBuff(rng), room: spec.room };
  if (chance < little + big) {
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
  d.enhanced = (d.enhanced ?? []).filter((n) => n !== name);
}
// Puts item `name` in the build: an upgrade of a held item replaces it in place; with 12 items anything else needs `replace` (lost, no sell-back).
// Returns { ok: true, used: [components replaced], replaced } or { error: 'full' | 'missing' }.
function addItem(d, name, replace = null, enhanced = false) {
  const card = itemByName(name);
  const { used } = priceFor(card, d.items);
  if (used.some((u) => d.enhanced?.includes(u))) enhanced = true; // an upgrade of an enhanced item stays enhanced
  let replaced = null;
  if (!used.length && countItems(d.items) >= rules(d).maxItems) {
    if (!replace) return { error: 'full' };
    if (!SLOTS.some((s) => d.items[s].includes(replace))) return { error: 'missing' };
    dropItem(d, replace);
    replaced = replace;
  }
  for (const u of used) dropItem(d, u);
  d.items[SLOT_OF[card.Slot]].push(name);
  if (enhanced && !(d.enhanced ??= []).includes(name)) d.enhanced.push(name);
  // An imbue item is not useful until its owner chooses the ability. The pick screen
  // holds the run here instead of silently putting every item into ability one.
  return { ok: true, used, replaced };
}
function beginImbues(d, names) {
  const imbues = names.filter((n) => IMBUES.includes(n));
  if (!imbues.length) return false;
  d.pendingImbues = [...(d.pendingImbues ?? []), ...imbues];
  d.imbuing = d.pendingImbues.shift();
  d.phase = 'imbue';
  return true;
}
// Takes choice `index` of the offer. Returns { ok, kind, name, used, replaced } or { error: 'none' | 'full' | 'missing' }.
function takeChoice(d, index, replace = null) {
  const name = d.offer?.choices[index];
  if (d.phase !== 'offer' || !name) return { error: 'none' };
  let extra = {};
  const enhanced = d.offer.enhanced?.includes(name) ?? false;
  if (d.offer.kind === 'buffs') {
    extra = { stacks: rules(d).bossBuffs };
    d.buffs[name] = (d.buffs[name] ?? 0) + extra.stacks;
  }
  else if (d.offer.kind === 'legendaries') {
    d.enhanced = (d.enhanced ?? []).filter((n) => n !== d.legendary);
    d.legendary = name;
    if (enhanced && !d.enhanced.includes(name)) d.enhanced.push(name);
  } else {
    const next = structuredClone(d);
    extra = addItem(next, name, replace, enhanced);
    if (extra.error) return extra;
    const bonus = d.offer.bonuses?.[index];
    if (bonus) {
      if (!addItem(next, bonus).error) extra.bonus = bonus; // no room (an offer made before t): just the upgrade
    }
    Object.assign(d, next);
  }
  if (enhanced) d.enhancedChance = rules(d).enhanced;
  const { kind } = d.offer;
  d.offer = null;
  if (!beginImbues(d, [name, extra.bonus].filter(Boolean))) d.phase = 'ready';
  return { ...extra, ok: true, kind, name, ...(enhanced ? { enhanced: true } : {}) };
}
// Finishes the mandatory ability choice for an imbue item. A bonus can also be an
// imbue item, so keep a small queue rather than dropping a second choice.
function setImbue(d, slot) {
  const name = d.imbuing;
  if (d.phase !== 'imbue' || !name || !IMBUES.includes(name)) return { error: 'none' };
  if (!(slot >= 1 && slot <= UNLOCKS(d.level))) return { error: 'locked' };
  if (NO_ULT_IMBUE.has(name) && slot === 4) return { error: 'ultimate' };
  d.imbues[name] = slot;
  d.imbuing = d.pendingImbues?.shift() ?? null;
  if (!d.imbuing) { delete d.imbuing; delete d.pendingImbues; d.phase = d.pendingBonus ? 'bonus' : 'ready'; }
  return { ok: true, name, slot, more: d.imbuing };
}
// The primary upgrade is always taken first. At a full build, its extra BONUS item
// gets its own replacement choice, so an upgrade never masquerades as a swap.
function takeBonus(d, replace) {
  const pending = d.pendingBonus;
  if (d.phase !== 'bonus' || !pending?.name) return { error: 'none' };
  const added = addItem(d, pending.name, replace);
  if (added.error) return added;
  delete d.pendingBonus;
  if (!beginImbues(d, [pending.name])) d.phase = 'ready';
  return { ...added, ok: true, name: pending.name, bonus: true };
}
function rerollChoice(d) {
  if (d.phase !== 'offer' || d.offer?.kind !== 'items') return { error: 'none' };
  d.rerolls ??= rules(d).rerolls; // runs already in progress when this shipped receive this floor's three
  if (d.rerolls <= 0) return { error: 'empty' };
  d.rerolls--;
  const spec = specOf(d, d.offer.room);
  d.offer = rollOffer(d, spec, (d.offer.roll ?? 0) + 1);
  return { ok: true };
}
function skipChoice(d) {
  if (d.phase !== 'offer') return { error: 'none' };
  const rng = dice(d.seed, d.offer.room, 'skip-buffs');
  // a boss's buff pick is already worth 3 stacks of one buff: skipping it for 3 random ones plus a heal would beat taking it, so it only heals
  const buffs = d.offer.kind === 'buffs' ? [] : Array.from({ length: rules(d).skipBuffs }, () => rollAnyBuff(rng));
  d.buffs ??= {};
  for (const key of buffs) d.buffs[key] = (d.buffs[key] ?? 0) + 1;
  const before = d.health;
  d.health = Math.min(1, d.health + rules(d).skipHeal);
  d.offer = null;
  d.phase = 'ready';
  return { ok: true, buffs, healed: d.health - before };
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
  const r = rules(d);
  d.health = Math.min(1, run.health + r.rest);
  d.rejuvs = Math.min(r.maxRejuvs, Math.max(0, d.rejuvs - run.rejuvsUsed) + (spec.kind === 'boss' ? 1 : 0));
  d.kept = { ...d.kept, ...run.kept, ...run.stacks }; // the items' kill stacks and the abilities' (they last the run)
  if (spec.kind === 'boss') d.bridge = []; // the Bridge buffs helped against this floor's boss; they expire now
  if (spec.room % ROOMS_PER_FLOOR === 0) d.rerolls = r.rerolls;
  d.find = rollFind(d, spec);
  if (d.find?.kind === 'little') d.buffs[d.find.key] = (d.buffs[d.find.key] ?? 0) + 1;
  else if (d.find?.kind === 'big') (d.bridge ??= []).push(d.find.key);
  d.offer = spec.final ? null : rollOffer(d, spec);
  d.room = spec.room + 1;
  d.phase = spec.final ? 'done' : 'offer'; // 'done': the last room is beaten (the run is then taken off the record)
}
function newRun(hero, seed, ascension = 0) {
  const r = rules({ ascension });
  return { hero, seed, ascension, room: 1, level: 0, tiers: {}, items: { weapon: [], vitality: [], spirit: [] }, legendary: null, enhanced: [], enhancedChance: r.enhanced, rerolls: r.rerolls, buffs: {}, bridge: [], find: null, rejuvs: 0, health: r.startHealth, kept: {}, imbues: {}, offer: null, phase: 'ready' };
}

// ---- the member's run (data/farm.json) ----
// The best so far (inside a record update): the member's (the highest ascension first, then rooms) and this hero's rooms.
function noteBest(r, d) {
  const rooms = d.room - 1;
  const ascension = d.ascension ?? 0;
  const best = r.bestDescent;
  if (rooms > 0 && (!best?.rooms || ascension > (best.ascension ?? 0) || (ascension === (best.ascension ?? 0) && rooms > best.rooms))) r.bestDescent = { rooms, hero: d.hero, ...(ascension ? { ascension } : {}) };
  r.descentBest = { ...r.descentBest, [d.hero]: Math.max(r.descentBest?.[d.hero] ?? 0, rooms) };
}

// The highest ascension the member may pick (per member): one above the highest they cleared.
const ascensionOf = (r) => r?.descentAscension ?? 0;
// Starts a run with one of the member's unlocked heroes at an ascension they unlocked (fixed for the run).
// Returns { ok } or { error: 'running' | 'locked' | 'ascension' }.
const startRun = (userId, hero, seed = Math.floor(Math.random() * 2 ** 31), ascension = 0) => updateFarmUser(userId, (r) => {
  if (r.descent) return { error: 'running' };
  if (!hasHero(r, hero)) return { error: 'locked' };
  if (!(Number.isInteger(ascension) && ascension >= 0 && ascension <= ascensionOf(r))) return { error: 'ascension' };
  r.descent = newRun(hero, seed, ascension);
  return { ok: true };
});
const getRun = async (userId) => (await getFarmUser(userId)).descent ?? null;

// Fight: the next room is claimed (a double click can't fight it twice), played at once, then settled. A loss ends the run.
// Returns { run (simulate's, with `spec`, `over`, `token`, `best`) } or { error: 'none' | 'offer' | 'busy' }.
async function fight(userId, { rng = Math.random, now = Date.now() } = {}) {
  const claim = await updateFarmUser(userId, (r) => {
    const d = r.descent;
    if (!d) return { error: 'none' };
    if (d.phase === 'fighting' && now - (d.fightingAt ?? 0) < STALE_MS) return { error: 'busy' };
    if (d.phase !== 'ready' && d.phase !== 'fighting') return { error: 'offer' };
    d.phase = 'fighting';
    d.fightingAt = now;
    return { d: structuredClone(d) };
  });
  if (claim.error) return claim;
  const spec = specOf(claim.d);
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
    if (d.room - 1 >= TOKEN_ROOM && !r.descentToken && tokenUseful(r)) { r.descentToken = true; r.tokens = (r.tokens ?? 0) + 1; run.token = true; }
    if (spec.final) { // the descent is cleared: the run ends here
      r.descentClears = (r.descentClears ?? 0) + 1;
      const a = d.ascension ?? 0;
      // each ascension (1-20) cleared for the first time is a Character Unlock Token, while a hero is left to unlock
      if (a >= 1 && a > (r.descentCleared ?? -1) && tokenUseful(r)) { r.tokens = (r.tokens ?? 0) + 1; run.ascensionToken = a; }
      r.descentCleared = Math.max(r.descentCleared ?? -1, a); // the highest ascension cleared
      const unlocked = a < MAX_ASCENSION && a + 1 > ascensionOf(r) ? a + 1 : null;
      if (unlocked) r.descentAscension = unlocked;
      run.complete = { ...run.next, clears: r.descentClears, ...(unlocked ? { unlocked } : {}), ...(run.ascensionToken ? { token: true } : {}) };
      delete r.descent;
    }
  });
  return { run };
}

// Walk Away from a rival: past the room with nothing gained. Returns { ok } or { error: 'none' }.
const walkPast = (userId) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.phase !== 'ready' || specOf(d).kind !== 'rival') return { error: 'none' };
  d.room += 1;
  noteBest(r, d);
  return { ok: true };
});
// Takes choice `index` of the offer made for room `room` (an old message's buttons can't take a later offer).
const choose = (userId, room, index, replace = null) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? takeChoice(r.descent, index, replace) : { error: 'none' }));
const skip = (userId, room) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? skipChoice(r.descent) : { error: 'none' }));
const reroll = (userId, room) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? rerollChoice(r.descent) : { error: 'none' }));
const spend = (userId, slot) => updateFarmUser(userId, (r) => (r.descent ? spendPoint(r.descent, slot) : { error: 'none' }));
const imbue = (userId, slot) => updateFarmUser(userId, (r) => (r.descent ? setImbue(r.descent, slot) : { error: 'none' }));
const takeBonusItem = (userId, replace) => updateFarmUser(userId, (r) => (r.descent ? takeBonus(r.descent, replace) : { error: 'none' }));
// Ends the run where it stands (a run waits as long as the member likes, and Abandon ends it). Returns the run or null.
const abandon = (userId) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.phase === 'fighting') return null;
  noteBest(r, d);
  delete r.descent;
  return d;
});

// The server's best runs, the highest ascension first, then the deepest, then the most clears: [{ id, rooms, hero, ascension, clears }].
async function leaderboard() {
  const all = await getStore('farm').all();
  return Object.entries(all).filter(([, r]) => r?.bestDescent?.rooms).map(([id, r]) => ({ id, ...r.bestDescent, ascension: r.bestDescent.ascension ?? 0, clears: r.descentClears ?? 0 }))
    .sort((a, b) => b.ascension - a.ascension || b.rooms - a.rooms || b.clears - a.clears);
}

module.exports = {
  MAX_ASCENSION, ASC, ASCENSIONS, rules, specOf, finalKeys, bossName, affixTag, ascensionOf,
  ROOMS_PER_FLOOR, FLOORS, LAST_ROOM, TOKEN_ROOM, SKIP_HEAL, SKIP_BUFFS, BOSS_BUFFS, LITTLE_BUFF_CHANCE, BIG_BUFF_CHANCE, REROLLS_PER_FLOOR, ENHANCED_CHANCE, ENHANCED_STEP, REST, TUNE, BOSS, RIVAL, ARCHETYPES, AFFIXES, BOSSES, TIER_WEIGHTS, NO_RUN_ITEMS, NO_RUN_LEGENDARIES,
  dice, power, floorOf, roomSpec, unitsOf, bossFor, roomLine, roomPicture, runKit, pointsLeft, fightRoom, itemOffer, rollOffer, rollFind, enemiesOf, addItem, takeChoice, takeBonus, skipChoice, rerollChoice, spendPoint, setImbue, afterWin, newRun,
  startRun, getRun, fight, walkPast, choose, skip, reroll, spend, imbue, takeBonusItem, abandon, leaderboard,
};
