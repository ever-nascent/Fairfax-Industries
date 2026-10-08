// Kelvin's abilities (deadlock.wiki/Kelvin, checked Oct 5 2026; page updated Oct 2). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. His calls: ally abilities work on the hero alone (Oct 2); Arctic Beam is used when the gun runs dry, and
// nothing gets in or out of Frozen Shelter: enemies can't hit him and he doesn't attack (Oct 5).
const { Ability } = require('./../ability');

// 1. Frost Grenade: spirit damage and a slow on the enemies around the front one, and a heal for Kelvin (the allies' heal is his own).
// T1: more of both. T2: shorter cooldown (its stamina freeze does nothing here). T3: wider, better spirit scaling.
class FrostGrenade extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'frost_grenade', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    }
    fight.heal(this.unit, this.value('HealAmount'));
  }
}

// 2. Ice Path: faster for a while (a better chance to get out of a blast's way). T1: faster still, and bullet resist. T3: more spirit power.
class IcePath extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    fight.addStatus(this.unit, {
      id: 'ice_path', duration: this.value('AbilityDuration'),
      mods: { moveSpeed: this.value('MoveSpeedBonus'), bulletResist: this.value('BulletResist') / 100, spirit: this.value('BonusSpirit') + (this.unit.stats.spirit * this.value('BonusSpiritPct')) / 100 },
    });
  }
}

// 3. Arctic Beam: a channelled beam on the front enemy, the gun silent meanwhile: spirit damage every tick, and the longer it is held on an
// enemy the slower it moves and attacks (an NPC attacking slower deals that much less damage; a rival hero's gun fires slower). The gun is the
// stronger of the two, so (his call) he beams when the gun runs dry: the beam covers the reload. T1: more of both slows. T2: more damage.
// T3: two more beams on other enemies near the front one.
class ArcticBeam extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.held = new Map(); // enemy -> seconds the beam has been on it
  }

  want(fight) { return fight.foes.length > 0 && this.unit.weapon.reloadLeft > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Beaming' : super.status(fight); }

  cast(fight) {
    const channel = this.value('AbilityDuration');
    this.until = fight.time + channel;
    this.held.clear();
    fight.addStatus(this.unit, { id: 'arctic_beam_channel', duration: channel, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
  }

  tick(fight, dt) {
    if (fight.time > this.until + 1e-9) return;
    if (this.unit.cantAct) { this.until = 0; this.unit.busyUntil = 0; return; } // interrupted
    const front = fight.foes[0];
    if (!front) return;
    const more = fight.near(this.value('BeamSplit')).filter((e) => e !== front).slice(0, this.value('BeamSplitCount'));
    for (const e of [front, ...more]) {
      const held = (this.held.get(e) ?? 0) + dt;
      this.held.set(e, held);
      const ramp = Math.min(1, held / this.data.MaxSlowTime);
      const slower = (-this.value('MaxFireRateSlowPercent') / 100) * ramp;
      fight.damage(this.unit, e, this.value('DPS') * dt, 'spirit');
      fight.addStatus(e, {
        id: 'arctic_beam', duration: this.value('SlowDuration'), debuff: true,
        mods: { slow: (this.value('MaxSlowPercent') / 100) * ramp, ...(e.team === 'hero' ? { fireRate: slower } : { damageDealt: slower }) },
      });
    }
  }
}

// 4. Frozen Shelter: used when hurt: an impenetrable dome around himself. Nothing gets in or out (his call): enemies can't hit him, he doesn't
// attack, and he heals fast (through the heal cap). T2: longer. T3: clears his debuffs, more healing.
const HURT = 0.5;
class FrozenShelter extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT; }

  cast(fight) {
    if (this.value('PurgeOnCast')) fight.cleanse(this.unit);
    fight.addStatus(this.unit, { id: 'frozen_shelter', duration: this.value('AbilityDuration'), tags: ['void'], regen: this.value('BonusHealthRegen') });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Frost Grenade', 'Throws a grenade that explodes in a freezing cloud: damages and slows enemies, and heals.'],
  ['Ice Path', 'Rides a trail of ice for a while, moving faster.'],
  ['Arctic Beam', 'Fires a freezing beam that damages an enemy and makes it move and attack slower the longer it holds.'],
  ['Frozen Shelter', 'When hurt, freezes the air into an impenetrable dome: nothing gets in or out while health comes back fast.'],
];

module.exports = { name: 'Kelvin', abilities: { 1: FrostGrenade, 2: IcePath, 3: ArcticBeam, 4: FrozenShelter }, info };
