// Vyper's abilities (deadlock.wiki/Vyper, checked Oct 5 2026; page updated Sept 30). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. Standing rule used: abilities that only target some kinds of unit in the game work on any enemy here.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');

// 1. Screwjab Dagger: a dagger at the front enemy: spirit damage and a slow; every dagger after the first on the same enemy is a stack: more
// damage and more slow. T1: a third charge. T2: a hit takes bullet resist off, more per stack. T3: more stacks, charges closer together, and a
// hit gives part of the charge's cooldown back.
class ScrewjabDagger extends Ability {
  constructor(...args) {
    super(...args);
    this.stuck = new Map(); // enemy -> { stacks, until }
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    const had = this.stuck.get(e);
    const stacks = had && had.until > fight.time ? Math.min(this.value('MaxStacks'), had.stacks + 1) : 0;
    this.stuck.set(e, { stacks, until: fight.time + this.value('StackDuration') });
    fight.damage(this.unit, e, this.value('Damage') + stacks * this.value('DamagePerStack'), 'spirit');
    fight.addStatus(e, {
      id: 'screwjab', duration: this.value('SlowDuration'), debuff: true,
      mods: { slow: Math.min(0.9, (this.data.SlowPercent + stacks * this.data.SlowPercentPerStack) / 100), bulletResist: (this.value('BulletResistReduction') + stacks * this.value('BulletResistReductionPerStack')) / 100 },
    });
    if (this.value('CooldownRefundPercent') && this.cdLeft > 0) this.cdLeft *= 1 - this.value('CooldownRefundPercent') / 100;
  }
}

// 2. Lethal Venom: venom in the front enemy; after its delay it goes off for spirit damage, between its minimum and maximum by how much health
// the enemy is missing then (the maximum at 30% health or less). It gets through petrified stone. T1: a higher maximum. T2: the envenomed heal
// less, shorter cooldown. T3: bullets build venom up too: a full bar injects it again (one dose in an enemy at a time).
class LethalVenom extends Ability {
  constructor(...args) {
    super(...args);
    this.doses = new Map(); // enemy -> when it goes off
    this.bars = new Map(); // enemy -> build-up, %
  }

  want(fight) { return fight.foes.some((e) => !this.doses.has(e)); }
  inject(fight, e) {
    this.doses.set(e, fight.time + this.data.VenomDuration);
    if (this.value('HealAmpReceivePenaltyPercent')) fight.addStatus(e, { id: 'lethal_venom', duration: this.data.VenomDuration, mods: { healAmp: this.value('HealAmpReceivePenaltyPercent') / 100 }, debuff: true });
  }

  cast(fight) {
    const e = fight.enemies.find((x) => x.alive && !this.doses.has(x)); // petrified or not
    if (e) this.inject(fight, e);
  }

  on(event, fight, p) {
    const per = this.value('BuildUpPerShot');
    if (!per || p.source !== this.unit || !(event === 'bulletHit' || event === 'melee') || !p.target?.alive || this.doses.has(p.target)) return;
    const bar = (this.bars.get(p.target) ?? 0) + per * (p.opts?.landed ?? 1);
    if (bar < 100) { this.bars.set(p.target, bar); return; }
    this.bars.delete(p.target);
    this.inject(fight, p.target);
  }

  tick(fight) {
    for (const [e, at] of this.doses) {
      if (!e.alive) { this.doses.delete(e); continue; }
      if (fight.time + 1e-9 < at) continue;
      this.doses.delete(e);
      const [full, none] = [this.data.VenomMaxDamageHealthPercentage / 100, this.data.VenomMinDamageHealthPercentage / 100];
      const share = Math.min(1, Math.max(0, (none - e.health / e.stats.maxHealth) / (none - full)));
      fight.damage(this.unit, e, this.value('VenomMinDamage') + (this.value('VenomMaxDamage') - this.value('VenomMinDamage')) * share, 'spirit');
    }
  }
}

// 3. Slither (passive): longer slides. T1: longer still. T2: more stamina. T3: a slide gives a barrier, at most once every few seconds.
class Slither extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    this.barrierAt = 0;
  }

  tick(fight) {
    fight.addStatus(this.unit, { id: 'slither', duration: DT * 1.5, mods: { slideScale: this.value('SlideScale') / 100, stamina: this.value('Stamina') } });
  }

  on(event, fight, p) {
    if (event !== 'slide' || p.source !== this.unit || !this.value('CombatBarrier') || fight.time < this.barrierAt) return;
    this.barrierAt = fight.time + this.value('AbilityCooldown');
    fight.addStatus(this.unit, { id: 'slither_barrier', duration: this.value('BuffDuration'), barrier: this.value('CombatBarrier') });
  }
}

// 4. Petrifying Bola: an exploding bola: spirit damage and a slow on the enemies around; the one it hits (the front one) takes more and is
// petrified: turned to stone, it can't act, and nothing can hurt it but venom, so Vyper turns to the others meanwhile. A boss shrugs part of it
// off. T1: more damage. T2: shorter cooldown. T3: longer, and every enemy in the area is petrified.
class PetrifyingBola extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const front = fight.foes[0];
    if (!front) return;
    const all = this.tier >= 3;
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'bola_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
      if (e !== front && !all) continue;
      fight.damage(this.unit, e, this.value('PetrifyDamage'), 'spirit');
      fight.addStatus(e, { id: 'petrified', duration: this.value('PetrifyDuration'), tags: ['stun', 'untargetable'], debuff: true });
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Screwjab Dagger', 'Throws a dagger that damages and slows. More daggers in the same enemy hit harder and slow more.'],
  ['Lethal Venom', 'Injects an enemy with venom that goes off after a delay, for more damage the less health it has left.'],
  ['Slither', 'Slides further.'],
  ['Petrifying Bola', 'Throws an explosive bola that slows and damages the enemies around and turns the one it hits to stone.'],
];

module.exports = { name: 'Vyper', abilities: { 1: ScrewjabDagger, 2: LethalVenom, 3: Slither, 4: PetrifyingBola }, info };
