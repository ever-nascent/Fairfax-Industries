// Lash's abilities (deadlock.wiki/Lash, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value(); this file
// is only what each ability does. His calls (Oct 5): a Grapple sets up a Ground Strike dive from DIVE metres (there is no height in these fights);
// Death Slam's tier 1 (a longer throw, useless here) leaves the slammed enemies THROWN seconds from getting back into the fight.
const { Ability } = require('./../ability');
const { isBoss } = require('./../items');

const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);
// How far to either side of the front enemy a cone of `angle` degrees reaches, from where the hero stands.
const coneReach = (fight, unit, angle) => (fight.foes[0] ? fight.distance(unit, fight.foes[0]) * Math.tan((angle * Math.PI) / 360) * unit.range : 0);

// 1. Ground Strike: a stomp on the enemies in reach; after a Grapple it is a dive, with more damage for every metre fallen.
// T2: a knock-up and a slow. T3: the per-metre damage x2.2 (the wiki's "+120%").
const DIVE = 10; // metres a Grapple lifts him. ponytail: a placeholder, his to tune
class GroundStrike extends Ability {
  constructor(...args) {
    super(...args);
    this.height = 0; // set by Grapple, used up by the next strike
  }

  want(fight) { return fight.foes.length > 0; }

  perMetre() {
    const base = this.data.StompDamagePerMeterPrimary;
    return (base.Value + base.Scale.Value * this.spirit()) * (this.tier >= 3 ? this.data.Upgrades[2].StompDamagePerMeterPrimary.Value : 1);
  }

  cast(fight) {
    const damage = this.value('StompDamage') + this.height * this.perMetre();
    this.height = 0;
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, damage, 'spirit');
      fight.addStatus(e, { id: 'ground_strike_toss', duration: this.value('TossDuration'), tags: ['stun'], debuff: true });
      if (this.value('EnemySlowPct')) fight.addStatus(e, { id: 'ground_strike_slow', duration: this.value('SlowDuration'), mods: { slow: this.value('EnemySlowPct') / 100 }, debuff: true });
    }
  }
}

// 2. Grapple: pulls himself into the air when Ground Strike is ready, so that strike is a dive. T2: more damage a bullet for a while.
// T3: a second charge, and a stamina charge back.
class Grapple extends Ability {
  want(fight) {
    const strike = find(this.unit, GroundStrike);
    return fight.foes.length > 0 && !!strike && strike.ready() && !strike.height;
  }

  cast(fight) {
    const strike = find(this.unit, GroundStrike);
    if (strike) strike.height = DIVE;
    fight.addStatus(this.unit, { id: 'grapple', duration: 1, tags: ['airborne'] });
    if (this.value('WeaponDamageBonus')) fight.addStatus(this.unit, { id: 'grapple_rush', duration: this.value('WeaponDamageBonusDuration'), mods: { bulletDamage: this.value('WeaponDamageBonus') } });
    this.unit.stamina = Math.min(Math.max(0, Math.floor(this.unit.stat('stamina'))), this.unit.stamina + this.value('RestoreStaminaOnUse'));
  }
}

// 3. Flog: a whip through the enemies in a cone in front of him: spirit damage, healing him for a share of it (a smaller share from NPCs: the
// wiki's own numbers). T1: a slow. T2: they attack slower (an NPC deals that much less; a rival's gun fires slower). T3: more damage, wider.
class Flog extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    let healing = 0;
    const slower = -this.value('FireRateSlow') / 100;
    for (const e of fight.near(coneReach(fight, this.unit, this.value('TargetingConeAngle')))) {
      healing += (fight.damage(this.unit, e, this.value('Damage'), 'spirit') * this.value(e.team === 'hero' ? 'HealPctVsHeroes' : 'HealPctVsNonHeroes')) / 100;
      const mods = { slow: this.value('EnemySlowPct') / 100, ...(e.team === 'hero' ? { fireRate: slower } : { damageDealt: slower }) };
      fight.addStatus(e, { id: 'flog', duration: this.value('EnemySlowDuration'), mods, debuff: true });
    }
    fight.heal(this.unit, healing);
  }
}

// 4. Death Slam: a channel (no shooting or casting) that latches whips on the enemies in a cone; then they are lifted and stunned, and slammed
// down: spirit damage and a slow to them and anything around the front one. A boss isn't lifted but takes the slam. T1 (his call): they land
// further off and can't attack for THROWN seconds more. T3: the slam stuns, and the cone is wider.
const THROWN = 1;
class DeathSlam extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Channelling' : super.status(fight); }

  cast(fight) {
    const channel = this.value('AbilityChannelTime');
    const lift = this.data.HangTime + this.data.BoostTime;
    this.until = fight.time + channel;
    fight.addStatus(this.unit, { id: 'death_slam_channel', duration: channel, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    fight.at(channel, () => fight.running(this, () => {
      if (!this.unit.alive || this.unit.cantAct) return; // interrupted
      const wider = this.tier >= 3 ? this.data.Upgrades[2].AbilityCastRange : 0;
      const lifted = fight.near(coneReach(fight, this.unit, this.data.LockonConeAngle) + wider);
      for (const e of lifted) if (e.team === 'hero' || !isBoss(e)) fight.addStatus(e, { id: 'death_slam_lift', duration: lift, tags: ['stun'], debuff: true });
      fight.at(lift, () => fight.running(this, () => {
        for (const e of new Set([...lifted.filter((x) => x.alive), ...fight.near(this.value('ImpactRadius'))])) {
          fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit');
          fight.addStatus(e, { id: 'death_slam_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
          fight.addStatus(e, { id: 'death_slam_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
          if (this.tier >= 1 && lifted.includes(e) && e.team !== 'hero' && !isBoss(e)) fight.addStatus(e, { id: 'death_slam_thrown', duration: THROWN, tags: ['disarm'], debuff: true });
        }
      }));
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Ground Strike', 'Stomps the ground, damaging the enemies in front. After a Grapple it is a dive that hits harder.'],
  ['Grapple', 'Pulls up into the air, setting up a diving Ground Strike.'],
  ['Flog', 'Strikes the enemies in front with a whip, healing for part of the damage.'],
  ['Death Slam', 'Latches whips onto the enemies ahead, lifts them and slams them into the ground.'],
];

module.exports = { name: 'Lash', abilities: { 1: GroundStrike, 2: Grapple, 3: Flog, 4: DeathSlam }, info };
