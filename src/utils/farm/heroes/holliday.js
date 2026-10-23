// Holliday's abilities (deadlock.wiki/Holliday, checked Oct 5 2026; page updated Sept 30). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. His call (Oct 5): Crackshot works on everything (the game: not on objectives), "just
// treat it as a crit": a bullet is a headshot with the chance the headshot items use.
const { Ability } = require('./../ability');
const { MELEE } = require('./../engine');
const { headshotChance } = require('./../engine');

const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);

// 1. Powder Keg: a barrel on the front enemy (it goes off on contact): spirit damage around it, a knock-up and a burn. Burns from several barrels
// add up. T1: shorter cooldown. T2: a third charge. T3: more damage and burn, charges closer together.
class PowderKeg extends Ability {
  constructor(...args) {
    super(...args);
    this.burns = []; // [{ e, until, next, dps }], one per enemy per barrel
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const burn = { until: fight.time + this.value('BurnDuration'), next: fight.time + this.data.TickRate, dps: this.value('DPS') };
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit');
      fight.addStatus(e, { id: 'keg_toss', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
      this.burns.push({ e, ...burn });
    }
  }

  tick(fight) {
    this.burns = this.burns.filter((b) => b.e.alive && b.next <= b.until + 1e-9);
    for (const b of this.burns) {
      if (fight.time + 1e-9 < b.next) continue;
      b.next += this.data.TickRate;
      fight.damage(this.unit, b.e, b.dps * this.data.TickRate, 'spirit');
    }
  }
}

// 2. Bounce Pad: she bounces and lands on the enemies: spirit damage around the front one (once per pad), and she stands next to it for a moment.
// The pad stays down for its duration (Spirit Lasso lasts longer while one is). T2: faster after landing. T3: the landing stuns.
class BouncePad extends Ability {
  constructor(...args) {
    super(...args);
    this.downUntil = 0; // a pad is on the ground until then
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    this.downUntil = fight.time + this.value('AbilityDuration');
    const front = fight.foes[0];
    if (!front) return;
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('StompDamage'), 'spirit');
      fight.addStatus(e, { id: 'bounce_stomp', duration: this.value('StompStunDuration'), tags: ['stun'], debuff: true });
    }
    this.unit.close = front;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
    if (this.value('SpeedOnLand')) fight.addStatus(this.unit, { id: 'bounce_speed', duration: this.value('SpeedOnLandDuration'), mods: { moveSpeed: this.value('SpeedOnLand') } });
  }
}

// 3. Crackshot: never cast. When it is ready, her next headshot deals extra weapon damage (scaled by spirit) and slows; the cooldown is shorter
// after hitting an NPC. T1: more slow. T2: more damage, and the enemy loses bullet resist. T3: every headshot while it is on cooldown shortens it.
class Crackshot extends Ability {
  want() { return false; }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || !p.target.alive) return;
    const npc = p.target.team !== 'hero';
    const cut = this.value(npc ? 'AbilityCooldownPerHeadshotNPC' : 'AbilityCooldownPerHeadshot'); // negative seconds
    const ready = this.ready();
    if ((!ready && !cut) || !(fight.rng() < headshotChance(this.unit))) return;
    if (!ready) { this.cdLeft = Math.max(0, this.cdLeft + cut); return; }
    this.use();
    if (npc) this.cdLeft *= 1 - this.data.CrackshotNPCCDReduction / 100;
    fight.log.push({ t: +fight.time.toFixed(1), who: this.unit.name, what: this.name });
    fight.addStatus(p.target, { id: 'crackshot_slow', duration: this.value('DebuffDuration'), mods: { slow: this.value('FadingSlowPercent') / 100 }, debuff: true });
    if (this.value('BulletResistReduction')) fight.addStatus(p.target, { id: 'crackshot_shred', duration: this.value('BulletResistReductionDuration'), mods: { bulletResist: this.value('BulletResistReduction') / 100 }, debuff: true });
    fight.damage(this.unit, p.target, this.value('Damage'), 'bullet', { events: false }); // part of the same bullet, not another one
  }
}

// 4. Spirit Lasso: lassos the front enemy (the one she is shooting): spirit damage and a stun, pulled in to her, so she walks up and melees it.
// With a Bounce Pad on the ground the stun lasts longer. T1: more damage. T2: longer. T3: shorter cooldown.
class SpiritLasso extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const target = fight.foes[0];
    if (!target) return;
    const pad = find(this.unit, BouncePad);
    const duration = this.value('AbilityDuration') + (pad && fight.time < pad.downUntil ? this.data.BouncePadExtendDuration : 0);
    fight.damage(this.unit, target, this.value('Damage'), 'spirit');
    fight.addStatus(target, { id: 'spirit_lasso', duration, tags: ['stun'], debuff: true });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Powder Keg', 'Throws a barrel that explodes, knocking enemies up and setting them on fire.'],
  ['Bounce Pad', 'Drops a bounce pad and lands on the enemies, damaging everything nearby.'],
  ['Crackshot', 'When ready, the next headshot deals bonus damage and slows the enemy.'],
  ['Spirit Lasso', 'Lassos an enemy, pulling it in and stunning it. Lasts longer while a Bounce Pad is down.'],
];

module.exports = { name: 'Holliday', abilities: { 1: PowderKeg, 2: BouncePad, 3: Crackshot, 4: SpiritLasso }, info };
