// Mirage's abilities (deadlock.wiki/Mirage, checked Oct 5 2026; page updated Oct 3). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. His call (Oct 5): Traveler (a teleport across the map in the game) is a way out when hurt, like the
// Doorman's Doorway and Calico's Ava.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');

// 1. Fire Scarabs: scarabs on an enemy that doesn't carry any yet (the front one first): spirit damage every step that heals Mirage for what it
// deals (through the heal cap), and the enemy deals less damage meanwhile. T1: more damage. T2: a third charge, longer. T3: a bigger penalty.
class FireScarabs extends Ability {
  constructor(...args) {
    super(...args);
    this.hosts = new Map(); // enemy -> until
  }

  free(fight) { return fight.foes.find((e) => !this.hosts.has(e)); }
  want(fight) { return !!this.free(fight); }

  cast(fight) {
    const e = this.free(fight) ?? fight.foes[0];
    if (e) this.hosts.set(e, fight.time + this.value('StealDuration'));
  }

  tick(fight, dt) {
    for (const [e, until] of this.hosts) {
      if (!e.alive || fight.time > until + 1e-9) { this.hosts.delete(e); continue; }
      fight.addStatus(e, { id: 'fire_scarabs', duration: DT * 1.5, mods: { damageDealt: this.value('OutgoingDamagePenaltyPercent') / 100 }, debuff: true });
      fight.heal(this.unit, fight.damage(this.unit, e, this.value('DPS') * dt, 'spirit'), 'lifesteal');
    }
  }
}

// 2. Dust Devil: a whirlwind through the enemies in its path: spirit damage, a short lift and a slow; nothing can touch Mirage meanwhile, and
// bullets miss more often for a while after. T2: more evasion. T3: a second whirlwind a moment later.
// ponytail: AGAIN is when the tier 3 recast comes (the game: within 6 s, the player's choice).
const AGAIN = 2;
class DustDevil extends Ability {
  want(fight) { return fight.foes.length > 0; }

  whirl(fight) {
    const travel = this.value('AbilityCastRange') / this.data.TornadoSpeed;
    fight.addStatus(this.unit, { id: 'dust_devil', duration: travel, tags: ['void'] });
    for (const e of fight.near(this.value('AbilityCastRange'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'dust_devil_lift', duration: this.value('HoldInPlaceDuration'), tags: ['stun'], debuff: true });
      fight.addStatus(e, { id: 'dust_devil_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    }
    fight.at(travel, () => { if (this.unit.alive) fight.addStatus(this.unit, { id: 'dust_devil_evasion', duration: this.value('WhirlwindDuration'), mods: { evasion: this.value('WhirlwindEvasionChance') / 100 } }); });
  }

  cast(fight) {
    this.whirl(fight);
    if (this.value('RecastWindow')) fight.at(AGAIN, () => fight.running(this, () => { if (this.unit.alive && !this.unit.cantAct) this.whirl(fight); }));
  }
}

// 3. Djinn's Mark (passive): a shot puts a mark on its target, at most one every ProcCooldown seconds per target. When the marks run out, or at
// once when the last one lands, they go off: the base damage, doubled for every mark after the first. T1: a mark slows. T2: more damage, marks
// last longer. T3: marks come faster, one more of them, and the last one stuns.
class DjinnsMark extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    this.marks = new Map(); // enemy -> { stacks, next, until }
  }

  burst(fight, e) {
    const m = this.marks.get(e);
    this.marks.delete(e);
    if (m?.stacks && e.alive) fight.damage(this.unit, e, this.value('ProcDamageBase') * this.data.DMarkMultiplierPerStack ** (m.stacks - 1), 'spirit');
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || !p.target.alive) return;
    const e = p.target;
    const m = this.marks.get(e) ?? { stacks: 0, next: 0 };
    if (fight.time + 1e-9 < m.next) return;
    m.stacks += 1;
    m.next = fight.time + this.value('ProcCooldown');
    m.until = fight.time + this.value('VictimStackDuration');
    this.marks.set(e, m);
    if (this.value('MovementSpeedSlow')) fight.addStatus(e, { id: 'djinns_mark_slow', duration: this.value('SlowDuration'), mods: { slow: this.value('MovementSpeedSlow') / 100 }, debuff: true });
    if (m.stacks < this.value('MaxStacks')) return;
    fight.addStatus(e, { id: 'djinns_mark_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
    const next = m.next;
    fight.running(this, () => this.burst(fight, e));
    this.marks.set(e, { stacks: 0, next }); // the next mark still waits its turn
  }

  tick(fight) {
    for (const [e, m] of this.marks) if (!e.alive || (m.stacks && fight.time > m.until)) this.burst(fight, e);
  }
}

// 4. Traveler: used when hurt (his call): Mirage teleports out, out of every enemy's reach and not attacking for the wait, and comes back.
// T1: faster and a higher fire rate after. T2: a barrier after. T3: far shorter cooldown.
// ponytail: the barrier lasts as long as tier 1's bonuses (the wiki gives it no time).
const HURT = 0.5;
const BARRIER_FOR = 12;
class Traveler extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT; }

  cast(fight) {
    const away = this.data.TeleportCompletedTime;
    fight.addStatus(this.unit, { id: 'traveler', duration: away, tags: ['void'] });
    fight.at(away, () => {
      if (!this.unit.alive) return;
      fight.addStatus(this.unit, { id: 'traveler_rush', duration: this.value('MovementSpeedBonusDuration'), mods: { moveSpeed: this.value('BonusMoveSpeed'), fireRate: this.value('BonusFireRate') / 100 } });
      if (this.value('CombatBarrier')) fight.addStatus(this.unit, { id: 'traveler_barrier', duration: BARRIER_FOR, barrier: this.value('CombatBarrier') });
    });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Fire Scarabs', 'Infests an enemy with scarabs that steal its life and make it deal less damage.'],
  ['Dust Devil', 'Becomes a whirlwind that damages, lifts and slows the enemies in its path. Bullets miss more often for a while after.'],
  ["Djinn's Mark", 'Shots mark the target. The marks go off together, doubling the damage for every mark.'],
  ['Traveler', 'When hurt, teleports out of the fight for a moment.'],
];

module.exports = { name: 'Mirage', abilities: { 1: FireScarabs, 2: DustDevil, 3: DjinnsMark, 4: Traveler }, info };
