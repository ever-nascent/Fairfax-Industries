// Paige's abilities (deadlock.wiki/Paige, checked Oct 2 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 2): ally abilities work on Paige alone; the knights arrive half way to their full amp; Rallying
// Charge is kept for when she is hurt.
const { Ability } = require('./../ability');

// 1. Bookwyrm: a dragon flies through the group, spirit damage to every enemy in its path, and leaves a trail that burns them for a while.
// T2: a second charge. ponytail: one trail at a time (a second dragon only keeps it burning longer); the path's width does nothing here.
class Bookwyrm extends Ability {
  constructor(...args) {
    super(...args);
    this.burnUntil = 0;
    this.next = 0;
  }

  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    for (const e of fight.near(this.value('DragonTravelRange'))) fight.damage(this.unit, e, this.value('Damage'), 'spirit');
    if (this.burnUntil <= fight.time) this.next = fight.time + this.data.TickRate;
    this.burnUntil = fight.time + this.value('GroundFlameDuration');
  }

  tick(fight) {
    if (fight.time > this.burnUntil + 1e-9 || fight.time + 1e-9 < this.next) return;
    this.next += this.data.TickRate;
    for (const e of fight.near(this.value('DragonTravelRange'))) fight.damage(this.unit, e, this.value('DPS') * this.data.TickRate, 'spirit');
  }
}

// 2. Plot Armor: a barrier on Paige herself (his call: ally abilities work on the hero alone), and while it holds, more weapon damage
// (T1: and fire rate). T3's extra allies do nothing; its barrier scaling does.
class PlotArmor extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    fight.addStatus(this.unit, {
      id: 'plot_armor', duration: this.value('AbilityDuration'), barrier: this.value('CombatBarrier'),
      mods: { weaponDamage: this.value('BaseAttackDamagePercent') / 100, fireRate: this.value('BonusFireRate') / 100 },
    });
  }

  on(event, fight, { target }) {
    if (event === 'damage' && target === this.unit && this.unit.statuses.some((s) => s.id === 'plot_armor' && s.barrier <= 0)) fight.removeStatus(this.unit, 'plot_armor');
  }
}

// 3. Captivating Read: an area on the front enemy that slows at once, then detonates: spirit damage and an immobilize (the hero walks up and
// melees an immobilized enemy, engine.js HELPLESS). T3: the enemies hit lose spirit resist.
class CaptivatingRead extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    for (const e of fight.near(this.value('Radius'))) fight.addStatus(e, { id: 'read_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    fight.at(this.data.DetonationDelay, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      for (const e of fight.near(this.value('Radius'))) {
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
        fight.addStatus(e, { id: 'read_root', duration: this.value('ImmobilizeDuration'), tags: ['immobilize'], debuff: true });
        fight.addStatus(e, { id: 'read_shred', duration: this.value('DebuffDuration'), mods: { spiritResist: this.value('TechArmorDamageReduction') / 100 }, debuff: true });
      }
    }));
  }
}

// 4. Rallying Charge: knights ride through every enemy (spirit damage and a stun) and heal Paige, who is faster for a while (a blast is easier
// to dodge). Damage and healing grow with the distance ridden: here always half way to the full amp (his call). Kept for when she is hurt
// (his call). ponytail: one hit per enemy (the two waves aren't simulated); T2's wider charge does nothing, it already reaches every enemy.
const AMP_SHARE = 0.5;
const HURT = 0.6;
class RallyingCharge extends Ability {
  want(fight) {
    return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT;
  }

  cast(fight) {
    const amp = 1 + (this.value('MaxAmp') / 100) * AMP_SHARE;
    for (const e of fight.foes) {
      fight.damage(this.unit, e, this.value('Damage') * amp, 'spirit');
      fight.addStatus(e, { id: 'rally_stun', duration: this.value('StunDuration'), tags: ['stun'] });
    }
    fight.heal(this.unit, this.value('HealAmount') * amp);
    fight.addStatus(this.unit, { id: 'rally_speed', duration: this.value('BuffDuration'), mods: { moveSpeed: this.data.BonusMoveSpeed } });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Bookwyrm', 'Conjures a dragon that flies through the enemies, damaging them and leaving a burning trail.'],
  ['Plot Armor', 'A protective barrier. While it holds, the gun hits harder.'],
  ['Captivating Read', 'Marks an area that slows, then detonates, damaging and immobilizing the enemies in it.'],
  ['Rallying Charge', 'Spectral knights charge through every enemy, damaging and stunning them, and heal Paige.'],
];

module.exports = { name: 'Paige', abilities: { 1: Bookwyrm, 2: PlotArmor, 3: CaptivatingRead, 4: RallyingCharge }, info };
