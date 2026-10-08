// Abrams' abilities (deadlock.wiki/Abrams, checked Oct 2 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. Every enemy on a farm is an NPC, so "on hero collide" effects work on any enemy here.
const { Ability } = require('./../ability');
const { HEAL_POOL } = require('./../engine');

// 1. Siphon Life: for a few seconds, drains every enemy within its radius (spirit damage every 0.25 s) and heals for a share of it
// (35% from non-heroes). Abrams keeps shooting meanwhile.
class SiphonLife extends Ability {
  constructor(...args) {
    super(...args);
    this.ticks = 0; // drain ticks still to come
    this.next = 0;
  }

  want(fight) {
    return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * 0.8; // a heal, when hurt
  }

  cast(fight) {
    this.ticks = Math.round(this.value('AbilityDuration') / this.data.TickRate);
    this.next = fight.time + this.data.TickRate;
  }

  tick(fight) {
    if (!this.ticks || fight.time + 1e-9 < this.next) return;
    this.ticks--;
    this.next += this.data.TickRate;
    for (const e of fight.near(this.value('Radius'))) {
      const dealt = fight.damage(this.unit, e, this.value('DPS') * this.data.TickRate, 'spirit');
      fight.heal(this.unit, (dealt * this.value('NonHeroHealingFactor')) / 100);
    }
  }
}

// 2. Shoulder Charge: rams the first enemy for spirit damage and stuns it. T3: every pellet hits harder for a few seconds after.
// ponytail: the stun needs a wall in the game; here every charge ends in one.
class ShoulderCharge extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const target = fight.foes[0];
    if (!target) return;
    fight.damage(this.unit, target, this.value('Damage'), 'spirit');
    fight.addStatus(target, { id: 'charge_stun', duration: this.value('StunDuration'), tags: ['stun'] });
    fight.addStatus(target, { id: 'charge_slow', duration: this.value('SlowDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true }); // T1 (a slowed enemy's blast is easier to dodge)
    const bonus = this.value('WeaponDamageBonus'); // T3: +1.5 damage on every bullet of the spread
    if (bonus) fight.addStatus(this.unit, { id: 'charge_power', duration: this.value('WeaponPowerIncreaseDuration'), mods: { bulletDamage: bonus } });
  }
}

// 3. Infernal Resilience (passive): more health regen (T1: +200 max health), and a share of the health lost comes back over 20 s.
// The damage is added up once a second (the wiki's interval), each second's share then trickles back. T2: melee heals for a share of its damage
// (40% of it against non-heroes). T3: debuff resist (shortens a blast's curse or stomp).
class InfernalResilience extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    const health = this.value('BonusMaxHealth');
    this.unit.stats.maxHealth += health;
    this.unit.health += health;
    this.unit.healPool += health * HEAL_POOL;
    this.unit.stats.healthRegen += this.value('BonusHealthRegen');
    this.unit.stats.statusResist = 1 - (1 - (this.unit.stats.statusResist ?? 0)) * (1 - this.value('StatusResistancePercent') / 100);
    this.lost = 0; // health lost since the last interval
    this.nextAt = 0;
    this.regens = []; // { until, perSecond }
  }

  status() { return 'Passive'; }

  on(event, fight, { source, target, dealt }) {
    if (event === 'damage' && target === this.unit) this.lost += dealt;
    if (event === 'melee' && source === this.unit) fight.heal(this.unit, (dealt * this.value('MeleeLifesteal') * this.data.NonHeroHealPct) / 10000, 'lifesteal');
  }

  tick(fight, dt) {
    if (fight.time >= this.nextAt) {
      this.nextAt = fight.time + this.data.RegenDamageInterval;
      const seconds = this.data.RegenIncomingDamageDuration;
      if (this.lost > 0) this.regens.push({ until: fight.time + seconds, perSecond: (this.lost * this.value('RegenIncomingDamagePercent')) / 100 / seconds });
      this.lost = 0;
    }
    this.regens = this.regens.filter((r) => r.until > fight.time);
    const perSecond = this.regens.reduce((sum, r) => sum + r.perSecond, 0);
    if (perSecond > 0) fight.heal(this.unit, perSecond * dt);
  }
}

// 4. Seismic Impact: leaps and crashes down on every enemy within its radius for spirit damage and a stun.
// T3: Unstoppable while it lands (immune to a blast's curse or stomp). ponytail: the leap takes no time here.
class SeismicImpact extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    for (const e of fight.near(this.value('ImpactRadius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'seismic_stun', duration: this.value('StunDuration'), tags: ['stun'] });
    }
    const immune = this.value('ImmunityDuration');
    if (immune) fight.addStatus(this.unit, { id: 'seismic_unstoppable', duration: immune, tags: ['unstoppable'] });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Siphon Life', 'Drains health from nearby enemies, dealing damage over time and healing for part of it.'],
  ['Shoulder Charge', 'Charges into an enemy, dealing damage and stunning it.'],
  ['Infernal Resilience', 'Tougher by nature: more health regen, and part of the damage taken comes back over time.'],
  ['Seismic Impact', 'Leaps high and crashes down, damaging and stunning every enemy nearby.'],
];

module.exports = { name: 'Abrams', abilities: { 1: SiphonLife, 2: ShoulderCharge, 3: InfernalResilience, 4: SeismicImpact }, info };
