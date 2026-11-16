// Paradox's abilities (deadlock.wiki/Paradox, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. Time Wall cuts the bullet damage she takes by WALL_BLOCK while it stands (Nov 6: the game
// freezes every enemy bullet that touches it, so she steps out of the way; "half is too strong"; until then it did nothing against enemies);
// Kinetic Carbine is charged the moment it is ready (it used to follow for Kelvin's beam: charged when the gun ran dry).
const WALL_BLOCK = 0.25;
const FIRED_SHOWN = 1.5; // seconds the live fight shows Kinetic Carbine as Fired
const { Ability } = require('./../ability');
const { MELEE, headshotChance } = require('./../engine');
const { isBoss, npcShare } = require('./../items');
const { HEROES, itemByName } = require('./../stats');

// Kinetic Carbine and her build. The game's on-shot items that work on the Carbine shot (the wiki's Kinetic Carbine page; the
// rest, Headshot Booster, Tesla Bullets, Toxic Bullets..., don't).
const CARBINE_PROCS = new Set(['Restorative Shot', 'Mystic Shot', 'Weakening Headshot', 'Crippling Headshot', 'Hollow Point', 'Haunting Shot']); // Haunting Shot: (a next-bullet item like Mystic Shot; the wiki doesn't say)
// Express Shot too, the wiki's way: the Carbine shot gets its smaller secondary-fire bonus, and it fires one regular bullet with its bigger one.
// In a gun build she saves these procs (their own cooldowns) for the Carbine shot instead of spending them on a normal bullet just before it.
const SAVED_PROCS = new Set(['Restorative Shot', 'Mystic Shot', 'Weakening Headshot', 'Crippling Headshot', 'Express Shot', 'Haunting Shot']);
// What makes a gun (Carbine) build: on-hit gun items (the Weapon items that react to bullet hits) and anything imbued into the Carbine. A bomb
// (Pulse Grenade) build: spirit power and ability duration items (more pulses) and anything imbued into the grenade. Not every Spirit item: the
// Carbine build (deadlocklabs.gg "Carbine Paradox", his example Nov 6) runs Mystic Burst, Tankbuster, Spirit Burn and Mystic Reverb off the
// Carbine's big spirit hit. Whichever she holds more of, with at least 2 (a tie, or fewer: the Carbine just fills her reloads). my
// picks, to change.
const BOMB = new Set(['Extra Spirit', 'Improved Spirit', 'Boundless Spirit', 'Duration Extender', 'Superior Duration', 'Mystic Expansion', 'Greater Expansion',
  'Escalating Exposure', 'Mystic Vulnerability', 'Arcane Surge', 'Surge of Power', 'Echo Shard']);
const ON_HIT = new Set(['Hollow Point', 'Point Blank', 'Escalating Resilience', 'Mystic Shot', 'Express Shot', 'Headshot Booster', 'Headhunter', 'Weakening Headshot',
  'Crippling Headshot', 'Lucky Shot', 'Ricochet', 'Tesla Bullets', 'Capacitor', 'Armor Piercer', 'Infinite Rounds', 'Restorative Shot', 'Burst Fire', 'Spirit Shredder',
  'Spirit Rend', 'Haunting Shot', 'Toxic Bullets', 'Silencer', 'Slowing Bullets', 'Weighted Shots', 'Stalker', 'Split Shot', 'Recharging Rush']);
const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);
function buildOf(unit) {
  const held = unit.held ?? [];
  const into = (slot) => unit.items.filter((it) => it.imbueSlot === slot).length;
  const gun = held.filter((n) => ON_HIT.has(n)).length + into(3);
  const bomb = held.filter((n) => BOMB.has(n)).length + into(1);
  return gun >= 2 && gun > bomb ? 'gun' : bomb >= 2 && bomb > gun ? 'bomb' : null;
}

// 1. Pulse Grenade: a grenade on the front enemy that pulses: each pulse reaches a little further, deals spirit damage (half to bosses), slows
// for a moment and leaves a stack: the enemy takes more damage, no limit on stacks. T2: more damage. T3: more per stack, more pulses.
class PulseGrenade extends Ability {
  constructor(...args) {
    super(...args);
    this.grenades = []; // [{ next, left, done }]
    this.stacks = new Map(); // enemy -> { n, until }
  }

  want(fight) { return fight.foes.length > 0; }
  cast(fight) { this.grenades.push({ next: fight.time, left: Math.round(this.value('AbilityDuration') / this.data.PulseInterval), done: 0 }); }

  tick(fight) {
    this.grenades = this.grenades.filter((g) => g.left > 0);
    for (const g of this.grenades) {
      if (fight.time + 1e-9 < g.next) continue;
      g.next += this.data.PulseInterval;
      g.left -= 1;
      for (const e of fight.near(this.value('Radius') + g.done * this.value('RadiusIncreasePerPulse'))) {
        fight.damage(this.unit, e, this.value('PulseDamage') * (e.team !== 'hero' && isBoss(e) ? this.data.BossDamageScale : 1), 'spirit');
        fight.addStatus(e, { id: 'pulse_slow', duration: this.value('MovementSlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
        const s = this.stacks.get(e);
        const n = (s && s.until > fight.time ? s.n : 0) + 1;
        this.stacks.set(e, { n, until: fight.time + this.value('DebuffDuration') });
        fight.addStatus(e, { id: 'pulse_amp', duration: this.value('DebuffDuration'), mods: { damageTaken: (n * this.value('DamageAmplificationPerStack')) / 100 }, debuff: true });
      }
      g.done += 1;
    }
  }
}

// 2. Time Wall: a wall between her and the enemies: her bullets pass through it and deal more weapon damage while it stands, and the enemies'
// bullets freeze in it, so she takes WALL_BLOCK less bullet damage meanwhile; the enemies it lands on (within half its width of
// the front one) are slowed. T1: longer, wider. T2: more weapon damage, and it silences the enemies it lands on. T3: charges (one wall at a time).
// She shoots the Carbine through it: the wall goes up as the Carbine starts charging, so the shot gets its weapon damage; otherwise only
// when the wall would be back before the Carbine is.
class TimeWall extends Ability {
  want(fight) {
    if (!fight.foes.length || this.unit.statuses.some((s) => s.id === 'time_wall')) return false;
    const carbine = find(this.unit, KineticCarbine);
    return !carbine || !!carbine.fireAt || carbine.cdLeft > this.cooldown;
  }

  cast(fight) {
    fight.addStatus(this.unit, { id: 'time_wall', duration: this.value('AbilityDuration'), mods: { weaponDamage: this.value('FriendlyBulletDamageBonus') / 100, bulletTaken: -WALL_BLOCK } });
    for (const e of fight.near(this.value('TimeWallWidth') / 2)) {
      fight.addStatus(e, { id: 'time_wall_slow', duration: this.value('AuraEffectDuration'), mods: { slow: this.data.MovementSlowPct / 100 }, debuff: true });
      fight.addStatus(e, { id: 'time_wall_silence', duration: this.value('DebuffDuration'), tags: ['silence'], debuff: true });
    }
  }
}

// 3. Kinetic Carbine: charged the moment it is ready (2.5 s, no shooting meanwhile); then one shot of spirit damage: a full burst's weapon damage
// times the wiki's factor (x2.25 fully charged; +14% on a headshot), and a time-stop (a stun). Once charged she moves faster for a while. T1: a
// longer time-stop. T2: shorter cooldown. T3: a bigger factor. The shot sets off CARBINE_PROCS like a bullet (the wiki). Her build (buildOf):
// a gun build holds SAVED_PROCS for it while it is ready or charging; a bomb build charges it only once a Pulse Grenade has stacked damage amp
// on the target (then at once, reload or not), so the shot gets the bonus.
class KineticCarbine extends Ability {
  constructor(...args) {
    super(...args);
    this.fireAt = 0;
  }

  // Charged the moment it is ready ("why would Carbine only fire if you're out of ammo"; until then it waited for a reload, and a
  // big magazine never ran dry in a room fight, so it never fired); a bomb build waits for the grenade's amp.
  want(fight) {
    const target = fight.foes[0];
    if (!target) return false;
    return buildOf(this.unit) === 'bomb' ? target.statuses.some((s) => s.id === 'pulse_amp') : true;
  }
  // the live fight shows it Charging, then Fired for a moment after the shot, then its cooldown
  status(fight) { return fight && this.fireAt ? 'Charging' : fight && this.firedAt != null && fight.time - this.firedAt < FIRED_SHOWN ? 'Fired' : super.status(fight); }

  cast(fight) {
    this.fireAt = fight.time + this.data.MaxChargeDuration;
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.fireAt);
  }

  tick(fight) {
    this.unit.heldProcs = buildOf(this.unit) === 'gun' && (this.fireAt || this.ready()) ? SAVED_PROCS : null; // the engine keeps them off her normal bullets (only for the charge: she charges it once ready)
    if (!this.fireAt || fight.time + 1e-9 < this.fireAt) return;
    this.fireAt = 0;
    const target = fight.foes[0];
    if (!target || this.unit.cantAct || this.unit.has('disarm')) return;
    this.firedAt = fight.time;
    const factor = [this.data, ...this.data.Upgrades.slice(0, this.tier)].reduce((sum, x) => sum + (x.MaxBonusBulletDamage?.Scale?.Value ?? 0), 0) / 100;
    const opts = { headshot: fight.rng() < headshotChance(this.unit), carbine: true };
    const express = this.unit.items.find((i) => i.name === 'Express Shot');
    const expressed = !!express?.fire();
    const amount = fight.shotDamage(this.unit, target) * HEROES[this.unit.name].Weapon.BulletsPerBurst * (1 + factor) * (opts.headshot ? 1 + (this.data.HeadshotBonus ?? 0) / 100 : 1) * (expressed ? 1 + express.pct('ProcBaseAttackDamagePercentAltFire') : 1);
    const dealt = fight.damage(this.unit, target, amount, 'spirit');
    if (expressed && target.alive) fight.as(express, () => fight.damage(this.unit, target, fight.shotDamage(this.unit, target) * (1 + express.pct('ProcBaseAttackDamagePercent')), 'bullet', { events: false }));
    const hit = { source: this.unit, target, amount, dealt, type: 'bullet', opts }; // the on-shot items hear it as a bullet that landed
    for (const it of this.unit.items.filter((i) => CARBINE_PROCS.has(i.name))) fight.as(it, () => { it.on('shot', fight, hit); if (target.alive) it.on('bulletHit', fight, hit); });
    fight.addStatus(target, { id: 'time_stop', duration: this.value('MaxSlowDuration'), tags: ['stun'], debuff: true });
    fight.addStatus(this.unit, { id: 'carbine_speed', duration: this.value('SpeedBoostDuration'), mods: { moveSpeed: (this.unit.stats.moveSpeed * this.value('SpeedChange')) / 100 } });
  }
}

// 4. Paradoxical Swap: she swaps places with the front enemy: neither can act for the swap (a boss isn't moved and shrugs part of it off), then
// it takes spirit damage, and she stands where it stood for a moment. T1: a barrier as the swap begins. T3: every enemy near the target is
// swapped too, and a share of max health as damage on top (cut against NPCs like every health share).
class ParadoxicalSwap extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const front = fight.foes[0];
    if (!front) return;
    const swap = this.data.SwapTime + this.data.InitialFreezeTime;
    const targets = this.value('MultiSwap') ? fight.near(this.value('MultiSwap')) : [front];
    for (const e of targets) fight.addStatus(e, { id: 'paradoxical_swap', duration: swap, tags: ['stun'], debuff: true });
    fight.addStatus(this.unit, { id: 'swapping', duration: swap, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + swap);
    if (this.value('CombatBarrier')) fight.addStatus(this.unit, { id: 'swap_barrier', duration: this.value('BarrierDuration'), barrier: this.value('CombatBarrier') });
    fight.at(swap, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      for (const e of targets.filter((x) => x.alive)) {
        const ofHealth = ((e.stats.maxHealth * this.value('MaxHealthDamage')) / 100) * (e.team === 'hero' ? 1 : npcShare(e));
        fight.damage(this.unit, e, this.value('SwapDamage') + ofHealth, 'spirit');
      }
      this.unit.close = fight.foes[0] ?? null;
      this.unit.closeUntil = fight.time + MELEE.closeFor;
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Pulse Grenade', 'Throws a grenade that pulses: each pulse damages and makes enemies take more damage.'],
  ['Time Wall', 'Raises a time-warping wall: bullets fired through it hit harder, enemy bullets freeze in it, and enemies it lands on are slowed.'],
  ['Kinetic Carbine', 'Charges a powerful shot while reloading that stops the enemy in time.'],
  ['Paradoxical Swap', 'Swaps places with an enemy, damaging it.'],
];

module.exports = { name: 'Paradox', abilities: { 1: PulseGrenade, 2: TimeWall, 3: KineticCarbine, 4: ParadoxicalSwap }, info };
