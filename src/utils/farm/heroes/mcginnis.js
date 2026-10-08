// McGinnis' abilities (deadlock.wiki/McGinnis, checked Oct 5 2026; page updated Oct 3). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. Ally abilities work on the hero alone (his call, Oct 2): the Specter heals her.
// Her turrets are not units: they are kept on Mini Turret, deal her damage and can't be hurt (taken by me: enemies only shoot at her).
const { Ability, spinUp } = require('./../ability');
const { isBoss } = require('./../items');
const { HEROES } = require('./../stats');

const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);

// 1. Mini Turret: a turret that shoots the front enemy for spirit damage until its time is up; less to NPCs and far less to bosses (the wiki's
// "troopers and objectives"). T1: more damage. T2: two more charges. T3: it fires faster and lasts longer.
// The gun's own rule lives here too (slot 1 is never locked): it spins up while she fires, from the stat sheet's fire rate to the wiki's fire
// rate at full spin over 2 s, and winds down while she doesn't (a reload).
class MiniTurret extends Ability {
  constructor(...args) {
    super(...args);
    this.turrets = []; // [{ until, next }]
    this.spin = 0; // 0-1
  }

  want(fight) { return fight.foes.length > 0; }
  deploy(fight, lifetime) { this.turrets.push({ until: fight.time + lifetime, next: fight.time + this.data.TurretDeployTime + this.data.TickRate }); }
  cast(fight) { this.deploy(fight, this.value('TurretLifetime')); }

  tick(fight, dt) {
    const u = this.unit;
    spinUp(this, HEROES[u.name].Weapon, fight, dt);

    this.turrets = this.turrets.filter((t) => t.until > fight.time);
    for (const t of this.turrets) {
      const e = fight.foes[0];
      if (!e || fight.time + 1e-9 < t.next) continue;
      t.next = fight.time + this.data.TickRate;
      const share = e.team === 'hero' ? 1 : (isBoss(e) ? this.data.BossDamagePercentOutgoing : this.data.NonHeroDamagePercentOutgoing) / 100;
      fight.damage(u, e, ((this.value('TurretDPS') * this.value('AttackSpeedMult')) / 100) * this.data.TickRate * share, 'spirit');
    }
  }
}

// 2. Medicinal Specter: used when hurt: a spirit that heals her every second for a while (through the heal cap).
// T2: faster stamina. T3: a share of max health a second on top, and spirit resist.
const HURT = 0.75;
class MedicinalSpecter extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT; }

  cast(fight) {
    fight.addStatus(this.unit, {
      id: 'medicinal_specter', duration: this.value('AbilityDuration'),
      regen: this.value('ExternalBonusHealthRegen') + (this.unit.stats.maxHealth * this.value('MaxHealthRegenPct')) / 100,
      mods: { spiritResist: this.value('SpiritResist') / 100, staminaRegen: this.value('StaminaCooldownReduction') / 100 },
    });
  }
}

// 3. Spectral Wall: the wall erupts among the enemies: spirit damage and a slow to those around the front one. (The wall itself, which splits
// the ground in the game, does nothing here.) T1: they take more damage for a while. T3: two Mini Turrets by the wall, a stronger slow.
class SpectralWall extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    for (const e of fight.near(this.data.WallImpactRange * this.unit.range)) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'spectral_wall', duration: this.value('SlowDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
      if (this.value('BonusDamagePercent')) fight.addStatus(e, { id: 'spectral_wall_amp', duration: this.value('DebuffDuration'), mods: { damageTaken: this.value('BonusDamagePercent') / 100 }, debuff: true });
    }
    const turrets = find(this.unit, MiniTurret);
    for (let i = 0; turrets && i < this.value('CreateTurrets'); i++) turrets.deploy(fight, this.value('TurretLifeTime'));
  }
}

// 4. Heavy Barrage: a channelled volley (no shooting or casting): rockets land on the front enemy one after another, each spirit damage to
// everything around it, half to bosses. T1: the rockets slow. T2: longer. T3: more damage, wider.
class HeavyBarrage extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.loaded = 0; // rockets due
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Firing' : super.status(fight); }

  cast(fight) {
    const channel = this.value('AbilityDuration');
    this.until = fight.time + channel;
    this.loaded = 0;
    fight.addStatus(this.unit, { id: 'heavy_barrage', duration: channel, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
  }

  tick(fight, dt) {
    if (fight.time > this.until + 1e-9) return;
    if (this.unit.cantAct) { this.until = 0; this.unit.busyUntil = 0; return; } // interrupted
    this.loaded += this.data.GrenadesPerSecond * dt;
    for (; this.loaded >= 1 - 1e-9; this.loaded -= 1) {
      for (const e of fight.near(this.value('ExplosionRadius'))) {
        fight.damage(this.unit, e, this.value('DamagePerRocket') * (e.team !== 'hero' && isBoss(e) ? this.data.BossDamageScale : 1), 'spirit');
        if (this.value('MoveSlowPercent')) fight.addStatus(e, { id: 'heavy_barrage_slow', duration: this.value('MoveSlowDuration'), mods: { slow: this.value('MoveSlowPercent') / 100 }, debuff: true });
      }
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Mini Turret', 'Deploys a turret that keeps shooting the enemy for a while.'],
  ['Medicinal Specter', 'When hurt, deploys a spirit that heals over time.'],
  ['Spectral Wall', 'Erupts a wall among the enemies, damaging and slowing them.'],
  ['Heavy Barrage', 'Unleashes a long volley of rockets on the enemies.'],
];

module.exports = { name: 'McGinnis', abilities: { 1: MiniTurret, 2: MedicinalSpecter, 3: SpectralWall, 4: HeavyBarrage }, info };
