// Dynamo's abilities (deadlock.wiki/Dynamo, checked Oct 3 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 3): Quantum Entanglement's tier 1 (range, useless here) makes enemies lose him for a second after he
// returns. Ally parts work on Dynamo alone (his earlier call).
const { Ability } = require('./../ability');
const { MELEE } = require('./../engine');
const { isBoss, npcShare } = require('./../items');

// 1. Kinetic Pulse: a pulse along the ground through the enemies in reach: spirit damage and a knock-up. T1: a second charge.
// T2: the enemies hit lose bullet resist and are slowed.
class KineticPulse extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    for (const e of fight.near(this.value('StompRange'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'pulse_toss', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
      fight.addStatus(e, { id: 'pulse_shred', duration: this.value('SlowDuration'), mods: { bulletResist: this.value('BulletResistReduction') / 100, slow: this.value('SlowPercent') / 100 }, debuff: true });
    }
  }
}

// 2. Quantum Entanglement: gone for a moment (can't be targeted, doesn't attack) and a stamina charge back. Like Mina's Sanguine Retreat it slips
// an enemy's blast as it lands; in a fight without blasts it is used when hurt. T1 (his call): enemies can't find him for LOST more seconds after
// he is back. T3: halves the debuffs on him and gives Kinetic Pulse a charge back.
const LOST = 1;
const HURT = 0.5;
class QuantumEntanglement extends Ability {
  want(fight) {
    return fight.foes.length > 0 && !fight.foes.some((e) => e.stats.blast) && this.unit.health < this.unit.stats.maxHealth * HURT;
  }

  cast(fight) {
    const away = this.value('AbilityDuration');
    fight.addStatus(this.unit, { id: 'entangled', duration: away, tags: ['void'] });
    this.unit.stamina = Math.min(Math.max(0, Math.floor(this.unit.stat('stamina'))), this.unit.stamina + this.data.StaminaRestore);
    if (this.tier >= 1) fight.at(away, () => fight.addStatus(this.unit, { id: 'entangled_lost', duration: LOST, tags: ['untargetable'] }));
    const cleanse = this.value('ReduceDebuffs');
    if (cleanse) fight.cleanse(this.unit, cleanse / 100);
    if (this.value('ChargeReplenish')) {
      const pulse = this.unit.abilities.find((a) => a instanceof KineticPulse);
      if (pulse?.maxCharges > 1) pulse.charges += 1; else if (pulse) pulse.cdLeft = 0;
    }
  }

  on(event, fight, p) {
    if (event !== 'blast' || p.target !== this.unit || p.parried || p.dodged || !this.ready()) return;
    this.use();
    fight.log.push({ t: +fight.time.toFixed(1), who: this.unit.name, what: this.name });
    this.cast(fight);
    p.dodged = true;
  }
}

// 3. Rejuvenating Aurora: used when hurt: a channel that heals him every second (through the heal cap). He can dash and melee but not shoot or
// cast meanwhile. T1: faster for a while. T3: no channel at all, and a share of max health a second on top.
const AURORA_AT = 0.6;
class RejuvenatingAurora extends Ability {
  want(fight) {
    return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * AURORA_AT;
  }

  cast(fight) {
    const duration = this.value('AbilityChannelTime');
    const free = this.value('NoChannel') > 0;
    const perSecond = this.value('HealingPerSecond') + (this.unit.stats.maxHealth * this.value('HealMaxHealthPercent')) / 100;
    fight.addStatus(this.unit, { id: 'aurora', duration, regen: perSecond, tags: free ? [] : ['silence'] });
    if (!free) this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + duration);
    const speed = this.value('MovementSpeedBonus');
    if (speed) fight.addStatus(this.unit, { id: 'aurora_speed', duration: this.value('MovementSpeedBonusDuration'), mods: { moveSpeed: speed } });
  }
}

// 4. Singularity: a channel that pulls the enemies around the front one in to him (a boss isn't moved), stuns them and deals spirit damage
// every tick. He can't shoot or cast meanwhile. T3: a share of their max health a second on top (cut against NPCs like every health share).
class Singularity extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.next = 0;
    this.ticks = 0; // damage ticks still to come
    this.caught = [];
  }

  want(fight) {
    return fight.foes.length > 0;
  }

  status(fight) { return fight && fight.time < this.until ? 'Channelling' : super.status(fight); }

  cast(fight) {
    const channel = this.value('AbilityChannelTime');
    this.caught = fight.near(this.value('VacuumRadius'));
    const front = fight.foes[0];
    if (!front) return;
    for (const e of this.caught) {
      if (!isBoss(e)) e.offset = front.offset ?? 0;
      fight.addStatus(e, { id: 'singularity', duration: channel, tags: ['stun'], debuff: true });
    }
    this.until = fight.time + channel;
    this.next = fight.time + this.data.TickRate;
    this.ticks = Math.round(channel / this.data.TickRate);
    fight.addStatus(this.unit, { id: 'singularity_channel', duration: channel, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    this.unit.close = front;
    this.unit.closeUntil = this.until + MELEE.closeFor;
  }

  tick(fight) {
    if (!this.ticks || fight.time + 1e-9 < this.next) return;
    if (this.unit.cantAct) { this.ticks = 0; this.until = 0; this.unit.busyUntil = 0; return; } // interrupted
    this.ticks--;
    this.next += this.data.TickRate;
    for (const e of this.caught.filter((x) => x.alive)) {
      const ofHealth = ((e.stats.maxHealth * this.value('DPSPercentHealth')) / 100) * (e.team === 'hero' ? 1 : npcShare(e));
      fight.damage(this.unit, e, (this.value('DPS') + ofHealth) * this.data.TickRate, 'spirit');
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Kinetic Pulse', 'Releases a pulse along the ground that damages enemies and knocks them into the air.'],
  ['Quantum Entanglement', 'Vanishes for a moment, out of every enemy\'s reach. Slips a blast as it lands.'],
  ['Rejuvenating Aurora', 'Channels a healing aurora when hurt, restoring health over time.'],
  ['Singularity', 'Creates a singularity that pulls nearby enemies in, stuns them and damages them over time.'],
];

module.exports = { name: 'Dynamo', abilities: { 1: KineticPulse, 2: QuantumEntanglement, 3: RejuvenatingAurora, 4: Singularity }, info };
