// Celeste's abilities (deadlock.wiki/Celeste, checked Oct 2 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 2): Radiant Daggers stacks on every enemy hit; the prism's tier 1 adds move speed while it is up (no
// penalty without it); the orb hits a lone enemy once, unless the tier 3 prism is up to bounce it back.
const { Ability } = require('./../ability');

// 1. Light Eater: a flare on the enemies in reach (spirit damage) that marks them: Celeste's bullets deal extra spirit damage to a marked enemy
// (at most once per TickRate) and spirit damage to it heals her. ponytail: only bullets count as "attacked by Celeste".
class LightEater extends Ability {
  constructor(...args) {
    super(...args);
    this.last = new Map(); // enemy -> when a bullet last set the mark off
  }

  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    for (const e of fight.near(this.value('AbilityCastRange'))) {
      fight.addStatus(e, { id: 'light_eater', duration: this.value('AbilityDuration'), mods: { spiritLifestealOn: this.value('AbilityLifestealPercentHero') / 100 }, tags: ['lightEater'], debuff: true });
      fight.damage(this.unit, e, this.value('FlareDamage'), 'spirit');
    }
  }

  on(event, fight, { source, target }) {
    if (event !== 'bulletHit' || source !== this.unit || !target.has('lightEater') || fight.time - (this.last.get(target) ?? -Infinity) < this.data.TickRate - 1e-9) return;
    this.last.set(target, fight.time);
    fight.damage(this.unit, target, this.value('Damage'), 'spirit', { events: false });
  }
}

// 2. Dazzling Trick: a prism (barrier) for a few seconds. Broken by enemies, it explodes: silences the enemies around (a silenced boss holds its
// blast) and deals a share of the barrier as spirit damage. T1: move speed while it is up (a blast is easier to dodge). T3: the Shining Wonder
// orb bounces off it.
class DazzlingTrick extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    this.amount = this.value('CombatBarrier');
    fight.addStatus(this.unit, {
      id: 'prism', duration: this.value('BuffDuration'), barrier: this.amount,
      mods: { moveSpeed: this.value('BonusMoveSpeed') }, tags: this.tier >= 3 ? ['orbBounce'] : [],
    });
  }

  on(event, fight, { target }) {
    if (event !== 'damage' || target !== this.unit) return;
    const prism = this.unit.statuses.find((s) => s.id === 'prism');
    if (!prism || prism.barrier > 0) return;
    fight.removeStatus(this.unit, 'prism');
    fight.running(this, () => {
      for (const e of fight.near(this.value('ExplodeRadius'))) {
        fight.damage(this.unit, e, (this.amount * this.data.BarrierDamagePercentage) / 100, 'spirit');
        fight.addStatus(e, { id: 'prism_silence', duration: this.value('DebuffDuration'), tags: ['silence'], debuff: true });
      }
    });
  }
}

// 3. Radiant Daggers: a beam on the front enemy that explodes a moment later for spirit damage around it. Every enemy hit is a stack of more
// spirit damage (T3: and fire rate), up to the max, for as long as the buff is kept going. T1: charges.
class RadiantDaggers extends Ability {
  constructor(...args) {
    super(...args);
    this.stacks = 0;
  }

  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    fight.at(this.data.PreExplosionDuration, () => fight.running(this, () => this.explode(fight)));
  }

  explode(fight) {
    if (!this.unit.alive || !fight.foes.length) return;
    let hits = 0;
    for (const e of fight.near(this.value('ExplosionRadius'))) { fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit'); hits++; }
    if (!this.unit.statuses.some((s) => s.id === 'radiant')) this.stacks = 0; // the buff ran out
    this.stacks = Math.min(this.data.BuffMaxStacks, this.stacks + hits);
    fight.addStatus(this.unit, {
      id: 'radiant', duration: this.value('BuffDuration'),
      mods: { spiritDealt: (this.stacks * this.value('MagicIncreasePerStack')) / 100, fireRate: (this.stacks * this.value('FireRatePerStack')) / 100 },
    });
  }
}

// 4. Shining Wonder: an orb that hits the front enemy (spirit damage and a slow) and bounces on between the enemies in reach. With nothing else to
// bounce to it stops, unless the tier 3 prism is up to send it back; so Celeste keeps the orb for the prism when she has that tier.
// ponytail: a bounce every BOUNCE_EVERY seconds is a placeholder (the wiki gives no travel time); the dash reduction does nothing here.
const BOUNCE_EVERY = 0.3;
class ShiningWonder extends Ability {
  want(fight) {
    if (!fight.foes.length) return false;
    const trick = this.unit.abilities.find((a) => a instanceof DazzlingTrick);
    return fight.near(this.value('BounceRadius')).length > 1 || !(trick?.tier >= 3) || this.unit.has('orbBounce');
  }

  cast(fight) {
    this.bounce(fight, this.value('MaxBounces'), null);
  }

  bounce(fight, left, last) {
    if (!this.unit.alive) return;
    const reach = fight.near(this.value('BounceRadius'));
    // the next enemy along (round again from the front); the same one again only off the prism
    const target = reach.slice(reach.indexOf(last) + 1).find((e) => e !== last) ?? reach.find((e) => e !== last) ?? (!last || this.unit.has('orbBounce') ? reach[0] : null);
    if (!target) return;
    fight.damage(this.unit, target, this.value('Damage'), 'spirit');
    fight.addStatus(target, { id: 'shining_slow', duration: this.value('SlowDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
    if (left > 0) fight.at(BOUNCE_EVERY, () => fight.running(this, () => this.bounce(fight, left - 1, target)));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Light Eater', 'A flare of light that damages and marks nearby enemies. Bullets hit marked enemies harder, and damage to them heals.'],
  ['Dazzling Trick', 'A protective prism. If enemies break it, it explodes, silencing and damaging them.'],
  ['Radiant Daggers', 'Calls down a beam that explodes a moment later. Every enemy hit raises spirit damage for a while.'],
  ['Shining Wonder', 'Launches an orb of light that damages and slows, bouncing from enemy to enemy.'],
];

module.exports = { name: 'Celeste', abilities: { 1: LightEater, 2: DazzlingTrick, 3: RadiantDaggers, 4: ShiningWonder }, info };
