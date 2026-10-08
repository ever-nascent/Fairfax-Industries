// Lady Geist's abilities (deadlock.wiki/Lady_Geist, checked Oct 5 2026; page updated that day). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. His calls (Oct 5): what Soul Exchange takes from an enemy is cut against NPCs like
// every health share, and the health she gets from it is not under the heal cap.
const { Ability } = require('./../ability');
const { MELEE } = require('./../engine');
const { npcShare } = require('./../items');
const { stackResist } = require('./../buffs');

// The health an ability costs her: spirit damage her own resist softens, never lethal (the wiki).
function pay(unit, amount) {
  const resist = Math.min(0.9, stackResist(unit.stats.spiritResist, unit.mod('spiritResist')));
  unit.health = Math.max(1, unit.health - amount * (1 - resist));
}

// 1. Essence Bomb: costs her a share of its damage; after it arms, spirit damage around the front enemy. T2: more damage, wider.
// T3: a toxic mess under the enemies it hit: a share of the bomb's damage every second for a while.
class EssenceBomb extends Ability {
  constructor(...args) {
    super(...args);
    this.messes = []; // [{ caught, until, next, dps }]
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const damage = this.value('Damage');
    pay(this.unit, (damage * this.data.SelfDamagePct) / 100);
    fight.at(this.data.ArmingDuration, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      const caught = fight.near(this.value('Radius'));
      for (const e of caught) fight.damage(this.unit, e, damage, 'spirit');
      const spill = this.value('BloodSpillDPSPercent') / 100;
      if (spill) this.messes.push({ caught, until: fight.time + this.value('BloodSpillDuration'), next: fight.time + 1, dps: damage * spill });
    }));
  }

  tick(fight) {
    this.messes = this.messes.filter((m) => m.next <= m.until + 1e-9);
    for (const m of this.messes) {
      if (fight.time + 1e-9 < m.next) continue;
      m.next += 1;
      for (const e of m.caught.filter((x) => x.alive)) fight.damage(this.unit, e, m.dps, 'spirit');
    }
  }
}

// 2. Life Drain: a tether on the front enemy: spirit damage every step, and she heals for what it deals (through the heal cap). She keeps
// shooting. T1: more damage. T2: longer. T3: charges, better spirit scaling (one tether at a time).
class LifeDrain extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0 && fight.time >= this.until; }
  status(fight) { return fight && fight.time < this.until ? 'Draining' : super.status(fight); }
  cast(fight) { this.until = fight.time + this.value('AbilityDuration'); }

  tick(fight, dt) {
    const target = fight.foes[0];
    if (fight.time > this.until + 1e-9 || !target) return;
    const dealt = fight.damage(this.unit, target, this.value('LifeDrainPerSecond') * dt, 'spirit');
    fight.heal(this.unit, (dealt * this.value('LifeDrainHealthMult')) / 100, 'lifesteal');
  }
}

// 3. Malice: costs a share of her current health; blood shards at the front enemy, each spirit damage and a stack of Malice: the enemy takes
// more damage and is slowed, per stack. T2: more damage, more shards. T3: more damage taken per stack.
class Malice extends Ability {
  constructor(...args) {
    super(...args);
    this.stacks = new Map(); // enemy -> stacks
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    pay(this.unit, (this.unit.health * this.data.SelfDamagePct) / 100);
    for (let i = 0; i < this.value('NumBloodShards'); i++) {
      const e = fight.foes[0];
      if (!e) return;
      fight.damage(this.unit, e, this.value('HealthToDamage'), 'spirit');
      const stacks = Math.min(this.data.MaxStacks, (e.statuses.some((s) => s.id === 'malice') ? this.stacks.get(e) ?? 0 : 0) + 1);
      this.stacks.set(e, stacks);
      fight.addStatus(e, { id: 'malice', duration: this.value('DebuffDuration'), mods: { damageTaken: (stacks * this.value('VulnerabilityPerStack')) / 100 }, debuff: true });
      fight.addStatus(e, { id: 'malice_slow', duration: this.value('SlowDuration'), mods: { slow: (stacks * this.data.MoveSpeedPenaltyPerStack) / 100 }, debuff: true });
    }
  }
}

// 4. Soul Exchange: used when hurt and the front enemy is healthier: she walks up and swaps health levels with it (the wiki's rules: the enemy
// first loses 30% of its level; if that is still above hers the levels are swapped, else it only loses that 30% and she gains as much; an enemy
// is never taken below 30%). His calls: what the enemy loses is cut against NPCs like every health share, and her gain is not a capped heal.
// T2: silences the enemies around. T3: spirit power, fire rate and spirit resist for a while.
const HURT = 0.5;
class SoulExchange extends Ability {
  level(u) { return u.health / u.stats.maxHealth; }
  want(fight) { const e = fight.foes[0]; return !!e && this.level(this.unit) < HURT && this.level(e) > this.level(this.unit); }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    const [mine, theirs] = [this.level(this.unit), this.level(e)];
    const taken = this.data.MinHealthTakenPct / 100;
    const floor = this.data.EnemyMinHealthPct / 100;
    const swap = theirs * (1 - taken) > mine;
    const lost = Math.max(0, theirs - Math.max(floor, swap ? mine : theirs * (1 - taken)));
    const gained = swap ? theirs : Math.min(1, mine + theirs * taken);
    e.health -= lost * e.stats.maxHealth * (e.team === 'hero' ? 1 : npcShare(e));
    this.unit.health = Math.max(this.unit.health, gained * this.unit.stats.maxHealth);
    this.unit.close = e;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
    for (const x of fight.near(this.value('SilenceRadius'))) fight.addStatus(x, { id: 'soul_exchange', duration: this.value('SilenceDuration'), tags: ['silence'], debuff: true });
    fight.addStatus(this.unit, {
      id: 'soul_exchange_power', duration: this.value('SelfBuffDuration'),
      mods: { spirit: this.value('BonusSpirit'), fireRate: this.value('BonusFireRate') / 100, spiritResist: this.value('TechResist') / 100 },
    });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Essence Bomb', 'Sacrifices some health to launch a bomb that explodes after a moment.'],
  ['Life Drain', 'Tethers an enemy, draining its health over time and healing.'],
  ['Malice', 'Sacrifices some health for blood shards that slow the enemy and make it take more damage.'],
  ['Soul Exchange', 'When hurt, swaps health levels with a healthier enemy.'],
];

module.exports = { name: 'Lady Geist', abilities: { 1: EssenceBomb, 2: LifeDrain, 3: Malice, 4: SoulExchange }, info };
