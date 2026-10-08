// Haze's abilities (deadlock.wiki/Haze). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does.
const { Ability } = require('./../ability');

// 1. Sleep Dagger: damages and sleeps the target; a sleeper wakes shortly after being hurt. Doesn't break stealth.
class SleepDagger extends Ability {
  // any enemy still standing and awake, picked at random (not always the first one)
  pick(fight) {
    const pool = fight.enemies.filter((e) => e.alive && !e.has('sleep'));
    return pool[Math.floor(fight.rng() * pool.length)];
  }

  want(fight) {
    return !!this.pick(fight);
  }

  cast(fight) {
    const target = this.pick(fight);
    if (!target) return;
    fight.damage(this.unit, target, this.value('Damage'), 'spirit', { keepsStealth: true, noWake: true });
    fight.addStatus(target, {
      id: 'sleep', duration: this.value('SleepDuration'), tags: ['sleep'],
      wakeOnDamage: this.value('SleepWakeUpDelay'),
    });
    const fixation = this.unit.abilities.find((a) => a instanceof Fixation);
    if (fixation && this.value('FixationStacks')) fixation.addStacks(fight, target, this.value('FixationStacks')); // T2
    const shred = this.value('BulletResistReduction'); // T1: -10% bullet resist for 6 s (starts at wake-up in game)
    if (shred) fight.addStatus(target, { id: 'dagger_shred', duration: this.value('BulletResistReductionDuration'), mods: { bulletResist: shred / 100 } });
  }
}

// 2. Smoke Bomb: invisible, enemies can't target her. Attacking ends it (and she is seen for 1.5 s after being hit
// or attacking). T2: a second charge (ability.js charges). T3: dispel + bullet lifesteal after.
class SmokeBomb extends Ability {
  want(fight) {
    return fight.enemies.some((e) => e.alive) && this.unit.health < this.unit.stats.maxHealth * 0.5; // an escape, when hurt
  }

  cast(fight) {
    fight.addStatus(this.unit, { id: 'smoke', duration: this.value('AbilityDuration'), tags: ['invisible'], mods: { moveSpeed: this.value('InvisMoveSpeedMod') } }); // T1: faster while unseen
    if (this.value('BulletLifesteal')) {
      fight.addStatus(this.unit, { id: 'smoke_lifesteal', duration: this.value('AbilityDuration') + this.value('PostInvisBuffDuration'), mods: { lifesteal: this.value('BulletLifesteal') / 100 } });
    }
  }

  on(event, fight, { source, target, opts }) {
    if (event !== 'damage') return;
    if (source === this.unit && !opts.keepsStealth && this.unit.has('invisible')) this.reveal(fight);
    if (target === this.unit && this.unit.has('invisible')) this.reveal(fight);
  }

  reveal(fight) {
    fight.removeStatus(this.unit, 'smoke');
    fight.addStatus(this.unit, { id: 'revealed', duration: this.value('RevealOnDamageDuration'), tags: ['revealed'] });
  }
}

// 3. Fixation (passive): every bullet that hits adds a stack on that target (6 s, refreshed); each stack adds
// 0.2% weapon damage, reduced by falloff like the hit itself. T1: every 20 stacks, spirit damage. T2: +40 max
// stacks, +5 s. T3: +0.11% per stack. ponytail: headshots (3 stacks) aren't modelled; "0.2 /stack" is taken as a percent.
class Fixation extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    this.stacks = new Map(); // enemy -> { n, until }
  }

  // The most stacks on any enemy right now (the live message shows it).
  status(fight) {
    const now = fight?.time ?? 0;
    const n = Math.max(0, ...[...this.stacks.values()].filter((s) => s.until > now).map((s) => s.n));
    return `${n} Stacks`;
  }

  addStacks(fight, target, n) {
    const cur = this.stacks.get(target);
    const before = cur && cur.until > fight.time ? cur.n : 0;
    const now = Math.min(this.value('MaxStacks'), before + n);
    this.stacks.set(target, { n: now, until: fight.time + this.value('AbilityDuration') });
    const every = this.value('ProcDamageStackCount');
    if (every && Math.floor(now / every) > Math.floor(before / every)) {
      fight.damage(this.unit, target, this.value('ProcDamage'), 'spirit', { events: false });
    }
  }

  on(event, fight, { source, target, amount, opts }) {
    if (event !== 'bulletHit' || source !== this.unit || opts.fixation) return;
    const cur = this.stacks.get(target);
    if (cur && cur.until > fight.time && cur.n > 0) {
      // extra weapon damage = the stacks' percent of the hit (already falloff'd), resisted like any bullet
      const bonus = (amount * cur.n * this.value('DamageBonusFixedPerStack')) / 100;
      fight.damage(this.unit, target, bonus, 'bullet', { events: false, fixation: true });
    }
    this.addStacks(fight, target, 1);
  }
}

// 4. Bullet Dance: a 3.5 s channel with +25% fire rate, +7% weapon damage, 30% evasion, never reloading.
// ponytail: "perfect accuracy at nearby enemies" is already how the engine shoots; no slide / channel movement.
class BulletDance extends Ability {
  want(fight) {
    const target = fight.enemies.find((e) => e.alive);
    return !!target && target.health > 0 && this.unit.health < this.unit.stats.maxHealth * 0.7;
  }

  cast(fight) {
    fight.addStatus(this.unit, {
      id: 'bullet_dance', duration: this.value('AbilityDuration'), tags: ['infiniteClip'],
      mods: {
        fireRate: this.value('BonusFireRate') / 100, weaponDamage: this.value('WeaponDamageBonus') / 100,
        evasion: this.value('EvasionPercent') / 100,
      },
    });
  }
}

// What the hero pick (/base) shows: each ability's general description, in slot order (the 4th is her Ultimate).
// ponytail: written by hand from the wiki's ability text; the wiki has no short form to read. No pronouns, on purpose.
const info = [
  ['Sleep Dagger', 'Throws a dagger that damages and puts the target to sleep. Throwing it does not break invisibility.'],
  ['Smoke Bomb', 'Fades out of sight, invisible and faster. Attacking breaks it.'],
  ['Fixation', 'Every bullet that hits adds a stack, raising damage against that target.'],
  ['Bullet Dance', 'A short flurry of fire at nearby enemies with perfect accuracy and bonus damage.'],
];

module.exports = { name: 'Haze', abilities: { 1: SleepDagger, 2: SmokeBomb, 3: Fixation, 4: BulletDance }, info, Fixation };
