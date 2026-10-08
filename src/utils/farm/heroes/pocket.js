// Pocket's abilities (deadlock.wiki/Pocket, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. Standing rules used: "on hero hit" is any enemy; an ability the gun has to stop for is used when the gun
// runs dry (his call for Kelvin's beam): Enchanter's Satchel, which also finishes the reload at once (the wiki).
const { Ability } = require('./../ability');
const { isBoss } = require('./../items');

// 1. Barrage: a channel (no shooting) launching projectiles one after another at the front enemy: spirit damage and a slow around where each
// lands. Every projectile that hits anything is a stack of more damage dealt by Pocket for a while; casting again starts the stacks over.
// T1: more damage. T2: shorter cooldown. T3: more per stack, wider.
class Barrage extends Ability {
  constructor(...args) {
    super(...args);
    this.left = 0; // projectiles still to launch
    this.next = 0;
    this.stacks = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return this.left ? 'Channelling' : super.status(fight); }

  cast(fight) {
    this.left = this.data.ProjectileAmount;
    this.next = fight.time;
    this.stacks = 0;
    fight.removeStatus(this.unit, 'barrage_amp');
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.data.AbilityChannelTime);
  }

  tick(fight) {
    if (!this.left || fight.time + 1e-9 < this.next) return;
    if (this.unit.cantAct) { this.left = 0; return; } // interrupted
    this.left -= 1;
    this.next += this.data.AbilityChannelTime / this.data.ProjectileAmount;
    const hit = fight.near(this.value('Radius'));
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('DamagePerProjectile'), 'spirit');
      fight.addStatus(e, { id: 'barrage_slow', duration: this.value('SlowDuration'), mods: { slow: this.data.MoveSlowPercent / 100 }, debuff: true });
    }
    if (!hit.length) return;
    this.stacks += 1;
    fight.addStatus(this.unit, { id: 'barrage_amp', duration: this.value('AmpDuration'), mods: { damageDealt: (this.stacks * this.value('AmpPercentPerStack')) / 100 } });
  }
}

// 2. Flying Cloak: a cloak that flies through the enemies, spirit damage to each one in its path. (Teleporting to it isn't simulated.)
// T1: more damage. T2: more damage a bullet for a while. T3: shorter cooldown.
class FlyingCloak extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    for (const e of fight.foes) fight.damage(this.unit, e, this.value('Damage'), 'spirit');
    if (this.value('WeaponDamageBonus')) fight.addStatus(this.unit, { id: 'flying_cloak', duration: this.value('WeaponDamageBonusDuration'), mods: { bulletDamage: this.value('WeaponDamageBonus') } });
  }
}

// 3. Enchanter's Satchel: used when the gun runs dry: into the suitcase, where nothing can reach Pocket, and the reload is done at once (the
// wiki); coming out, spirit damage to the enemies around. T2: more damage. T3: wider, and the enemies hit move and attack slower.
// ponytail: Pocket leaves after the base time; tier 3's longer stay is the player's choice in the game and isn't used.
class EnchantersSatchel extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.weapon.reloadLeft > 0; }

  cast(fight) {
    const hide = this.data.AbilityChannelTime.Value;
    fight.addStatus(this.unit, { id: 'enchanters_satchel', duration: hide, tags: ['void'] });
    if (this.unit.weapon.reloadLeft > 0) {
      this.unit.weapon.reloadLeft = 0;
      this.unit.weapon.clip = this.unit.stats.clip;
      fight.emit('reloadEnd', { source: this.unit });
    }
    fight.at(hide, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      const slower = -this.value('FireRateSlow') / 100;
      for (const e of fight.near(this.value('Radius'))) {
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
        if (slower) fight.addStatus(e, { id: 'satchel_slow', duration: this.value('DebuffDuration'), mods: { slow: this.value('MoveSlowPercent') / 100, ...(e.team === 'hero' ? { fireRate: slower } : { damageDealt: slower }) }, debuff: true });
      }
    }));
  }
}

// 4. Affliction: the enemies around the front one take spirit damage over time, half to bosses. It never kills and sets off no item effects (the
// wiki). T2: longer, wider. T3: more damage, and they can't heal at all meanwhile.
class Affliction extends Ability {
  constructor(...args) {
    super(...args);
    this.sick = []; // [{ e, until, next }]
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const duration = this.value('DebuffDuration');
    for (const e of fight.near(this.value('Radius'))) {
      this.sick.push({ e, until: fight.time + duration, next: fight.time + this.data.DamageInterval });
      if (this.value('DisableHealing')) fight.addStatus(e, { id: 'affliction', duration, mods: { healAmp: -1 }, debuff: true });
    }
  }

  tick(fight) {
    this.sick = this.sick.filter((s) => s.e.alive && s.next <= s.until + 1e-9);
    for (const s of this.sick) {
      if (fight.time + 1e-9 < s.next) continue;
      s.next += this.data.DamageInterval;
      fight.damage(this.unit, s.e, this.value('DPS') * this.data.DamageInterval * (s.e.team !== 'hero' && isBoss(s.e) ? this.data.BossDamageScale : 1), 'spirit', { events: false });
      if (!s.e.alive) s.e.health = 1; // non-lethal
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Barrage', 'Channels a volley of projectiles that damage and slow. Each one that hits raises damage dealt for a while.'],
  ['Flying Cloak', 'Launches a sentient cloak that flies through the enemies, damaging them.'],
  ["Enchanter's Satchel", 'Escapes into a suitcase when the gun runs dry, then bursts out damaging the enemies around, reloaded.'],
  ['Affliction', 'Afflicts the enemies around with damage over time. It never kills.'],
];

module.exports = { name: 'Pocket', abilities: { 1: Barrage, 2: FlyingCloak, 3: EnchantersSatchel, 4: Affliction }, info };
