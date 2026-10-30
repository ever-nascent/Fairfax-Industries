// /descend: a roguelite mode for Hero Farming (his calls Oct 24). One of the member's unlocked heroes goes down room after
// room from level 0 with no items. Every won room is a level (boons, ability points, abilities unlock at 0 / 2 / 4 / 7 as usual) and an offer of
// 3 items (vitality / weapon / spirit, like Street Brawl's pick), pick 1 or skip to heal. 12 item slots, upgrade paths kept: an offered upgrade of
// an item the hero holds replaces it in place. Every 5th room is a boss (one of the real ones, sized to the depth) that gives a bigger pick and a
// Rejuv; now and then a rival hero blocks the way and wants a duel (his ask, Oct 24). One death ends the run (unless a Rejuv). Score: rooms cleared.
// It ends (his calls, Oct 24): 8 floors, 40 rooms; the last is the Patron then the Weakened Patron in one fight, like the siege's end. Clearing it is
// "Descent Cleared" and a place on the leaderboard, nothing more.
// No souls: a run never touches a hero's own souls, items or level (it lives on the member: `descent` on the farm record, next to `bestWave`).
//   descent: { hero, seed, room (the next room to fight, from 1), level, tiers, items: { weapon | vitality | spirit: [names] }, legendary, corrupted (the Broker's one, Oct 30), buffs, bridge, find,
//     rejuvs, health (share of max), kept (kill stacks), imbues, offer: { kind: 'items' | 'buffs' | 'legendaries', choices, room } | null,
//     phase: 'ready' (the next room waits) | 'offer' (picking) | 'fighting' (Fight was pressed), fightingAt }
//   bestDescent: { rooms, hero } (the member's best run), descentBest: { <hero>: rooms }, descentToken: true once the token was paid,
//   descentClears: runs that beat the last room.
// Everything random about a room or an offer comes from `seed` + the room, so closing Discord can't reroll either.
// ponytail: the enemy numbers (TUNE, BOSS), the archetypes and affixes, the tier weights and the rewards are placeholders tuned with
// `node tools/farm-sim.js descend`; his calls to change.
const path = require('node:path');
const { enemy } = require('./engine');
const { track } = require('../economy/quests');
const { TARGETS, SIEGE } = require('./targets');
const { buildHero, roster } = require('./hero');
const { POOL, ITEM_POOL, canBuy, SLOTS, SLOT_OF, MAX_ITEMS, countItems, priceFor, heldIn, LEGENDARY_NAMES, TIER_COSTS, MAX_TIER, MAX_LEVEL, UNLOCKS, POINTS, pointsSpent } = require('./levels');
const { itemByName } = require('./stats');
const { corruptible, rollDrawback } = require('./levels');
const { BUFFS, BRIDGE, rollAnyBuff } = require('./buffs');
const { IMBUES, NO_ULT_IMBUE } = require('./items');
const { rivalKit } = require('./encounter');
const { ASSETS } = require('../art');
const { getStore } = require('../../storage');
const { simulate, updateFarmUser, getFarmUser, hasHero, tokenUseful, MAX_REJUVS, TRAITS, hauntFile, familyName } = require('./play');
const { specialFor, SPECIALS } = require('./haunts');
const { HAUNTS } = require('./refresh');

const ROOMS_PER_FLOOR = 5; // 4 fights and a boss
const FLOORS = 8; // his call, Oct 24
const LAST_ROOM = FLOORS * ROOMS_PER_FLOOR; // the Patron, then the Weakened Patron
const TOKEN_ROOM = 25; // the end of floor 5: a Character Unlock Token, once per member (my pick from the plan's example; his call)
const SKIP_HEAL = 0.25; // skipping a pick heals this share of max health (his open question; my pick)
const SKIP_BUFFS = 3; // his call Oct 26: every skipped reward also grants three permanent buffs
const REST = 0; // no breather between rooms (his call, Oct 29: "unless you kill a medic, you dont get a passive heal"; it was 15%): a Medic Trooper's pack, Skip and items heal
const BOSS_BUFFS = 3; // a boss's buff pick gives this many of that permanent buff
const LITTLE_BUFF_CHANCE = 0.10; // his call, Oct 25: a won fight or rival may turn up one permanent stack
const BIG_BUFF_CHANCE = 0.05; // his call: a Bridge buff for the rest of this floor
const REROLLS_PER_FLOOR = 3; // his call, Oct 25
const ENHANCED_CHANCE = 0.10; // each displayed item; +3 points after a row with none, reset when one is picked
const ENHANCED_STEP = 0.03;
const RIVAL_FROM = 3; // rivals show up from this room (never on a boss room)
const RIVAL_CHANCE = 0.15;
const BROKER_FROM = 6; // the Broker's stall can replace a fight room from here (floor 2: tier 3 items start turning up)
const BROKER_CHANCE = 0.05; // ponytail: placeholder, his to tune
const BROKER_MAX = 3; // stalls a run: 39 rooms before the Patron minus 3 still reaches level 35, and 29 pick rooms fill 12 items
const BROKER_COST = 0.10; // his call (Oct 30): corrupting costs a small share of max health, not souls
const AFFIX_FROM = 4; // enemies may roll an affix from this room, more often deeper
const MAX_UNITS = 6; // enemies in one room (the live message has a field per enemy)
const UPGRADE_CHANCE = 0.35; // each pick slot offers an upgrade of a held item this often, when there is one
const STALE_MS = 60 * 1000; // a 'fighting' claim older than this (the bot stopped mid-fight) can be fought again

// Ascensions (his ask Oct 26; his calls: 20 levels, unlocked per member, picked on the start screen and fixed once the run starts). Each level keeps
// every level below it. Clearing the descent at level N unlocks N + 1 for all of the member's heroes.
// Redesigned Oct 29 (his ask: "focus more on our game and less so being a carbon copy of slay the spire's, and to actually increase difficulty"; his
// calls: no names, just "Ascension N"; A17-A19 kept). Runs started before that finish on the old rules (descentLegacy.js, his call).
// "Elites" are affixed enemies; "room enemies" are a fight room's (not bosses or rivals).
// ponytail: the sizes in ASC are placeholders (Oct 29: before room fights were made to hurt, 4 / 1 / 2 of 56 good-pick runs cleared A12 / A16 / A20;
// after, about half clear A0 and 4 / 28 A4); his calls, he says when it is too hard.
const MAX_ASCENSION = 20;
// Oct 29 retune (his ask: "adjust the ascensions appropriately"; good picks cleared nothing from A5 up): A3 rivals no longer a level closer, A5 half a
// floor behind instead of a whole one, A11 elites +10% instead of +20%, A14 1 Rejuv (his call, after a day at 2), A15 from floor 5 instead of 3, A16 +5% resist
// instead of +10%, A19's boss affix from floor 3, floor 1-2 bosses a little softer (EARLY_BOSS); then A1 +1 threat point instead of 2, A2 / A6
// +5% instead of +10%, A7 cuts healing 10% instead of 20%; then A17 / A19 10% more often (was 25%) and 0.5 s longer (was 1 s), A18 rivals 1 level
// below you (was your level).
const ASC = { room: 0.05, elite: 0.1, boss: 0.1, wards: 0.05, healbane: 0.1, faster: 0.9, longer: 0.5, bossRejuv: 0.3, walkCost: 0.1 };
const ASCENSIONS = [
  null,
  { text: 'From floor 3, fight rooms bring one more enemy.' },
  { text: 'Room enemies have 5% more health.' },
  { text: 'Rivals show up 50% more often; Walk Away costs 10% health.' },
  { text: 'From floor 4, floor bosses fight with 2 Swarmlings.' },
  { text: 'Item picks lean half a floor behind (lower tiers).' },
  { text: 'Room enemies deal 5% more damage.' },
  { text: 'Every enemy hit cuts your healing 10% for 3 s.' },
  { text: '9 item slots; one more opens after the bosses of floors 2, 4 and 6.' },
  { text: 'Boss rooms give no level.' },
  { text: 'From floor 5, floor bosses get back up once at 30% health.' },
  { text: 'Affixed enemies have 10% more health and damage.' },
  { text: 'Bosses have 10% more health and damage.' },
  { text: 'Skip heals 15% instead of 25%; bosses heal you back to 80% instead of full.' },
  { text: 'Carry at most 1 Rejuv.' },
  { text: 'From floor 5, item picks show 2 items instead of 3.' },
  { text: 'Room enemies resist 5% more bullet and spirit damage.' },
  { text: `Enemies curse, control, debuff and heal 10% more often; their curses and stuns last ${ASC.longer} s longer.` },
  { text: `Twice the affixes, doubled up; rivals 1 level below you; silences and disarms last ${ASC.longer} s longer.` },
  { text: `Bosses control 10% more often, stun and curse ${ASC.longer} s longer; from floor 3 they get an affix.` },
  { text: 'Room 40 is the Base Guardian, the Shrine, the Patron and the Weakened Patron in one fight.' },
];
// The run's own numbers at its ascension (`d.ascension`, 0 for runs from before ascensions).
function rules(d) {
  const at = (n) => (d?.ascension ?? 0) >= n;
  const room = d?.room ?? 1;
  return {
    ascension: d?.ascension ?? 0,
    rest: REST,
    bossHeal: at(13) ? 0.8 : 1, // a won boss heals back up to this (his call, Oct 29)
    skipHeal: at(13) ? 0.15 : SKIP_HEAL, // A13 was "the breather heals 10%" until the breather went (Oct 29)
    startHealth: 1,
    maxItems: at(8) ? 9 + [10, 20, 30].filter((r) => room > r).length : MAX_ITEMS,
    maxRejuvs: at(14) ? 1 : MAX_REJUVS, // Oct 29, his call: 1 (it was 2 after the retune)
    enhanced: ENHANCED_CHANCE, enhancedStep: ENHANCED_STEP, bossBuffs: BOSS_BUFFS, healthScale: 1,
    little: LITTLE_BUFF_CHANCE, big: BIG_BUFF_CHANCE, skipBuffs: SKIP_BUFFS, rerolls: REROLLS_PER_FLOOR,
    slowFarm: at(5), shortStock: at(15) && room > 20, deniedSouls: at(9), bossRejuv: at(10) && room > 20, walkCost: at(3) ? ASC.walkCost : 0,
  };
}
// A16: room enemies resist more (Oct 29: on bosses too no hero cleared A16 in 56 runs); A7: every enemy cuts healing.
function warded(e, a, boss = false) {
  if (a >= 16 && !boss) { e.stats.bulletResist = resist(e.stats.bulletResist + ASC.wards); e.stats.spiritResist = resist(e.stats.spiritResist + ASC.wards); }
  if (a >= 7 && !(e.stats.antiHeal?.cut > ASC.healbane)) e.stats.antiHeal = { cut: ASC.healbane, seconds: 3 };
}
// Blasts, controls, debuffing attacks and specials come `ASC.faster` as far apart (A17 for room enemies, A19 for bosses).
function faster(e) {
  if (e.stats.blast) e.stats.blast = { ...e.stats.blast, every: e.stats.blast.every * ASC.faster };
  e.stats.controls = (e.stats.controls ?? []).map((c) => ({ ...c, every: c.every * ASC.faster }));
  e.stats.debuffs = (e.stats.debuffs ?? []).map((d) => ({ ...d, every: d.every * ASC.faster }));
  if (e.stats.special?.chance) e.stats.special = { ...e.stats.special, chance: Math.min(1, e.stats.special.chance / ASC.faster) };
}
// The hero's crowd control with one of `tags` lasts `ASC.longer` seconds more (his calls Oct 28: A17 room enemies' and A19 bosses' curses and stuns
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
// Oct 29 (his ask, twice: room fights too easy, then "make all enemies hit harder and more accurately"): dps 1 -> 1.3 (rooms and bosses), room enemies
// +10% damage a floor, and every Descend enemy's `accuracy` (engine.js: the share of hits a dodge or evasion would take that land anyway).
const TUNE = { health: 1, dps: 1.1, growth: 0.14, knee: 15, late: 0.066, roomFloor: 0.1, accuracy: 0.5 };
// `growth` a room up to room `knee`, then `late` a room: steep where a build's picks start to tell, gentler towards the bottom
const power = (room) => (1 + TUNE.growth) ** (Math.min(room, TUNE.knee) - 1) * (1 + TUNE.late) ** Math.max(0, room - TUNE.knee);
const floorOf = (room) => Math.ceil(room / ROOMS_PER_FLOOR);
const budgetOf = (room, a = 0) => Math.min(10, 5 + Math.floor(room / 4)) + (a >= 1 && room > 10 ? 1 : 0); // threat points a fight room spends on enemies

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
// A Medic Trooper drops a Medic Pack as it dies, like in the game (his ask, Oct 29). The game's heals over 2 s for a share of missing health plus a flat
// part (the sources disagree on the numbers); here it heals at once, so the last Medic of a room still heals. ponytail: 15% of missing + 5% of max
// health is my placeholder.
const MEDIC_PACK = { missing: 0.15, flat: 0.05 };
const MEDIC = { ...MEND, deathName: 'Medic Pack', onDeath(fight, medic, hero) { fight.heal(hero, (hero.stats.maxHealth - hero.health) * MEDIC_PACK.missing + hero.stats.maxHealth * MEDIC_PACK.flat, 'cast', 'Medic Pack'); } };
// Debuffing attacks (his ask, Oct 29: "attacks that apply debuffs, resist reduction, bullet slowing, DoT poison"; engine.js `debuffs`): every `every` s
// a hit worth `hit` s of its damage that, unless dodged, leaves `mods` on the hero for `duration` s (a `dot` share of its damage a second is poison).
// ponytail: every number is my placeholder; his to say when it is too much.
const DEBUFFS = {
  shred: { id: 'shred', name: 'Corroding Round', note: '-15% bullet and spirit resist', every: 7, hit: 1, duration: 10, mods: { bulletResist: -0.15, spiritResist: -0.15 } },
  pierce: { id: 'pierce', name: 'Piercing Round', note: '-20% bullet resist', every: 8, hit: 1.5, duration: 10, mods: { bulletResist: -0.2 } },
  hex: { id: 'hex', name: 'Weakening Hex', note: '-20% spirit resist', every: 9, hit: 1, type: 'spirit', duration: 10, mods: { spiritResist: -0.2 } },
  chill: { id: 'chill', name: 'Chilling Round', note: '25% slower and -20% fire rate', every: 7, hit: 1, duration: 8, mods: { slow: 0.25, fireRate: -0.2 } },
  cripple: { id: 'cripple', name: 'Crippling Blow', note: '20% slower and -15% fire rate', every: 9, hit: 1.5, type: 'melee', duration: 6, mods: { slow: 0.2, fireRate: -0.15 } },
  poison: { id: 'poison', name: 'Poison', note: 'poisoned', every: 8, hit: 0.5, type: 'spirit', duration: 8, dot: 0.6 },
  venom: { id: 'venom', name: 'Venom Bite', note: 'poisoned', every: 6, hit: 0.5, type: 'spirit', duration: 6, dot: 0.5 },
};
const ICONS = path.join(ASSETS, 'farm', 'icons');
// The archetypes a fight room's budget is spent on (room 1 numbers): cost in threat points, count per pick, picture (the trooper renders).
const ARCHETYPES = {
  tank: { name: 'Brute', plural: 'Brutes', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 900, dps: 10, distance: 8, bulletResist: 0.1 }, text: 'lots of health, little damage' },
  swarm: { name: 'Swarmling', plural: 'Swarmlings', cost: 2, count: 2, icon: 'trooper', stats: { maxHealth: 150, dps: 6, distance: 12, debuffs: [DEBUFFS.venom] }, text: 'small and many' },
  glass: { name: 'Sharpshooter', plural: 'Sharpshooters', cost: 3, icon: 'trooper', stats: { maxHealth: 260, dps: 24, distance: 30, debuffs: [DEBUFFS.pierce] }, text: 'hits hard from far away, little health' },
  healer: { name: 'Medic', plural: 'Medics', cost: 3, icon: 'trooper-medic', stats: { maxHealth: 350, dps: 5, distance: 18 }, special: MEND, text: 'heals the others' },
  bruiser: { name: 'Bruiser', plural: 'Bruisers', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 600, dps: 18, distance: 4, debuffs: [DEBUFFS.cripple] }, text: 'close in, hits hard' },
  caster: { name: 'Hexer', plural: 'Hexers', cost: 4, icon: 'trooper-medic', stats: { maxHealth: 400, dps: 10, distance: 18, damageType: 'spirit', blast: { every: 8, damage: 70, maxHealthPct: 0, curse: 1, type: 'spirit', tags: ['curse'] }, debuffs: [DEBUFFS.hex] }, text: 'spirit damage and a curse' },
  disruptor: { name: 'Disruptor', plural: 'Disruptors', cost: 4, icon: 'trooper-medic', stats: { maxHealth: 420, dps: 11, distance: 18, controls: [{ id: 'silence', every: 9, duration: 1.2, tags: ['silence'], verb: 'silenced' }] }, text: 'silences abilities' },
  grappler: { name: 'Grappler', plural: 'Grapplers', cost: 4, icon: 'trooper-melee', stats: { maxHealth: 550, dps: 14, distance: 5, controls: [{ id: 'grapple', every: 10, duration: 1, tags: ['stun', 'immobilize'], verb: 'grappled' }] }, text: 'grapples and interrupts' },
  // /farm's enemies (his ask, Oct 29): the lane troopers and the camp Haunts (about 150 health and 4-5 damage a threat point;
  // a Haunt's special is on top). Oct 29 (his ask): room fights made to hurt, the archetypes +60% damage too; his to say when it is too hard. A Haunt group rolls a family (its name, picture and in-game special, haunts.js);
  // small Haunts have no special, like in the game.
  trooper: { name: 'Trooper', plural: 'Troopers', cost: 2, icon: 'trooper', stats: { maxHealth: 300, dps: 8, distance: 15 }, text: 'a lane trooper with a gun' },
  meleeTrooper: { name: 'Melee Trooper', plural: 'Melee Troopers', cost: 2, icon: 'trooper-melee', stats: { maxHealth: 350, dps: 9, distance: 4, damageType: 'melee', debuffs: [DEBUFFS.cripple] }, text: 'charges in and swings' },
  medicTrooper: { name: 'Medic Trooper', plural: 'Medic Troopers', cost: 3, icon: 'trooper-medic', stats: { maxHealth: 400, dps: 4, distance: 18 }, special: MEDIC, text: 'heals the others; killing it drops a Medic Pack that heals you' },
  small: { name: 'Small Haunt', size: 'small', cost: 2, stats: { maxHealth: 300, dps: 10, distance: 10 }, text: 'a small camp Haunt, no special attack' },
  medium: { name: 'Medium Haunt', size: 'medium', cost: 3, stats: { maxHealth: 450, dps: 12, distance: 10 }, text: 'a camp Haunt' },
  large: { name: 'Large Haunt', size: 'large', cost: 4, stats: { maxHealth: 600, dps: 16, distance: 10 }, text: 'a big camp Haunt' },
};
for (const a of Object.values(ARCHETYPES)) if (a.icon) a.icon = path.join(ICONS, `${a.icon}.png`);
// What each floor's fight rooms are made of (his calls, Oct 29): 1 the lanes (troopers), 2 Tier 1 camps (small Haunts), 3 Tier 2 (medium and small),
// 4 Tier 3 (large and medium), 5 every camp and the troopers, 6 the base (the archetypes above), 7 the Shrines (the archetypes and the troopers), 8 everything.
const TROOPERS = ['trooper', 'meleeTrooper', 'medicTrooper'];
const CAMPS = ['small', 'medium', 'large'];
const BASE = ['tank', 'swarm', 'glass', 'healer', 'bruiser', 'caster', 'disruptor', 'grappler'];
const FLOOR_ENEMIES = [TROOPERS, ['small'], ['medium', 'small'], ['large', 'medium'], [...CAMPS, ...TROOPERS], BASE, [...BASE, ...TROOPERS], [...BASE, ...TROOPERS, ...CAMPS]];
const FLOOR_NAMES = ['The Lanes', 'Tier 1 Camps', 'Tier 2 Camps', 'Tier 3 Camps', 'The Camps', 'The Base', 'The Shrines', 'The Patron'];
const FAMILIES = Object.fromEntries(CAMPS.map((size) => [size, Object.keys(HAUNTS).filter((k) => HAUNTS[k][size])]));
// A group's name, plural, line and picture (a Haunt's come from its family: "Medium Past Due").
const sizeWord = (size) => size[0].toUpperCase() + size.slice(1);
const groupName = (g) => (g.family ? `${sizeWord(ARCHETYPES[g.type].size)} ${familyName(g.family)}` : ARCHETYPES[g.type].name);
const groupPlural = (g) => (g.family ? `${groupName(g)}s` : ARCHETYPES[g.type].plural);
const groupText = (g) => ARCHETYPES[g.type].text;
// A group's special attack, for the room screen (his ask, Oct 29: a debuffing attack is shown as the enemy's special attack): a Haunt's
// family special (medium and large), else the archetype's debuffing attack. "Piercing Round: -20% bullet resist for 10 s".
const debuffText = (d) => `${d.name}: ${d.dot ? 'poisons you' : d.note} for ${d.duration} s`;
const groupSpecial = (g) => (g.family ? (ARCHETYPES[g.type].size !== 'small' && SPECIALS[g.family] ? `${SPECIALS[g.family].name}: ${SPECIALS[g.family].text}` : null)
  : ARCHETYPES[g.type].stats.debuffs?.length ? ARCHETYPES[g.type].stats.debuffs.map(debuffText).join('; ') : null);
const groupPicture = (g) => (g.family ? hauntFile(g.family, ARCHETYPES[g.type].size) : ARCHETYPES[g.type].icon);
// Affixes (the Isaac "champion" idea): the four camp traits plus a few the engine already knows (regen, lifesteal, a heal cut, a curse, more health).
// ponytail: Berserk from the plan still needs engine work; left out until he wants it. Armor-breaking is Corroding (Oct 29).
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
  Disarming: { text: 'disarms: no shooting for a moment', apply(e) { e.stats.controls.push({ id: 'disarm', every: 10, duration: 1.5, tags: ['disarm'], verb: 'disarmed' }); } }, // his ask and numbers, Oct 28
  Corroding: { text: 'Corroding Round: -15% bullet and spirit resist for 10 s', apply(e) { e.stats.debuffs.push({ ...DEBUFFS.shred }); } },
  Chilling: { text: 'Chilling Round: slows you and your fire rate for 8 s', apply(e) { e.stats.debuffs.push({ ...DEBUFFS.chill }); } },
  Poisonous: { text: 'poisons you: damage over time for 8 s', apply(e) { e.stats.debuffs.push({ ...DEBUFFS.poison }); } },
  Shielded: { text: 'half again the health', apply(e) { e.stats.maxHealth *= 1.5; e.health = e.stats.maxHealth; } },
};
// An affixed enemy's name shows its affixes in brackets, bold where Discord renders it (his ask, Oct 28): "**[Armored]** Brute"; `plain` for titles and buttons.
const affixTag = (affix, plain = false) => (plain ? `[${affix}]` : `**[${affix}]**`);
const affixChance = (room, a = 0) => (a >= 1 ? Math.min(0.8, 2 * (0.15 + 0.03 * (room - AFFIX_FROM))) : Math.min(0.6, 0.15 + 0.03 * (room - AFFIX_FROM)));
const BOSS_AFFIXES = Object.keys(AFFIXES).filter((k) => k !== 'Shielded'); // A19: half again a boss's health would be too much on top

// The bosses (his plan: chosen at random from the real ones), their identity kept (resists, damage type, stomp / curse, sustain, picture) and
// their health and damage set by the depth.
const BOSS = { health: 1800, dps: 15, resist: 0.2 }; // resist: the average resist `health` is meant for
const EARLY_BOSS = 0.85; // floors 1-2's bosses' health (Oct 29: the floor 2 boss ended most runs of the weaker heroes, the Doorman, Sinclair, Abrams ...)
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
  const k = power(room) * (a >= 12 ? 1 + ASC.boss : 1);
  const hit = a >= 12 ? 1 + ASC.boss : 1;
  const tough = (1 - (e.stats.bulletResist + e.stats.spiritResist) / 2) / (1 - BOSS.resist); // the same health behind its resists for every boss
  const health = BOSS.health * TUNE.health * k * tough * (room <= 2 * ROOMS_PER_FLOOR ? EARLY_BOSS : 1);
  const dps = BOSS.dps * TUNE.dps * power(room) * hit * (e.stats.blast ? 1 - e.stats.blast.curse / e.stats.blast.every : 1); // a boss that curses (the Walker's stomp, the Shrine) hits softer
  const grew = dps / (e.stats.dps || dps); // the share of its own numbers it fights with here
  e.stats.healthRegen *= health / e.stats.maxHealth;
  e.stats.maxHealth = health;
  e.health = health;
  e.stats.dps = dps;
  e.stats.accuracy = TUNE.accuracy;
  e.stats.dpsMaxHealthPct = Math.min(0.05, e.stats.dpsMaxHealthPct * grew);
  if (e.stats.blast) e.stats.blast = { ...e.stats.blast, damage: e.stats.blast.damage * grew, maxHealthPct: Math.min(0.4, e.stats.blast.maxHealthPct * grew) };
  if (a >= 19) faster(e);
  if (affix) AFFIXES[affix].apply(e);
  warded(e, a, true);
  if (a >= 19) longer(e, CURSE_STUN); // after the affix, so a Stunning boss's stun lasts longer too
  return e;
}

// What room `room` of a run holds (from the seed and the ascension alone, so it can be shown before the fight):
//   { room, floor, ascension, kind: 'fight', groups: [{ type, affix, affix2? }] } | { kind: 'boss', boss, affix?, final?, first? } | { kind: 'rival', rival }
// (the rolls an ascension adds come after the others, so a room at ascension 0 is the same as before ascensions)
// Whether room `room` rolls a rival (the room's first roll, `rng` its dice when given), and whether it is one: never right after a rival room
// (his call, Oct 29: "hero fights should not be back to back"; the room then holds a fight instead).
const rivalRolled = (seed, room, ascension, rng = dice(seed, room, 'room')) => room >= RIVAL_FROM && room % ROOMS_PER_FLOOR !== 0 && room !== LAST_ROOM && rng() < RIVAL_CHANCE * (ascension >= 3 ? 1.5 : 1);
const rivalRoom = (seed, room, ascension) => room >= RIVAL_FROM && rivalRolled(seed, room, ascension) && !rivalRoom(seed, room - 1, ascension);
// The Broker's stall (his ask, Oct 30): a room with no fight that replaces one now and then, never beside a rival or another stall, and at most
// BROKER_MAX a run (his call: a stall gives no level and no pick, so a run must still be able to reach level 35 and a full build). It has its own dice,
// so a room that is not a stall is exactly what it was before. The stalls of a run, in order (from the seed and the ascension alone).
const stallRooms = (seed, ascension) => {
  const stalls = [];
  for (let room = BROKER_FROM; room < LAST_ROOM && stalls.length < BROKER_MAX; room++) {
    if (room % ROOMS_PER_FLOOR === 0 || dice(seed, room, 'broker')() >= BROKER_CHANCE) continue;
    if (rivalRoom(seed, room, ascension) || rivalRoom(seed, room - 1, ascension) || stalls.includes(room - 1)) continue;
    stalls.push(room);
  }
  return stalls;
};
function roomSpec(seed, room, hero, ascension = 0) {
  const rng = dice(seed, room, 'room');
  const base = { room, floor: floorOf(room), ascension };
  if (room === LAST_ROOM) return { ...base, kind: 'boss', boss: 'patron', final: true, ...(ascension >= 20 ? { siege: true } : {}) };
  if (room % ROOMS_PER_FLOOR === 0) {
    const boss = pick(FLOOR_BOSSES, rng);
    return { ...base, kind: 'boss', boss, ...(ascension >= 19 && room > 10 ? { affix: pick(BOSS_AFFIXES, rng) } : {}) };
  }
  const rivals = roster().filter((n) => n !== hero);
  if (rivalRolled(seed, room, ascension, rng) && !rivalRoom(seed, room - 1, ascension) && rivals.length) return { ...base, kind: 'rival', rival: pick(rivals, rng) };
  if (stallRooms(seed, ascension).includes(room)) return { ...base, kind: 'broker' };
  let budget = budgetOf(room, ascension);
  let units = 0;
  const groups = [];
  for (;;) {
    const can = FLOOR_ENEMIES[Math.min(FLOORS, floorOf(room)) - 1].filter((k) => ARCHETYPES[k].cost <= budget && units + (ARCHETYPES[k].count ?? 1) <= MAX_UNITS);
    if (!can.length) break;
    const type = pick(can, rng);
    budget -= ARCHETYPES[type].cost;
    units += ARCHETYPES[type].count ?? 1;
    const size = ARCHETYPES[type].size;
    groups.push({ type, ...(size ? { family: pick(FAMILIES[size], rng) } : {}), affix: room >= AFFIX_FROM && rng() < affixChance(room, ascension >= 18 ? 1 : 0) ? pick(Object.keys(AFFIXES), rng) : null });
  }
  if (ascension >= 18) for (const g of groups) if (g.affix) g.affix2 = pick(Object.keys(AFFIXES).filter((k) => k !== g.affix), rng);
  return { ...base, kind: 'fight', groups };
}
const specOf = (d, room = d.room) => roomSpec(d.seed, room, d.hero, d.ascension ?? 0);
const affixesOf = (g) => [g.affix, g.affix2].filter(Boolean);
// The bottom room's bosses, in order (A20 puts a floor boss first).
const finalKeys = (spec) => (spec.siege ? ['base-guardian', 'shrine', ...FINAL] : spec.first ? [spec.first, ...FINAL] : FINAL);

// The enemy units of a fight room.
const unitsOf = (spec) => spec.groups.flatMap((g) => {
  const a = ARCHETYPES[g.type];
  const asc = spec.ascension ?? 0;
  const affixes = affixesOf(g);
  const elite = affixes.length > 0;
  const k = power(spec.room);
  const champ = elite && asc >= 11 ? 1 + ASC.elite : 1;
  const health = k * (asc >= 2 ? 1 + ASC.room : 1) * champ;
  // room enemies hit harder each floor (Oct 29, his ask: "you can only die to bosses and never to troopers": a kitted hero healed through them)
  const hit = k * (1 + TUNE.roomFloor * (floorOf(spec.room) - 1)) * (asc >= 6 ? 1 + ASC.room : 1) * champ;
  return Array.from({ length: a.count ?? 1 }, () => {
    const s = a.stats;
    const e = enemy([...affixes.map((x) => affixTag(x)), groupName(g)].join(' '), { ...s, maxHealth: s.maxHealth * TUNE.health * health, dps: s.dps * TUNE.dps * hit, blast: s.blast && { ...s.blast, damage: s.blast.damage * TUNE.dps * hit } });
    if (a.special) e.stats.special = a.special;
    e.stats.accuracy = TUNE.accuracy;
    if (g.family) e.stats.special = specialFor(g.family, a.size === 'small'); // its family's special attack (medium and large only)
    for (const affix of affixes) AFFIXES[affix].apply(e);
    warded(e, asc);
    if (asc >= 17) faster(e);
    if (asc >= 17) longer(e, CURSE_STUN);
    if (asc >= 18) longer(e, SILENCE_DISARM);
    return e;
  });
});

// "2 Swarmlings, 1 Armored Brute, 1 Hexer": a room's enemies in a line (the telegraph before the fight).
function roomLine(spec) {
  if (spec.final) return finalKeys(spec).map((key) => `the ${BOSSES[key].name}`).join(', then ');
  if (spec.kind === 'boss') return `the ${bossName(spec)}${escorted(spec) ? ' and 2 Swarmlings' : ''}`;
  if (spec.kind === 'rival') return spec.rival;
  if (spec.kind === 'broker') return "the Broker's stall";
  const counts = new Map();
  for (const g of spec.groups) {
    const key = [...affixesOf(g), g.type, g.family].join(' ');
    const seen = counts.get(key) ?? { g, n: 0 };
    seen.n += ARCHETYPES[g.type].count ?? 1;
    counts.set(key, seen);
  }
  return [...counts.values()].map(({ g, n }) => [n, ...affixesOf(g).map((x) => affixTag(x)), n === 1 ? groupName(g) : groupPlural(g)].join(' ')).join(', ');
}
const bossName = (spec, plain = false) => [spec.affix && affixTag(spec.affix, plain), BOSSES[spec.boss].name].filter(Boolean).join(' ');
// The picture for a room (`stage`: the last room's second fight): the boss, its first enemy's (a trooper render or a Haunt), or (a rival) null: the views draw the rival's face.
const roomPicture = (spec, stage = 0) => (spec.final ? BOSSES[finalKeys(spec)[stage] ?? 'patron'].icon : spec.kind === 'boss' ? BOSSES[spec.boss].icon : spec.kind === 'fight' ? groupPicture(spec.groups[0]) : null);

// ---- the run's hero ----
// What the run's hero fights with (the same shape as play.js fightKit).
const runKit = (d) => ({
  healthScale: rules(d).healthScale, boons: d.level, unlocked: UNLOCKS(d.level), points: POINTS(d.level), tiers: d.tiers,
  items: [...SLOTS.flatMap((s) => d.items[s]), ...(d.legendary ? [d.legendary] : [])], enhanced: d.enhanced ?? [], corrupted: corruptedOf(d), buffs: d.buffs, bridge: d.bridge ?? [], imbues: d.imbues, kept: d.kept,
});
// The run's corrupted items: a list ({ name, drawback, amount }); a run saved while the Broker held one at a time has an object.
const corruptedOf = (d) => [].concat(d.corrupted ?? []);
const pointsLeft = (d) => POINTS(d.level) - pointsSpent(d.tiers);

// A rival rolls its kit around the hero's (encounter.js) but RIVAL.levels lower and with RIVAL.health of its health: a fair duel would end half the runs.
// Ascensions: 1 level closer from A18.
const RIVAL = { levels: 2, health: 0.7 };
const rivalLevels = (a) => (a >= 18 ? RIVAL.levels - 1 : RIVAL.levels);
const rivalHealth = () => RIVAL.health;
function rivalKitFor(spec, d, kit = runKit(d)) {
  const lower = rivalLevels(d.ascension ?? 0);
  return rivalKit({ ...kit, boons: Math.max(0, kit.boons - lower), points: POINTS(Math.max(0, d.level - lower)), unlocked: UNLOCKS(Math.max(0, d.level - lower)) }, dice(d.seed, spec.room, 'rival'), spec.rival);
}
function rivalFor(spec, d, kit) {
  const unit = buildHero(spec.rival, rivalKitFor(spec, d, kit));
  unit.stats.maxHealth *= rivalHealth(d.ascension ?? 0);
  unit.health = unit.stats.maxHealth;
  return unit;
}
// What room `spec` holds, for View Enemy Build: { units } (the enemies, as the fight will build them) or { rival, kit, health } (a rival hero's kit is rolled from the run's seed, so it is the one it fights with).
// A4: from floor 4 a floor boss (not the bottom) fights with 2 Swarmlings; A10: from floor 5 it gets back up once (fightRoom). Oct 29: both from
// floor 3, floor 3's boss ended nearly every run from A14 up.
const escorted = (spec) => !spec.legacy && !spec.final && (spec.ascension ?? 0) >= 4 && spec.room > 15;
const escort = (spec) => (escorted(spec) ? unitsOf({ room: spec.room, ascension: spec.ascension, groups: [{ type: 'swarm' }] }) : []);
const bossesOf = (spec) => (spec.final ? finalKeys(spec).map((key) => bossFor(key, spec.room, spec.ascension)) : [bossFor(spec.boss, spec.room, spec.ascension, spec.affix), ...escort(spec)]);
const enemiesOf = (d, spec) => (spec.kind === 'rival' ? { rival: spec.rival, kit: rivalKitFor(spec, d), health: rivalHealth(d.ascension ?? 0) }
  : { units: spec.kind === 'boss' ? bossesOf(spec) : unitsOf(spec) });

// Plays room `spec` with the run `d` (nothing saved). Returns play.js simulate's run, with `spec`.
function fightRoom(d, spec, rng = Math.random) {
  const kit = runKit(d);
  const enemies = spec.kind === 'boss' ? () => bossesOf(spec)
    : spec.kind === 'rival' ? () => [rivalFor(spec, d, kit)]
      : () => unitsOf(spec);
  const stages = spec.final ? finalKeys(spec).map((key) => ({ name: BOSSES[key].name, enemies: () => [bossFor(key, spec.room, spec.ascension)] })) // in one go, health carried
    : [{ name: `Room ${spec.room}`, enemies }, ...(spec.kind === 'boss' && rules(d).bossRejuv ? [{ name: 'Rejuv', enemies: () => { const e = bossFor(spec.boss, spec.room, spec.ascension, spec.affix); e.health = e.stats.maxHealth * ASC.bossRejuv; return [e]; } }] : [])];
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
  const row = (i) => TIER_WEIGHTS[Math.max(0, Math.min(TIER_WEIGHTS.length - 1, i))];
  const at = floorOf(room) - 1 + bonus;
  const weights = rules(d).slowFarm ? row(at).map((w, t) => (w + row(at - 1)[t]) / 2) : row(at); // A5: half this floor's odds, half the floor before's
  const top = weights.findLastIndex((w) => w > 0) + 1;
  const owned = SLOTS.flatMap((s) => d.items[s]);
  const { maxItems } = rules(d);
  const ok = (n) => canBuy(d.hero, n) && !NO_RUN_ITEMS.has(n) && !owned.includes(n) && !heldIn(n, d.items);
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

// The reward for room `spec` just cleared: a boss gives 1 of 3 permanent buffs (or on odd floors from 3, 1 of 3 legendaries), a beaten rival any
// one of its own items (`theirs`: the kit it fought with; his ask, Oct 29), anything else 3 items.
function rollOffer(d, spec, roll = 0, theirs = null) {
  if (spec.kind === 'rival' && theirs) {
    const owned = SLOTS.flatMap((s) => d.items[s]);
    const choices = [...new Set(theirs.items)].filter((n) => !NO_RUN_ITEMS.has(n) && !owned.includes(n) && !heldIn(n, d.items));
    if (choices.length) return { kind: 'items', rival: spec.rival, theirs, choices, enhanced: choices.filter((n) => theirs.enhanced?.includes(n)), room: spec.room, roll }; // its enhanced items stay enhanced // none it can take: the usual 3, a tier up
  }
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
  let { choices, bonuses } = itemOffer(d, rng, spec.kind === 'rival' ? 1 : 0, spec.room);
  if (rules(d).shortStock && choices.length > 2) { const out = Math.floor(rng() * choices.length); bonuses = Object.fromEntries(Object.entries(bonuses).filter(([i]) => +i !== out).map(([i, b]) => [+i > out ? +i - 1 : +i, b])); choices = choices.filter((_, i) => i !== out); }
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
  if (d.corrupted) d.corrupted = corruptedOf(d).filter((c) => c.name !== name); // an upgrade (or a swap) loses the corruption, like selling it on the farm
}
// Puts item `name` in the build: an upgrade of a held item replaces it in place; with 12 items anything else needs `replace` (lost, no sell-back).
// Returns { ok: true, used: [components replaced], replaced } or { error: 'full' | 'missing' }.
function addItem(d, name, replace = null, enhanced = false) {
  const card = itemByName(name);
  const { used } = priceFor(card, d.items);
  if (used.some((u) => d.enhanced?.includes(u))) enhanced = true; // an upgrade of an enhanced item stays enhanced (his call, Oct 28)
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
      if (!addItem(next, bonus).error) extra.bonus = bonus; // no room (an offer made before this rule): just the upgrade
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
  if (d.phase !== 'offer' || d.offer?.kind !== 'items' || d.offer.rival) return { error: 'none' }; // a rival's stash is what it carried
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
// After a won room: a level, the health it has left (plus the breather, 0 since Oct 29; a boss heals back up, full or 80% from A13), Rejuvs used (a boss gives one), kill stacks, and the offer.
function afterWin(d, run) {
  const { spec } = run;
  const r = rules(d);
  if (!(r.deniedSouls && spec.kind === 'boss')) d.level = Math.min(MAX_LEVEL, d.level + 1);
  d.health = Math.min(1, run.health + r.rest);
  if (spec.kind === 'boss') d.health = Math.max(d.health, r.bossHeal);
  d.rejuvs = Math.min(r.maxRejuvs, Math.max(0, d.rejuvs - run.rejuvsUsed) + (spec.kind === 'boss' ? 1 : 0));
  d.kept = { ...d.kept, ...run.kept, ...run.stacks }; // the items' kill stacks and the abilities' (his call, Oct 28: they last the run)
  if (spec.kind === 'boss') d.bridge = []; // the Bridge buffs helped against this floor's boss; they expire now
  if (spec.room % ROOMS_PER_FLOOR === 0) d.rerolls = r.rerolls;
  d.find = rollFind(d, spec);
  if (d.find?.kind === 'little') d.buffs[d.find.key] = (d.buffs[d.find.key] ?? 0) + 1;
  else if (d.find?.kind === 'big') (d.bridge ??= []).push(d.find.key);
  d.offer = spec.final ? null : rollOffer(d, spec, 0, run.theirs);
  d.room = spec.room + 1;
  d.phase = spec.final ? 'done' : 'offer'; // 'done': the last room is beaten (the run is then taken off the record)
}
function walkAway(d) { d.health = Math.max(0.05, d.health - rules(d).walkCost); d.room += 1; }
// The Broker's stall: the held items he can corrupt (tier 3 or 4 with a corrupted card; the legendary slot never), and corrupting one for BROKER_COST of
// max health (it must leave the hero standing). Returns { ok, name, drawback, amount, lost } or { error: 'none' | 'item' | 'health' }.
const corruptibles = (d) => SLOTS.flatMap((s) => d.items[s]).filter((n) => corruptible(itemByName(n)) && !corruptedOf(d).some((c) => c.name === n));
function corrupt(d, name) {
  if (d.phase !== 'ready' || specOf(d).kind !== 'broker') return { error: 'none' };
  if (!corruptibles(d).includes(name)) return { error: 'item' };
  if (d.health <= BROKER_COST) return { error: 'health' };
  const roll = rollDrawback(itemByName(name), dice(d.seed, d.room, 'broker-roll'));
  d.health -= BROKER_COST;
  d.corrupted = [...corruptedOf(d), { name, ...roll }];
  d.room += 1;
  return { ok: true, name, ...roll, lost: BROKER_COST };
}
function newRun(hero, seed, ascension = 0) {
  const r = rules({ ascension });
  return { v: VERSION, hero, seed, ascension, room: 1, level: 0, tiers: {}, items: { weapon: [], vitality: [], spirit: [] }, legendary: null, enhanced: [], enhancedChance: r.enhanced, rerolls: r.rerolls, buffs: {}, bridge: [], find: null, rejuvs: 0, health: r.startHealth, kept: {}, imbues: {}, offer: null, phase: 'ready' };
}

// Runs started before the Oct 29 ascensions and floors (no `v`) finish on the old rules (his call): descentLegacy.js is this file as it was then. Everything outside this file reaches a run through RUN, which sends an old run (and its rooms, `legacy` on the spec) there.
// ponytail: delete descentLegacy.js, `legacy` and RUN's wrappers once no saved run lacks `v`.
const VERSION = 2;
const legacy = (d) => !!d && !d.v;
let OLD;
const old = () => (OLD ??= require('./descentLegacy'));
const byRun = (name, fn) => (d, ...rest) => (legacy(d) ? old()[name](d, ...rest) : fn(d, ...rest));
const bySpec = (name, fn) => (spec, ...rest) => (spec?.legacy ? old()[name](spec, ...rest) : fn(spec, ...rest));
const RUN = {
  rules: byRun('rules', rules), runKit: byRun('runKit', runKit), fightRoom: byRun('fightRoom', fightRoom), itemOffer: byRun('itemOffer', itemOffer), rollOffer: byRun('rollOffer', rollOffer),
  rollFind: byRun('rollFind', rollFind), enemiesOf: byRun('enemiesOf', enemiesOf), addItem: byRun('addItem', addItem), takeChoice: byRun('takeChoice', takeChoice), takeBonus: byRun('takeBonus', takeBonus),
  skipChoice: byRun('skipChoice', skipChoice), rerollChoice: byRun('rerollChoice', rerollChoice), spendPoint: byRun('spendPoint', spendPoint), setImbue: byRun('setImbue', setImbue), afterWin: byRun('afterWin', afterWin),
  walkAway: (d) => (legacy(d) ? void (d.room += 1) : walkAway(d)), // the old rules: walking away was free
  pointsLeft: byRun('pointsLeft', pointsLeft),
  specOf: (d, room = d.room) => (legacy(d) ? { ...old().specOf(d, room), legacy: true } : specOf(d, room)),
  unitsOf: bySpec('unitsOf', unitsOf), roomLine: bySpec('roomLine', roomLine), roomPicture: bySpec('roomPicture', roomPicture), finalKeys: bySpec('finalKeys', finalKeys), bossName: bySpec('bossName', bossName),
};

// ---- the member's run (data/farm.json) ----
// The best so far (inside a record update): the member's (the highest ascension first, then rooms; his call Oct 26) and this hero's rooms.
function noteBest(r, d) {
  const rooms = d.room - 1;
  const ascension = d.ascension ?? 0;
  const best = r.bestDescent;
  if (rooms > 0 && (!best?.rooms || ascension > (best.ascension ?? 0) || (ascension === (best.ascension ?? 0) && rooms > best.rooms))) r.bestDescent = { rooms, hero: d.hero, ...(ascension ? { ascension } : {}) };
  r.descentBest = { ...r.descentBest, [d.hero]: Math.max(r.descentBest?.[d.hero] ?? 0, rooms) };
}

// The highest ascension the member may pick (per member, his call): one above the highest they cleared.
const ascensionOf = (r) => r?.descentAscension ?? 0;
// Starts a run with one of the member's unlocked heroes at an ascension they unlocked (fixed for the run, his call).
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
    if (RUN.specOf(d).kind === 'broker') return { error: 'broker' }; // a stall has no fight
    d.phase = 'fighting';
    d.fightingAt = now;
    return { d: structuredClone(d) };
  });
  if (claim.error) return claim;
  const spec = RUN.specOf(claim.d);
  let run;
  try {
    run = RUN.fightRoom(claim.d, spec, rng);
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
    RUN.afterWin(d, run);
    noteBest(r, d);
    run.best = r.bestDescent;
    run.next = structuredClone(d);
    if (d.room - 1 >= TOKEN_ROOM && !r.descentToken && tokenUseful(r)) { r.descentToken = true; r.tokens = (r.tokens ?? 0) + 1; run.token = true; }
    if (spec.final) { // the descent is cleared: the run ends here
      r.descentClears = (r.descentClears ?? 0) + 1;
      const a = d.ascension ?? 0;
      // each ascension (1-20) cleared for the first time is a Character Unlock Token, while a hero is left to unlock (his call, Oct 28)
      if (a >= 1 && a > (r.descentCleared ?? -1) && tokenUseful(r)) { r.tokens = (r.tokens ?? 0) + 1; run.ascensionToken = a; }
      r.descentCleared = Math.max(r.descentCleared ?? -1, a); // the highest ascension cleared
      const unlocked = a < MAX_ASCENSION && a + 1 > ascensionOf(r) ? a + 1 : null;
      if (unlocked) r.descentAscension = unlocked;
      run.complete = { ...run.next, clears: r.descentClears, ...(unlocked ? { unlocked } : {}), ...(run.ascensionToken ? { token: true } : {}) };
      delete r.descent;
    }
  });
  if (run.won) await track(userId, 'descend'); // quests
  return { run };
}

// Walk Away from a rival: past the room with nothing gained (from Ascension 3 it costs health). Returns { ok, lost (share of max health) } or { error: 'none' }.
const walkPast = (userId) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  const kind = d && d.phase === 'ready' ? RUN.specOf(d).kind : null;
  if (kind !== 'rival' && kind !== 'broker') return { error: 'none' };
  const before = d.health;
  if (kind === 'broker') d.room += 1; // leaving a stall is free
  else RUN.walkAway(d);
  noteBest(r, d);
  return { ok: true, lost: before - d.health, kind };
});
// Corrupts item `name` at the Broker's stall of room `room` (an old message's button can't corrupt a later stall).
const visitBroker = (userId, room, name) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.room !== room) return { error: 'none' };
  const result = corrupt(d, name);
  if (result.ok) noteBest(r, d);
  return result;
});
// Takes choice `index` of the offer made for room `room` (an old message's buttons can't take a later offer).
const choose = (userId, room, index, replace = null) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? RUN.takeChoice(r.descent, index, replace) : { error: 'none' }));
const skip = (userId, room) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? RUN.skipChoice(r.descent) : { error: 'none' }));
const reroll = (userId, room) => updateFarmUser(userId, (r) => (r.descent?.offer?.room === room ? RUN.rerollChoice(r.descent) : { error: 'none' }));
const spend = (userId, slot) => updateFarmUser(userId, (r) => (r.descent ? RUN.spendPoint(r.descent, slot) : { error: 'none' }));
const imbue = (userId, slot) => updateFarmUser(userId, (r) => (r.descent ? RUN.setImbue(r.descent, slot) : { error: 'none' }));
const takeBonusItem = (userId, replace) => updateFarmUser(userId, (r) => (r.descent ? RUN.takeBonus(r.descent, replace) : { error: 'none' }));
// Ends the run where it stands (his open question; my pick: a run waits as long as the member likes, and Abandon ends it). Returns the run or null.
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
  MAX_ASCENSION, ASC, ASCENSIONS, affixTag, ascensionOf,
  ROOMS_PER_FLOOR, FLOORS, LAST_ROOM, TOKEN_ROOM, SKIP_HEAL, SKIP_BUFFS, BOSS_BUFFS, LITTLE_BUFF_CHANCE, BIG_BUFF_CHANCE, REROLLS_PER_FLOOR, ENHANCED_CHANCE, ENHANCED_STEP, REST, MEDIC_PACK, DEBUFFS, TUNE, BOSS, RIVAL, ARCHETYPES, AFFIXES, BOSSES, TIER_WEIGHTS, NO_RUN_ITEMS, NO_RUN_LEGENDARIES,
  dice, power, floorOf, roomSpec, bossFor, newRun, legacy, escorted, FLOOR_ENEMIES, FLOOR_NAMES, FAMILIES, groupName, groupText, groupSpecial, groupPicture, ...RUN,
  BROKER_COST, BROKER_FROM, BROKER_MAX, corruptibles, corruptedOf, corrupt, visitBroker,
  startRun, getRun, fight, walkPast, choose, skip, reroll, spend, imbue, takeBonusItem, abandon, leaderboard,
};
