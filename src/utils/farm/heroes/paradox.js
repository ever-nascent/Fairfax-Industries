// Paradox's abilities (deadlock.wiki/Paradox, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. His calls (Oct 5): Time Wall does nothing against enemy attacks (the game only delays their bullets);
// Kinetic Carbine follows his rule for Kelvin's beam: charged when the gun runs dry, through the reload.
const { Ability } = require('./../ability');
const { MELEE } = require('./../engine');
const { isBoss, npcShare } = require('./../items');
const { HEROES } = require('./../stats');

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

// 2. Time Wall: a wall between her and the enemies: her bullets pass through it and deal more weapon damage while it stands; the enemies it
// lands on (within half its width of the front one) are slowed. The enemies' own shots are only delayed by it, so nothing changes for them (his
// call). T1: longer, wider. T2: more weapon damage, and it silences the enemies it lands on. T3: charges (one wall at a time).
class TimeWall extends Ability {
  want(fight) { return fight.foes.length > 0 && !this.unit.statuses.some((s) => s.id === 'time_wall'); }

  cast(fight) {
    fight.addStatus(this.unit, { id: 'time_wall', duration: this.value('AbilityDuration'), mods: { weaponDamage: this.value('FriendlyBulletDamageBonus') / 100 } });
    for (const e of fight.near(this.value('TimeWallWidth') / 2)) {
      fight.addStatus(e, { id: 'time_wall_slow', duration: this.value('AuraEffectDuration'), mods: { slow: this.data.MovementSlowPct / 100 }, debuff: true });
      fight.addStatus(e, { id: 'time_wall_silence', duration: this.value('DebuffDuration'), tags: ['silence'], debuff: true });
    }
  }
}

// 3. Kinetic Carbine: started when the gun runs dry and charged through the reload; then one shot of spirit damage: a full burst's weapon damage
// times the wiki's factor (x2.25 fully charged), and a time-stop (a stun). Once charged she moves faster for a while. T1: a longer time-stop.
// T2: shorter cooldown. T3: a bigger factor.
class KineticCarbine extends Ability {
  constructor(...args) {
    super(...args);
    this.fireAt = 0;
  }

  want(fight) { return fight.foes.length > 0 && this.unit.weapon.reloadLeft > 0; }
  status(fight) { return fight && this.fireAt ? 'Charging' : super.status(fight); }

  cast(fight) {
    this.fireAt = fight.time + this.data.MaxChargeDuration;
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.fireAt);
  }

  tick(fight) {
    if (!this.fireAt || fight.time + 1e-9 < this.fireAt) return;
    this.fireAt = 0;
    const target = fight.foes[0];
    if (!target || this.unit.cantAct || this.unit.has('disarm')) return;
    const factor = [this.data, ...this.data.Upgrades.slice(0, this.tier)].reduce((sum, x) => sum + (x.MaxBonusBulletDamage?.Scale?.Value ?? 0), 0) / 100;
    fight.damage(this.unit, target, fight.shotDamage(this.unit, target) * HEROES[this.unit.name].Weapon.BulletsPerBurst * (1 + factor), 'spirit');
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
  ['Time Wall', 'Raises a time-warping wall: bullets fired through it hit harder, and enemies it lands on are slowed.'],
  ['Kinetic Carbine', 'Charges a powerful shot while reloading that stops the enemy in time.'],
  ['Paradoxical Swap', 'Swaps places with an enemy, damaging it.'],
];

module.exports = { name: 'Paradox', abilities: { 1: PulseGrenade, 2: TimeWall, 3: KineticCarbine, 4: ParadoxicalSwap }, info };
