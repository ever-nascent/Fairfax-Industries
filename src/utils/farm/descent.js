// /descend: a roguelite mode for Hero Farming. One of the member's unlocked heroes goes down room after
// room from level 0 with no items. Every won room is a level (boons, ability points, abilities unlock at 0 / 2 / 4 / 7 as usual) and an offer of
// 3 items (vitality / weapon / spirit, like Street Brawl's pick), pick 1 or skip to heal. 12 item slots, upgrade paths kept: an offered upgrade of
// an item the hero holds replaces it in place. Every 5th room is a boss (one of the real ones, sized to the depth) that gives a bigger pick and a
// Rejuv; now and then a rival hero blocks the way and wants a duel. One death ends the run (unless a Rejuv). Score: rooms cleared.
// It ends: 8 floors, 40 rooms; the last is the Patron then the Weakened Patron in one fight, like the siege's end. Clearing it is
// "Descent Cleared" and a place on the leaderboard, nothing more.
// No souls: a run never touches a hero's own souls, items or level (it lives on the member: `descent` on the farm record, next to `bestWave`).
//   descent: { hero, seed, room (the next room to fight, from 1), level, tiers, items: { weapon | vitality | spirit: [names] }, legendary, corrupted (the Broker's one, Oct 30), buffs, bridge, find,
//     rejuvs, health (share of max), kept (kill stacks), imbues, offer: { kind: 'items' | 'buffs' | 'legendaries', choices, room } | null,
//     phase: 'ready' (the next room waits) | 'offer' (picking) | 'fighting' (Fight was pressed), fightingAt }
//   bestDescent: { rooms, hero } (the member's best run), descentBest: { <hero>: rooms }, descentToken: true once the token was paid,
//   descentClears: runs that beat the last room.
// Everything random about a room or an offer comes from `seed` + the room, so closing Discord can't reroll either.
// the enemy numbers (TUNE, BOSS), the archetypes and affixes, the tier weights and the rewards are placeholders tuned with
// `node tools/farm-sim.js descend`.
const path = require('node:path');
const { enemy } = require('./engine');
const { track } = require('../economy/quests');
const { TARGETS, SIEGE } = require('./targets');
const { buildHero, roster } = require('./hero');
const { RAT_NAMES, RONNIE } = require('./ratNames');
const { POOL, ITEM_POOL, canBuy, SLOTS, SLOT_OF, MAX_ITEMS, countItems, priceFor, heldIn, sameLine, LEGENDARY_NAMES, TIER_COSTS, MAX_TIER, MAX_LEVEL, UNLOCKS, POINTS, pointsSpent } = require('./levels');
const { itemByName, FRAGILE_BREAK } = require('./stats');
const { corruptible, rollDrawback } = require('./levels');
const { BUFFS, BRIDGE, rollAnyBuff } = require('./buffs');
const { IMBUES, NO_ULT_IMBUE } = require('./items');
const { rivalKit } = require('./encounter');
const { ASSETS } = require('../art');
const { getStore } = require('../../storage');
const descentLog = require('./descentLog');
const { simulate, updateFarmUser, getFarmUser, hasHero, tokenUseful, heroOf, noteRebirth, MAX_REJUVS, TRAITS, hauntFile, familyName } = require('./play');
const { rankOf, FIRST, BONUS: REBIRTH_BONUS } = require('./rebirth');
const { specialFor, SPECIALS } = require('./haunts');
const { HAUNTS } = require('./refresh');

const ROOMS_PER_FLOOR = 5; // 4 fights and a boss
const FLOORS = 8;
const LAST_ROOM = FLOORS * ROOMS_PER_FLOOR; // the Patron, then the Weakened Patron
const TOKEN_ROOM = 25; // the end of floor 5: a Character Unlock Token, once per member
const SKIP_HEAL = 0.25; // skipping a pick heals this share of max health
const SKIP_BUFFS = 3; // every skipped reward also grants three permanent buffs
const LEGEND_SKIP_BUFFS = 6; // a legendary pick follows a boss (already a full heal), so skipping it gives 6 buffs and no heal
const REST = 0; // the breather after a won room: 15% until Oct 29 ("unless you kill a medic, you dont get a passive heal"), 0 until Nov 2, 5% until Nov 5 (after a run died in room 39), 0 again Nov 5 (more difficulty); a Medic Trooper's pack, Skip, bosses and items heal on top
const BOSS_BUFFS = 3; // a boss's buff pick gives this many of that permanent buff
const LITTLE_BUFF_CHANCE = 0.10; // a won fight or rival may turn up one permanent stack
const BIG_BUFF_CHANCE = 0.05; // a Bridge buff for the rest of this floor
const REROLLS_PER_FLOOR = 3;
const ENHANCED_CHANCE = 0.10; // each displayed item; +3 points after a row with none, reset when one is picked
const ENHANCED_STEP = 0.03;
const RIVAL_FROM = 3; // rivals show up from this room (never on a boss room)
const RIVAL_CHANCE = 0.15;
const BROKER_FROM = 6; // the Broker's stall can replace a fight room from here (floor 2: tier 3 items start turning up)
const BROKER_CHANCE = 0.05; // (placeholder value)
const BROKER_MAX = 3; // stalls a run: 39 rooms before the Patron minus 3 still reaches level 35, and 29 pick rooms fill 12 items
// Event rooms ("more random events that are deadlock like, and give breathing room"; "Descend events"). Runs from
// VERSION 3 on. A floor holds at most one, from EVENT_FROM, never on a boss room, beside a rival or a stall. Passing one is +1 level (39 rooms
// minus up to 8 events and 3 stalls must still reach level 35), no item pick. every number here is (placeholder value)
const EVENT_FROM = 3;
const EVENT_CHANCE = Number(process.env.EVENT_CHANCE ?? 0.5); // a floor's chance of an event room (EVENT_CHANCE=0 in the sims: the runs without events, to compare)
const EVENT_KINDS = ['rest', 'breather', 'urn', 'wounded', 'dealer', 'patron', 'teleporter'];
// The second batch ("add everything we discussed"; in "Descend events"):
const URN_ROOMS = [2, 4]; // the Soul Urn is carried a random number of rooms in this range, then delivered
const URN_BUFFS = 4; // delivering it pays 4 permanent buffs (the game's 4 Golden Statue buffs, the wiki)
const ALLY_FIGHTS = [2, 4]; // a recruited wounded rival fights beside you a random number of fights in this range
const ALLY_HEALTH = 0.7; // its health, like a rival's
const BLESSING = 0.2; // the Patron's Favor, Weaken: both of the bottom's Patrons fight with this much less health and damage (a default, his "you choose")
// The Patron's Favor is a pick of four: 'heal' (full health now), 'bless' (weaken the bottom's Patrons), 'empower' (EMPOWER more
// health, weapon damage and spirit power for the rest of the run, as Rebirth ranks; my number) and 'ally' (a random hero fights beside you, like a recruit).
const PATRON_GIFTS = ['heal', 'bless', 'empower', 'ally'];
const EMPOWER = 0.1; // 0.2 until Nov 6 (too strong)
const TELEPORT_TO = ['broker', 'rest', 'breather', 'urn', 'wounded', 'dealer']; // the Teleporter only lands in no-fight rooms
// Hero rooms. From VERSION 4 a room that rolls a rival holds a hero who is, a third each, a rival
// to fight (as before), a wounded hero to assist (the Wounded room: recruit them as an ally; any hero), or a hero interaction (an offer);
// accepting or turning them down passes the room like an event (+1 level and a pick). Interactions are only his approved ones so far
// (`VISITS[hero]` = its deal, or a list of deals rolled evenly: McGinnis' upgrade or her Mini Turret).
const VISITS = { Violet: 'replica', Graves: 'ghouls', McGinnis: ['upgrade', 'turret'], Solomon: 'castling', Sinclair: 'assistant', Paige: 'plot', Victor: 'fuse', Paradox: 'capsule', Mirage: 'travel', Rem: 'helper', Dynamo: 'lesson', Ivy: 'rescue', Infernus: 'stoke', 'The Doorman': 'doorway', Billy: 'smash', 'Mo & Krill': 'burrow', 'Nurse Harrow': 'harrow', Vyper: 'venom', 'Rat King': 'rats' };
// Infernus' Stoke the Fire (my idea from Inscryption's campfire): hand him an Item; each Stoke tempers it (stats.js TEMPERED a Stoke),
// the first is safe, each one after burns the Item to ash at STOKE.burn (the Stoke about to be pressed). Take It Back keeps what it has. Placeholders.
const STOKE = { burn: [0, 0.25, 0.5, 0.75] };
const DEAL_SINCE = { Ivy: 6, Infernus: 8, 'The Doorman': 8, Billy: 9, 'Mo & Krill': 9, 'Nurse Harrow': 9, Vyper: 9, 'Rat King': 9 }; // the run VERSION a hero's deal came in: an older run's rooms stay as they were
// every number below is (placeholder value)
const REPLICA_CHANCE = [0.9, 0.7, 0.5, 0.3]; // Violet's copy, by the item's tier (the better the item, the lower the chance)
const UPGRADE_COST = 0.1; // McGinnis' upgrade costs this share of the current health, win or fail (placeholder)
const MCGINNIS_CHANCE = [0.8, 0.65, 0.5]; // McGinnis' upgrade of a Tier 1 / 2 / 3 item (a fail makes it Fragile)
const GHOUL_COST = 0.05; // each Ghoul Graves lends costs this share of the hero's current health; up to MINIONS.ghoul.count of them
// Paradox's Time Capsule (and calls, Nov 7): a held Item with a cooldown is sealed away and comes back at a random room before the floor ends, its
// cooldown CAPSULE.perRoom shorter for every room it was held (permanently, `itemCd`). A legendary shatters out and rerolls its cooldown altogether (x low..high).
const CAPSULE = { perRoom: 0.1, legendary: [0.5, 1.3] }; // placeholders
// Dynamo's Lesson (and calls, Nov 7): he coaches the hero on one kind of enemy of the NEXT floor and grades how well the hero has done so far (the health it
// has kept: `min` of the health share). The grade sets how much it helps, automatically, for that whole floor: damage taken from that kind cut and damage dealt to it
// raised by `power`. Placeholders.
const GRADES = [{ letter: 'A', min: 0.8, power: 0.35 }, { letter: 'B', min: 0.6, power: 0.28 }, { letter: 'C', min: 0.4, power: 0.2 }, { letter: 'D', min: 0.2, power: 0.12 }, { letter: 'F', min: 0, power: 0.06 }];
// Ivy's Air Drop (and calls, Nov 7): a promise held until a fight (not a boss, not the Patron) would kill the hero. She plucks it out and takes it RESCUE.back rooms back
// (never past the start of the floor), at RESCUE.health, to a Rest Stop. The rooms from there to the one that was lost are fought again, fresh enemies, with no Level and no pick
// (the room that was lost pays as usual). Once. Placeholders.
const RESCUE = { back: 3, health: 0.25 };
const ASSISTANT = { echo: 0.5, fights: 4 }; // Sinclair's Spectral Assistant: each landed shot is followed by one at half its damage, for 3 fights
// Minions that fight beside you, sized off a lane trooper of the room they fight in: Graves' Ghouls (up to 3, until they fall or this floor's boss is beaten), McGinnis'
// Mini Turret (1, for 3 fights), the Rift's Rift Troopers (5, for the rest of the floor, its boss included). One that falls is gone.
const MINIONS = {
  ghoul: { name: 'Ghoul', health: 0.8, dps: 1, damageType: 'melee', count: 3 }, // no `fights`: they stay until they fall or the floor's boss is beaten
  turret: { name: 'Mini Turret', health: 0.7, dps: 1.5, count: 1, tiers: [1, 1.6] }, // stays until it falls or the floor's boss is beaten; the Item given sets its strength (`tiers`: x health and damage by Tier 1 / 2; placeholder)
  rift: { name: 'Rift Trooper', health: 1, dps: 1, count: 5 },
  rat: { name: 'Rat', health: 0.25, dps: 0.3, count: 1 }, // the Rat King's: named rats, one more after each fight won with one standing, until the Floor's boss is beaten; `rats` on the entry holds each one's name
  helper: { name: 'Lil Helper', health: 0.4, dps: 0.5, count: 1 }, // Rem's: stays until it falls; the Items it is fed set its stats (HELPER)
};
// Rem's Lil Helper (and calls, Nov 7): feed it an Item to take it (the Item is gone), then any Item you are offered but not taking, on every pick screen.
// An Item's slot picks the stat (Weapon: its damage, Vitality: its health, Spirit: the resist it gives you) and its tier sets how much, perTier a tier (
// "each tier is 2%"). The aura is capped (a resist that never ends would make the run unloseable). Placeholders.
// No limit on feeding, and none on the resist ("we don't have a limit"): the resist compounds, so it keeps growing but a plain 100% is never reached.
// Nurse Harrow ("3 perma buffs per heal, you can hit it as long as you have buffs, and you can choose to leave at any time"): each heal costs `cost`
// Perma-Buff stacks (from the biggest pile) and restores `heal` of Max Health . Mo & Krill's Burrow needs BURROW_MIN rooms to dig past.
const HARROW = { heal: 0.3, cost: 3 };
const BURROW_MIN = 2;
const VENOM_ROOMS = 3; // Vyper's poisoned weapon: rooms it lasts; the poison itself is `VENOM` in engine.js
// The Rat King's rats: Rabies Ronnie is `ronnie` x a Rat's health and damage and his bites may give an enemy rabies (`infect` a bite; the engine's `rabid`: it fights
// the other enemies, for good, never a boss or a hero). A Rat's bite takes Bullet Resist off an enemy (`GNAW` in engine.js). Up to `cap` Rats. Placeholders but .
const RAT = { cap: 6, ronnie: 4, infect: 0.25 };
const HELPER = { perTier: 0.02, aura: 0.02 };
// The Rift: you and 1-6 rival heroes, everyone against everyone. Win it and 5 Rift Troopers fight with you for the rest of the floor.
// Lose it and your hero flees (never dies here) with the health it had left, at least `flee`, and gets nothing. Rift Troopers, the wiki
// (Unstable Rift / Trooper, Nov 6): larger, black, +100% health and damage over a normal trooper, +20% more for each Rift before it (at most +160%),
// 25% melee resist, 30% spirit resist (+5% a Rift, at most 45%). The rivals are rolled like a rival room's (a level or two lower, 70% health).
// With a Rejuv in hand the hero fights on below `flee` (it dies and gets back up instead). A rival may flee too:
// once at `rivalFlee.at` of its health it has one `chance` to run, and is out of the Rift (placeholders, to tune).
const RIFT = { heroes: [1, 6], flee: 0.1, seconds: 120, rivalFlee: { at: 0.3, chance: 0.4 }, bonus: 1, step: 0.2, cap: 1.6, melee: 0.25, spirit: 0.3, spiritStep: 0.05, spiritCap: 0.45 };
const REST_HEAL = 0.35; // the rest stop's Rest
const TINKER_CHANCE = 0.60; // the rest stop's Tinker enhancing the item ("more often than not"); a failed one does nothing and gives no heal
const BREATHER = { buff: 0.5, heal: 0.3 }; // what the crates and the Golden Statue give: a permanent buff, else a heal, else a bridge buff
const BREATHER_HEAL = 0.30;
const SLOT_ROOMS = [20, 30]; // Ascension 8+: 10 item slots, one more after each of these rooms
const BROKER_COST = 0.10; // corrupting costs a small share of max health, not souls
const AFFIX_FROM = 4; // enemies may roll an affix from this room, more often deeper
const MAX_AFFIXED = 2; // affixed groups a fight room holds at most, one more from A18 (Nov 2: from floor 5 a third of the rooms had 3-5)
const MAX_UNITS = 6; // enemies in one room (the live message has a field per enemy)
const UPGRADE_CHANCE = 0.35; // each pick slot offers an upgrade of a held item this often, when there is one
const STALE_MS = 60 * 1000; // a 'fighting' claim older than this (the bot stopped mid-fight) can be fought again

// Ascensions (20 levels, unlocked per member, picked on the start screen and fixed once the run starts). Each level keeps
// every level below it. Clearing the descent at level N unlocks N + 1 for all of the member's heroes.
// Redesigned Oct 29 ("focus more on our game and less so being a carbon copy of slay the spire's, and to actually increase difficulty"; his
// calls: no names, just "Ascension N"; A17-A19 kept). Runs started before that finish on the old rules (descentLegacy.js).
// "Elites" are affixed enemies; "room enemies" are a fight room's (not bosses or rivals).
// the sizes in ASC are placeholders (Oct 29: before room fights were made to hurt, 4 / 1 / 2 of 56 good-pick runs cleared A12 / A16 / A20;
// after, about half clear A0 and 4 / 28 A4); he says when it is too hard.
const MAX_ASCENSION = 20;
// Sim only: ASC_ONLY=n turns on rule n alone (tools/farm-sim.js --only=n), at any ascension >= n; unset, rules stack as usual.
const ONLY = Number(process.env.ASC_ONLY) || 0;
const on = (a, n) => (ONLY ? n === ONLY && a >= n : a >= n);
// Oct 29 retune ("adjust the ascensions appropriately"; good picks cleared nothing from A5 up): A3 rivals no longer a level closer, A5 half a
// floor behind instead of a whole one, A11 elites +10% instead of +20%, A14 1 Rejuv (after a day at 2), A15 from floor 5 instead of 3, A16 +5% resist
// instead of +10%, floor 1-2 bosses a little softer (EARLY_BOSS); then A1 +1 threat point instead of 2, A2 / A6
// +5% instead of +10%, A7 cuts healing 10% instead of 20%; then A17 / A19 10% more often (was 25%) and 0.5 s longer (was 1 s), A18 rivals 1 level
// below you (was your level).
// Nov 2 reshape ("balance the modes once and for all"; measured rule by rule, each from full health along the same runs: A1 +25% health lost,
// A9 +25%, A18 +21%, A11 +12%, while A3, A10, A19 and A20 cost 0-1%): A1 from floor 6 (was floor 3), A4 from floor 5 (was 4), A8 10 slots (was 9), A9
// only floors 5-7's bosses, A10 from floor 2 at 40% (was floor 5 at 30%), A11 +5% (was 10%), A13 90% / 20% (was 80% / 15%), A18 half again as many
// affixes (was twice) and the second affix from floor 6. Each level now adds a similar step.
// Nov 6: the Oct 29 redesign's numbers were put back ("re-add all of the ascension difficulties"), undone Nov 7 ("revert the ascension
// difficulties to as they were before"), and put back again Nov 13 ("re-add the difficulty that was removed before"; he picked the Nov 6 numbers):
// the retune and the Nov 2 reshape above are NOT in force. A10 stays tougher heroes, A14 1 Rejuv, at most 2 affixed groups a room (3 from A18).
// Nov 6: A10's boss revive ("floor bosses get back up once at 40% health") is gone; A10 was 1 Reroll a Floor for a few hours (too hard), now tougher heroes.
const ASC = { room: 0.05, elite: 0.05, boss: 0.05, wards: 0.02, healbane: 0.1, faster: 0.9, bossFaster: 0.95, siege: 0.45, longer: 0.4, walkCost: 0.1, heroHealth: 0.85 };
const ASCENSIONS = [
  null,
  { text: 'From Floor 6, fight rooms bring one more enemy.' },
  { text: `Room enemies have ${ASC.room * 100}% more health.` },
  { text: 'Rivals show up 50% more often; Walk Away costs 10% health.' },
  { text: 'From Floor 5, Floor bosses fight with 2 Swarmlings.' },
  { text: 'Item picks lean half a Floor behind (lower tiers).' },
  { text: `Room enemies deal ${ASC.room * 100}% more damage.` },
  { text: `Every enemy hit cuts your healing ${ASC.healbane * 100}% for 3 s.` },
  { text: '10 item slots; one more opens after the bosses of Floors 4 and 6.' },
  { text: 'The bosses of Floors 5, 6 and 7 give no level.' },
  { text: `Rival, Rift and recruited heroes are a level closer and have ${ASC.heroHealth * 100}% health, not ${ALLY_HEALTH * 100}%.` }, // (1 Reroll a Floor, which replaced the boss revive that day, hit too hard)
  { text: `Affixed enemies have ${ASC.elite * 100}% more health and damage.` },
  { text: `Bosses have ${ASC.boss * 100}% more health and damage.` },
  { text: 'Skip heals 20% instead of 25%; bosses heal you back to 90% instead of full.' },
  { text: 'Carry at most 2 Rejuvs.' },
  { text: 'You can only choose **2** Items rather than **3**.' },
  { text: `Room enemies resist ${ASC.wards * 100}% more bullet and spirit damage.` },
  { text: `Enemies curse, control, debuff and heal 10% more often; their curses and stuns last ${ASC.longer} s longer.` },
  { text: `More affixes, two on each from Floor 7; rivals a level closer; silences and disarms ${ASC.longer} s longer.` },
  { text: `Bosses use blasts, controls, debuffs and specials ${Math.round((1 - ASC.bossFaster) * 100)}% sooner; their stuns and curses ${ASC.longer} s longer.` },
  { text: 'Room 40 is the Base Guardian, the Shrine, the Patron and the Weakened Patron in one fight.' }, // the two openers fight with ASC.siege of their health
];
// The run's own numbers at its ascension (`d.ascension`, 0 for runs from before ascensions).
function rules(d) {
  const at = (n) => on(d?.ascension ?? 0, n);
  const room = d?.room ?? 1;
  return {
    ascension: d?.ascension ?? 0,
    rest: REST,
    bossHeal: at(13) ? 0.9 : 1, // a won boss heals back up to this
    skipHeal: at(13) ? 0.2 : SKIP_HEAL, // A13 was "the breather heals 10%" until the breather went
    startHealth: 1,
    maxItems: at(8) ? MAX_ITEMS - SLOT_ROOMS.filter((r) => room <= r).length : MAX_ITEMS,
    lockedSlots: at(8) ? SLOT_ROOMS.filter((r) => room <= r) : [], // the rooms after which the locked item slots open (the build card's locks)
    maxRejuvs: at(14) ? 2 : MAX_REJUVS, // 1 from Oct 29; 2 since Nov 14 (alone it took 14 points off the clear rate, the most of any level)
    enhanced: ENHANCED_CHANCE, enhancedStep: ENHANCED_STEP, bossBuffs: BOSS_BUFFS, healthScale: 1,
    little: LITTLE_BUFF_CHANCE, big: BIG_BUFF_CHANCE, skipBuffs: SKIP_BUFFS, rerolls: REROLLS_PER_FLOOR,
    slowFarm: at(5), shortStock: at(15), deniedSouls: at(9) && room > 20 && room < LAST_ROOM, walkCost: at(3) ? ASC.walkCost : 0,
  };
}
// A16: room enemies resist more (Oct 29: on bosses too no hero cleared A16 in 56 runs); A7: every enemy cuts healing.
function warded(e, a, boss = false) {
  if (on(a, 16) && !boss) { e.stats.bulletResist = resist(e.stats.bulletResist + ASC.wards); e.stats.spiritResist = resist(e.stats.spiritResist + ASC.wards); }
  if (on(a, 7) && !(e.stats.antiHeal?.cut > ASC.healbane)) e.stats.antiHeal = { cut: ASC.healbane, seconds: 3 };
}
// Blasts, controls, debuffing attacks and specials come `ASC.faster` as far apart (A17 for room enemies, A19 for bosses).
function faster(e, k = ASC.faster) {
  if (e.stats.blast) e.stats.blast = { ...e.stats.blast, every: e.stats.blast.every * k };
  e.stats.controls = (e.stats.controls ?? []).map((c) => ({ ...c, every: c.every * k }));
  e.stats.debuffs = (e.stats.debuffs ?? []).map((d) => ({ ...d, every: d.every * k }));
  if (e.stats.special?.chance) e.stats.special = { ...e.stats.special, chance: Math.min(1, e.stats.special.chance / k) };
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
// Oct 29 (twice: room fights too easy, then "make all enemies hit harder and more accurately"): dps 1 -> 1.3 (rooms and bosses), room enemies
// +10% damage a floor, and every Descend enemy's `accuracy` (engine.js: the share of hits a dodge or evasion would take that land anyway).
// What the hero can take off a Descend enemy's damage at most, slows and damage cuts together (engine.js attackRate / output; Nov 2): uncapped, the heroes
// and items that slow or weaken (Graves, Solomon, Lady Geist, Juggernaut, Suppressor...) left a boss 17-40% of its damage and carried every run.
const OUTPUT_FLOOR = 0.5;
const TUNE = { health: 1.0, dps: 1.0, // health 0.85 -> 1.0 again // 0.9 -> 1.0 (it felt too easy) // health 1 -> 0.85 and hpLate below: (enemy health cut, enemy damage kept) // enemy damage lower, twice (1.1 -> 1.0 -> 0.9; 10 good-pick Venator runs: A0 6 cleared, A10 2, A20 2)
 growth: 0.14, knee: 15, late: 0.05, hpLate: 0.05, roomFloor: 0.1, accuracy: 0.5 }; // late and hpLate 0.066 -> 0.05 (every hero above 45% at every ascension; Ascension 20 runs ended on Floors 7 and 8)
// `growth` a room up to room `knee`, then `late` a room: steep where a build's picks start to tell, gentler towards the bottom
// Nov 4 ("a bit too easy again"): the full `late` growth again on every room to the end; from Nov 2 rooms 36-40 grew half as fast.
const lateRooms = (room) => Math.max(0, room - TUNE.knee);
const power = (room) => (1 + TUNE.growth) ** (Math.min(room, TUNE.knee) - 1) * (1 + TUNE.late) ** lateRooms(room);
// Enemy health grows a little slower than enemy damage past the knee (`hpLate` instead of `late`; 6.6% -> 5.5% a room). back to 6.6% (same as damage).
const hpPower = (room) => (1 + TUNE.growth) ** (Math.min(room, TUNE.knee) - 1) * (1 + TUNE.hpLate) ** lateRooms(room);
const floorOf = (room) => Math.ceil(room / ROOMS_PER_FLOOR);
const budgetOf = (room, a = 0) => Math.min(10, 5 + Math.floor(room / 4)) + (on(a, 1) && room > 25 ? 1 : 0); // threat points a fight room spends on enemies

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
// A Medic Trooper drops a Medic Pack as it dies, like in the game. The game's heals over 2 s for a share of missing health plus a flat
// part (the sources disagree on the numbers); here it heals at once, so the last Medic of a room still heals. 15% of missing + 5% of max
// health is a placeholder.
const MEDIC_PACK = { missing: 0.15, flat: 0.05 };
const MEDIC = { ...MEND, deathName: 'Medic Pack', onDeath(fight, medic, hero) { fight.heal(hero, (hero.stats.maxHealth - hero.health) * MEDIC_PACK.missing + hero.stats.maxHealth * MEDIC_PACK.flat, 'cast', 'Medic Pack'); } };
// Debuffing attacks ("attacks that apply debuffs, resist reduction, bullet slowing, DoT poison"; engine.js `debuffs`): every `every` s
// a hit worth `hit` s of its damage that, unless dodged, leaves `mods` on the hero for `duration` s (a `dot` share of its damage a second is poison).
// every number is a placeholder; tune if it proves too much.
const DEBUFFS = {
  shred: { id: 'shred', name: 'Eroding Round', note: '-10% bullet and spirit resist', every: 7, hit: 1, duration: 10, mods: { bulletResist: -0.1, spiritResist: -0.1 } },
  pierce: { id: 'pierce', name: 'Piercing Round', note: '-20% bullet resist', every: 8, hit: 1.5, duration: 10, mods: { bulletResist: -0.2 } },
  hex: { id: 'hex', name: 'Weakening Hex', note: '-20% spirit resist', every: 9, hit: 1, type: 'spirit', duration: 10, mods: { spiritResist: -0.2 } },
  chill: { id: 'chill', name: 'Slowing Round', note: '25% slower and -20% fire rate', every: 7, hit: 1, duration: 8, mods: { slow: 0.25, fireRate: -0.2 } },
  cripple: { id: 'cripple', name: 'Crippling Blow', note: '20% slower and -15% fire rate', every: 9, hit: 1.5, type: 'melee', duration: 6, mods: { slow: 0.2, fireRate: -0.15 } },
  poison: { id: 'poison', name: 'Poison', note: 'poisoned', every: 8, hit: 0.5, type: 'spirit', duration: 8, dot: 0.25 }, // dot 0.6 -> 0.25 (Nov 2: always running, it was +66% damage)
  burn: { id: 'burn', name: 'Flame Round', note: 'burning', verb: 'sets you on fire', every: 8, hit: 0.5, type: 'spirit', duration: 6, dot: 0.2 }, // 0.5 -> 0.2
  venom: { id: 'venom', name: 'Venom Bite', note: 'poisoned', every: 6, hit: 0.5, type: 'spirit', duration: 6, dot: 0.2 }, // 0.5 -> 0.2
};
const ICONS = path.join(ASSETS, 'farm', 'icons');
// The archetypes a fight room's budget is spent on (room 1 numbers): cost in threat points, count per pick, picture (the trooper renders).
// Costs re-set from measured threat (Nov 2; health each takes off 4 heroes per point, rooms 10-30): Sharpshooter 3 -> 5, Bruiser 3 -> 4, Hexer 4 -> 5,
// Large Haunt 4 -> 5, Melee Trooper 2 -> 3 (they took 1.3-2x the average), Brute 3 -> 2, Medic 3 -> 2, Medic Trooper 3 -> 2, Disruptor 4 -> 2,
// Grappler 4 -> 3 (0-0.7x). 2 is the least, so a room never fills up on a free enemy.
const ARCHETYPES = {
  tank: { name: 'Brute', plural: 'Brutes', cost: 2, icon: 'trooper-melee', stats: { maxHealth: 900, dps: 10, distance: 8, bulletResist: 0.1 }, text: 'lots of health, little damage' },
  swarm: { name: 'Swarmling', plural: 'Swarmlings', cost: 2, count: 2, icon: 'trooper', stats: { maxHealth: 150, dps: 6, distance: 12, debuffs: [DEBUFFS.venom] }, text: 'small and many' },
  glass: { name: 'Sharpshooter', plural: 'Sharpshooters', cost: 5, icon: 'trooper', stats: { maxHealth: 260, dps: 24, distance: 30, debuffs: [DEBUFFS.pierce] }, text: 'hits hard from far away, little health' },
  healer: { name: 'Medic', plural: 'Medics', cost: 2, icon: 'trooper-medic', stats: { maxHealth: 350, dps: 5, distance: 18 }, special: MEND, text: 'heals the others' },
  bruiser: { name: 'Bruiser', plural: 'Bruisers', cost: 4, icon: 'trooper-melee', stats: { maxHealth: 600, dps: 18, distance: 4, debuffs: [DEBUFFS.cripple] }, text: 'close in, hits hard' },
  caster: { name: 'Hexer', plural: 'Hexers', cost: 5, icon: 'trooper-medic', stats: { maxHealth: 400, dps: 10, distance: 18, damageType: 'spirit', blast: { every: 8, damage: 70, maxHealthPct: 0, curse: 1, type: 'spirit', tags: ['curse'] }, debuffs: [DEBUFFS.hex] }, text: 'spirit damage and a curse' },
  disruptor: { name: 'Disruptor', plural: 'Disruptors', cost: 2, icon: 'trooper-medic', stats: { maxHealth: 420, dps: 11, distance: 18, controls: [{ id: 'silence', every: 9, duration: 1.2, tags: ['silence'], verb: 'silenced' }] }, text: 'silences abilities' },
  grappler: { name: 'Grappler', plural: 'Grapplers', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 550, dps: 14, distance: 5, controls: [{ id: 'grapple', every: 10, duration: 1, tags: ['stun', 'immobilize'], verb: 'grappled' }] }, text: 'grapples and interrupts' },
  // /farm's enemies: the lane troopers and the camp Haunts (about 150 health and 4-5 damage a threat point;
  // a Haunt's special is on top). Oct 29: room fights made to hurt, the archetypes +60% damage too. A Haunt group rolls a family (its name, picture and in-game special, haunts.js);
  // small Haunts have no special, like in the game.
  trooper: { name: 'Ranged Trooper', plural: 'Ranged Troopers', cost: 2, icon: 'trooper', stats: { maxHealth: 300, dps: 8, distance: 15 }, text: 'a lane trooper with a gun' },
  meleeTrooper: { name: 'Melee Trooper', plural: 'Melee Troopers', cost: 3, icon: 'trooper-melee', stats: { maxHealth: 350, dps: 9, distance: 4, damageType: 'melee', debuffs: [DEBUFFS.cripple] }, text: 'charges in and swings' },
  medicTrooper: { name: 'Medic Trooper', plural: 'Medic Troopers', cost: 2, icon: 'trooper-medic', stats: { maxHealth: 400, dps: 4, distance: 18 }, special: MEDIC, text: 'heals the others; killing it drops a Medic Pack that heals you' },
  small: { name: 'Small Haunt', size: 'small', cost: 2, stats: { maxHealth: 300, dps: 10, distance: 10 }, text: 'a small camp Haunt, no special attack' },
  medium: { name: 'Medium Haunt', size: 'medium', cost: 3, stats: { maxHealth: 450, dps: 12, distance: 10 }, text: 'a camp Haunt' },
  large: { name: 'Large Haunt', size: 'large', cost: 5, stats: { maxHealth: 600, dps: 16, distance: 10 }, text: 'a big camp Haunt' },
};
for (const a of Object.values(ARCHETYPES)) if (a.icon) a.icon = path.join(ICONS, `${a.icon}.png`);
// What each floor's fight rooms are made of: 1 the lanes (troopers), 2 Tier 1 camps (small Haunts), 3 Tier 2 (medium and small),
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
// A group's special attack, for the room screen (a debuffing attack is shown as the enemy's special attack): a Haunt's
// family special (medium and large), else the archetype's debuffing attack. "Piercing Round: -20% bullet resist for 10 s".
const debuffText = (d) => `${d.name}: ${d.dot || d.dotMax ? d.verb ?? 'poisons you' : d.note} for ${d.duration} s`;
const groupSpecial = (g) => (g.family ? (ARCHETYPES[g.type].size !== 'small' && SPECIALS[g.family] ? `${SPECIALS[g.family].name}: ${SPECIALS[g.family].text}` : null)
  : ARCHETYPES[g.type].stats.debuffs?.length ? ARCHETYPES[g.type].stats.debuffs.map(debuffText).join('; ') : null);
// The Hidden King's troopers (Nov 4: his own picture, cut out): a run that fights him (`side` on the room, VERSION 3) meets his amber troopers; the
// renders the archetypes carry are the Archmother's blue ones.
const AMBER = { trooper: 'trooper-amber', 'trooper-melee': 'trooper-amber-melee', 'trooper-medic': 'trooper-amber-medic' };
const sided = (file, side) => {
  const key = path.basename(file, '.png');
  return side === 'hidden-king' && AMBER[key] ? path.join(ICONS, `${AMBER[key]}.png`) : file;
};
const groupPicture = (g, side = null) => (g.family ? hauntFile(g.family, ARCHETYPES[g.type].size) : sided(ARCHETYPES[g.type].icon, side));
// Affixes (the Isaac "champion" idea): the four camp traits plus a few the engine already knows (regen, lifesteal, a heal cut, a curse, more health).
// Berserk from the plan still needs engine work; left out until needed. Armor-breaking is Eroding.
const resist = (x) => Math.max(0, Math.min(0.9, x));
// The camp traits are named for Descend here; /farm keeps its own names (TRAITS in play.js).
const TRAIT_NAMES = { Armored: 'Plated', Warded: 'Hexproof', Ironclad: 'Stalwart', Brittle: 'Brittle' };
const AFFIXES = {
  ...Object.fromEntries(TRAITS.filter((t) => t.name).map((t) => [TRAIT_NAMES[t.name], { text: t.bullet > 0 && t.spirit > 0 ? 'resists everything' : t.bullet > 0 ? 'resists bullets' : t.spirit > 0 ? 'resists spirit' : 'takes more of everything',
    apply(e) { e.stats.bulletResist = resist(e.stats.bulletResist + t.bullet); e.stats.spiritResist = resist(e.stats.spiritResist + t.spirit); } }])),
  Restorative: { text: 'heals itself', apply(e) { e.stats.healthRegen += e.stats.maxHealth * 0.015; } },
  Vampiric: { text: 'heals from its hits', apply(e) { e.stats.drain = 0.2; } },
  Blighting: { text: 'its hits cut healing', apply(e) { e.stats.antiHeal = { cut: 0.25, seconds: 3 }; } },
  Cursing: { text: 'curses now and then', apply(e) { e.stats.blast ??= { every: 9, damage: e.stats.dps * 2, maxHealthPct: 0, curse: 1, type: 'spirit', tags: ['curse'] }; } },
  Stunning: { text: 'stuns now and then', apply(e) { e.stats.controls.push({ id: 'stun', every: 10, duration: 0.8, tags: ['stun'], verb: 'stunned' }); } },
  Silencing: { text: 'silences abilities', apply(e) { e.stats.controls.push({ id: 'silence', every: 10, duration: 2.5, tags: ['silence'], verb: 'silenced' }); } }, // 1 s -> 2.5 s (Nov 2: 1 s cost no hero anything)
  Seizing: { text: 'seizes and interrupts', apply(e) { e.stats.controls.push({ id: 'grapple', every: 11, duration: 1, tags: ['stun', 'immobilize'], verb: 'seized' }); } },
  Disarming: { text: 'disarms: no shooting for a moment', apply(e) { e.stats.controls.push({ id: 'disarm', every: 10, duration: 1.5, tags: ['disarm'], verb: 'disarmed' }); } }, // and numbers, Oct 28
  Lulling: { text: 'lulls you to sleep; damage wakes you', apply(e) { e.stats.controls.push({ id: 'sleep', every: 14, duration: 1.5, tags: ['sleep'], wake: 0.2, verb: 'put to sleep' }); } },
  Eroding: { text: 'Eroding Round: -10% bullet and spirit resist for 10 s', apply(e) { e.stats.debuffs.push({ ...DEBUFFS.shred }); } },
  Slowing: { text: 'Slowing Round: slows you and your fire rate for 8 s', apply(e) { e.stats.debuffs.push({ ...DEBUFFS.chill }); } },
  Poisonous: { text: 'poisons you: damage over time for 8 s', apply(e) { e.stats.debuffs.push({ ...DEBUFFS.poison }); } },
  Enflamed: { text: 'Flame Round: sets you on fire for 6 s', apply(e) { e.stats.debuffs.push({ ...DEBUFFS.burn }); } },
  Bulwarked: { text: 'a quarter more health', apply(e) { e.stats.maxHealth *= 1.25; e.health = e.stats.maxHealth; } },
  Undying: { text: 'cheats death once and gets back up with 30% health', apply(e) { e.stats.undying = 0.3; } },
  Adaptive: { text: 'adapts to the damage it takes: slowly gains resist, parries, or hits harder', apply(e) { e.stats.adaptive = true; } },
};
// An affixed enemy's name shows its affixes in brackets, bold where Discord renders it: "**[Plated]** Brute"; `plain` for titles and buttons.
const affixTag = (affix, plain = false) => (plain ? `[${affix}]` : `**[${affix}]**`);
const affixChance = (room, a = 0) => (a >= 1 ? Math.min(0.8, 1.25 * (0.15 + 0.03 * (room - AFFIX_FROM))) : Math.min(0.6, 0.15 + 0.03 * (room - AFFIX_FROM)));

// The bosses (his plan: chosen at random from the real ones), their identity kept (resists, damage type, stomp / curse, sustain, picture) and
// their health and damage set by the depth.
const BOSS = { health: 1800, dps: 15, resist: 0.2 }; // resist: the average resist `health` is meant for
const EARLY_BOSS = 1.0; // 0.85 -> 1.0 (no softer early bosses); floors 1-2's bosses' health (Oct 29: the floor 2 boss ended most runs of the weaker heroes, the Doorman, Sinclair, Abrams...)
const BOSSES = {
  guardian: { name: 'Guardian', icon: TARGETS.guardian.icon, make: () => TARGETS.guardian.enemies()[0] },
  walker: { name: 'Walker', icon: TARGETS.walker.icon, make: () => TARGETS.walker.enemies()[0] },
  'mid-boss': { name: 'Mid-Boss', icon: TARGETS['mid-boss'].icon, make: () => TARGETS['mid-boss'].enemies()[0] },
  'base-guardian': { name: 'Base Guardian', icon: SIEGE.stages[0].icon, make: () => SIEGE.stages[0].enemies()[0] },
  shrine: { name: 'Shrine', icon: SIEGE.stages[1].icon, make: () => SIEGE.stages[1].enemies()[0] },
  patron: { name: 'Patron', icon: SIEGE.stages[3].icon, make: () => SIEGE.stages[3].enemies()[0] },
  'weakened-patron': { name: 'Weakened Patron', icon: SIEGE.stages[4].icon, make: () => SIEGE.stages[4].enemies()[0] },
  // From VERSION 3 the bottom's Patron is one of the two, rolled for each run: the same fight as the Patron, its own name and picture.
  // Pictures with no background: the Archmother keeps his Oct 3 pictures; the wiki has none for the Hidden King's weakened form, so his icon.
  archmother: { name: 'Archmother', icon: SIEGE.stages[3].icon, make: () => SIEGE.stages[3].enemies()[0] },
  'archmother-weak': { name: 'Weakened Archmother', icon: SIEGE.stages[4].icon, make: () => SIEGE.stages[4].enemies()[0] },
  'hidden-king': { name: 'Hidden King', icon: path.join(ICONS, 'hidden-king.png'), make: () => SIEGE.stages[3].enemies()[0] },
  'hidden-king-weak': { name: 'Weakened Hidden King', icon: path.join(ICONS, 'hidden-king-weak.png'), make: () => SIEGE.stages[4].enemies()[0] },
};
const PATRONS = ['archmother', 'hidden-king'];
const PATRON_KEYS = new Set(['patron', 'weakened-patron', 'archmother', 'archmother-weak', 'hidden-king', 'hidden-king-weak']);
const FLOOR_BOSSES = ['guardian', 'walker', 'mid-boss', 'base-guardian', 'shrine']; // the Patron waits at the bottom (LAST_ROOM)
const FINAL = ['patron', 'weakened-patron'];
// The Patrons' troopers come sooner here: his room 40 fights took 15-55 s for both forms, so the siege's first wave at 15 s would often never come.
// placeholders, to tune.
// ("fewer waves"): every 15 s instead of 10. Good-pick runs, 10 each: Paradox A0 2 -> 6 cleared (20 s also 6), Haze A0 6 -> 8; Paradox
// A12 unchanged (those runs end on floor 7).
const PATRON_WAVES = { first: 3, every: Number(process.env.PATRON_EVERY ?? 15) }; // PATRON_EVERY=n in the sims: another wave timing, to compare
function bossFor(key, room, a = 0, affix = null) {
  const e = BOSSES[key].make();
  if (e.stats.summon) e.stats.summon = { ...e.stats.summon, ...PATRON_WAVES };
  e.name = affix ? `${affixTag(affix)} ${BOSSES[key].name}` : BOSSES[key].name;
  const k = hpPower(room) * (on(a, 12) ? 1 + ASC.boss : 1);
  const hit = on(a, 12) ? 1 + ASC.boss : 1;
  const tough = (1 - (e.stats.bulletResist + e.stats.spiritResist) / 2) / (1 - BOSS.resist); // the same health behind its resists for every boss
  const health = BOSS.health * TUNE.health * k * tough * (room <= 2 * ROOMS_PER_FLOOR ? EARLY_BOSS : 1);
  const dps = BOSS.dps * TUNE.dps * power(room) * (1 + TUNE.roomFloor * (floorOf(room) - 1)) * hit * (e.stats.blast ? 1 - e.stats.blast.curse / e.stats.blast.every : 1); // a boss that curses (the Walker's stomp, the Shrine) hits softer; +10% a floor like the room enemies (Nov 2: bosses had fallen behind them, a floor 5-7 boss cost 0-5% health)
  const grew = dps / (e.stats.dps || dps); // the share of its own numbers it fights with here
  e.stats.healthRegen *= health / e.stats.maxHealth;
  e.stats.maxHealth = health;
  e.health = health;
  e.stats.dps = dps;
  e.stats.accuracy = TUNE.accuracy;
  e.stats.outputFloor = OUTPUT_FLOOR;
  // a share of the hero's max health already grows with the hero: it grows with the depth only up to the boss's own share (Nov 2: deep down it was
  // grown twice, the Walker's stomp 33% of max health at room 40 against the wiki's 15%, and the Walker, the Shrine and the Patron ended most deep runs)
  const pctGrew = Math.min(1, grew);
  e.stats.dpsMaxHealthPct = Math.min(0.05, e.stats.dpsMaxHealthPct * pctGrew);
  if (e.stats.blast) e.stats.blast = { ...e.stats.blast, damage: e.stats.blast.damage * grew, maxHealthPct: Math.min(0.4, e.stats.blast.maxHealthPct * pctGrew) };
  if (on(a, 19)) faster(e, ASC.bossFaster);
  if (affix) AFFIXES[affix].apply(e);
  warded(e, a, true);
  if (on(a, 19)) longer(e, CURSE_STUN); // after the affix, so a Stunning boss's stun lasts longer too
  return e;
}

// What room `room` of a run holds (from the seed and the ascension alone, so it can be shown before the fight):
//   { room, floor, ascension, kind: 'fight', groups: [{ type, affix, affix2? }] } | { kind: 'boss', boss, affix?, final?, first? } | { kind: 'rival', rival }
// (the rolls an ascension adds come after the others, so a room at ascension 0 is the same as before ascensions)
// Whether room `room` rolls a rival (the room's first roll, `rng` its dice when given), and whether it is one: never right after a rival room
// ("hero fights should not be back to back"; the room then holds a fight instead).
const rivalRolled = (seed, room, ascension, rng = dice(seed, room, 'room')) => room >= RIVAL_FROM && room % ROOMS_PER_FLOOR !== 0 && room !== LAST_ROOM && rng() < RIVAL_CHANCE * (on(ascension, 3) ? 1.5 : 1);
const rivalRoom = (seed, room, ascension) => room >= RIVAL_FROM && rivalRolled(seed, room, ascension) && !rivalRoom(seed, room - 1, ascension);
// The Broker's stall: a room with no fight that replaces one now and then, never beside a rival or another stall, and at most
// BROKER_MAX a run (a stall gives no level and no pick, so a run must still be able to reach level 35 and a full build). It has its own dice,
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
// The event rooms of a run (VERSION 3 on): { room: kind }. Their own dice, after the rivals and stalls, so no other room changes. The Rift joins them from VERSION 4.
// Where a run's event rooms are, and each one's kind roll: { room: u } with u in [0, 1).
function eventSlots(seed, ascension) {
  const out = {};
  const stalls = stallRooms(seed, ascension);
  const busy = (room) => rivalRoom(seed, room, ascension) || stalls.includes(room);
  for (let floor = 1; floor <= FLOORS; floor++) {
    const rng = dice(seed, floor, 'event');
    if (rng() >= EVENT_CHANCE) continue;
    const first = (floor - 1) * ROOMS_PER_FLOOR + 1;
    const rooms = [0, 1, 2, 3].map((i) => first + i).filter((room) => room >= EVENT_FROM && room < LAST_ROOM && !busy(room) && !busy(room - 1) && !busy(room + 1));
    if (!rooms.length) continue;
    out[pick(rooms, rng)] = rng();
  }
  return out;
}
const eventRooms = (seed, ascension, v = VERSION) => {
  if (v >= 5) return specials(seed, ascension, v).events;
  const kinds = v >= 4 ? [...EVENT_KINDS, 'rift'] : EVENT_KINDS;
  const out = {};
  for (const [room, u] of Object.entries(eventSlots(seed, ascension))) {
    const kind = kinds[Math.floor(u * kinds.length)];
    out[room] = kind === 'patron' && Object.values(out).includes('patron') ? 'rest' : kind; // one Patron's Favor a run
  }
  return out;
};
// The repeat rule (VERSION 5): the run's special rooms (hero rooms' three outcomes, the Broker's stalls, event rooms) in order, each
// one's kind chosen with the kind that came last made less likely: x EVENT_REPEAT, once more for each time in a row it came. A different kind coming
// puts the old one back to normal. A wounded hero is one kind whether a hero room or an event room held it. Same rooms as before, only the kinds move.
const EVENT_REPEAT = 0.7; // (placeholder value)
// VERSION 7 ("you shouldn't just get back to back to back rival fights"): the hero rooms are chosen against the hero rooms only, so an event or a
// stall between two of them no longer breaks a run of rivals, and the same outcome never comes a third time in a row (HERO_REPEAT_MAX).
const HERO_REPEAT_MAX = 2;
function specials(seed, ascension, v = VERSION) {
  const slots = eventSlots(seed, ascension);
  const stalls = stallRooms(seed, ascension);
  const events = {}, heroes = {};
  let last = null, streak = 0, heroLast = null, heroStreak = 0;
  const choose = (list, u) => {
    const weight = list.map((k) => (k === last ? EVENT_REPEAT ** streak : 1));
    let at = u * weight.reduce((a, b) => a + b);
    return list.find((_, i) => (at -= weight[i]) < 0) ?? list[list.length - 1];
  };
  for (let room = 1; room < LAST_ROOM; room++) {
    let kind;
    if (rivalRoom(seed, room, ascension)) {
      if (v >= 7) { // against the hero rooms alone
        const weight = HERO_ROOM.map((k) => (k !== heroLast ? 1 : heroStreak >= HERO_REPEAT_MAX ? 0 : EVENT_REPEAT ** heroStreak));
        let at = dice(seed, room, 'visit')() * weight.reduce((a, b) => a + b);
        kind = heroes[room] = HERO_ROOM.find((_, i) => (at -= weight[i]) < 0) ?? HERO_ROOM[HERO_ROOM.length - 1];
        heroStreak = kind === heroLast ? heroStreak + 1 : 1;
        heroLast = kind;
      } else kind = heroes[room] = choose(HERO_ROOM, dice(seed, room, 'visit')());
    }
    else if (stalls.includes(room)) kind = 'broker';
    else if (slots[room] !== undefined) kind = events[room] = choose([...EVENT_KINDS, 'rift'].filter((k) => k !== 'patron' || !Object.values(events).includes('patron')), slots[room]); // one Patron's Favor a run
    else continue;
    streak = kind === last ? streak + 1 : 1;
    last = kind;
  }
  return { events, heroes };
}
// The wounded rival an event room holds (any hero but the run's), from the room's own dice.
const woundedRival = (seed, room, hero) => pick(roster().filter((n) => n !== hero), dice(seed, room, 'wounded'));
const between = ([lo, hi], rng) => lo + Math.floor(rng() * (hi - lo + 1));
const NO_FIGHT = new Set(['broker', 'visit', 'doors', ...EVENT_KINDS]); // room kinds with nothing to fight (the Rift is fought)
// A hero room (VERSION 4): null (a rival, as before), { kind: 'wounded', rival } (a wounded hero to assist) or { kind: 'visit', hero, deal } (an interaction).
// `kind` is the room's outcome (VERSION 5 takes it from `specials`, which spaces repeats out; before, a third each from the room's own roll);
// `held` are deals the hero already has (`heldDeals`), which are not offered again.
const HERO_ROOM = ['rival', 'wounded', 'visit'];
function visitOf(seed, room, hero, kind = HERO_ROOM[Math.floor(dice(seed, room, 'visit')() * 3)], held = [], v = VERSION) {
  if (kind === 'rival') return null;
  if (kind === 'wounded') return { kind: 'wounded', rival: woundedRival(seed, room, hero) };
  const open = (n) => [].concat(VISITS[n]).filter((deal) => !held.includes(deal) && !(deal === 'travel' && room % ROOMS_PER_FLOOR === ROOMS_PER_FLOOR - 1) && !(deal === 'lesson' && floorOf(room) >= FLOORS) && !(deal === 'burrow' && floorOf(room) * ROOMS_PER_FLOOR - room - 1 < BURROW_MIN)); // (Mirage: the next room is the boss; Dynamo: there is no next floor)
  const pool = Object.keys(VISITS).filter((n) => n !== hero && v >= (DEAL_SINCE[n] ?? 0) && roster().includes(n) && open(n).length);
  if (!pool.length) return null;
  const who = pick(pool, dice(seed, room, 'visit-hero'));
  return { kind: 'visit', hero: who, deal: pick(open(who), dice(seed, room, 'visit-deal')) };
}
// The Rift's rival heroes: 1-6, any but the run's, from the room's own dice.
const riftRivals = (seed, room, hero) => { const rng = dice(seed, room, 'rift'); return take(roster().filter((n) => n !== hero), between(RIFT.heroes, rng), rng); };
const BOSS_AFFIXES = Object.keys(AFFIXES).filter((k) => k !== 'Bulwarked'); // A19: a quarter more health on top of A12 would be too much
function roomSpec(seed, room, hero, ascension = 0, v = 0) {
  const rng = dice(seed, room, 'room');
  const base = { room, floor: floorOf(room), ascension, ...(v >= 3 ? { side: pick(PATRONS, dice(seed, 'patron')) } : {}) }; // side: the Patron this run fights (its troopers' pictures, the bottom)
  if (room === LAST_ROOM) return { ...base, kind: 'boss', boss: 'patron', final: true, ...(on(ascension, 20) ? { siege: true } : {}), ...(v >= 3 ? { patron: pick(PATRONS, dice(seed, 'patron')) } : {}) };
  if (room % ROOMS_PER_FLOOR === 0) {
    const boss = pick(FLOOR_BOSSES, rng);
    return { ...base, kind: 'boss', boss };
  }
  const rivals = roster().filter((n) => n !== hero);
  if (rivalRolled(seed, room, ascension, rng) && !rivalRoom(seed, room - 1, ascension) && rivals.length) {
    const rival = pick(rivals, rng);
    const visit = v >= 4 && visitOf(seed, room, hero, v >= 5 ? specials(seed, ascension, v).heroes[room] : undefined, [], v);
    return visit ? { ...base, ...visit } : { ...base, kind: 'rival', rival };
  }
  if (stallRooms(seed, ascension).includes(room)) return { ...base, kind: 'broker' };
  const event = v >= 3 && eventRooms(seed, ascension, v)[room];
  if (event) return { ...base, kind: event, ...(event === 'wounded' ? { rival: woundedRival(seed, room, hero) } : event === 'rift' ? { rivals: riftRivals(seed, room, hero) } : {}) };
  return { ...base, kind: 'fight', groups: fightGroups(room, ascension, rng) };
}
// A fight room's enemy groups: the room's threat budget spent on its Floor's enemies (`rng`: the room's dice, or a door's).
function fightGroups(room, ascension, rng) {
  let budget = budgetOf(room, ascension);
  let units = 0;
  let affixed = 0;
  const groups = [];
  for (;;) {
    const can = FLOOR_ENEMIES[Math.min(FLOORS, floorOf(room)) - 1].filter((k) => ARCHETYPES[k].cost <= budget && units + (ARCHETYPES[k].count ?? 1) <= MAX_UNITS);
    if (!can.length) break;
    const type = pick(can, rng);
    budget -= ARCHETYPES[type].cost;
    units += ARCHETYPES[type].count ?? 1;
    const size = ARCHETYPES[type].size;
    const affix = room >= AFFIX_FROM && rng() < affixChance(room, on(ascension, 18) ? 1 : 0) && affixed < MAX_AFFIXED ? pick(Object.keys(AFFIXES), rng) : null; // A18 no longer adds a third affixed group (Nov 14: the level alone took 10 points off the clear rate)
    if (affix) affixed += 1;
    groups.push({ type, ...(size ? { family: pick(FAMILIES[size], rng) } : {}), affix });
  }
  if (on(ascension, 18) && room > 30) for (const g of groups) if (g.affix) g.affix2 = pick(Object.keys(AFFIXES).filter((k) => k !== g.affix), rng);
  return groups;
}
// ---- Two Doors (VERSION 8; "Two Doors") ----
// After a room, the next one is a choice of doors (DOORS of them); a Floor's boss and the bottom are the only way forward. A door is a Fight Room (its
// enemies shown), a Mystery Room (a Rival, a hero's deal, a Wounded Rival or the Broker; the Soul Urn and a Teleporter can hide there too; what is
// inside is not shown) or a named door (OWN_DOORS). Two doors are never the same kind, unless both are fights. The door taken is kept on the run
// (`path`), so the room stays what it was when the run's state moves on. every room still gives its Level (Level 35 is always reached);
// a named door gives no pick (`noPick`), a Mystery Room and a fight do. Every number is (placeholder value)
const DOORS = 2;
const DOOR = { fight: 0.64, mystery: 0.18 }; // a door's chance to be a fight / a Mystery Room; the rest is a named door
const OWN_DOORS = ['rift', 'rest', 'breather', 'urn', 'dealer', 'teleporter'];
const MYSTERY = { rival: 1, visit: 1, wounded: 1, broker: 0.75, urn: 0.35, teleporter: 0.35 }; // what a Mystery Room holds, by weight
// A door run counts the Broker's stalls it enters (`stalls`), however it got there: he gives no Level, so at most BROKER_MAX a run (older runs: always true).
const stallsLeft = (d) => (d.v ?? 0) < 8 || (d.stalls ?? 0) < BROKER_MAX;
const hasDoors = (d, room) => (d.v ?? 0) >= 8 && !d.path?.[room] && room % ROOMS_PER_FLOOR !== 0 && room !== LAST_ROOM && d.teleported?.room !== room;
function mysteryOf(d, base, rng) {
  const { room } = base;
  const visit = visitOf(d.seed, room, d.hero, 'visit', heldDeals(d), d.v);
  const can = { rival: d.path?.[room - 1]?.kind !== 'rival', visit: !!visit, wounded: !d.ally, broker: room >= BROKER_FROM && stallsLeft(d), urn: !d.urn, teleporter: !d.urn };
  const kinds = Object.keys(MYSTERY).filter((k) => can[k]);
  let at = rng() * kinds.reduce((a, k) => a + MYSTERY[k], 0);
  const kind = kinds.find((k) => (at -= MYSTERY[k]) < 0) ?? 'rival';
  const others = roster().filter((n) => n !== d.hero);
  return { ...base, mystery: true, ...(kind === 'visit' ? visit : { kind }), ...(kind === 'rival' ? { rival: pick(others, rng) } : kind === 'wounded' ? { rival: woundedRival(d.seed, room, d.hero) } : {}) };
}
function doorsOf(d, room = d.room) {
  const ascension = d.ascension ?? 0;
  const base = { room, floor: floorOf(room), ascension, side: pick(PATRONS, dice(d.seed, 'patron')) };
  const own = OWN_DOORS.filter((k) => !d.urn || (k !== 'urn' && k !== 'teleporter'));
  const doors = [];
  const kindOf = (x) => (x.mystery ? 'mystery' : x.kind);
  for (let i = 0; i < DOORS; i++) {
    const rng = dice(d.seed, room, 'door', i);
    const u = rng();
    let kind = room < EVENT_FROM || u < DOOR.fight ? 'fight' : u < DOOR.fight + DOOR.mystery ? 'mystery' : pick(own, rng);
    if (doors.some((x) => kindOf(x) === kind)) kind = 'fight';
    let groups = kind === 'fight' ? fightGroups(room, ascension, rng) : null;
    for (let t = 0; groups && t < 6 && doors.some((x) => x.kind === 'fight' && roomLine(x) === roomLine({ kind, groups })); t++) groups = fightGroups(room, ascension, rng); // two Fight Rooms never hold the same enemies
    doors.push(kind === 'fight' ? { ...base, kind, groups } : kind === 'mystery' ? mysteryOf(d, base, rng)
      : { ...base, kind, noPick: true, ...(kind === 'rift' ? { rivals: riftRivals(d.seed, room, d.hero) } : {}) });
  }
  // Mirage's Traveler in a door run: the room she sends you to is one more door.
  if (d.extraDoor?.room === room) doors.push({ ...base, kind: d.extraDoor.kind, noPick: true, travel: true, ...(d.extraDoor.kind === 'wounded' ? { rival: woundedRival(d.seed, room, d.hero) } : {}) });
  return doors.map((x) => withoutAlly(d, x));
}
// Take door `index` of the room the run stands before. Returns { ok, spec } or { error: 'none' }.
function chooseDoor(d, index) {
  const spec = specOf(d);
  const door = d.phase === 'ready' && spec.kind === 'doors' ? spec.doors[index] : null;
  if (!door) return { error: 'none' };
  d.path ??= {};
  for (const room of Object.keys(d.path)) if (room < spec.room - 8) delete d.path[room]; // only the last few rooms are ever asked for again
  d.path[spec.room] = door;
  if (door.kind === 'broker') d.stalls = (d.stalls ?? 0) + 1;
  delete d.extraDoor;
  if (d.doorway === true && spec.doors.length > 1) d.doorway = { room: spec.room, doors: spec.doors.filter((_, i) => i !== index) }; // the doors left behind stay open
  else if (d.doorway?.room < spec.room) delete d.doorway; // walked on: it closes
  return { ok: true, spec: door };
}
// The Doorman's Doorway (my idea): a held promise (`doorway: true`). At the next choice of doors the ones not taken are kept
// (`doorway: { room, doors }`); once that room is done the run can step back through one of them and play it too, under the same room number, or
// walk on (the Doorway then closes). One use. `doorwayOpen`: the doors that can be stepped back through right now.
const doorwayOpen = (d) => (d.doorway?.doors && d.phase === 'ready' && d.room === d.doorway.room + 1 && !d.replay && !d.path?.[d.room] ? d.doorway.doors : []);
function stepBack(d, index) {
  const door = doorwayOpen(d)[index];
  if (!door) return { error: 'none' };
  d.room = d.doorway.room;
  if (d.teleported?.room === d.room) delete d.teleported; // (the first room there was a Teleporter's landing)
  d.path[d.room] = { ...door, doorway: true };
  if (door.kind === 'broker') d.stalls = (d.stalls ?? 0) + 1;
  delete d.doorway;
  return { ok: true, spec: d.path[d.room] };
}
// A room after the Teleporter sent you on (`teleported` on the run): the room it landed you in, in place of the Teleporter's.
// Ivy's Rescue: the rooms from where she set the hero down to the one it lost. The first is a Rest Stop; the others are fights again, rolled fresh (a new seed
// per rescue, the first that comes out as a fight: no events, stalls or hero rooms to farm twice), keeping the run's side.
function replaySpec(d, room) {
  const { back, n } = d.replay;
  const base = roomSpec(d.seed, room, d.hero, d.ascension ?? 0, d.v ?? 0);
  if (room === back) return { ...base, kind: 'rest' };
  let fresh;
  for (let i = 1; i <= 50 && fresh?.kind !== 'fight'; i++) fresh = roomSpec(`${d.seed}~${n}~${i}`, room, d.hero, d.ascension ?? 0, d.v ?? 0);
  return { ...fresh, ...(base.side ? { side: base.side } : {}) };
}
const specOf = (d, room = d.room) => {
  if (d.replay && room >= d.replay.back && room <= d.replay.until) return replaySpec(d, room);
  if (hasDoors(d, room)) return { room, floor: floorOf(room), ascension: d.ascension ?? 0, kind: 'doors', doors: doorsOf(d, room) };
  const spec = d.path?.[room] ?? roomSpec(d.seed, room, d.hero, d.ascension ?? 0, d.v ?? 0);
  const to = d.teleported?.room === room ? d.teleported.kind : null;
  // A held deal re-rolls only rooms still to come (and not the one mid-way through Graves' Ghouls): a room already passed, or the one being
  // resolved, keeps its deal, or accepting Plot Armor would turn its own room into a rival's.
  const open = room >= d.room && !((d.ghoulFrom != null || d.harrowFrom != null) && room === d.room);
  return withoutAlly(d, (open ? (x) => withoutHeld(d, x) : (x) => x)(to ? { ...spec, kind: to, teleported: true, ...(to === 'wounded' ? { rival: woundedRival(d.seed, room, d.hero) } : {}) } : spec));
};
// The deals the hero still has running (Paige's Plot Armor, Sinclair's Assistant, Graves' Ghouls and McGinnis' Turret are not offered
// again until they are used up). An interaction whose deal is held becomes another deal, or a rival when none is left.
const floorBoss = (room) => floorOf(room) * ROOMS_PER_FLOOR;
const buffTotal = (d) => Object.values(d.buffs ?? {}).reduce((a, b) => a + b, 0);
const heldDeals = (d) => [d.venom && 'venom', ...(d.urn || d.replay ? ['burrow'] : []), ...(buffTotal(d) < HARROW.cost ? ['harrow'] : []), d.doorway && 'doorway', d.smash && 'smash', d.plotArmor && 'plot', ...(d.rescue || d.plotArmor || d.urn || d.replay ? ['rescue'] : []), ...(d.rescue ? ['plot'] : []), d.assistant && 'assistant', d.capsule && 'capsule', d.lesson && 'lesson', ...(d.minions ?? []).map((m) => ({ ghoul: 'ghouls', turret: 'turret', helper: 'helper', rat: 'rats' })[m.kind])].filter(Boolean);
function withoutHeld(d, spec) {
  const held = heldDeals(d);
  if (spec.kind !== 'visit' || !held.includes(spec.deal)) return spec;
  const again = visitOf(d.seed, spec.room, d.hero, 'visit', held, d.v ?? 0);
  if (again) return { ...spec, ...again };
  const { hero, deal, ...rest } = spec;
  return { ...rest, kind: 'rival', rival: pick(roster().filter((n) => n !== d.hero), dice(d.seed, spec.room, 'not-held')) };
}
// The hero fighting beside you (`ally`) never shows up anywhere else while it is with you: a rival, a wounded hero or one of the
// Rift's heroes who would be it is another hero (from the room's own dice), an interaction with it is a rival room instead.
function withoutAlly(d, spec) {
  const ally = d.ally?.hero;
  if (!ally) return spec;
  const other = (taken) => pick(roster().filter((n) => n !== d.hero && !taken.includes(n)), dice(d.seed, spec.room, 'not-ally'));
  if ((spec.kind === 'rival' || spec.kind === 'wounded') && spec.rival === ally) return { ...spec, rival: other([ally]) };
  if (spec.kind === 'rift' && spec.rivals.includes(ally)) return { ...spec, rivals: spec.rivals.map((n) => (n === ally ? other(spec.rivals) : n)) };
  if (spec.kind === 'visit' && spec.hero === ally) { const { hero, deal, ...rest } = spec; return { ...rest, kind: 'rival', rival: other([ally]) }; }
  return spec;
}
const affixesOf = (g) => [g.affix, g.affix2].filter(Boolean);
// The bottom room's bosses, in order (A20 puts a floor boss first).
const finalKeys = (spec) => {
  const patron = spec.patron ? [spec.patron, `${spec.patron}-weak`] : FINAL;
  return spec.siege ? ['base-guardian', 'shrine', ...patron] : spec.first ? [spec.first, ...patron] : patron;
};
// The run's Patron at the bottom (VERSION 3): 'archmother' | 'hidden-king'; null before.
const patronOf = (d) => specOf(d, LAST_ROOM).patron ?? null;
const otherPatron = (key) => (key === 'archmother' ? 'hidden-king' : 'archmother');

// The enemy units of a fight room.
const unitsOf = (spec) => spec.groups.flatMap((g) => {
  const a = ARCHETYPES[g.type];
  const asc = spec.ascension ?? 0;
  const affixes = affixesOf(g);
  const elite = affixes.length > 0;
  const k = power(spec.room);
  const champ = elite && on(asc, 11) ? 1 + ASC.elite : 1;
  const health = hpPower(spec.room) * (on(asc, 2) ? 1 + ASC.room : 1) * champ;
  // room enemies hit harder each floor ("you can only die to bosses and never to troopers": a kitted hero healed through them)
  const hit = k * (1 + TUNE.roomFloor * (floorOf(spec.room) - 1)) * (on(asc, 6) ? 1 + ASC.room : 1) * champ;
  return Array.from({ length: a.count ?? 1 }, () => {
    const s = a.stats;
    const e = enemy([...affixes.map((x) => affixTag(x)), groupName(g)].join(' '), { ...s, maxHealth: s.maxHealth * TUNE.health * health, dps: s.dps * TUNE.dps * hit, blast: s.blast && { ...s.blast, damage: s.blast.damage * TUNE.dps * hit } });
    if (a.special) e.stats.special = a.special;
    e.kind = g.type; // what Dynamo's Lesson studies (engine.js damage)
    e.stats.accuracy = TUNE.accuracy;
    e.stats.outputFloor = OUTPUT_FLOOR;
    if (g.family) e.stats.special = specialFor(g.family, a.size === 'small'); // its family's special attack (medium and large only)
    for (const affix of affixes) AFFIXES[affix].apply(e);
    warded(e, asc);
    if (on(asc, 17)) faster(e);
    if (on(asc, 17)) longer(e, CURSE_STUN);
    if (on(asc, 18)) longer(e, SILENCE_DISARM);
    return e;
  });
});

// "2 Swarmlings, 1 Plated Brute, 1 Hexer": a room's enemies in a line (the telegraph before the fight).
function roomLine(spec) {
  if (spec.final) return finalKeys(spec).map((key) => `the ${BOSSES[key].name}`).join(', then ');
  if (spec.kind === 'boss') return `the ${bossName(spec)}${escorted(spec) ? ' and 2 Swarmlings' : ''}`;
  if (spec.kind === 'rival') return spec.rival;
  if (spec.kind === 'broker') return "the Broker's stall";
  if (spec.kind === 'rest') return 'a rest stop';
  if (spec.kind === 'breather') return 'a quiet corner';
  if (spec.kind === 'urn') return 'the Soul Urn';
  if (spec.kind === 'wounded') return `a wounded ${spec.rival}`;
  if (spec.kind === 'dealer') return 'the Curiosity Dealer';
  if (spec.kind === 'patron') return "a Patron's favor";
  if (spec.kind === 'teleporter') return 'a Teleporter';
  if (spec.kind === 'visit') return spec.hero;
  if (spec.kind === 'rift') return `the Rift (${spec.rivals.join(', ')})`;
  if (spec.kind === 'doors') return `${spec.doors.length} doors`;
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
const roomPicture = (spec, stage = 0) => (spec.final ? BOSSES[finalKeys(spec)[stage] ?? 'patron'].icon : spec.kind === 'boss' ? BOSSES[spec.boss].icon : spec.kind === 'fight' ? groupPicture(spec.groups[0], spec.side) : null);

// ---- the run's hero ----
// Each hero's Descend tuning ("balance the modes once and for all, so Ascension 20 is beatable for all characters"): this much more (or
// less) health and damage in every run, so every hero's runs end about as often. Measured, never typed: `node tools/descend-tuning.js` plays good-pick
// runs at Ascension 20 and saves assets/farm/descendTuning.json; re-run it after changing heroes, items, enemies or ascensions.
let TUNING = {};
try { TUNING = require(path.join(ASSETS, 'farm', 'descendTuning.json')).heroes ?? {}; } catch {}
const tuningOf = (hero) => TUNING[hero] ?? 0;
// What the run's hero fights with (the same shape as play.js fightKit).
const runKit = (d) => ({
  healthScale: rules(d).healthScale, tuning: tuningOf(d.hero), rebirth: (d.rebirth ?? 0) + (d.empowered ? EMPOWER / REBIRTH_BONUS : 0), boons: d.level, unlocked: UNLOCKS(d.level), points: POINTS(d.level), tiers: d.tiers,
  items: [...SLOTS.flatMap((s) => d.items[s]), ...(d.legendary ? [d.legendary] : [])], enhanced: d.enhanced ?? [], fragile: fragileOf(d), tempered: d.tempered ?? {}, corrupted: corruptedOf(d), buffs: d.buffs, bridge: [...(d.bridge ?? []), ...(d.urn ? ['urn'] : [])], imbues: d.imbues, kept: d.kept, itemCd: d.itemCd ?? {}, aura: helperAura(d), lesson: lessonNow(d), // the Lil Helper's resist while it lives; Paradox's capsule: the Items' own shorter or longer cooldowns; the Soul Urn's carrier buffs while carrying it (buffs.js URN_CARRIER)
});
// The run's corrupted items: a list ({ name, drawback, amount }); a run saved while the Broker held one at a time has an object.
const corruptedOf = (d) => [].concat(d.corrupted ?? []);
// The run's Fragile Items (the Broker's stall): names, at most one at a time. Weaker than the real thing (stats.js fragileCard) until the
// Broker mends one into an Enhanced item at a later stall; a Rejuv used in a won fight shatters them (afterWin).
const fragileOf = (d) => d.fragile ?? [];
const pointsLeft = (d) => POINTS(d.level) - pointsSpent(d.tiers);

// A rival rolls its kit around the hero's (encounter.js) but RIVAL.levels lower and with RIVAL.health of its health: a fair duel would end half the runs.
// Ascensions: 1 level closer from A18.
const RIVAL = { levels: 2, health: 0.7 };
// A10 (after 1 Reroll a Floor hit too hard): rivals, the Rift's heroes and recruited allies a level closer and at ASC.heroHealth.
const rivalLevels = (a) => Math.max(0, RIVAL.levels - (on(a, 10) ? 1 : 0) - (on(a, 18) ? 1 : 0)); // A10 a level closer, A18 one more (never above yours)
const rivalHealth = (a = 0) => (on(a, 10) ? ASC.heroHealth : RIVAL.health);
const allyHealth = (a = 0) => (on(a, 10) ? ASC.heroHealth : ALLY_HEALTH);
function rivalKitFor(spec, d, kit = runKit(d)) {
  const lower = rivalLevels(d.ascension ?? 0);
  return rivalKit({ ...kit, boons: Math.max(0, kit.boons - lower), points: POINTS(Math.max(0, d.level - lower)), unlocked: UNLOCKS(Math.max(0, d.level - lower)) }, dice(d.seed, spec.room, 'rival'), spec.rival);
}
// A recruited wounded rival (`ally` on the run: { hero, kit, left }): it fights on the hero's side with ALLY_HEALTH of its health, fresh each fight.
function allyUnit(ally, a = 0) {
  const unit = buildHero(ally.hero, ally.kit);
  unit.stats.maxHealth *= allyHealth(a);
  unit.health = unit.stats.maxHealth;
  return unit;
}
function rivalFor(spec, d, kit) {
  const unit = buildHero(spec.rival, rivalKitFor(spec, d, kit));
  unit.stats.maxHealth *= rivalHealth(d.ascension ?? 0);
  unit.health = unit.stats.maxHealth;
  return unit;
}
// What room `spec` holds, for View Enemy Build: { units } (the enemies, as the fight will build them) or { rival, kit, health } (a rival hero's kit is rolled from the run's seed, so it is the one it fights with).
// A4: from floor 5 a floor boss (not the bottom) fights with 2 Swarmlings; A10: from floor 2 it gets back up once (fightRoom; Nov 2 reshape).
const escorted = (spec) => !spec.legacy && !spec.final && on(spec.ascension ?? 0, 4) && spec.room > 20;
const escort = (spec) => (escorted(spec) ? unitsOf({ room: spec.room, ascension: spec.ascension, groups: [{ type: 'swarm' }] }) : []);
// A boss of the bottom room: A20's two openers (the Base Guardian and the Shrine) come with ASC.siege of their health (Nov 14: the level alone took 10 points off the clear rate).
const finalBoss = (key, spec) => { const e = bossFor(key, spec.room, spec.ascension); if (spec.siege && !PATRON_KEYS.has(key)) { e.stats.maxHealth *= ASC.siege; e.health = e.stats.maxHealth; e.stats.healthRegen *= ASC.siege; } return e; };
const bossesOf = (spec) => (spec.final ? finalKeys(spec).map((key) => finalBoss(key, spec)) : [bossFor(spec.boss, spec.room, spec.ascension, spec.affix), ...escort(spec)]);
const enemiesOf = (d, spec) => (spec.kind === 'rival' ? { rival: spec.rival, kit: rivalKitFor(spec, d), health: rivalHealth(d.ascension ?? 0) }
  : { units: spec.kind === 'boss' ? bossesOf(spec) : unitsOf(spec) });

// Plays room `spec` with the run `d` (nothing saved). Returns play.js simulate's run, with `spec`.
function fightRoom(d, spec, rng = Math.random) {
  const kit = runKit(d);
  const enemies = spec.kind === 'boss' ? () => bossesOf(spec)
    : spec.kind === 'rival' ? () => [rivalFor(spec, d, kit)]
      : () => unitsOf(spec);
  const blessed = (key, e) => { // the Patron's Favor: the bottom's Patrons fight with BLESSING less health and damage
    if (!d.blessing || !PATRON_KEYS.has(key)) return e;
    e.stats.maxHealth *= 1 - BLESSING; e.health = e.stats.maxHealth; e.stats.dps *= 1 - BLESSING;
    if (e.stats.blast) e.stats.blast = { ...e.stats.blast, damage: e.stats.blast.damage * (1 - BLESSING) };
    return e;
  };
  const rift = spec.kind === 'rift';
  const stages = spec.final ? finalKeys(spec).map((key) => ({ name: BOSSES[key].name, enemies: () => [blessed(key, finalBoss(key, spec))] })) // in one go, health carried
    : rift ? [{ name: 'The Rift', enemies: () => spec.rivals.map((name) => Object.assign(rivalFor({ rival: name, room: `${spec.room}:rift:${name}` }, d, kit), { flee: RIFT.rivalFlee })) }]
      : [{ name: `Room ${spec.room}`, enemies }];
  const run = simulate(d.hero, 'descend', {
    rng, stages, health: d.health, rejuvs: d.rejuvs, ...kit, allies: d.ally ? [allyUnit(d.ally, d.ascension ?? 0)] : [],
    minions: minionUnits(d, spec), echo: d.assistant ? ASSISTANT.echo : 0, plotArmor: !!d.plotArmor, venom: !!d.venom, // what the hero rooms lent
    ...(rift ? { ffa: true, flee: RIFT.flee, maxSeconds: RIFT.seconds } : {}),
  });
  return { ...run, spec, ...(spec.kind === 'rival' ? { theirs: rivalKitFor(spec, d, kit), theirHealth: rivalHealth(d.ascension ?? 0) } : {}) };
}

// ---- minions: `minions` on the run, [{ kind, count, fights? (left), floor? (a Rift's: until that floor's boss is beaten), rifts? }] ----
// Each one is a lane trooper of the room it fights in, at its kind's share of health and damage (a Rift Trooper: the wiki's bonus for the Rifts before it).
function minionUnit(m, room, rat = null) {
  const s = MINIONS[m.kind];
  const t = ARCHETYPES.trooper.stats;
  const bonus = m.kind === 'rift' ? 1 + Math.min(RIFT.cap, RIFT.bonus + RIFT.step * (m.rifts ?? 0)) : 1;
  const hit = power(room) * (1 + TUNE.roomFloor * (floorOf(room) - 1));
  const k = rat?.ronnie ? RAT.ronnie : s.tiers?.[(m.tier ?? 1) - 1] ?? 1;
  const kh = m.kind === 'helper' ? 1 + HELPER.perTier * (m.v ?? 0) : k; // the Lil Helper: what it was fed
  const kd = m.kind === 'helper' ? 1 + HELPER.perTier * (m.w ?? 0) : k;
  const u = enemy(s.name, { maxHealth: t.maxHealth * TUNE.health * hpPower(room) * s.health * bonus * kh, dps: t.dps * TUNE.dps * hit * s.dps * bonus * kd, distance: t.distance, damageType: s.damageType ?? 'bullet',
    ...(m.kind === 'rift' ? { spiritResist: Math.min(RIFT.spiritCap, RIFT.spirit + RIFT.spiritStep * (m.rifts ?? 0)) } : {}) });
  if (m.kind === 'rift') u.stats.meleeResist = RIFT.melee;
  u.minion = m.kind;
  if (rat) { u.name = rat.name; u.rat = true; if (rat.ronnie) u.ronnie = RAT.infect; }
  return u;
}
const minionUnits = (d, spec) => (d.minions ?? []).flatMap((m) => (m.rats ? m.rats.map((rat) => minionUnit(m, spec.room, rat)) : Array.from({ length: m.count }, () => minionUnit(m, spec.room))));
// After a fight: the minions still standing stay, one fight less for those lent for a few; a Rift's go once their floor's boss is beaten. The
// Assistant is one fight less too, and Plot Armor is gone once it saved the hero.
function afterMinions(d, run, spec) {
  let at = 0;
  const left = run.minionsLeft ?? [];
  d.minions = (d.minions ?? []).map((m) => { const flags = left.slice(at, (at += m.count)); const alive = flags.filter(Boolean).length; return { ...m, count: alive, ...(m.rats ? { rats: m.rats.filter((_, i) => flags[i]) } : {}), ...(m.fights ? { fights: m.fights - 1 } : {}) }; })
    .filter((m) => m.count > 0 && (m.fights == null || m.fights > 0) && !(m.floor && spec.kind === 'boss' && floorOf(spec.room) >= m.floor));
  const rats = d.minions.find((m) => m.kind === 'rat'); // a fight won with a Rat standing: one more joins
  if (rats && rats.count < RAT.cap) { rats.rats.push(rollRat(d, spec.room)); rats.count = rats.rats.length; }
  if (!d.minions.length) delete d.minions;
  if (d.assistant && --d.assistant.fights <= 0) delete d.assistant;
  if (run.plotUsed) delete d.plotArmor;
}
function rollRat(d, room) {
  let pool = RAT_NAMES.filter((n) => !(d.ratUsed ??= []).includes(n));
  if (!pool.length) { d.ratUsed = []; pool = RAT_NAMES; }
  const name = pick(pool, dice(d.seed, room, 'rat', d.ratUsed.length));
  d.ratUsed.push(name);
  return { name, ...(name === RONNIE ? { ronnie: true } : {}) };
}
const lend = (d, kind, extra = {}) => { d.minions = [...(d.minions ?? []).filter((m) => m.kind !== kind), { kind, count: MINIONS[kind].count, ...(MINIONS[kind].fights ? { fights: MINIONS[kind].fights } : {}), ...extra }]; };
// The Rift lost: the hero fled with the health it had left (at least RIFT.flee) and gets nothing; the room is passed.
// A Rejuv, or the hero nearly dead (they broke mid-fight, hero.js), shatters the Fragile Items: after a won room and a fled Rift.
function shatterAfter(d, run) {
  if (!((run.rejuvsUsed > 0 || run.fragileBroke?.length) && fragileOf(d).length)) return;
  d.shattered = { room: run.spec.room, names: [...fragileOf(d)], why: run.fragileBroke?.length ? 'health' : 'rejuv' };
  for (const name of d.shattered.names) dropItem(d, name, true);
}
function fleeRift(d, run) {
  const { spec } = run;
  d.health = Math.max(RIFT.flee, run.health);
  d.rejuvs = Math.max(0, d.rejuvs - run.rejuvsUsed);
  shatterAfter(d, run);
  d.kept = { ...d.kept, ...run.kept, ...run.stacks };
  afterMinions(d, run, spec);
  d.fled = { room: spec.room };
  roomPassed(d, spec.room);
  d.room = spec.room + 1;
  d.phase = 'ready';
}
// Ivy's Rescue: a fight (not a boss) that would have killed the hero. Ivy takes it back to a Rest Stop RESCUE.back rooms earlier, but not before the start of the floor.
// Returns false when she can't (the first room of a floor has nowhere to go back to).
const canRescue = (d, spec) => !!d.rescue && !spec.final && spec.kind !== 'boss' && spec.room % ROOMS_PER_FLOOR !== 1;
function rescue(d, run) {
  const { spec } = run;
  const back = Math.max((floorOf(spec.room) - 1) * ROOMS_PER_FLOOR + 1, spec.room - RESCUE.back);
  d.rejuvs = Math.max(0, d.rejuvs - run.rejuvsUsed);
  shatterAfter(d, run);
  afterMinions(d, run, spec);
  delete d.rescue;
  delete d.offer;
  d.rescued = (d.rescued ?? 0) + 1;
  d.replay = { back, until: spec.room, n: d.rescued };
  d.health = RESCUE.health;
  d.room = back;
  d.phase = 'ready';
  return { back, until: spec.room };
}

// ---- offers ----
// Items that need souls or the farm record are left out of a run (the plan): souls items pay nothing here.
// Nov 2: Blood Tribute and Cursed Relic too, the two items that made every hero worse in a run (tools/descend-values.js: Blood Tribute's drain while
// hurt costs health that carries to the next room; Cursed Relic's own penalty outweighs cursing one enemy of a room of 3-6). Neither is part of an upgrade.
const NO_RUN_ITEMS = new Set(['Golden Goose Egg', 'Trophy Collector', 'Cultist Sacrifice', 'Blood Tribute', 'Cursed Relic']);
const NO_RUN_LEGENDARIES = new Set(['Eternal Gift']); // its permanent buffs come from fight time on the farm record
// The chance of each tier (1-4) in an item offer, by floor (the last row for every floor past it).
const TIER_WEIGHTS = [[60, 40, 0, 0], [20, 50, 30, 0], [5, 40, 45, 10], [0, 20, 50, 30], [0, 5, 45, 50], [0, 0, 35, 65]];
const OFFER_ORDER = ['vitality', 'weapon', 'spirit']; // left, top, right of the pick screen, like Street Brawl's

// Offers lean towards what helps the hero (Nov 2; Brotato's and Isaac's character pools): an item is still drawn at random within its kind and tier, weighted
// by its place in that hero's measured values (tools/descend-values.js, assets/farm/descendValues.json): the best of the pool 1.1, the worst 0.1 + 1/n.
// A hero with no values yet draws evenly.
let VALUES = {};
try { VALUES = require(path.join(ASSETS, 'farm', 'descendValues.json')); } catch {}
function fitPick(list, hero, rng) {
  const v = VALUES[hero];
  if (!v || list.length < 2) return pick(list, rng);
  const ranked = [...list].sort((a, b) => (v[a] ?? 0) - (v[b] ?? 0));
  const w = ranked.map((_, i) => 0.1 + (i + 1) / ranked.length);
  let r = rng() * w.reduce((a, b) => a + b, 0);
  return ranked[w.findIndex((x) => (r -= x) < 0)] ?? ranked.at(-1);
}
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
    if (upgrades.length && rng() < UPGRADE_CHANCE) return fitPick(upgrades, d.hero, rng);
    const tier = tierRoll();
    for (const t of [tier, ...[1, 2, 3, 4].filter((x) => x !== tier).sort((a, b) => Math.abs(a - tier) - Math.abs(b - tier))]) {
      const pool = POOL[kind].filter((n) => ok(n) && itemByName(n).Tier === t);
      if (pool.length) return fitPick(pool, d.hero, rng);
    }
    return null;
  }).filter(Boolean);
  const bonuses = {};
  choices.forEach((name, i) => {
    const card = itemByName(name);
    const { used } = priceFor(card, d.items);
    if (!used.length || slotsUsed(d) - used.length + 1 >= maxItems) return; // a BONUS only comes with room left once the upgrade is in
    const pool = POOL[SLOT_OF[card.Slot]].filter((n) => ok(n) && !choices.includes(n) && itemByName(n).Tier < card.Tier && !sameLine(n, name)); // never a part of the upgrade it comes with
    if (pool.length) bonuses[i] = pick(pool, rng);
  });
  return { choices, bonuses };
}

// The reward for room `spec` just cleared: a boss gives 1 of 3 permanent buffs (or on odd floors from 3, 1 of 3 legendaries), a beaten rival any
// one of its own items (`theirs`: the kit it fought with), anything else 3 items.
function rollOffer(d, spec, roll = 0, theirs = null) {
  if (spec.kind === 'rival' && theirs) {
    const owned = SLOTS.flatMap((s) => d.items[s]);
    // an enhanced copy of an item you hold (not yet enhanced) is offered too: it replaces yours in place
    const upgradesMine = (n) => owned.includes(n) && theirs.enhanced?.includes(n) && !d.enhanced?.includes(n);
    const choices = [...new Set(theirs.items)].filter((n) => !NO_RUN_ITEMS.has(n) && (upgradesMine(n) || (!owned.includes(n) && !heldIn(n, d.items))));
    if (choices.length) return { kind: 'items', rival: spec.rival, theirs, choices, enhanced: choices.filter((n) => theirs.enhanced?.includes(n)), room: spec.room, roll }; // its enhanced items stay enhanced // none it can take: the usual 3, a tier up
  }
  const rng = dice(d.seed, spec.room, 'offer', roll, ...(spec.doorway ? ['doorway'] : []));
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
  const rng = dice(d.seed, spec.room, 'drop', ...(spec.doorway ? ['doorway'] : []));
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
// One copy of `name` leaves the build (`all`: every copy). Violet's replica is the only way to hold two: while a copy stays, its
// state (Enhanced, Fragile, imbue, stacks) stays too, and only the leaving copy's corruption goes.
// A give-up dropdown names Violet's copy as '<item> (Replica)': dropping that takes her copy (its paint) instead of the original.
const REPLICA = ' (Replica)';
const plain = (n) => (n?.endsWith(REPLICA) ? n.slice(0, -REPLICA.length) : n);
// Victor's fusions: `d.fused` = pairs of held Items stitched into one. Both stay in the build and both work; the pair takes one slot
// (`slotsUsed`) and the picture shows them as one. Losing a part ends the fusion (the other stays on its own).
const fusedOf = (d) => d.fused ?? [];
const slotsUsed = (d) => countItems(d.items) - fusedOf(d).length + (d.capsule && !d.capsule.legendary ? 1 : 0); // the capsule keeps its Item's slot
const fusedParts = (d) => fusedOf(d).flat();
const FUSE_CHANCE = 1.1; // a fusion's chance is this minus 10% per tier of the two Items (Tier 1 + 1 = 90%, Tier 4 + 4 = 30%); a placeholder
const fuseChance = (a, b) => Math.max(0.2, FUSE_CHANCE - 0.1 * (tierOf(a) + tierOf(b)));
function dropItem(d, name, all = false) {
  const replica = name.endsWith(REPLICA);
  name = plain(name);
  const slot = SLOTS.find((s) => d.items[s].includes(name));
  if (slot) { if (all) d.items[slot] = d.items[slot].filter((n) => n !== name); else d.items[slot].splice(d.items[slot].indexOf(name), 1); }
  if (slot && d.items[slot].includes(name)) {
    const c = corruptedOf(d);
    if (c.filter((x) => x.name === name).length > 1) { c.splice(c.findIndex((x) => x.name === name), 1); d.corrupted = c; }
    if (replica && d.replicas?.includes(name)) d.replicas.splice(d.replicas.indexOf(name), 1);
    return;
  }
  delete d.imbues[name];
  delete d.kept[name];
  if (d.itemCd) delete d.itemCd[name];
  if (d.fused) { d.fused = d.fused.filter((p) => !p.includes(name)); if (!d.fused.length) delete d.fused; } // the fusion ends, the other part stays
  if (d.replicas) d.replicas = d.replicas.filter((n) => n !== name);
  d.enhanced = (d.enhanced ?? []).filter((n) => n !== name);
  if (d.tempered) delete d.tempered[name];
  d.fragile = fragileOf(d).filter((n) => n !== name); // an upgrade (or a swap) of a Fragile Item loses its chance of a free mend
  if (d.corrupted) d.corrupted = corruptedOf(d).filter((c) => c.name !== name); // an upgrade (or a swap) loses the corruption, like selling it on the farm
}
// An Item given up to make room: a fused part takes its partner with it (the pair held one slot, so one part alone would free none).
function giveUp(d, name) {
  const partner = fusedOf(d).find((p) => p.includes(plain(name)))?.find((n) => n !== plain(name));
  dropItem(d, name);
  if (partner) dropItem(d, partner);
}
// Puts item `name` in the build: an upgrade of a held item replaces it in place; with 12 items anything else needs `replace` (lost, no sell-back).
// Returns { ok: true, used: [components replaced], replaced } or { error: 'full' | 'missing' }.
function addItem(d, name, replace = null, enhanced = false) {
  const card = itemByName(name);
  const { used } = priceFor(card, d.items);
  if (used.some((u) => d.enhanced?.includes(u))) enhanced = true; // an upgrade of an enhanced item stays enhanced
  let replaced = null;
  if (enhanced && SLOTS.some((s) => d.items[s].includes(name))) { // the enhanced copy of a held item: yours becomes enhanced, nothing added
    if (!(d.enhanced ??= []).includes(name)) d.enhanced.push(name);
    return { ok: true, used: [], replaced, enhancedHeld: true };
  }
  if (!used.length && slotsUsed(d) >= rules(d).maxItems) {
    if (!replace) return { error: 'full' };
    if (!SLOTS.some((s) => d.items[s].includes(plain(replace)))) return { error: 'missing' };
    giveUp(d, replace);
    replaced = plain(replace);
  }
  // an upgrade of a fused part takes its place in the fusion (both parts used up: the fusion is gone)
  const touched = fusedOf(d).filter((p) => p.some((u) => used.includes(u)));
  const heat = Math.max(0, ...used.map((u) => d.tempered?.[u] ?? 0)); // an upgrade of a Tempered Item keeps its temper
  for (const u of used) dropItem(d, u);
  d.items[SLOT_OF[card.Slot]].push(name);
  if (heat) (d.tempered ??= {})[name] = Math.max(heat, d.tempered?.[name] ?? 0);
  for (const p of touched) { const rest = p.filter((u) => !used.includes(u)); if (rest.length === 1) (d.fused ??= []).push([rest[0], name]); }
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
    for (const key of Object.keys(d)) if (!(key in next)) delete d[key]; // what addItem deleted on the copy (a fusion that ended) must go here too
    Object.assign(d, next);
  }
  if (enhanced) d.enhancedChance = rules(d).enhanced;
  const { kind } = d.offer;
  d.offer = null;
  if (!beginImbues(d, [name, extra.bonus].filter(Boolean))) d.phase = 'ready';
  return { ...extra, ok: true, kind, name, ...(enhanced ? { enhanced: true } : {}) };
}
// Billy's Smash and Grab: every Item on the pick, each Fragile. `need` = how many Items a full build must give up first (upgrades and Items already held take no slot).
const smashOpen = (d) => !!d.smash && d.phase === 'offer' && d.offer?.kind === 'items' && !d.offer.rival;
const smashNeed = (d) => Math.max(0, d.offer.choices.filter((n) => !priceFor(itemByName(n), d.items).used.length && !held(d).includes(n)).length - (rules(d).maxItems - slotsUsed(d)));
function takeAll(d, drop = []) {
  if (!smashOpen(d)) return { error: 'none' };
  const loose = [...new Set(SLOTS.flatMap((s) => d.items[s]))];
  if (drop.length !== smashNeed(d) || new Set(drop).size !== drop.length || drop.some((n) => !loose.includes(plain(n)))) return { error: 'full' };
  for (const n of drop) giveUp(d, n);
  const { choices } = d.offer;
  const taken = [];
  for (const n of choices) {
    if (addItem(d, n, null, d.offer.enhanced?.includes(n)).error) continue;
    taken.push(n);
    if (!fragileOf(d).includes(n)) (d.fragile ??= []).push(n);
  }
  delete d.smash;
  d.offer = null;
  if (!beginImbues(d, taken)) d.phase = 'ready';
  return { ok: true, kind: 'items', name: taken[0], taken, lost: choices.filter((n) => !taken.includes(n)), dropped: drop };
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
  if (!d.imbuing) { delete d.imbuing; delete d.pendingImbues; d.phase = d.pendingBonus ? 'bonus' : d.offer ? 'offer' : 'ready'; } // a hero room's upgrade may need an imbue before its pick
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
// Recruit the rival just beaten instead of taking its item or skipping: it fights beside you for a few fights, then leaves with no gift.
function recruitDefeated(d) {
  const recruit = d.phase === 'offer' && d.offer?.recruit;
  if (!recruit) return { error: 'none' };
  if (d.ally) return { error: 'ally' };
  const fights = between(ALLY_FIGHTS, dice(d.seed, d.offer.room, 'ally'));
  d.ally = { hero: recruit.hero, kit: recruit.kit, left: fights, noGift: true };
  d.offer = null;
  d.phase = 'ready';
  return { ok: true, hero: recruit.hero, fights };
}
function skipChoice(d) {
  if (d.phase !== 'offer') return { error: 'none' };
  const rng = dice(d.seed, d.offer.room, 'skip-buffs');
  // a boss's buff pick is already worth 3 stacks of one buff: skipping it for 3 random ones plus a heal would beat taking it, so it only heals
  const legend = d.offer.kind === 'legendaries';
  const buffs = d.offer.kind === 'buffs' ? [] : Array.from({ length: legend ? LEGEND_SKIP_BUFFS : rules(d).skipBuffs }, () => rollAnyBuff(rng));
  d.buffs ??= {};
  for (const key of buffs) d.buffs[key] = (d.buffs[key] ?? 0) + 1;
  const before = d.health;
  if (!legend) d.health = Math.min(1, d.health + rules(d).skipHeal);
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
// After a won room: a level, the health it has left (plus the breather, 5% since Nov 2; a boss heals back up, full or 80% from A13), Rejuvs used (a boss gives one), kill stacks, and the offer.
function afterWin(d, run) {
  const { spec } = run;
  const r = rules(d);
  const replayed = !!d.replay && spec.room < d.replay.until; // Ivy's Rescue: a room cleared before, no Level, no find, no pick
  if (!(r.deniedSouls && spec.kind === 'boss') && !replayed) d.level = Math.min(MAX_LEVEL, d.level + 1);
  d.health = Math.min(1, run.health + r.rest);
  if (spec.kind === 'boss') d.health = Math.max(d.health, r.bossHeal);
  d.rejuvs = Math.min(r.maxRejuvs, Math.max(0, d.rejuvs - run.rejuvsUsed) + (spec.kind === 'boss' ? 1 : 0));
  shatterAfter(d, run);
  d.kept = { ...d.kept, ...run.kept, ...run.stacks }; // the items' kill stacks and the abilities' (they last the run)
  afterMinions(d, run, spec);
  if (spec.kind === 'rift') { lend(d, 'rift', { floor: spec.floor, rifts: d.riftsWon ?? 0 }); d.riftsWon = (d.riftsWon ?? 0) + 1; } // the Rift won: its troopers, for the rest of the floor
  if (spec.kind === 'boss') d.bridge = []; // the Bridge buffs helped against this floor's boss; they expire now
  if (spec.room % ROOMS_PER_FLOOR === 0) d.rerolls = r.rerolls;
  d.find = replayed ? null : rollFind(d, spec);
  if (d.find?.kind === 'little') d.buffs[d.find.key] = (d.buffs[d.find.key] ?? 0) + 1;
  else if (d.find?.kind === 'big') (d.bridge ??= []).push(d.find.key);
  if (d.find) d.finding = d.find; // shown in a window of its own once the pick is done; the buff itself is already counted
  else delete d.finding;
  const leaving = d.ally && --d.ally.left <= 0 ? d.ally : null; // a recruited rival's last fight: it leaves, and its gift is the pick (any 1 item of its build)
  if (leaving) { d.ally = null; if (!leaving.noGift && !replayed) d.allyLeft = { room: spec.room, hero: leaving.hero }; } // a defeated rival recruited for a while (recruitDefeated) leaves without a gift
  const gift = leaving && !leaving.noGift && !replayed;
  d.offer = spec.final || replayed ? null : gift ? rollOffer(d, { ...spec, kind: 'rival', rival: leaving.hero }, 0, leaving.kit) : rollOffer(d, spec, 0, run.theirs);
  if (d.offer && spec.kind === 'rival' && run.theirs && !gift) d.offer.recruit = { hero: spec.rival, kit: run.theirs }; // a beaten rival can be recruited instead of looted
  roomPassed(d, spec.room);
  d.room = spec.room + 1;
  if (d.replay && spec.room >= d.replay.until) delete d.replay;
  d.phase = spec.final ? 'done' : replayed ? 'ready' : 'offer'; // 'done': the last room is beaten (the run is then taken off the record)
}
// ---- event rooms (pure, like the rest: on a run d) ----
// Passing one: +1 level, and (EVENT_PICK) the room's pick of 3 like a won room's, so an event never costs the run an item (Nov 4 sim, Ascension 20:
// without the pick, events made runs harder, 25% cleared against 32% with no events). `what` happened is kept on the run for the pick screen.
const EVENT_PICK = process.env.EVENT_PICK !== '0';
const passEvent = (d, what, spec = specOf(d)) => {
  if (d.replay && spec.room < d.replay.until) { // Ivy's Rescue: the Rest Stop she set the hero down in gives no Level and no pick
    d.replayed = { room: spec.room, ...what };
    roomPassed(d, spec.room);
    d.room = spec.room + 1;
    return;
  }
  d.level = Math.min(MAX_LEVEL, d.level + 1);
  d.event = { room: spec.room, ...what };
  if (EVENT_PICK && !spec.noPick) { d.offer = rollOffer(d, spec, 0); d.phase = 'offer'; }
  roomPassed(d, spec.room);
  d.room = spec.room + 1;
};
// Every room passed (won, an event, a stall left, a rival fled) brings the Soul Urn a room closer: when its count runs out it is delivered for
// URN_BUFFS permanent buffs (kept as `delivered` for the screens).
function roomPassed(d, room) {
  if (d.doorway?.room < room) delete d.doorway; // the Doorway closes once the run is past the room after it
  if (d.venom && room > d.venom.from && --d.venom.left <= 0) delete d.venom; // Vyper's poison wears off a room at a time
  if (d.lesson && room >= d.lesson.floor * ROOMS_PER_FLOOR) delete d.lesson; // its floor's boss is beaten
  if (d.capsule && room >= d.capsule.back) releaseCapsule(d, room);
  if (!d.urn || --d.urn.left > 0) return;
  const rng = dice(d.seed, room, 'urn-delivered');
  const buffs = Array.from({ length: URN_BUFFS }, () => rollAnyBuff(rng));
  for (const key of buffs) d.buffs[key] = (d.buffs[key] ?? 0) + 1;
  d.urn = null;
  d.delivered = { room, buffs };
}
// Paradox's capsule comes back: the Item returns to its slot (or the legendary slot) with its state, its cooldown CAPSULE.perRoom shorter a room it was held
// (a legendary: a roll from CAPSULE.legendary, better or worse, whatever the time). `returned` is kept for the pick screen.
function releaseCapsule(d, room) {
  const c = d.capsule;
  delete d.capsule;
  const rooms = c.back - c.from;
  const rng = dice(d.seed, c.from, 'capsule-roll');
  const mult = c.legendary ? +(CAPSULE.legendary[0] + rng() * (CAPSULE.legendary[1] - CAPSULE.legendary[0])).toFixed(2) : Math.max(0.2, +(1 - CAPSULE.perRoom * rooms).toFixed(2));
  if (c.legendary) d.legendary ??= c.item;
  else d.items[c.slot].push(c.item);
  if (c.enhanced && !(d.enhanced ??= []).includes(c.item)) d.enhanced.push(c.item);
  if (c.fragile && !fragileOf(d).includes(c.item)) (d.fragile ??= []).push(c.item);
  if (c.corrupted) d.corrupted = [...corruptedOf(d), c.corrupted];
  (d.itemCd ??= {})[c.item] = mult;
  d.returned = { room, item: c.item, rooms, mult, legendary: !!c.legendary };
}
// The held items a rest stop can try to enhance: not yet enhanced, not Fragile, not corrupted, not the legendary.
const tinkerables = (d) => [...new Set(SLOTS.flatMap((s) => d.items[s]))].filter((n) => !(d.enhanced ?? []).includes(n) && !fragileOf(d).includes(n) && !corruptedOf(d).includes(n) && Object.keys(itemByName(n)?.PropertyUpgrades ?? {}).length > 0); // (an item with no enhanced bonuses has nothing to gain)
// The rest stop: 'rest' heals REST_HEAL, 'tinker' tries to enhance item `name` (TINKER_CHANCE, from the run's seed). Either way +1 level and on.
function restStop(d, action, name) {
  if (d.phase !== 'ready' || specOf(d).kind !== 'rest') return { error: 'none' };
  if (action === 'tinker') {
    if (!tinkerables(d).includes(name)) return { error: 'item' };
    const enhanced = dice(d.seed, d.room, 'tinker')() < TINKER_CHANCE;
    const replay = !!d.replay && d.room < d.replay.until; // Ivy's Rescue: no Level
    if (enhanced) (d.enhanced ??= []).push(name);
    passEvent(d, { action, name, enhanced });
    return { ok: true, action, name, enhanced, replay };
  }
  const before = d.health;
  const replay = !!d.replay && d.room < d.replay.until;
  d.health = Math.min(1, d.health + REST_HEAL);
  passEvent(d, { action: 'rest', healed: d.health - before });
  return { ok: true, action: 'rest', healed: d.health - before, replay };
}
// The quiet corner: the crates and the Golden Statue give one find (from the run's seed), then +1 level and on.
function breakCrates(d) {
  if (d.phase !== 'ready' || specOf(d).kind !== 'breather') return { error: 'none' };
  const rng = dice(d.seed, d.room, 'breather');
  const roll = rng();
  const bridges = Object.keys(BRIDGE).filter((key) => !(d.bridge ?? []).includes(key));
  let find;
  if (roll < BREATHER.buff) { const key = rollAnyBuff(rng); d.buffs[key] = (d.buffs[key] ?? 0) + 1; find = { kind: 'little', key }; }
  else if (roll < BREATHER.buff + BREATHER.heal || !bridges.length) { const before = d.health; d.health = Math.min(1, d.health + BREATHER_HEAL); find = { kind: 'heal', healed: d.health - before }; }
  else { const key = pick(bridges, rng); (d.bridge ??= []).push(key); find = { kind: 'big', key }; }
  passEvent(d, { action: 'break', find });
  return { ok: true, find };
}
// The Curiosity Dealer's trades: the held items he takes (not the legendary), and the 3 a tier up in the same slot a swap of `name` offers (from the seed).
const dealerItems = (d) => [...new Set(SLOTS.flatMap((s) => d.items[s]))].filter((n) => !fusedParts(d).includes(n)); // a fusion is not for sale; once each: a Violet replica is a second copy (dropdown values must differ)
function swapChoices(d, name) {
  const card = itemByName(name);
  if (!card || card.Tier >= 4) return [];
  const held = SLOTS.flatMap((s) => d.items[s]);
  const pool = ITEM_POOL.filter((n) => { const c = itemByName(n); return c.Slot === card.Slot && c.Tier === card.Tier + 1 && !NO_RUN_ITEMS.has(n) && canBuy(d.hero, n) && !held.includes(n) && !heldIn(n, d.items); });
  const rng = dice(d.seed, d.room, 'dealer', name);
  const out = [];
  while (out.length < 3 && out.length < pool.length) { const n = pick(pool, rng); if (!out.includes(n)) out.push(n); }
  return out;
}
// Every other event's choice (pure, on a run d). 'leave' passes any event room. Returns { ok,... } or { error }.
function eventAct(d, action, name) {
  const spec = specOf(d);
  if (d.phase !== 'ready' || !(EVENT_KINDS.includes(spec.kind) || spec.kind === 'visit' || spec.kind === 'rift')) return { error: 'none' };
  if (spec.kind === 'visit' && spec.deal === 'stoke' && action === 'leave') { if (d.stoke?.n) return visitAct(d, spec, 'done'); delete d.stoke; } // leaving Infernus with an Item in his fire takes it back
  if (spec.kind === 'visit' && action !== 'leave') return visitAct(d, spec, action, name);
  if (spec.kind === 'rift' && action !== 'leave') return { error: 'none' }; // the Rift is fought (Fight) or walked past
  if (action === 'rest' || action === 'tinker') return restStop(d, action, name);
  if (action === 'break') return breakCrates(d);
  if (action === 'leave') { passEvent(d, { action, kind: spec.kind, ...(spec.kind === 'visit' ? { hero: spec.hero, deal: spec.deal } : {}) }); delete d.replicaPick; delete d.upgradePick; delete d.tinkerPick; delete d.fusePick; return { ok: true, action, kind: spec.kind, ...(spec.hero ? { hero: spec.hero } : {}) }; }
  if (spec.kind === 'urn' && action === 'urn') { // pick up the Soul Urn (one at a time)
    if (d.urn) return { error: 'carrying' };
    const rooms = between(URN_ROOMS, dice(d.seed, spec.room, 'urn'));
    passEvent(d, { action, rooms });
    d.urn = { left: rooms, from: spec.room }; // after passEvent: this room doesn't count
    return { ok: true, action, rooms };
  }
  if (spec.kind === 'wounded' && action === 'recruit') { // the rival joins for a random number of fights; its kit is set now
    if (d.ally) return { error: 'ally' };
    const fights = between(ALLY_FIGHTS, dice(d.seed, spec.room, 'ally'));
    d.ally = { hero: spec.rival, kit: rivalKitFor(spec, d), left: fights };
    passEvent(d, { action, hero: spec.rival, fights });
    return { ok: true, action, hero: spec.rival, fights };
  }
  if (spec.kind === 'dealer' && (action === 'swap' || action === 'sell')) {
    const item = plain(name); // (name may be Violet's copy)
    if (!dealerItems(d).includes(item)) return { error: 'item' };
    if (action === 'sell') { // sold for a full heal
      dropItem(d, name);
      const healed = 1 - d.health;
      d.health = 1;
      passEvent(d, { action, name: item, healed });
      return { ok: true, action, name: item, healed };
    }
    const choices = swapChoices(d, item);
    if (!choices.length) return { error: 'none-higher' };
    dropItem(d, name);
    passEvent(d, { action, name: item });
    d.offer = { kind: 'items', choices, enhanced: [], room: spec.room, roll: 0, dealer: item }; // the swap's 3 are the pick
    d.phase = 'offer';
    return { ok: true, action, name: item, choices };
  }
  if (spec.kind === 'patron' && PATRON_GIFTS.includes(action)) { // the other Patron's blessing, the member's pick of four
    const by = otherPatron(patronOf(d) ?? 'archmother');
    if (action === 'bless') d.blessing = by; // weaken the bottom's Patrons
    else if (action === 'heal') d.health = 1;
    else if (action === 'empower') d.empowered = by; // EMPOWER more health, weapon damage and spirit power for the rest of the run (runKit)
    else { // 'ally': it sends a hero to fight beside you, like a recruited rival
      if (d.ally) return { error: 'ally' };
      const hero = pick(roster().filter((n) => n !== d.hero), dice(d.seed, spec.room, 'patron-ally'));
      const fights = between(ALLY_FIGHTS, dice(d.seed, spec.room, 'ally'));
      d.ally = { hero, kit: rivalKitFor({ ...spec, rival: hero }, d), left: fights };
      passEvent(d, { action, by, hero, fights });
      return { ok: true, action, by, hero, fights };
    }
    passEvent(d, { action, by });
    return { ok: true, action, by };
  }
  if (spec.kind === 'teleporter' && action === 'step') { // lands in a random no-fight room, this same room number (the Urn's carrier can't, the wiki)
    if (d.urn) return { error: 'carrying' };
    const kind = pick(TELEPORT_TO.filter((k) => k !== 'broker' || stallsLeft(d)), dice(d.seed, spec.room, 'teleport'));
    d.teleported = { room: spec.room, kind };
    if (kind === 'broker' && d.v >= 8) d.stalls = (d.stalls ?? 0) + 1;
    return { ok: true, action, kind };
  }
  return { error: 'none' };
}
// ---- hero rooms' deals (VERSION 4; pure, on a run d) ----
const held = (d) => SLOTS.flatMap((s) => d.items[s]);
const tierOf = (name) => Math.min(4, itemByName(name).Tier);
const replicaChance = (name) => REPLICA_CHANCE[tierOf(name) - 1];
// The held items not stitched into a fusion, once each (the deals that take, copy or trade an item skip a fusion).
const loose = (d) => [...new Set(held(d))].filter((n) => !fusedParts(d).includes(n));
// The items Violet can copy: any held one (Enhanced, Fragile or corrupted too; the legendary slot never).
const replicables = loose;
// Victor's Abomination: two different held Items, any slots. The chance falls with their tiers; a success fuses them into one slot, a fail
// leaves both in the build but Fragile. The pair is picked in two steps (`fusePick.a`, then `.b`), then the Stitch button.
const fuseables = loose;
// Dynamo's Lesson: the kinds of enemy on the NEXT floor (archetype keys, once each), the grade the hero has earned (the health it has kept) and the lesson in force.
const lessonKinds = (room) => [...new Set(FLOOR_ENEMIES[Math.min(FLOORS - 1, floorOf(room))])]; // (the array is 0-based: index floor = the next floor)
const gradeOf = (d) => GRADES.find((g) => d.health >= g.min) ?? GRADES[GRADES.length - 1];
// What a kind is called: a Haunt size has no plural of its own.
const kindName = (k) => ARCHETYPES[k].plural ?? `${sizeWord(ARCHETYPES[k].size ?? k)} Haunts`;
const lessonNow = (d) => (d.lesson && floorOf(d.room) === d.lesson.floor ? { kinds: [d.lesson.kind], deal: d.lesson.power, take: d.lesson.power } : null);
// Rem's Lil Helper: the minion record carries what it was fed (w, v, s = tier points of Weapon, Vitality, Spirit Items; fed = how many).
const helperOf = (d) => d.minions?.find((m) => m.kind === 'helper');
const helperAura = (d) => { const h = helperOf(d); return h ? 1 - (1 - HELPER.aura) * (1 - HELPER.perTier) ** (h.s ?? 0) : 0; }; // 2% to start, then each tier point takes 2% of what is still let through
const feedStat = (name) => ({ Weapon: 'w', Armor: 'v', Tech: 's' })[itemByName(name).Slot];
function addFeed(h, name) { const key = feedStat(name); h[key] = (h[key] ?? 0) + tierOf(name); h.fed = (h.fed ?? 0) + 1; }
// Feeds the Lil Helper an offered Item on a pick screen (the ones you are not taking): the choice leaves the offer. Feed the last one and the pick is over
// (nothing taken, no Skip reward). { ok, pick: true, name } (`done: true` when the offer ended).
function feedOffer(d, index) {
  const offer = d.offer;
  const h = helperOf(d);
  if (d.phase !== 'offer' || !offer || offer.kind !== 'items' || offer.rival || !h || !offer.choices[index]) return { error: 'none' };
  const name = offer.choices[index];
  addFeed(h, name);
  offer.choices.splice(index, 1);
  if (offer.bonuses) offer.bonuses = Object.fromEntries(Object.entries(offer.bonuses).filter(([i]) => +i !== index).map(([i, b]) => [+i > index ? +i - 1 : +i, b]));
  offer.fed = [...(offer.fed ?? []), name];
  if (!offer.choices.length) { d.fedAll = { room: offer.room, names: offer.fed }; d.offer = null; d.phase = 'ready'; return { ok: true, pick: true, done: true, name }; }
  return { ok: true, pick: true, name };
}
// Mirage's Traveler (and calls, Nov 7): the member picks what the NEXT room is, from the no-fight rooms the Teleporter can reach, and Mirage's ult takes them
// there (`teleported`, like the Teleporter, but for the next room and by choice). Only this floor (the room before a boss never gets her, see visitOf), the Urn's
// carrier can't be teleported, a Broker's stall only from BROKER_FROM, a wounded hero only without an ally, a second Urn never; not a kind the next room already is.
const travelKinds = (d, room = d.room) => (d.urn ? [] : TELEPORT_TO.filter((k) => (k !== 'broker' || (room + 1 >= BROKER_FROM && stallsLeft(d))) && (k !== 'wounded' || !d.ally) && specOf(d, room + 1).kind !== k));
// Paradox's Time Capsule: any loose held Item with a cooldown, or the legendary if it has one (the only deal that takes it).
const hasCooldown = (name) => { const c = itemByName(name); return !!c && Object.keys(c).some((k) => k.startsWith('Info') && c[k].Type !== 'Innate' && c[k].Cooldown); };
const capsulables = (d) => (d.capsule ? [] : [...loose(d).filter(hasCooldown), ...(d.legendary && hasCooldown(d.legendary) ? [d.legendary] : [])]);
// McGinnis' upgrade: a held Tier 1-3 item (not Fragile) with an item it builds into; it becomes one of those (from the room's dice).
const upgradesOf = (d, name) => ITEM_POOL.filter((n) => { const c = itemByName(n); return c.Tier === itemByName(name).Tier + 1 && priceFor(c, { weapon: [name], vitality: [name], spirit: [name] }).used.includes(name) && canBuy(d.hero, n) && !NO_RUN_ITEMS.has(n) && !held(d).includes(n); });
const upgradeables = (d) => [...new Set(held(d))].filter((n) => itemByName(n).Tier <= 3 && !fragileOf(d).includes(n) && upgradesOf(d, n).length);
// The Items McGinnis can work on: a Fragile one (repair), an upgradeable one, an enhanceable one.
// What Infernus can temper: an Item in the build that is not Fragile, not half of an Abomination and not tempered before (never the legendary).
const stokeables = (d) => loose(d).filter((n) => !fragileOf(d).includes(n) && !d.tempered?.[n]);
const workables = (d) => [...new Set([...fragileOf(d), ...upgradeables(d), ...tinkerables(d)])];
const mcginnisChance = (name) => MCGINNIS_CHANCE[itemByName(name).Tier - 1];
// McGinnis' help: she takes a Tier 1 or 2 item for a part.
const parts = (d) => loose(d).filter((n) => itemByName(n).Tier <= 2);
// Solomon's Castling: an item swapped for one of the same tier in another slot, a pick of 3 (from the room's dice).
function castleChoices(d, name) {
  const card = itemByName(name);
  const pool = ITEM_POOL.filter((n) => { const c = itemByName(n); return c.Tier === card.Tier && c.Slot !== card.Slot && !NO_RUN_ITEMS.has(n) && canBuy(d.hero, n) && !held(d).includes(n) && !heldIn(n, d.items); });
  return take(pool, 3, dice(d.seed, d.room, 'castling', name));
}
const castleables = (d) => loose(d).filter((n) => castleChoices(d, n).length);
// A hero room's choice (not Turn Down, which is eventAct's 'leave'). Returns { ok,... } or { error }; `pick: true` when Violet still needs to know
// which item her replica replaces (a full build).
function visitAct(d, spec, action, name) {
  const passed = (what) => passEvent(d, { action, hero: spec.hero, deal: spec.deal, ...what }, spec);
  // Graves' Ghouls: the member chooses how many (1 to 3, `ghouls-<n>`; 'accept' = all of them), each costs GHOUL_COST of the current health.
  const ghouls = spec.deal === 'ghouls' && (action === 'accept' ? MINIONS.ghoul.count : Number(/^ghouls-(\d)$/.exec(action)?.[1]));
  if (ghouls) {
    if (ghouls > MINIONS.ghoul.count) return { error: 'none' };
    const from = d.health;
    d.health = from * (1 - GHOUL_COST * ghouls);
    lend(d, 'ghoul', { count: ghouls, floor: spec.floor });
    passed({ action: 'ghouls', count: ghouls, from, to: d.health });
    return { ok: true, action: 'ghouls', deal: spec.deal, hero: spec.hero, count: ghouls, from, to: d.health };
  }
  // Graves, one Ghoul a click: 'ghoul' summons one for GHOUL_COST of the current health and stays in the room until the third (or 'done').
  if ((action === 'ghoul' || action === 'done') && spec.deal === 'ghouls') {
    const have = d.minions?.find((m) => m.kind === 'ghoul')?.count ?? 0;
    if (action === 'ghoul' ? have >= MINIONS.ghoul.count : have < 1) return { error: 'none' };
    if (action === 'ghoul') {
      d.ghoulFrom ??= d.health;
      d.health *= 1 - GHOUL_COST;
      lend(d, 'ghoul', { count: have + 1, floor: spec.floor });
    }
    const count = have + (action === 'ghoul' ? 1 : 0);
    if (count < MINIONS.ghoul.count && action === 'ghoul') return { ok: true, pick: true, count }; // the room stays, with another click to spend
    const from = d.ghoulFrom; delete d.ghoulFrom;
    passed({ action: 'ghouls', count, from, to: d.health });
    return { ok: true, action: 'ghouls', deal: spec.deal, hero: spec.hero, count, from, to: d.health };
  }
  // Mo & Krill's Burrow: straight to this Floor's boss. Every room between is passed with its Level and nothing else.
  if (action === 'accept' && spec.deal === 'burrow') {
    if (d.urn) return { error: 'carrying' };
    const boss = floorOf(spec.room) * ROOMS_PER_FLOOR;
    if (boss - spec.room - 1 < BURROW_MIN) return { error: 'none' };
    passed({ action: 'burrow', rooms: boss - spec.room - 1, boss });
    for (let room = d.room; room < boss; room++) { d.level = Math.min(MAX_LEVEL, d.level + 1); roomPassed(d, room); }
    d.room = boss;
    return { ok: true, action: 'burrow', deal: spec.deal, hero: spec.hero, rooms: boss - spec.room - 1 };
  }
  // Nurse Harrow: heal as often as you have Perma-Buffs to pay with (`heal`), leave when you like (`done`, Turn Down before the first).
  if ((action === 'heal' || action === 'done') && spec.deal === 'harrow') {
    if (action === 'heal') {
      if (buffTotal(d) < HARROW.cost) return { error: 'none' };
      d.harrowFrom ??= d.health;
      for (let i = 0; i < HARROW.cost; i++) { const key = Object.keys(d.buffs).sort((a, b) => d.buffs[b] - d.buffs[a])[0]; if (--d.buffs[key] <= 0) delete d.buffs[key]; }
      d.health = Math.min(1, d.health + HARROW.heal);
      d.harrowN = (d.harrowN ?? 0) + 1;
      return { ok: true, pick: true, count: d.harrowN };
    }
    if (!d.harrowN) return { error: 'none' };
    const [count, from] = [d.harrowN, d.harrowFrom];
    delete d.harrowN; delete d.harrowFrom;
    passed({ action: 'harrow', count, from, to: d.health });
    return { ok: true, action: 'harrow', deal: spec.deal, hero: spec.hero, count, from, to: d.health };
  }
  if (action === 'accept' && ['assistant', 'plot', 'rescue', 'doorway', 'smash', 'venom', 'rats'].includes(spec.deal)) {
    if (spec.deal === 'venom') d.venom = { left: VENOM_ROOMS, from: spec.room };
    else if (spec.deal === 'rats') lend(d, 'rat', { floor: spec.floor, rats: [rollRat(d, spec.room)] });
    else if (spec.deal === 'assistant') d.assistant = { fights: ASSISTANT.fights };
    else if (spec.deal === 'smash') d.smash = true;
    else if (spec.deal === 'doorway') d.doorway = true;
    else if (spec.deal === 'rescue') d.rescue = true;
    else d.plotArmor = true;
    passed({});
    return { ok: true, action, deal: spec.deal, hero: spec.hero };
  }
  if (action === 'replica' && spec.deal === 'replica') {
    if (!replicables(d).includes(name)) return { error: 'item' };
    if (slotsUsed(d) >= rules(d).maxItems) { d.replicaPick = name; return { ok: true, pick: true, name }; } // which item to give up, asked next
    return replicate(d, spec, name, null);
  }
  if (action === 'replace' && spec.deal === 'replica') {
    const want = d.replicaPick;
    if (!want || !held(d).includes(plain(name)) || plain(name) === want) return { error: 'item' };
    return replicate(d, spec, want, name);
  }
  // McGinnis' tinkering: the member picks an Item (`item`, kept as tinkerPick), then a button: Enhance It, Upgrade Item (which Item
  // in its tree she tries for is asked next when there are several) or, for a Fragile one, Repair the Item. Each costs UPGRADE_COST of the current
  // health, win or fail. A name passed with the button overrides the pick (the tests).
  if (spec.deal === 'upgrade' && ['item', 'upgrade', 'enhance', 'repair', 'into'].includes(action)) {
    if (action === 'item') {
      if (!workables(d).includes(name)) return { error: 'item' };
      d.tinkerPick = name; delete d.upgradePick;
      return { ok: true, pick: true, name };
    }
    const item = action === 'into' ? d.upgradePick : (name ?? d.tinkerPick);
    const cost = () => { const from = d.health; d.health = from * (1 - UPGRADE_COST); return from; };
    const finish = (what) => { delete d.tinkerPick; delete d.upgradePick; return { ok: true, action: what.action ?? action, ...what }; };
    if (action === 'upgrade' || action === 'into') {
      if (!item || !upgradeables(d).includes(item)) return { error: 'item' };
      const into = action === 'into' ? name : upgradesOf(d, item)[0];
      if (action === 'upgrade' && upgradesOf(d, item).length > 1) { d.tinkerPick = item; d.upgradePick = item; return { ok: true, pick: true, name: item }; } // which Item to try for, asked next
      if (!upgradesOf(d, item).includes(into)) return { error: 'item' };
      const success = dice(d.seed, spec.room, 'mcginnis')() < mcginnisChance(item);
      if (success) {
        const added = addItem(d, into);
        if (added.error) return added;
      } else if (!fragileOf(d).includes(item)) (d.fragile ??= []).push(item); // the fail: the item turns Fragile
      const from = cost();
      passed({ action: 'upgrade', name: item, into: success ? into : null, success, from, to: d.health, mood: success ? 'gloat' : 'critical', reveal: true });
      if (success) beginImbues(d, [into]);
      return finish({ action: 'upgrade', name: item, into: success ? into : null, success, from, to: d.health });
    }
    const repair = action === 'repair';
    if (!item || !(repair ? fragileOf(d) : tinkerables(d)).includes(item)) return { error: 'item' };
    const success = repair || dice(d.seed, spec.room, 'mcginnis-enhance')() < TINKER_CHANCE; // enhance: the rest stop's Tinker odds; a fail does nothing
    if (repair) d.fragile = fragileOf(d).filter((n) => n !== item);
    else if (success) (d.enhanced ??= []).push(item);
    const from = cost();
    passed({ name: item, success, from, to: d.health, mood: success ? 'gloat' : 'critical', reveal: true }); // her try gets its own result screen with Continue, like Violet's
    return finish({ name: item, success, from, to: d.health });
  }
  // Infernus' Stoke the Fire: pick an Item (`item`, kept as `stoke` with its Stokes so far), then `stoke` as often as you dare, then `done` (Take It
  // Back). A burn takes one copy of the Item; the temper is only written once the Item is handed back.
  if (spec.deal === 'stoke' && ['item', 'stoke', 'done'].includes(action)) {
    if (action === 'item') {
      if (d.stoke?.n || !stokeables(d).includes(name)) return { error: 'item' };
      d.stoke = { name, n: 0 };
      return { ok: true, pick: true, name };
    }
    const s = d.stoke;
    if (!s || !stokeables(d).includes(s.name)) return { error: 'item' };
    const end = (burned) => {
      delete d.stoke;
      if (burned) dropItem(d, s.name);
      else (d.tempered ??= {})[s.name] = s.n;
      passed({ action: 'stoke', name: s.name, stokes: s.n, burned, success: !burned, mood: burned ? 'critical' : 'gloat', reveal: true });
      return { ok: true, action: 'stoke', name: s.name, stokes: s.n, burned };
    };
    if (action === 'done') return s.n ? end(false) : { error: 'none' };
    if (dice(d.seed, spec.room, 'stoke', s.n)() < STOKE.burn[s.n]) return end(true);
    s.n += 1;
    return s.n >= STOKE.burn.length ? end(false) : { ok: true, pick: true, name: s.name, stokes: s.n };
  }
  // Victor's Abomination: pick a first Item (`fuseA`), a second (`fuseB`), then `fuse` (the Stitch button). A fail leaves both in the build, Fragile.
  if (spec.deal === 'fuse' && ['fuseA', 'fuseB', 'fuse'].includes(action)) {
    if (action === 'fuseA') {
      if (!fuseables(d).includes(name)) return { error: 'item' };
      d.fusePick = { a: name };
      return { ok: true, pick: true, name };
    }
    const a = d.fusePick?.a;
    if (!a || !fuseables(d).includes(a)) return { error: 'item' };
    if (action === 'fuseB') {
      if (name === a || !fuseables(d).includes(name)) return { error: 'item' };
      d.fusePick.b = name;
      return { ok: true, pick: true, name };
    }
    const b = d.fusePick.b;
    if (!b || b === a || !fuseables(d).includes(b)) return { error: 'item' };
    delete d.fusePick;
    const success = dice(d.seed, spec.room, 'fuse')() < fuseChance(a, b);
    if (success) (d.fused ??= []).push([a, b]);
    else for (const n of [a, b]) if (!fragileOf(d).includes(n)) (d.fragile ??= []).push(n);
    passed({ action: 'fuse', a, b, success, mood: success ? 'gloat' : 'critical', reveal: true });
    return { ok: true, action: 'fuse', a, b, success };
  }
  // Paradox's Time Capsule: seal an Item; it returns before the floor ends (a random room after this one, the boss's at the latest).
  if (action === 'capsule' && spec.deal === 'capsule') {
    if (!capsulables(d).includes(name)) return { error: 'item' };
    const legendary = name === d.legendary;
    const bossRoom = floorOf(spec.room) * ROOMS_PER_FLOOR;
    const back = spec.room + 1 + Math.floor(dice(d.seed, spec.room, 'capsule')() * (bossRoom - spec.room));
    const c = { item: name, from: spec.room, back, ...(legendary && { legendary: true }) };
    if (legendary) delete d.legendary;
    else {
      const slot = SLOTS.find((s) => d.items[s].includes(name));
      d.items[slot].splice(d.items[slot].indexOf(name), 1);
      c.slot = slot;
      if (!held(d).includes(name)) { // the last copy: its state goes in with it
        c.enhanced = (d.enhanced ?? []).includes(name);
        c.fragile = fragileOf(d).includes(name);
        c.corrupted = corruptedOf(d).find((x) => x.name === name) ?? null;
        d.enhanced = (d.enhanced ?? []).filter((n) => n !== name);
        d.fragile = fragileOf(d).filter((n) => n !== name);
        if (d.corrupted) d.corrupted = corruptedOf(d).filter((x) => x.name !== name);
      }
    }
    d.capsule = c;
    passed({ name, legendary });
    return { ok: true, action, name, legendary };
  }
  if (action === 'travel' && spec.deal === 'travel') {
    if (d.urn) return { error: 'carrying' };
    if (!travelKinds(d, spec.room).includes(name)) return { error: 'item' };
    if (d.v >= 8) d.extraDoor = { room: spec.room + 1, kind: name }; // a door run: one more door, not the only way
    else d.teleported = { room: spec.room + 1, kind: name };
    passed({ kind: name, ...(d.extraDoor ? { door: true } : {}) });
    return { ok: true, action, kind: name, ...(d.extraDoor ? { door: true } : {}) };
  }
  // Rem's Lil Helper: feed it one of your Items to take it (the Item is given up).
  if (action === 'helper' && spec.deal === 'helper') {
    if (helperOf(d) || !loose(d).includes(name)) return { error: 'item' };
    const h = {};
    addFeed(h, name);
    dropItem(d, name);
    lend(d, 'helper', h);
    passed({ name });
    return { ok: true, action, name };
  }
  // Dynamo's Lesson: pick the kind of enemy to study; he grades the hero by the health it has kept, and the grade sets the lesson's strength for the next floor.
  if (action === 'lesson' && spec.deal === 'lesson') {
    if (d.lesson || !lessonKinds(spec.room).includes(name)) return { error: 'item' };
    const grade = gradeOf(d);
    d.lesson = { floor: floorOf(spec.room) + 1, kind: name, grade: grade.letter, power: grade.power };
    passed({ kind: name, grade: grade.letter, power: grade.power, floor: floorOf(spec.room) + 1, mood: grade.power >= 0.28 ? 'gloat' : grade.power <= 0.12 ? 'critical' : null, reveal: true });
    return { ok: true, action, kind: name, grade: grade.letter, power: grade.power };
  }
  if (action === 'turret' && spec.deal === 'turret') {
    if (!parts(d).includes(name)) return { error: 'item' };
    dropItem(d, name);
    lend(d, 'turret', { floor: spec.floor, tier: Math.min(2, itemByName(name).Tier) });
    passed({ name });
    return { ok: true, action, name };
  }
  if (action === 'castling' && spec.deal === 'castling') {
    const choices = castleables(d).includes(name) ? castleChoices(d, name) : [];
    if (!choices.length) return { error: 'item' };
    dropItem(d, name);
    passed({ name });
    d.offer = { kind: 'items', choices, enhanced: [], room: spec.room, roll: 0, castling: name }; // the 3 are the pick, like the Dealer's swap
    return { ok: true, action, name, choices };
  }
  return { error: 'none' };
}
// Violet copies `name` (an exact replica: the same state), giving up `replace` for it on a full build; a fail ruins the original.
function replicate(d, spec, name, replace) {
  delete d.replicaPick;
  const success = dice(d.seed, spec.room, 'replica')() < replicaChance(name);
  if (success) {
    if (replace) giveUp(d, replace);
    const corruption = corruptedOf(d).find((c) => c.name === name);
    d.items[SLOT_OF[itemByName(name).Slot]].push(name);
    (d.replicas ??= []).push(name); // her copy is painted on the Hero card (paintSplash.js); a copy that leaves is the first one (dropItem)
    if (corruption) d.corrupted = [...corruptedOf(d), { ...corruption }];
  } else dropItem(d, name);
  // reveal: her result gets a screen of its own before the pick, cleared by its Continue button (`seen`)
  passEvent(d, { action: 'replica', hero: spec.hero, deal: spec.deal, name, success, ...(success && replace ? { replaced: plain(replace) } : {}), mood: success ? 'gloat' : 'critical', reveal: true });
  return { ok: true, action: 'replica', name, success, replaced: success ? plain(replace) : null };
}
function walkAway(d) { d.health = Math.max(0.05, d.health - rules(d).walkCost); d.room += 1; }
// The Broker's stall: the held items he can corrupt (tier 3 or 4 with a corrupted card; the legendary slot never), and corrupting one for BROKER_COST of
// max health (it must leave the hero standing). Returns { ok, name, drawback, amount, lost } or { error: 'none' | 'item' | 'health' }.
const corruptibles = (d) => [...new Set(SLOTS.flatMap((s) => d.items[s]))].filter((n) => corruptible(itemByName(n)) && !corruptedOf(d).some((c) => c.name === n) && !fragileOf(d).includes(n)); // a Fragile Item is mended, never corrupted
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
// Fragile Items: at a stall, a hero holding no tier 3 or 4 item (and no Fragile Item yet) is forced to take a random one (room left for it
// always: stalls start at room 6). A later stall mends it into an Enhanced item for free, and the hero stays to deal again (corrupt something, or Leave).
const fragileDue = (d) => specOf(d).kind === 'broker' && !fragileOf(d).length && !SLOTS.some((s) => d.items[s].some((n) => itemByName(n).Tier >= 3)) && slotsUsed(d) < rules(d).maxItems;
// The item this stall's Broker will hand over (fixed by the seed, so the stall screen can show it before it is taken).
// Only tier 3 or 4 (so it is worth taking), any kind, nothing the hero holds or holds part of.
function fragileGift(d) {
  const rng = dice(d.seed, d.room, 'fragile');
  const owned = SLOTS.flatMap((s) => d.items[s]);
  const pool = SLOTS.flatMap((s) => POOL[s]).filter((n) => itemByName(n).Tier >= 3 && canBuy(d.hero, n) && !NO_RUN_ITEMS.has(n) && !owned.includes(n) && !heldIn(n, d.items));
  return pool.length ? pick(pool, rng) : null;
}
function takeFragile(d) {
  if (d.phase !== 'ready' || !fragileDue(d)) return { error: 'none' };
  const name = fragileGift(d);
  if (!name) return { error: 'none' };
  const added = addItem(d, name);
  if (added.error) return added;
  (d.fragile ??= []).push(name);
  d.room += 1;
  beginImbues(d, [name]);
  return { ok: true, name, used: added.used };
}
function mendFragile(d) {
  const name = fragileOf(d)[0];
  if (d.phase !== 'ready' || specOf(d).kind !== 'broker' || !name) return { error: 'none' };
  d.fragile = fragileOf(d).filter((n) => n !== name);
  if (!(d.enhanced ??= []).includes(name)) d.enhanced.push(name);
  return { ok: true, name };
}
function newRun(hero, seed, ascension = 0) {
  const r = rules({ ascension });
  // (DESCEND_V=7: a run on the fixed rooms from before Two Doors, for the tests of those rooms and for the sims to compare)
  return { v: Number(process.env.DESCEND_V) || VERSION, hero, seed, ascension, room: 1, level: 0, tiers: {}, items: { weapon: [], vitality: [], spirit: [] }, legendary: null, enhanced: [], fragile: [], enhancedChance: r.enhanced, rerolls: r.rerolls, buffs: {}, bridge: [], find: null, rejuvs: 0, health: r.startHealth, kept: {}, imbues: {}, offer: null, phase: 'ready' };
}

// Runs started before the Oct 29 ascensions and floors (no `v`) finish on the old rules: descentLegacy.js is this file as it was then. Everything outside this file reaches a run through RUN, which sends an old run (and its rooms, `legacy` on the spec) there.
// delete descentLegacy.js, `legacy` and RUN's wrappers once no saved run lacks `v`.
const VERSION = 9; // 9: Billy's Smash and Grab; 8: Two Doors; 7: hero rooms are spaced against hero rooms only, never the same outcome three times in a row; 6: Ivy's Rescue; 3: event rooms; 4: hero rooms and the Rift; 5: a kind that just came is less likely next (`specials`)
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

// The run log (descentLog.js): `d` is the run, `event` and `data` what happened.
const log = (d, event, data) => descentLog.record({ TUNE, ASC, BOSS, RIVAL, TIER_WEIGHTS }, d, event, data);

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
// The member's run counters for /descend stats (counted from then on): descentStats = { runs, deaths, abandoned, rooms, bosses,
// rivals, events, killedBy: { <what>: n } }.
function bump(r, key, n = 1) {
  const s = (r.descentStats ??= {});
  s[key] = (s[key] ?? 0) + n;
}
// What ended a run, for the counters: the boss, the rival, or the enemy that dealt the fatal room's most damage (its group name, no number).
function killerOf(spec, run) {
  if (spec.kind === 'boss' && !spec.final) return BOSSES[spec.boss].name;
  if (spec.kind === 'rival') return spec.rival;
  const top = [...(run.taken ?? [])].sort((a, b) => b.dealt - a.dealt)[0];
  return top ? top.name.replace(/\s+\d+$/, '').replace(/^\[[^\]]+\]\s*/, '') : roomLine(spec);
}
// Starts a run with one of the member's unlocked heroes at an ascension they unlocked (fixed for the run).
// Returns { ok } or { error: 'running' | 'locked' | 'ascension' }.
const startRun = (userId, hero, seed = Math.floor(Math.random() * 2 ** 31), ascension = 0) => updateFarmUser(userId, (r) => {
  if (r.descent) return { error: 'running' };
  if (!hasHero(r, hero)) return { error: 'locked' };
  if (!(Number.isInteger(ascension) && ascension >= 0 && ascension <= ascensionOf(r))) return { error: 'ascension' };
  r.descent = newRun(hero, seed, ascension);
  bump(r, 'runs');
  r.descent.rebirth = rankOf(heroOf(r, hero).rebirth); // the hero's Rebirth rank, fixed for the run (a clear that raises it ends the run)
  log(r.descent, 'start', {});
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
    if (NO_FIGHT.has(RUN.specOf(d).kind)) return { error: RUN.specOf(d).kind }; // a stall or an event room has no fight
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
    if (!run.won && spec.kind === 'rift') { // the Rift lost: the hero flees and the run goes on
      fleeRift(d, run);
      run.fled = true;
      noteBest(r, d);
      run.next = structuredClone(d);
      return;
    }
    if (!run.won && canRescue(d, spec)) { // Ivy's Rescue: the run goes on, back at a Rest Stop
      run.rescued = rescue(d, run);
      run.next = structuredClone(d);
      return;
    }
    if (!run.won) { // the run is over: what it reached stays as the best
      bump(r, 'deaths');
      const killer = killerOf(spec, run);
      r.descentStats.killedBy = { ...r.descentStats.killedBy, [killer]: (r.descentStats.killedBy?.[killer] ?? 0) + 1 };
      run.over = { ...d, room: spec.room };
      noteBest(r, run.over);
      run.best = r.bestDescent;
      delete r.descent;
      return;
    }
    RUN.afterWin(d, run);
    bump(r, 'rooms');
    if (spec.kind === 'boss') bump(r, 'bosses');
    if (spec.kind === 'rival') bump(r, 'rivals');
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
      const reborn = noteRebirth(r, d.hero, a); // Rebirth: { from, to } | { locked } | null
      run.complete = { ...run.next, clears: r.descentClears, ...(reborn ? { reborn } : {}), ...(unlocked ? { unlocked } : {}), ...(run.ascensionToken ? { token: true } : {}) };
      delete r.descent;
    }
  });
  if (run.won) await track(userId, 'descend'); // quests
  log(claim.d, 'fight', descentLog.fightData(claim.d, spec, run));
  if (!run.won && !run.fled && !run.rescued) log(claim.d, 'end', { result: 'died', rooms: spec.room - 1, room: spec.room });
  else if (run.complete) log(claim.d, 'end', { result: 'cleared', rooms: spec.room });
  return { run };
}

// Walk Away from a rival: past the room with nothing gained (from Ascension 3 it costs health). Returns { ok, lost (share of max health) } or { error: 'none' }.
const walkPast = (userId) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  const kind = d && d.phase === 'ready' ? RUN.specOf(d).kind : null;
  if (kind !== 'rival' && kind !== 'broker') return { error: 'none' };
  const before = d.health;
  if (!legacy(d)) roomPassed(d, d.room);
  if (kind === 'broker') d.room += 1; // leaving a stall is free
  else RUN.walkAway(d);
  noteBest(r, d);
  log(d, 'walk', { room: d.room - 1, kind, lost: +(before - d.health).toFixed(3), hpOut: +d.health.toFixed(3) });
  return { ok: true, lost: before - d.health, kind };
});
// Take a door (VERSION 8), for room `room` (an old message's button can't act on a later room). Returns { ok, spec } or { error: 'none' }.
const door = (userId, room, index) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || legacy(d) || d.room !== room) return { error: 'none' };
  const result = chooseDoor(d, index);
  if (result.ok) log(d, 'door', { room, index, kind: result.spec.kind, ...(result.spec.mystery ? { mystery: true } : {}) });
  return result;
});
// Step back through the Doorman's Doorway, from the screen of room `room`. Returns { ok, spec } or { error: 'none' }.
const backThrough = (userId, room, index) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || legacy(d) || d.room !== room) return { error: 'none' };
  const result = stepBack(d, index);
  if (result.ok) log(d, 'door', { room: d.room, index, kind: result.spec.kind, doorway: true });
  return result;
});
// An event room's choice, for room `room` (an old message's button can't act on a later room): 'rest' / 'tinker' (with `name`) / 'break'.
const eventChoice = (userId, room, action, name) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || legacy(d) || d.room !== room) return { error: 'none' };
  const result = eventAct(d, action, name);
  if (result.ok) { log(d, 'event', { room, action, ...(name && { item: name }), ...result, hpOut: +d.health.toFixed(3) }); noteBest(r, d); if (action !== 'step') { bump(r, 'events'); bump(r, 'rooms'); } }
  return result;
});
// The Continue button under an event's result screen (Violet's replica): on to the pick.
const seen = (userId, room) => updateFarmUser(userId, (r) => {
  const ev = r.descent?.event;
  if (ev?.room !== room || !ev.reveal) return { error: 'none' };
  delete ev.reveal;
  return { ok: true };
});
// The Continue button under the Buff window that follows a pick.
const seenFind = (userId) => updateFarmUser(userId, (r) => {
  if (!r.descent?.finding) return { error: 'none' };
  delete r.descent.finding;
  return { ok: true };
});
// Corrupts item `name` at the Broker's stall of room `room` (an old message's button can't corrupt a later stall).
const visitBroker = (userId, room, name) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.room !== room) return { error: 'none' };
  const result = corrupt(d, name);
  log(d, 'broker', { room, action: 'corrupt', item: name, ok: !!result.ok, hp: +d.health.toFixed(3) });
  if (result.ok) noteBest(r, d);
  return result;
});
// The Broker's other two deals at the stall of room `room`: 'take' the Fragile Item he forces on you, 'mend' the one you carry.
const dealBroker = (userId, room, action) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.room !== room) return { error: 'none' };
  const result = action === 'take' ? takeFragile(d) : mendFragile(d);
  log(d, 'broker', { room, action, ok: !!result.ok });
  if (result.ok) noteBest(r, d);
  return result;
});
// Takes choice `index` of the offer made for room `room` (an old message's buttons can't take a later offer).
// A pick, skip or reroll of the offer made for room `room` (an old message's buttons can't act on a later offer); the offer and what was done with it are logged.
const onOffer = (userId, room, how, act, extra = {}) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (d?.offer?.room !== room) return { error: 'none' };
  const offer = structuredClone(d.offer);
  const out = act(d);
  if (!out?.error) log(d, 'pick', { room, how, ...extra, offer, hp: +d.health.toFixed(3) });
  return out;
});
const takeEverything = (userId, room, drop = []) => onOffer(userId, room, 'smash', (d) => takeAll(d, drop), { drop });
const choose = (userId, room, index, replace = null) => onOffer(userId, room, 'take', (d) => RUN.takeChoice(d, index, replace), { index, ...(replace ? { replace } : {}) });
const skip = (userId, room) => onOffer(userId, room, 'skip', (d) => RUN.skipChoice(d));
const recruit = (userId, room) => onOffer(userId, room, 'recruit', (d) => recruitDefeated(d));
const feed = (userId, room, index) => onOffer(userId, room, 'feed', (d) => feedOffer(d, index), { index });
const reroll = (userId, room) => onOffer(userId, room, 'reroll', (d) => RUN.rerollChoice(d));
const spend = (userId, slot) => updateFarmUser(userId, (r) => (r.descent ? RUN.spendPoint(r.descent, slot) : { error: 'none' }));
const imbue = (userId, slot) => updateFarmUser(userId, (r) => (r.descent ? RUN.setImbue(r.descent, slot) : { error: 'none' }));
const takeBonusItem = (userId, replace) => updateFarmUser(userId, (r) => {
  if (!r.descent) return { error: 'none' };
  const out = RUN.takeBonus(r.descent, replace);
  if (!out?.error) log(r.descent, 'pick', { room: r.descent.room - 1, how: 'rival-item', ...(replace ? { replace } : {}), hp: +r.descent.health.toFixed(3) });
  return out;
});
// Ends the run where it stands (a run waits as long as the member likes, and Abandon ends it). Returns the run or null.
const abandon = (userId) => updateFarmUser(userId, (r) => {
  const d = r.descent;
  if (!d || d.phase === 'fighting') return null;
  noteBest(r, d);
  bump(r, 'abandoned');
  log(d, 'end', { result: 'abandoned', rooms: d.room - 1, room: d.room, build: descentLog.build(d) });
  delete r.descent;
  return d;
});

// The server's best runs, the highest ascension first, then the deepest, then the most clears: [{ id, rooms, hero, ascension, clears }].
async function leaderboard() {
  const all = await getStore('farm').all();
  return Object.entries(all).filter(([, r]) => r?.bestDescent?.rooms).map(([id, r]) => ({ id, ...r.bestDescent, ascension: r.bestDescent.ascension ?? 0, clears: r.descentClears ?? 0, ...(r.heroes?.[r.bestDescent.hero]?.rebirth >= FIRST ? { rebirth: rankOf(r.heroes[r.bestDescent.hero].rebirth) } : {}) }))
    .sort((a, b) => b.ascension - a.ascension || b.rooms - a.rooms || b.clears - a.clears);
}

module.exports = {
  REPLICA,
  MAX_ASCENSION, ASC, ASCENSIONS, affixTag, ascensionOf, PATRON_WAVES,
  ROOMS_PER_FLOOR, FLOORS, LAST_ROOM, TOKEN_ROOM, SKIP_HEAL, SKIP_BUFFS, LEGEND_SKIP_BUFFS, BOSS_BUFFS, LITTLE_BUFF_CHANCE, BIG_BUFF_CHANCE, REROLLS_PER_FLOOR, ENHANCED_CHANCE, ENHANCED_STEP, REST, MEDIC_PACK, DEBUFFS, TUNE, OUTPUT_FLOOR, TUNING, tuningOf, BOSS, RIVAL, ARCHETYPES, AFFIXES, BOSSES, TIER_WEIGHTS, NO_RUN_ITEMS, NO_RUN_LEGENDARIES,
  dice, power, floorOf, roomSpec, bossFor, newRun, legacy, escorted, FLOOR_ENEMIES, FLOOR_NAMES, FAMILIES, groupName, groupText, groupSpecial, groupPicture, ...RUN,
  VISITS, floorBoss, HARROW, RAT, VENOM_ROOMS, BURROW_MIN, buffTotal, STOKE, stokeables, GHOUL_COST, UPGRADE_COST, EVENT_REPEAT, specials, heldDeals, REPLICA_CHANCE, MCGINNIS_CHANCE, ASSISTANT, MINIONS, RIFT, visitOf, riftRivals, replicables, replicaChance, workables, upgradeables, fuseables, fuseChance, FUSE_CHANCE, fusedOf, slotsUsed, fusedParts, dropItem, CAPSULE, capsulables, hasCooldown, roomPassed, travelKinds, HELPER, helperOf, helperAura, feedOffer, feed, GRADES, gradeOf, lessonKinds, lessonNow, kindName, upgradesOf, mcginnisChance, parts, castleables, castleChoices, fleeRift, minionUnits, afterMinions,
  RESCUE, canRescue, rescue, DOORS, DOOR, OWN_DOORS, MYSTERY, doorsOf, chooseDoor, door, doorwayOpen, stepBack, backThrough, VERSION, EVENT_KINDS, EVENT_CHANCE, REST_HEAL, TINKER_CHANCE, BREATHER_HEAL, NO_FIGHT, eventRooms, tinkerables, restStop, breakCrates, eventChoice, eventAct, seen, seenFind, recruitDefeated,
  URN_ROOMS, URN_BUFFS, ALLY_FIGHTS, ALLY_HEALTH, allyHealth, rivalHealth, rivalLevels, BLESSING, PATRON_GIFTS, EMPOWER, TELEPORT_TO, PATRONS, patronOf, otherPatron, dealerItems, swapChoices,
  BROKER_COST, BROKER_FROM, BROKER_MAX, FRAGILE_BREAK, corruptibles, corruptedOf, corrupt, visitBroker, fragileOf, fragileDue, fragileGift, takeFragile, mendFragile, dealBroker,
  startRun, getRun, fight, walkPast, choose, takeEverything, takeAll, smashOpen, smashNeed, skip, recruit, reroll, spend, imbue, takeBonusItem, abandon, leaderboard,
};
