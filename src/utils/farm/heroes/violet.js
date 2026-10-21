// Violet's abilities (deadlock.wiki/Violet, checked Oct 20 2026; released Oct 16). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. Standing rules used: "on hero hit" is any enemy; a buff that lasts the match lasts the rest of the fight.
// Taken by me (say if wrong): Flow State's brush is always flicked once it has travelled long enough for its full damage, and she rides its trail
// the whole time it lasts; Still Life sketches the front enemy, she doesn't shoot while she draws, and a sketch from a non-hero (or a hero the wiki's
// table leaves out) gives one of the four buffs at random; Abstract Landscape reaches the enemies within its radius of the front one, and each touches
// a wall once when it forms (with T3, the ink isn't destroyed, so once more when it ends).
// Not simulated: Living Ink's Draw (a wall that blocks shots), steering the ink, Flow State's trail for allies, the vision block and reveal.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');

const around = (fight, target, radius) => fight.foes.filter((e) => Math.abs((e.offset ?? 0) - (target.offset ?? 0)) <= radius);
const forever = (fight, unit, id, mods) => fight.addStatus(unit, { id, duration: Infinity, mods });

// 1. Living Ink: her next shots come alive: more weapon damage, a splash of spirit damage around the enemy hit, and every hit takes time off all
// her ability cooldowns (half as much off her items'). Her fire rate is slower while the ink is loaded. Two charges.
// T1: shorter cooldown. T2: each empower stacks fire rate for a while. T3: more of both damages, more cooldown off a hit.
class LivingInk extends Ability {
  constructor(...args) {
    super(...args);
    this.shots = 0;
    this.until = 0;
    this.stacks = []; // [when each fire rate stack runs out] (T2)
  }

  want(fight) { return fight.foes.length > 0 && !this.shots; }
  status(fight) { return this.shots ? `${this.shots} Ink Shots` : super.status(fight); }

  cast(fight) {
    this.shots = this.data.MaxShots;
    this.until = fight.time + this.value('AbilityDuration');
    if (this.value('MaxStacks')) this.stacks = [...this.stacks, fight.time + this.value('StackDuration')].slice(-this.value('MaxStacks'));
  }

  tick(fight) {
    if (fight.time >= this.until) this.shots = 0;
    this.stacks = this.stacks.filter((t) => t > fight.time);
    const fireRate = (this.shots ? -this.data.FireRateSlow : 0) + this.stacks.length * this.value('BonusFireRatePerStack');
    if (fireRate) fight.addStatus(this.unit, { id: 'living_ink', duration: DT * 1.5, mods: { fireRate: fireRate / 100 } });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || p.opts.split || !this.shots) return;
    this.shots--;
    const u = this.unit;
    fight.damage(u, p.target, p.amount * (this.value('BulletDamageMultiplier') / 100 - 1), 'bullet', { events: false });
    for (const e of around(fight, p.target, this.value('Radius'))) fight.damage(u, e, this.value('Damage'), 'spirit');
    const cut = this.value('CooldownReductionPerHit');
    for (const a of u.abilities) a.cdLeft = Math.max(0, a.cdLeft - cut);
    for (const it of u.items) it.cdLeft = Math.max(0, it.cdLeft - cut / 2);
  }
}

// 2. Flow State: she drags a brush through the enemies and flicks it once it has gone far enough for its full damage: spirit damage and a fading
// slow on the enemies within the flick's reach of the front one. Meanwhile she slides along its trail. T1: stamina comes back faster while on the
// trail. T2: shorter cooldown, a wider flick, a longer trail. T3: on the trail she builds up damage dealt, kept a while after.
class FlowState extends Ability {
  constructor(...args) {
    super(...args);
    this.trail = { from: 0, until: 0 };
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.trail.until ? 'Sliding' : super.status(fight); }

  cast(fight) {
    const length = this.value('GroundAuraDuration');
    this.trail = { from: fight.time, until: fight.time + length };
    fight.addStatus(this.unit, { id: 'flow_trail', duration: length, tags: ['sliding'], mods: { staminaRegen: this.value('StaminaCooldownReduction') / 100 } });
    fight.emit('slide', { source: this.unit });
    fight.at(this.data.MaxDamageTime, () => fight.running(this, () => {
      if (!this.unit.alive || !fight.foes.length) return;
      for (const e of fight.near(this.value('ExplosionRadius'))) {
        fight.damage(this.unit, e, this.value('MaxDamage'), 'spirit');
        fight.addStatus(e, { id: 'flow_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.FadingSlowPercent / 100 }, debuff: true });
      }
    }));
  }

  tick(fight) {
    const amp = this.value('OutgoingDamagePercent');
    if (!amp || fight.time >= this.trail.until) return;
    const built = Math.min(1, (fight.time - this.trail.from) / this.value('DamageAmpBuildDuration'));
    fight.addStatus(this.unit, { id: 'flow_amp', duration: this.value('DamageAmpDuration'), mods: { damageDealt: (amp / 100) * built } });
  }
}

// 3. Still Life: she draws the front enemy within reach: spirit damage every moment she keeps drawing (she can't shoot meanwhile), then a burst of
// spirit damage and a stun. The subject drops a sketch she picks up: one of four buffs for the rest of the fight, by the hero sketched (the wiki's
// table). The sketch breaks off if the subject dies or she is stunned. T1: health regen on the cast, refreshed on a pickup. T2: the subject deals
// less damage while drawn. T3: shorter cooldown, a longer stun, faster while drawing.
const SKETCHES = { // the wiki's table (Oct 20)
  weapon: ['Deadman Danny', 'Grey Talon', 'Holliday', 'Infernus', 'Ivy', 'Mina', 'Paradox', 'Venator', 'Vindicta', 'Wraith'],
  spirit: ['Baba', 'Celeste', 'The Doorman', 'Dynamo', 'Graves', 'Lady Geist', 'McGinnis', 'Paige', 'Rem', 'Seven', 'Sinclair', 'Solomon', 'Violet', 'Viscous'],
  health: ['Abrams', 'Bebop', 'Billy', 'Kelvin', 'Mo & Krill', 'Rat King', 'Shiv', 'Silver', 'Victor', 'Warden'],
  speed: ['Apollo', 'Calico', 'Drifter', 'Haze', 'Lash', 'Mirage', 'Pocket', 'Vyper', 'Yamato'],
};
const SKETCH = { weapon: 0.04, spirit: 3, health: 20, speed: 0.19 }; // +4% weapon damage, +3 spirit power, +20 max health, +0.19 m/s (the wiki)
class StillLife extends Ability {
  constructor(...args) {
    super(...args);
    this.subject = null;
    this.until = 0;
    this.sketches = 0;
  }

  pick(fight) { const e = fight.foes[0]; return e && fight.distance(this.unit, e) <= this.value('AbilityCastRange') ? e : null; }
  want(fight) { return !!this.pick(fight); }
  status(fight) { return this.subject ? 'Drawing' : this.sketches ? `${super.status(fight)}  -  ${this.sketches} sketched` : super.status(fight); }

  cast(fight) {
    this.subject = this.pick(fight);
    if (!this.subject) return;
    this.until = fight.time + this.value('AbilityChannelTime');
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    this.regen(fight);
  }

  regen(fight) { if (this.value('HealthRegen')) fight.regen(this.unit, 'still_life_regen', this.value('HealthRegen'), this.value('BuffDuration')); }
  stop(fight) { this.unit.busyUntil = Math.min(this.unit.busyUntil, fight.time); this.subject = null; }

  tick(fight, dt) {
    const e = this.subject;
    if (!e) return;
    const u = this.unit;
    if (!e.alive || u.cantAct || u.has('stun')) { this.stop(fight); return; }
    fight.damage(u, e, this.value('DPS') * dt, 'spirit');
    if (this.value('OutgoingDamagePercent')) fight.addStatus(e, { id: 'still_life_subject', duration: DT * 1.5, mods: { damageDealt: this.value('OutgoingDamagePercent') / 100 }, debuff: true });
    if (this.value('BonusMoveSpeedPercent')) fight.addStatus(u, { id: 'still_life_speed', duration: DT * 1.5, mods: { moveSpeed: (u.stats.moveSpeed * this.value('BonusMoveSpeedPercent')) / 100 } });
    if (fight.time + 1e-9 < this.until) return;
    this.stop(fight);
    if (!e.alive) return;
    fight.damage(u, e, this.value('Damage'), 'spirit');
    if (e.alive) fight.addStatus(e, { id: 'still_life_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
    this.sketch(fight, e);
  }

  sketch(fight, e) {
    const u = this.unit;
    const kinds = Object.keys(SKETCHES);
    const kind = kinds.find((k) => e.team === 'hero' && SKETCHES[k].includes(e.name)) ?? kinds[Math.floor(fight.rng() * kinds.length)];
    this.sketches++;
    if (kind === 'health') u.addMaxHealth(SKETCH.health);
    else forever(fight, u, `sketch_${this.sketches}`, { weapon: { weaponDamage: SKETCH.weapon }, spirit: { spirit: SKETCH.spirit }, speed: { moveSpeed: SKETCH.speed } }[kind]);
    fight.log.push({ t: +fight.time.toFixed(1), who: u.name, what: `Sketched ${e.name}` });
    this.regen(fight);
  }
}

// 4. Abstract Landscape: a ring of ink around her and the enemies: she gains spirit power while it stands, and each enemy within its radius of the
// front one touches a wall: spirit damage, silence and a slow. T1: shorter cooldown. T2: more spirit power, and spirit lifesteal. T3: a longer
// silence, a longer ring, and the ink isn't destroyed by a touch, so each enemy touches it again as it ends.
class AbstractLandscape extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  get castDelay() { return this.value('AbilityChannelTime'); }
  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? `${Math.ceil(this.until - fight.time)}s Left` : super.status(fight); }

  cast(fight) {
    const length = this.value('AbilityDuration');
    this.until = fight.time + length;
    fight.addStatus(this.unit, { id: 'landscape', duration: length, mods: { spirit: this.value('TechPower'), spiritLifesteal: this.value('AbilityLifestealPercentHero') / 100 } });
    const inside = fight.near(this.value('GroveRadius'));
    this.walls(fight, inside);
    if (this.value('DestroyOnDamage') <= 0) fight.at(length, () => fight.running(this, () => this.walls(fight, inside.filter((e) => e.alive))));
  }

  walls(fight, hit) {
    if (!this.unit.alive) return;
    const silence = this.value('SilenceDuration');
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      if (!e.alive) continue;
      fight.addStatus(e, { id: 'landscape_silence', duration: silence, tags: ['silence'], debuff: true });
      fight.addStatus(e, { id: 'landscape_slow', duration: silence, mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Living Ink', 'The next shots come to life: more damage, a splash of ink, and every hit takes time off all ability cooldowns.'],
  ['Flow State', 'Drags a brush through the enemies and flicks it at them for spirit damage and a slow, sliding along its trail.'],
  ['Still Life', 'Sketches an enemy, damaging it while drawing, then stuns it. Each sketch picked up gives a permanent buff for the fight.'],
  ['Abstract Landscape', 'Paints a ring of ink that grants spirit power. Enemies touching its walls take damage, are silenced and slowed.'],
];

module.exports = { name: 'Violet', abilities: { 1: LivingInk, 2: FlowState, 3: StillLife, 4: AbstractLandscape }, info };
