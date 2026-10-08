// Victor's abilities (deadlock.wiki/Victor, checked Oct 5 2026; page updated that day). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. Victor hurts himself to fight: his own abilities cost him health (pure damage, never lethal), which
// charges Pain Battery, and Shocking Reanimation brings him back from a lethal hit. Taken by me: when he uses the two that cost health (HURT,
// AURA_ON / AURA_OFF below). Standing rules used: "on hero hit" is any enemy; an aura around him reaches the enemies around the front one.
const { Ability, spinUp } = require('./../ability');
const { DT } = require('./../engine');
const { isBoss } = require('./../items');
const { HEROES } = require('./../stats');

// What an ability costs him: pure damage that never kills, and that charges Pain Battery like any other damage he takes.
function pay(unit, amount) {
  const taken = Math.min(amount, Math.max(0, unit.health - 1));
  unit.health -= taken;
  unit.abilities.find((a) => a instanceof PainBattery)?.charge(taken);
}

// 1. Pain Battery: every bit of damage Victor takes charges it; a full battery (a share of his max health, less with cooldown reduction) fires
// bolts over the enemies in a cone: spirit damage, once each. T1: a slow. T2: more damage. T3: a hit heals a share of his missing health.
// The gun's own rule lives here too (slot 1 is never locked): it spins up while he fires (ability.js spinUp).
class PainBattery extends Ability {
  constructor(...args) {
    super(...args);
    this.stored = 0;
  }

  get need() { return (this.unit.stats.maxHealth * this.data.StoredDamageHealthPercentRequired * Math.max(0.2, 1 - this.unit.stat('cdr'))) / 100; }
  charge(damage) { this.stored = Math.min(this.need, this.stored + damage); }
  ready() { return super.ready() && this.stored >= this.need - 1e-9; }
  status(fight) { return this.stored >= this.need - 1e-9 ? super.status(fight) : `${Math.floor((this.stored / this.need) * 100)}%`; }
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const front = fight.foes[0];
    if (!front) return;
    this.stored = 0;
    const reach = fight.distance(this.unit, front) * Math.tan((this.data.SpreadAngle * Math.PI) / 360) * this.unit.range;
    const hit = fight.near(reach).slice(0, this.data.BoltCount);
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      if (this.value('SlowPercent')) fight.addStatus(e, { id: 'pain_battery', duration: parseFloat(this.value('SlowDuration')) || 2, mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
    }
    if (hit.length) fight.heal(this.unit, ((this.unit.stats.maxHealth - this.unit.health) * this.value('MissingHealthPercentHeal')) / 100);
  }

  on(event, fight, p) {
    if (event === 'damage' && p.target === this.unit && p.dealt > 0) this.charge(p.dealt);
  }

  tick(fight, dt) { spinUp(this, HEROES[this.unit.name].Weapon, fight, dt); }
}

// 2. Jumpstart: used when hurt: it costs a share of his current health, then gives health back over its duration (through the heal cap) and
// speed. T1: more speed. T2: more health back, shorter cooldown. T3: a second charge, and debuffs on him last half as long.
const HURT = 0.7;
class Jumpstart extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT; }

  cast(fight) {
    const duration = this.value('AbilityDuration');
    pay(this.unit, (this.unit.health * this.data.CurrentHealthPercentDamage) / 100);
    if (this.value('StatusResistancePercent')) fight.cleanse(this.unit, this.value('StatusResistancePercent') / 100);
    fight.addStatus(this.unit, { id: 'jumpstart', duration, regen: this.value('TotalHealthRegen') / duration, mods: { moveSpeed: this.value('BonusMoveSpeed'), statusResist: this.value('StatusResistancePercent') / 100 } });
  }
}

// 3. Aura of Suffering: spirit damage every tick to the enemies around (half to bosses), growing from its minimum to its maximum while it is
// held, and a share of that to himself. He holds it for its duration, but only starts it with enough health and lets go when he is low.
// T1: a slow. T2: more damage. T3: wider, and the enemies in it take more damage.
const AURA_ON = 0.5; // started above this share of his health
const AURA_OFF = 0.3; // dropped below this one
class AuraOfSuffering extends Ability {
  constructor(...args) {
    super(...args);
    this.from = 0;
    this.until = 0;
    this.next = 0;
  }

  dps(name) { return [this.data, ...this.data.Upgrades.slice(0, this.tier)].reduce((sum, x) => sum + (x[name]?.Value ?? x[name] ?? 0) + (x[name]?.Scale?.Value ?? 0) * this.spirit(), 0); }
  want(fight) { return fight.foes.length > 0 && fight.time >= this.until && this.unit.health > this.unit.stats.maxHealth * AURA_ON; }
  status(fight) { return fight && fight.time < this.until ? 'Suffering' : super.status(fight); }

  cast(fight) {
    this.from = fight.time;
    this.until = fight.time + this.data.AbilityDuration;
    this.next = fight.time + this.data.TickRate;
  }

  tick(fight) {
    if (fight.time > this.until + 1e-9 || fight.time + 1e-9 < this.next) return;
    if (this.unit.cantAct || this.unit.health < this.unit.stats.maxHealth * AURA_OFF) { this.until = 0; return; }
    this.next += this.data.TickRate;
    const [min, max] = [this.dps('MinDPS') + this.dps('MinDps'), this.dps('MaxDPS')]; // the wiki data spells tier 2's "MinDps"
    const damage = (min + ((max - min) * (fight.time - this.from)) / this.data.AbilityDuration) * this.data.TickRate;
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, damage * (e.team !== 'hero' && isBoss(e) ? this.data.BossDamageScale : 1), 'spirit');
      fight.addStatus(e, { id: 'aura_of_suffering', duration: this.data.DebuffDuration, mods: { slow: this.value('SlowPercent') / 100, damageTaken: this.value('IncomingDamagePercent') / 100 }, debuff: true });
    }
    pay(this.unit, (damage * this.data.SelfDamagePercentage) / 100);
  }
}

// 4. Shocking Reanimation (never cast): a lethal hit doesn't kill him while this is ready: he is out for a moment (nothing can hurt him, he
// can't act), then gets up with a share of his health, spirit damage, a stun and a slow on the enemies around. It goes before a Rejuv or Cheat
// Death (the wiki). T1: while it is on cooldown, more fire rate and spirit damage on every bullet. T2: he gets up with more health.
// T3: more damage, a longer stun, far shorter cooldown.
class ShockingReanimation extends Ability {
  want() { return false; }

  preventDeath(fight) {
    if (!this.ready() && !(this.cdLeft <= 0 && this.unit.cantAct)) return false; // asleep or cursed is no bar: it is a passive
    const u = this.unit;
    const down = this.data.RespawnDelay;
    this.use();
    fight.log.push({ t: +fight.time.toFixed(1), who: u.name, what: this.name });
    fight.cleanse(u);
    fight.addStatus(u, { id: 'reanimating', duration: down, tags: ['sleep'], mods: { damageTaken: -1 } });
    fight.at(down, () => fight.running(this, () => {
      u.health = Math.max(u.health, (u.stats.maxHealth * this.value('RespawnHealthPercent')) / 100);
      for (const e of fight.near(this.value('Radius'))) {
        fight.damage(u, e, this.value('Damage'), 'spirit');
        fight.addStatus(e, { id: 'reanimation_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
        fight.addStatus(e, { id: 'reanimation_slow', duration: this.value('SlowDuration'), mods: { slow: Math.min(0.9, this.data.SlowPercent / 100) }, debuff: true });
      }
    }));
    return true;
  }

  tick(fight) {
    if (this.cdLeft > 0 && this.value('BonusFireRate')) fight.addStatus(this.unit, { id: 'reanimated', duration: DT * 1.5, mods: { fireRate: this.value('BonusFireRate') / 100 } });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || !(this.cdLeft > 0) || !this.value('BonusDamagePerBullet') || !p.target.alive) return;
    fight.running(this, () => fight.damage(this.unit, p.target, this.value('BonusDamagePerBullet'), 'spirit', { proc: true }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Pain Battery', 'Taking damage charges it. Once full, fires shocking bolts at the enemies in front.'],
  ['Jumpstart', 'When hurt, trades a little health for a lot of regeneration and speed.'],
  ['Aura of Suffering', 'Unleashes growing pain on the enemies around, and on Victor too.'],
  ['Shocking Reanimation', 'A lethal hit does not kill: Victor gets back up, damaging and stunning the enemies around.'],
];

module.exports = { name: 'Victor', abilities: { 1: PainBattery, 2: Jumpstart, 3: AuraOfSuffering, 4: ShockingReanimation }, info };
