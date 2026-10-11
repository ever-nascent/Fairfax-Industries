// Bebop's abilities (deadlock.wiki/Bebop, checked Oct 3 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 3, Oct 11): Sticky Bomb grows with any enemy it hits or kills, kept for good (ability.js KEEP); Grapple Arm's
// tier 2 (range, which does nothing here) stuns the hooked enemy for a moment instead. "On hero hit" effects work on any enemy.
const { Ability, KEEP, keptStacks, keptOf } = require('./../ability');
const { MELEE } = require('./../engine');
const { isBoss } = require('./../items');

// 1. Exploding Uppercut: punches the front enemy (melee damage) and launches it; where it lands, the other enemies around take spirit damage
// and hit less hard for a while. T2: more weapon damage after a hit. T3: a hit makes Grapple Arm ready again and heals part of the missing health.
class ExplodingUppercut extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const target = fight.foes[0];
    if (!target) return;
    fight.damage(this.unit, target, this.value('UppercutDamage'), 'melee', { melee: true });
    fight.addStatus(target, { id: 'uppercut_toss', duration: this.data.TossDuration, tags: ['stun'], debuff: true }); // in the air
    fight.at(this.data.TossDuration, () => fight.running(this, () => {
      for (const e of fight.near(this.value('OnLandDamageRadius')).filter((x) => x !== target)) {
        fight.damage(this.unit, e, this.value('LandingDamage'), 'spirit');
        fight.addStatus(e, { id: 'uppercut_jam', duration: this.value('ExplodeDebuffDuration'), mods: { damageDealt: this.value('BonusFireRate') / 100 }, debuff: true });
      }
    }));
    const weapon = this.value('BuffBaseWeaponPct');
    if (weapon) fight.addStatus(this.unit, { id: 'uppercut_power', duration: this.value('UppercutBuffOnHit'), mods: { weaponDamage: weapon / 100 } });
    if (this.value('RestoreHookCooldown')) this.unit.abilities.find((a) => a instanceof GrappleArm)?.refresh();
    fight.heal(this.unit, ((this.unit.stats.maxHealth - this.unit.health) * this.value('MissingHPHeal')) / 100);
  }
}

// 2. Sticky Bomb: sticks to the front enemy and explodes after its fuse (at once if that enemy dies): spirit damage around it. Every enemy a
// bomb hits or kills makes the next ones stronger, kept for good like the game (his calls, Oct 3 and Oct 11; any enemy counts), half as fast after
// OnHitDiminish hits / OnKillDiminish kills, and nothing past HIT_CAP hits / KEEP.cap kills. The damage is set when the bomb is thrown. T3: speed and debuff resist on cast.
const HIT_CAP = 120; // his call, Oct 11
class StickyBomb extends Ability {
  constructor(...args) {
    super(...args);
    const kept = keptOf(this, 'Bebop'); // kept from earlier fights
    this.hits = Math.min(HIT_CAP, kept.hits ?? 0);
    this.kills = Math.min(KEEP.cap, kept.kills ?? 0);
    this.bombs = []; // { target, at, damage }
  }

  get bonus() {
    return (keptStacks(this.hits, this.data.OnHitDiminish, HIT_CAP) * this.value('BonusDamagePctPerPlayerHit') + keptStacks(this.kills, this.data.OnKillDiminish) * this.value('BonusDamagePctPerPlayerKilled')) / 100;
  }

  keep() { return { hits: this.hits, kills: this.kills }; }
  keptText() { return this.hits || this.kills ? `${this.name}: ${this.hits} hits and ${this.kills} kills, +${Math.round(this.bonus * 100)}% bomb damage` : null; }

  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const target = fight.foes[0];
    if (!target) return;
    this.bombs.push({ target, at: fight.time + this.data.FuseTime, damage: this.value('Damage') * (1 + this.bonus) });
    const speed = this.value('MovementSpeedBonus');
    if (speed) fight.addStatus(this.unit, { id: 'bomb_rush', duration: this.value('MovementSpeedBonusDuration'), mods: { moveSpeed: speed, statusResist: this.value('StatusResistancePercent') / 100 } });
  }

  tick(fight) {
    const due = this.bombs.filter((b) => !b.target.alive || fight.time >= b.at - 1e-9);
    if (!due.length) return;
    this.bombs = this.bombs.filter((b) => !due.includes(b));
    for (const bomb of due) {
      const spot = bomb.target.offset ?? 0;
      for (const e of fight.enemies.filter((x) => x.alive && Math.abs((x.offset ?? 0) - spot) <= this.value('Radius'))) {
        if (fight.damage(this.unit, e, bomb.damage, 'spirit') > 0) this.hits = Math.min(HIT_CAP, this.hits + 1);
        if (!e.alive) this.kills = Math.min(KEEP.cap, this.kills + 1);
      }
    }
  }
}

// 3. Grapple Arm: hooks the enemy standing furthest back and pulls it up to the front one (a boss isn't moved), for melee damage and a slow;
// Bebop stands close to it for a moment. T1: it takes more bullet damage. T2: it can't act for a moment (his call: the tier's range does nothing here).
class GrappleArm extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const foes = fight.foes;
    const target = foes.at(-1);
    if (!target) return;
    if (!isBoss(target)) target.offset = foes[0].offset ?? 0;
    fight.damage(this.unit, target, this.value('Damage'), 'melee', { melee: true });
    fight.addStatus(target, { id: 'hook_slow', duration: this.data.RestrictionDuration, mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    if (this.tier >= 2) fight.addStatus(target, { id: 'hook_stun', duration: this.data.RestrictionDuration, tags: ['stun'], debuff: true });
    const amp = this.value('BulletAmp');
    if (amp) fight.addStatus(target, { id: 'hook_amp', duration: this.value('BulletAmpDuration'), mods: { bulletTaken: amp / 100 }, debuff: true });
    this.unit.close = target;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
  }
}

// 4. Hyper Beam: after its wind-up, a long beam through every enemy: spirit damage and a slow (less to bosses, the game's "objectives"). The gun
// is silent while it lasts. T3: the beam heals Bebop for a share of its damage (less from NPCs than from a hero).
class HyperBeam extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) {
    return fight.foes.length > 0;
  }

  status(fight) {
    return fight && fight.time < this.until ? 'Beaming' : super.status(fight);
  }

  cast(fight) {
    this.until = fight.time + this.value('AbilityChannelTime');
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
  }

  tick(fight, dt) {
    if (fight.time > this.until + 1e-9) return;
    if (this.unit.cantAct) { this.until = 0; this.unit.busyUntil = 0; return; } // interrupted
    for (const e of fight.near(this.value('BeamLength'))) {
      const dealt = fight.damage(this.unit, e, this.value('DPS') * dt * (isBoss(e) ? this.data.BossDamageScale : 1), 'spirit');
      fight.addStatus(e, { id: 'beam_slow', duration: this.data.SlowTargetDuration, mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
      fight.heal(this.unit, (dealt * this.value(e.team === 'hero' ? 'BeamLifesteal' : 'BeamLifestealNonHeroPercent')) / 100, 'lifesteal');
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Exploding Uppercut', 'Launches an enemy into the air. Where it lands, the enemies around take damage and hit less hard.'],
  ['Sticky Bomb', 'Attaches a bomb that explodes after a short fuse. Every enemy it hits or kills makes the next bombs stronger for good.'],
  ['Grapple Arm', 'Launches a mechanical hand that pulls an enemy in close.'],
  ['Hyper Beam', 'Channels a torrent of energy through every enemy in its path, damaging and slowing them.'],
];

module.exports = { HIT_CAP, name: 'Bebop', abilities: { 1: ExplodingUppercut, 2: StickyBomb, 3: GrappleArm, 4: HyperBeam }, info };
