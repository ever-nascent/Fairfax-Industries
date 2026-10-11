// Baba's abilities (deadlock.wiki/Baba, checked Oct 10 2026; page updated that day). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. His calls (Oct 10): Threadsap's thread goes through every enemy; while Granny Long Legs is on she
// ground-pounds whenever her heavy melee is ready; each Baba's Brew is one of the three at random. Standing rules used: enemies stand still, so
// Feed The Birds always lands at full strength (the Infernus rule); spirit power taken from an enemy cuts its spirit damage.
const { Ability } = require('./../ability');
const { DT, MELEE } = require('./../engine');
const { isBoss } = require('./../items');

// 1. Threadsap: a moment after the cast the thread bursts through every enemy: spirit damage, and spirit power stolen from each one hit, up to a
// maximum held. Baba gains more than she stole, and while she holds any, every bullet deals spirit damage on top. T1: more per bullet.
// T2: shorter cooldown, held longer. T3: a second charge, and the enemies hit (not bosses) are pulled towards the front one.
class Threadsap extends Ability {
  constructor(...args) {
    super(...args);
    this.stolen = []; // [{ until, amount }]
  }

  // a number that grows per boon (the wiki's "power_increase" scaling, which Ability.value() doesn't read)
  boon(field) { return this.data[field].Value + this.data[field].Scale.Value * (this.unit.boons ?? 0); }
  held(fight) {
    this.stolen = this.stolen.filter((s) => s.until > fight.time);
    return this.stolen.reduce((sum, s) => sum + s.amount, 0);
  }

  gained(fight) { return (this.held(fight) * this.data.StolenSpiritEffectiveness) / 100; }
  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && !this.ready() && this.held(fight) ? `+${Math.round(this.gained(fight))} Spirit` : super.status(fight); }

  cast(fight) {
    fight.at(this.data.ExplodeTime, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      const duration = this.value('DebuffDuration');
      const front = fight.foes[0];
      for (const e of fight.foes) {
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
        const amount = Math.min(this.boon('TechPowerGain'), this.boon('MaxStacks') - this.held(fight));
        if (amount > 0) {
          this.stolen.push({ until: fight.time + duration, amount });
          const before = e.statuses.find((s) => s.id === 'threadsap')?.mods.spirit ?? 0;
          fight.addStatus(e, { id: 'threadsap', duration, mods: { spirit: before - amount }, debuff: true });
        }
        const pull = this.value('PullDistance');
        if (pull && !isBoss(e)) e.offset = Math.max(front.offset ?? 0, (e.offset ?? 0) - pull);
      }
    }));
  }

  tick(fight) {
    const gained = this.gained(fight);
    if (gained) fight.addStatus(this.unit, { id: 'threadsap_spirit', duration: DT * 1.5, mods: { spirit: gained } });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || p.opts.split || !p.target.alive || !this.held(fight)) return;
    fight.running(this, () => fight.damage(this.unit, p.target, this.value('MagicDamagePerBullet'), 'spirit', { proc: true }));
  }
}

// 2. Granny Long Legs: the bench's legs extend for a while: faster, with debuff and melee resist, and her heavy melee is a ground pound: the
// enemies around take the melee hit and spirit damage, are knocked up and slowed. She pounds whenever she can (his call), about a third as
// often as a normal heavy melee (the wiki). Her light kick's knockback does nothing here. T1: faster still. T2: shorter cooldown.
// T3: more of both resists, and her melee hits heal her (less from non-heroes: the game's own share).
const POUND_GAP = 3; // x the usual time between heavy melees
class GrannyLongLegs extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  active(fight) { return fight.time < this.until; }
  want(fight) { return fight.foes.length > 0 && !this.active(fight); }
  status(fight) { return fight && this.active(fight) ? `${Math.ceil(this.until - fight.time)}s Left` : super.status(fight); }
  wantsMelee(fight) { return this.active(fight); }

  cast(fight) { this.until = fight.time + this.value('AbilityDuration'); }

  tick(fight) {
    if (!this.active(fight)) return;
    fight.addStatus(this.unit, { id: 'long_legs', duration: DT * 1.5,
      mods: { moveSpeed: this.value('BonusMoveSpeed'), statusResist: this.value('StatusResistancePercent') / 100, meleeTaken: -this.value('MeleeResist') / 100 } });
  }

  on(event, fight, p) {
    if (event !== 'melee' || p.source !== this.unit || !this.active(fight)) return;
    this.unit.meleeAt = fight.time + MELEE.every * POUND_GAP;
    const steal = (e) => (this.value('MeleeLifesteal') / 100) * (e.team === 'hero' ? 1 : this.data.MeleeLifestealNonHeroPct / 100);
    fight.heal(this.unit, p.dealt * steal(p.target));
    for (const e of fight.near(this.value('Radius'))) {
      if (e !== p.target) fight.heal(this.unit, fight.damage(this.unit, e, p.amount, 'melee', { melee: true }) * steal(e));
      fight.damage(this.unit, e, this.value('HeavyMeleeSpiritDamage'), 'spirit');
      fight.addStatus(e, { id: 'pound_toss', duration: this.data.GroundPoundKnockUpDuration, tags: ['stun'], debuff: true });
      fight.addStatus(e, { id: 'pound_slow', duration: this.value('HeavyMeleeSlowDuration'), mods: { slow: this.data.HeavyMeleeSlowPercent / 100 }, debuff: true });
    }
  }
}

// 3. Baba's Brew: a short channel without shooting, then one of three brews at random (his call): Soothing, a barrier on Baba; Silencing, the
// enemies around the front one are silenced (a boss holds its blast, a rival hero can't cast); Scalding, they burn and lose spirit resist.
// T1: wider. T2: shorter cooldown. T3: every brew a third stronger.
const BREWS = ['Soothing', 'Silencing', 'Scalding'];
class BabasBrew extends Ability {
  constructor(...args) {
    super(...args);
    this.burns = []; // [{ e, until, next }]
  }

  get castDelay() { return this.value('AbilityChannelTime'); }
  want(fight) { return fight.foes.length > 0; }

  // A brew's number with tier 3's Brew Effectiveness: the wiki data writes it as a "multiply" upgrade, which Ability.value() would add instead.
  brewed(field) {
    const tier = this.tier;
    this.tier = Math.min(tier, 2);
    try { return this.value(field) * (tier >= 3 ? 1 + this.data.Upgrades[2].BrewEffectiveness / 100 : 1); } finally { this.tier = tier; }
  }

  on(event, fight, p) {
    if (event === 'cast' && p.ability === this) this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
  }

  cast(fight) {
    this.brew = BREWS[Math.min(BREWS.length - 1, Math.floor(fight.rng() * BREWS.length))];
    if (this.brew === 'Soothing') {
      fight.addStatus(this.unit, { id: 'soothing_brew', duration: this.value('BarrierDuration'), barrier: this.brewed('CombatBarrier') });
      return;
    }
    for (const e of fight.near(this.value('Radius'))) {
      if (this.brew === 'Silencing') { fight.addStatus(e, { id: 'silencing_brew', duration: this.brewed('SilenceDuration'), tags: ['silence'], debuff: true }); continue; }
      const duration = this.value('BurnDuration');
      fight.addStatus(e, { id: 'scalding_brew', duration, mods: { spiritResist: this.brewed('SpiritResistReduction') / 100 }, debuff: true });
      this.burns = this.burns.filter((b) => b.e !== e);
      this.burns.push({ e, until: fight.time + duration, next: fight.time + this.data.FireModifier.TickInterval });
    }
  }

  tick(fight) {
    const every = this.data.FireModifier.TickInterval;
    this.burns = this.burns.filter((b) => b.e.alive && b.next <= b.until + 1e-9);
    for (const b of this.burns) {
      if (fight.time + 1e-9 < b.next) continue;
      b.next += every;
      fight.damage(this.unit, b.e, this.brewed('DamagePerSecond') * every, 'spirit');
    }
  }
}

// 4. Feed The Birds: a channel without shooting or casting: the enemies in reach are covered in bread (a slow that builds), and when it ends
// the pigeons hit each of them for spirit damage and turn it into a pigeon for a moment (it can't attack or cast; a boss shrugs part of it off).
// Always the full damage and time: nobody walks out of the bread here. Only her death stops it (the wiki). T1: a stronger slow, further.
// T2: shorter cooldown. T3: more damage, a longer hex.
class FeedTheBirds extends Ability {
  constructor(...args) {
    super(...args);
    this.from = 0;
    this.until = 0;
    this.fed = [];
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Channelling' : super.status(fight); }

  cast(fight) {
    const channel = this.value('AbilityChannelTime');
    this.fed = fight.near(this.value('AbilityCastRange'));
    if (!this.fed.length) return;
    this.from = fight.time;
    this.until = fight.time + channel;
    fight.addStatus(this.unit, { id: 'feeding', duration: channel, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    fight.at(channel, () => fight.running(this, () => {
      const fed = this.fed.filter((e) => e.alive);
      this.fed = [];
      if (!this.unit.alive) return;
      for (const e of fed) {
        fight.damage(this.unit, e, this.value('BarrageMaxDamage'), 'spirit');
        if (e.alive) fight.addStatus(e, { id: 'pigeon', duration: this.value('HexDuration'), tags: ['disarm', 'silence'], debuff: true });
      }
    }));
  }

  tick(fight) {
    if (fight.time >= this.until) return;
    const slow = (this.value('MaxSlow') / 100) * Math.min(1, (fight.time - this.from) / this.data.TimeToMaxStacks);
    for (const e of this.fed.filter((x) => x.alive)) fight.addStatus(e, { id: 'bread', duration: DT * 1.5, mods: { slow }, debuff: true });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Threadsap', 'Weaves a thread that bursts through the enemies, damaging them and stealing their spirit power. While any is held, bullets deal bonus spirit damage.'],
  ['Granny Long Legs', 'The bench stands tall for a while: faster and tougher, with a ground pound that damages, knocks up and slows the enemies around.'],
  ['Baba\'s Brew', 'Throws one of three brews at random: a soothing barrier, a silence, or a scalding burn that lowers spirit resist.'],
  ['Feed The Birds', 'Covers the enemies in bread, then a flock of pigeons bombards them and turns each one into a pigeon for a moment.'],
];

module.exports = { name: 'Baba', abilities: { 1: Threadsap, 2: GrannyLongLegs, 3: BabasBrew, 4: FeedTheBirds }, info };
