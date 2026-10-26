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
// ponytail: headshots (the hero's Precision) and the active-reload timing are chances, the engine has no aiming.
const { MIN_COOLDOWN } = require('./ability');
const { SPIRIT_LIFESTEAL_VS_NPC, headshotChance } = require('./engine');

// Effects that take a share of an enemy's max health are weaker against NPCs: half against camp creeps (the wiki's own DotMultiplerTroopers 0.5 for Toxic
// Bullets), and far less against bosses. ponytail: the boss share is a guess, so a 13,000 health Mid-Boss doesn't lose a quarter of it to one item.
const BOSS_HEALTH = 3000;
const isBoss = (unit) => unit.stats.maxHealth > BOSS_HEALTH;
const npcShare = (target) => (isBoss(target) ? 0.15 : 0.5);
const ACTIVE_RELOAD_CHANCE = 0.7;
// ponytail: placeholders for what the cards don't say: how long Shadow Weave lies low before striking,
// Shrink Ray's evasion (his call, Oct 3). Not in our copy of the legendaries' cards (deadlock-api.com has them, Oct 22): Mystical Piano's 2 s stun,
// Prism Blast's 30 m beam.
const PARRY_COOLDOWN = 4.5; // the wiki's Parry page: a missed parry waits 4.5 s (Rebuttal's -1.75 makes it 2.75)
const LIE_LOW = 4;
const SHRINK_EVASION = 0.2;
const PIANO_STUN = 2;
const PRISM_REACH = 30;
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
      if (sc.Type === 'spirit') v += sc.Value * (this.unit.stats.spirit + this.unit.mod('spirit') * (this.unit.stats.spiritMult ?? 1));
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
    const base = info?.Cooldown ?? this.infos.find((i) => i.Cooldown)?.Cooldown ?? this.infos.find((i) => i.ChargeUp)?.ChargeUp ?? this.value('AbilityCooldown'); // a charge-up item's timer is its charge-up (Mercurial Magnum 14 s; its data's AbilityCooldown says 15)
    return this.infos.some((i) => i.ChargeUp) ? base : base * Math.max(MIN_COOLDOWN, 1 - this.unit.stat('itemCdr')); // not a charge-up item (the wiki)
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
  headshot(fight, p) { return !p?.opts?.ricochet && fight.rng() < headshotChance(this.unit); } // a ricochet can't headshot (the wiki)
  mine(source) { return source === this.unit; }
  // True while `unit` carries this item's status `id` (unit.has() checks tags, not ids).
  marked(unit, id) { return unit.statuses.some((st) => st.id === `${this.name}:${id}`); }
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
const weaponHit = (item, event, p) => (event === 'bulletHit' || event === 'melee') && item.mine(p.source); // a bullet or a melee (the wiki: Spirit Shredder, Stalker, Recharging Rush)
const hitOnMe = (item, event, p) => event === 'attacked' && p.target === item.unit; // an enemy hit about to land on the holder
const castByMe = (item, event, p) => event === 'cast' && item.mine(p.source);
// A fire rate slow: a rival hero's gun fires slower; a farm enemy hits once a second, so it deals that much less.
const fireSlow = (e, share) => ({ [e.team === 'hero' ? 'fireRate' : 'damageDealt']: -share });
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
  on(event, fight, { source, target, amount }) { // damage before resists counts (the wiki), not while the holder can't be hurt (Ethereal Shift, Cheat Death)
    if (event !== 'damage' || target !== this.unit || source === this.unit || this.unit.mod('damageTaken') <= -1) return;
    this.taken += amount;
    while (this.taken >= this.value('DamageToStack')) {
      this.taken -= this.value('DamageToStack');
      this.stacks = Math.min(this.value('MaxStacks'), this.stacks + 1);
      this.until = fight.time + this.value('DamageDuration');
    }
  },
  weaponBonus() { return this.stacks * this.pct('WeaponPowerPerStack'); },
});
// Kill stacks kept on the hero from fight to fight until it dies (his calls, Oct 22: Glass Cannon "perma until death", Trophy Collector "trophy stacks
// disappear on death"): item name -> the item's stack field. `kept` on the hero's record (play.js); a death, even one a Rejuv gets the hero up from,
// loses them all.
const KEPT = { 'Glass Cannon': 'kills', 'Trophy Collector': 'stacks' };
const keptAtStart = (item) => Math.min(item.value('MaxStacks'), item.unit.kept?.[item.name] ?? 0);
const diedHere = (item, event, { target, dealt }) => event === 'damage' && target === item.unit && dealt > 0 && item.unit.statuses.some((st) => st.id === 'rejuv'); // the hit that killed it (a Rejuv is up)
// What a fight leaves on the hero: { item name: stacks } for the kept-stack items it holds (none if it went down).
const keptAfter = (hero) => Object.fromEntries(hero.items.filter((it) => KEPT[it.name]).map((it) => [it.name, hero.alive ? it[KEPT[it.name]] : 0]));
// Glass Cannon: each kill is +7% fire rate, up to 8, kept until death (above).
define('Glass Cannon', {
  init() { this.kills = keptAtStart(this); },
  on(event, fight, p) {
    if (event === 'kill' && this.mine(p.source)) this.kills = Math.min(this.value('MaxStacks'), this.kills + 1);
    if (diedHere(this, event, p)) this.kills = 0;
  },
  dynamicMods() { return this.kills ? { fireRate: this.kills * this.pct('FireRatePerKill') } : null; },
});
define('Escalating Resilience', {
  init() { this.stacks = 0; this.until = 0; },
  tick(fight) { if (fight.time > this.until) this.stacks = 0; },
  // MaxArmorStacks is the most bullet resist (30%, the wiki), so 15 stacks
  on(event, fight, p) { if (bulletHit(this, event, p)) { this.stacks = Math.min(this.value('MaxArmorStacks') / this.value('BulletResistPerStack'), this.stacks + 1); this.until = fight.time + this.value('BulletResistDuration'); } },
  dynamicMods() { return this.stacks ? { bulletResist: this.stacks * this.pct('BulletResistPerStack') } : null; },
});
// Bullet / Spirit Resilience: below half health the item's own 30% becomes 45% (the wiki: one unified bonus, not 30% and 15% stacked), so the extra is
// what turns its share of the hero's stacked resist from 30% into 45%.
const resilience = (stat, innateKey, extraKey) => ({
  dynamicMods() {
    if (this.hurt >= this.value('HealthThreshold') / 100) return null;
    const own = this.innate(innateKey) / 100;
    return { [stat]: 1 - (1 - own - this.pct(extraKey)) / (1 - own) };
  },
});
define('Bullet Resilience', resilience('bulletResist', 'BulletResist', 'BulletResistBelowThreshold'));
define('Spirit Resilience', resilience('spiritResist', 'TechResist', 'TechResistBelowThreshold'));
define('Fortitude', {
  tick(fight, dt) { if (fight.time - this.unit.lastHit >= this.value('RestoreDelay') && this.hurt < 1) fight.heal(this.unit, this.pct('HealLifePercentOutOfCombat') * this.maxHealth * dt, 'regen'); },
  dynamicMods() { return this.hurt >= this.value('HealthThreshold') / 100 ? { moveSpeed: this.value('BonusMoveSpeed') } : null; },
});
// Trophy Collector: every kill is a stack (max 16): sprint, ability range, and souls per minute (his call, Oct 3: they go into a won trip's pay);
// kept until death (above).
define('Trophy Collector', {
  init() { this.stacks = keptAtStart(this); },
  on(event, fight, p) {
    if (event === 'kill' && this.mine(p.source)) this.stacks = Math.min(this.value('MaxStacks'), this.stacks + 1);
    if (diedHere(this, event, p)) this.stacks = 0;
  },
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
define('Headshot Booster', { on(event, fight, p) { if (bulletHit(this, event, p) && this.cdLeft <= 0 && this.headshot(fight, p)) { this.fire(); fight.damage(this.unit, p.target, this.value('HeadShotBonusDamage'), 'bullet', { events: false }); } } });
define('Headhunter', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || this.cdLeft > 0 || !this.headshot(fight, p)) return;
    this.fire();
    fight.damage(this.unit, p.target, this.value('HeadShotBonusDamage'), 'bullet', { events: false });
    fight.heal(this.unit, this.pct('HealPercentPerHeadshot') * this.maxHealth);
    this.buff(fight, 'speed', this.value('MovementSpeedBonusDuration'), { moveSpeed: this.value('BonusMoveSpeed') });
  },
});
define('Weakening Headshot', { on(event, fight, p) { if (bulletHit(this, event, p) && this.headshot(fight, p)) this.debuff(fight, p.target, 'shred', this.value('DebuffDuration'), { bulletResist: this.pct('BulletResistReduction') }); } });
define('Crippling Headshot', {
  on(event, fight, p) {
    if (bulletHit(this, event, p) && this.headshot(fight, p)) {
      this.debuff(fight, p.target, 'shred', this.value('DebuffDuration'), { bulletResist: this.pct('BulletResistReduction'), spiritResist: this.pct('MagicResistReduction'), healAmp: this.pct('HealAmpRegenPenaltyPercent') });
    }
  },
});
define('Lucky Shot', { on(event, fight, p) { if (bulletHit(this, event, p) && fight.rng() < this.pct('ProcChance')) fight.damage(this.unit, p.target, p.amount * this.pct('CritDamagePercent'), 'bullet', { events: false, noEvade: true }); } }); // the bonus can't be evaded (the wiki)
// Ricochet: the bounce is a bullet too, so other bullet items proc on it (but it doesn't bounce again, can't headshot, and Tesla Bullets, Capacitor and
// Siphon Bullets skip it: the wiki). Bullets don't bounce off objectives (a boss here).
define('Ricochet', {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || p.opts.ricochet || isBoss(p.target)) return;
    const others = fight.foes.filter((e) => e !== p.target && Math.abs((e.offset ?? 0) - (p.target.offset ?? 0)) <= this.value('RicochetRadius'));
    for (const other of others.slice(0, this.value('RicochetTargets'))) fight.damage(this.unit, other, p.amount * this.pct('RicochetDamagePercent'), 'bullet', { ricochet: true });
  },
});
// Tesla Bullets / Capacitor: a chance to shock, jumping to enemies near the target.
const chain = {
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || p.opts.ricochet || this.procLeft > 0 || fight.rng() >= this.pct('ProcChance')) return;
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
// Armor Piercer / Infinite Rounds: ProcChance of the bullets ignore bullet resist, evasion and barriers (the wiki) and pierce on to the enemy behind
// (once a bullet, whichever of the two the hero holds).
const piercing = {
  shotOpts(fight) { const pierce = fight.rng() < this.pct('ProcChance'); return { ignoreBulletResist: pierce, unavoidable: pierce, pierce }; },
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || !p.opts.pierce || p.opts.pierced) return;
    p.opts.pierced = true;
    const behind = fight.foes.find((e) => e !== p.target && (e.offset ?? 0) >= (p.target.offset ?? 0));
    if (behind) fight.damage(this.unit, behind, p.amount, 'bullet', { ignoreBulletResist: true, unavoidable: true, events: false });
  },
};
define('Armor Piercer', piercing);
// Infinite Rounds (a legendary): never reloads, and pierces like Armor Piercer.
define('Infinite Rounds', piercing, {
  tick(fight) { if (!this.unit.statuses.some((st) => st.id === `${this.name}:ammo`)) this.buff(fight, 'ammo', Infinity, {}, ['infiniteClip']); },
});
define('Restorative Shot', { on(event, fight, p) { if (bulletHit(this, event, p) && this.fire()) fight.heal(this.unit, this.value(p.target.team === 'hero' ? 'HealFromHero' : 'HealFromNPC')); } }); // a rival hero heals more
define('Burst Fire', { on(event, fight, p) { if (bulletHit(this, event, p) && this.fire()) this.buff(fight, 'burst', this.value('AbilityDuration'), { fireRate: this.pct('ActivatedFireRate'), moveSpeed: this.value('BonusMoveSpeed') }); } });
define('Suppressor', { on(event, fight, p) { if (spiritHit(this, event, p)) this.debuff(fight, p.target, 'suppress', this.value('AbilityDuration'), fireSlow(p.target, this.pct('FireRateSlow'))); } });
define('Bullet Resist Shredder', { on(event, fight, p) { if (spiritHit(this, event, p)) this.debuff(fight, p.target, 'shred', this.value('AbilityDuration'), { bulletResist: this.pct('BulletArmorReduction') }); } });
define("Hunter's Aura", {
  tick(fight) { // every enemy close enough loses bullet resist and fire rate; doubled against a lone enemy
    const k = fight.foes.length === 1 ? 2 : 1;
    for (const e of this.near(fight, 'Radius')) this.debuff(fight, e, 'aura', 0.25, { bulletResist: k * this.pct('BulletArmorReduction'), ...fireSlow(e, k * this.pct('FireRateSlow')) });
  },
});
const shredder = { on(event, fight, p) { if (weaponHit(this, event, p)) this.debuff(fight, p.target, 'spirit', this.value('DebuffDuration'), { spiritResist: this.pct('TechArmorDamageReduction'), spiritLifestealOn: this.pct('AbilityLifestealPercentHero') }); } };
define('Spirit Shredder', shredder);
define('Spirit Rend', {
  init() { this.stacks = new Map(); },
  on(event, fight, p) {
    shredder.on.call(this, event, fight, p);
    if (!bulletHit(this, event, p) || !this.headshot(fight, p) || !this.proc()) return; // a headshot adds a stack of spirit resist shred, at most every 2 s, up to 4; each refreshes all
    const n = Math.min(this.value('MaxStacks'), (this.marked(p.target, 'rend') ? this.stacks.get(p.target) ?? 0 : 0) + 1);
    this.stacks.set(p.target, n);
    this.debuff(fight, p.target, 'rend', this.value('DebuffDuration'), { spiritResist: n * this.pct('MagicResistReduction') });
  },
});
// Siphon Bullets: a hit that deals damage steals 2.5% of the enemy's (current) max health, and deals as much as flat damage that no resist changes
// (the wiki); a share of it against NPCs. Everything stolen from one enemy comes back 17 s after the last steal from it (each steal refreshes it).
define('Siphon Bullets', {
  init() { this.stolen = new Map(); },
  on(event, fight, p) {
    if (!bulletHit(this, event, p) || p.opts.ricochet || !(p.dealt > 0) || !this.fire()) return;
    const foe = p.target;
    const steal = this.pct('HealthStealPctHero') * foe.stats.maxHealth * npcShare(foe);
    foe.addMaxHealth(-steal);
    this.unit.addMaxHealth(steal);
    fight.damage(this.unit, foe, steal, 'true', { events: false });
    const held = this.stolen.get(foe) ?? { amount: 0 };
    held.amount += steal;
    held.until = fight.time + this.value('StealDuration');
    this.stolen.set(foe, held);
    fight.at(this.value('StealDuration'), () => {
      if (fight.time + 1e-9 < held.until || this.stolen.get(foe) !== held) return; // stolen again since
      this.stolen.delete(foe);
      if (foe.alive) foe.addMaxHealth(held.amount);
      this.unit.addMaxHealth(-held.amount);
    });
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
const BUILD_UP = { Haze: 7.4 / 1.28, Abrams: (3.4 * 9) / 1.28, Mina: 15.7 / 1.28, Celeste: 28.7 / 1.28, Paige: 26.0 / 1.28, Apollo: 21.5 / 1.28, Bebop: 6.1 / 1.28, Billy: 6.1 / 1.28, Calico: (1.5 * 9) / 1.28, 'The Doorman': 30.2 / 1.28, Drifter: (8 * 3) / 1.28, Dynamo: 16.2 / 1.28, Graves: 7.2 / 1.28, 'Grey Talon': 29.3 / 1.28, Holliday: 25.1 / 1.28, Infernus: 7.4 / 1.28, Ivy: 5.3 / 1.28, Kelvin: 16.2 / 1.28, 'Lady Geist': 25.1 / 1.28, Lash: 11.4 / 1.28, McGinnis: 6.1 / 1.28, Mirage: 21.0 / 1.28, 'Mo & Krill': (3.1 * 4) / 1.28, Paradox: 9.1 / 1.28, Pocket: (3.8 * 7) / 1.28, Rem: 16.1 / 1.28, Seven: 11.4 / 1.28, Shiv: (4.6 * 6) / 1.28, Silver: (5.1 * 7) / 1.28, Sinclair: 21.0 / 1.28, Venator: 8.7 / 1.28, Victor: 11.4 / 1.28, Vindicta: 14.7 / 1.28, Viscous: 13.6 / 1.28, Vyper: 5.1 / 1.28, Warden: 16.2 / 1.28, Wraith: 6.7 / 1.28, Yamato: (4.6 * 5) / 1.28, Baba: (6.2 * 3) / 1.28, 'Rat King': (6.5 * 2) / 1.28, Solomon: 26.0 / 1.28, 'Deadman Danny': 15.6 / 1.28, 'Nurse Harrow': 21.5 / 1.28, Violet: 30.8 / 1.28 }; // Baba: 6.2% a pellet x 3, Rat King: 6.5% a pellet x 2, Solomon 26% (table checked Oct 10); Danny 15.6% an uncharged shot (Oct 16); Nurse Harrow 21.5%, Violet 30.8% (Oct 20); table re-checked Oct 22: Paige 26%, The Doorman 30.2%, Nurse Harrow 21.5% (were 22.3, 28.7, 7.4)
// The cards' build-up numbers don't compare across items: the wiki's own per-hero tables (Oct 22) have Slowing Bullets building 1.83x as fast as Toxic
// Bullets for every hero (Weighted Shots the same), though their cards say 0.7 to Toxic's 1.28. So an item's card number is scaled to match its table.
const BUILD_SCALE = { 'Slowing Bullets': (1.83 * 1.28) / 0.7, 'Weighted Shots': (1.83 * 1.28) / 0.7, 'Spiritual Overflow': (1.188 * 1.28) / 1.08, Silencer: (1.23 * 1.28) / 1.04, Inhibitor: (1.662 * 1.28) / 0.77 }; // Weighted Shots: Slowing Bullets' table; Spiritual Overflow 1.188x, Silencer 1.23x, Inhibitor 1.662x Toxic (their tables, Oct 22)
const buildUpPerShot = (item) => item.value('BuildUpPerShot') * (BUILD_UP[item.unit.name] ?? 15 / 1.28) * (BUILD_SCALE[item.name] ?? 1);
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
// Inhibitor: a full bar cuts the enemy's damage 30% and its healing 40% for 5 s; while it lasts each hit refreshes it (the wiki).
const inhibit = function (fight, target) { this.debuff(fight, target, 'inhibit', this.value('DebuffDuration'), { damageDealt: this.pct('OutgoingDamagePenaltyPercent'), healAmp: this.pct('HealAmpReceivePenaltyPercent') }); };
const inhibitor = buildUp(inhibit);
define('Inhibitor', inhibitor, { on(event, fight, p) { if (bulletHit(this, event, p) && this.marked(p.target, 'inhibit')) inhibit.call(this, fight, p.target); else inhibitor.on.call(this, event, fight, p); } });
// Silencer (back in the shop, his call Oct 22): every bullet cuts the enemy's spirit damage 25% for 6 s; bullets build up to a 2.5 s silence (a
// silenced enemy holds its blast), then that enemy can't be built up for 10 s after it ends (the wiki).
const silencer = buildUp(function (fight, target) {
  this.debuff(fight, target, 'silence', this.value('SilenceDuration'), {}, ['silence']);
  this.immune.set(target, fight.time + this.value('SilenceDuration') + this.value('ImmunityDuration'));
});
define('Silencer', silencer, {
  init() { silencer.init.call(this); this.immune = new Map(); },
  on(event, fight, p) {
    if (bulletHit(this, event, p)) this.debuff(fight, p.target, 'suppress', this.value('DebuffDuration'), { spiritDealt: this.pct('TechDamageReduction') });
    if ((this.immune.get(p.target) ?? -Infinity) <= fight.time) silencer.on.call(this, event, fight, p);
  },
});
define(['Slowing Bullets', 'Weighted Shots'], buildUp(function (fight, target) { this.slow(fight, target, this.pct('SlowPercent'), this.value('SlowDuration')); }));
// Spiritual Overflow: bullets build up on each enemy; a full bar gives fire rate, spirit power and spirit lifesteal for 15 s, and nothing builds while it runs.
const overflow = buildUp(function (fight) { this.buff(fight, 'overflow', this.value('AbilityDuration'), { fireRate: this.pct('BonusFireRate'), spirit: this.value('BonusSpirit'), spiritLifesteal: this.pct('BonusSpiritLifesteal') }); });
define('Spiritual Overflow', overflow, { on(event, fight, p) { if (!this.marked(this.unit, 'overflow')) overflow.on.call(this, event, fight, p); } });
// Stalker: weapon or melee damage at close range (8 m, grown by ability range) wounds the target: spirit damage over time and less bullet resist.
define('Stalker', {
  on(event, fight, p) {
    if (!weaponHit(this, event, p) || fight.distance(this.unit, p.target) > this.value('ProcRadius') * this.unit.range || !this.fire()) return;
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
  dynamicMods() { return this.stacks ? { fireRate: this.stacks * this.pct('BonusFireRate'), reloadSpeed: 1 / Math.max(0.1, 1 + this.stacks * this.pct('ReloadSpeedMultipler')) - 1 } : null; }, // -10% reload time a stack
});
// Kinetic Dash: a dash-jump gives fire rate and extra rounds until the next reload (or 7 s); another dash refreshes it, the rounds don't add up.
define('Kinetic Dash', {
  on(event, fight, p) {
    if (event === 'dash' && this.mine(p.source)) {
      if (!this.unit.statuses.some((st) => st.id === `${this.name}:kinetic`)) this.unit.weapon.clip += this.value('BonusClipSize');
      this.buff(fight, 'kinetic', this.value('AbilityDuration'), { fireRate: this.pct('BonusFireRate') });
    }
    if (event === 'reloadStart' && this.mine(p.source)) fight.removeStatus(this.unit, `${this.name}:kinetic`);
  },
});
// Arcane Surge: after a dash-jump, the next ability cast within 7 s gets +12% range, +15% duration and +20 spirit power, which that cast keeps
// for as long as it lasts (the wiki: locked in when used; items and passives get none). Here it stays on the ability until its next cast.
define('Arcane Surge', {
  init() { this.until = -Infinity; this.held = new Map(); },
  on(event, fight, p) {
    if (event === 'dash' && this.mine(p.source)) this.until = fight.time + this.value('AbilityDuration');
    if (!castByMe(this, event, p) || !p.ability) return;
    const old = this.held.get(p.ability);
    if (old) { p.ability.imbues.splice(p.ability.imbues.indexOf(old), 1); this.held.delete(p.ability); }
    if (fight.time > this.until) return;
    this.until = -Infinity;
    const surge = { imbue: { range: this.pct('TechRangeMultiplierBuff'), duration: this.pct('BonusAbilityDurationPercent'), spirit: this.value('SpiritPower') } };
    p.ability.imbues.push(surge); // (spliced, not reassigned: Silver's wolf shares the list)
    this.held.set(p.ability, surge);
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
// Escalating Exposure: spirit damage takes 8% spirit resist (Mystic Vulnerability's part) and adds a 4.5% spirit amp stack, at most one every 0.7 s,
// up to 12; each refreshes the 12 s, and the stacks are gone once it runs out (the wiki).
define('Escalating Exposure', {
  init() { this.stacks = new Map(); },
  on(event, fight, p) {
    if (!spiritHit(this, event, p)) return;
    const d = this.value('AbilityDuration');
    this.debuff(fight, p.target, 'vuln', d, { spiritResist: this.innate('TechArmorDamageReduction') / 100 });
    if (!this.fire()) return;
    const n = Math.min(this.value('MaxStacks'), (this.marked(p.target, 'amp') ? this.stacks.get(p.target) ?? 0 : 0) + 1);
    this.stacks.set(p.target, n);
    this.debuff(fight, p.target, 'amp', d, { spiritAmp: n * this.pct('MagicIncreasePerStack') });
  },
});
// Mystic / Radiant Regeneration: spirit damage gives regen for 7 s, one stack per enemy damaged (the wiki: "stacks when dealing damage to different heroes").
const regenId = (item, target) => { item.per ??= new Map(); if (!item.per.has(target)) item.per.set(target, item.per.size); return `${item.name}:regen:${item.per.get(target)}`; };
define('Mystic Regeneration', { on(event, fight, p) { if (spiritHit(this, event, p)) fight.regen(this.unit, regenId(this, p.target), this.value('Regeneration'), this.value('RegenerationDuration')); } });
define('Radiant Regeneration', {
  on(event, fight, p) {
    if (spiritHit(this, event, p)) fight.addStatus(this.unit, { id: regenId(this, p.target), duration: this.value('RegenerationDuration'), regen: this.value('Regeneration') });
    if (castByMe(this, event, p) && this.proc()) { fight.heal(this.unit, this.value('HealingPerCast')); this.buff(fight, 'speed', this.value('AbilityDuration'), { moveSpeed: this.value('BonusMoveSpeed') }); }
  },
});
define('Mystic Slow', { on(event, fight, p) { if (spiritHit(this, event, p)) this.slow(fight, p.target, this.pct('MovementSpeedSlow'), this.value('AbilityDuration')); } });
// Healbane: spirit damage cuts the enemy's healing; an enemy that dies with it on heals the holder.
define('Healbane', {
  on(event, fight, p) {
    if (spiritHit(this, event, p) && p.target.alive) this.debuff(fight, p.target, 'bane', this.value('AbilityDuration'), { healAmp: this.pct('HealAmpReceivePenaltyPercent') });
    if (event === 'kill' && this.mine(p.source) && this.marked(p.target, 'bane')) fight.heal(this.unit, this.value('HealOnKill'));
  },
});
// Mystic Burst / Tankbuster: charge up over 14 s; the next ability spirit hit above a minimum (before amps and resists: the wiki) deals extra
// damage (Tankbuster's ignores spirit resist and adds a share of the enemy's current health).
const burst = (extra) => ({
  on(event, fight, p) {
    if (!spiritHit(this, event, p) || !p.opts.ability || p.amount <= this.value('MinimumDamage') || !p.target.alive || !this.fire()) return;
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
    const half = p.target.team === 'hero' ? 1 : this.pct('DamagePctVsNonHeroes'); // half on non-heroes (the wiki)
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
    if (spiritHit(this, event, p) && p.target.alive && !p.opts.ability?.ultimate) { // Mystic Slow's part (the wiki: its tooltip includes it); never weaker than the ultimate's slow
      const held = p.target.statuses.find((st) => st.id === `${this.name}:slow`);
      const share = this.innate('MovementSpeedSlow') / 100;
      if (!held || held.mods.slow <= share) this.slow(fight, p.target, share, this.value('AbilityDuration'));
    }
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
  onMelee(function (fight, p) { if (this.fire()) fight.heal(this.unit, this.value('LifestrikeHeal') * (p.target.team === 'hero' ? 1 : this.pct('NonHeroHealPct'))); })); // 30% off non-heroes, full off a rival hero
define('Lifestrike', { wantsMelee() { return this.cdLeft <= 0 && this.hurt < 0.9; } }, onMelee(function (fight, p) {
  if (!this.fire()) return;
  fight.heal(this.unit, (this.value('LifestealHeal') + this.pct('LifestealHealPercent') * p.dealt) * (p.target.team === 'hero' ? 1 : this.pct('NonHeroHealPct'))); // 40% off non-heroes, full off a rival hero
  this.slow(fight, p.target, this.pct('SlowPercent'), this.value('SlowDuration'));
}));
define('Spirit Strike', meleeReady, onMelee(function (fight, p) {
  if (!this.fire()) return;
  fight.damage(this.unit, p.target, this.value('SpiritDamage'), 'spirit');
  this.debuff(fight, p.target, 'strike', this.value('AbilityDuration'), { spiritResist: this.pct('TechArmorDamageReduction') });
}));
// Spirit Snatch: the swing also steals spirit resist and spirit power from the enemy for a while; what was stolen is lost when that enemy dies (the wiki).
define('Spirit Snatch', meleeReady, {
  on(event, fight, p) {
    if (event === 'kill' && p.target === this.from) fight.removeStatus(this.unit, `${this.name}:snatch`);
    if (event === 'melee' && this.mine(p.source)) snatch.call(this, fight, p);
  },
});
function snatch(fight, p) {
  if (!this.fire()) return;
  this.from = p.target;
  fight.damage(this.unit, p.target, this.value('SpiritDamage'), 'spirit');
  this.debuff(fight, p.target, 'snatched', this.value('AbilityDuration'), { spiritResist: this.pct('TechArmorDamageReduction'), spirit: this.value('TechPowerReduction') });
  this.buff(fight, 'snatch', this.value('AbilityDuration'), { spiritResist: this.pct('TechArmorGain'), spirit: this.value('TechPowerGain') });
}
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
  let n = (this.marked(e, 'crush') ? this.stacks.get(e) ?? 0 : 0) + this.value('HeavyMeleeMultiplier');
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
    if (event === 'dash' && this.mine(p.source)) this.buff(fight, 'shadow', this.value('AbilityDuration'), {}, ['invisible'], { breakOnAttack: true }); // 3 s
    if (event !== 'unstealth' || !this.mine(p.source) || !p.opts.melee || !p.ended.includes(`${this.name}:shadow`)) return;
    const steal = this.pct('ResistStealAmount');
    this.debuff(fight, p.target, 'stolen', this.value('StealDuration'), { bulletResist: -steal, spiritResist: -steal });
    this.buff(fight, 'steal', this.value('StealDuration'), { bulletResist: steal, spiritResist: steal });
    this.dot(fight, p.target, this.value('DPS'), this.value('AbilityDuration'));
  },
});

// ===== PARRIES AND HITS: CHANGE AN ENEMY'S HIT OR BLAST BEFORE IT LANDS =====
// Rebuttal (his call, Oct 3): parries the front enemy's next hit on its cooldown: heals it, sends it back, then more damage for a while. The parry itself
// (his call, Oct 22; the wiki's Parry page) stuns the attacker 2.75 s and it takes 25% more damage meanwhile (the page gives no length for that; taken
// as the stun's). Walkers, the Mid-Boss, the Shrines and the Patron can't be parried (his call, Oct 22).
const CURSE_STUN = 0.3; // Cursed Relic's short stun (the wiki)
const REVERB_SLOW = 2; // Mystic Reverb's slow: the wiki gives no duration
const PARRY_STUN = 2.75;
const UNPARRYABLE = new Set(['Walker', 'Mid-Boss', 'Shrine', 'Second Shrine', 'Patron', 'Weakened Patron']);
const PARRY_VULNERABLE = 0.25;
define('Rebuttal', {
  get cooldown() { return Math.max(1, PARRY_COOLDOWN - this.innate('ParryCooldownReduction')); },
  on(event, fight, hit) {
    if (!hitOnMe(this, event, hit) || !hit.opts.attack || hit.source !== fight.foes[0] || UNPARRYABLE.has(hit.source.name) || !this.fire()) return;
    const amount = hit.amount;
    hit.amount = 0;
    fight.heal(this.unit, amount * this.pct('ParrySuccessHealPercentage'));
    fight.damage(this.unit, hit.source, amount, hit.type === 'spirit' ? 'spirit' : 'bullet', { events: false });
    this.buff(fight, 'rebuttal', this.value('BuffDuration'), { damageDealt: this.pct('BonusDamagePercent') });
    this.debuff(fight, hit.source, 'parried', PARRY_STUN, { damageTaken: PARRY_VULNERABLE }, ['stun']);
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
define('Plated Armor', { on(event, fight, hit) { if (hitOnMe(this, event, hit) && hit.type === 'bullet' && !hit.opts.unavoidable && fight.rng() < this.pct('DeflectionPercent')) hit.amount = 0; } }); // a deflected bullet does nothing (an Armor Piercer one goes through: the wiki)
define('Spellbreaker', { on(event, fight, hit) { if (hitOnMe(this, event, hit) && hit.type === 'spirit' && hit.amount >= this.value('DamageThreshold') && this.fire()) hit.amount *= 1 - this.pct('SpiritDamageReductionProc'); } });
// Juggernaut: an enemy that shoots the holder fires slower for a while.
define('Juggernaut', { on(event, fight, p) { if (event === 'damage' && p.target === this.unit && p.type === 'bullet' && p.opts.attack) this.debuff(fight, p.source, 'slowfire', this.value('FireRateSlowDuration'), fireSlow(p.source, this.pct('FireRateSlow'))); } });
// Witchmail: a heavy spirit hit takes seconds off a random running ability cooldown.
define('Witchmail', {
  on(event, fight, p) {
    if (event !== 'damage' || p.target !== this.unit || p.type !== 'spirit' || p.amount < this.value('DamageThreshold') || !this.fire()) return;
    const running = this.unit.abilities.filter((a) => a.cdLeft > 0);
    if (running.length) { const a = running[Math.floor(fight.rng() * running.length)]; a.cdLeft = Math.max(0, a.cdLeft - this.value('CooldownReductionPerHit')); }
  },
});
// Return Fire: for a while, part of every enemy hit goes back at the attacker, counted before the holder's resists (the wiki: it reflects in full
// even through Metal Skin), and the holder has more bullet resist.
define('Return Fire', ACTIVE, {
  want(fight) { return fight.foes.length > 0 && this.hurt < 0.85; },
  cast(fight) { this.buff(fight, 'reflect', this.value('AbilityDuration'), { bulletResist: this.pct('BulletResist') }, ['reflect']); },
  on(event, fight, { source, target, amount, type }) {
    if (event !== 'damage' || target !== this.unit || source === this.unit || !this.unit.has('reflect') || !(type === 'bullet' || type === 'spirit')) return;
    fight.damage(this.unit, source, amount * this.pct(type === 'bullet' ? 'BulletDamageReflectedPct' : 'SpiritDamageReflectedPct'), type, { events: false });
  },
});
// Weapon / Spirit Shielding: enough damage of its kind within a few seconds puts up a barrier, and resist for as long (even once the barrier is broken).
// Melee counts as weapon damage (the wiki).
const shielding = (kinds, resistKey, resist) => ({
  on(event, fight, { source, target, dealt, type }) {
    if (event !== 'damage' || target !== this.unit || source === this.unit || !kinds.includes(type)) return;
    if (this.cdLeft <= 0 && this.windowed(fight, 'taken', dealt, this.value('DamageWindow')) >= this.value('DamageThreshold')) {
      this.fire();
      this.clearWindow('taken');
      this.barrier(fight, this.value('CombatBarrier'), this.value('BarrierDuration'), { [resist]: this.pct(resistKey) });
    }
  },
});
define('Weapon Shielding', shielding(['bullet', 'melee'], 'BulletResist', 'bulletResist'));
define('Spirit Shielding', shielding(['spirit'], 'TechResist', 'spiritResist'));

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
// Reactive Barrier: a barrier when cursed or stomped.
define('Reactive Barrier', { on(event, fight, p) { if (event === 'ccLanded' && p.target === this.unit && this.fire()) this.barrier(fight, this.value('VexBarrierCombatBarrier'), this.value('AbilityDuration')); } });
// Indomitable: the next curse or stomp is cleansed before it takes hold, with a barrier and every running ability cooldown 20% shorter (the wiki).
define('Indomitable', {
  on(event, fight, p) {
    if (event !== 'cc' || p.target !== this.unit || p.blocked || !this.fire()) return;
    p.blocked = true;
    this.barrier(fight, this.value('VexBarrierCombatBarrier'), this.value('AbilityDuration'));
    for (const a of this.unit.abilities) a.cdLeft *= 1 - this.pct('CooldownReductionOnProc');
  },
});
// Unstoppable: used just before a blast lands: immune to its curse or stomp for a while, and existing debuffs end.
define('Unstoppable', ACTIVE, {
  want(fight) { return fight.foes.some((e) => !e.has('silence') && ((e.stats.blast && (e.blastAt ?? Infinity) - fight.time < 1.5) || e.stats.controls?.some((c) => (c.nextAt ?? Infinity) - fight.time < 1.5))) && !this.unit.has('unstoppable'); },
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
// Dispel Magic: used when something is on the hero to purge (a curse, a slow, a healing cut ...); only a purge that removed something heals and gives
// speed (the wiki).
define('Dispel Magic', ACTIVE, {
  purgeable(fight) { return this.unit.statuses.some((st) => st.debuff && st.until > fight.time); },
  want(fight) { return fight.foes.length > 0 && this.purgeable(fight); },
  cast(fight) {
    const removed = this.purgeable(fight);
    fight.cleanse(this.unit);
    if (removed) { fight.heal(this.unit, this.value('HealOnActivate')); this.buff(fight, 'speed', this.value('BuffDuration'), { moveSpeed: this.value('ActiveBonusMoveSpeed') }); }
  },
});
define('Warp Stone', ACTIVE, hurtActive(0.8, function (fight) { this.buff(fight, 'resist', this.value('CasterBuffDuration'), { bulletResist: this.pct('BulletResist') }); }));
// Colossus: bigger: resists and melee damage, and enemies near are slowed.
define('Colossus', ACTIVE, hurtActive(0.75, function (fight) {
  this.buff(fight, 'resist', this.value('AbilityDuration'), { bulletResist: this.pct('BuffBulletResist'), spiritResist: this.pct('BuffTechResist'), meleeDamage: this.pct('BonusMeleeDamagePercent') });
  for (const e of this.near(fight, 'Radius')) this.slow(fight, e, this.pct('SlowPercent'), this.value('AbilityDuration'));
}));
// Metal Skin: immune to bullets for a while, used when hurt by an enemy that shoots.
define('Metal Skin', ACTIVE, {
  want(fight) { return this.hurt < 0.8 && fight.foes.some((e) => e.stats.damageType === 'bullet' || e.stats.damageType === 'mixed'); },
  cast(fight) { this.buff(fight, 'metal', this.value('AbilityDuration'), { bulletTaken: -1, moveSpeed: this.value('ActiveMoveSpeedPenalty') }); }, // slower meanwhile (the wiki: -1.5 m/s)
});
// Healing Rite: a long heal over time; damage from a boss or a rival hero (the game's "enemy players or objectives") ends it.
define('Healing Rite', ACTIVE, hurtActive(0.8, function (fight) { this.regen(fight, this.value('TotalHealthRegen') / this.value('RegenDuration'), this.value('RegenDuration')); this.buff(fight, 'speed', this.value('RegenDuration'), { moveSpeed: this.value('BonusSprintSpeed') }); }), {
  on(event, fight, p) { if (event === 'damage' && p.target === this.unit && ((p.source.team === 'enemy' && isBoss(p.source)) || (p.source.team === 'hero' && p.source !== this.unit))) { fight.removeStatus(this.unit, `${this.name}:regen`); fight.removeStatus(this.unit, `${this.name}:speed`); } },
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
// Veil Walker (his call, Oct 3): the hero passes a veil every time it's ready: a heal, and invisibility with speed until it next attacks (the wiki: the
// speed ends with the invisibility).
define('Veil Walker', {
  tick(fight) {
    if (!fight.foes.length || !this.fire()) return;
    fight.heal(this.unit, this.value('HealOnVeil'));
    this.buff(fight, 'veil', this.value('InvisDuration'), { moveSpeed: this.value('BonusMoveSpeed') }, ['invisible'], { breakOnAttack: true });
  },
});
// Eternal Gift (a legendary): its permanent buffs come from fight time (play.js); in a fight it shortens a Rejuv's wait.
define('Eternal Gift', { respawnCut(fight) { return this.fire() ? -this.pct('RespawnTime') : 0; } });

// ===== ACTIVES THAT START A DAMAGE OR SPEED BUFF =====
const buffActive = (id, mods, durationKey = 'AbilityDuration') => ({ cast(fight) { this.buff(fight, id, this.value(durationKey), mods.call(this)); } });
// Fury Trance: the trance silences the hero itself (the wiki: no abilities meanwhile), so it is used when none of its abilities is ready.
define('Fury Trance', ACTIVE, {
  want(fight) { return fight.foes.length > 0 && !this.unit.abilities.some((a) => a.ready()); },
  cast(fight) { this.buff(fight, 'trance', this.value('AbilityDuration'), { fireRate: this.pct('ActiveBonusFireRate'), spiritResist: this.pct('TechResist'), moveSpeed: this.value('ActiveBonusMoveSpeed') }, ['silence']); },
});
// Vampiric Burst: lifesteal and fire rate for 5 s, and 75% of the clip added on top of what is loaded (past the clip size; a reload under way stops: the wiki).
define('Vampiric Burst', ACTIVE, {
  cast(fight) {
    this.buff(fight, 'burst', this.value('AbilityDuration'), { lifesteal: this.pct('ActiveBonusLifesteal'), fireRate: this.pct('ActiveBonusFireRate') });
    const w = this.unit.weapon;
    w.reloadLeft = 0;
    w.clip += Math.round(this.unit.stats.clip * this.pct('ActiveReloadPercent'));
  },
});
define('Infuser', ACTIVE, buffActive('infuse', function () { return { spiritLifesteal: this.pct('AbilityLifestealPercentHero'), spirit: this.value('BonusSpirit') }; }));
define('Heroic Aura', ACTIVE, buffActive('aura', function () { return { fireRate: this.pct('BonusFireRate'), moveSpeed: this.value('ActiveBonusMoveSpeed') }; }));
define('Fleetfoot', ACTIVE, buffActive('fleet', function () { return { moveSpeed: this.value('ActiveBonusMoveSpeed'), slowResist: this.pct('SlowResistancePercent') }; }));
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
  this.slow(fight, e, this.pct('SlowPercent'), this.value('SlowDuration')); // the slow starts with the freeze (the wiki)
}, 'EndRadius'));
// Nullification Burst (a legendary): 250 (+0.465 x spirit) spirit damage within 20 m, every buff taken off, and no healing for 7 s (the wiki).
define('Nullification Burst', ACTIVE, blast(function (fight, e) { purgeBuffs(e, false); fight.damage(this.unit, e, this.value('Damage'), 'spirit'); this.debuff(fight, e, 'null', this.value('AbilityDuration'), { healAmp: -1 }); }, 'EndRadius'));
const oneTarget = (hit, pick = (fight) => fight.foes[0]) => ({ cast(fight) { const e = pick.call(this, fight); if (e) hit.call(this, fight, e); } });
define('Phantom Strike', ACTIVE, oneTarget(function (fight, e) {
  fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit');
  this.debuff(fight, e, 'disarm', this.value('SlowDuration'), {}, ['disarm']);
  this.slow(fight, e, this.pct('SlowPercent'), this.value('SlowDuration'));
  this.unit.close = e; this.unit.closeUntil = fight.time + 3; // it teleports to the enemy
}));
define('Knockdown', ACTIVE, oneTarget(function (fight, e) { fight.at(this.value('StunDelay'), () => { if (e.alive) this.debuff(fight, e, 'stun', this.value('StunDuration'), {}, ['stun']); }); })); // enemies are never airborne: no bonus stun
define('Disarming Hex', ACTIVE, oneTarget(function (fight, e) { this.debuff(fight, e, 'disarm', this.value('AbilityDuration'), { bulletResist: this.pct('BulletArmorReduction') }, ['disarm']); }));
// Rusted Barrel: -32% fire rate and -8% bullet resist for 5 s.
define('Rusted Barrel', ACTIVE, oneTarget(function (fight, e) { this.debuff(fight, e, 'rust', this.value('AbilityDuration'), { ...fireSlow(e, this.pct('FireRateSlow')), bulletResist: this.pct('BulletArmorReduction') }); }));
define('Slowing Hex', ACTIVE, oneTarget(function (fight, e) { this.slow(fight, e, this.pct('SlowPercent'), this.value('AbilityDuration')); }));
define('Spirit Sap', ACTIVE, oneTarget(function (fight, e) { this.debuff(fight, e, 'sap', this.value('AbilityDuration'), { spiritResist: this.pct('MagicResistReduction'), spirit: this.value('TechPowerReduction') }); }, function (fight) { return this.biggest(fight); }));
define('Decay', ACTIVE, oneTarget(function (fight, e) {
  this.dot(fight, e, this.pct('DotHealthPercent') * npcShare(e), this.value('AbilityDuration'), { ofCurrent: true, nonLethal: true });
  this.debuff(fight, e, 'heal', this.value('AbilityDuration'), { healAmp: this.pct('HealAmpReceivePenaltyPercent') });
}, function (fight) { return this.biggest(fight); }));
// Takes an enemy's buffs off (a Rejuv's wait stays); keepUlt: its ultimate's stay.
const purgeBuffs = (e, keepUlt) => {
  const ult = keepUlt ? e.abilities.filter((a) => a.ultimate).map((a) => `${a.name}:`) : [];
  e.statuses = e.statuses.filter((s) => s.debuff || s.id === 'rejuv' || ult.some((u) => s.id.startsWith(u)));
};
// Cursed Relic: the enemy with a blast (else the biggest) is stunned 0.3 s, then silenced, disarmed and can't use items, and loses its buffs (not its
// ultimate's; none at all if it is unstoppable: the wiki); the holder deals 25% less damage meanwhile.
define('Cursed Relic', ACTIVE, oneTarget(function (fight, e) {
  if (!e.has('unstoppable')) purgeBuffs(e, true);
  this.debuff(fight, e, 'stun', CURSE_STUN, {}, ['stun']);
  this.debuff(fight, e, 'curse', this.value('AbilityDuration'), {}, ['curse']);
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
// Vortex Web: pulls the enemies near together (every area effect then reaches them all), holds them for its 0.5 s pull and slows them 28% for 4 s.
define('Vortex Web', ACTIVE, {
  want(fight) { return fight.foes.length > 1; },
  cast(fight) {
    const caught = this.near(fight, 'CaptureRadius');
    const spot = caught[0].offset ?? 0;
    for (const e of caught) { e.offset = spot; this.debuff(fight, e, 'pull', this.value('TetherDuration'), {}, ['immobilize']); this.slow(fight, e, this.pct('SlowPercent'), this.value('AbilityDuration')); }
  },
});
// Mystical Piano (a legendary): a moment later, enemies in the area are stunned, then dazed (slowed, disarmed and silenced).
define('Mystical Piano', ACTIVE, {
  cast(fight) {
    fight.at(this.value('StunDelay'), () => {
      for (const e of fight.foes.length ? this.near(fight, 'Radius') : []) {
        this.debuff(fight, e, 'stun', PIANO_STUN, {}, ['stun']);
        fight.at(PIANO_STUN, () => { if (e.alive) this.debuff(fight, e, 'daze', this.value('DazeDuration'), { slow: 0.3 }, ['disarm', 'silence', 'noItems']); }); // dazed: slowed, disarmed, silenced, no items (the wiki)
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
  tick(fight, dt) { // damage per second grows by DPSIncrease a 0.5 s tick up to its max (the wiki: the max at about 3 s), half as strong against NPCs
    if (fight.time >= this.until || !fight.foes.length) return;
    const dps = Math.min(this.value('DPSMax'), this.value('DPS') + (this.value('DPSIncrease') / this.value('TickRate')) * (fight.time - this.start));
    for (const e of this.near(fight, 'Radius')) {
      fight.damage(this.unit, e, dps * dt * (e.team === 'hero' ? 1 : 1 - this.pct('NonHeroReductionPercent')), 'spirit', { events: false });
      this.debuff(fight, e, 'shred', 0.25, { bulletResist: this.pct('BulletArmorReduction') });
    }
  },
});
define('Torment Pulse', {
  tick(fight) { // every 1.4 s, spirit damage to the closest two enemies that are awake (it skips sleepers: the wiki, Mar 6 2026)
    if (!fight.foes.length || !this.fire()) return;
    for (const e of this.near(fight, 'DamagePulseRadius').filter((u) => !u.has('sleep')).slice(0, 2)) fight.damage(this.unit, e, this.value('DamagePulseAmount'), 'spirit', { proc: true });
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
  tick(fight, dt) { // the beams reach 30 m from the hero (x ability range)
    if (fight.time < this.until && fight.foes.length) for (const e of fight.near(PRISM_REACH * this.unit.range - fight.distance(this.unit, fight.foes[0]))) fight.damage(this.unit, e, this.value('DPS') * dt, 'spirit', { events: false });
  },
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
// Refresher: every ability's cooldown and charges back (the wiki: abilities, not items).
define('Refresher', ACTIVE, {
  want(fight) { return fight.foes.length > 0 && this.unit.abilities.filter((a) => a.cdLeft > 0).length >= 2; },
  cast() { for (const a of this.unit.abilities) a.refresh(); },
});
// Recharging Rush: 200 weapon damage (bullets or melee) within a few seconds gives every charged ability (the wiki gives it charges, even 1) a charge back.
define('Recharging Rush', {
  on(event, fight, p) {
    if (!weaponHit(this, event, p)) return;
    if (this.windowed(fight, 'dealt', p.dealt, this.value('DamageWindow')) >= this.value('DamageThreshold') && this.fire()) {
      this.clearWindow('dealt');
      for (const a of this.unit.abilities.filter((ab) => ab.charged || ab.maxCharges > 1)) a.charges += 1;
    }
  },
});

// ===== IMBUES (his call, Oct 3: the member picks the ability; `imbue` is what it adds to it) =====
define('Mystic Expansion', { get imbue() { return { range: this.pct('TechRangeMultiplier') }; } });
define('Compress Cooldown', { get imbue() { return { cdr: this.pct('CooldownReduction') }; } });
define('Duration Extender', { get imbue() { return { duration: this.pct('BonusAbilityDurationPercent') }; } });
// Omnicharge Signet (a legendary): +4 charges for a charged ability, +2 for one without (which then counts as charged); not an ultimate (the wiki).
define('Omnicharge Signet', { get imbue() { return { charges: this.value('BonusAbilityCharges'), chargesNonCharge: this.value('BonusAbilityChargesNonCharge') }; } });
// Surge of Power: spirit power for the ability, and using it gives fire rate and speed.
define('Surge of Power', {
  get imbue() { return { spirit: this.value('ImbuedTechPower') }; },
  on(event, fight, p) { if (castByMe(this, event, p) && p.ability && p.ability === this.imbued && this.fire()) this.buff(fight, 'surge', this.value('MovementSpeedBonusDuration'), { fireRate: this.pct('FireRateBonus'), moveSpeed: this.value('BonusMoveSpeed') }); },
});
// Ballistic Enchantment: range for the ability; each enemy it hits while the buff lasts gives weapon damage: a rival hero 20%, an NPC 5% (up to 8 NPCs).
define('Ballistic Enchantment', {
  init() { this.hit = new Set(); },
  get imbue() { return { range: this.pct('TechRangeMultiplier') }; },
  on(event, fight, p) {
    if (event !== 'damage' || !this.mine(p.source) || !this.fromImbued(p)) return;
    if (!this.marked(this.unit, 'ballistic')) this.hit.clear();
    this.hit.add(p.target);
    const heroes = [...this.hit].filter((e) => e.team === 'hero').length;
    const npcs = Math.min(this.value('NonHeroStackLimit'), this.hit.size - heroes);
    this.buff(fight, 'ballistic', this.value('AbilityDuration'), { weaponDamage: heroes * this.pct('WeaponPowerPerStack') + npcs * this.pct('WeaponPowerPerStackNonHero') });
  },
});
// Quicksilver Reload / Mercurial Magnum: charged up over time, the imbued ability reloads the gun, gives fire rate and hits for extra spirit damage;
// Mercurial Magnum's bullets also deal spirit damage until the next reload. The fire rate lasts a fixed 12 s (the wiki: ability duration doesn't stretch
// it), and the extra damage only goes on the hit of the cast that used the charge (a cast while it is still charging adds nothing).
const quicksilver = {
  init() { this.armed = false; this.magnum = false; },
  on(event, fight, p) {
    if (castByMe(this, event, p) && p.ability && p.ability === this.imbued) { this.armed = false; this.magnum = !!this.entries.BulletsBonusMagicDamage; } // Mercurial Magnum's bullets: after any imbued cast, charged or not (the wiki)
    if (castByMe(this, event, p) && p.ability && p.ability === this.imbued && this.fire()) {
      const w = this.unit.weapon;
      w.clip = this.unit.stats.clip; w.reloadLeft = 0;
      this.buff(fight, 'quick', num(this.entries.BuffDuration.Value), { fireRate: this.pct('BonusFireRate') });
      this.armed = true;
    }
    if (event === 'damage' && this.mine(p.source) && this.armed && this.fromImbued(p)) { this.armed = false; fight.damage(this.unit, p.target, this.value('Damage'), 'spirit', { proc: true }); }
    if (bulletHit(this, event, p) && this.magnum) fight.damage(this.unit, p.target, this.value('BulletsBonusMagicDamage'), 'spirit', { proc: true });
    if (event === 'reloadStart' && this.mine(p.source)) this.magnum = false;
  },
};
define(['Quicksilver Reload', 'Mercurial Magnum'], quicksilver);
// Echo Shard: resets the imbued non-ultimate ability's cooldown (a charged one gets one charge back); its own cooldown is 30 s plus that ability's (the wiki).
define('Echo Shard', ACTIVE, {
  get cooldown() { return this.cd('active') + (this.imbued?.cooldown ?? 0); },
  want(fight) { const a = this.imbued; return fight.foes.length > 0 && !!a && !a.ultimate && (a.maxCharges > 1 ? a.charges < a.maxCharges : a.cdLeft > 5); },
  cast() {
    const a = this.imbued;
    if (a.maxCharges > 1) a.charges += 1; else { a.cdLeft = 0; a.gapLeft = 0; }
  },
});
// Mystic Reverb: the imbued ability's spirit and weapon damage (not melee or pure damage) heals 22% (stacking with spirit lifesteal multiplicatively;
// the reverb too: the wiki), and its first hit echoes 3 s later onto the enemies near: 50% of that hit before resists, and a slow.
const reverbHeal = (item, fight, p) => fight.heal(item.unit, p.dealt * item.pct('ImbueAbilityLifesteal') * (1 - item.unit.stat('spiritLifesteal')) * (p.target.team === 'hero' ? 1 : SPIRIT_LIFESTEAL_VS_NPC), 'lifesteal');
define('Mystic Reverb', {
  on(event, fight, p) {
    if (event !== 'damage' || !this.mine(p.source) || !this.fromImbued(p) || p.opts.reverb || p.type === 'melee' || p.type === 'true') return;
    reverbHeal(this, fight, p);
    if (!this.fire()) return;
    const echo = p.amount * this.pct('TechDamagePercent');
    fight.at(this.value('DelayDuration'), () => {
      for (const e of fight.foes.length ? this.near(fight, 'Radius') : []) {
        const dealt = fight.damage(this.unit, e, echo, 'spirit', { reverb: true, events: false });
        reverbHeal(this, fight, { dealt, target: e });
        this.slow(fight, e, this.pct('MovementSpeedSlow'), REVERB_SLOW);
      }
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

// Imbues that can't go into an ultimate (the wiki: "non-ultimate").
const NO_ULT_IMBUE = new Set(['Echo Shard', 'Omnicharge Signet']);

module.exports = { Item, FX, IMBUES, NO_ULT_IMBUE, makeItems, isBoss, npcShare, KEPT, keptAfter };
