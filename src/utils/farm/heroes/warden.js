// Warden's abilities (deadlock.wiki/Warden, checked Oct 5 2026; page updated Sept 30). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. His call (Oct 5): Alchemical Flask's tier 1 (a stamina charge in the game, which only a rival hero
// has) leaves the enemies it hits WINDED seconds from attacking. Standing rules used: hero-only abilities work on any enemy; a weapon damage
// cut takes nothing off an enemy that deals spirit damage and half off a mixed one (the Doorman's bell); an aura around him reaches the
// enemies around the front one.
const { Ability } = require('./../ability');
const { isBoss } = require('./../items');

// 1. Alchemical Flask: spirit damage around the front enemy, a slow, and less weapon damage from the enemies hit for a while.
// T1 (his call): they can't attack for a moment (a rival hero also loses a stamina charge). T2: more damage, a bigger weapon damage cut.
// T3: shorter cooldown, wider, and they attack slower.
const WINDED = 1;
class AlchemicalFlask extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const weaker = this.value('WeaponPowerDebuff') / 100; // negative
    const slower = -this.value('FireRateSlow') / 100;
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'flask_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.MoveSpeedSlowPct / 100 }, debuff: true });
      const mods = e.team === 'hero' ? { weaponDamage: weaker, fireRate: slower }
        : { damageDealt: (1 + (e.stats.damageType === 'spirit' ? 0 : weaker * (e.stats.damageType === 'mixed' ? 0.5 : 1))) * (1 + slower) - 1 }; // weaker hits, and fewer of them
      fight.addStatus(e, { id: 'flask_weak', duration: this.value('DebuffDuration'), mods, debuff: true });
      if (!this.value('StaminaReduction')) continue;
      fight.addStatus(e, { id: 'flask_winded', duration: WINDED, tags: ['disarm'], debuff: true });
      if (e.team === 'hero') e.stamina = Math.max(0, e.stamina - this.value('StaminaReduction'));
    }
  }
}

// 2. Willpower: a barrier and move speed for a while. T1: more speed. T2: far shorter cooldown, longer. T3: debuff resist, a bigger barrier.
class Willpower extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const duration = this.value('AbilityDuration');
    fight.addStatus(this.unit, { id: 'willpower', duration, barrier: this.value('CombatBarrier'), mods: { moveSpeed: (this.unit.stats.moveSpeed * this.value('MoveSpeedBonusPct')) / 100, statusResist: this.value('StatusResistancePercent') / 100 } });
  }
}

// 3. Binding Word: a curse on the front enemy: nothing here walks out of it, so when the escape time is up it takes spirit damage and is
// immobilized (he walks up and melees). T1: it takes more bullet damage for a while. T2: held longer. T3: shorter cooldown, and it is silenced
// from the start.
class BindingWord extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    if (this.value('SilenceDebuff')) fight.addStatus(e, { id: 'binding_word_silence', duration: this.data.EscapeTime, tags: ['silence'], debuff: true });
    fight.at(this.data.EscapeTime, () => fight.running(this, () => {
      if (!e.alive || !this.unit.alive) return;
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'binding_word', duration: this.value('ImmobilizeDuration'), tags: ['immobilize'], debuff: true });
      if (this.value('BulletArmorReduction')) fight.addStatus(e, { id: 'binding_word_open', duration: this.value('BulletArmorReductionDuration'), mods: { bulletTaken: this.value('BulletArmorReduction') / 100 }, debuff: true });
    }));
  }
}

// 4. Last Stand: a charge without shooting or casting, then pulses of spirit damage to the enemies around (half to bosses), healing him for a
// share of the damage (a smaller share from NPCs: the wiki's numbers); bullet and spirit resist from the charge to the last pulse.
// T1: wider. T2: more damage, shorter cooldown. T3: longer, more resist, and he can't be stopped while charging.
class LastStand extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.next = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Standing' : super.status(fight); }

  on(event, fight, p) {
    if (event !== 'cast' || p.ability !== this) return;
    const total = this.castDelay + this.value('AbilityDuration');
    fight.addStatus(this.unit, { id: 'last_stand', duration: total, mods: { bulletResist: this.value('BulletResist') / 100, spiritResist: this.value('TechResist') / 100 } });
    fight.addStatus(this.unit, { id: 'last_stand_charge', duration: this.castDelay, tags: ['silence', ...(this.value('UnstoppableCastDelay') ? ['unstoppable'] : [])] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
  }

  cast(fight) {
    this.until = fight.time + this.value('AbilityDuration');
    this.next = fight.time;
  }

  tick(fight) {
    if (fight.time > this.until + 1e-9 || fight.time + 1e-9 < this.next || this.unit.cantAct) return;
    this.next += this.data.PulseInterval;
    let healing = 0;
    for (const e of fight.near(this.value('Radius'))) {
      const dealt = fight.damage(this.unit, e, this.value('PulseDPS') * this.data.PulseInterval * (e.team !== 'hero' && isBoss(e) ? this.data.BossDamageScale : 1), 'spirit');
      healing += (dealt * this.value(e.team === 'hero' ? 'HealthStealPctHero' : 'HealthStealPct')) / 100;
    }
    fight.heal(this.unit, healing, 'lifesteal');
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Alchemical Flask', 'Throws a flask that damages the enemies around, slows them and cuts their weapon damage.'],
  ['Willpower', 'Gains a barrier and move speed for a while.'],
  ['Binding Word', 'Curses an enemy: a moment later it takes heavy damage and is immobilized.'],
  ['Last Stand', 'Charges up, then releases pulses that damage the enemies around and heal, with heavy resistances meanwhile.'],
];

module.exports = { name: 'Warden', abilities: { 1: AlchemicalFlask, 2: Willpower, 3: BindingWord, 4: LastStand }, info };
