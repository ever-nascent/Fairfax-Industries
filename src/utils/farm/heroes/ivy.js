// Ivy's abilities (deadlock.wiki/Ivy, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value(); this file
// is only what each ability does. His calls: ally abilities work on the hero alone (Oct 2); Kudzu Connection gives half its bonuses, the game's
// own rule for Ivy with no connection (Oct 5).
const { Ability } = require('./../ability');
const { DT } = require('./../engine');

// 1. Entangling Thorns: a patch under the front enemy: the enemies in it take spirit damage every tick and are slowed while it lasts.
// T1: a second charge. T2: wider, better spirit scaling. T3: after a while in the thorns they are immobilized (she walks up and melees).
class EntanglingThorns extends Ability {
  constructor(...args) {
    super(...args);
    this.patches = []; // [{ caught, until, next, root }]
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const root = this.value('EntangleDuration') ? fight.time + this.value('TimeToEntangle') : Infinity;
    this.patches.push({ caught: fight.near(this.value('Radius')), until: fight.time + this.value('AbilityDuration'), next: fight.time + this.data.TickRate, root });
  }

  tick(fight) {
    this.patches = this.patches.filter((p) => p.next <= p.until + 1e-9);
    for (const p of this.patches) {
      if (fight.time + 1e-9 < p.next) continue;
      p.next += this.data.TickRate;
      const held = fight.time + 1e-9 >= p.root;
      if (held) p.root = Infinity;
      for (const e of p.caught.filter((x) => x.alive)) {
        fight.damage(this.unit, e, this.value('DPS') * this.data.TickRate, 'spirit');
        fight.addStatus(e, { id: 'thorns_slow', duration: this.data.TickRate * 2, mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
        if (held) fight.addStatus(e, { id: 'thorns_root', duration: this.value('EntangleDuration'), tags: ['immobilize'], debuff: true });
      }
    }
  }
}

// 2. Kudzu Connection: with no ally to connect to, the game gives Ivy half its bonuses (his call: that rule): fire rate and bullet lifesteal for a
// while. No replicated healing: there is nobody to copy it from. T1: move speed. T2: more of both. T3: always on.
const SOLO = 0.5;
class KudzuConnection extends Ability {
  get passive() { return this.tier >= 3; } // always on: no cooldown, never cast
  want(fight) { return fight.foes.length > 0; }
  status(fight) { return this.passive ? 'Always On' : super.status(fight); }

  connect(fight, duration) {
    fight.addStatus(this.unit, {
      id: 'kudzu', duration,
      mods: { fireRate: (this.value('BonusFireRate') / 100) * SOLO, lifesteal: (this.value('BulletLifestealPercent') / 100) * SOLO, moveSpeed: this.value('MoveSpeedBonus') * SOLO },
    });
  }

  cast(fight) { this.connect(fight, this.value('AbilityDuration')); }
  tick(fight) { if (this.passive) this.connect(fight, DT * 1.5); }
}

// 3. Stone Form: impervious stone for a moment (nothing can target her, and she doesn't attack), then she smashes down: spirit damage and a stun
// around the front enemy, and a heal of a share of her max health. T1: a bigger heal. T3: a longer stun, better spirit scaling.
class StoneForm extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const lift = this.data.LiftTime;
    fight.addStatus(this.unit, { id: 'stone_form', duration: lift, tags: ['void'] });
    fight.at(lift, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      for (const e of fight.near(this.value('Radius'))) {
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
        fight.addStatus(e, { id: 'stone_form_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
      }
      fight.heal(this.unit, (this.unit.stats.maxHealth * this.value('MaxHealthRegen')) / 100);
    }));
  }
}

// 4. Air Drop: nobody to carry, so she flies solo and drops a bomb: spirit damage in a wide area, then more damage dealt for a while.
// T1: a barrier when she lands. T2: the enemies hit are slowed. T3: and silenced; better spirit scaling.
// ponytail: the bomb lands at once and the flight isn't simulated; the barrier lasts as long as the damage bonus (the wiki gives it no time).
class AirDrop extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    for (const e of fight.near(this.value('OnLandDamageRadius'))) {
      fight.damage(this.unit, e, this.value('ExplodeDamage'), 'spirit');
      if (this.value('SlowPercent')) fight.addStatus(e, { id: 'air_drop_slow', duration: this.value('DebuffDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
      fight.addStatus(e, { id: 'air_drop_silence', duration: this.value('SilenceDuration'), tags: ['silence'], debuff: true });
    }
    const duration = this.value('BuffDuration');
    fight.addStatus(this.unit, { id: 'air_drop', duration, mods: { damageDealt: this.data.AirDropOutgoingDamagePercent / 100 } });
    if (this.value('AirDropBulletShield')) fight.addStatus(this.unit, { id: 'air_drop_barrier', duration, barrier: this.value('AirDropBulletShield') });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Entangling Thorns', 'Summons a patch of choking thorns that damages and slows the enemies in it.'],
  ['Kudzu Connection', 'Gains fire rate and bullet lifesteal for a while.'],
  ['Stone Form', 'Turns to impervious stone and smashes down, stunning and damaging nearby enemies and healing.'],
  ['Air Drop', 'Takes flight and drops a bomb on the enemies, then deals more damage for a while.'],
];

module.exports = { name: 'Ivy', abilities: { 1: EntanglingThorns, 2: KudzuConnection, 3: StoneForm, 4: AirDrop }, info };
