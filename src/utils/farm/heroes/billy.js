// Billy's abilities (deadlock.wiki/Billy, checked Oct 3 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 3): Billy swings the bat for the usual reasons and always while Blasted; Rising Ram hits anything.
const { Ability } = require('./../ability');
const { DT, MELEE } = require('./../engine');
const { isBoss } = require('./../items');

// 1. Bashdown: slams the bat down: melee damage on the enemies right in front, then a shockwave of spirit damage that knocks up the ones around.
// It is a melee hit for Blasted (a light one; T3: a heavy one, dealing a share of heavy melee damage instead). T2: a second charge.
class Bashdown extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const heavy = this.value('CountsAsHeavyMelee') > 0;
    const blasted = this.unit.abilities.find((a) => a instanceof Blasted);
    for (const e of fight.near(this.value('AbilityCastRange'))) {
      fight.damage(this.unit, e, this.value('MeleeDamage') + this.value('HeavyMeleeDamage'), 'melee', { melee: true });
      blasted?.struck(fight, e, heavy);
    }
    fight.at(this.data.ExplodeDelay, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      for (const e of fight.near(this.value('WaveEndRadius'))) {
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
        fight.addStatus(e, { id: 'bashdown_toss', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
      }
    }));
  }
}

// 2. Rising Ram: charges into the front enemy for spirit damage and lifts it (it can't act meanwhile); the impact gives half the cooldown back.
// T1: weapon damage after. T3: more max health for a while. Hits anything (his call; the game: not objectives).
class RisingRam extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const target = fight.foes[0];
    if (!target) return;
    fight.damage(this.unit, target, this.value('Damage'), 'spirit');
    fight.addStatus(target, { id: 'ram_lift', duration: this.value('AbilityDuration'), tags: ['stun'], debuff: true });
    this.cdLeft *= 1 - this.data.ReduceCooldownOnHitPct / 100;
    const burst = this.value('WeaponDamageBurst');
    if (burst) fight.addStatus(this.unit, { id: 'ram_power', duration: this.value('WeaponDamageBurstDuration'), mods: { weaponDamage: burst / 100 } });
    const health = this.value('MaxHealthBuffPct');
    if (health && !this.boost) { // one at a time: a second ram only keeps the first going
      this.boost = (this.unit.stats.maxHealth * health) / 100;
      this.unit.stats.maxHealth += this.boost;
      fight.heal(this.unit, this.boost);
      fight.at(this.value('MaxHealthBuffDuration'), () => { this.unit.addMaxHealth(-this.boost); this.boost = 0; });
    }
  }
}

// 3. Blasted. Passive: a melee hit gives ammo back (a heavy one the whole clip, a light one a share) and leaves the enemy Wrecked. Active: bullets
// hit Wrecked enemies harder, and every melee hit adds max health for a while and extends Blasted, up to its max duration. Billy swings the bat
// for the usual reasons only (his call, Oct 5, undoing "always while Blasted" from Oct 3: it made him by far the strongest hero). Hits on non-heroes give a quarter of the health and time (the game's own NonPlayerResourceScalePct).
class Blasted extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.cap = 0;
  }

  active(fight) { return fight.time < this.until; }
  status(fight) { return fight && this.active(fight) ? `${Math.ceil(this.until - fight.time)}s Left` : super.status(fight); }

  want(fight) {
    return fight.foes.length > 0 && !this.active(fight);
  }

  cast(fight) {
    this.until = fight.time + this.value('AbilityDuration');
    this.cap = fight.time + this.data.MaxDuration;
    if (this.value('GainSlamOnUse')) { // T2: a Bashdown charge
      const slam = this.unit.abilities.find((a) => a instanceof Bashdown);
      if (slam?.maxCharges > 1) slam.charges += 1; else if (slam) slam.cdLeft = 0;
    }
  }

  tick(fight) {
    const speed = this.value('BonusMoveSpeed');
    if (speed && this.active(fight)) fight.addStatus(this.unit, { id: 'blasted_speed', duration: DT * 1.5, mods: { moveSpeed: speed } });
  }

  // One melee hit by Billy on `target` (the engine's heavy melee, or Bashdown).
  struck(fight, target, heavy) {
    const w = this.unit.weapon;
    if (heavy) { w.clip = this.unit.stats.clip; w.reloadLeft = 0; } else if (w.reloadLeft > 0) w.reloadLeft *= 1 - this.data.BulletsReloadedPerLightMeleePct / 100;
    else w.clip = Math.min(this.unit.stats.clip, w.clip + Math.ceil((this.unit.stats.clip * this.data.BulletsReloadedPerLightMeleePct) / 100));
    fight.addStatus(target, { id: 'wrecked', duration: this.data.BulletDamageAmpDuration, tags: ['wrecked'], debuff: true });
    if (!this.active(fight)) return;
    const share = (target.team === 'hero' ? 1 : this.data.NonPlayerResourceScalePct / 100) * (heavy ? 1 : this.data.LightMeleeScalePct / 100);
    const health = this.value('MaxHealthMelee') * share;
    this.unit.stats.maxHealth += health; // the health that comes with it is a heal like any other (the heal cap applies), not free health
    fight.heal(this.unit, health);
    fight.at(this.value('HealthBoostDuration'), () => this.unit.addMaxHealth(-health));
    this.until = Math.min(this.cap, this.until + this.value(heavy ? 'DurationPerHeavyMelee' : 'DurationPerLightMelee') * (target.team === 'hero' ? 1 : this.data.NonPlayerResourceScalePct / 100));
  }

  on(event, fight, p) {
    if (p.source !== this.unit) return;
    if (event === 'melee') this.struck(fight, p.target, true);
    else if (event === 'bulletHit' && !p.opts.blasted && this.active(fight) && p.target.has('wrecked')) {
      fight.damage(this.unit, p.target, (p.amount * this.value('BulletDamageAmp')) / 100, 'bullet', { events: false, blasted: true });
    }
  }
}

// 4. Chain Gang: chains the enemies in reach (slowed), and after a moment yanks them all up to Billy for spirit damage (a boss isn't moved).
// Billy keeps fighting meanwhile. T1: bullet and spirit resist while it lasts. T3: Unstoppable for a moment per enemy pulled.
class ChainGang extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const chained = fight.near(this.value('AbilityCastRange'));
    const hold = this.data.AbilityDuration;
    for (const e of chained) fight.addStatus(e, { id: 'chain_slow', duration: hold, mods: { slow: this.data.MoveSpeedSlowMaxPct / 100 }, debuff: true });
    const resist = this.value('BulletResist');
    if (resist) fight.addStatus(this.unit, { id: 'chain_guard', duration: hold, mods: { bulletResist: resist / 100, spiritResist: this.value('TechResist') / 100 } });
    fight.at(hold, () => fight.running(this, () => {
      const front = fight.foes[0];
      const pulled = chained.filter((e) => e.alive);
      if (!this.unit.alive || !front || !pulled.length) return;
      for (const e of pulled) {
        if (!isBoss(e)) e.offset = front.offset ?? 0;
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      }
      const unstoppable = this.value('UnstoppablePerHero') * pulled.length;
      if (unstoppable) fight.addStatus(this.unit, { id: 'chain_unstoppable', duration: unstoppable, tags: ['unstoppable'] });
      this.unit.close = front;
      this.unit.closeUntil = fight.time + MELEE.closeFor;
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Bashdown', 'Slams the bat into the ground, dealing melee damage and sending out a shockwave that knocks enemies up.'],
  ['Rising Ram', 'Charges head-first into an enemy and sends it into the air.'],
  ['Blasted', 'Melee hits give ammo back and leave enemies Wrecked. While active, bullets hit Wrecked enemies harder and melee hits add max health.'],
  ['Chain Gang', 'Chains nearby enemies, then yanks them all in and damages them.'],
];

module.exports = { name: 'Billy', abilities: { 1: Bashdown, 2: RisingRam, 3: Blasted, 4: ChainGang }, info };
