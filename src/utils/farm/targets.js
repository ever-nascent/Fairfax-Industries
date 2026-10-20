// Hero Farming (/base, /jungle, /lane, /siege): what a hero can farm (his list and timings, Oct 1). Wiki numbers are read from assets/farm/npcs.json
// (`npm run farm-data`); camp makeups, Mid-Boss rewards and the Patron's beam are from the wiki pages (Haunts,
// Crates, Sinner's Sacrifice, Mid-Boss, Shrine, Patron, Base Guardian), copied here. Rules: server-plan.md ("Hero Farming").
//
// How it limits itself (his call): no daily cap. Each target has a per-member `cooldown` (seconds between attempts), and
// the real blocker is dying: an attempt that fails leaves the target at full health, so a build that can't clear it
// without dying gets nothing. A target is `{ name, cooldown, souls, enemies(), rejuv? }`; `souls` is the wiki's worth.
//   Tier 1 camp 1 h, Tier 2 camp 3 h, Tier 3 camp 6 h, each lane's Guardian 12 h and Walker 24 h (LANES below), the base siege 1 day.
//   `/jungle roam` is its own thing (roam.js): every 30 minutes, a haul of Crates, Sinner's Sacrifices and buffs. The Mid-Boss is once every 12 hours.
// The base siege (`siege()`) is one continuous run: Base Guardians, both Shrines, the Patron and the weakened Patron, with
// the hero's health carried through. One death and it all restarts (nothing is paid, nothing is kept).
// The Mid-Boss doesn't revive anyone: a hero who dies against it stays dead. Killing it drops a Rejuv (`rejuv: 1`), which
// the member keeps and spends later to get back up once, e.g. in the siege.
//
// Payout: PAYOUT_SCALE x the wiki's souls (a match is 30-40 minutes, so the wiki's amounts are too rich for a server
// where /urn pays 1,000-2,200 a day and Shop prices are 8,000-64,000). The Mid-Boss and the siege pay double that (HARD_PAY).
const path = require('node:path');
const { ASSETS } = require('../art');
const { Fight, enemy } = require('./engine');
const { SCALE } = require('../economy');

const { npcs, objectives } = require(path.join(ASSETS, 'farm', 'npcs.json'));
const ICONS = path.join(ASSETS, 'farm', 'icons'); // wiki icons, `npm run farm-data` (credits: assets/CREDITS.txt)
const PAYOUT_SCALE = 0.05 * SCALE; // 50% of the wiki's souls at SCALE 10 (the wiki's amounts are for a 30-40 minute match)
const HOUR = 3600;
// The Mid-Boss and the siege pay double the wiki's worth (his call, Oct 2: the hardest targets paid less per hour than the Walker).
const HARD_PAY = 2;
const pct = (x) => (x || 0) / 100;

// ponytail: placeholder damage numbers, the wiki's NpcData has no plain DPS for creeps or Crates (their attacks are
// abilities). Replace with real numbers when we flesh those targets out.
const creep = (key, name, dps) => () => {
  const n = npcs[key];
  const mods = n.IntrinsicModifiers[0];
  return enemy(name, {
    maxHealth: n.MaxHealth, dps, distance: 10, souls: n.GoldReward,
    bulletResist: pct(mods.BULLET_DAMAGE_REDUCTION_PERCENT), spiritResist: pct(mods.ABILITY_DAMAGE_REDUCTION_PERCENT),
  });
};
const small = creep('neutral_trooper_weak', 'Small Haunt', 6);
const medium = creep('neutral_trooper_normal', 'Medium Haunt', 12);
const large = creep('neutral_trooper_strong', 'Large Haunt', 25);
const camp = (...makers) => () => makers.map((m) => m());
const soulsOf = (key) => npcs[key].GoldReward;

// A boss or structure: one enemy with the wiki's health, bullet resist and damage per second. `soloResist` is the
// enemy-scaling bullet resist of base structures (starts at `extra`, loses `perHero` for each hero nearby; one hero here).
const resistWith = (base, extra) => 1 - (1 - base) * (1 - extra); // resists multiply, they don't add
// Bosses resist every kind of damage (his call, Oct 2: a stack of one kind of item shouldn't walk through them): the wiki gives bullet resists, and spirit
// resists mostly 0, so these fill the gaps. `cc` is how much of a stun / sleep / disarm it shrugs off (1 = immune, engine.js addStatus).
// ponytail: all placeholders, in one table.
// What each enemy's attack is (the wiki, checked Oct 2 2026): Haunts' basic attacks, both Guardians and the Mid-Boss deal weapon damage (bullet resist);
// every Walker attack is spirit damage (spirit resist), and so is the beam that defends the Shrines. The Patron and the weakened Patron (his calls,
// Oct 3, from the game) deal half weapon and half spirit damage, and a blast of true damage (no resist helps) curses the hero at the Shrines and at
// the weakened Patron.
const BOSS_RESISTS = {
  npc_boss_tier1: { spirit: 0.25, cc: 0.5 }, npc_boss_tier2: { spirit: 0.35, cc: 0.5 }, npc_super_neutral: { spirit: 0.3, bullet: 0.1, cc: 0.75 },
  npc_barrack_boss: { spirit: 0.3, cc: 0.5 }, destroyable_building: { spirit: 0.4, cc: 1 }, npc_boss_tier3: { spirit: 0.35, bullet: 0.2, cc: 0.75 },
};
const boss = (key, name, { health, dps, regen = 0, dpsMaxHealthPct = 0, extraResist = 0, damageType = 'bullet', blast = null }) => () => {
  const n = npcs[key];
  const mods = n.IntrinsicModifiers?.[0] || {};
  const r = BOSS_RESISTS[key] ?? {};
  const e = enemy(name, {
    maxHealth: health ?? n.MaxHealth, dps, dpsMaxHealthPct, damageType, blast, distance: 20, healthRegen: regen,
    bulletResist: resistWith(resistWith(pct(mods.BULLET_ARMOR_DAMAGE_RESIST), extraResist), r.bullet || 0),
    spiritResist: resistWith(pct(mods.ABILITY_DAMAGE_REDUCTION_PERCENT), r.spirit || 0),
  });
  e.stats.ccResist = r.cc || 0;
  return [e];
};

const baseGuardianResist = () => {
  const m = npcs.npc_barrack_boss.BackdoorBulletResistModifier;
  return pct(m.BulletResist - m.BulletResistReductionPerHero); // one hero nearby
};
const shrineResist = () => {
  const m = npcs.destroyable_building.BackdoorBulletResistModifier;
  return pct(m.BulletResist - m.BulletResistReductionPerHero);
};

// How hard each target hits, as a share of the wiki-based damage numbers below (his call, Oct 2: a fully kitted hero must be able to siege the
// base, and each target opens up as the hero levels). Found by simulation (`node tools/farm-sim.js tune`): the multiplier at which Haze, with the kit a member
// would have at that point (level 0 / 6 / 12 / 18 / 24 / 28 / 35, abilities and tiers spent in order, 0-12 items, 0-24 permanent buffs, 3 Rejuvs
// for the siege, items picked at random) clears the target 55% of the time. Other heroes use the same numbers and may find them easier (his call, Oct 2). Re-run the
// tuning if hero levels, items or enemy numbers change.
const HARDNESS = { 'small-camp': 1, 'medium-camp': 2.724, 'large-camp': 0.687, guardian: 0.405, walker: 0.415, 'mid-boss': 0.667, siege: 0.265 }; // Oct 3 (late): retuned for every item in fights, melee, dashes and once-a-second enemy hits; Oct 2 (evening): Silencer left the shop (retired in the game); all retuned Oct 3 for ability range, dodging, the Walker's stomp and the 9 items they brought into the shop // Oct 2: `farm-sim.js tune` with Haze, 120 fights per number, typical kits win 55%
// A failed attempt takes one clear back off (his call, Oct 2, play.js), so a target settles at a size the member can still beat instead of locking them out
// (simulated: a typical kit of the target's own level settles at 1-4 clears, winning a quarter to half of its attempts).
// Every target grows each time a member clears it, up to a cap (his call, Oct 2: enemies scale on their own, not with the hero): more health, damage and
// regen, a little more bullet and spirit resist, and a little more souls. ponytail: +2-4% per clear (GROWTH), +0.3% resist per clear and +5% souls are
// placeholders (win rate falls off a cliff past a point, resists matter more than health). Simulated (`farm-sim.js growth`): at 10 clears a typical kit of the
// target's own level wins only 4-33% of the time (which is why a loss shrinks it back), and the next stage's kit still wins almost always.
const CLEAR_CAP = 10;
// health, damage and regen added per clear, by target (tuned by simulation, see the note above)
const GROWTH = { 'small-camp': 0.03, 'medium-camp': 0.02, 'large-camp': 0.02, guardian: 0.02, walker: 0.03, 'mid-boss': 0.04, siege: 0.04 };
const CLEAR_RESIST = 0.003;
const CLEAR_SOULS = 0.05;
const clearsOf = (n = 0) => Math.min(CLEAR_CAP, Math.max(0, n || 0));
const clearPower = (n, key) => 1 + (GROWTH[key] ?? 0.05) * clearsOf(n); // health, damage, regen
const clearSouls = (n) => 1 + CLEAR_SOULS * clearsOf(n);
function strengthen(e, n, key) {
  const k = clearPower(n, key);
  e.stats.maxHealth *= k;
  e.health = e.stats.maxHealth;
  e.stats.dps *= k;
  e.stats.healthRegen *= k;
  e.stats.bulletResist = Math.min(0.9, e.stats.bulletResist + CLEAR_RESIST * clearsOf(n));
  e.stats.spiritResist = Math.min(0.9, e.stats.spiritResist + CLEAR_RESIST * clearsOf(n));
  return e;
}
const scaled = (factor, make) => () => make().map((e) => {
  e.stats.dps *= factor;
  e.stats.dpsMaxHealthPct *= factor;
  if (e.stats.blast) { e.stats.blast.damage *= factor; e.stats.blast.maxHealthPct *= factor; }
  return e;
});

// The three lanes, named like their in-game signs (his picture, Oct 3: York, Broadway, Park; the wiki calls the green one Greenwich and notes the game's
// zipline signs still say Park). Each has its badge in assets/farm/icons/lane-<key>.png, cut from that picture. His calls, Oct 3: each lane has its own Guardian and Walker. A Guardian that is
// beaten stays down for its cooldown (12 h); a Walker can only be fought while its own lane's Guardian is down, and stays down 24 h; the siege only
// opens while all three Walkers are down. Nothing comes back early (not even after a siege win), so a day still holds 6 Guardian and 3 Walker
// kills, the same souls as when there was one of each on 4 h / 8 h. All Guardians are alike (the wiki: their health never changes); a Walker
// has WALKER_STEP more health for every other Walker that is down (the wiki: 6000 / 9000 / 12000). The rules are in play.js.
const LANES = { york: { name: 'York', color: 'Yellow' }, broadway: { name: 'Broadway', color: 'Blue' }, park: { name: 'Park', color: 'Green' } };
for (const [key, lane] of Object.entries(LANES)) lane.icon = path.join(ICONS, `lane-${key}.png`);
const LANED = new Set(['guardian', 'walker']); // the targets that exist once per lane
const WALKER_STEP = 3000;

// Waves (`/lane wave`, his calls Oct 3): an endless run down one lane, once a day per lane. Wave after wave of lane troopers, each wave a little
// stronger than the last, until the hero falls; every wave cleared pays (nothing is lost on falling), and health carries from wave to wave.
// Wiki facts used (Data:NpcData.json): a ranged trooper has 300 health, a medic 350, a melee one 400, each deals 28 a second to a hero and takes
// 25% more damage from heroes (VSPlayer); a wave is 3 ranged + 1 medic for the first 5 minutes (10 waves at one every 30 s), then 2 ranged +
// 1 melee + 1 medic. ponytail: the medic's healing isn't simulated (it is one more trooper).
// ponytail: WAVE (stronger per wave, their damage, the breather) and the pay are placeholders tuned with `node tools/farm-sim.js waves`: the pay is small on purpose
// (about 100 for the first wave, +8.5 a wave: 1,400 for 10 waves, 2,400 for 15), so three good runs a day add about what the three Walkers do.
// growth: how much more health and damage each wave has than the one before; hardness: their damage, as a share of the wiki's 28 a second (in a match the
// lane's own troopers take most of it); rest: the share of max health the hero gets back between two waves (a breather; no wave timer here).
// Tuned Oct 3 with Haze: typical kits clear about 2 / 5 / 10 / 15 waves at level 0 / 12 / 24 / 35 (Abrams a wave or two more).
const WAVE = { growth: 0.2, hardness: 0.15, rest: 0.15 };
const WAVE_PAY = 10 * SCALE; // souls for wave 1
const WAVE_PAY_STEP = 0.85 * SCALE; // more for every wave after it
const wavePay = (wave) => Math.round(WAVE_PAY + WAVE_PAY_STEP * (wave - 1));
const wavesPay = (cleared) => Array.from({ length: cleared }, (_, i) => wavePay(i + 1)).reduce((a, b) => a + b, 0);
const TROOPER_SOULS = 100; // the wiki: a trooper is worth 100 souls (server-plan.md, waves); NpcData has no number for them
const trooper = (key, name) => (wave) => {
  const n = npcs[key];
  const k = (1 + WAVE.growth) ** (wave - 1); // compounding: a kitted hero is many times a fresh one, so a straight line never catches up
  const resist = pct(n.VSPlayer.DamageResist); // -25%: heroes hurt troopers more
  return enemy(name, { maxHealth: n.MaxHealth * k, dps: n.VSPlayer.BaseDPS * WAVE.hardness * k, distance: 15, bulletResist: resist, spiritResist: resist, souls: TROOPER_SOULS });
};
const [ranged, medic, melee] = [trooper('trooper_normal', 'Trooper'), trooper('trooper_medic', 'Medic Trooper'), trooper('trooper_melee', 'Melee Trooper')];
const WAVES = {
  cooldown: 24 * HOUR, early: 10, max: 60, secondsPerWave: 120,
  // wave 1, 2, 3 ... as stages for runStages
  stages: Array.from({ length: 60 }, (_, i) => ({ name: `Wave ${i + 1}`, enemies: () => (i < 10 ? [ranged, ranged, ranged, medic] : [ranged, ranged, melee, medic]).map((make) => make(i + 1)) })),
};

// The Walker's stomp (wiki NpcData: 350 + 15% of max health, a 2 s stun, a 6 s cooldown), spirit damage like all its attacks. A hero can dodge it (engine.js DODGE).
// ponytail: in the game it only reaches heroes within 12 m; the fight has no hero position, so every hero is in reach.
const walkerData = npcs.npc_boss_tier2;
const WALKER_STOMP = { every: walkerData.BoundAbilities.ESlot_Signature_3.AbilityProperties.AbilityCooldown, damage: walkerData.StompDamage, maxHealthPct: walkerData.StompDamageMaxHealthPercent / 100, curse: walkerData.StunDuration, type: 'spirit', what: 'stomp' };
const TARGETS = {
  'small-camp': { name: 'Tier 1 Camp (3 small Haunts)', cooldown: 1 * HOUR, souls: 3 * soulsOf('neutral_trooper_weak'), enemies: scaled(HARDNESS['small-camp'], camp(small, small, small)) },
  // the wiki lists 6 medium makeups; this is its changelog example (2 normal, 3 weak)
  'medium-camp': { name: 'Tier 2 Camp (2 medium + 3 small Haunts)', cooldown: 3 * HOUR, souls: 2 * soulsOf('neutral_trooper_normal') + 3 * soulsOf('neutral_trooper_weak'), enemies: scaled(HARDNESS['medium-camp'], camp(medium, medium, small, small, small)) },
  'large-camp': { name: 'Tier 3 Camp (3 large Haunts)', cooldown: 6 * HOUR, souls: 3 * soulsOf('neutral_trooper_strong'), enemies: scaled(HARDNESS['large-camp'], camp(large, large, large)) },
  guardian: { name: 'Guardian', cooldown: 12 * HOUR, souls: objectives.Tier1GoldKill, enemies: scaled(HARDNESS.guardian, boss('npc_boss_tier1', 'Guardian', { dps: npcs.npc_boss_tier1.PlayerDPS })) },
  // ponytail: base health only; the wiki's 9000 / 12000 are for after other Walkers have fallen
  walker: { name: 'Walker', cooldown: 24 * HOUR, souls: objectives.Tier2GoldKill, enemies: scaled(HARDNESS.walker, boss('npc_boss_tier2', 'Walker', { damageType: 'spirit', blast: WALKER_STOMP, dps: npcs.npc_boss_tier2.BoundAbilities.ESlot_Signature_2.AbilityProperties.DPS })) },
  // Mid-Boss (once every 12 hours, his call Oct 2): 13000 HP (+195 per minute after it spawns, not scaled yet), regenerates 15 HP/s, 3000 souls (+50/min). No revive
  // during the fight; a kill drops a Rejuv (the wiki gives up to 3 credits per kill to a team, 1 for a lone hero here).
  'mid-boss': { name: 'Mid-Boss', cooldown: 12 * HOUR, souls: HARD_PAY * 3000, rejuv: 1, enemies: scaled(HARDNESS['mid-boss'], boss('npc_super_neutral', 'Mid-Boss', { health: npcs.npc_super_neutral.StartingHealth, dps: 100, regen: npcs.npc_super_neutral.IntrinsicModifiers[0].HEALTH_REGEN_PER_SECOND })) },
};

for (const [key, target] of Object.entries(TARGETS)) target.icon = path.join(ICONS, `${key}.png`);

// The base siege, in order. Shrines can't be hurt until a pair of Base Guardians is down, the Patron can't be hurt until
// both Shrines are. Shrines "attack" with the Patron's beam (the wiki: it defends any Shrine under attack, 440 + 5% of the
// target's max health per second); the second Shrine grows to 10000 HP. The weakened Patron: 300 + 20% max health every 4 s.
// ponytail: souls for the Base Guardians are 1000 each (the wiki page says "Total Souls 1000", unclear if per unit or per
// pair), the Patron pays nothing on the wiki and so nothing here; two Base Guardians (one lane's pair) are fought.
const PATRON_BEAM = { dps: 440, dpsMaxHealthPct: 0.05, damageType: 'spirit' }; // as it defends a Shrine; the Patron's own is 'mixed' (below)
// The blast (the wiki's Shrine Defense and Pit Explosion: 300 + 20% of max health): true damage, and it curses.
// The wiki gives no interval and no curse length: every 8 s and 1.5 s cursed are his call (Oct 3); HARDNESS.siege was retuned for them.
const PATRON_BLAST = { every: 8, damage: 300, maxHealthPct: 0.2, curse: 1.5 };
const SIEGE = {
  cooldown: 24 * HOUR,
  stages: [
    { name: 'Base Guardians', icon: 'base-guardian', souls: 2 * objectives.BaseGuardiansGoldKill,
      enemies: () => [0, 1].flatMap(() => boss('npc_barrack_boss', 'Base Guardian', { dps: npcs.npc_barrack_boss.PlayerDPS, extraResist: baseGuardianResist() })()) },
    { name: 'Shrine', icon: 'shrine', souls: objectives.ShrinesGoldKill,
      enemies: boss('destroyable_building', 'Shrine', { health: npcs.destroyable_building.MaxHealthGenerator, ...PATRON_BEAM, blast: PATRON_BLAST, extraResist: shrineResist() }) },
    { name: 'Second Shrine', icon: 'shrine', souls: objectives.ShrinesGoldKill,
      enemies: boss('destroyable_building', 'Second Shrine', { health: npcs.destroyable_building.MaxHealthGeneratorSecond, ...PATRON_BEAM, blast: PATRON_BLAST, extraResist: shrineResist() }) },
    { name: 'Patron', icon: 'patron', souls: 0, enemies: boss('npc_boss_tier3', 'Patron', { ...PATRON_BEAM, damageType: 'mixed', regen: 0 }) },
    { name: 'Weakened Patron', icon: 'patron-weakened', souls: 0, enemies: boss('npc_boss_tier3', 'Weakened Patron', { health: npcs.npc_boss_tier3.Phase2Health, dps: 75, damageType: 'mixed', blast: PATRON_BLAST }) },
  ],
};

for (const stage of SIEGE.stages) {
  stage.icon = path.join(ICONS, `${stage.icon}.png`);
  stage.enemies = scaled(HARDNESS.siege, stage.enemies);
  stage.souls *= HARD_PAY;
}

const payout = (souls) => Math.round(souls * PAYOUT_SCALE);

// Runs `stages` ([{ enemies() }]) in order with one hero; health, cooldowns and the clock carry from stage to stage. Stops at the
// first stage the hero doesn't clear. `watch(fight, stageIndex, phase)` is called at each stage's 'start' and after every 'step'
// (the live message records snapshots with it). Returns { won, stage (how many were cleared), time, fight, timedOut, bonusSouls (what souls items earned, wiki souls) }.
function runStages(hero, stages, { rng, maxSecondsPerStage = 600, watch } = {}) {
  let time = 0;
  let fight;
  let bonusSouls = 0;
  for (const [i, stage] of stages.entries()) {
    fight = new Fight({ heroes: [hero], enemies: stage.enemies(), rng, time });
    watch?.(fight, i, 'start');
    const end = time + maxSecondsPerStage;
    while (fight.time < end && hero.alive && fight.enemies.some((e) => e.alive)) {
      fight.step();
      watch?.(fight, i, 'step');
    }
    time = fight.time;
    bonusSouls += fight.bonusSouls;
    if (fight.enemies.some((e) => e.alive)) return { won: false, stage: i, time, fight, timedOut: hero.alive, bonusSouls };
  }
  return { won: true, stage: stages.length, time, fight, timedOut: false, bonusSouls };
}

// One attempt: `hero` (from buildHero) against a target. Souls are paid only for a win; a lost fight leaves the target
// untouched. `rejuvs` is how many Rejuvs the member may use here (a death uses one: back up at full health after 3 s).
function attempt(hero, key, { maxSeconds = 600, rng, rejuvs = 0 } = {}) {
  const target = TARGETS[key];
  if (!target) throw new Error(`Unknown target: ${key}`);
  hero.rejuvs = rejuvs;
  const out = runStages(hero, [target], { rng, maxSecondsPerStage: maxSeconds });
  return { ...out, heroesAlive: hero.alive ? 1 : 0, souls: out.won ? payout(target.souls) : 0, rejuvsEarned: out.won ? target.rejuv || 0 : 0, rejuvsLeft: hero.rejuvs };
}

// The base siege: every stage in one go with the same hero. Any death, or running out of time, ends it with nothing paid.
// `stage` is how many stages were cleared (so the index of the one the hero fell at).
function siege(hero, { maxSecondsPerStage = 900, rng, rejuvs = 0 } = {}) {
  hero.rejuvs = rejuvs;
  const out = runStages(hero, SIEGE.stages, { rng, maxSecondsPerStage });
  const souls = out.won ? payout(SIEGE.stages.reduce((s, st) => s + st.souls, 0)) : 0;
  return { won: out.won, stage: out.stage, stageName: out.won ? null : SIEGE.stages[out.stage].name, souls, rejuvsLeft: hero.rejuvs };
}

module.exports = { WAVES, WAVE, wavePay, wavesPay, LANES, LANED, WALKER_STEP, CLEAR_CAP, GROWTH, clearsOf, clearPower, clearSouls, strengthen, TARGETS, SIEGE, HARDNESS, PAYOUT_SCALE, payout, runStages, attempt, siege };
