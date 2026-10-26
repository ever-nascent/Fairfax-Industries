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
const MOVE = { dashGap: 1, airTime: 1, slideEvery: 6, slideTime: 1 };
// Hero against hero (an encounter's duel; his call, Oct 3: "half damage plus 25% miss"): heroes deal `damage` of their damage to each other and
// `miss` of their gun shots at a hero miss, so a duel lasts about half a minute instead of ten seconds and no pairing is decided before it starts.
// Nothing here touches a fight against NPCs.
const DUEL = { damage: 0.5, miss: 0.25 };
// Shotguns (his call, Oct 3: "shotguns have to have chances for some to miss"): each pellet of a spread shot rolls on its own. Standing close
// (within `full` metres, e.g. right after a melee hit) every pellet lands; the chance falls to `far` of them landing at `at` metres and beyond.
// A gun that deals one shot's damage however many pellets hit (Drifter) has nothing to miss. ponytail: the wiki has no spread numbers; his to tune.
const PELLETS = { full: 5, at: 15, far: 0.7 };
// Precision (his call, Oct 22: a flat stat, 25 to start, +1% a point, raised by permanent buffs): a bullet is a headshot with `precision` percent
// chance, and every point above the base adds a percentage point to a spread pellet landing (never above all of them). ponytail: the base adds
// nothing to pellets, so shotguns are as accurate as before until something raises it; his to say otherwise.
const PRECISION = { base: 25 };
const headshotChance = (unit) => clamp(unit.stat('precision') / 100, 0, 1);
const pelletChance = (distance, precision = PRECISION.base) => clamp(1 - (1 - PELLETS.far) * clamp((distance - PELLETS.full) / (PELLETS.at - PELLETS.full), 0, 1) + (precision - PRECISION.base) / 100, 0, 1);
const { stackResist } = require('./buffs');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const CC_TAGS = ['sleep', 'stun', 'disarm', 'silence', 'immobilize'];
const CANT_ACT = ['sleep', 'void', 'hold']; // asleep / cursed, in a void state (Ethereal Shift, Prism Blast, Magic Carpet), lying low (Shadow Weave)
const OWN_EVENTS = new Set(['dash', 'slide', 'reloadStart', 'reloadEnd', 'cast', 'melee', 'unstealth', 'heal', 'cc', 'ccLanded', 'blast']); // heard only by the hero they are about
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
    this.close = null; // the enemy it stands next to after a melee, until closeUntil
    this.closeUntil = 0;
  }

  get alive() { return this.health > 0; }
  mod(stat) { return this.statuses.reduce((sum, s) => sum + (s.mods?.[stat] || 0), 0); }
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

class Fight {
  constructor({ heroes, enemies, rng = Math.random, time = 0 }) {
    this.heroes = heroes;
    this.enemies = enemies;
    this.rng = rng;
    this.time = time; // a siege's next stage carries on from the last one's clock
    this.queue = []; // [{ t, fn }] delayed effects
    this.log = []; // [{ t, who, what }] casts, for tests and later a recap
    this.dealt = new Map(); // unit -> damage it dealt
    this.breakdown = new Map(); // hero -> Map(what dealt it: 'Gun' | 'Heavy Melee' | an ability or item name -> damage) (the Damage Breakdown button)
    this.by = null; // the ability or item whose hook, tick, cast or delayed effect is running right now (what its damage is counted under)
    this.bonusSouls = 0; // souls items earned in this fight (wiki souls; a won trip pays them at the payout scale)
    this.casting = null; // the ability whose effect is running right now (its damage is tagged with it)
    // Who acts in this fight, and what each sees. A member's hero sees the fight as it is. A rival hero among the enemies (an encounter) sees it mirrored:
    // it is the hero and the member's heroes are its enemies, so its abilities and items work unchanged. Both share the clock, queue, log and dice.
    this.views = new Map(heroes.map((h) => [h, this]));
    const rivals = enemies.filter((e) => e.team === 'hero');
    if (rivals.length) {
      const mirror = Object.create(this);
      Object.assign(mirror, { heroes: rivals, enemies: heroes, casting: null, by: null, bonusSouls: 0 });
      for (const rival of rivals) this.views.set(rival, mirror);
    }
    let at = 0; // where each enemy stands behind the front one, in metres (a lone enemy rolls nothing)
    enemies.forEach((e, i) => { e.offset = i ? (at += SPREAD * (0.5 + rng())) : 0; });
  }

  at(delay, fn) { const by = this.by; this.queue.push({ t: this.time + delay, fn: () => this.as(by, fn) }); } // a delayed effect counts for what scheduled it
  // Runs `fn` with `by` (an ability or item) as what deals its damage.
  as(by, fn) {
    const before = this.by;
    this.by = by;
    try { return fn(); } finally { this.by = before; }
  }

  get foes() { return this.enemies.filter((e) => e.alive && e.targetable); } // enemies still standing (and in sight: a rival hero can hide)
  // The enemies an area of `radius` metres reaches: the front one (the hero is on it) and those standing close enough behind it.
  near(radius) { const foes = this.foes; return foes.filter((e) => (e.offset ?? 0) - (foes[0].offset ?? 0) <= radius); }
  // How far the hero is from a target: right next to it for a moment after meleeing it, else where it stands.
  distance(hero, target) { return hero.close === target && hero.closeUntil > this.time ? MELEE.closeDistance : target.stats.distance ?? 15; }

  addStatus(unit, status) {
    let { id, duration } = status;
    if (unit.stats.ccResist && status.tags?.some((t) => CC_TAGS.includes(t))) duration *= 1 - unit.stats.ccResist; // bosses shrug off part of a stun, sleep or disarm
    if (duration <= 0) return;
    unit.statuses = unit.statuses.filter((s) => s.id !== id); // same id refreshes
    unit.statuses.push({ mods: {}, tags: [], ...status, until: this.time + duration });
  }
  removeStatus(unit, id) { unit.statuses = unit.statuses.filter((s) => s.id !== id); }
  // Shortens the debuffs on a unit by `share` (1 = removes them). `stuns` false leaves crowd control alone (the "non-stun debuffs" cleanses).
  cleanse(unit, share = 1, { stuns = true } = {}) {
    for (const s of unit.statuses.filter((st) => st.debuff && (stuns || !st.tags.some((t) => CC_TAGS.includes(t))))) s.until = this.time + (s.until - this.time) * (1 - share);
  }

  // Crowd control on a hero (an enemy blast's curse or stomp). Unstoppable ignores it, an item may block it (Cloak of Opportunity), debuff resist
  // shortens it, and items hear about it (Reactive Barrier). Returns true if it landed.
  cc(unit, status) {
    if (unit.has('unstoppable')) return false;
    const event = { target: unit, status, blocked: false };
    this.emit('cc', event);
    if (event.blocked) return false;
    this.addStatus(unit, { ...status, duration: status.duration * (1 - clamp(unit.stat('statusResist'), 0, 0.9)), debuff: true });
    this.emit('ccLanded', event);
    return true;
  }

  // A debuff that isn't crowd control (a burn, a slow, a heal cut from a Haunt's special): debuff resist shortens it, a cleanse removes it.
  debuff(unit, status) {
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
      for (const it of hero.items) if (event !== 'attacked' || !it.active) view.as(it, () => it.on(event, view, payload));
    }
  }

  // A status may carry a `barrier` (damage it soaks before health; `raw: true` = it ignores its owner's resists).
  // The one place damage happens. type: 'bullet' | 'spirit' | 'melee' (nothing here resists it) | 'true' (no resist takes anything off it: the Patron's
  // blast). opts.events = false skips the hooks (extra damage that must not trigger itself), opts.keepsStealth marks hits that don't break invisibility,
  // opts.attack / opts.blast mark an enemy's hit and blast (items may parry or soften them first: the 'attacked' hook), opts.ability is the ability
  // that dealt it (set by the engine while one is running).
  damage(source, target, amount, type = 'spirit', opts = {}) {
    if (!target.alive || opts.dodged) return 0;
    if (source.team === 'hero' && target.team === 'hero' && source !== target) amount *= DUEL.damage; // a duel
    if (source.team === 'hero' && this.casting) opts.ability ??= this.casting;
    if (opts.attack || opts.blast || opts.special || opts.melee) { // defensive items hear rival melee too; only an `attack` can be parried
      const hit = { source, target, amount, type, opts };
      this.emit('attacked', hit);
      amount = hit.amount;
      if (amount <= 0) return 0;
    }
    if (type === 'bullet' && !opts.unavoidable && !opts.noEvade && this.rng() < target.mod('evasion')) return 0; // unavoidable (Armor Piercer), noEvade (Lucky Shot's bonus)
    const npcOnly = source.team === 'hero' ? target.stats.npcBulletResist ?? 0 : 0; // Monster Rounds' "vs. NPCs" resist: taken back out of the stack against a rival hero
    const bulletResist = npcOnly ? 1 - (1 - target.stats.bulletResist) / (1 - npcOnly) : target.stats.bulletResist;
    const resist = type === 'true' || type === 'melee' ? 0 : type === 'bullet' ? (opts.ignoreBulletResist ? 0 : stackResist(bulletResist, target.mod('bulletResist')))
      : opts.ignoreSpiritResist ? 0 : stackResist(target.stats.spiritResist, target.mod('spiritResist')); // temporary resists and shreds multiply with the unit's own too
    let incoming = amount * Math.max(0, 1 + (source.stats.damageDealt ?? 0) + source.mod('damageDealt')) * (1 - clamp(resist, -1, 0.9)) * Math.max(0, 1 + target.mod('damageTaken'));
    if (type === 'bullet') incoming *= Math.max(0, 1 + target.mod('bulletTaken')); // Metal Skin
    if (type === 'melee') incoming *= Math.max(0, 1 + target.mod('meleeTaken')); // melee resist taken off an enemy (Apollo's Riposte)
    if (type === 'spirit') {
      incoming *= (1 + target.mod('spiritAmp')) * Math.max(0, 1 + target.mod('spiritTaken')) * Math.max(0, 1 + source.mod('spiritDealt')); // e.g. Escalating Exposure; spiritDealt: the source's own spirit damage boost (Celeste's Radiant Daggers)
      if (source.team === 'enemy') incoming *= Math.max(0, 1 + source.mod('spirit') / 100); // spirit power taken from an enemy: 1% less of its spirit damage a point (his call, Oct 3)
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
    if (dealt >= target.health && (target.abilities.some((a) => a.preventDeath?.(this)) || target.items.some((it) => it.preventDeath?.(this)))) dealt = Math.max(0, target.health - 1); // Victor's Shocking Reanimation first (the wiki), then Cheat Death
    target.health -= dealt;
    if (dealt > 0) target.lastHit = this.time;
    if (!target.alive && target.rejuvs > 0) this.rejuvenate(target);
    this.dealt.set(source, (this.dealt.get(source) || 0) + dealt);
    if (dealt > 0 && this.views.has(source)) { // a hero's damage, by what dealt it
      const what = this.by?.name ?? (type === 'melee' ? 'Heavy Melee' : type === 'bullet' ? 'Gun' : 'Other');
      if (!this.breakdown.has(source)) this.breakdown.set(source, new Map());
      const mine = this.breakdown.get(source);
      mine.set(what, (mine.get(what) || 0) + dealt);
    }
    // lifestealOn / spiritLifestealOn: lifesteal against this one target (Apollo's Riposte, Celeste's Light Eater)
    const hero = target.team === 'hero'; // full strength off a rival hero
    if (type === 'bullet' || type === 'melee') { const steal = (type === 'bullet' ? source.stat('lifesteal') : 0) + target.mod('lifestealOn'); if (steal > 0) this.heal(source, dealt * steal * (hero ? 1 : BULLET_LIFESTEAL_VS_NPC), 'lifesteal'); }
    else if (type === 'spirit') { const steal = source.stat('spiritLifesteal') + target.mod('spiritLifestealOn'); if (steal > 0) this.heal(source, dealt * steal * (hero ? 1 : SPIRIT_LIFESTEAL_VS_NPC), 'lifesteal'); }
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
      if (!target.alive) this.emit('kill', payload);
    }
    if (!target.alive && target.stats.special?.onDeath && !target.burst) { // a Haunt that goes off as it dies (the Specimen)
      target.burst = true;
      const victim = this.heroes.find((h) => h.alive);
      if (victim) { this.log.push({ t: +this.time.toFixed(1), who: target.name, what: target.stats.special.name, enemy: true, special: true }); target.stats.special.onDeath(this, target, victim); }
    }
    return dealt;
  }

  // A Rejuv (the Mid-Boss's gift): a hero who dies comes back at full health after 3 s (can't act or be hurt meanwhile); Eternal Gift shortens it.
  rejuvenate(unit) {
    unit.rejuvs -= 1;
    unit.health = unit.stats.maxHealth;
    const cut = Math.max(0, ...unit.items.map((it) => it.respawnCut?.(this) ?? 0));
    this.addStatus(unit, { id: 'rejuv', duration: REJUV_DELAY * (1 - cut), tags: ['sleep'], mods: { damageTaken: -1 } });
    this.log.push({ t: +this.time.toFixed(1), who: unit.name, what: 'Rejuvenated' });
  }

  // kind: 'cast' (an ability's or item's heal: Healing Tempo hears it), 'regen' or 'lifesteal'. Heal amp (Healing Booster, or an enemy's healing
  // cut: Toxic Bullets, Nullification Burst) scales it. Returns what was healed.
  heal(unit, amount, kind = 'cast') {
    if (!unit.alive || !(amount > 0)) return 0;
    const amp = unit.stat('healAmp');
    amount *= Math.max(0, 1 + (kind === 'constant' ? Math.min(0, amp) : amp)); // 'constant' regen (the sheet's): healing cuts hit it, Healing Booster doesn't (the wiki)
    if (unit.team === 'hero') { amount = Math.min(amount, unit.healPool); unit.healPool -= amount; }
    amount = Math.min(amount, unit.stats.maxHealth - unit.health);
    unit.health += amount;
    if (kind === 'cast' && amount > 0) this.emit('heal', { target: unit, amount });
    return amount;
  }

  // A heal over time (Healing Nova, Healing Rite ...): counts as one cast heal when it starts.
  regen(unit, id, perSecond, duration) {
    this.addStatus(unit, { id, duration, regen: perSecond });
    this.emit('heal', { target: unit, amount: perSecond * duration });
  }

  // Weapon damage of one shot at a target's distance (linear falloff between the wiki's start and end range, which items with attack range push out).
  shotDamage(hero, target) {
    const s = hero.stats;
    const f = s.falloff;
    const far = 1 + (s.attackRange ?? 0);
    const d = this.distance(hero, target);
    const scale = d <= f.start * far ? f.startScale
      : d >= f.end * far ? f.endScale : f.startScale + (f.endScale - f.startScale) * ((d - f.start * far) / ((f.end - f.start) * far));
    const itemBonus = hero.items.reduce((sum, it) => sum + it.weaponBonus(this, target), 0); // distance, target health, build-up ... bonuses
    const npcOnly = target.team === 'hero' ? s.npcWeapon ?? 0 : 0; // Monster Rounds' "vs. NPCs" damage does nothing to a rival hero
    return (s.bulletDamage + hero.mod('bulletDamage')) * s.pellets * (s.weaponDamageMult - npcOnly + hero.mod('weaponDamage') + itemBonus) * scale;
  }

  fireWeapon(hero, target) {
    const w = hero.weapon;
    if (w.reloadLeft > 0) {
      w.reloadLeft -= DT * (1 + hero.mod('reloadSpeed'));
      if (w.reloadLeft <= 0) { w.clip = hero.stats.clip; this.emit('reloadEnd', { source: hero }); }
      return;
    }
    if (this.time < hero.busyUntil) return; // mid-swing
    w.charge += hero.stats.fireRate * (1 + hero.mod('fireRate')) * (1 - slowed(hero)) * DT;
    const infinite = hero.has('infiniteClip');
    while (w.charge >= 1 && (w.clip > 0 || infinite) && target.alive) {
      w.charge -= 1;
      if (!infinite) w.clip -= 1;
      if (target.team === 'hero' && this.rng() < DUEL.miss) continue; // a shot at a hero can miss (a duel)
      const opts = target.team === 'hero' ? { attack: true } : {}; // a shot at a hero is an attack it may parry or soften (a duel)
      const pellets = hero.stats.pellets;
      if (pellets > 1) { // a shotgun: how many of its pellets land
        const miss = 1 - pelletChance(this.distance(hero, target), hero.stat('precision'));
        let landed = Math.min(pellets, hero.stats.surePellets ?? 0); // pellets that can't miss (Rat King: one of his two, the wiki)
        for (let i = landed; i < pellets; i++) if (!(this.rng() < miss)) landed++;
        if (!landed) continue;
        opts.landed = landed / pellets; // build-up items scale with it (items.js)
      }
      for (const it of hero.items) for (const [k, v] of Object.entries(it.shotOpts(this, target))) opts[k] ||= v; // one item's "no" never undoes another's "yes"
      this.damage(hero, target, this.shotDamage(hero, target) * (opts.landed ?? 1), 'bullet', opts);
    }
    if (w.clip <= 0 && !infinite) this.reload(hero);
  }

  reload(hero) {
    hero.weapon.reloadLeft = hero.stats.reload;
    hero.weapon.charge = 0;
    this.emit('reloadStart', { source: hero });
  }

  // Melee (his call, Oct 3): only with a reason: the front enemy can't hit back, the gun is reloading anyway, or an item or ability wants a swing.
  wantMelee(hero, target) {
    return this.time >= hero.meleeAt && (HELPLESS.some((t) => target.has(t)) || hero.weapon.reloadLeft > 0
      || hero.items.some((it) => it.wantsMelee(this, target)) || hero.abilities.some((a) => a.wantsMelee?.(this, target)));
  }

  // A heavy melee at `target`: the hero's wiki melee damage, more with melee items. Nothing on a farm resists it.
  melee(hero, target) {
    hero.meleeAt = this.time + MELEE.every;
    if (!(hero.weapon.reloadLeft > 0)) hero.busyUntil = this.time + MELEE.busy;
    hero.close = target;
    hero.closeUntil = this.time + MELEE.closeFor;
    const bonus = hero.items.reduce((sum, it) => sum + it.meleeBonus(this, target), 0);
    const amount = (hero.stats.heavyMelee ?? 0) * (1 + hero.stat('meleeDamage') + bonus);
    const opts = { melee: true };
    const dealt = this.damage(hero, target, amount, 'melee', opts);
    if (!opts.dodged) this.emit('melee', { source: hero, target, amount, dealt });
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
    const units = [...this.heroes, ...this.enemies];
    for (const u of units) u.statuses = u.statuses.filter((s) => s.until > this.time);
    for (const u of units.filter((u) => u.alive)) {
      if (u.team === 'hero') u.healPool = Math.min(u.stats.maxHealth * HEAL_POOL, u.healPool + u.stats.maxHealth * HEAL_RATE * DT);
      this.heal(u, (u.stats.healthRegen || 0) * DT, 'constant');
      if (u.stats.oocRegen && this.time - u.lastHit > OUT_OF_COMBAT) this.heal(u, u.stats.oocRegen * DT, 'constant');
      for (const st of u.statuses) if (st.regen) this.heal(u, st.regen * DT, 'regen'); // heals over time (Healing Nova, Mystic Regeneration ...)
      for (const st of u.statuses) { // damage over time carried by a status (a Haunt's fire, spores or puddle on the hero): gone with the status
        if (!st.dot || this.time + 1e-9 < st.dot.next || !u.alive) continue;
        st.dot.next += st.dot.every;
        this.damage(st.dot.source, u, st.dot.perSecond * st.dot.every, st.dot.type);
      }
    }
    for (const [hero, view] of this.views) {
      if (!hero.alive) continue;
      for (const a of hero.abilities) { a.tickCooldown(DT); view.running(a, () => a.tick(view, DT)); }
      for (const it of hero.items) {
        it.cdLeft = Math.max(0, it.cdLeft - DT);
        it.procLeft = Math.max(0, it.procLeft - DT);
        view.as(it, () => { it.tickDots(view, DT); it.tick(view, DT); });
        const mods = it.dynamicMods(view); // conditional stats, re-read every step
        if (mods) { const { tags = [], ...m } = mods; view.addStatus(hero, { id: `item:${it.name}`, duration: DT * 1.5, mods: m, tags }); }
      }
      if (hero.cantAct || hero.has('stun') || hero.has('blind') || !hero.alive) continue; // a stun, disarm or silence on a hero only ever comes from a rival hero
      view.move(hero);
      const target = view.foes[0];
      if (target && view.wantMelee(hero, target)) view.melee(hero, target);
      if (target && hero.alive && !hero.has('disarm')) view.fireWeapon(hero, target);
      if (!hero.has('silence')) for (const a of [...hero.abilities].reverse()) if (a.ready() && a.want(view)) view.cast(a);
      if (!hero.has('noItems')) for (const it of hero.items) if (it.active && it.ready() && it.want(view)) view.useItem(it); // noItems: Cursed Relic
    }
    for (const enemy of this.enemies.filter((e) => e.team === 'enemy' && e.alive && !e.has('sleep') && !e.has('stun') && !e.has('blind'))) { // blind: it can't see anyone to attack (Drifter's Eternal Night; not a stun, so a boss doesn't shrug it off)
      const target = this.heroes.find((h) => h.alive && h.targetable);
      if (!target) continue;
      if (!enemy.has('disarm')) {
        enemy.swing = (enemy.swing ?? 0) + DT * (1 - slowed(enemy));
        if (enemy.swing >= ATTACK_EVERY - 1e-9) {
          enemy.swing -= ATTACK_EVERY;
          const hit = (enemy.stats.dps + (enemy.stats.dpsMaxHealthPct || 0) * target.stats.maxHealth) * ATTACK_EVERY;
          if (enemy.stats.damageType === 'mixed') { // half weapon damage, half spirit damage (the Patron): each half meets its own resist
            const opts = { attack: true }; // one attack: a warp dodges both halves
            this.damage(enemy, target, hit / 2, 'bullet', opts);
            this.damage(enemy, target, hit / 2, 'spirit', opts);
          } else this.damage(enemy, target, hit, enemy.stats.damageType, { attack: true });
          // a Haunt's special attack (haunts.js): a chance each second, on top of the hit; a silenced one can't
          const special = enemy.stats.special;
          if (special?.use && target.alive && !enemy.has('silence') && this.rng() < special.chance) {
            this.log.push({ t: +this.time.toFixed(1), who: enemy.name, what: special.name, enemy: true, special: true });
            special.use(this, enemy, target);
          }
        }
      }
      // a blast every so often: it hurts and leaves the hero unable to shoot, cast or use items for a moment, unless the hero gets out of its way or
      // parries it. A silenced enemy holds its blast until the silence ends (his call, Oct 3).
      const blast = enemy.stats.blast;
      if (blast && target.alive && !enemy.has('silence') && this.time >= (enemy.blastAt ??= this.time + blast.every)) {
        enemy.blastAt = this.time + blast.every;
        const what = blast.what ?? 'curse';
        const event = { source: enemy, target, what, parried: false, dodged: false };
        this.emit('blast', event); // Counterspell parries it; Restorative Locket counts it; Mina's Sanguine Retreat slips it (dodged)
        const dodged = event.dodged || (!event.parried && !target.has('sleep') && this.rng() < dodgeChance(target, enemy));
        if (!event.parried && !dodged) {
          this.damage(enemy, target, blast.damage + blast.maxHealthPct * target.stats.maxHealth, blast.type ?? 'true', { blast: true });
          if (target.alive) this.cc(target, { id: what, duration: blast.curse, tags: ['sleep'] });
        }
        if (!event.warped) this.log.push({ t: +this.time.toFixed(1), who: enemy.name, what, dodged, parried: event.parried, enemy: true });
      }
    }
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
// damageType = what its attack is ('bullet' | 'spirit' | 'mixed' = half each): which of the hero's resists takes the edge off it,
// blast = { every (s), damage, maxHealthPct, curse (s the hero can't act), type = 'true', what = 'curse' }: the Patron's cursing blast, the Walker's stomp,
// souls = what it is worth on its own (Cultist Sacrifice). A Haunt's `special` (haunts.js) is put on its stats by play.js.
const enemy = (name, { maxHealth = 1000, dps = 20, bulletResist = 0, spiritResist = 0, distance = 15, healthRegen = 0, dpsMaxHealthPct = 0, damageType = 'bullet', blast = null, souls = 0 } = {}) =>
  new Unit({ name, team: 'enemy', stats: { maxHealth, dps, dpsMaxHealthPct, damageType, blast: blast && { ...blast }, bulletResist, spiritResist, distance, healthRegen, lifesteal: 0, souls } });

// A hero's damage over one or more fights, by what dealt it (the Damage Breakdown button): [{ name, kind: 'weapon' | 'ability' | 'item', dealt }], most first.
function damageBreakdown(hero, fights) {
  const total = new Map();
  for (const f of fights) for (const [what, n] of f.breakdown.get(hero) ?? []) total.set(what, (total.get(what) || 0) + n);
  const items = new Set(hero.items.map((it) => it.name));
  const weapon = new Set(['Gun', 'Heavy Melee', 'Other']); // anything else is an ability, also one the hero no longer has (Silver's after the wolf)
  return [...total].map(([name, dealt]) => ({ name, kind: items.has(name) ? 'item' : weapon.has(name) ? 'weapon' : 'ability', dealt: Math.round(dealt) }))
    .filter((d) => d.dealt > 0).sort((a, b) => b.dealt - a.dealt);
}

module.exports = { damageBreakdown, PELLETS, PRECISION, headshotChance, pelletChance, DUEL, DT, Unit, Fight, enemy, HEAL_RATE, HEAL_POOL, LIFESTEAL_VS_NPC, BULLET_LIFESTEAL_VS_NPC, SPIRIT_LIFESTEAL_VS_NPC, SPREAD, DODGE, dodgeChance, MELEE, HELPLESS };
