// Seven's abilities (deadlock.wiki/Seven, checked Oct 5 2026; page updated Oct 2). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. Lightning Ball follows his call for Infernus' Flame Dash (Oct 5): enemies here stand still, so the ball
// stays on them for its whole life.
const { Ability } = require('./../ability');
const { isBoss } = require('./../items');
const { HEROES } = require('./../stats');

// 1. Lightning Ball: a ball of lightning on the front enemy for its lifetime: spirit damage every step to everything in its radius.
// T1: a second charge. T2: it slows, and lasts longer. T3: more damage, wider.
class LightningBall extends Ability {
  constructor(...args) {
    super(...args);
    this.balls = []; // when each one fades
  }

  want(fight) { return fight.foes.length > 0; }
  cast(fight) { this.balls.push(fight.time + this.value('MaxLifetime')); }

  tick(fight, dt) {
    this.balls = this.balls.filter((until) => until > fight.time);
    for (let i = 0; i < this.balls.length; i++) {
      for (const e of fight.near(this.value('ShockRadius'))) {
        fight.damage(this.unit, e, this.value('DPS') * dt, 'spirit');
        if (this.value('SlowPercent')) fight.addStatus(e, { id: 'lightning_ball', duration: this.data.MinShockDuration, mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
      }
    }
  }
}

// 2. Static Charge: a charge on the front enemy; after the delay it goes off: spirit damage and a stun to the enemies around.
// T1: shorter cooldown. T2: wider. T3: a longer stun, far more damage.
class StaticCharge extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    fight.at(this.data.ShockDelay, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      for (const e of fight.near(this.value('ShockRadius'))) {
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
        fight.addStatus(e, { id: 'static_charge', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
      }
    }));
  }
}

// 3. Power Surge: for a while every burst of the gun (three bullets) shocks its target for spirit damage, and the shock jumps to the enemies
// near it. T2: faster, more damage. T3: longer, and the shocked lose spirit resist.
class PowerSurge extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.bullets = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Surging' : super.status(fight); }

  cast(fight) {
    this.until = fight.time + this.value('AbilityDuration');
    if (this.value('BonusMoveSpeed')) fight.addStatus(this.unit, { id: 'power_surge', duration: this.value('AbilityDuration'), mods: { moveSpeed: this.value('BonusMoveSpeed') } });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || fight.time > this.until) return;
    if (++this.bullets % HEROES[this.unit.name].Weapon.BulletsPerBurst) return;
    const jumps = fight.near(this.value('ChainRadius')).filter((e) => e !== p.target).slice(0, this.data.ChainCount);
    fight.running(this, () => {
      for (const e of [p.target, ...jumps].filter((x) => x.alive)) {
        fight.damage(this.unit, e, this.value('DamagePerChain'), 'spirit');
        if (this.value('TechResistDebuff')) fight.addStatus(e, { id: 'power_surge_shred', duration: this.value('DebuffDuration'), mods: { spiritResist: this.value('TechResistDebuff') / 100 }, debuff: true });
      }
    });
  }
}

// 4. Storm Cloud: a channel (no shooting or casting): a cloud around Seven that grows from its first radius to its full one, spirit damage
// every interval to every enemy it has reached (half to bosses), and one lightning strike on the front enemy at the start.
// T1: bullet resist while channelling. T2: longer, bigger. T3: more damage.
class StormCloud extends Ability {
  constructor(...args) {
    super(...args);
    this.from = 0;
    this.until = 0;
    this.next = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Channelling' : super.status(fight); }

  cast(fight) {
    const channel = this.value('AbilityChannelTime');
    this.from = fight.time;
    this.until = fight.time + channel;
    this.next = fight.time + this.data.DamageInterval;
    fight.addStatus(this.unit, { id: 'storm_cloud', duration: channel, tags: ['silence'], mods: { bulletResist: this.value('BulletResistOnActive') / 100 } });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    for (const e of fight.near(this.value('LightningStrikeRadius'))) fight.damage(this.unit, e, this.value('LightningStrikeDamage'), 'spirit');
  }

  tick(fight) {
    if (fight.time > this.until + 1e-9 || fight.time + 1e-9 < this.next) return;
    if (this.unit.cantAct) { this.until = 0; this.unit.busyUntil = 0; return; } // interrupted
    this.next += this.data.DamageInterval;
    const [first, full] = [this.value('InitialRadius'), this.value('Radius')];
    const radius = Math.min(full, first + ((full - first) * (fight.time - this.from)) / this.data.ExpandTime);
    const front = fight.foes[0];
    for (const e of fight.foes) {
      if (fight.distance(this.unit, e) + (e.offset ?? 0) - (front.offset ?? 0) > radius) continue;
      fight.damage(this.unit, e, this.value('DPS') * this.data.DamageInterval * (e.team !== 'hero' && isBoss(e) ? this.data.BossDamageScale : 1), 'spirit');
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Lightning Ball', 'Shoots a ball of lightning that keeps damaging everything in its radius.'],
  ['Static Charge', 'Puts a charge on an enemy. After a short delay it stuns and damages the enemies around.'],
  ['Power Surge', 'Powers up the gun: every burst shocks its target, and the shock jumps to enemies nearby.'],
  ['Storm Cloud', 'Channels an expanding storm cloud that damages every enemy it reaches.'],
];

module.exports = { name: 'Seven', abilities: { 1: LightningBall, 2: StaticCharge, 3: PowerSurge, 4: StormCloud }, info };
