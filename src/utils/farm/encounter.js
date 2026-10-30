// Hero Farming: encounters (his calls, Oct 2-3; server-plan.md "Hero unlocks"). After a won fight a hero the member hasn't unlocked may show
// up; beating it unlocks it. The rival is a full hero (engine.js runs it through a mirrored view of the fight): the member's hero level, as many
// ability points spent at random, an item of the same tier for each of the member's, and the hero's permanent buffs (a fair fight).
// This file is the rules only: who shows up, what it carries, and the duel itself. The member's side (the offer, the unlock) is in play.js.
const { Fight, damageBreakdown, enemyDamage, healBreakdown } = require('./engine');
const { buildHero, roster } = require('./hero');
const { keptAfter } = require('./items');
const { abilityStacks } = require('./ability');
const { TIER_COSTS, MAX_TIER, ITEM_POOL, canBuy } = require('./levels');
const { itemByName } = require('./stats');
const { isWolf } = require('./heroes/silver');
const { pickRandom } = require('../random');
const { rejuvIcon, titleCase } = require('../format');

const ENCOUNTER_CHANCE = 0.05; // per won fight. ponytail: placeholder, his to tune
const DUEL_SECONDS = 120; // a duel nobody has won by then: the rival slips away (counts as lost; costs nothing)
const FRAME_STEPS = 10; // a snapshot every second of fight: duels are short (about 10 s), a trip's 3 s would show two or three
const MAX_FRAMES = 14;

// The hero that shows up after a won fight, or null: one the member hasn't unlocked (`has(name)`), `chance` of the time.
function rollRival(has, rng = Math.random, chance = ENCOUNTER_CHANCE) {
  const strangers = roster().filter((name) => !has(name));
  if (!strangers.length || rng() >= chance) return null;
  return pickRandom(strangers, (n) => Math.floor(rng() * n));
}

// What the rival fights with, rolled around the member's own kit (play.js fightKit, with `points`): same level and permanent buffs, its ability points spent
// at random, and for each of the member's items a random one of the same tier (a legendary counts as tier 4; nothing corrupted).
function rivalKit(kit, rng = Math.random, hero = null) {
  const rnd = (n) => Math.floor(rng() * n);
  const tiers = {};
  let left = kit.points ?? 0;
  for (;;) { // one tier at a time into a random ability that can still take one
    const open = Array.from({ length: kit.unlocked }, (_, i) => i + 1).filter((slot) => (tiers[slot] ?? 0) < MAX_TIER && TIER_COSTS[tiers[slot] ?? 0] <= left);
    if (!open.length) break;
    const slot = pickRandom(open, rnd);
    left -= TIER_COSTS[tiers[slot] ?? 0];
    tiers[slot] = (tiers[slot] ?? 0) + 1;
  }
  const items = [];
  for (const name of kit.items) {
    const tier = Math.min(4, itemByName(name).Tier);
    const choices = ITEM_POOL.filter((n) => itemByName(n).Tier === tier && !items.includes(n) && canBuy(hero, n));
    if (choices.length) items.push(pickRandom(choices, rnd));
  }
  // as many enhanced items as the member has (Descend; the farm has none), on random ones of its own
  const enhanced = [];
  for (let n = Math.min((kit.enhanced ?? []).length, items.length); n > 0; n--) enhanced.push(pickRandom(items.filter((i) => !enhanced.includes(i)), rnd));
  return { boons: kit.boons, unlocked: kit.unlocked, tiers, items, buffs: kit.buffs, ...(enhanced.length && { enhanced }) };
}

// The duel, played at once like a trip (play.js simulate): the member's hero against the rival. Returns a run the fight screens can replay:
//   { encounter: true, hero, rival, won, timedOut, seconds, rejuvsUsed, frames, log: [[seconds, text]] }
// `rejuvs`: the hero's Rejuvs work here like in the siege and are used up (his call, Oct 10); a rival never has any.
function duel(heroName, kit, rivalName, theirs, { rng = Math.random, rejuvs = 0 } = {}) {
  const startKit = { ...kit, kept: { ...kit.kept } }; // the build as the duel started (the breakdown's Your Build)
  const hero = buildHero(heroName, kit);
  hero.rejuvs = rejuvs;
  const rival = buildHero(rivalName, theirs);
  const fight = new Fight({ heroes: [hero], enemies: [rival], rng });
  const log = [];
  const frames = [];
  let seen = 0;
  let asleep = false; // the rival was asleep at some moment since the last snapshot
  let stunned = false; // the same for a stun
  let lastWarp;
  const snapshot = () => ({
    t: fight.time, stage: 0,
    hero: { hp: hero.health, max: hero.stats.maxHealth, respawning: hero.has('rejuv') }, rejuvs: hero.rejuvs,
    enemies: [{ name: rivalName, hp: rival.health, max: rival.stats.maxHealth, asleep: asleep || rival.has('sleep'), stunned: stunned || rival.has('stun'), ...(rivalName === 'Silver' && isWolf(rival) && { wolf: true }) }],
    abilities: hero.abilities.filter((a) => !a.hidden).map((a) => ({ name: a.name, status: a.status(fight) })),
    log: lastWarp && !log.slice(-4).includes(lastWarp) ? [lastWarp, ...log.slice(-3)] : log.slice(-4),
  });
  frames.push(snapshot());
  for (let steps = 1; fight.time < DUEL_SECONDS && hero.alive && rival.alive; steps++) {
    fight.step();
    for (; seen < fight.log.length; seen++) {
      const l = fight.log[seen];
      log.push([l.t, titleCase(l.warped ? `${l.who} warped away from ${l.from}'s ${l.what}` : l.reload ? `${l.who} started reloading` : l.interrupted ? `${l.who}'s ${l.what} was interrupted` : l.ccBlocked ? `${l.who}'s ${l.ccBlocked} blocked ${l.what}` : l.parry ? `${l.who} parried ${l.target}'s Heavy Melee` : l.melee ? `${l.who} landed a ${l.what} on ${l.target}` : `${l.who} used ${l.what === 'Rejuvenated' ? `a ${rejuvIcon()}Rejuv` : l.what}`)]);
      if (l.warped) lastWarp = log.at(-1);
    }
    if (rival.has('sleep')) asleep = true;
    if (rival.has('stun')) stunned = true;
    if (steps % FRAME_STEPS === 0) { frames.push(snapshot()); asleep = false; stunned = false; }
  }
  for (const unit of [rival, hero]) if (!unit.alive) log.push([+fight.time.toFixed(1), titleCase(`${unit.name} went down`)]);
  frames.push(snapshot());
  const keep = frames.length <= MAX_FRAMES ? frames : Array.from({ length: MAX_FRAMES }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (MAX_FRAMES - 1))]);
  return { encounter: true, hero: heroName, rival: rivalName, won: hero.alive && !rival.alive, timedOut: hero.alive && rival.alive, seconds: fight.time, rejuvsUsed: rejuvs - hero.rejuvs, kept: keptAfter(hero), stacks: abilityStacks(hero), frames: keep, log, damage: damageBreakdown(hero, [fight]), taken: enemyDamage([fight]), healing: healBreakdown(hero, [fight]), kit: startKit, theirs };
}

module.exports = { ENCOUNTER_CHANCE, DUEL_SECONDS, rollRival, rivalKit, duel };
