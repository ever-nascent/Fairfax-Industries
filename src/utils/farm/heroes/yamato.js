// Yamato's abilities (deadlock.wiki/Yamato, checked Oct 5 2026; page updated Sept 30). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. Standing rules used: "on hero hit / kill" is any enemy; a slower fire rate on an NPC is that much
// less damage from it. (This is the hero; the betting game she hosts is src/utils/yamato.js.)
const { Ability } = require('./../ability');
const { DT, MELEE } = require('./../engine');

// 1. Power Slash: a charge without shooting (bullet resist meanwhile), then a sword strike through every enemy in its length for spirit damage.
// T1: a slow. T2: shorter cooldown. T3: far more damage, longer.
class PowerSlash extends Ability {
  want(fight) { return fight.foes.length > 0; }

  on(event, fight, p) {
    if (event !== 'cast' || p.ability !== this) return;
    fight.addStatus(this.unit, { id: 'power_slash_charge', duration: this.castDelay, mods: { bulletResist: this.data.BulletResist / 100 } });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
  }

  cast(fight) {
    for (const e of fight.near(this.value('SlashLength'))) {
      fight.damage(this.unit, e, this.value('FullChargeDamage'), 'spirit');
      if (this.value('SlowPercent')) fight.addStatus(e, { id: 'power_slash', duration: this.value('SlowDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
    }
  }
}

// 2. Flying Slash: she reels herself to the front enemy: melee damage and a slow, and she stands next to it for a moment.
// T1: shorter cooldown. T2: spirit power for a while after. T3: a second charge.
class FlyingSlash extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    this.unit.close = e;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
    fight.damage(this.unit, e, this.value('Damage'), 'melee');
    fight.addStatus(e, { id: 'flying_slash', duration: this.value('SlowDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    if (this.value('SpiritBonus')) fight.addStatus(this.unit, { id: 'flying_slash_spirit', duration: this.value('BuffDuration'), mods: { spirit: this.value('SpiritBonus') } });
  }
}

// 3. Crimson Slash: a slash through the enemies in front: spirit damage, and they attack slower for a while; if it hits anything she heals.
// T1: more melee damage for a while after a hit. T2: a share of max health on top of the heal. T3: shorter cooldown, better scaling.
class CrimsonSlash extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const hit = fight.near(this.value('Radius') / 2);
    const slower = -this.data.FireRateSlow / 100;
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'crimson_slash', duration: this.value('DebuffDuration'), mods: e.team === 'hero' ? { fireRate: slower } : { damageDealt: slower }, debuff: true });
    }
    if (!hit.length) return;
    fight.heal(this.unit, this.value('HealFixedHealth') + (this.unit.stats.maxHealth * this.value('HealMaxHealth')) / 100);
    if (this.value('BuffMeleeDamage')) fight.addStatus(this.unit, { id: 'crimson_slash_edge', duration: this.value('BuffDuration'), mods: { meleeDamage: this.value('BuffMeleeDamage') / 100 } });
  }
}

// 4. Shadow Transformation: a channel in which nothing can touch her, then the shadow form for a while: her other abilities are ready again and
// come back faster, she can't be stopped, and she has more bullet and spirit resist. A kill heals her and keeps the form going longer.
// T1: more damage a bullet meanwhile. T2: faster, shorter cooldown. T3: longer, more resist.
class ShadowTransformation extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Shadow Form' : super.status(fight); }

  cast(fight) {
    const channel = this.data.AbilityChannelTime;
    fight.addStatus(this.unit, { id: 'shadow_transforming', duration: channel, tags: ['void'] });
    fight.at(channel, () => {
      if (!this.unit.alive) return;
      this.until = fight.time + this.value('AbilityDuration');
      for (const a of this.unit.abilities) if (a !== this && !a.hidden) a.refresh();
    });
  }

  tick(fight, dt) {
    if (fight.time >= this.until) return;
    fight.addStatus(this.unit, {
      id: 'shadow_form', duration: DT * 1.5, tags: ['unstoppable'],
      mods: { bulletResist: this.value('BulletResist') / 100, spiritResist: this.value('TechResist') / 100, bulletDamage: this.value('WeaponDamageBonus'), moveSpeed: this.value('BonusMoveSpeed') },
    });
    const faster = (this.data.AbilitySpeedPct / 100) * dt;
    for (const a of this.unit.abilities) if (a !== this) { a.cdLeft = Math.max(0, a.cdLeft - faster); a.gapLeft = Math.max(0, a.gapLeft - faster); }
  }

  on(event, fight, p) {
    if (event !== 'kill' || p.source !== this.unit || p.target === this.unit || fight.time >= this.until) return;
    fight.heal(this.unit, (this.unit.stats.maxHealth * this.value('MaxHealthRegen')) / 100);
    this.until += this.value('ShadowFormDurationOnKill');
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Power Slash', 'Charges up, then releases a sword strike through every enemy in its path.'],
  ['Flying Slash', 'Grapples to an enemy, striking it for melee damage and slowing it.'],
  ['Crimson Slash', 'Slashes the enemies in front, making them attack slower. A hit heals.'],
  ['Shadow Transformation', 'Becomes a shadow for a while: abilities ready again and faster, heavy resistances, and nothing can stop it.'],
];

module.exports = { name: 'Yamato', abilities: { 1: PowerSlash, 2: FlyingSlash, 3: CrimsonSlash, 4: ShadowTransformation }, info };
