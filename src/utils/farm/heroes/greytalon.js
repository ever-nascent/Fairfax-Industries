// Grey Talon's abilities (deadlock.wiki/Grey_Talon, checked Oct 5 2026; page updated Sept 30). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. His call (Oct 5): Guided Owl's tier 3 execute is cut against NPCs like every health
// share. Guided Owl's spirit power counts any enemy and lasts the fight only, like the other heroes' growing bonuses.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');
const { npcShare } = require('./../items');

const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);

// 1. Charged Shot: after its draw, an arrow through every enemy for spirit damage. It sets off an arming Spirit Snare at once, with more reach.
// T1: a second charge. T2: more damage. T3: better spirit scaling, charges closer together.
class ChargedShot extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    for (const e of fight.foes) fight.damage(this.unit, e, this.value('Damage'), 'spirit');
    find(this.unit, SpiritSnare)?.detonate(fight);
  }
}

// 2. Rain of Arrows: airborne for a while: more damage a bullet, and every shot also hits up to four other enemies (one arrow each). Enemies
// still shoot at him up there. T1: more damage, and the arrows slow. T3: lifesteal, and part of the enemies' bullets miss him.
class RainOfArrows extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Airborne' : super.status(fight); }

  cast(fight) {
    const duration = this.value('AbilityDuration');
    this.until = fight.time + duration;
    fight.addStatus(this.unit, {
      id: 'rain_of_arrows', duration, tags: ['airborne'],
      mods: { bulletDamage: this.value('WeaponDamageBonus'), lifesteal: this.value('BulletLifestealPercent') / 100, spiritLifesteal: this.value('TechLifestealPercent') / 100, evasion: this.value('EvasionPercent') / 100 },
    });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || fight.time > this.until || p.opts.split) return;
    const others = fight.foes.filter((e) => e !== p.target).slice(0, this.data.BulletSplitShot - 1);
    for (const e of others) fight.damage(this.unit, e, p.amount, 'bullet', { split: true, events: false });
    const slow = this.value('SlowPercent') / 100;
    if (slow) for (const e of [p.target, ...others]) fight.addStatus(e, { id: 'rain_slow', duration: this.value('SlowDuration'), mods: { slow }, debuff: true });
  }
}

// 3. Spirit Snare: a trap thrown under the front enemy. Once armed it goes off on the enemies in reach (they don't walk here, so it catches them
// as it arms): a little spirit damage, and a curse: they can't attack, a boss holds its blast, and they are slowed. A Charged Shot sets it off
// early, with more reach. T2: the cursed lose bullet resist. T3: a longer curse, more reach.
class SpiritSnare extends Ability {
  constructor(...args) {
    super(...args);
    this.armed = 0; // when the trap on the ground goes off (0 = none)
  }

  want(fight) { return fight.foes.length > 0; }
  cast(fight) { this.armed = fight.time + this.data.ArmTime; }
  tick(fight) { if (this.armed && fight.time + 1e-9 >= this.armed) this.spring(fight, 1); }
  detonate(fight) { if (this.armed) this.spring(fight, 1 + this.data.ChargedShotHitRadiusScale / 100); }

  spring(fight, reach) {
    if (!fight.foes.length) return; // nobody there yet: it waits
    this.armed = 0;
    for (const e of fight.near(this.value('Radius') * reach)) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'spirit_snare', duration: this.value('TetherDuration'), tags: ['silence', 'disarm'], mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
      if (this.value('BulletArmorReduction')) fight.addStatus(e, { id: 'snare_shred', duration: this.value('DebuffDuration'), mods: { bulletResist: this.value('BulletArmorReduction') / 100 }, debuff: true });
    }
  }
}

// 4. Guided Owl: he stops shooting for the cast, then the owl hits: spirit damage around the front enemy and a stun. Every enemy that dies within
// KILL_WINDOW seconds of the hit (the wiki's note) adds spirit power for the rest of the fight. T3: after the hit, an enemy below a share of its
// health dies (pure damage; his call: the share is cut against NPCs like every health share).
// ponytail: the owl lands when the cast ends; the wiki gives no owl speed.
const KILL_WINDOW = 4;
class GuidedOwl extends Ability {
  constructor(...args) {
    super(...args);
    this.kills = 0;
    this.hit = []; // [{ e, until }] enemies the owl hit, while their death still counts
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    for (const e of fight.near(this.value('ExplosionRadius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      const below = (this.value('LowHealthEnemyThresholdPct') / 100) * (e.team === 'hero' ? 1 : npcShare(e));
      if (e.alive && e.health < e.stats.maxHealth * below) fight.damage(this.unit, e, e.health, 'true');
      fight.addStatus(e, { id: 'guided_owl', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
      this.hit.push({ e, until: fight.time + KILL_WINDOW });
    }
  }

  tick(fight) {
    this.kills += this.hit.filter((h) => !h.e.alive).length;
    this.hit = this.hit.filter((h) => h.e.alive && h.until > fight.time);
    if (this.kills) fight.addStatus(this.unit, { id: 'owl_spirit', duration: DT * 1.5, mods: { spirit: this.kills * this.data.BonusTechPowerPerKill } });
  }

  on(event, fight, p) {
    if (event !== 'cast' || p.ability !== this) return;
    fight.addStatus(this.unit, { id: 'owl_cast', duration: this.castDelay, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Charged Shot', 'Draws a powerful arrow that pierces through every enemy.'],
  ['Rain of Arrows', 'Takes to the air for a while: more weapon damage, and every shot also hits other enemies.'],
  ['Spirit Snare', 'Throws a trap that curses the enemies around it: they cannot attack and are slowed.'],
  ['Guided Owl', 'Launches a spirit owl that explodes, damaging and stunning enemies. Each kill it sets up adds spirit power for the fight.'],
];

module.exports = { name: 'Grey Talon', abilities: { 1: ChargedShot, 2: RainOfArrows, 3: SpiritSnare, 4: GuidedOwl }, info };
