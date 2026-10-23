// Infernus' abilities (deadlock.wiki/Infernus, checked Oct 5 2026; page updated Sept 30). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. His call (Oct 5): Flame Dash's trail burns every enemy for the whole trail time
// (enemies here stand still). A bullet is a headshot with the chance the headshot items use (his "treat it as a crit" call for Holliday).
const { Ability } = require('./../ability');
const { DT, MELEE, LIFESTEAL_VS_NPC } = require('./../engine');
const { isBoss } = require('./../items');
const { headshotChance } = require('./../engine');

// 1. Napalm: spirit damage and a slow on the enemies in reach, and a coat of napalm: they take more damage for a while.
// T1: a second charge. T2: lifesteal against the napalmed. T3: even more damage taken, and they heal less.
class Napalm extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const steal = this.value('LifestealPercentHero') / 100;
    for (const e of fight.near(this.value('AbilityCastRange'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'napalm_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
      fight.addStatus(e, {
        id: 'napalm', duration: this.value('DebuffDuration'), debuff: true,
        mods: { damageTaken: this.value('IncomingDamagePercentFromCaster') / 100, lifestealOn: steal, spiritLifestealOn: steal, healAmp: this.value('HealAmpReceivePenaltyPercent') / 100 },
      });
    }
  }
}

// 2. Flame Dash: a dash through the enemies that leaves a burning trail under all of them for the whole trail time (his call): spirit damage
// every tick, less to bosses (the game's "objectives"). He is right among them while he dashes. T2: a hotter, longer trail. T3: two charges.
class FlameDash extends Ability {
  constructor(...args) {
    super(...args);
    this.burns = []; // [{ e, until, next }]
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const until = fight.time + this.value('GroundFlameDuration');
    for (const e of fight.foes) this.burns.push({ e, until, next: fight.time + this.data.TickRate });
    this.unit.close = fight.foes[0] ?? null;
    this.unit.closeUntil = fight.time + Math.max(this.value('AbilityDuration'), MELEE.closeFor);
  }

  tick(fight) {
    this.burns = this.burns.filter((b) => b.e.alive && b.next <= b.until + 1e-9);
    for (const b of this.burns) {
      if (fight.time + 1e-9 < b.next) continue;
      b.next += this.data.TickRate;
      fight.damage(this.unit, b.e, this.value('DPS') * this.data.TickRate * (b.e.team !== 'hero' && isBoss(b.e) ? this.data.BossDamageScale : 1), 'spirit');
    }
  }
}

// 3. Afterburn (passive): bullets build up on an enemy (a headshot more, a heavy melee a lot); a full bar sets it on fire: spirit damage every
// tick for the base burn time. While it burns, bullets add time (up to the maximum) and his abilities' damage sets it back to the base time.
// T1: a hotter burn. T2: burning enemies deal less spirit damage. T3: a longer maximum.
// ponytail: the build-up's falloff beyond 18 m isn't simulated (every enemy stands within 20 m).
const MELEE_BUILD = 35; // a heavy melee's build-up, % (the wiki's note)
class Afterburn extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    this.bars = new Map(); // enemy -> { bar, last }
    this.burns = new Map(); // enemy -> { until, next }
  }

  struck(fight, e, build, extend) {
    if (!e.alive) return;
    const burn = this.burns.get(e);
    if (burn) { burn.until = Math.min(fight.time + this.value('BurnDuration'), burn.until + extend); return; }
    const b = this.bars.get(e) ?? { bar: 0, last: fight.time };
    if (fight.time - b.last > this.value('BuildUpDuration')) b.bar = 0;
    b.bar += build;
    b.last = fight.time;
    this.bars.set(e, b);
    if (b.bar < 100) return;
    this.bars.delete(e);
    this.burns.set(e, { until: fight.time + this.data.BurnDurationBase, next: fight.time + this.data.TickRate });
  }

  on(event, fight, p) {
    if (p.source !== this.unit) return;
    if (event === 'bulletHit') {
      const head = fight.rng() < headshotChance(this.unit);
      this.struck(fight, p.target, head ? this.data.CritBuildup : this.data.BuildUpBulletPercentPerHit, head ? this.data.RefillDurationCrit : this.data.RefillDuration);
    } else if (event === 'melee') this.struck(fight, p.target, MELEE_BUILD, 0);
    else if (event === 'damage' && p.opts.ability && p.opts.ability !== this) { // one of his abilities: the burn is back at its base time
      const burn = this.burns.get(p.target);
      if (burn) burn.until = Math.max(burn.until, fight.time + this.data.BurnDurationBase);
    }
  }

  tick(fight) {
    for (const [e, burn] of this.burns) {
      if (!e.alive || fight.time > burn.until + 1e-9) { this.burns.delete(e); continue; }
      if (this.value('OutgoingTechDamagePercent')) fight.addStatus(e, { id: 'afterburn', duration: DT * 1.5, mods: { spiritDealt: this.value('OutgoingTechDamagePercent') / 100 }, debuff: true });
      if (fight.time + 1e-9 < burn.next) continue;
      burn.next += this.data.TickRate;
      fight.damage(this.unit, e, this.value('DPS') * this.data.TickRate, 'spirit');
    }
  }
}

// 4. Concussive Combustion: a living bomb: after the delay (he keeps fighting meanwhile) spirit damage and a stun on the enemies around.
// T1: more damage. T2: shorter cooldown, and he heals for the explosion's damage (half from NPCs like all lifesteal). T3: longer stun, more reach.
class ConcussiveCombustion extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    fight.at(this.data.ExplodeDelay, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      const steal = this.value('LifeStealPercentOnHit') / 100;
      let healing = 0;
      for (const e of fight.near(this.value('Radius'))) {
        healing += fight.damage(this.unit, e, this.value('Damage'), 'spirit') * steal * (e.team === 'hero' ? 1 : LIFESTEAL_VS_NPC);
        fight.addStatus(e, { id: 'combustion', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
      }
      fight.heal(this.unit, healing, 'lifesteal');
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Napalm', 'Spews napalm over the enemies ahead: damage, a slow, and they take more damage for a while.'],
  ['Flame Dash', 'Dashes through the enemies, leaving a trail of flames that burns them.'],
  ['Afterburn', 'Bullets build up until the enemy catches fire. More bullets keep it burning.'],
  ['Concussive Combustion', 'Becomes a living bomb that explodes after a delay, damaging and stunning everything nearby.'],
];

module.exports = { name: 'Infernus', abilities: { 1: Napalm, 2: FlameDash, 3: Afterburn, 4: ConcussiveCombustion }, info };
