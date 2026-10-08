// Viscous' abilities (deadlock.wiki/Viscous, checked Oct 5 2026; page updated Sept 30). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. The Cube follows his call for Kelvin's Frozen Shelter (Oct 5): used on himself when hurt, nothing
// gets in or out. Taken by me: how often the rolling Goo Ball comes back to the same enemy (ROLL).
const { Ability } = require('./../ability');
const { MELEE, LIFESTEAL_VS_NPC } = require('./../engine');

// 1. Splatter: a ball of goo on the front enemy that bounces: every bounce hits the enemies around again for less (the wiki's shares for the
// second, third and fourth hit on the same target), and the goo slows them. T1: more damage, wider. T2: shorter cooldown. T3: one more bounce.
const BOUNCE = 0.4; // seconds between two bounces. ponytail: the wiki gives none
class Splatter extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const shares = [1, this.data.SecondHitDamagePercentage, this.data.ThirdHitDamagePercentage, this.data.FourthHitDamagePercentage];
    for (let i = 0; i <= this.value('MaxBounces'); i++) {
      fight.at(i * BOUNCE, () => fight.running(this, () => {
        if (!this.unit.alive) return;
        for (const e of fight.near(this.value('Radius'))) {
          fight.damage(this.unit, e, this.value('Damage') * (shares[i] ?? shares.at(-1)), 'spirit');
          fight.addStatus(e, { id: 'splatter', duration: this.value('PuddleDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
        }
      }));
    }
  }
}

// 2. The Cube: used when hurt: Viscous is cased in restorative goo: nothing can hurt or target him, he can't act, and he heals every second
// (through the heal cap). T1: faster and quicker stamina after. T2: more healing, longer. T3: clears his debuffs, shorter cooldown.
const HURT = 0.5;
class TheCube extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT; }

  cast(fight) {
    const duration = this.value('AbilityDuration');
    if (this.value('PurgeDebuffs')) fight.cleanse(this.unit);
    fight.addStatus(this.unit, { id: 'the_cube', duration, tags: ['void'], regen: this.value('BonusHealthRegen') });
    if (this.value('PostCubeBuff')) fight.at(duration, () => fight.addStatus(this.unit, { id: 'post_cube', duration: this.value('PostCubeBuffDuration'), mods: { moveSpeed: this.value('BonusMoveSpeed'), staminaCdr: this.value('StaminaCooldownReduction') / 100 } }));
  }
}

// 3. Puddle Punch: a fist out of the ground under the front enemy: melee damage, a knock-up and a slow on everything around it.
// T1: a second charge, more damage. T2: wider, and it heals him for a share of the damage. T3: shorter cooldown, heavy melee damage instead.
class PuddlePunch extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const damage = this.value('UseHeavyMelee') ? this.value('DamageHeavyMelee') : this.value('Damage');
    let healing = 0;
    for (const e of fight.near(this.value('Radius'))) {
      healing += ((fight.damage(this.unit, e, damage, 'melee') * this.value('LifeStealPercentOnHit')) / 100) * (e.team === 'hero' ? 1 : LIFESTEAL_VS_NPC);
      fight.addStatus(e, { id: 'puddle_punch', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
      fight.addStatus(e, { id: 'puddle_punch_slow', duration: this.value('ImpactDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    }
    fight.heal(this.unit, healing, 'lifesteal');
  }
}

// 4. Goo Ball: a rolling ball for a while: no shooting (he can still cast), bullet and spirit resist, and every ROLL seconds he rolls through
// the enemies around the front one: spirit damage and a short stun. T1: shorter cooldown. T2: more damage, more resist. T3: longer, longer stun.
const ROLL = 2; // ponytail: seconds between two passes over the same enemies; the wiki gives none
class GooBall extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.next = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Rolling' : super.status(fight); }

  cast(fight) {
    const duration = this.value('AbilityDuration');
    this.until = fight.time + duration;
    this.next = fight.time;
    fight.addStatus(this.unit, { id: 'goo_ball', duration, mods: { bulletResist: this.value('BulletResist') / 100, spiritResist: this.value('TechResist') / 100 } });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
  }

  tick(fight) {
    if (fight.time > this.until + 1e-9 || fight.time + 1e-9 < this.next || this.unit.cantAct) return;
    const front = fight.foes[0];
    if (!front) return;
    this.next = fight.time + ROLL;
    this.unit.close = front;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
    for (const e of fight.near(this.value('BallHitRadius') + 4)) { // the ball's own width, and the enemies it rolls on through
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'goo_ball_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Splatter', 'Throws a bouncing ball of goo that damages the enemies around again and again, and slows them.'],
  ['The Cube', 'When hurt, encases Viscous in restorative goo: safe from damage and healing, but unable to act.'],
  ['Puddle Punch', 'Materializes a fist that punches everyone in an area into the air.'],
  ['Goo Ball', 'Turns into a rolling ball of goo that bowls through the enemies, damaging and stunning them.'],
];

module.exports = { name: 'Viscous', abilities: { 1: Splatter, 2: TheCube, 3: PuddlePunch, 4: GooBall }, info };
