// Mo & Krill's abilities (deadlock.wiki/Mo_&_Krill, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. Combo's max health for a kill counts any enemy and lasts the fight only, like the
// other heroes' growing bonuses (his standing rule). Taken by me: they come out of Burrow as soon as they are under (the game lets them stay).
const { Ability } = require('./../ability');
const { DT, MELEE, LIFESTEAL_VS_NPC } = require('./../engine');

// 1. Scorn: spirit damage to the enemies around the front one, healing them for a share of it (a smaller share from NPCs: the wiki's numbers).
// T1: more damage. T2: shorter cooldown, wider. T3: every Scorn leaves a stack on the enemies hit: they take more damage, no limit on stacks.
class Scorn extends Ability {
  constructor(...args) {
    super(...args);
    this.scorned = new Map(); // enemy -> [when each stack runs out]
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    let healing = 0;
    for (const e of fight.near(this.value('Radius'))) {
      healing += fight.damage(this.unit, e, this.value('Damage'), 'spirit') * this.value(e.team === 'hero' ? 'DamageHealMult' : 'DamageHealMultNonHero');
      if (this.value('DamageBonus')) this.scorned.set(e, [...(this.scorned.get(e) ?? []), fight.time + this.value('DebuffDuration')]);
    }
    fight.heal(this.unit, healing);
  }

  tick(fight) {
    for (const [e, stacks] of this.scorned) {
      const left = stacks.filter((until) => until > fight.time);
      if (!e.alive || !left.length) { this.scorned.delete(e); continue; }
      this.scorned.set(e, left);
      fight.addStatus(e, { id: 'scorn', duration: DT * 1.5, mods: { damageTaken: (left.length * this.value('DamageBonus')) / 100 }, debuff: true });
    }
  }
}

// 2. Burrow: under the ground for the cast (no shooting, bullet and spirit resist, faster), then they jump out among the enemies: a knock-up, and
// a spin that deals spirit damage every step to those around and slows them. T1: more spin damage. T2: wider. T3: shorter cooldown, faster.
class Burrow extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Spinning' : super.status(fight); }

  on(event, fight, p) {
    if (event !== 'cast' || p.ability !== this) return;
    fight.addStatus(this.unit, { id: 'burrowed', duration: this.castDelay, mods: { bulletResist: this.data.BulletResist / 100, spiritResist: this.data.TechResist / 100, moveSpeed: this.value('BonusMoveSpeed') } });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
  }

  cast(fight) {
    const spin = this.value('SpinDuration');
    this.until = fight.time + spin;
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    this.unit.close = fight.foes[0] ?? null;
    this.unit.closeUntil = this.until + MELEE.closeFor;
    for (const e of fight.near(this.value('Radius'))) fight.addStatus(e, { id: 'burrow_toss', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
  }

  tick(fight, dt) {
    if (fight.time > this.until + 1e-9 || this.unit.cantAct) return;
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('DPS') * dt, 'spirit');
      fight.addStatus(e, { id: 'burrow_slow', duration: this.data.SpinSlowDuration, mods: { slow: this.data.SpinSlowPercent / 100 }, debuff: true });
    }
  }
}

// 3. Sand Blast: a spray of sand over the enemies in front (wider the further away they stand): damage, and they are disarmed: no attacks for
// a while. T1: more damage. T2: a slow. T3: longer, far shorter cooldown.
class SandBlast extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const front = fight.foes[0];
    if (!front) return;
    const reach = ((this.data.InitialWidth + this.data.GrowthPerMeter * fight.distance(this.unit, front)) / 2) * this.unit.range;
    for (const e of fight.near(reach)) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'sand_blast', duration: this.value('AbilityDuration'), tags: ['disarm'], mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
    }
  }
}

// 4. Combo: they walk up to the front enemy and hold it: stunned for the channel (a boss shrugs part of that off), spirit damage every step, no
// shooting or casting meanwhile. If it dies during the hold or within KILL_WINDOW seconds after, they gain max health for the rest of the fight
// (the health that comes with it is a heal under the cap, like Billy's). T1: they heal for the damage. T2: bullet resist meanwhile. T3: longer,
// more damage.
const KILL_WINDOW = 3;
class Combo extends Ability {
  constructor(...args) {
    super(...args);
    this.held = null; // { e, until, watch }
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && this.held && fight.time < this.held.until ? 'Holding' : super.status(fight); }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    const channel = this.value('AbilityChannelTime');
    this.held = { e, until: fight.time + channel, watch: fight.time + channel + KILL_WINDOW };
    fight.addStatus(e, { id: 'combo', duration: channel, tags: ['stun'], debuff: true });
    fight.addStatus(this.unit, { id: 'combo_hold', duration: channel, tags: ['silence'], mods: { bulletResist: this.value('BulletResist') / 100 } });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.held.until);
    this.unit.close = e;
    this.unit.closeUntil = this.held.until + MELEE.closeFor;
  }

  tick(fight, dt) {
    const h = this.held;
    if (!h) return;
    if (h.e.alive && fight.time <= h.until + 1e-9 && !this.unit.cantAct) {
      const dealt = fight.damage(this.unit, h.e, this.value('DPS') * dt, 'spirit');
      fight.heal(this.unit, ((dealt * this.value('LifeStealPercentOnHit')) / 100) * (h.e.team === 'hero' ? 1 : LIFESTEAL_VS_NPC), 'lifesteal');
    }
    if (!h.e.alive) {
      const health = this.value('BonusHealthOnKill');
      this.unit.stats.maxHealth += health;
      fight.heal(this.unit, health);
      this.held = null;
    } else if (fight.time > h.watch) this.held = null;
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Scorn', 'Damages the enemies nearby and heals for part of the damage done.'],
  ['Burrow', 'Burrows underground, then jumps out among the enemies: a knock-up and a damaging spin.'],
  ['Sand Blast', 'Sprays sand over the enemies in front, damaging and disarming them.'],
  ['Combo', 'Holds an enemy in place, stunned and taking damage. A kill adds max health for the fight.'],
];

module.exports = { name: 'Mo & Krill', abilities: { 1: Scorn, 2: Burrow, 3: SandBlast, 4: Combo }, info };
