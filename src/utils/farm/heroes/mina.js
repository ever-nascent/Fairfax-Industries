// Mina's abilities (deadlock.wiki/Mina, checked Oct 2 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 2): bites on any enemy grow Nox Nostra for the rest of the fight; Sanguine Retreat slips an enemy's
// blast, and in fights without blasts is used when hurt.
const { Ability } = require('./../ability');
const { isBoss, npcShare } = require('./../items');

// 1. Rake: slashes the enemies in reach for spirit damage plus a share of their missing health, finishes off non-boss enemies left under the
// execute threshold, and heals for every kill. ponytail: the missing-health share is cut against NPCs like the items' health shares (npcShare);
// the float isn't simulated.
class Rake extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    let kills = 0;
    for (const e of fight.near(this.value('AbilityCastRange')).slice(0, this.data.AbilityUnitTargetLimit)) {
      const missing = (e.stats.maxHealth - e.health) * (this.value('MissingHealthDamagePercentage') / 100) * npcShare(e);
      fight.damage(this.unit, e, this.value('Damage') + missing, 'spirit');
      if (e.alive && !isBoss(e) && e.health < this.data.TrooperExecuteThreshold) fight.damage(this.unit, e, e.health, 'true', { events: false });
      if (!e.alive) kills++;
    }
    fight.heal(this.unit, kills * this.value('RakeHealPerKill'));
  }
}

// 2. Sanguine Retreat: disperses, out of everyone's reach (and unable to act) for a moment; every recast adds another moment. Slips an enemy's
// blast as it lands; in a fight without blasts it is used when hurt. T1: fire rate and extra bullets after. T3's range does nothing here.
// ponytail: the recasts follow straight on, as one longer flight.
class SanguineRetreat extends Ability {
  want(fight) {
    return fight.foes.length > 0 && !fight.foes.some((e) => e.stats.blast) && this.unit.health < this.unit.stats.maxHealth * 0.5;
  }

  cast(fight) {
    fight.addStatus(this.unit, { id: 'sanguine_retreat', duration: this.value('AbilityDuration') * (1 + this.value('MaxRecasts')), tags: ['void'] });
    const rate = this.value('BonusFireRate');
    if (rate) fight.addStatus(this.unit, { id: 'sanguine_rush', duration: this.value('BuffDuration'), mods: { fireRate: rate / 100 } });
    this.unit.weapon.clip += this.value('BonusBullets');
  }

  on(event, fight, p) {
    if (event !== 'blast' || p.target !== this.unit || p.parried || p.dodged || !this.ready()) return;
    this.use();
    fight.log.push({ t: +fight.time.toFixed(1), who: this.unit.name, what: this.name });
    this.cast(fight);
    p.dodged = true;
  }
}

// 3. Love Bites (passive): every bullet adds spirit damage. Bullets, Rake and bats fill a bar on the enemy (it empties after a few quiet seconds);
// a full bar is a bite of bonus spirit damage, then that enemy can't be bitten for a while. T1: the bite slows. T3: fire rate after a bite.
// Every bite adds bats to Nox Nostra for the rest of the fight. ponytail: headshot build-up isn't modelled.
class LoveBites extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    this.bars = new Map(); // enemy -> { n (percent), until, readyAt }
  }

  status(fight) {
    const now = fight?.time ?? 0;
    const n = Math.max(0, ...[...this.bars.entries()].filter(([e, b]) => e.alive && b.until > now).map(([, b]) => b.n));
    return `${Math.floor(n)}% Built Up`;
  }

  build(fight, target, percent) {
    if (!target.alive) return;
    const bar = this.bars.get(target) ?? { n: 0, until: 0, readyAt: 0 };
    this.bars.set(target, bar);
    if (fight.time < bar.readyAt) return;
    bar.n = (bar.until > fight.time ? bar.n : 0) + percent;
    bar.until = fight.time + this.data.BuildUpDuration;
    if (bar.n < 100) return;
    bar.n = 0;
    bar.readyAt = fight.time + this.value('PerTargetCooldown');
    fight.damage(this.unit, target, this.value('BonusDamage'), 'spirit', { events: false });
    const slow = this.value('SlowPercent');
    if (slow) fight.addStatus(target, { id: 'love_bites_slow', duration: this.value('SlowDuration'), mods: { slow: slow / 100 }, debuff: true });
    const rate = this.value('BonusFireRate');
    if (rate) fight.addStatus(this.unit, { id: 'love_bites_rush', duration: this.value('BuffDuration'), mods: { fireRate: rate / 100 } });
    this.unit.abilities.find((a) => a instanceof NoxNostra)?.grow();
  }

  on(event, fight, { source, target, opts }) {
    if (source !== this.unit) return;
    if (event === 'bulletHit') {
      fight.damage(this.unit, target, this.value('MagicDamagePerBullet'), 'spirit', { events: false });
      this.build(fight, target, this.data.BuildUpPerShot);
    } else if (event === 'damage' && opts.ability instanceof Rake) this.build(fight, target, this.data.BuildUpPerDagger);
  }
}

// 4. Nox Nostra: a cloud of bats, so many a second, shared out over the enemies in reach: each deals spirit damage (half to bosses, the game's
// "objectives"), silences (a silenced boss holds its blast) and builds Love Bites. T3: each bat also takes a share of current health (capped on bosses).
// ponytail: the bats are shared evenly; the game's lock-on isn't simulated.
class NoxNostra extends Ability {
  constructor(...args) {
    super(...args);
    this.bonus = 0; // bats added by bites, this fight (his call, Oct 2)
    this.left = 0; // bats still to fly
  }

  grow() { this.bonus = Math.min(this.data.BonusBatsMax, this.bonus + this.data.BonusBatsPerProc); }

  want(fight) {
    return fight.foes.length > 0;
  }

  cast() {
    this.left = this.data.BatCount + this.bonus;
  }

  tick(fight, dt) {
    if (this.left <= 0) return;
    const foes = fight.near(this.value('AbilityCastRange'));
    if (!foes.length) return;
    const bats = Math.min(this.left, this.data.BatPerSecond * dt);
    this.left -= bats;
    const each = bats / foes.length;
    const bites = this.unit.abilities.find((a) => a instanceof LoveBites);
    for (const e of foes) {
      const boss = isBoss(e);
      const ofHealth = (e.health * this.value('CurrentHealthPercent')) / 100;
      const perBat = this.value('Damage') * (boss ? this.data.BossDamageScale : 1) + (boss ? Math.min(ofHealth, this.data.CurrentHealthDamageCapToBosses) : ofHealth);
      fight.damage(this.unit, e, perBat * each, 'spirit');
      fight.addStatus(e, { id: 'nox_silence', duration: this.value('DebuffDuration'), tags: ['silence'], debuff: true });
      bites?.build(fight, e, this.data.BuildUpPerBat * this.data.BatEffectiveness * each);
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Rake', 'Slashes nearby enemies, hitting harder the more health they have lost. Heals for every kill.'],
  ['Sanguine Retreat', 'Disperses for a moment, out of every enemy\'s reach. Slips a blast as it lands.'],
  ['Love Bites', 'Bullets deal extra spirit damage, and hits build up to a vicious bite.'],
  ['Nox Nostra', 'Unleashes a cloud of bats that damage and silence enemies. Every bite adds bats for the rest of the fight.'],
];

module.exports = { name: 'Mina', abilities: { 1: Rake, 2: SanguineRetreat, 3: LoveBites, 4: NoxNostra }, info };
