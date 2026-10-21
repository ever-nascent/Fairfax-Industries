// Hero Farming: what items do in a fight. An item's stats (health, fire rate, lifesteal ...) are added by stats.js; this file is the rest of what
// its card says: procs, buffs that start after a reload, a cast, a dash or a melee, debuffs on enemies, barriers, heals, parries, imbues and the
// actives a hero uses by itself. Numbers come from the wiki card through `value()` (with spirit power, boon and duration scaling), so only the rules
// live here, grouped by the system that drives them. Every shop item and legendary is here or is plain stats (stats.js). Rules: server-plan.md.
// The engine (engine.js) calls these hooks, like it does for a hero's abilities (ability.js):
//   on(event, fight, payload)    'damage' 'bulletHit' 'kill' 'cast' 'reloadStart' 'reloadEnd' 'melee' 'dash' 'slide' 'heal' 'attacked' (an enemy hit
//                                about to land: change hit.amount) 'blast' (set parried) 'cc' (set blocked) 'ccLanded' 'unstealth'
//   tick(fight, dt)              every step; the engine counts `cdLeft` and `procLeft` down and ticks the item's damage over time
//   dynamicMods(fight)           stat changes that depend on the moment (health, stacks), as { fireRate: 0.07 } or null
//   weaponBonus(fight, target)   extra weapon damage (a fraction) against that target; meleeBonus the same for a heavy melee
//   wantsMelee(fight, target)    true when the hero should walk up and melee now (a melee item's proc is ready)
//   shotOpts(fight, target)      options for the next bullet ({ ignoreBulletResist })
//   want(fight) / cast(fight)    actives: when to use it, and what it does
//   imbue                        what it adds to the ability it is imbued into ({ spirit, cdr, duration, range, charges, chargesNonCharge })
//   preventDeath(fight)          true to survive a killing blow; respawnCut(fight) how much shorter a Rejuv's wait is
// Enemies on a farm are all NPCs, so "enemy hero" effects work on every enemy here; the wiki's own NPC reductions are kept where it gives them.
// Allies' items work on the hero only (it fights alone).
// ponytail: headshots and the active-reload timing are chances (below), the engine has no aiming.
const { MIN_COOLDOWN } = require('./ability');
const { LIFESTEAL_VS_NPC } = require('./engine');

const HEADSHOT_CHANCE = 0.25;
// Effects that take a share of an enemy's max health are weaker against NPCs: half against camp creeps (the wiki's own DotMultiplerTroopers 0.5 for Toxic
// Bullets), and far less against bosses. ponytail: the boss share is a guess, so a 13,000 health Mid-Boss doesn't lose a quarter of it to one item.
const BOSS_HEALTH = 3000;
const isBoss = (unit) => unit.stats.maxHealth > BOSS_HEALTH;
const npcShare = (target) => (isBoss(target) ? 0.15 : 0.5);
const ACTIVE_RELOAD_CHANCE = 0.7;
// ponytail: placeholders for what the cards don't say: a parry's cooldown (Rebuttal takes its own cut off it), how long Shadow Weave lies low before
// striking, Shrink Ray's evasion (his call, Oct 3), Mystical Piano's stun (the wiki's 2 s; the data has none), Prism Blast's laser reach.
const PARRY_COOLDOWN = 6;
const LIE_LOW = 4;
const SHRINK_EVASION = 0.2;
const PIANO_STUN = 2;
const PRISM_RADIUS = 15;
// durations the hero's duration bonus doesn't stretch (timers, not effects)
const KEEP = new Set(['ImmunityDuration', 'BuildUpDuration', 'DamageThresholdDuration', 'InvisFadeToDuration', 'SummonDuration', 'DelayDuration', 'ShrinkDuration']);
const num = (v) => (typeof v === 'number' ? v : parseFloat(v) || 0);

class Item {
  constructor(card, unit) {
    this.card = card;
    this.unit = unit;
    this.name = card.Name;
    this.cdLeft = 0;
    this.procLeft = 0; // a second cooldown, for items with a proc and an active (Capacitor) or a per-proc timer
    this.imbueSlot = null; // the ability slot it is imbued into (imbue items; buildHero sets it)
    this.dots = []; // damage over time this item put on enemies: { target, until, perSecond, ofCurrent }
    this.entries = {};
    this.infos = Object.keys(card).filter((k) => k.startsWith('Info')).map((k) => card[k]).filter((i) => i.Type !== 'Innate');
    for (const info of this.infos) for (const e of [...info.Main, ...info.Alt]) this.entries[e.Key] ??= e;
    for (const [k, e] of Object.entries(card.Other || {})) this.entries[k] ??= e;
    this.init?.(); // per-item state (maps, lists) is made here, never on the shared prototype
  }

  // A number from the card with its scaling: x spirit power, or per boon (hero level); a duration also by the hero's duration bonus.
  value(key) {
    const e = this.entries[key];
    if (!e) return 0;
    let v = num(e.Value);
    for (const sc of [].concat(e.Scale ?? [])) {
      if (sc.Type === 'spirit') v += sc.Value * (this.unit.stats.spirit + this.unit.mod('spirit'));
      else if (sc.Type === 'power_increase') v += sc.Value * (this.unit.boons || 0);
    }
    if (key.endsWith('Duration') && !KEEP.has(key)) v *= this.unit.stat('durationMult');
    return v;
  }
  innate(key) {
    const line = Object.entries(this.card).filter(([k, i]) => k.startsWith('Info') && i.Type === 'Innate').flatMap(([, i]) => [...i.Main, ...i.Alt]).find((s) => s.Key === key);
    return num(line?.Value);
  }

  pct(key) { return this.value(key) / 100; }
  // The cooldown of the card's active, or of its passive proc; less item cooldown reduction (Transcendent Cooldown).
  cd(kind) {
    const info = kind === 'active' ? this.infos.find((i) => i.Type === 'Active' && i.Cooldown) : this.infos.find((i) => i.Type !== 'Active' && i.Cooldown);
    const base = info?.Cooldown ?? this.infos.find((i) => i.Cooldown)?.Cooldown ?? this.value('AbilityCooldown');
    return base * Math.max(MIN_COOLDOWN, 1 - this.unit.stat('itemCdr'));
  }
  get cooldown() { return this.cd(this.active ? 'active' : 'proc'); }
  get active() { return false; }
  get imbue() { return null; }
  get maxHealth() { return this.unit.stats.maxHealth; }
  get hurt() { return this.unit.health / this.maxHealth; }
  get imbued() { return this.unit.abilities.find((a) => a.slot === this.imbueSlot); } // the ability it is imbued into
  fromImbued(p) { return !!p.opts?.ability && p.opts.ability === this.imbued; }

  ready() { return this.cdLeft <= 0 && !this.unit.cantAct; }
  // Uses a proc: true if it was ready (its cooldown starts).
  fire() { if (this.cdLeft > 0) return false; this.cdLeft = this.cooldown; return true; }
  // The same for the second timer (procLeft), with the passive's own cooldown.
  proc() { if (this.procLeft > 0) return false; this.procLeft = this.cd('proc'); return true; }
  want(fight) { return fight.foes.length > 0; }
  cast() {}
  on() {}
  tick() {}
  dynamicMods() { return null; }
  weaponBonus() { return 0; }
  meleeBonus() { return 0; }
  wantsMelee() { return false; }
  shotOpts() { return {}; }

  buff(fight, id, duration, mods, tags = [], extra = {}) { fight.addStatus(this.unit, { id: `${this.name}:${id}`, duration, mods, tags, ...extra }); }
  debuff(fight, target, id, duration, mods = {}, tags = []) { fight.addStatus(target, { id: `${this.name}:${id}`, duration, mods, tags, debuff: true }); }
  slow(fight, target, share, duration) { this.debuff(fight, target, 'slow', duration, { slow: share }); }
  barrier(fight, amount, duration, mods = {}) { fight.addStatus(this.unit, { id: `${this.name}:barrier`, duration, barrier: amount, mods }); }
  regen(fight, perSecond, duration) { fight.regen(this.unit, `${this.name}:regen`, perSecond, duration); }
  headshot(fight) { return fight.rng() < HEADSHOT_CHANCE; }
  mine(source) { return source === this.unit; }
  // The enemies within the card's radius `key` (grown by ability range).
  near(fight, key) { return fight.near(this.value(key) * this.unit.range); }
  // The enemy that matters most: a boss or the one with the most health.
  biggest(fight) { return fight.foes.reduce((best, e) => (!best || e.health > best.health ? e : best), null); }

  // Damage over time on an enemy (spirit damage, never kills when `nonLethal`).
  dot(fight, target, perSecond, seconds, { ofCurrent = false, nonLethal = false } = {}) {
    this.dots = this.dots.filter((d) => d.target !== target);
    this.dots.push({ target, until: fight.time + seconds, perSecond, ofCurrent, nonLethal });
  }

  tickDots(fight, dt) {
    this.dots = this.dots.filter((d) => d.until > fight.time && d.target.alive);
    for (const d of this.dots) {
      let amount = (d.ofCurrent ? d.target.health * d.perSecond : d.perSecond) * dt;
      if (d.nonLethal) amount = Math.min(amount, d.target.health - 1);
      if (amount > 0) fight.damage(this.unit, d.target, amount, 'spirit', { events: false });
    }
  }

  // A running total of `amount`s over the last `seconds` under `key` (damage taken or dealt in a window).
  windowed(fight, key, amount, seconds) {
    const list = (this.windows ??= {})[key] = (this.windows[key] ?? []).filter(([t]) => fight.time - t <= seconds);
    list.push([fight.time, amount]);
    return list.reduce((s, [, a]) => s + a, 0);
  }
  clearWindow(key) { if (this.windows) this.windows[key] = []; }
}

const FX = {};
// An item's hooks, from one or more parts (later parts win); getters are kept as getters.
const define = (names, ...parts) => {
  for (const name of [].concat(names)) {
    FX[name] = class extends Item {};
    for (const part of parts) Object.defineProperties(FX[name].prototype, Object.getOwnPropertyDescriptors(part));
  }
};
const bulletHit = (item, event, { source }) => event === 'bulletHit' && item.mine(source);
const spiritHit = (item, event, { source, type }) => event === 'damage' && item.mine(source) && type === 'spirit';
const hitOnMe = (item, event, p) => event === 'attacked' && p.target === item.unit; // an enemy hit about to land on the holder
const castByMe = (item, event, p) => event === 'cast' && item.mine(p.source);
const ACTIVE = { get active() { return true; } };

// ===== WEAPON DAMAGE THAT DEPENDS ON RANGE, HEALTH OR A STREAK =====
define('Battle Vest', { dynamicMods() { return this.hurt >= this.value('LifeThreshold') / 100 ? { weaponDamage: this.pct('BaseAttackDamagePercent'), fireRate: this.pct('BonusFireRate') } : null; } });
define("Enchanter's Emblem", { dynamicMods() { return this.hurt >= this.value('LifeThreshold') / 100 ? { spirit: this.value('TechPower'), cdr: this.pct('CooldownReduction') } : null; } });
define('Hollow Point', {
  dynamicMods() { return this.hurt >= this.value('LifeThreshold') / 100 ? { weaponDamage: this.pct('BaseAttackDamagePercent') } : null; },
  on(event, fight, p) { if (bulletHit(this, event, p) && this.hurt >= this.value('LifeThreshold') / 100) this.debuff(fight, p.target, 'shred', this.value('DebuffDuration'), { bulletResist: this.pct('BulletArmorReduction') }); },
});
define('Opening Rounds', { weaponBonus(fight, t) { return t.health > t.stats.maxHealth * (this.value('EnemyLifeThreshold') / 100) ? this.pct('BaseAttackDamagePercentBonus') : 0; } });
const close = { weaponBonus(fight, t) { return fight.distance(this.unit, t) <= this.value('CloseRangeBonusDamageRange') ? this.pct('CloseRangeBonusWeaponPower') : 0; } };
define('Close Quarters', close);
define('Point Blank', close, { on(event, fight, p) { if (bulletHit(this, event, p) && fight.distance(this.unit, p.target) <= this.value('CloseRangeBonusDamageRange')) this.slow(fight, p.target, this.pct('SlowPercent'), this.value('SlowDuration')); } });
define(['Long Range', 'Sharpshooter'], { weaponBonus(fight, t) { return fight.distance(this.unit, t) >= this.value('LongRangeBonusWeaponPowerMinRange') ? this.pct('LongRangeBonusWeaponPower') : 0; } });
define('Intensifying Magazine', {
  init() { this.shooting = 0; },
  tick(fight, dt) { this.shooting = this.unit.weapon.reloadLeft > 0 || !fight.foes.length ? 0 : this.shooting + dt; },
  weaponBonus() { return this.pct('BaseAttackDamagePercentAtMaxDuration') * Math.min(1, this.shooting / this.value('ShootDurationForMax')); },
});
define('Berserker', {
  init() { this.stacks = 0; this.taken = 0; this.until = 0; },
  tick(fight) { if (fight.time > this.until) this.stacks = 0; },
  on(event, fight, { source, target, dealt }) {
    if (event !== 'damage' || target !== this.unit || source === this.unit) return;
    this.taken += dealt;
    while (this.taken >= this.value('DamageToStack')) {
      this.taken -= this.value('DamageToStack');
      this.stacks = Math.min(this.value('MaxStacks'), this.stacks + 1);
      this.until = fight.time + this.value('DamageDuration');
    }
  },
  weaponBonus() { return this.stacks * this.pct('WeaponPowerPerStack'); },
});
define('Glass Cannon', {
  init() { this.kills = 0; },
  on(event, fight, { source }) { if (event === 'kill' && this.mine(source)) this.kills = Math.min(this.value('MaxStacks'), this.kills + 1); },
  dynamicMods() { return this.kills ? { fireRate: this.kills * this.pct('FireRatePerKill') } : null; },
});
define('Escalating Resilience', {
  init() { this.stacks = 0; this.until = 0; },
  tick(fight) { if (fight.time > this.until) this.stacks = 0; },
  on(event, fight, p) { if (bulletHit(this, event, p)) { this.stacks = Math.min(this.value('MaxArmorStacks'), this.stacks + 1); this.until = fight.time + this.value('BulletResistDuration'); } },
  dynamicMods() { return this.stacks ? { bulletResist: this.stacks * this.pct('BulletResistPerStack') } : null; },
});
define('Bullet Resilience', { dynamicMods() { return this.hurt < this.value('HealthThreshold') / 100 ? { bulletResist: this.pct('BulletResistBelowThreshold') } : null; } });
define('Spirit Resilience', { dynamicMods() { return this.hurt < this.value('HealthThreshold') / 100 ? { spiritResist: this.pct('TechResistBelowThreshold') } : null; } });
define('Fortitude', {
  tick(fight, dt) { if (fight.time - this.unit.lastHit >= this.value('RestoreDelay') && this.hurt < 1) fight.heal(this.unit, this.pct('HealLifePercentOutOfCombat') * this.maxHealth * dt, 'regen'); },
  dynamicMods() { return this.hurt >= this.value('HealthThreshold') / 100 ? { moveSpeed: this.value('BonusMoveSpeed') } : null; },
});
// Trophy Collector: every kill is a stack (max 16): sprint, ability range, and souls per minute (his call, Oct 3: they go into a won trip's pay).
define('Trophy Collector', {
  init() { this.stacks = 0; },
  on(event, fight, { source }) { if (event === 'kill' && this.mine(source)) this.stacks = Math.min(this.value('MaxStacks'), this.stacks + 1); },
  tick(fight, dt) { if (fight.foes.length) fight.bonusSouls += (this.stacks * this.value('StackingGoldPerMinute') * dt) / 60; },
  dynamicMods() { return this.stacks ? { moveSpeed: this.stacks * this.value('StackingBonusSprintSpeed'), rangeMult: this.stacks * this.pct('StackingTechRangeMultiplier') } : null; },
});

// ===== BULLET PROCS =====
define('Mystic Shot', { on(event, fight, p) { if (bulletHit(this, event, p) && this.fire()) fight.damage(this.unit, p.target, this.value('ProcBonusMagicDamage'), 'spirit', { proc: true }); } });
define('Express Shot', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || !this.fire()) return;
    fight.damage(this.unit, p.target, p.amount * this.pct('ProcBaseAttackDamagePercent'), 'bullet', { events: false });
    this.unit.weapon.clip = Math.max(0, this.unit.weapon.clip - (this.value('ProcAmmoConsumed') - 1)); // it eats extra ammo
  },
});
define('Headshot Booster', { on(event, fight, p) { if (bulletHit(this, event, p) && this.cdLeft <= 0 && this.headshot(fight)) { this.fire(); fight.damage(this.unit, p.target, this.value('HeadShotBonusDamage'), 'bullet', { events: false }); } } });
define('Headhunter', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || this.cdLeft > 0 || !this.headshot(fight)) return;
    this.fire();
    fight.damage(this.unit, p.target, this.value('HeadShotBonusDamage'), 'bullet', { events: false });
    fight.heal(this.unit, this.pct('HealPercentPerHeadshot') * this.maxHealth);
    this.buff(fight, 'speed', this.value('MovementSpeedBonusDuration'), { moveSpeed: this.value('BonusMoveSpeed') });
  },
});
define('Weakening Headshot', { on(event, fight, p) { if (bulletHit(this, event, p) && this.headshot(fight)) this.debuff(fight, p.target, 'shred', this.value('DebuffDuration'), { bulletResist: this.pct('BulletResistReduction') }); } });
define('Crippling Headshot', {
  on(event, fight, p) {
    if (bulletHit(this, event, p) && this.headshot(fight)) {
      this.debuff(fight, p.target, 'shred', this.value('DebuffDuration'), { bulletResist: this.pct('BulletResistReduction'), spiritResist: this.pct('MagicResistReduction'), healAmp: this.pct('HealAmpRegenPenaltyPercent') });
    }
  },
});
define('Lucky Shot', { on(event, fight, p) { if (bulletHit(this, event, p) && fight.rng() < this.pct('ProcChance')) fight.damage(this.unit, p.target, p.amount * this.pct('CritDamagePercent'), 'bullet', { events: false }); } });
// Ricochet: the bounce is a bullet too, so other bullet items proc on it (but it doesn't bounce again).
define('Ricochet', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || p.opts.ricochet) return;
    const others = fight.foes.filter((e) => e !== p.target && Math.abs((e.offset ?? 0) - (p.target.offset ?? 0)) <= this.value('RicochetRadius'));
    for (const other of others.slice(0, this.value('RicochetTargets'))) fight.damage(this.unit, other, p.amount * this.pct('RicochetDamagePercent'), 'bullet', { ricochet: true });
  },
});
// Tesla Bullets / Capacitor: a chance to shock, jumping to enemies near the target.
const chain = {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || this.procLeft > 0 || fight.rng() >= this.pct('ProcChance')) return;
    this.proc();
    const reach = this.value('ChainRadius') * this.unit.range;
    const others = fight.foes.filter((e) => e !== p.target && Math.abs((e.offset ?? 0) - (p.target.offset ?? 0)) <= reach);
    for (const other of [p.target, ...others].slice(0, this.value('ChainCount'))) fight.damage(this.unit, other, this.value('DamagePerChain'), 'spirit', { proc: true });
  },
};
define('Tesla Bullets', chain);
define('Capacitor', chain, ACTIVE, {
  cast(fight) { const e = fight.foes[0]; fight.damage(this.unit, e, this.value('Damage'), 'spirit'); this.slow(fight, e, this.pct('MaxSlowPercent'), this.value('SlowDuration')); },
});
define('Armor Piercer', { shotOpts(fight) { return { ignoreBulletResist: fight.rng() < this.pct('ProcChance') }; } });
// Infinite Rounds (a legendary): never reloads, and ProcChance of its bullets ignore bullet resist and pierce on to the enemy behind.
define('Infinite Rounds', {
  tick(fight) { if (!this.unit.statuses.some((st) => st.id === `${this.name}:ammo`)) this.buff(fight, 'ammo', Infinity, {}, ['infiniteClip']); },
  shotOpts(fight) { const pierce = fight.rng() < this.pct('ProcChance'); return { ignoreBulletResist: pierce, pierce }; },
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || !p.opts.pierce) return;
    const behind = fight.foes.find((e) => e !== p.target && (e.offset ?? 0) >= (p.target.offset ?? 0));
    if (behind) fight.damage(this.unit, behind, p.amount, 'bullet', { ignoreBulletResist: true, events: false });
  },
});
define('Restorative Shot', { on(event, fight, p) { if (bulletHit(this, event, p) && this.fire()) fight.heal(this.unit, this.value('HealFromNPC')); } });
define('Burst Fire', { on(event, fight, p) { if (bulletHit(this, event, p) && this.fire()) this.buff(fight, 'burst', this.value('AbilityDuration'), { fireRate: this.pct('ActivatedFireRate'), moveSpeed: this.value('BonusMoveSpeed') }); } });
define('Suppressor', { on(event, fight, p) { if (spiritHit(this, event, p)) this.debuff(fight, p.target, 'suppress', this.value('AbilityDuration'), { damageDealt: -this.pct('FireRateSlow') }); } });
define('Bullet Resist Shredder', { on(event, fight, p) { if (spiritHit(this, event, p)) this.debuff(fight, p.target, 'shred', this.value('AbilityDuration'), { bulletResist: this.pct('BulletArmorReduction') }); } });
define("Hunter's Aura", {
  tick(fight) { // every enemy close enough loses bullet resist and fire rate; doubled against a lone enemy
    const k = fight.foes.length === 1 ? 2 : 1;
    for (const e of this.near(fight, 'Radius')) this.debuff(fight, e, 'aura', 0.25, { bulletResist: k * this.pct('BulletArmorReduction'), damageDealt: -k * this.pct('FireRateSlow') });
  },
});
const shredder = { on(event, fight, p) { if (bulletHit(this, event, p)) this.debuff(fight, p.target, 'spirit', this.value('DebuffDuration'), { spiritResist: this.pct('TechArmorDamageReduction'), spiritLifestealOn: this.pct('AbilityLifestealPercentHero') }); } };
define('Spirit Shredder', shredder);
define('Spirit Rend', {
  init() { this.stacks = new Map(); },
  on(event, fight, p) {
    shredder.on.call(this, event, fight, p);
    if (!bulletHit(this, event, p) || !this.proc()) return; // a stack of spirit resist shred every 2 s, up to 4
    const n = Math.min(this.value('MaxStacks'), (p.target.has(`${this.name}:rend`) ? this.stacks.get(p.target) ?? 0 : 0) + 1);
    this.stacks.set(p.target, n);
    this.debuff(fight, p.target, 'rend', this.value('DebuffDuration'), { spiritResist: n * this.pct('MagicResistReduction') });
  },
});
// Siphon Bullets: hits steal max health for a while (they get it back when it ends); a share of it against NPCs.
define('Siphon Bullets', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || !this.fire()) return;
    const steal = this.pct('HealthStealPctHero') * p.target.stats.maxHealth * npcShare(p.target);
    const foe = p.target;
    foe.addMaxHealth(-steal);
    this.unit.addMaxHealth(steal);
    fight.at(this.value('StealDuration'), () => { if (foe.alive) foe.addMaxHealth(steal); this.unit.addMaxHealth(-steal); });
  },
});
// Haunting Shot (a legendary): every few seconds a bullet curses its target (and the one behind): less damage, less healing, slowed, and spirit damage
// from its current health.
define('Haunting Shot', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || !this.fire()) return;
    const behind = fight.foes.find((e) => e !== p.target && (e.offset ?? 0) >= (p.target.offset ?? 0));
    for (const e of [p.target, behind].filter(Boolean)) {
      this.debuff(fight, e, 'haunt', this.value('DebuffDuration'), { damageDealt: this.pct('OutgoingDamagePenaltyPercent'), healAmp: this.pct('HealAmpReceivePenaltyPercent'), slow: this.pct('MovementSpeedSlow') });
      fight.damage(this.unit, e, this.pct('HealthPctDamage') * e.health * npcShare(e), 'spirit', { proc: true });
    }
  },
});

// Bullets build up on a target; a full bar (100) triggers the effect. The card's build-up per shot is scaled by each hero's gun (the wiki's Toxic
// Bullets table, checked Oct 3 2026: Haze 7.4% a bullet, Abrams 3.4% a pellet x 9, Mina 15.7%, Celeste 28.7%, Paige 22.3%, Apollo 21.5%, Bebop 6.1%, Billy 6.1%, Calico 1.5% a pellet x 9, The Doorman 28.7%, Drifter 8% a pellet x 3, Dynamo 16.2%, Graves 7.2%, Grey Talon 29.3%, Holliday 25.1%, Infernus 7.4%, Ivy 5.3% and Kelvin 16.2% (Oct 5), where the card says 1.28%).
// ponytail: a hero missing here builds up at the middle of them; add its row from that table when it gets a file in heroes/.
const BUILD_UP = { Haze: 7.4 / 1.28, Abrams: (3.4 * 9) / 1.28, Mina: 15.7 / 1.28, Celeste: 28.7 / 1.28, Paige: 22.3 / 1.28, Apollo: 21.5 / 1.28, Bebop: 6.1 / 1.28, Billy: 6.1 / 1.28, Calico: (1.5 * 9) / 1.28, 'The Doorman': 28.7 / 1.28, Drifter: (8 * 3) / 1.28, Dynamo: 16.2 / 1.28, Graves: 7.2 / 1.28, 'Grey Talon': 29.3 / 1.28, Holliday: 25.1 / 1.28, Infernus: 7.4 / 1.28, Ivy: 5.3 / 1.28, Kelvin: 16.2 / 1.28, 'Lady Geist': 25.1 / 1.28, Lash: 11.4 / 1.28, McGinnis: 6.1 / 1.28, Mirage: 21.0 / 1.28, 'Mo & Krill': (3.1 * 4) / 1.28, Paradox: 9.1 / 1.28, Pocket: (3.8 * 7) / 1.28, Rem: 16.1 / 1.28, Seven: 11.4 / 1.28, Shiv: (4.6 * 6) / 1.28, Silver: (5.1 * 7) / 1.28, Sinclair: 21.0 / 1.28, Venator: 8.7 / 1.28, Victor: 11.4 / 1.28, Vindicta: 14.7 / 1.28, Viscous: 13.6 / 1.28, Vyper: 5.1 / 1.28, Warden: 16.2 / 1.28, Wraith: 6.7 / 1.28, Yamato: (4.6 * 5) / 1.28, Baba: (6.2 * 3) / 1.28, 'Rat King': (6.5 * 2) / 1.28, Solomon: 26.0 / 1.28, 'Deadman Danny': 15.6 / 1.28, 'Nurse Harrow': 7.4 / 1.28, Violet: 30.8 / 1.28 }; // Baba: 6.2% a pellet x 3, Rat King: 6.5% a pellet x 2, Solomon 26% (table checked Oct 10); Danny 15.6% an uncharged shot (Oct 16); Nurse Harrow 7.4%, Violet 30.8% (Oct 20)
const buildUpPerShot = (item) => item.value('BuildUpPerShot') * (BUILD_UP[item.unit.name] ?? 15 / 1.28);
const buildUp = (apply) => ({
  init() { this.bars = new Map(); },
  on(event, fight, p) {
    if (!bulletHit(this, event, p)) return;
    const bar = (this.bars.get(p.target) ?? 0) + buildUpPerShot(this) * (p.opts.landed ?? 1); // a shotgun's missed pellets build nothing (the wiki)
    if (bar >= 100) { this.bars.set(p.target, 0); apply.call(this, fight, p.target); } else this.bars.set(p.target, bar);
  },
});
define('Toxic Bullets', buildUp(function (fight, target) { // NPCs take half (DotMultiplerTroopers); bleeding enemies heal less
  this.dot(fight, target, this.pct('DotHealthPercent') * target.stats.maxHealth * npcShare(target), this.value('DotDuration'));
  this.debuff(fight, target, 'heal', this.value('DotDuration'), { healAmp: this.pct('HealAmpReceivePenaltyPercent') });
}));
define('Inhibitor', buildUp(function (fight, target) { this.debuff(fight, target, 'inhibit', this.value('DebuffDuration'), { damageDealt: this.pct('OutgoingDamagePenaltyPercent'), healAmp: this.pct('HealAmpReceivePenaltyPercent') }); }));
define(['Slowing Bullets', 'Weighted Shots'], buildUp(function (fight, target) { this.slow(fight, target, this.pct('SlowPercent'), this.value('SlowDuration')); }));
define('Spiritual Overflow', {
  init() { this.charge = 0; },
  on(event, fight, p) {
    if (!bulletHit(this, event, p)) return;
    this.charge += buildUpPerShot(this);
    if (this.charge >= 100) {
      this.charge = 0;
      this.buff(fight, 'overflow', this.value('AbilityDuration'), { fireRate: this.pct('BonusFireRate'), spirit: this.value('BonusSpirit'), spiritLifesteal: this.pct('BonusSpiritLifesteal') });
    }
  },
});
// Stalker: weapon damage at close range (after a melee) wounds the target: spirit damage over time and less bullet resist.
define('Stalker', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || fight.distance(this.unit, p.target) > this.value('ProcRadius') || !this.fire()) return;
    this.dot(fight, p.target, this.value('DPS'), this.value('DebuffDuration'));
    this.debuff(fight, p.target, 'wound', this.value('DebuffDuration'), { bulletResist: this.pct('BulletResistReduction') });
    this.buff(fight, 'speed', this.value('AbilityDuration'), { moveSpeed: this.value('BonusMoveSpeed') });
  },
});

// ===== RELOADS, CASTS, DASHES, SLIDES AND HEALS START BUFFS =====
define('Active Reload', {
  on(event, fight, { source }) {
    if (event !== 'reloadEnd' || !this.mine(source) || this.cdLeft > 0 || fight.rng() >= ACTIVE_RELOAD_CHANCE) return;
    this.fire();
    this.buff(fight, 'active', this.value('AbilityDuration'), { fireRate: this.pct('BonusFireRate'), lifesteal: this.pct('BulletLifestealPercent'), moveSpeed: this.value('BonusMoveSpeed') });
  },
});
define('Spellslinger', {
  init() { this.stacks = 0; this.until = 0; },
  tick(fight) { if (fight.time > this.until) this.stacks = 0; },
  on(event, fight, { source }) {
    if (event !== 'cast' || !this.mine(source) || !fight.foes.length) return;
    this.stacks = Math.min(this.value('MaxStacks'), this.stacks + 1);
    this.until = fight.time + this.value('BuffDuration');
  },
  dynamicMods() { return this.stacks ? { fireRate: this.stacks * this.pct('BonusFireRate'), reloadSpeed: this.stacks * -this.pct('ReloadSpeedMultipler') } : null; },
});
// Kinetic Dash: a dash-jump gives fire rate and extra rounds until the next reload.
define('Kinetic Dash', {
  on(event, fight, p) {
    if (event === 'dash' && this.mine(p.source)) { this.buff(fight, 'kinetic', this.value('AbilityDuration'), { fireRate: this.pct('BonusFireRate') }); this.unit.weapon.clip += this.value('BonusClipSize'); }
    if (event === 'reloadStart' && this.mine(p.source)) fight.removeStatus(this.unit, `${this.name}:kinetic`);
  },
});
// Arcane Surge: after a dash-jump, the next ability within 7 s gets range, duration and spirit power.
define('Arcane Surge', {
  init() { this.until = 0; },
  on(event, fight, p) {
    if (event === 'dash' && this.mine(p.source)) this.until = fight.time + this.value('AbilityDuration');
    if (castByMe(this, event, p) && p.ability && fight.time <= this.until) {
      this.until = 0;
      this.buff(fight, 'surge', p.ability.castDelay + 0.3, { rangeMult: this.pct('TechRangeMultiplierBuff'), durationMult: this.pct('BonusAbilityDurationPercent'), spirit: this.value('SpiritPower') });
    }
  },
});
// Electric Slippers (a legendary): while sliding, bullets miss more and the gun fires faster, and enemies around take damage (each at most every 0.3 s).
define('Electric Slippers', {
  init() { this.zapped = new Map(); },
  dynamicMods() { return this.unit.has('sliding') ? { evasion: this.pct('EvasionWhileSliding'), fireRate: this.pct('FireRateWhileSliding') } : null; },
  tick(fight) {
    if (!this.unit.has('sliding')) return;
    for (const e of this.near(fight, 'Radius')) {
      if ((this.zapped.get(e) ?? -Infinity) + this.value('ProcCooldown') > fight.time) continue;
      this.zapped.set(e, fight.time);
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
    }
  },
});
// Seraphim Wings (a legendary): more damage dealt, less taken, while airborne (its stamina recharge keeps the hero dashing, so in the air a lot).
define('Seraphim Wings', { dynamicMods() { return this.unit.has('airborne') ? { damageDealt: this.pct('AirBonusDamageGiven'), damageTaken: this.pct('AirBonusDamageTaken') } : null; } });
// Healing Tempo: a heal from an ability or item gives fire rate and move speed.
define('Healing Tempo', { on(event, fight, p) { if (event === 'heal' && p.target === this.unit && this.fire()) this.buff(fight, 'tempo', this.value('BuffDuration'), { fireRate: this.pct('BonusFireRate'), moveSpeed: this.value('BonusMoveSpeed') }); } });

// ===== SPIRIT DAMAGE: DEBUFFS, HEALS AND EXTRA DAMAGE THAT FOLLOW THE HOLDER'S SPIRIT DAMAGE =====
define('Mystic Vulnerability', { on(event, fight, p) { if (spiritHit(this, event, p)) this.debuff(fight, p.target, 'vuln', this.value('AbilityDuration'), { spiritResist: this.pct('TechArmorDamageReduction') }); } });
define('Escalating Exposure', {
  init() { this.stacks = new Map(); },
  on(event, fight, p) {
    if (!spiritHit(this, event, p)) return;
    const n = Math.min(this.value('MaxStacks'), (this.stacks.get(p.target) ?? 0) + 1);
    this.stacks.set(p.target, n);
    this.debuff(fight, p.target, 'amp', this.value('AbilityDuration'), { spiritAmp: n * this.pct('MagicIncreasePerStack') });
  },
});
define('Mystic Regeneration', { on(event, fight, p) { if (spiritHit(this, event, p)) this.regen(fight, this.value('Regeneration'), this.value('RegenerationDuration')); } });
define('Radiant Regeneration', {
  on(event, fight, p) {
    if (spiritHit(this, event, p)) fight.addStatus(this.unit, { id: `${this.name}:regen`, duration: this.value('RegenerationDuration'), regen: this.value('Regeneration') });
    if (castByMe(this, event, p) && this.proc()) { fight.heal(this.unit, this.value('HealingPerCast')); this.buff(fight, 'speed', this.value('AbilityDuration'), { moveSpeed: this.value('BonusMoveSpeed') }); }
  },
});
define('Mystic Slow', { on(event, fight, p) { if (spiritHit(this, event, p)) this.slow(fight, p.target, this.pct('MovementSpeedSlow'), this.value('AbilityDuration')); } });
// Healbane: spirit damage cuts the enemy's healing; an enemy that dies with it on heals the holder.
define('Healbane', {
  on(event, fight, p) {
    if (spiritHit(this, event, p) && p.target.alive) this.debuff(fight, p.target, 'bane', this.value('AbilityDuration'), { healAmp: this.pct('HealAmpReceivePenaltyPercent') });
    if (event === 'kill' && this.mine(p.source) && p.target.has(`${this.name}:bane`)) fight.heal(this.unit, this.value('HealOnKill'));
  },
});
// Mystic Burst / Tankbuster: charge up over 14 s; the next ability hit above a minimum deals extra damage (Tankbuster's ignores spirit resist and
// adds a share of the enemy's current health).
const burst = (extra) => ({
  on(event, fight, p) {
    if (event !== 'damage' || !this.mine(p.source) || !p.opts.ability || p.amount < this.value('MinimumDamage') || !p.target.alive || !this.fire()) return;
    extra.call(this, fight, p.target);
  },
});
define('Mystic Burst', burst(function (fight, t) { fight.damage(this.unit, t, this.value('Damage'), 'spirit', { events: false }); }));
define('Tankbuster', burst(function (fight, t) { fight.damage(this.unit, t, this.value('Damage') + this.pct('CurrentHealthDamage') * t.health * npcShare(t), 'spirit', { events: false, ignoreSpiritResist: true }); }));
// Spirit Burn: 500 spirit damage to one enemy within 5 s sets off an explosion and a burn that cuts its healing; half against NPCs, once per 20 s per enemy.
define('Spirit Burn', {
  init() { this.taken = new Map(); this.immune = new Map(); },
  on(event, fight, p) {
    if (!spiritHit(this, event, p) || p.opts.burn || !p.target.alive || (this.immune.get(p.target) ?? -Infinity) > fight.time) return;
    const list = (this.taken.get(p.target) ?? []).filter(([t]) => fight.time - t <= this.value('DamageThresholdDuration'));
    list.push([fight.time, p.dealt]);
    this.taken.set(p.target, list);
    if (list.reduce((s, [, d]) => s + d, 0) < this.value('DamageThreshold')) return;
    this.taken.delete(p.target);
    this.immune.set(p.target, fight.time + this.value('ImmunityDuration'));
    const half = this.pct('DamagePctVsNonHeroes');
    fight.damage(this.unit, p.target, this.value('ExplosionDamage') * half, 'spirit', { burn: true });
    this.dot(fight, p.target, this.value('DPS') * half, this.value('DebuffDuration'));
    this.debuff(fight, p.target, 'burn', this.value('DebuffDuration'), { healAmp: this.pct('HealAmpReceivePenaltyPercent') });
  },
});
// Lightning Scroll: the ultimate's damage slows each enemy it hits, then stuns it and deals bonus spirit damage a moment later (once per cast per enemy).
define('Lightning Scroll', {
  init() { this.struck = new Set(); },
  on(event, fight, p) {
    if (castByMe(this, event, p) && p.ability?.ultimate) this.struck.clear();
    if (event !== 'damage' || !this.mine(p.source) || !p.opts.ability?.ultimate || this.struck.has(p.target)) return;
    const e = p.target;
    this.struck.add(e);
    this.slow(fight, e, this.pct('SlowPercent'), this.value('AbilityDuration'));
    fight.at(this.value('DelayBeforeStun'), () => { if (!e.alive) return; this.debuff(fight, e, 'stun', this.value('StunDuration'), {}, ['stun']); fight.damage(this.unit, e, this.value('Damage'), 'spirit', { proc: true }); });
  },
});
// Mystic Conduit (a legendary): its aura is stats (stats.js); dealing 300 damage within 5 s heals 700, every 25 s.
define('Mystic Conduit', {
  on(event, fight, p) {
    if (event !== 'damage' || !this.mine(p.source)) return;
    if (this.windowed(fight, 'dealt', p.dealt, this.value('DamageThresholdDuration')) >= this.value('DamageThreshold') && this.fire()) { this.clearWindow('dealt'); fight.heal(this.unit, this.value('HealAmount')); }
  },
});

// ===== MELEE (his call, Oct 3: the hero melees when it has a reason; a melee item's ready proc is one) =====
const meleeReady = { wantsMelee() { return this.cdLeft <= 0; } };
const onMelee = (fn) => ({ on(event, fight, p) { if (event === 'melee' && this.mine(p.source)) fn.call(this, fight, p); } });
define('Melee Lifesteal', { wantsMelee() { return this.cdLeft <= 0 && this.hurt < 0.9; } },
  onMelee(function (fight) { if (this.fire()) fight.heal(this.unit, this.value('LifestrikeHeal') * this.pct('NonHeroHealPct')); }));
define('Lifestrike', { wantsMelee() { return this.cdLeft <= 0 && this.hurt < 0.9; } }, onMelee(function (fight, p) {
  if (!this.fire()) return;
  fight.heal(this.unit, (this.value('LifestealHeal') + this.pct('LifestealHealPercent') * p.dealt) * this.pct('NonHeroHealPct'));
  this.slow(fight, p.target, this.pct('SlowPercent'), this.value('SlowDuration'));
}));
define('Spirit Strike', meleeReady, onMelee(function (fight, p) {
  if (!this.fire()) return;
  fight.damage(this.unit, p.target, this.value('SpiritDamage'), 'spirit');
  this.debuff(fight, p.target, 'strike', this.value('AbilityDuration'), { spiritResist: this.pct('TechArmorDamageReduction') });
}));
// Spirit Snatch: the swing also steals spirit resist and spirit power from the enemy for a while.
define('Spirit Snatch', meleeReady, onMelee(function (fight, p) {
  if (!this.fire()) return;
  fight.damage(this.unit, p.target, this.value('SpiritDamage'), 'spirit');
  this.debuff(fight, p.target, 'snatched', this.value('AbilityDuration'), { spiritResist: this.pct('TechArmorDamageReduction'), spirit: this.value('TechPowerReduction') });
  this.buff(fight, 'snatch', this.value('AbilityDuration'), { spiritResist: this.pct('TechArmorGain'), spirit: this.value('TechPowerGain') });
}));
define('Melee Charge', meleeReady, { meleeBonus() { return this.cdLeft <= 0 ? this.pct('BonusHeavyMeleeDamage') : 0; } }, onMelee(function () { this.fire(); }));
// Crushing Fists: a heavy melee hits harder (on its cooldown), reloads part of the clip and adds 2 stacks of bullet resist shred; at the most stacks it stuns.
define('Crushing Fists', meleeReady, {
  init() { this.stacks = new Map(); },
  meleeBonus() { return this.cdLeft <= 0 ? this.pct('BonusHeavyMeleeDamage') : 0; },
}, onMelee(function (fight, p) {
  this.fire();
  const w = this.unit.weapon;
  w.clip = Math.min(this.unit.stats.clip, w.clip + Math.ceil(this.unit.stats.clip * this.pct('LightMeleeAmmo') * this.value('HeavyMeleeMultiplier')));
  const e = p.target;
  let n = (e.has(`${this.name}:crush`) ? this.stacks.get(e) ?? 0 : 0) + this.value('HeavyMeleeMultiplier');
  if (n >= this.value('MaxStacks')) { this.debuff(fight, e, 'stun', this.value('StunDuration'), {}, ['stun']); n = 0; }
  this.stacks.set(e, n);
  this.debuff(fight, e, 'crush', this.value('DebuffDuration'), { bulletResist: n * this.pct('BulletResistReduction') });
}));
// Runed Gauntlets (a legendary): a heavy melee cuts every running ability cooldown (16%, at least 4 s).
define('Runed Gauntlets', { wantsMelee() { return this.cdLeft <= 0 && this.unit.abilities.some((a) => a.cdLeft > 4); } }, onMelee(function () {
  if (!this.fire()) return;
  for (const a of this.unit.abilities) if (a.cdLeft > 0) a.cdLeft = Math.max(0, a.cdLeft - Math.max(this.value('CooldownReductionOnHitMin'), a.cdLeft * this.pct('CooldownReductionOnHitPct')));
}));
// Shadow Strike (a legendary): a dash makes the hero invisible; the melee that comes out of it steals bullet and spirit resist and burns.
define('Shadow Strike', {
  wantsMelee() { return this.unit.statuses.some((s) => s.id === `${this.name}:shadow`); },
  on(event, fight, p) {
    if (event === 'dash' && this.mine(p.source)) this.buff(fight, 'shadow', 3, {}, ['invisible'], { breakOnAttack: true });
    if (event !== 'unstealth' || !this.mine(p.source) || !p.opts.melee || !p.ended.includes(`${this.name}:shadow`)) return;
    const steal = this.pct('ResistStealAmount');
    this.debuff(fight, p.target, 'stolen', this.value('StealDuration'), { bulletResist: -steal, spiritResist: -steal });
    this.buff(fight, 'steal', this.value('StealDuration'), { bulletResist: steal, spiritResist: steal });
    this.dot(fight, p.target, this.value('DPS'), this.value('AbilityDuration'));
  },
});

// ===== PARRIES AND HITS: CHANGE AN ENEMY'S HIT OR BLAST BEFORE IT LANDS =====
// Rebuttal (his call, Oct 3): parries the front enemy's next hit on its cooldown: heals it, sends it back, then more damage for a while.
define('Rebuttal', {
  get cooldown() { return Math.max(1, PARRY_COOLDOWN - this.innate('ParryCooldownReduction')); },
  on(event, fight, hit) {
    if (!hitOnMe(this, event, hit) || !hit.opts.attack || hit.source !== fight.foes[0] || !this.fire()) return;
    const amount = hit.amount;
    hit.amount = 0;
    fight.heal(this.unit, amount * this.pct('ParrySuccessHealPercentage'));
    fight.damage(this.unit, hit.source, amount, hit.type === 'spirit' ? 'spirit' : 'bullet', { events: false });
    this.buff(fight, 'rebuttal', this.value('BuffDuration'), { damageDealt: this.pct('BonusDamagePercent') });
  },
});
// Counterspell (his call, Oct 3): parries the next enemy blast: no damage, no curse; heals and gives spirit power and speed.
define('Counterspell', {
  on(event, fight, p) {
    if (event !== 'blast' || p.target !== this.unit || p.parried || !this.fire()) return;
    p.parried = true;
    fight.heal(this.unit, this.value('HealOnSuccess'));
    this.buff(fight, 'parry', this.value('BuffDuration'), { spirit: this.value('SpiritPower'), moveSpeed: this.value('BonusMoveSpeed') });
  },
});
define('Plated Armor', { on(event, fight, hit) { if (hitOnMe(this, event, hit) && hit.type === 'bullet' && fight.rng() < this.pct('DeflectionPercent')) hit.amount = 0; } }); // a deflected bullet does nothing
define('Spellbreaker', { on(event, fight, hit) { if (hitOnMe(this, event, hit) && hit.type === 'spirit' && hit.amount >= this.value('DamageThreshold') && this.fire()) hit.amount *= 1 - this.pct('SpiritDamageReductionProc'); } });
// Juggernaut: an enemy that shoots the holder fires slower for a while.
define('Juggernaut', { on(event, fight, p) { if (event === 'damage' && p.target === this.unit && p.type === 'bullet' && p.opts.attack) this.debuff(fight, p.source, 'slowfire', this.value('FireRateSlowDuration'), { damageDealt: -this.pct('FireRateSlow') }); } });
// Witchmail: a heavy spirit hit takes seconds off a random running ability cooldown.
define('Witchmail', {
  on(event, fight, p) {
    if (event !== 'damage' || p.target !== this.unit || p.type !== 'spirit' || p.amount < this.value('DamageThreshold') || !this.fire()) return;
    const running = this.unit.abilities.filter((a) => a.cdLeft > 0);
    if (running.length) { const a = running[Math.floor(fight.rng() * running.length)]; a.cdLeft = Math.max(0, a.cdLeft - this.value('CooldownReductionPerHit')); }
  },
});
// Return Fire: for a while, part of every enemy hit goes back at the attacker (and the holder has more bullet resist).
define('Return Fire', ACTIVE, {
  want(fight) { return fight.foes.length > 0 && this.hurt < 0.85; },
  cast(fight) { this.buff(fight, 'reflect', this.value('AbilityDuration'), { bulletResist: this.pct('BulletResist') }, ['reflect']); },
  on(event, fight, { source, target, dealt, type }) {
    if (event !== 'damage' || target !== this.unit || source === this.unit || !this.unit.has('reflect') || !(type === 'bullet' || type === 'spirit')) return;
    fight.damage(this.unit, source, dealt * this.pct(type === 'bullet' ? 'BulletDamageReflectedPct' : 'SpiritDamageReflectedPct'), type, { events: false });
  },
});
// Weapon / Spirit Shielding: enough damage of its kind within a few seconds puts up a barrier (and resist).
const shielding = (kind, resistKey, resist) => ({
  on(event, fight, { source, target, dealt, type }) {
    if (event !== 'damage' || target !== this.unit || source === this.unit || type !== kind) return;
    if (this.cdLeft <= 0 && this.windowed(fight, 'taken', dealt, this.value('DamageWindow')) >= this.value('DamageThreshold')) {
      this.fire();
      this.clearWindow('taken');
      this.barrier(fight, this.value('CombatBarrier'), this.value('BarrierDuration'), { [resist]: this.pct(resistKey) });
    }
  },
});
define('Weapon Shielding', shielding('bullet', 'BulletResist', 'bulletResist'));
define('Spirit Shielding', shielding('spirit', 'TechResist', 'spiritResist'));

// ===== CROWD CONTROL ON THE HERO (the only kind: an enemy blast's curse or stomp) =====
define('Cheat Death', {
  preventDeath(fight) {
    if (this.cdLeft > 0) return false;
    this.fire();
    // survives with 1 health and can't be hurt for a moment, dealing less damage and healing less meanwhile; non-stun debuffs are removed
    this.buff(fight, 'immune', this.value('DeathImmunityDuration'), { damageTaken: -1, damageDealt: this.pct('DeathImmunityDamageReduction'), healAmp: this.pct('HealAmpReceivePenaltyPercent') });
    fight.cleanse(this.unit, 1, { stuns: false });
    return true;
  },
});
// Cloak of Opportunity (a legendary): blocks the next curse or stomp, then Unstoppable, a barrier and speed.
define('Cloak of Opportunity', {
  on(event, fight, p) {
    if (event !== 'cc' || p.target !== this.unit || p.blocked || !this.fire()) return;
    p.blocked = true;
    this.buff(fight, 'unstoppable', this.value('StatusImmuneDuration'), {}, ['unstoppable']);
    this.barrier(fight, this.value('CombatBarrier'), this.value('BuffDuration'), { moveSpeed: this.value('BonusMoveSpeed') });
  },
});
// Reactive Barrier / Indomitable: a barrier when cursed or stomped (Indomitable's cooldown comes back sooner when it procs).
define(['Reactive Barrier', 'Indomitable'], { on(event, fight, p) { if (event === 'ccLanded' && p.target === this.unit && this.fire()) this.barrier(fight, this.value('VexBarrierCombatBarrier'), this.value('AbilityDuration')); } });
// Unstoppable: used just before a blast lands: immune to its curse or stomp for a while, and existing debuffs end.
define('Unstoppable', ACTIVE, {
  want(fight) { return fight.foes.some((e) => e.stats.blast && (e.blastAt ?? Infinity) - fight.time < 1.5 && !e.has('silence')) && !this.unit.has('unstoppable'); },
  cast(fight) { this.buff(fight, 'unstoppable', this.value('AbilityDuration'), {}, ['unstoppable']); fight.cleanse(this.unit); },
});
// Frenzy: below half health, a burst of speed, fire rate and debuff resist (and existing debuffs are shortened by as much).
define('Frenzy', {
  tick(fight) {
    if (this.hurt >= this.value('LowHealthThreshold') / 100 || !fight.foes.length || !this.fire()) return;
    this.buff(fight, 'fervor', this.value('AbilityDuration'), { moveSpeed: this.value('FervorMovespeed'), fireRate: this.pct('FervorFireRate'), statusResist: this.pct('FervorStatusResistancePercent') });
    fight.cleanse(this.unit, this.pct('FervorStatusResistancePercent'));
  },
});

// ===== BARRIERS, HEALS AND HARDENING (actives the hero uses when hurt) =====
const barrierItem = (amountKey, durationKey, extra) => ({
  want(fight) { return fight.foes.length > 0 && this.hurt < 0.8; },
  cast(fight) { this.barrier(fight, this.value(amountKey), this.value(durationKey)); extra?.call(this, fight); },
});
define('Grit', ACTIVE, barrierItem('CombatBarrier', 'BarrierDuration'));
// Majestic Leap: a barrier and a leap (airborne a few seconds), landing with a slam that slows the enemies near.
define('Majestic Leap', ACTIVE, barrierItem('CombatBarrier', 'BarrierDuration', function (fight) {
  this.buff(fight, 'leap', 3, {}, ['airborne']);
  fight.at(3, () => { for (const e of fight.foes.length ? this.near(fight, 'SlamDownRadius') : []) this.slow(fight, e, this.pct('SlowPercent'), this.value('SlowDuration')); });
}));
define('Guardian Ward', ACTIVE, barrierItem('GuardianWardCombatBarrier', 'BuffDuration', function (fight) { this.buff(fight, 'speed', this.value('BuffDuration'), { moveSpeed: this.value('BonusMoveSpeed') }); }));
define('Divine Barrier', ACTIVE, barrierItem('CombatBarrier', 'BuffDuration', function (fight) { this.buff(fight, 'speed', this.value('BuffDuration'), { moveSpeed: this.value('BonusMoveSpeed') }); fight.cleanse(this.unit, 1, { stuns: false }); }));
const hurtActive = (hurtBelow, cast) => ({ want(fight) { return fight.foes.length > 0 && this.hurt < hurtBelow; }, cast });
define('Healing Nova', ACTIVE, hurtActive(0.7, function (fight) { this.regen(fight, this.value('TotalHealthRegen') / this.value('RegenDuration'), this.value('RegenDuration')); }));
define('Rescue Beam', ACTIVE, hurtActive(0.6, function (fight) { const t = this.value('AbilityChannelTime') || 2.5; this.regen(fight, (this.pct('HealPercentAmount') * this.maxHealth) / t, t); }));
define('Dispel Magic', ACTIVE, hurtActive(0.6, function (fight) { fight.heal(this.unit, this.value('HealOnActivate')); fight.cleanse(this.unit); this.buff(fight, 'speed', this.value('BuffDuration'), { moveSpeed: this.value('ActiveBonusMoveSpeed') }); }));
define('Warp Stone', ACTIVE, hurtActive(0.8, function (fight) { this.buff(fight, 'resist', this.value('CasterBuffDuration'), { bulletResist: this.pct('BulletResist') }); }));
// Colossus: bigger: resists and melee damage, and enemies near are slowed.
define('Colossus', ACTIVE, hurtActive(0.75, function (fight) {
  this.buff(fight, 'resist', this.value('AbilityDuration'), { bulletResist: this.pct('BuffBulletResist'), spiritResist: this.pct('BuffTechResist'), meleeDamage: this.pct('BonusMeleeDamagePercent') });
  for (const e of this.near(fight, 'Radius')) this.slow(fight, e, this.pct('SlowPercent'), this.value('AbilityDuration'));
}));
// Metal Skin: immune to bullets for a while, used when hurt by an enemy that shoots.
define('Metal Skin', ACTIVE, {
  want(fight) { return this.hurt < 0.8 && fight.foes.some((e) => e.stats.damageType === 'bullet' || e.stats.damageType === 'mixed'); },
  cast(fight) { this.buff(fight, 'metal', this.value('AbilityDuration'), { bulletTaken: -1 }); },
});
// Healing Rite: a long heal over time; damage from a boss (the game's "objectives") ends it.
define('Healing Rite', ACTIVE, hurtActive(0.8, function (fight) { this.regen(fight, this.value('TotalHealthRegen') / this.value('RegenDuration'), this.value('RegenDuration')); this.buff(fight, 'speed', this.value('RegenDuration'), { moveSpeed: this.value('BonusSprintSpeed') }); }), {
  on(event, fight, p) { if (event === 'damage' && p.target === this.unit && p.source.team === 'enemy' && isBoss(p.source)) { fight.removeStatus(this.unit, `${this.name}:regen`); fight.removeStatus(this.unit, `${this.name}:speed`); } },
});
// Restorative Locket (his call, Oct 3): a stack per enemy blast and per enemy spirit hit (max 25); the active heals per stack and gives back stamina.
define('Restorative Locket', ACTIVE, {
  init() { this.stacks = 0; },
  on(event, fight, p) {
    if ((event === 'blast' && p.target === this.unit) || (event === 'damage' && p.target === this.unit && p.type === 'spirit' && p.opts.attack)) this.stacks = Math.min(this.value('MaxStacks'), this.stacks + 1);
  },
  want(fight) { return fight.foes.length > 0 && this.stacks >= 5 && this.hurt < 0.7; },
  cast(fight) {
    fight.heal(this.unit, this.value('HealPerStack') * this.stacks);
    this.unit.stamina += Math.round((this.value('MaxStaminaRestore') * this.stacks) / this.value('MaxStacks'));
    this.stacks = 0;
  },
});
// Blood Tribute (a toggle): while healthy, health drains for fire rate, debuff resist and speed.
define('Blood Tribute', {
  init() { this.on_ = false; },
  tick(fight, dt) {
    this.on_ = fight.foes.length > 0 && (this.on_ ? this.hurt > 0.4 : this.hurt > 0.6);
    if (this.on_) this.unit.health = Math.max(1, this.unit.health - this.value('HealthDrainedPerSecond') * dt);
  },
  dynamicMods() { return this.on_ ? { fireRate: this.pct('BonusFireRate'), statusResist: this.pct('StatusResistancePercent'), moveSpeed: this.value('BonusMoveSpeed') } : null; },
});
// Diviner's Kevlar: casting the ultimate gives a barrier and spirit power.
define("Diviner's Kevlar", { on(event, fight, p) { if (castByMe(this, event, p) && p.ability?.ultimate && this.fire()) { this.barrier(fight, this.value('CombatBarrier'), this.value('BuffDuration')); this.buff(fight, 'spirit', this.value('BuffDuration'), { spirit: this.value('TechPower') }); } } });
// Celestial Blessing (a legendary): a big heal, a full cleanse, speed and quick stamina.
define('Celestial Blessing', ACTIVE, hurtActive(0.5, function (fight) {
  fight.heal(this.unit, Math.max(this.value('MinHeal'), this.pct('HealPercentAmount') * this.maxHealth));
  fight.cleanse(this.unit);
  this.buff(fight, 'blessing', this.value('BuffDuration'), { moveSpeed: this.value('BuffMoveSpeedBonus'), staminaCdr: this.pct('StaminaCooldownReduction') });
}));
// Veil Walker (his call, Oct 3): the hero passes a veil every time it's ready: a heal, speed, and invisibility until it next attacks.
define('Veil Walker', {
  tick(fight) {
    if (!fight.foes.length || !this.fire()) return;
    fight.heal(this.unit, this.value('HealOnVeil'));
    this.buff(fight, 'veil', this.value('InvisDuration'), {}, ['invisible'], { breakOnAttack: true });
    this.buff(fight, 'speed', this.value('AbilityDuration'), { moveSpeed: this.value('BonusMoveSpeed') });
  },
});
// Eternal Gift (a legendary): its permanent buffs come from fight time (play.js); in a fight it shortens a Rejuv's wait.
define('Eternal Gift', { respawnCut(fight) { return this.fire() ? -this.pct('RespawnTime') : 0; } });

// ===== ACTIVES THAT START A DAMAGE OR SPEED BUFF =====
const buffActive = (id, mods, durationKey = 'AbilityDuration') => ({ cast(fight) { this.buff(fight, id, this.value(durationKey), mods.call(this)); } });
define('Fury Trance', ACTIVE, buffActive('trance', function () { return { fireRate: this.pct('ActiveBonusFireRate'), spiritResist: this.pct('TechResist'), moveSpeed: this.value('ActiveBonusMoveSpeed') }; }));
define('Vampiric Burst', ACTIVE, buffActive('burst', function () { return { lifesteal: this.pct('ActiveBonusLifesteal'), fireRate: this.pct('ActiveBonusFireRate'), reloadSpeed: this.pct('ActiveReloadPercent') }; }));
define('Infuser', ACTIVE, buffActive('infuse', function () { return { spiritLifesteal: this.pct('AbilityLifestealPercentHero'), spirit: this.value('BonusSpirit') }; }));
define('Heroic Aura', ACTIVE, buffActive('aura', function () { return { fireRate: this.pct('BonusFireRate'), moveSpeed: this.value('ActiveBonusMoveSpeed') }; }));
define('Fleetfoot', ACTIVE, buffActive('fleet', function () { return { moveSpeed: this.value('ActiveBonusMoveSpeed') }; }));
define('Shrink Ray', ACTIVE, buffActive('shrink', function () { return { moveSpeed: this.value('BonusMoveSpeed'), fireRate: this.pct('BonusFireRate'), evasion: SHRINK_EVASION }; }, 'ShrinkDuration'));
// Cultist Sacrifice (his call, Oct 3): eats one enemy that isn't a boss (or a rival hero) outright for 170% of its souls (a won trip pays them), then a long buff.
define('Cultist Sacrifice', ACTIVE, {
  prey(fight) { return fight.foes.filter((e) => !isBoss(e) && e.team === 'enemy').sort((a, b) => b.health - a.health)[0]; },
  want(fight) { return !!this.prey(fight); },
  cast(fight) {
    const e = this.prey(fight);
    fight.bonusSouls += (e.stats.souls ?? 0) * this.pct('BonusSoulsPct');
    fight.damage(this.unit, e, e.health, 'true');
    this.buff(fight, 'cult', this.value('AbilityDuration'), { weaponDamage: this.pct('BaseAttackDamagePercent'), rangeMult: this.pct('TechRangeMultiplier'), bonusCharges: this.value('BonusAbilityCharges') });
    this.unit.addMaxHealth(this.value('BonusHealth'));
  },
});
// Split Shot: for a few seconds every shot also hits up to four other enemies; hitting more than one stacks weapon damage.
define('Split Shot', ACTIVE, {
  init() { this.until = 0; this.stacks = 0; },
  want(fight) { return fight.foes.length > 1; },
  cast(fight) { this.until = fight.time + this.value('BonusShotsDuration'); },
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || fight.time > this.until || p.opts.split) return;
    const others = fight.foes.filter((e) => e !== p.target).slice(0, this.value('BulletSplitShot') - 1);
    for (const e of others) fight.damage(this.unit, e, p.amount, 'bullet', { split: true, events: false });
    if (others.length) { this.stacks = Math.min(this.value('MaxStacks'), this.stacks + 1); this.buff(fight, 'split', this.value('WeaponDamageBonusDuration'), { weaponDamage: this.stacks * this.pct('WeaponDamagePerStack') }); }
  },
});

// ===== ACTIVES THAT HURT, HOLD OR SILENCE ENEMIES =====
const blast = (hit, radius) => ({ cast(fight) { for (const e of radius ? this.near(fight, radius) : fight.foes) hit.call(this, fight, e); } });
define('Cold Front', ACTIVE, blast(function (fight, e) { fight.damage(this.unit, e, this.value('Damage'), 'spirit'); this.slow(fight, e, this.pct('MovementSpeedSlow'), this.value('AbilityDuration')); }, 'EndRadius'));
// Silence Wave: damage, and silenced enemies hold their blasts (his call, Oct 3).
define('Silence Wave', ACTIVE, blast(function (fight, e) { fight.damage(this.unit, e, this.value('Damage'), 'spirit'); this.debuff(fight, e, 'silence', this.value('AbilityDuration'), {}, ['silence']); }));
define('Arctic Blast', ACTIVE, blast(function (fight, e) {
  fight.damage(this.unit, e, this.value('Damage'), 'spirit');
  this.debuff(fight, e, 'freeze', this.value('FreezeDuration'), {}, ['stun']);
  this.slow(fight, e, this.pct('SlowPercent'), this.value('FreezeDuration') + this.value('SlowDuration'));
}, 'EndRadius'));
define('Nullification Burst', ACTIVE, blast(function (fight, e) { fight.damage(this.unit, e, this.value('Damage'), 'spirit'); this.debuff(fight, e, 'null', this.value('AbilityDuration'), { healAmp: -1 }); }, 'EndRadius'));
const oneTarget = (hit, pick = (fight) => fight.foes[0]) => ({ cast(fight) { const e = pick.call(this, fight); if (e) hit.call(this, fight, e); } });
define('Phantom Strike', ACTIVE, oneTarget(function (fight, e) {
  fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit');
  this.debuff(fight, e, 'disarm', this.value('SlowDuration'), {}, ['disarm']);
  this.slow(fight, e, this.pct('SlowPercent'), this.value('SlowDuration'));
  this.unit.close = e; this.unit.closeUntil = fight.time + 3; // it teleports to the enemy
}));
define('Knockdown', ACTIVE, oneTarget(function (fight, e) { fight.at(this.value('StunDelay'), () => { if (e.alive) this.debuff(fight, e, 'stun', this.value('StunDuration'), {}, ['stun']); }); })); // enemies are never airborne: no bonus stun
define('Disarming Hex', ACTIVE, oneTarget(function (fight, e) { this.debuff(fight, e, 'disarm', this.value('AbilityDuration'), { bulletResist: this.pct('BulletArmorReduction') }, ['disarm']); }));
define('Rusted Barrel', ACTIVE, oneTarget(function (fight, e) { this.debuff(fight, e, 'rust', this.value('AbilityDuration'), { damageDealt: -this.pct('FireRateSlow'), bulletResist: this.pct('BulletArmorReduction') }); }));
define('Slowing Hex', ACTIVE, oneTarget(function (fight, e) { this.slow(fight, e, this.pct('SlowPercent'), this.value('AbilityDuration')); }));
define('Spirit Sap', ACTIVE, oneTarget(function (fight, e) { this.debuff(fight, e, 'sap', this.value('AbilityDuration'), { spiritResist: this.pct('MagicResistReduction'), spirit: this.value('TechPowerReduction') }); }, function (fight) { return this.biggest(fight); }));
define('Decay', ACTIVE, oneTarget(function (fight, e) {
  this.dot(fight, e, this.pct('DotHealthPercent') * npcShare(e), this.value('AbilityDuration'), { ofCurrent: true, nonLethal: true });
  this.debuff(fight, e, 'heal', this.value('AbilityDuration'), { healAmp: this.pct('HealAmpReceivePenaltyPercent') });
}, function (fight) { return this.biggest(fight); }));
// Cursed Relic: the enemy with a blast (else the biggest) is silenced and disarmed; the holder deals less damage meanwhile.
define('Cursed Relic', ACTIVE, oneTarget(function (fight, e) {
  this.debuff(fight, e, 'curse', this.value('AbilityDuration'), {}, ['silence', 'disarm']);
  this.buff(fight, 'penalty', this.value('AbilityDuration'), { damageDealt: this.pct('OutgoingDamagePenaltyPercent') });
}, function (fight) { return fight.foes.find((e) => e.stats.blast) ?? this.biggest(fight); }));
// Focus Lens: silences the biggest enemy, then hits it with a share of all the damage it took meanwhile; its spirit resist and spirit power drop.
define('Focus Lens', ACTIVE, oneTarget(function (fight, e) {
  const silence = this.value('AbilityDuration');
  const before = e.health;
  this.debuff(fight, e, 'silence', silence, {}, ['silence']);
  this.debuff(fight, e, 'focus', this.value('ResistReductionDuration'), { spiritResist: this.pct('MagicResistReduction'), spirit: this.value('TechPowerReduction') });
  fight.at(silence, () => { if (e.alive) fight.damage(this.unit, e, Math.max(0, before - e.health) * this.pct('PercentDamage'), 'spirit', { proc: true }); });
}, function (fight) { return this.biggest(fight); }));
// Vortex Web: pulls the enemies near together (every area effect then reaches them all), holds them in place and slows them.
define('Vortex Web', ACTIVE, {
  want(fight) { return fight.foes.length > 1; },
  cast(fight) {
    const caught = this.near(fight, 'CaptureRadius');
    const spot = caught[0].offset ?? 0;
    for (const e of caught) { e.offset = spot; this.debuff(fight, e, 'web', this.value('AbilityDuration'), { slow: this.pct('SlowPercent') }, ['immobilize']); }
  },
});
// Mystical Piano (a legendary): a moment later, enemies in the area are stunned, then dazed (slowed, disarmed and silenced).
define('Mystical Piano', ACTIVE, {
  cast(fight) {
    fight.at(this.value('StunDelay'), () => {
      for (const e of fight.foes.length ? this.near(fight, 'Radius') : []) {
        this.debuff(fight, e, 'stun', PIANO_STUN, {}, ['stun']);
        fight.at(PIANO_STUN, () => { if (e.alive) this.debuff(fight, e, 'daze', this.value('DazeDuration'), { slow: 0.3 }, ['disarm', 'silence']); });
      }
    });
  },
});
define('Scourge', ACTIVE, {
  init() { this.until = 0; },
  cast(fight) {
    this.until = fight.time + this.value('AbilityDuration');
    this.buff(fight, 'resist', this.value('AbilityDuration'), { spiritResist: this.pct('TechResist'), statusResist: this.pct('StatusResistancePercent') });
    fight.cleanse(this.unit, this.pct('StatusResistancePercent'));
  },
  tick(fight, dt) { // a share of each enemy's max health per second while it lasts
    if (fight.time >= this.until || !fight.foes.length) return;
    for (const e of this.near(fight, 'AuraRadius')) fight.damage(this.unit, e, this.pct('MaxHealthPercentAsDPS') * e.stats.maxHealth * npcShare(e) * dt, 'spirit', { events: false });
  },
});
define('Alchemical Fire', ACTIVE, {
  init() { this.start = 0; this.until = 0; },
  cast(fight) { this.start = fight.time; this.until = fight.time + this.value('AbilityDuration'); },
  tick(fight, dt) { // damage per second grows over the flask's life, half as strong against NPCs
    if (fight.time >= this.until || !fight.foes.length) return;
    const dps = Math.min(this.value('DPSMax'), this.value('DPS') + this.value('DPSIncrease') * (fight.time - this.start)) * (1 - this.pct('NonHeroReductionPercent'));
    for (const e of this.near(fight, 'Radius')) {
      fight.damage(this.unit, e, dps * dt, 'spirit', { events: false });
      this.debuff(fight, e, 'shred', 0.25, { bulletResist: this.pct('BulletArmorReduction') });
    }
  },
});
define('Torment Pulse', {
  tick(fight) { // every 1.4 s, spirit damage to the closest two enemies
    if (!fight.foes.length || !this.fire()) return;
    for (const e of this.near(fight, 'DamagePulseRadius').slice(0, 2)) fight.damage(this.unit, e, this.value('DamagePulseAmount'), 'spirit', { proc: true });
  },
});

// ===== VOID, STEALTH AND ESCAPES (his calls, Oct 3) =====
// Ethereal Shift: when low, a few seconds where nothing can touch the hero (nor can it act), then spirit, spirit resist and speed.
define('Ethereal Shift', ACTIVE, hurtActive(0.35, function (fight) {
  const d = this.value('AbilityDuration');
  this.buff(fight, 'void', d, { damageTaken: -1 }, ['void']);
  fight.at(d, () => this.buff(fight, 'after', this.value('BuffDuration'), { spirit: this.value('BonusSpirit'), spiritResist: this.pct('TechResist'), moveSpeed: this.value('BonusMoveSpeed') }));
}));
// Prism Blast (a legendary): untouchable for a few seconds while lasers burn every enemy around.
define('Prism Blast', ACTIVE, {
  init() { this.until = 0; },
  want(fight) { return fight.foes.length > 0 && (this.hurt < 0.6 || fight.foes.length > 1 || isBoss(fight.foes[0])); },
  cast(fight) { this.until = fight.time + this.value('AbilityDuration'); this.buff(fight, 'void', this.value('AbilityDuration'), { damageTaken: -1 }, ['void']); },
  tick(fight, dt) { if (fight.time < this.until && fight.foes.length) for (const e of fight.near(PRISM_RADIUS * this.unit.range)) fight.damage(this.unit, e, this.value('DPS') * dt, 'spirit', { events: false }); },
});
// Magic Carpet (his call, Oct 3): when low, the hero flies off for a while: nothing can hit it and it can't shoot; out-of-combat regen starts. It
// comes back once healed to 70% or when the carpet's time is up.
define('Magic Carpet', ACTIVE, hurtActive(0.3, function (fight) {
  fight.at(this.value('SummonDuration'), () => { if (this.unit.alive) this.buff(fight, 'carpet', this.value('AbilityDuration'), {}, ['untargetable', 'hold', 'airborne']); });
}), { tick(fight) { if (this.hurt >= 0.7) fight.removeStatus(this.unit, `${this.name}:carpet`); } });
// Shadow Weave: when low, the hero goes invisible and lies low for a moment, then strikes out of stealth with an Ambush buff.
define('Shadow Weave', ACTIVE, hurtActive(0.4, function (fight) {
  this.buff(fight, 'stealth', this.value('AbilityDuration'), {}, ['invisible'], { breakOnAttack: true });
  this.buff(fight, 'lowl', Math.min(LIE_LOW, this.value('AbilityDuration')), {}, ['hold']);
}), {
  on(event, fight, p) {
    if (event === 'unstealth' && this.mine(p.source) && p.ended.includes(`${this.name}:stealth`)) {
      this.buff(fight, 'ambush', this.value('AmbushDuration'), { fireRate: this.pct('AmbushBonusFireRate'), spirit: this.value('AmbushBonusTechPower'), meleeDamage: this.pct('AmbushBonusMeleeDamage') });
    }
  },
});
// Unstable Concoction (a legendary; his call, Oct 3): a huge buff, then the hero explodes (damage from its max health, a stun) and is left at 1 health
// instead of dying. Used when the explosion would finish every enemy left, or when the hero is nearly dead anyway.
define('Unstable Concoction', ACTIVE, {
  boom() { return this.pct('MaxHPDamage') * (this.maxHealth + this.value('BonusHealth')); },
  want(fight) { const near = this.near(fight, 'Radius'); return near.length > 0 && (this.hurt < 0.15 || (near.length === fight.foes.length && near.every((e) => e.health <= this.boom() * (1 - e.stats.spiritResist)))); },
  cast(fight) {
    const bonus = this.value('BonusHealth');
    const d = this.value('AbilityDuration');
    this.unit.addMaxHealth(bonus);
    this.buff(fight, 'concoction', d, { moveSpeed: this.value('BonusMoveSpeed'), spirit: this.value('TechPower'), weaponDamage: this.pct('BaseAttackDamagePercent') }, ['unstoppable']);
    fight.at(d, () => {
      if (!this.unit.alive) return;
      const damage = this.pct('MaxHPDamage') * this.maxHealth;
      for (const e of fight.foes.length ? this.near(fight, 'Radius') : []) { fight.damage(this.unit, e, damage, 'spirit'); this.debuff(fight, e, 'stun', this.value('StunDuration'), {}, ['stun']); }
      this.unit.addMaxHealth(-bonus);
      this.unit.health = 1;
    });
  },
});

// ===== COOLDOWNS AND CHARGES =====
define('Refresher', ACTIVE, {
  want(fight) { return fight.foes.length > 0 && this.unit.abilities.filter((a) => a.cdLeft > 0).length >= 2; },
  cast() { for (const a of this.unit.abilities) a.refresh(); for (const it of this.unit.items) if (it !== this) it.cdLeft = 0; },
});
// Recharging Rush: 200 weapon damage within a few seconds gives every charged ability a charge back.
define('Recharging Rush', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p)) return;
    if (this.windowed(fight, 'dealt', p.dealt, this.value('DamageWindow')) >= this.value('DamageThreshold') && this.fire()) {
      this.clearWindow('dealt');
      for (const a of this.unit.abilities.filter((ab) => ab.maxCharges > 1)) a.charges += 1;
    }
  },
});

// ===== IMBUES (his call, Oct 3: the member picks the ability; `imbue` is what it adds to it) =====
define('Mystic Expansion', { get imbue() { return { range: this.pct('TechRangeMultiplier') }; } });
define('Compress Cooldown', { get imbue() { return { cdr: this.pct('CooldownReduction') }; } });
define('Duration Extender', { get imbue() { return { duration: this.pct('BonusAbilityDurationPercent') }; } });
define('Omnicharge Signet', { get imbue() { return { charges: this.value('BonusAbilityCharges'), chargesNonCharge: this.value('BonusAbilityChargesNonCharge') }; } });
// Surge of Power: spirit power for the ability, and using it gives fire rate and speed.
define('Surge of Power', {
  get imbue() { return { spirit: this.value('ImbuedTechPower') }; },
  on(event, fight, p) { if (castByMe(this, event, p) && p.ability && p.ability === this.imbued && this.fire()) this.buff(fight, 'surge', this.value('MovementSpeedBonusDuration'), { fireRate: this.pct('FireRateBonus'), moveSpeed: this.value('BonusMoveSpeed') }); },
});
// Ballistic Enchantment: range for the ability; each enemy it hits gives weapon damage (the NPC amount, up to its limit).
define('Ballistic Enchantment', {
  init() { this.hit = new Set(); },
  get imbue() { return { range: this.pct('TechRangeMultiplier') }; },
  on(event, fight, p) {
    if (event !== 'damage' || !this.mine(p.source) || !this.fromImbued(p)) return;
    this.hit.add(p.target);
    const n = Math.min(this.value('NonHeroStackLimit'), this.hit.size);
    this.buff(fight, 'ballistic', this.value('AbilityDuration'), { weaponDamage: n * this.pct('WeaponPowerPerStackNonHero') });
  },
});
// Quicksilver Reload / Mercurial Magnum: charged up over time, the imbued ability reloads the gun, gives fire rate and hits for extra spirit damage;
// Mercurial Magnum's bullets also deal spirit damage until the next reload.
const quicksilver = {
  init() { this.armed = false; this.magnum = false; },
  on(event, fight, p) {
    if (castByMe(this, event, p) && p.ability && p.ability === this.imbued && this.fire()) {
      const w = this.unit.weapon;
      w.clip = this.unit.stats.clip; w.reloadLeft = 0;
      this.buff(fight, 'quick', this.value('BuffDuration'), { fireRate: this.pct('BonusFireRate') });
      this.armed = true;
      this.magnum = !!this.entries.BulletsBonusMagicDamage;
    }
    if (event === 'damage' && this.mine(p.source) && this.armed && this.fromImbued(p)) { this.armed = false; fight.damage(this.unit, p.target, this.value('Damage'), 'spirit', { proc: true }); }
    if (bulletHit(this, event, p) && this.magnum) fight.damage(this.unit, p.target, this.value('BulletsBonusMagicDamage'), 'spirit', { proc: true });
    if (event === 'reloadStart' && this.mine(p.source)) this.magnum = false;
  },
};
define(['Quicksilver Reload', 'Mercurial Magnum'], quicksilver);
// Echo Shard: resets the imbued ability's cooldown.
define('Echo Shard', ACTIVE, {
  want(fight) { return fight.foes.length > 0 && this.imbued?.cdLeft > 5; },
  cast() { this.imbued.refresh(); },
});
// Mystic Reverb: the imbued ability's hits heal (spirit lifesteal) and echo a moment later onto the enemies near, slowing them.
define('Mystic Reverb', {
  on(event, fight, p) {
    if (event !== 'damage' || !this.mine(p.source) || !this.fromImbued(p) || p.opts.reverb) return;
    fight.heal(this.unit, p.dealt * this.pct('ImbueAbilityLifesteal') * LIFESTEAL_VS_NPC, 'lifesteal');
    if (!this.fire()) return;
    const echo = Math.max(this.value('MinimumDamage'), p.amount * this.pct('TechDamagePercent'));
    fight.at(this.value('DelayDuration'), () => {
      for (const e of fight.foes.length ? this.near(fight, 'Radius') : []) { fight.damage(this.unit, e, echo, 'spirit', { reverb: true, events: false }); this.slow(fight, e, this.pct('MovementSpeedSlow'), 2); }
    });
  },
});
// Frostbite Charm (a legendary): cooldown and spirit power for the ability; its hits freeze and add damage (each enemy at most every 10 s).
define('Frostbite Charm', {
  init() { this.frozen = new Map(); },
  get imbue() { return { cdr: this.pct('ImbuedCooldownReduction'), spirit: this.value('ImbuedTechPower') }; },
  on(event, fight, p) {
    if (event !== 'damage' || !this.mine(p.source) || !this.fromImbued(p) || !p.target.alive || (this.frozen.get(p.target) ?? -Infinity) > fight.time) return;
    this.frozen.set(p.target, fight.time + this.cooldown);
    this.debuff(fight, p.target, 'freeze', this.value('FreezeDuration'), {}, ['stun']);
    fight.damage(this.unit, p.target, this.value('Damage'), 'spirit', { proc: true });
  },
});

// Items with an imbue: buying one asks which ability (his call, Oct 3).
const IMBUES = Object.keys(FX).filter((name) => Object.getOwnPropertyDescriptor(FX[name].prototype, 'imbue') || ['Quicksilver Reload', 'Mercurial Magnum', 'Echo Shard', 'Mystic Reverb'].includes(name));

// The item objects for a hero (an item without effects of its own is just stats and needs none). `cards` are the cards it fights with
// (stats.js cardFor: a corrupted one has its bonuses); `imbues` = { item name: ability slot }.
const makeItems = (cards, unit, imbues = {}) => cards.filter((c) => FX[c.Name]).map((c) => {
  const it = new FX[c.Name](c, unit);
  if (IMBUES.includes(c.Name)) it.imbueSlot = imbues[c.Name] ?? 1;
  return it;
});

module.exports = { Item, FX, IMBUES, makeItems, HEADSHOT_CHANCE, isBoss, npcShare };
