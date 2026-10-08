// Rem's abilities (deadlock.wiki/Rem, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value(); this file
// is only what each ability does. Rem is a support hero; ally abilities work on the hero alone (his call, Oct 2). His calls (Oct 5): Tag Along
// is its heals only (nobody to hide on: Rem keeps fighting and can be hit); Naptime's tier 1 leaves anything that wakes GROGGY seconds from
// attacking (the game: a stamina charge, which only a rival hero has).
const { Ability } = require('./../ability');

// 1. Pillow Toss: spirit damage, a knock-back (a short stun) and a slow on the enemies around the front one; a toss that hits takes time off
// Tag Along's and Naptime's cooldowns. T1: shorter cooldown. T2: wider, and they attack slower. T3: more damage, a second charge.
class PillowToss extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const hit = fight.near(this.value('Radius'));
    const slower = -this.value('FireRateSlow') / 100;
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'pillow_toss', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
      fight.addStatus(e, { id: 'pillow_slow', duration: this.value('EffectDuration'), mods: { slow: this.data.FadingSlowPercent / 100, ...(e.team === 'hero' ? { fireRate: slower } : { damageDealt: slower }) }, debuff: true });
    }
    if (hit.length) for (const a of this.unit.abilities) if (a instanceof TagAlong || a instanceof Naptime) a.cdLeft = Math.max(0, a.cdLeft - this.data.CDReduceOnPillowHit);
  }
}

// 2. Tag Along: used when hurt: a burst heal of a share of the missing health, then healing every second for a while (through the heal cap).
// T2: more ability range and duration meanwhile. T3: more spirit power meanwhile and for a while after.
const HURT = 0.75;
class TagAlong extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT; }

  cast(fight) {
    const u = this.unit;
    const nap = this.value('AbilityDuration');
    fight.heal(u, ((u.stats.maxHealth - u.health) * this.value('MissingHealthBurstPct')) / 100);
    fight.addStatus(u, { id: 'tag_along', duration: nap, regen: this.value('HealingPerSecond'), mods: { rangeMult: this.value('BonusItemRangePercent') / 100, durationMult: this.value('BonusItemDurationPercent') / 100 } });
    const spirit = this.value('BonusSpiritPower') + (u.stats.spirit * this.value('TechPowerPercent')) / 100;
    if (spirit) fight.addStatus(u, { id: 'tag_along_spirit', duration: nap + this.value('HopOffEffecDuration'), mods: { spirit } });
  }
}

// 3. Lil Helpers: a Helper follows Rem for a while: spirit resist and move speed. Each Helper then naps before it can follow again, so more
// Helpers mean less time without one (one follows at a time). T1 / T2 / T3: one more Helper each; T1 more speed, T3 more spirit resist.
class LilHelpers extends Ability {
  constructor(...args) {
    super(...args);
    this.back = []; // when each Helper that is out can follow again
    this.now = 0;
  }

  get follow() { return this.value('PlayerInfestDuration'); }
  get cooldown() { return this.follow + this.value('HelperDowntimeDuration'); } // one Helper's round: following, then its nap
  get free() { return Math.round(this.value('HelperCount')) - this.back.filter((t) => t > this.now).length; }
  ready() { return !this.unit.cantAct && this.free > 0; }
  use() { this.back = [...this.back.filter((t) => t > this.now), this.now + this.cooldown]; }
  tickCooldown() {}
  refresh() { this.back = []; }
  status() { return this.free > 0 ? 'Ready' : `${Math.ceil(Math.min(...this.back) - this.now)}s`; }
  want(fight) { return fight.foes.length > 0 && !this.unit.statuses.some((s) => s.id === 'lil_helper'); }
  tick(fight) { this.now = fight.time; }

  cast(fight) {
    fight.addStatus(this.unit, { id: 'lil_helper', duration: this.follow, mods: { spiritResist: this.value('TechArmorGain') / 100, moveSpeed: this.value('BonusMoveSpeed') } });
  }
}

// 4. Naptime: a channel (no shooting or casting, less damage taken), then the enemies in the gaze fall asleep: no attacks. A sleeper wakes when
// its time is up, or once it has taken SleepDamageThreshold damage (not before MinSleepTime), to a headache of spirit damage. A boss shrugs part
// of the sleep off. T1 (his call): whatever wakes can't attack for GROGGY seconds more (a rival hero also loses a stamina charge). T2: wider,
// longer. T3: shorter cooldown, and Rem takes even less damage and can't be stopped while channelling.
const GROGGY = 1;
class Naptime extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.sleepers = new Map(); // enemy -> { taken, since }
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Channelling' : super.status(fight); }

  cast(fight) {
    const channel = this.data.AbilityChannelTime.Value;
    this.until = fight.time + channel;
    fight.addStatus(this.unit, { id: 'naptime_gaze', duration: channel, tags: ['silence', ...(this.value('UnstoppableWhileChanneling') ? ['unstoppable'] : [])], mods: { damageTaken: -this.value('DamageResistPctWhileChanneling') / 100 } });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    fight.at(channel, () => {
      if (!this.unit.alive || this.unit.cantAct) return; // interrupted
      for (const e of fight.near(this.value('Radius'))) {
        fight.addStatus(e, { id: 'naptime', duration: this.value('SleepDuration'), tags: ['sleep'], debuff: true });
        this.sleepers.set(e, { taken: 0, since: fight.time });
      }
    });
  }

  wake(fight, e) {
    this.sleepers.delete(e);
    fight.removeStatus(e, 'naptime');
    if (!e.alive) return;
    fight.running(this, () => fight.damage(this.unit, e, this.value('AwakeDamage'), 'spirit'));
    if (this.tier < 1) return;
    fight.addStatus(e, { id: 'naptime_groggy', duration: GROGGY, tags: ['disarm'], debuff: true });
    if (e.team === 'hero') e.stamina = Math.max(0, e.stamina - 1);
  }

  on(event, fight, p) {
    const s = event === 'damage' && this.sleepers.get(p.target);
    if (!s) return;
    s.taken += p.dealt; // tick() wakes it once that is enough
  }

  tick(fight) {
    for (const [e, s] of [...this.sleepers]) {
      const hurt = s.taken >= this.value('SleepDamageThreshold') && fight.time - s.since >= this.data.MinSleepTime;
      if (hurt || !e.alive || !e.statuses.some((x) => x.id === 'naptime')) this.wake(fight, e);
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Pillow Toss', 'Throws a pillow that damages, knocks back and slows. A hit shortens the cooldowns of Tag Along and Naptime.'],
  ['Tag Along', 'When hurt, takes a healing nap on the go: a burst of health, then more every second.'],
  ['Lil Helpers', 'Signals a Helper to tag along for a while: spirit resist and move speed.'],
  ['Naptime', 'Gazes at the enemies until they fall asleep. They wake to a splitting headache.'],
];

module.exports = { name: 'Rem', abilities: { 1: PillowToss, 2: TagAlong, 3: LilHelpers, 4: Naptime }, info };
