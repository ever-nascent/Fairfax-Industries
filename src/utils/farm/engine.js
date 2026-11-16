// Hero Farming: the fight engine. Fixed 0.1 s steps; heroes shoot, melee, dash, reload and cast their abilities on their own
// (idle farming, nobody steers), enemies hit the first hero they can see. Everything a hero's ability or item can do to the
// fight goes through the Fight methods below (damage, heal, status, cc, at), so ability and item files stay small and the rules
// (resists, lifesteal, evasion, wake-on-damage, healing, crowd control) live in one place. Rules: server-plan.md ("Hero Farming").
const DT = 0.1;
const REJUV_DELAY = 3; // seconds before a Rejuv revive gets up
// Healing is capped so lifesteal, regen and heals can't stack into an unkillable hero (his call, Oct 2): a hero heals from a pool that holds
// HEAL_POOL of its max health and refills at HEAL_RATE of it per second; healing beyond what the pool has is lost. Lifesteal from an NPC is
// weaker too. ponytail: 12% / 25% a second and half strength are placeholders, tuned with the enemy damage (targets.js HARDNESS).
const HEAL_RATE = 0.12;
const HEAL_POOL = 0.25;
const LIFESTEAL_VS_NPC = 0.5; // a hero ability's own lifesteal (Silver, Viscous, Mo & Krill, Infernus) off an NPC
// Bullet and spirit lifesteal (the stats) off a non-hero: the wiki's Lifesteal page (his call, Oct 22)
const BULLET_LIFESTEAL_VS_NPC = 0.6;
const SPIRIT_LIFESTEAL_VS_NPC = 0.4;
const OUT_OF_COMBAT = 5; // seconds without taking damage before out-of-combat regen starts (guess; the wiki doesn't say)
// Enemies hit once a second (the same damage per second as a steady stream), so items that react to a "hit" have one (Oct 3).
const ATTACK_EVERY = 1;
// Melee (his call, Oct 3): the hero heavy-melees the front enemy when it has a reason (wantMelee). The swing takes the gun's time unless it is
// reloading anyway, and afterwards the hero stands close to that enemy for a moment (close-range items count). ponytail: all placeholders.
const MELEE = { every: 1.5, busy: 0.8, closeDistance: 3, closeFor: 3 };
// Movement (his call, Oct 3): the hero dash-jumps whenever it has stamina (the wiki's stamina and recharge), is airborne a moment after each,
// and slides now and then. ponytail: the gap, air time and slide timing are placeholders.
const MOVE = { dashGap: 1, airTime: 1, slideEvery: 6, slideTime: 1, dodge: 1 }; // dodge (his call, Oct 28: stamina helps dodge): a dash-jump makes the next enemy attack or blast within this many seconds miss
// Hero against hero (an encounter's duel; his call, Oct 3: "half damage plus 25% miss"): heroes deal `damage` of their damage to each other and
// `miss` of their gun shots at a hero miss, so a duel lasts about half a minute instead of ten seconds and no pairing is decided before it starts.
// Nothing here touches a fight against NPCs.
const DUEL = {
  damage: 0.5, miss: 0.25,
  parryChance: 0.20, parryWithRebuttal: 0.45,
  // His call: a missed parry locks the defender out for two melee cycles, and
  // a successful one stuns the attacker for the same two cycles.
  parryMissCooldown: MELEE.every * 2, parryStun: MELEE.every * 2,
};
// Shotguns (his call, Oct 3: "shotguns have to have chances for some to miss"): each pellet of a spread shot rolls on its own. Standing close
// (within `full` metres, e.g. right after a melee hit) every pellet lands; the chance falls to `far` of them landing at `at` metres and beyond.
// A gun that deals one shot's damage however many pellets hit (Drifter) has nothing to miss. ponytail: the wiki has no spread numbers; his to tune.
const PELLETS = { full: 5, at: 15, far: 0.7 };
// Precision (his call, Oct 22: a flat stat, 25 to start, +1% a point, raised by permanent buffs): a bullet is a headshot with `precision` percent
// chance, and every point above the base adds a percentage point to a spread pellet landing (never above all of them). ponytail: the base adds
// nothing to pellets, so shotguns are as accurate as before until something raises it; his to say otherwise.
// Overflow (his call, Oct 29): past `full` (every pellet lands at 15 m, no single shot misses, a duel's misses are gone) each point adds `parry` to a
// duel's parry chance on top and pushes weapon falloff out by `range` (like attack range). ponytail: both amounts are my placeholders.
const PRECISION = { base: 25, full: 55, parry: 0.01, range: 0.01, maxParry: 0.8 }; // maxParry: a duel's parry chance never above it (my pick)
const overflow = (unit) => Math.max(0, unit.stat('precision') - PRECISION.full);
const headshotChance = (unit) => (unit.stats?.noHeadshot ? 0 : clamp(unit.stat('headshot') / 100, 0, 1)); // Headshot Precision (his call, Oct 28: its own stat)
// A headshot's bonus bullet damage (his ask, Nov 6: "what's the point of building headshot builds"): +65% (deadlock.wiki/Headshot), each hero's own
// CritDamageBonusPercent added (Drifter -45 ... ; the stat sheet's headshotBonus). It lands on every target, like the headshot items always have here
// (the game: only troopers, neutrals, Lane Guardians and heroes have a weak spot).
const HEADSHOT_BONUS = 0.65;
// Was this bullet hit a headshot? A gun shot rolls once (fireWeapon sets opts.headshot), so the bonus, the headshot items and abilities agree; any
// other bullet (an ability's) rolls here. A ricochet can't headshot (the wiki).
const isHeadshot = (fight, unit, p) => !p?.opts?.ricochet && (p?.opts?.headshot ?? fight.rng() < headshotChance(unit));
// Misses (his ask, Oct 28: "Single bullet guns never missing is a big problem, same with Melees"; the numbers left to me: "a good mix of balance and
// challenge"): a single bullet or a melee misses MISS.npc of the time against an NPC (big, slow targets) and MISS.hero against a hero (a duel),
// at the base Precision; each point above it takes a percentage point off. A shotgun's pellets against an NPC have their own spread instead.
const MISS = { npc: 0.1, hero: DUEL.miss };
const missChance = (unit, target) => clamp((target.team === 'hero' ? MISS.hero : MISS.npc) - (unit.stat('precision') - PRECISION.base) / 100, 0, 1);
const pelletChance = (distance, precision = PRECISION.base) => clamp(1 - (1 - PELLETS.far) * clamp((distance - PELLETS.full) / (PELLETS.at - PELLETS.full), 0, 1) + (precision - PRECISION.base) / 100, 0, 1);
const { stackResist } = require('./buffs');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const CC_TAGS = ['sleep', 'curse', 'stun', 'disarm', 'silence', 'immobilize'];
const STOPS = ['sleep', 'curse', 'stun']; // what interrupts a lasting ultimate
const CANT_ACT = ['sleep', 'curse', 'stun', 'void', 'hold']; // sleep and curse are separate: both stop actions, but only sleep wakes on damage and curse cannot be cleansed; a stun also interrupts a cast or channel (Oct 28, his call)
const DEBUFF_CAP = 0.5; // an enemy debuffing attack can't take more than this much of the hero's fire rate or movement from all enemies together (his call)
const ADAPT = { every: 3, step: 0.05, resist: 0.4, parry: 0.3, damage: 0.3 }; // /descend's Adaptive: every `every` s, if hurt, it picks one of three: `step` more resist against the damage type it took most, more parry chance, or more damage dealt (each up to its cap)
const OWN_EVENTS =new Set(['dash', 'slide', 'reloadStart', 'reloadEnd', 'cast', 'melee', 'unstealth', 'heal', 'cc', 'ccLanded', 'blast']); // heard only by the hero they are about
const HELPLESS =['stun', 'sleep', 'immobilize']; // an enemy that can't hit back: worth walking up to and meleeing
// Ability Range (his call, Oct 3): the enemies of a group stand one behind the other, SPREAD metres apart on average (each gap is rolled, half to one and a
// half times that), and an area ability or item only reaches the ones within its radius of the front one (Fight.near). Members never see the distances.
// ponytail: 4 m is a placeholder; weapon falloff still uses the target's own `distance`.
const SPREAD = 4;
// Movement Speed (his call, Oct 3): a hero can get out of the way of an enemy's blast (the Patron's curse, the Walker's stomp): a chance per m/s above
// `from`, up to `max`. A slowed enemy's blast is easier still: its slow is added (his call, Oct 3). A dodged blast does nothing.
// ponytail: all three numbers are placeholders.
const DODGE = { from: 6, per: 0.1, max: 0.6 };
// A slow on the hero itself (a Haunt's spores, a rival hero's slow; his call, Oct 10): that much less move speed here, and stamina comes back that much slower (move()).
const slowed = (unit) => clamp(unit.mod('slow') * (1 - clamp(unit.stat('slowResist'), 0, 1)), 0, 0.9); // slow resist (Enduring Speed, Juggernaut, Fleetfoot) takes its share off
// /descend's floor on what the hero can take off an enemy's damage (its `outputFloor`, set in descent.js; Nov 2): slows (fewer attacks), "deals less
// damage" and spirit power taken together leave it at least that share, like DEBUFF_CAP the other way round. The farm's enemies have none.
const attackRate = (unit) => Math.max(1 - slowed(unit), unit.stats.outputFloor ?? 0);
const dodgeChance = (unit, foe) => clamp(clamp((unit.stat('moveSpeed') * (1 - slowed(unit)) - DODGE.from) * DODGE.per, 0, DODGE.max) + (foe ? foe.mod('slow') : 0), 0, 0.9);

class Unit {
  /** @param stats a heroStats() sheet, or for enemies { maxHealth, dps, bulletResist, spiritResist, distance } */
  constructor({ name, team, stats, abilities = [] }) {
    this.name = name;
    this.team = team; // 'hero' | 'enemy'
    this.stats = stats;
    this.health = stats.maxHealth;
    this.abilities = abilities; // the hero's Ability objects, slot 1-4
    this.items = []; // the hero's Item objects (items.js)
    this.lastHit = -Infinity; // when it last took damage (out-of-combat regen, Fortitude)
    this.statuses = []; // { id, until, mods, tags, wakeOnDamage, barrier, regen, debuff, breakOnAttack }
    this.weapon = { clip: stats.clip, reloadLeft: 0, charge: 0 };
    this.rejuvs = 0; // revives in hand
    this.healPool = stats.maxHealth * HEAL_POOL; // how much more healing it can take right now
    this.stamina = Math.max(0, Math.floor(stats.stamina ?? 0)); // dashes in hand
    this.staminaCharge = 0; // progress towards the next one
    this.nextDash = 0;
    this.nextSlide = MOVE.slideEvery;
    this.meleeAt = 0; // when it may melee again
    this.busyUntil = 0; // a melee swing holds the gun
    this.lockedUntil = 0; // a lasting ultimate: no other ability is cast until then (ability.js lockout)
    this.close = null; // the enemy it stands next to after a melee, until closeUntil
    this.closeUntil = 0;
  }

  get alive() { return this.health > 0; }
  mod(stat) { return this.statuses.reduce((sum, s) => sum + (s.mods?.[stat] || 0), 0); }
  // A resist (bullet / spirit / melee) right now: temporary resists multiply with `base` like items do, and shreds (negative mods) multiply among
  // themselves, then that total comes off the resist (the wiki: 50% resist under a 30% shred is 20%, below zero it is extra damage taken).
  resistNow(key, base = this.stats[key] ?? 0) {
    let resist = base;
    let kept = 1;
    for (const s of this.statuses) {
      const v = s.mods?.[key] || 0;
      if (v > 0) resist = stackResist(resist, v); else if (v < 0) kept *= 1 + v;
    }
    return resist - (1 - kept);
  }
  // Shots a second right now: the permanent fire rate bonuses (items, buffs) and the temporary ones add up (the wiki: fire rate increases are additive).
  fireRateNow() { return this.stats.fireRate * (1 + this.mod('fireRate') / (1 + (this.stats.fireBonus ?? 0))); }
  stat(key) { return (this.stats[key] ?? 0) + this.mod(key); } // a sheet stat plus what statuses add right now
  has(tag) { return this.statuses.some((s) => s.tags?.includes(tag)); }
  get cantAct() { return CANT_ACT.some((t) => this.has(t)); }
  // Enemies can't see a hero who is invisible and hasn't been revealed, flying off, or in a void.
  get targetable() { return !this.has('void') && !this.has('untargetable') && !(this.has('invisible') && !this.has('revealed')); }
  get range() { return (this.stats.rangeMult ?? 1) + this.mod('rangeMult'); } // ability range: x the radius of area abilities and items
  // Max health that can change mid-fight (Siphon Bullets, Cultist Sacrifice, Unstable Concoction): health follows the change.
  addMaxHealth(amount) {
    this.stats.maxHealth += amount;
    this.health = amount > 0 ? this.health + amount : Math.min(this.health, this.stats.maxHealth);
  }
}

const VENOM = { seconds: 4, share: 0.004 }; // Vyper's poisoned weapon (Nov 14; my numbers, his to set): each bullet poisons for 4 s, 0.4% of the enemy's max Health a second (half on a boss)
const GNAW = { shred: 0.04, seconds: 5 }; // a Rat's bite (the Rat King, /descend): that much Bullet Resist off the enemy for that long (each Rat's own, so several add up)
const PLOT_ARMOR = { safe: 2, health: 0.25 }; // seconds nothing hurts the hero after Paige's Plot Armor saves it (Nov 7, his ask: "keep you alive for a brief period"; my number)
const ECHO = { name: 'Spectral Assistant' }; // what the Assistant's shots count under in the Damage Breakdown

class Fight {
  // `minions`: units that fight on the heroes' side (/descend: Rift Troopers, Graves' Ghouls, McGinnis' Mini Turret; his ask Nov 6). Each hits the
  // front enemy once a second; enemies may pick one to attack instead of the hero. `ffa`: every rival hero among the enemies fights everyone (the Rift).
  constructor({ heroes, enemies, minions = [], ffa = false, rng = Math.random, time = 0 }) {
    this.heroes = heroes;
    this.enemies = enemies;
    this.minions = minions;
    for (const m of minions) m.team = 'minion';
    this.rng = rng;
    this.time = time; // a siege's next stage carries on from the last one's clock
    this.queue = []; // [{ t, fn }] delayed effects
    this.log = []; // [{ t, who, what }] casts, for tests and later a recap
    this.dealt = new Map(); // unit -> damage it dealt
    this.breakdown = new Map(); // hero -> Map(what dealt it: 'Gun' | 'Heavy Melee' | an ability or item name -> damage) (the Damage Breakdown button)
    this.taken = new Map(); // NPC enemy -> Map(what it dealt the hero with: 'Attack' | its blast | its special -> damage) (the breakdown's Enemy Damage, his ask Oct 26)
    this.self = new Map(); // hero -> Map(ability or item -> health it cost the hero) (Victor's Aura of Suffering on Enemy Damage, his ask Nov 4)
    this.enemyMove = null; // the special an NPC is using right now (what its damage is counted under)
    this.healed = new Map(); // hero -> Map(what healed it -> health) (the breakdown's Healing, his ask Oct 26)
    this.healedBy = new Map(); // hero -> Map(what -> Map(the item or ability behind a lifesteal heal -> health)): the lines under Bullet / Spirit Lifesteal
    this.madeOf = new Map(); // hero -> Map(what dealt it -> Map(item or 'Base' -> damage)): the lines under Gun and under spirit-scaled abilities and items
    this.healLog = []; // [{ t (whole seconds), unit, what, amount }]: when each heal landed (one entry per source per second; plain regen left out)
    this.by = null; // the ability or item whose hook, tick, cast or delayed effect is running right now (what its damage is counted under)
    this.bonusSouls = 0; // souls items earned in this fight (wiki souls; a won trip pays them at the payout scale)
    this.casting = null; // the ability whose effect is running right now (its damage is tagged with it)
    // Who acts in this fight, and what each sees. A member's hero sees the fight as it is. A rival hero among the enemies (an encounter) sees it mirrored:
    // it is the hero and the member's heroes are its enemies, so its abilities and items work unchanged. Both share the clock, queue, log and dice.
    this.views = new Map(heroes.map((h) => [h, this]));
    const rivals = enemies.filter((e) => e.team === 'hero');
    if (ffa) { // a free-for-all: each rival sees everyone else as its enemy, in its own order (who it goes for first)
      for (const rival of rivals) {
        const mirror = Object.create(this);
        const others = [...heroes, ...rivals.filter((r) => r !== rival)];
        for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
        Object.assign(mirror, { heroes: [rival], enemies: others, casting: null, by: null, bonusSouls: 0 });
        this.views.set(rival, mirror);
      }
    } else if (rivals.length) {
      const mirror = Object.create(this);
      Object.assign(mirror, { heroes: rivals, enemies: heroes, casting: null, by: null, bonusSouls: 0 });
      for (const rival of rivals) this.views.set(rival, mirror);
    }
    let at = 0; // where each enemy stands behind the front one, in metres (a lone enemy rolls nothing)
    enemies.forEach((e, i) => { e.offset = i ? (at += SPREAD * (0.5 + rng())) : 0; });
  }

  asMove(name, fn) { const before = this.enemyMove; this.enemyMove = name; try { return fn(); } finally { this.enemyMove = before; } }
  at(delay, fn) { const by = this.by; this.queue.push({ t: this.time + delay, fn: () => this.as(by, fn) }); } // a delayed effect counts for what scheduled it
  // Runs `fn` with `by` (an ability or item) as what deals its damage.
  as(by, fn) {
    const before = this.by;
    this.by = by;
    try { return fn(); } finally { this.by = before; }
  }

  get foes() { return this.enemies.filter((e) => e.alive && !e.fled && e.targetable && !guarded(e)); } // enemies still standing (and in sight: a rival hero can hide; a summoner behind its summons can't be reached)
  // The enemies an area of `radius` metres reaches: the front one (the hero is on it) and those standing close enough behind it.
  near(radius) { const foes = this.foes; return foes.filter((e) => (e.offset ?? 0) - (foes[0].offset ?? 0) <= radius); }
  // A dash-jump in the last MOVE.dodge seconds dodges this hit, and is used up by it (a hero that can't act isn't dodging anything).
  dashDodge(unit) {
    if (!(unit.dodgeUntil > this.time) || unit.cantAct) return false;
    unit.dodgeUntil = 0;
    return true;
  }

  // How far the hero is from a target: right next to it for a moment after meleeing it, else where it stands.
  distance(hero, target) { return hero.close === target && hero.closeUntil > this.time ? MELEE.closeDistance : target.stats.distance ?? 15; }

  // The source's damage multiplier: its own "deals more / less damage", and for an enemy's spirit damage the spirit power taken from it (1% less a point,
  // his call Oct 3); never under the enemy's `outputFloor` together with its slowed attacks (attackRate).
  output(source, type, opts = {}) {
    let out = Math.max(0, 1 + (source.stats.damageDealt ?? 0) + source.mod('damageDealt'));
    if (type === 'spirit' && source.team === 'enemy') out *= Math.max(0, 1 + source.mod('spirit') / 100);
    const floor = source.stats.outputFloor;
    return floor ? Math.max(out, opts.attack ? floor / attackRate(source) : floor) : out;
  }

  addStatus(unit, status) {
    if (!status.ccApplied && unit.team === 'hero' && status.debuff && status.tags?.some((t) => CC_TAGS.includes(t)) && this.by?.unit && this.by.unit !== unit) return this.cc(unit, status);
    let { id, duration } = status;
    if (unit.stats.ccResist && status.tags?.some((t) => CC_TAGS.includes(t))) duration *= 1 - unit.stats.ccResist; // bosses shrug off part of a stun, sleep or disarm
    if (duration <= 0) return;
    unit.statuses = unit.statuses.filter((s) => s.id !== id); // same id refreshes
    unit.statuses.push({ mods: {}, tags: [], from: this.casting, ...status, until: this.time + duration }); // from: the ability that put it on (interrupt)
  }

  // A stun, sleep or curse cuts the hero's lasting ultimate short (his call, Oct 28): what it put on the hero ends, and so does its own clock.
  interrupt(hero) {
    const ult = hero.locking;
    hero.lockedUntil = 0;
    hero.locking = null;
    if (!ult) return;
    hero.statuses = hero.statuses.filter((s) => s.from !== ult);
    if (ult.until > this.time) ult.until = this.time;
    this.log.push({ t: +this.time.toFixed(1), who: hero.name, what: ult.name, interrupted: true });
  }
  removeStatus(unit, id) { unit.statuses = unit.statuses.filter((s) => s.id !== id); }
  // Shortens the debuffs on a unit by `share` (1 = removes them). A curse can expire, but nothing can cleanse it.
  cleanse(unit, share = 1, { stuns = true } = {}) {
    for (const s of unit.statuses.filter((st) => st.debuff && !st.tags.includes('curse') && (stuns || !st.tags.some((t) => CC_TAGS.includes(t))))) s.until = this.time + (s.until - this.time) * (1 - share);
  }

  // Crowd control on a hero (an enemy blast's curse or stomp). Unstoppable ignores it, an item may block it (Cloak of Opportunity), debuff resist
  // shortens it, and items hear about it (Reactive Barrier). Returns true if it landed.
  cc(unit, status) {
    const tag = status.tags?.find((t) => CC_TAGS.includes(t)) ?? 'control';
    if (unit.has('unstoppable')) {
      this.log.push({ t: +this.time.toFixed(1), who: unit.name, what: tag, ccBlocked: 'Unstoppable' });
      return false;
    }
    const event = { target: unit, status, blocked: false };
    this.emit('cc', event);
    if (event.blocked) {
      this.log.push({ t: +this.time.toFixed(1), who: unit.name, what: tag, ccBlocked: event.blockedBy ?? 'CC immunity' });
      return false;
    }
    this.addStatus(unit, { ...status, duration: status.duration * (1 - clamp(unit.stat('statusResist'), 0, 0.9)), debuff: true, ccApplied: true });
    this.emit('ccLanded', event);
    return true;
  }

  // Health a hero's own ability or item cost it (pure, not through damage()): counted on the breakdown's Enemy Damage page.
  selfDamage(unit, what, amount) {
    if (!(amount > 0)) return;
    const m = this.self.get(unit) ?? this.self.set(unit, new Map()).get(unit);
    m.set(what, (m.get(what) || 0) + amount);
  }

  // A debuff that isn't crowd control (a burn, a slow, a heal cut from a Haunt's special): debuff resist shortens it, a cleanse removes it.
  debuff(unit, status) {
    if (status.dot && this.enemyMove) status = { ...status, dot: { ...status.dot, move: this.enemyMove } };
    this.addStatus(unit, { ...status, duration: status.duration * (1 - clamp(unit.stat('statusResist'), 0, 0.9)), debuff: true });
  }

  // Every hero in the fight hears an event, each through its own view. A hero's own actions (OWN_EVENTS) are heard by that hero only.
  emit(event, payload) {
    const only = !OWN_EVENTS.has(event) ? null : this.views.has(payload.source) ? payload.source : payload.target; // a blast's source is an NPC: its target hears it
    for (const [hero, view] of this.views) {
      if (only && hero !== only) continue;
      if (event === 'attacked') { // a reactive active can dodge before Bloodletting or other hit reactions
        for (const it of hero.items) if (it.active) view.as(it, () => it.on(event, view, payload));
        if (payload.opts.dodged) return;
      }
      for (const a of hero.abilities) view.as(a, () => a.on(event, view, payload));
      for (const it of hero.items) {
        if ((event === 'shot' || event === 'bulletHit') && hero.heldProcs?.has(it.name)) continue; // procs saved for a bigger shot (Paradox's Kinetic Carbine)
        if (event !== 'attacked' || !it.active) view.as(it, () => it.on(event, view, payload));
      }
    }
  }

  // A status may carry a `barrier` (damage it soaks before health; `raw: true` = it ignores its owner's resists).
  // The one place damage happens. type: 'bullet' | 'spirit' | 'melee' (only melee resist takes it down) | 'true' (no resist takes anything off it: the Patron's
  // blast). opts.events = false skips the hooks (extra damage that must not trigger itself), opts.keepsStealth marks hits that don't break invisibility,
  // opts.attack / opts.blast mark an enemy's hit and blast (items may parry or soften them first: the 'attacked' hook), opts.ability is the ability
  // that dealt it (set by the engine while one is running).
  damage(source, target, amount, type = 'spirit', opts = {}) {
    if (!target.alive || target.fled || opts.dodged || guarded(target) || target.safeUntil > this.time) return 0; // (a unit that fled the fight is out of it: the Rift; safeUntil: Plot Armor's moment)
    if (target.stats.parry && source.team === 'hero' && (type === 'bullet' || type === 'melee') && this.rng() < target.stats.parry) return 0; // Adaptive's parry
    if (source.team === 'hero' && target.team === 'hero' && source !== target) amount *= DUEL.damage; // a duel
    if (source.team === 'hero' && this.casting) opts.ability ??= this.casting;
    // the wiki (Close Quarters' page, Oct 28): an ability that scales with melee damage gets 50% of the Weapon Damage bonus (Bebop's Uppercut, Yamato's Flying Slash ...)
    if (type === 'melee' && source.team === 'hero' && this.by?.meleeScaled) amount *= Math.max(0, 1 + 0.5 * this.weaponBonus(source, target));
    // a dash-jump's dodge (MOVE.dodge) takes the next attack: both halves of a mixed one (they share opts), never a hit that can't miss
    // an enemy's `accuracy` (0-1, /descend's, his ask Oct 29: "hit harder and more accurately") is the share of its hits a dodge or evasion would have taken that land anyway
    const sure = !opts.unavoidable && source.team === 'enemy' && source.stats.accuracy > 0 && this.rng() < source.stats.accuracy;
    if ((opts.attack || opts.special) && !opts.unavoidable && !sure && this.dashDodge(target)) { opts.dodged = true; return 0; }
    if (type === 'bullet' && !opts.unavoidable && !sure && !opts.noEvade && this.rng() < target.mod('evasion')) return 0; // unavoidable (Armor Piercer), noEvade (Lucky Shot's bonus)
    if (opts.attack || opts.blast || opts.special || opts.melee) { // defensive items hear rival melee too; only an `attack` can be parried; after the dodges (Nov 2: Shiv's Bloodletting deferred hits that were then dodged)
      const hit = { source, target, amount, type, opts };
      this.emit('attacked', hit);
      amount = hit.amount;
      if (amount <= 0) return 0;
    }
    const npcOnly = source.team === 'hero' ? target.stats.npcBulletResist ?? 0 : 0; // Monster Rounds' "vs. NPCs" resist: taken back out of the stack against a rival hero
    const bulletResist = npcOnly ? 1 - (1 - target.stats.bulletResist) / (1 - npcOnly) : target.stats.bulletResist;
    const resist = type === 'true' ? 0 : type === 'melee' ? target.resistNow('meleeResist') : type === 'bullet' ? (opts.ignoreBulletResist ? 0 : target.resistNow('bulletResist', bulletResist))
      : opts.ignoreSpiritResist ? 0 : target.resistNow('spiritResist'); // temporary resists and shreds multiply with the unit's own too
    let incoming = amount * this.output(source, type, opts) * (1 - clamp(resist, -1, 0.9)) * Math.max(0, 1 + target.mod('damageTaken'));
    if (source.lesson?.kinds.includes(target.kind)) incoming *= 1 + source.lesson.deal; // Dynamo's Lesson (Descend): the kind the hero studied takes more from it and deals less to it
    else if (target.lesson?.kinds.includes(source.kind)) incoming *= 1 - target.lesson.take;
    if (type === 'bullet') incoming *= Math.max(0, 1 + target.mod('bulletTaken')); // Metal Skin
    if (type === 'melee') incoming *= Math.max(0, 1 + target.mod('meleeTaken')); // melee resist taken off an enemy (Apollo's Riposte)
    if (type === 'spirit') {
      incoming *= (1 + target.mod('spiritAmp')) * Math.max(0, 1 + target.mod('spiritTaken')) * Math.max(0, 1 + source.mod('spiritDealt')); // e.g. Escalating Exposure; spiritDealt: the source's own spirit damage boost (Celeste's Radiant Daggers)
    }
    const eased = amount > 0 ? Math.min(1, incoming / amount) : 1; // what the target's resists left of the hit
    for (const s of target.statuses) { // barriers soak damage first
      if (!(s.barrier > 0) || incoming <= 0 || opts.unavoidable) continue; // an Armor Piercer bullet goes through barriers (the wiki)
      const worth = s.raw ? eased : 1; // a raw barrier gets nothing from its owner's resists: it pays for the hit as it was sent (Rat King's Royal Pestments, the wiki)
      const soaked = Math.min(s.barrier * worth, incoming);
      s.barrier -= soaked / worth;
      incoming -= soaked;
    }
    let dealt = Math.min(target.health, incoming);
    if (dealt >= target.health && (opts.nonLethal || (target.fleeAt && !(target.rejuvs > 0)) || target.abilities.some((a) => a.preventDeath?.(this)) || target.items.some((it) => it.preventDeath?.(this)))) dealt = Math.max(0, target.health - 1); // a hit that can't kill (Danny's own; the Rift, where the hero flees instead), Victor's Shocking Reanimation (the wiki), then Cheat Death
    else if (dealt >= target.health && this.plotArmor(target)) { dealt = 0; target.health = Math.max(target.health, target.stats.maxHealth * PLOT_ARMOR.health); } // then Paige's Plot Armor: the hit is turned aside and the hero is back at a quarter of its health (his call, Nov 7; it was 1 health)
    target.health -= dealt;
    if (dealt > 0) target.lastHit = this.time;
    if (dealt > 0 && target.stats.adaptive && source.team === 'hero') (target.adapted ??= {})[type] = (target.adapted[type] || 0) + dealt;
    if (!target.alive && target.stats.undying && !target.undied) { // Undying (/descend): cheats death once, back at a share of its health
      target.undied = true;
      target.health = target.stats.maxHealth * target.stats.undying;
      this.log.push({ t: +this.time.toFixed(1), who: target.name, what: 'Undying', enemy: true, special: true });
    }
    if (!target.alive && target.rejuvs > 0) this.rejuvenate(target);
    this.dealt.set(source, (this.dealt.get(source) || 0) + dealt);
    if (dealt > 0 && this.views.has(source)) { // a hero's damage, by what dealt it
      const what = this.by?.name ?? (type === 'melee' ? `${opts.meleeType === 'light' ? 'Light' : 'Heavy'} Melee` : type === 'bullet' ? 'Gun' : 'Other');
      if (!this.breakdown.has(source)) this.breakdown.set(source, new Map());
      const mine = this.breakdown.get(source);
      mine.set(what, (mine.get(what) || 0) + dealt);
      const parts = this.madeOfParts(source, target, type, dealt, opts);
      if (parts) {
        if (!this.madeOf.has(source)) this.madeOf.set(source, new Map());
        const sums = this.madeOf.get(source).get(what) ?? this.madeOf.get(source).set(what, new Map()).get(what);
        for (const [name, n] of parts) sums.set(name, (sums.get(name) || 0) + n);
      }
    } else if (dealt > 0 && source.team === 'enemy') {
      const what = opts.blast ? capital(source.stats.blast?.what ?? 'curse') : opts.attack ? 'Attack' : this.enemyMove ?? 'Other';
      if (!this.taken.has(source)) this.taken.set(source, new Map());
      const theirs = this.taken.get(source);
      theirs.set(what, (theirs.get(what) || 0) + dealt);
    }
    // lifestealOn / spiritLifestealOn: lifesteal against this one target (Apollo's Riposte, Celeste's Light Eater)
    const hero = target.team === 'hero'; // full strength off a rival hero
    if (type === 'bullet' || type === 'melee') { const steal = (type === 'bullet' ? source.stat('lifesteal') : 0) + target.mod('lifestealOn'); if (steal > 0) this.lifesteal(source, dealt * steal * (hero ? 1 : BULLET_LIFESTEAL_VS_NPC), type === 'bullet' ? 'lifesteal' : null, target.mod('lifestealOn'), 'Bullet Lifesteal'); }
    else if (type === 'spirit') { const steal = source.stat('spiritLifesteal') + target.mod('spiritLifestealOn'); if (steal > 0) this.lifesteal(source, dealt * steal * (hero ? 1 : SPIRIT_LIFESTEAL_VS_NPC), 'spiritLifesteal', target.mod('spiritLifestealOn'), 'Spirit Lifesteal'); }
    // The siege's own sustain (targets.js siegeSustain): it heals for a share of every hit that lands, blasts too (the hero's heal cuts
    // shrink it through heal()'s healAmp), and each hit cuts the hero's healing for a few seconds (a debuff: resist shortens it, a cleanse ends it).
    if (source.team === 'enemy' && dealt > 0) {
      if (source.stats.drain > 0 && source.alive) this.heal(source, dealt * source.stats.drain, 'lifesteal');
      if (source.stats.antiHeal && target.team === 'hero' && target.alive) this.debuff(target, { id: 'antiheal', duration: source.stats.antiHeal.seconds, mods: { healAmp: -source.stats.antiHeal.cut } });
    }
    for (const s of target.statuses) { // sleepers wake a moment after being hurt
      if (s.wakeOnDamage !== undefined && !opts.noWake) s.until = Math.min(s.until, this.time + s.wakeOnDamage);
    }
    if (source.team === 'hero' && !opts.keepsStealth && source.statuses.some((s) => s.breakOnAttack)) { // attacking out of an item's stealth ends it
      const ended = source.statuses.filter((s) => s.breakOnAttack);
      source.statuses = source.statuses.filter((s) => !s.breakOnAttack);
      this.emit('unstealth', { source, target, opts, ended: ended.map((s) => s.id) });
    }
    if (opts.events !== false) {
      const payload = { source, target, amount, dealt, type, opts }; // amount = before resist, dealt = after
      this.emit('damage', payload);
      if (type === 'bullet') this.emit('bulletHit', payload);
      if (type === 'bullet' && source.venom && target.team !== 'hero' && target.alive) { // Vyper's poisoned weapon (/descend): each hit leaves a poison on the enemy
        this.addStatus(target, { id: 'venom', duration: VENOM.seconds, debuff: true, dot: { source, perSecond: target.stats.maxHealth * VENOM.share * (target.stats.ccResist ? 0.5 : 1), type: 'spirit', every: 0.5, next: target.statuses.find((x) => x.id === 'venom')?.dot.next ?? this.time + 0.5 } }); // (a refresh keeps its tick, or fast bullets would never let it fire)
      }
      if (!target.alive) this.emit('kill', payload);
    }
    if (!target.alive && target.stats.special?.onDeath && !target.burst) { // a Haunt that goes off as it dies (the Specimen)
      target.burst = true;
      const victim = this.heroes.find((h) => h.alive);
      const what = target.stats.special.deathName ?? target.stats.special.name; // a death effect may have its own name (/descend's Medic Pack)
      if (victim) { this.log.push({ t: +this.time.toFixed(1), who: target.name, what, enemy: true, special: true, ...(target.stats.special.deathName ? { drop: true } : {}) }); this.asMove(what, () => target.stats.special.onDeath(this, target, victim)); }
    }
    return dealt;
  }

  // Paige's Plot Armor (/descend, his approval Nov 6): the next hit that would kill the hero is turned aside and leaves it at PLOT_ARMOR.health of its health instead, once a run (`plotArmor` on the unit).
  // Nov 7, his calls: it waits until the hero has no Rejuv left (a Rejuv takes the death first), then nothing hurts the hero for PLOT_ARMOR.safe s.
  plotArmor(unit) {
    if (!unit.plotArmor || unit.rejuvs > 0) return false;
    unit.plotArmor = false;
    unit.plotUsed = true;
    unit.safeUntil = this.time + PLOT_ARMOR.safe;
    this.log.push({ t: +this.time.toFixed(1), who: unit.name, what: 'Plot Armor' });
    return true;
  }

  // A Rejuv (the Mid-Boss's gift): a hero who dies comes back at full health after 3 s (can't act or be hurt meanwhile); Eternal Gift shortens it.
  rejuvenate(unit) {
    unit.rejuvs -= 1;
    unit.health = unit.stats.maxHealth;
    const cut = Math.max(0, ...unit.items.map((it) => it.respawnCut?.(this) ?? 0));
    this.addStatus(unit, { id: 'rejuv', duration: REJUV_DELAY * (1 - cut), tags: ['sleep'], mods: { damageTaken: -1 } });
    this.log.push({ t: +this.time.toFixed(1), who: unit.name, what: 'Rejuvenated' });
  }

  // What one hit of a hero's was made of, for the Damage Breakdown: the Gun's bonus weapon damage by item (each adds its share of the bonus on top
  // of the base), and an ability's or item's spirit-scaled part by where the spirit power came from (items, levels, buffs, what a status gave). An
  // estimate: the spirit share is read off the last damage number the ability or item worked out (`sShare`). Returns Map(name -> damage) or null.
  madeOfParts(hero, target, type, dealt, opts = {}) {
    const parts = new Map();
    const add = (name, v) => { if (v > 1e-9) parts.set(name, (parts.get(name) ?? 0) + v); };
    const s = hero.stats;
    if (type === 'bullet' && !this.by) {
      const sheet = s.weaponBy ?? {};
      let rest = s.weaponDamageMult - 1 - (target.team === 'hero' ? s.npcWeapon ?? 0 : 0);
      for (const [name, v] of Object.entries(sheet)) { add(name, v); rest -= v; }
      add('Buffs', rest);
      for (const st of hero.statuses) add(statusName(st), st.mods?.weaponDamage);
      for (const it of hero.items) add(it.name, it.weaponBonus(this, target));
      parts.set('Base', 1);
      if (opts.headshot) { let sum = 0; for (const v of parts.values()) sum += v; parts.set('Headshots', sum * s.headshotBonus); } // the bonus on top of everything else
    } else if (type === 'spirit' && this.by?.sShare > 0) {
      const by = this.by;
      const mult = s.spiritMult ?? 1;
      let rest = s.spirit;
      for (const [name, v] of Object.entries(s.spiritBy ?? {})) { add(name, v); rest -= v; }
      add('Buffs', rest);
      for (const st of hero.statuses) add(statusName(st), (st.mods?.spirit ?? 0) * mult);
      let known = 0;
      for (const v of parts.values()) known += v;
      const total = by.spirit ? by.spirit() : s.spirit + hero.mod('spirit') * mult;
      add('Other', total - known);
      known = Math.max(known, total);
      for (const [name, v] of parts) parts.set(name, (dealt * by.sShare * v) / known);
      parts.set('Base', dealt * (1 - by.sShare));
      return parts;
    } else return this.by ? new Map([['Base', dealt]]) : null; // a melee hit or a flat one of an ability or item: all base, so the lines add up to its total
    let total = 0;
    for (const v of parts.values()) total += v;
    for (const [name, v] of parts) parts.set(name, (dealt * v) / total);
    return parts;
  }

  // A lifesteal heal of `amount`, shared out by who gave the lifesteal (the sheet's per item `<key>By`, statuses by what put them on, `extra` off the
  // target) so the Healing page can name Leech, Vampiric Burst ... under Bullet / Spirit Lifesteal. `key` null: only `extra` (a melee hit).
  lifesteal(unit, amount, key, extra, label) {
    if (unit.team !== 'hero') return this.heal(unit, amount, 'lifesteal', label);
    const parts = new Map();
    const add = (name, v) => { if (v > 1e-9) parts.set(name, (parts.get(name) ?? 0) + v); };
    if (key) {
      const sheet = unit.stats[`${key}By`] ?? {};
      let rest = unit.stats[key] ?? 0;
      for (const [name, v] of Object.entries(sheet)) { add(name, v); rest -= v; }
      add('Other', rest);
      for (const st of unit.statuses) add(statusName(st), st.mods?.[key]);
    }
    add('Other', extra);
    let total = 0;
    for (const v of parts.values()) total += v;
    for (const [name, v] of parts) this.heal(unit, (amount * v) / total, 'lifesteal', label, name);
  }

  // kind: 'cast' (an ability's or item's heal: Healing Tempo hears it), 'regen' or 'lifesteal'. Heal amp (Healing Booster, or an enemy's healing
  // cut: Toxic Bullets, Nullification Burst) scales it. Returns what was healed.
  // `label`: what to count it under in the breakdown's Healing (else the item or ability running, else by kind).
  heal(unit, amount, kind = 'cast', label = null, sub = null) {
    if (!unit.alive || !(amount > 0)) return 0;
    const amp = unit.stat('healAmp');
    amount *= Math.max(0, 1 + (kind === 'constant' ? Math.min(0, amp) : amp)); // 'constant' regen (the sheet's): healing cuts hit it, Healing Booster doesn't (the wiki)
    if (unit.team === 'hero') { amount = Math.min(amount, unit.healPool); unit.healPool -= amount; }
    amount = Math.min(amount, unit.stats.maxHealth - unit.health);
    unit.health += amount;
    if (amount > 0 && unit.team === 'hero') this.noteHeal(unit, label ?? this.by?.name ?? (kind === 'lifesteal' ? 'Lifesteal' : kind === 'constant' ? 'Health Regen' : 'Other'), amount, kind !== 'constant', sub);
    if (kind === 'cast' && amount > 0) this.emit('heal', { target: unit, amount });
    return amount;
  }

  noteHeal(unit, what, amount, timed, sub = null) {
    if (!this.healed.has(unit)) this.healed.set(unit, new Map());
    const mine = this.healed.get(unit);
    mine.set(what, (mine.get(what) || 0) + amount);
    if (sub) {
      if (!this.healedBy.has(unit)) this.healedBy.set(unit, new Map());
      const parts = this.healedBy.get(unit).get(what) ?? this.healedBy.get(unit).set(what, new Map()).get(what);
      parts.set(sub, (parts.get(sub) || 0) + amount);
    }
    if (!timed) return;
    const t = Math.floor(this.time);
    const last = this.healLog.findLast((h) => h.unit === unit && h.what === what);
    if (last?.t === t) last.amount += amount;
    else this.healLog.push({ t, unit, what, amount });
  }

  // A heal over time (Healing Nova, Healing Rite ...): counts as one cast heal when it starts.
  regen(unit, id, perSecond, duration) {
    this.addStatus(unit, { id, duration, regen: perSecond, by: this.by?.name });
    this.emit('heal', { target: unit, amount: perSecond * duration });
  }

  // Weapon damage of one shot at a target's distance (linear falloff between the wiki's start and end range, which items with attack range push out).
  shotDamage(hero, target) {
    const s = hero.stats;
    return (s.bulletDamage + hero.mod('bulletDamage')) * s.pellets * (1 + this.weaponBonus(hero, target)) * this.falloffScale(hero, target);
  }

  // The share of a shot's damage that survives the distance to `target` (1 up close). Headshot Booster's bonus is scaled by it too (the wiki).
  falloffScale(hero, target) {
    const s = hero.stats;
    const f = s.falloff;
    const far = 1 + (s.attackRange ?? 0) + overflow(hero) * PRECISION.range; // + overflowing Precision
    const d = this.distance(hero, target);
    return d <= f.start * far ? f.startScale
      : d >= f.end * far ? f.endScale : f.startScale + (f.endScale - f.startScale) * ((d - f.start * far) / ((f.end - f.start) * far));
  }

  // The hero's bonus Weapon Damage against `target` (0.2 = +20%): its stat, buffs, and items' distance, target health, build-up ... bonuses.
  weaponBonus(hero, target) {
    const npcOnly = target.team === 'hero' ? hero.stats.npcWeapon ?? 0 : 0; // Monster Rounds' "vs. NPCs" damage does nothing to a rival hero
    return hero.stats.weaponDamageMult - 1 - npcOnly + hero.mod('weaponDamage') + hero.items.reduce((sum, it) => sum + it.weaponBonus(this, target), 0);
  }

  // `front` is the enemy in front; while a status carries `spread` (Bullet Dance: its radius in metres) every shot goes to any enemy that close to the
  // front one (the wiki: 1 target per shot), and `perfect` (the same status) means a shot at a hero can't miss.
  fireWeapon(hero, front) {
    const w = hero.weapon;
    const dance = hero.statuses.find((s) => s.spread);
    if (w.reloadLeft > 0) {
      w.reloadLeft -= DT * (1 + hero.mod('reloadSpeed'));
      if (w.reloadLeft <= 0) { w.clip = hero.stats.clip; this.emit('reloadEnd', { source: hero }); }
      return;
    }
    if (this.time < hero.busyUntil) return; // mid-swing
    w.charge += hero.fireRateNow() * (1 - slowed(hero)) * DT;
    const infinite = hero.has('infiniteClip');
    while (w.charge >= 1 && (w.clip > 0 || infinite) && front.alive) {
      w.charge -= 1;
      if (!infinite) w.clip -= 1;
      const pool = dance ? this.near(dance.spread).filter((e) => e.alive) : [];
      const target = pool.length ? pool[Math.floor(this.rng() * pool.length)] : front;
      this.emit('shot', { source: hero, target }); // every bullet fired, hit or miss (Restorative Shot's cooldown starts here)
      const pellets = hero.stats.pellets;
      if ((pellets === 1 || target.team === 'hero') && !hero.has('perfect') && this.rng() < missChance(hero, target)) continue; // a missed shot (MISS)
      const opts = target.team === 'hero' ? { attack: true } : {}; // a shot at a hero is an attack it may parry or soften (a duel)
      if (pellets > 1) { // a shotgun: how many of its pellets land
        const miss = 1 - pelletChance(this.distance(hero, target), hero.stat('precision'));
        let landed = Math.min(pellets, hero.stats.surePellets ?? 0); // pellets that can't miss (Rat King: one of his two, the wiki)
        for (let i = landed; i < pellets; i++) if (!(this.rng() < miss)) landed++;
        if (!landed) continue;
        opts.landed = landed / pellets; // build-up items scale with it (items.js)
      }
      for (const it of hero.items) for (const [k, v] of Object.entries(it.shotOpts(this, target))) opts[k] ||= v; // one item's "no" never undoes another's "yes"
      opts.headshot = this.rng() < headshotChance(hero); // ponytail: one roll per shot, a shotgun's pellets share it (same average); per pellet if it matters
      const shot = this.shotDamage(hero, target) * (opts.landed ?? 1) * (opts.headshot ? 1 + hero.stats.headshotBonus : 1);
      const dealt = this.damage(hero, target, shot, 'bullet', opts);
      // Sinclair's Spectral Assistant, lent in /descend (his pick, Nov 6): every shot that lands is followed by one at `echo` of its damage
      if (dealt > 0 && hero.echo && target.alive) this.as(ECHO, () => this.damage(hero, target, shot * hero.echo, 'bullet', { events: false }));
    }
    if (w.clip <= 0 && !infinite) this.reload(hero);
  }

  reload(hero) {
    hero.weapon.reloadLeft = hero.stats.reload;
    hero.weapon.charge = 0;
    this.log.push({ t: +this.time.toFixed(1), who: hero.name, reload: true });
    this.emit('reloadStart', { source: hero });
  }

  // Melee (his call, Oct 3): only with a reason: the front enemy can't hit back, the gun is reloading anyway, or an item or ability wants a swing.
  wantMelee(hero, target) {
    return this.time >= hero.meleeAt && (HELPLESS.some((t) => target.has(t)) || hero.weapon.reloadLeft > 0
      || hero.items.some((it) => it.wantsMelee(this, target)) || hero.abilities.some((a) => a.wantsMelee?.(this, target)));
  }

  // A light or heavy melee at `target`. The automatic farming swing is heavy; abilities may request a light one.
  melee(hero, target, kind = 'heavy') {
    kind = kind === 'light' ? 'light' : 'heavy';
    hero.meleeAt = this.time + MELEE.every;
    if (!(hero.weapon.reloadLeft > 0)) hero.busyUntil = this.time + MELEE.busy;
    hero.close = target;
    hero.closeUntil = this.time + MELEE.closeFor;
    const bonus = hero.items.reduce((sum, it) => sum + it.meleeBonus(this, target), 0);
    const amount = (hero.stats[kind === 'light' ? 'lightMelee' : 'heavyMelee'] ?? 0) * (1 + hero.stat('meleeDamage') + bonus);
    const opts = { melee: true, meleeType: kind };
    // Rival heavy melees can be parried. This is intentionally only for duels:
    // NPCs have their own Rebuttal behaviour and never choose a parry.
    if (kind === 'heavy' && hero.team === 'hero' && target.team === 'hero' && this.time >= (target.parryAt ?? 0)
      && !target.cantAct && !target.has('stun') && !target.has('blind') && !target.stats.noParry) { // noParry: the Soul Urn's carrier can't parry (the wiki)
      const chance = Math.min(PRECISION.maxParry, (target.items.some((it) => it.name === 'Rebuttal') ? DUEL.parryWithRebuttal : DUEL.parryChance) + (target.stat('precision') - PRECISION.base) / 100 + overflow(target) * PRECISION.parry); // + Precision (his ask, Oct 28), more past full (Oct 29)
      if (this.rng() < chance) {
        opts.dodged = true;
        this.log.push({ t: +this.time.toFixed(1), who: target.name, target: hero.name, parry: true });
        this.cc(hero, { id: 'duel-parry', duration: DUEL.parryStun, tags: ['stun'] });
        return;
      }
      target.parryAt = this.time + DUEL.parryMissCooldown;
    }
    if (this.rng() < missChance(hero, target)) return; // a whiffed swing (MISS): the time is spent, nothing lands, no melee procs
    const dealt = this.damage(hero, target, amount, 'melee', opts);
    if (!opts.dodged) {
      this.log.push({ t: +this.time.toFixed(1), who: hero.name, what: `${kind === 'light' ? 'Light' : 'Heavy'} Melee`, target: target.name, melee: true });
      this.emit('melee', { source: hero, target, amount, dealt, kind });
    }
  }

  // Stamina and moving (his call, Oct 3): a dash-jump whenever a stamina charge is in hand (airborne a moment after), a slide now and then.
  move(hero) {
    const recharge = (hero.stats.staminaCooldown ?? 5) * Math.max(0.1, 1 - hero.stat('staminaCdr')) / Math.max(0.1, 1 + hero.stat('staminaRegen')) / (1 - slowed(hero));
    const max = Math.max(0, Math.floor(hero.stat('stamina')));
    if (hero.stamina < max) { hero.staminaCharge += DT / recharge; if (hero.staminaCharge >= 1) { hero.stamina++; hero.staminaCharge -= 1; } } else { hero.stamina = Math.min(hero.stamina, max); hero.staminaCharge = 0; }
    if (!this.foes.length) return;
    if (hero.stamina >= 1 && this.time >= hero.nextDash) {
      hero.stamina--;
      hero.nextDash = this.time + MOVE.dashGap;
      this.addStatus(hero, { id: 'airborne', duration: MOVE.airTime, tags: ['airborne'] });
      hero.dodgeUntil = this.time + MOVE.dodge; // the dash takes the hero out of the next attack or blast (damage, blasts)
      this.emit('dash', { source: hero });
    }
    if (this.time >= hero.nextSlide) {
      hero.nextSlide = this.time + MOVE.slideEvery;
      this.addStatus(hero, { id: 'sliding', duration: MOVE.slideTime * (1 + hero.stat('slideScale')), tags: ['sliding'] });
      this.emit('slide', { source: hero });
    }
  }

  cast(ability) {
    ability.use();
    if (ability.lockout > 0) {
      ability.unit.lockedUntil = Math.max(ability.unit.lockedUntil, this.time + ability.castDelay + ability.lockout);
      ability.unit.locking = ability;
    }
    this.log.push({ t: +this.time.toFixed(1), who: ability.unit.name, what: ability.name });
    this.emit('cast', { source: ability.unit, ability });
    this.at(ability.castDelay, () => {
      if (ability.unit.alive && !ability.unit.cantAct) this.running(ability, () => ability.cast(this)); // put to sleep mid-cast: interrupted
    });
  }

  // Runs `fn` with `ability` as the one dealing damage (so its damage is tagged with it: imbues, Lightning Scroll, Mystic Burst ...).
  running(ability, fn) {
    const before = this.casting;
    this.casting = ability;
    try { this.as(ability, fn); } finally { this.casting = before; }
  }

  step() {
    this.time += DT;
    const due = this.queue.filter((q) => q.t <= this.time); // taken off the queue first: what a delayed effect schedules for "now" runs next step instead of being lost
    this.queue = this.queue.filter((q) => q.t > this.time);
    for (const q of due) q.fn();
    const units = [...this.heroes, ...this.enemies, ...this.minions];
    for (const u of units) u.statuses = u.statuses.filter((s) => s.until > this.time);
    for (const u of units.filter((u) => u.alive)) {
      u.shatter?.(); // a hero's Fragile Items break once it is nearly dead (hero.js)
      if (u.team === 'hero') u.healPool = Math.min(u.stats.maxHealth * HEAL_POOL, u.healPool + u.stats.maxHealth * HEAL_RATE * DT);
      this.heal(u, (u.stats.healthRegen || 0) * DT, 'constant');
      if (u.stats.adaptive && this.time >= (u.adaptAt ??= this.time + ADAPT.every)) { // Adaptive: resist against what has been hurting it
        u.adaptAt = this.time + ADAPT.every;
        const [type] = Object.entries(u.adapted ?? {}).filter(([k]) => ['bullet', 'spirit', 'melee'].includes(k)).sort((a, b) => b[1] - a[1])[0] ?? [];
        u.adapted = {};
        if (type) {
          const way = Math.floor(this.rng() * 3);
          if (way === 0) { const key = `${type}Resist`; u.stats[key] = Math.min(ADAPT.resist, (u.stats[key] ?? 0) + ADAPT.step); }
          else if (way === 1) u.stats.parry = Math.min(ADAPT.parry, (u.stats.parry ?? 0) + ADAPT.step);
          else u.stats.damageDealt = Math.min(ADAPT.damage, (u.stats.damageDealt ?? 0) + ADAPT.step);
        }
      }
      if (u.stats.oocRegen && this.time - u.lastHit > OUT_OF_COMBAT) this.heal(u, u.stats.oocRegen * DT, 'constant', 'Out-of-Combat Regen');
      for (const st of u.statuses) if (st.regen) this.heal(u, st.regen * DT, 'regen', st.by ?? null); // heals over time (Healing Nova, Mystic Regeneration ...), counted under what started them
      for (const st of u.statuses) { // damage over time carried by a status (a Haunt's fire, spores or puddle on the hero): gone with the status
        if (!st.dot || this.time + 1e-9 < st.dot.next || !u.alive) continue;
        st.dot.next += st.dot.every;
        const tick = () => this.damage(st.dot.source, u, st.dot.perSecond * st.dot.every, st.dot.type);
        if (st.dot.move) this.asMove(st.dot.move, tick); else tick(); // an enemy's poison or burn counts under the move that put it on
      }
    }
    for (const [hero, view] of this.views) {
      if (!hero.alive || hero.fled) continue;
      for (const a of hero.abilities) { a.tickCooldown(DT); view.running(a, () => a.tick(view, DT)); }
      for (const it of hero.items) {
        it.cdLeft = Math.max(0, it.cdLeft - DT);
        it.procLeft = Math.max(0, it.procLeft - DT);
        view.as(it, () => { it.tickDots(view, DT); it.tick(view, DT); });
        const mods = it.dynamicMods(view); // conditional stats, re-read every step
        if (mods) { const { tags = [], ...m } = mods; view.addStatus(hero, { id: `item:${it.name}`, duration: DT * 1.5, mods: m, tags }); }
      }
      // an enemy's stun, sleep or curse (not the ult's own void or hold: Return to Shadows, Hotel Guest) interrupts it
      if (hero.lockedUntil > view.time && hero.statuses.some((s) => s.debuff && s.tags.some((t) => STOPS.includes(t)))) view.interrupt(hero);
      if (hero.cantAct || hero.has('stun') || hero.has('blind') || !hero.alive) {
        // Dispel Magic still works through any crowd control but a curse (his call, Oct 28)
        if (hero.alive && !['curse', 'void', 'hold', 'noItems'].some((t) => hero.has(t))) for (const it of hero.items) if (it.whileControlled && it.cdLeft <= 0 && it.want(view)) view.useItem(it);
        continue;
      }
      if (!hero.has('immobilize')) view.move(hero);
      const target = view.foes[0];
      const hiding = hero.statuses.some((s) => s.hold); // Smoke Bomb with nobody able to see her: no gun, no melee (daggers and items still go)
      if (target && !hiding && view.wantMelee(hero, target)) view.melee(hero, target);
      if (target && !hiding && hero.alive && (!hero.has('disarm') || hero.has('perfect'))) view.fireWeapon(hero, target); // Bullet Dance isn't affected by Disarm (the wiki)
      if (!hero.has('silence')) for (const a of [...hero.abilities].reverse()) if (view.time >= hero.lockedUntil && a.ready() && a.want(view)) view.cast(a); // checked per cast: a lasting ultimate cast this step holds the rest too
      if (!hero.has('noItems')) for (const it of hero.items) if (it.active && it.ready() && it.want(view)) view.useItem(it); // noItems: Cursed Relic
    }
    for (const m of this.minions.filter((u) => u.alive && !u.has('sleep') && !u.has('stun'))) { // a minion hits the front enemy once a second
      const target = this.foes[0];
      if (!target) break;
      m.swing = (m.swing ?? 0) + DT * attackRate(m);
      if (m.swing < ATTACK_EVERY - 1e-9) continue;
      m.swing -= ATTACK_EVERY;
      this.damage(m, target, m.stats.dps * ATTACK_EVERY, m.stats.damageType ?? 'bullet');
      if (m.rat && target.alive) {
        this.addStatus(target, { id: `gnaw:${m.name}`, duration: GNAW.seconds, debuff: true, mods: { bulletResist: -GNAW.shred } });
        // Rabies Ronnie: a bite may give a room enemy rabies for good (never a boss, a hero or a rival hero)
        if (m.ronnie && !target.rabid && !target.stats.ccResist && !target.abilities?.length && this.rng() < m.ronnie) { target.rabid = true; this.log.push({ t: +this.time.toFixed(1), who: target.name, what: 'Rabies', special: true }); }
      }
    }
    // a rival with `flee` ({ at, chance }: the Rift's, his ask Nov 6) may run once it drops to `at` of its health: one roll, then it is out of the fight
    for (const e of this.enemies) {
      if (!e.flee || e.fled || e.fleeRolled || !e.alive || e.health > e.flee.at * e.stats.maxHealth) continue;
      e.fleeRolled = true;
      if (this.rng() >= e.flee.chance) continue;
      e.fled = true;
      e.statuses = [];
      this.log.push({ t: +this.time.toFixed(1), who: e.name, what: 'fled', fled: true });
    }
    const minions = this.minions.filter((m) => m.alive);
    for (const enemy of this.enemies.filter((e) => e.team === 'enemy' && e.alive && !e.has('sleep') && !e.has('stun') && !e.has('blind'))) {
      // a summoner calls in a wave every so often (the Patron's troopers, his call Oct 29), up to `cap` standing; a silenced one waits
      const summon = enemy.stats.summon;
      if (summon && !enemy.has('silence') && this.time >= (enemy.summonAt ??= this.time + summon.first) - 1e-9) {
        enemy.summonAt = this.time + summon.every;
        const standing = (enemy.summons ?? []).filter((u) => u.alive).length;
        const wave = summon.wave.slice(0, Math.max(0, summon.cap - standing));
        if (wave.length) this.summon(enemy, wave);
      } // blind: it can't see anyone to attack (Drifter's Eternal Night; not a stun, so a boss doesn't shrug it off)
      const seen = (h) => h.targetable || (h.has('invisible') && !h.has('void') && !h.has('untargetable') && h.statuses.some((s) => s.spot >= (enemy.stats.distance ?? 15))); // Smoke Bomb: close enemies see through it
      // With an ally on the hero's side (/descend's recruited rival, Nov 4) each enemy picks one of them and keeps on it; alone, the hero (no dice used,
      // so a solo fight plays exactly as before).
      const seenHeroes = this.heroes.filter((h) => h.alive && seen(h));
      // its plain attacks may go to a minion too (they draw fire); its specials, blasts, controls and debuffs are for heroes
      const pool = minions.length ? [...seenHeroes, ...minions.filter((m) => m.alive)] : seenHeroes;
      const aimed = pool.length < 2 ? pool[0] : pool.includes(enemy.aim) ? enemy.aim : (enemy.aim = pool[Math.floor(this.rng() * pool.length)]);
      const target = aimed?.team === 'minion' ? (seenHeroes.includes(enemy.heroAim) ? enemy.heroAim : (enemy.heroAim = seenHeroes[0])) : aimed;
      if (!aimed) continue;
      if (enemy.rabid) { // rabies: it turns on the other enemies, and goes back to the hero's side when none are left (his rules, Nov 14)
        const prey = this.enemies.filter((o) => o !== enemy && o.alive && !o.fled && o.team === 'enemy' && !guarded(o));
        if (prey.length && !enemy.has('disarm')) {
          enemy.swing = (enemy.swing ?? 0) + DT * attackRate(enemy);
          if (enemy.swing >= ATTACK_EVERY - 1e-9) {
            enemy.swing -= ATTACK_EVERY;
            const victim = prey.includes(enemy.prey) ? enemy.prey : (enemy.prey = prey[Math.floor(this.rng() * prey.length)]);
            this.damage(enemy, victim, enemy.stats.dps * ATTACK_EVERY, enemy.stats.damageType === 'mixed' ? 'bullet' : enemy.stats.damageType ?? 'bullet');
          }
          continue;
        }
      }
      if (!enemy.has('disarm')) {
        enemy.swing = (enemy.swing ?? 0) + DT * attackRate(enemy);
        if (enemy.swing >= ATTACK_EVERY - 1e-9) {
          enemy.swing -= ATTACK_EVERY;
          const hit = (enemy.stats.dps + (enemy.stats.dpsMaxHealthPct || 0) * aimed.stats.maxHealth) * ATTACK_EVERY;
          // inside its melee range (the game data's MeleeAttemptRange; the hero gets that close by meleeing it) it swings instead: the same hit, as melee
          const type = this.distance(aimed, enemy) <= (enemy.stats.meleeRange ?? 0) ? 'melee' : enemy.stats.damageType;
          if (type === 'mixed') { // half weapon damage, half spirit damage (the Patron): each half meets its own resist
            const opts = { attack: true }; // one attack: a warp dodges both halves
            this.damage(enemy, aimed, hit / 2, 'bullet', opts);
            this.damage(enemy, aimed, hit / 2, 'spirit', opts);
          } else this.damage(enemy, aimed, hit, type, { attack: true });
          // a Haunt's special attack (haunts.js): a chance each second, on top of the hit; a silenced one can't
          const special = enemy.stats.special;
          if (special?.use && target?.alive && !enemy.has('silence') && this.rng() < special.chance) {
            this.log.push({ t: +this.time.toFixed(1), who: enemy.name, what: special.name, enemy: true, special: true });
            this.asMove(special.name, () => special.use(this, enemy, target));
          }
        }
      }
      if (!target) continue; // only a minion in reach: nothing else of its goes off
      // a melee slam every so often on top of the hits (the Walker's); a disarm holds it. Sized against its damage per second, so hardness, growth and Descend follow it.
      const slam = enemy.stats.slam;
      if (slam && target.alive && !enemy.has('disarm') && this.time >= (enemy.slamAt ??= this.time + slam.first) - 1e-9) {
        enemy.slamAt = this.time + slam.every;
        this.log.push({ t: +this.time.toFixed(1), who: enemy.name, what: 'Melee Slam', enemy: true, special: true });
        this.asMove('Melee Slam', () => this.damage(enemy, target, (slam.damage + slam.maxHealthPct * target.stats.maxHealth) * (enemy.stats.dps / slam.dps), 'melee', { special: true }));
      }
      // a blast every so often: it hurts and leaves the hero unable to shoot, cast or use items for a moment, unless the hero gets out of its way or
      // parries it. A silenced enemy holds its blast until the silence ends (his call, Oct 3).
      const blast = enemy.stats.blast;
      if (blast && target.alive && !enemy.has('silence') && this.time >= (enemy.blastAt ??= this.time + blast.every)) {
        enemy.blastAt = this.time + blast.every;
        const what = blast.what ?? 'curse';
        const event = { source: enemy, target, what, parried: false, dodged: false };
        this.emit('blast', event); // Counterspell parries it; Restorative Locket counts it; Mina's Sanguine Retreat slips it (dodged)
        const dodged = event.dodged || (!event.parried && (this.dashDodge(target) || (!target.has('sleep') && this.rng() < dodgeChance(target, enemy) * (1 - (enemy.stats.accuracy ?? 0)))));
        let landed = false;
        if (!event.parried && !dodged) {
          this.damage(enemy, target, blast.damage + blast.maxHealthPct * target.stats.maxHealth, blast.type ?? 'true', { blast: true });
          if (target.alive) landed = this.cc(target, { id: what, duration: blast.curse, tags: blast.tags ?? ['sleep'] });
        }
        if (!event.warped) this.log.push({ t: +this.time.toFixed(1), who: enemy.name, what, verb: landed ? blast.verb : null, dodged, parried: event.parried, enemy: true });
      }
      for (const control of enemy.stats.controls ?? []) {
        control.nextAt ??= this.time + control.every;
        if (!target.alive || enemy.has('silence') || this.time < control.nextAt) continue;
        control.nextAt = this.time + control.every;
        if (this.cc(target, { id: `enemy:${control.id}`, duration: control.duration, tags: control.tags, wakeOnDamage: control.wake })) {
          this.log.push({ t: +this.time.toFixed(1), who: enemy.name, what: control.verb, enemy: true, cc: true });
        }
      }
      // a debuffing attack every so often (/descend, his ask Oct 29): a hit that, unless dodged, leaves a debuff on the hero (a resist shred, a slow,
      // a fire rate cut, poison). Each enemy keeps its own, so two Sharpshooters' shreds add up; debuff resist shortens it, a cleanse removes it.
      for (const d of enemy.stats.debuffs ?? []) {
        d.nextAt ??= this.time + d.every;
        if (!target.alive || enemy.has('silence') || this.time < d.nextAt) continue;
        d.nextAt = this.time + d.every;
        const opts = { special: true };
        this.asMove(d.name, () => {
          if (d.hit) this.damage(enemy, target, enemy.stats.dps * d.hit, d.type ?? 'bullet', opts);
          if (!target.alive || opts.dodged) return;
          const id = `${d.id}:${this.enemies.indexOf(enemy)}`;
          const mods = { ...(d.mods ?? {}) };
          for (const key of ['slow', 'fireRate']) { // a pile of enemies can't take more than DEBUFF_CAP of either
            if (!mods[key]) continue;
            const others = target.statuses.reduce((n, s) => n + (s.debuff && s.id !== id ? Math.abs(s.mods?.[key] || 0) : 0), 0);
            mods[key] = Math.sign(mods[key]) * Math.min(Math.abs(mods[key]), Math.max(0, DEBUFF_CAP - others));
          }
          this.debuff(target, { id, duration: d.duration, mods,
            ...(d.dot || d.dotMax ? { dot: { source: enemy, perSecond: d.dotMax ? target.stats.maxHealth * d.dotMax : enemy.stats.dps * d.dot, type: d.dotType ?? 'spirit', every: 0.5, next: this.time + 0.5 } } : {}) });
        });
        this.log.push({ t: +this.time.toFixed(1), who: enemy.name, what: d.name, enemy: true, special: !opts.dodged, dodged: !!opts.dodged, note: d.note });
      }
    }
  }

  // A summoner's wave joins the fight: each one a share of the summoner's own health and damage (`health` / `dps` in the wave), so whatever sized the
  // summoner (hardness, clears, /descend's depth and ascension, the Patron's Favor) sizes them. They stand in front of it, numbered by the fight.
  summon(by, wave) {
    by.summons ??= [];
    const standing = by.summons.filter((u) => u.alive).length;
    wave.forEach((w, i) => {
      const u = enemy(w.name, { maxHealth: by.stats.maxHealth * w.health, dps: by.stats.dps * w.dps, distance: w.distance ?? 15, damageType: w.damageType ?? 'bullet', bulletResist: w.resist ?? 0, spiritResist: w.resist ?? 0 });
      Object.assign(u.stats, { accuracy: by.stats.accuracy, outputFloor: by.stats.outputFloor }, w.special ? { special: w.special } : {});
      Object.assign(u, { summoner: by, offset: (by.offset ?? 0) + SPREAD * (standing + i), label: `${w.name} ${(this.summoned = (this.summoned ?? 0) + 1)}` });
      by.summons.push(u);
      this.enemies.push(u);
    });
    this.log.push({ t: +this.time.toFixed(1), who: by.name, what: wave.length === 1 ? wave[0].name : `${wave.length} Troopers`, summon: true, enemy: true });
  }

  // An active item fires (its cooldown starts, other items and abilities hear about it, then it does its thing).
  useItem(item) {
    item.cdLeft = item.cooldown;
    this.log.push({ t: +this.time.toFixed(1), who: item.unit.name, what: item.name });
    this.emit('cast', { source: item.unit, item });
    this.as(item, () => item.cast(this));
  }

  // Runs until `seconds` pass or one side is dead.
  run(seconds) {
    const end = this.time + seconds;
    while (this.time < end && this.heroes.some((h) => h.alive) && this.enemies.some((e) => e.alive)) this.step();
    return { time: this.time, won: this.enemies.every((e) => !e.alive), heroesAlive: this.heroes.filter((h) => h.alive).length };
  }
}

// A plain enemy for fights: health, damage per second, resists, distance in metres, health regen per second,
// dpsMaxHealthPct = extra damage per second as a share of the target's max health (the Patron's "440 + 5% HP"),
// damageType = what its attack is ('bullet' | 'spirit' | 'melee' | 'mixed' = half each): which of the hero's resists takes the edge off it,
// meleeRange = within this many metres its attack is melee instead (0: never),
// slam = { first, every (s), damage, maxHealthPct, dps (the damage per second those numbers belong to) }: an extra melee hit (the Walker's),
// blast = { every (s), damage, maxHealthPct, curse (s the hero can't act), type = 'true', what = 'curse' }: the Patron's cursing blast, the Walker's stomp,
// souls = what it is worth on its own (Cultist Sacrifice). A Haunt's `special` (haunts.js) is put on its stats by play.js.
// What put a status on: the item (ids are "<item>:<what>" or "item:<item>"), else the ability that cast it, else its id.
const guarded = (e) => !!e.summons?.some((u) => u.alive); // a summoner can't be hurt while one of its summons stands
const statusName = (st) => (st.id.startsWith('item:') ? st.id.slice(5) : st.id.includes(':') ? st.id.split(':')[0] : st.from?.name ?? st.id);
const capital = (text) => text[0].toUpperCase() + text.slice(1);
const enemy = (name, { maxHealth = 1000, dps = 20, bulletResist = 0, spiritResist = 0, distance = 15, healthRegen = 0, dpsMaxHealthPct = 0, damageType = 'bullet', meleeRange = 0, slam = null, blast = null, controls = [], debuffs = [], souls = 0 } = {}) =>
  new Unit({ name, team: 'enemy', stats: { maxHealth, dps, dpsMaxHealthPct, damageType, meleeRange, slam, blast: blast && { ...blast }, controls: controls.map((c) => ({ ...c, tags: [...c.tags] })), debuffs: debuffs.map((d) => ({ ...d })), bulletResist, spiritResist, distance, healthRegen, lifesteal: 0, souls } });

// What each enemy dealt the hero over one or more fights (the breakdown's Enemy Damage): [{ name, dealt, by: [{ name, dealt }] }], most first.
// An NPC's comes from `taken`, a rival hero's (a duel, a /descend rival) from its own `breakdown`. Two of a kind in one fight are numbered like the fight screen.
function enemyDamage(fights) {
  const out = [];
  for (const f of fights) {
    f.enemies.forEach((e, i) => {
      const moves = f.taken.get(e) ?? (e.team === 'hero' ? f.breakdown.get(e) : null);
      if (!moves) return;
      const twin = f.enemies.filter((x) => x.name === e.name).length > 1;
      const by = [...moves].map(([name, dealt]) => ({ name, dealt: Math.round(dealt) })).filter((m) => m.dealt > 0).sort((a, b) => b.dealt - a.dealt);
      if (by.length) out.push({ name: twin ? `${e.name} ${i + 1}` : e.name, dealt: by.reduce((s, m) => s + m.dealt, 0), by });
    });
    for (const h of f.heroes) { // what the hero's own abilities cost it (Victor's Aura of Suffering)
      const by = [...f.self.get(h) ?? []].map(([name, dealt]) => ({ name, dealt: Math.round(dealt) })).filter((m) => m.dealt > 0).sort((a, b) => b.dealt - a.dealt);
      if (by.length) out.push({ name: `${h.name} (Self)`, self: true, dealt: by.reduce((s, m) => s + m.dealt, 0), by });
    }
  }
  return out.sort((a, b) => b.dealt - a.dealt);
}

// What healed a hero over one or more fights (the breakdown's Healing): { total, by: [{ name, healed, times: [[second, amount]] }] }, most first.
function healBreakdown(hero, fights) {
  const by = new Map();
  for (const f of fights) {
    for (const [what, n] of f.healed.get(hero) ?? []) by.set(what, { name: what, healed: (by.get(what)?.healed ?? 0) + n, times: by.get(what)?.times ?? [], parts: by.get(what)?.parts ?? new Map() });
    for (const [what, parts] of f.healedBy.get(hero) ?? []) for (const [sub, n] of parts) by.get(what).parts.set(sub, (by.get(what).parts.get(sub) || 0) + n);
    for (const h of f.healLog) if (h.unit === hero && by.has(h.what)) by.get(h.what).times.push([h.t, Math.round(h.amount)]);
  }
  const list = [...by.values()].map((x) => ({ ...x, healed: Math.round(x.healed), times: x.times.filter(([, n]) => n > 0), parts: [...x.parts].map(([name, n]) => ({ name, healed: Math.round(n) })).filter((p) => p.healed > 0).sort((a, b) => b.healed - a.healed) })).filter((x) => x.healed > 0).sort((a, b) => b.healed - a.healed);
  return { total: list.reduce((s, x) => s + x.healed, 0), by: list };
}

// A hero's damage over one or more fights, by what dealt it (the Damage Breakdown button): [{ name, kind: 'weapon' | 'ability' | 'item', dealt }], most first.
function damageBreakdown(hero, fights) {
  const total = new Map();
  const made = new Map();
  for (const f of fights) {
    for (const [what, n] of f.breakdown.get(hero) ?? []) total.set(what, (total.get(what) || 0) + n);
    for (const [what, parts] of f.madeOf?.get(hero) ?? []) {
      if (!made.has(what)) made.set(what, new Map());
      for (const [name, n] of parts) made.get(what).set(name, (made.get(what).get(name) || 0) + n);
    }
  }
  const partsOf = (what) => [...(made.get(what) ?? [])].map(([name, n]) => ({ name, dealt: Math.round(n) })).filter((p) => p.dealt > 0).sort((a, b) => (a.name === 'Base') - (b.name === 'Base') || b.dealt - a.dealt);
  const items = new Set(hero.items.map((it) => it.name));
  const weapon = new Set(['Gun', 'Heavy Melee', 'Other']); // anything else is an ability, also one the hero no longer has (Silver's after the wolf)
  return [...total].map(([name, dealt]) => ({ name, kind: items.has(name) ? 'item' : weapon.has(name) ? 'weapon' : 'ability', dealt: Math.round(dealt), parts: partsOf(name) }))
    .filter((d) => d.dealt > 0).sort((a, b) => b.dealt - a.dealt);
}

module.exports = { PLOT_ARMOR, guarded,damageBreakdown, enemyDamage, healBreakdown, PELLETS, PRECISION, overflow, MISS, missChance, headshotChance, isHeadshot, HEADSHOT_BONUS, pelletChance, DUEL, DT, Unit, Fight, enemy, HEAL_RATE, HEAL_POOL, LIFESTEAL_VS_NPC, BULLET_LIFESTEAL_VS_NPC, SPIRIT_LIFESTEAL_VS_NPC, SPREAD, DODGE, dodgeChance, MELEE, HELPLESS };
