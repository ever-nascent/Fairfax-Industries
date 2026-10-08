// Apollo's abilities (deadlock.wiki/Apollo, checked Oct 3 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 3): half of Flawless Advance's stabs are perfect; Riposte parries any enemy's hit and blasts; Sigil's
// tier 2 gives its stamina back for hitting any enemy.
const { Ability } = require('./../ability');

// 1. Disengaging Sigil: a sphere that explodes on the enemies around the front one: spirit damage and a slow. T1: fire rate after. T2: a stamina
// charge back when it hits. T3: a second sigil. ponytail: the leap backwards does nothing here; the recast follows RECAST_AFTER seconds on.
const RECAST_AFTER = 1;
class DisengagingSigil extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    this.explode(fight);
    if (this.value('RecastTime')) fight.at(RECAST_AFTER, () => fight.running(this, () => this.explode(fight)));
  }

  explode(fight) {
    const hit = fight.near(this.value('SigilRadius'));
    if (!this.unit.alive || !hit.length) return;
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'sigil_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    }
    const rate = this.value('BonusFireRate');
    if (rate) fight.addStatus(this.unit, { id: 'sigil_rush', duration: this.value('BuffDuration'), mods: { fireRate: rate / 100 } });
    this.unit.stamina = Math.min(Math.max(0, Math.floor(this.unit.stat('stamina'))), this.unit.stamina + this.value('StaminaToRestore'));
  }
}

// 2. Riposte: never cast on its own. When it is ready, the next hit on Apollo (or an enemy's blast) is parried: it does nothing, the attacker is
// stunned and takes more melee damage for a while (a stunned enemy is one the hero walks up to and melees). T3: lifesteal against it.
// ponytail: the 0.8 s stance and the 0.3 s of invulnerability are just "the next hit".
class Riposte extends Ability {
  want() { return false; }

  on(event, fight, p) {
    const hit = event === 'attacked' && p.target === this.unit && p.opts.attack && p.amount > 0;
    const blast = event === 'blast' && p.target === this.unit && !p.parried && !p.dodged;
    if (!(hit || blast) || !this.ready()) return;
    this.use();
    fight.log.push({ t: +fight.time.toFixed(1), who: this.unit.name, what: this.name });
    if (hit) p.amount = 0; else p.parried = true;
    const foe = p.source;
    fight.addStatus(foe, { id: 'riposte_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
    fight.addStatus(foe, { id: 'riposte_open', duration: this.value('MeleeResistReductionDuration'), mods: { meleeTaken: -this.value('MeleeResistReduction') / 100 }, debuff: true });
    const steal = this.value('TargetLifesteal') / 100;
    if (steal) fight.addStatus(foe, { id: 'riposte_mark', duration: this.value('TargetLifestealDuration'), mods: { lifestealOn: steal, spiritLifestealOn: steal }, debuff: true });
  }
}

// 3. Flawless Advance: lunging stabs through the enemies in a line. In the game the damage is the player's timing; here half the stabs are
// perfect (his call), the rest well held. T1: a perfect stab that hits heals. T2: bullet resist while lunging. T3: more damage.
// ponytail: a stab every STAB_EVERY seconds; the recast window, stacks and bleed numbers the wiki doesn't explain are left out.
const STAB_EVERY = 0.6;
const PERFECT_CHANCE = 0.5;
class FlawlessAdvance extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    for (let i = 0; i < this.data.MaxStabs; i++) fight.at(i * STAB_EVERY, () => fight.running(this, () => this.stab(fight)));
  }

  stab(fight) {
    if (!this.unit.alive || this.unit.cantAct) return;
    const resist = this.value('BulletResist');
    if (resist) fight.addStatus(this.unit, { id: 'advance_guard', duration: this.value('DashBuffDuration'), mods: { bulletResist: resist / 100 } });
    const perfect = fight.rng() < PERFECT_CHANCE;
    const hit = fight.near(this.value('SlashLength'));
    for (const e of hit) fight.damage(this.unit, e, this.value(perfect ? 'PerfectDamage' : 'MaxDamageBeforePerfect'), 'spirit');
    if (perfect && hit.length) fight.heal(this.unit, this.value('HealFixedHealth'));
  }
}

// 4. Itani Lo Sahn: after its charge, a slash through the enemies in reach: they can't act or heal and take far less damage for a moment, Apollo
// can't be hurt meanwhile, and when it ends they take the delayed damage, more below half health. Held until an enemy is that low.
class ItaniLoSahn extends Ability {
  low(e) { return e.health < (e.stats.maxHealth * this.data.LowHealthEnemyThresholdPct) / 100; }

  want(fight) {
    return fight.foes.some((e) => this.low(e));
  }

  cast(fight) {
    const struck = fight.near(this.value('DashRange'));
    const hold = this.data.DebuffDuration;
    for (const e of struck) {
      fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit');
      fight.addStatus(e, { id: 'itani', duration: hold, tags: ['stun'], mods: { healAmp: -1, damageTaken: -this.data.IncomingDamageReductionPercent / 100 }, debuff: true });
    }
    fight.addStatus(this.unit, { id: 'itani_untouchable', duration: hold, mods: { damageTaken: -1 } });
    fight.at(hold + 0.1, () => fight.running(this, () => { // just after the slow motion ends
      for (const e of struck) fight.damage(this.unit, e, this.value('DelayedDamage') * (this.low(e) ? 1 + this.value('BonusDamagePercent') / 100 : 1), 'spirit');
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Disengaging Sigil', 'Draws a sigil that explodes, damaging and slowing the enemies caught in it.'],
  ['Riposte', 'Deflects the next attack, then stuns the attacker and leaves it open to melee.'],
  ['Flawless Advance', 'A series of lunging stabs that pierce every enemy in a line. A perfectly timed stab hits hardest.'],
  ['Itani Lo Sahn', 'A long slash that leaves enemies frozen in slow motion, then deals devastating damage, more to the badly hurt.'],
];

module.exports = { name: 'Apollo', abilities: { 1: DisengagingSigil, 2: Riposte, 3: FlawlessAdvance, 4: ItaniLoSahn }, info };
