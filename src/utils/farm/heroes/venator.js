// Venator's abilities (deadlock.wiki/Venator, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. His call (Oct 5): an enemy Gutshot pushes back hits a wall half the time (there are no walls here).
// Standing rules used: "players only" abilities work on any enemy; health shares are cut against NPCs.
const { Ability } = require('./../ability');
const { MELEE } = require('./../engine');
const { npcShare } = require('./../items');

// A blessed hit (the last stake of Ira Domini, Gutshot's blessed melee): pure damage on top, and if that leaves the target under the execute
// threshold, a share of its max health as more pure damage (cut against NPCs). The numbers are Ira Domini's, unlocked or not.
function bless(fight, unit, e) {
  const ira = unit.abilities.find((a) => a.data.Name === 'Ira Domini');
  if (!ira || !e.alive) return;
  fight.damage(unit, e, ira.value('BonusDamage'), 'true');
  const share = (ira.data.ExecuteThreshold / 100) * (e.team === 'hero' ? 1 : npcShare(e));
  if (e.alive && e.health < e.stats.maxHealth * share) fight.damage(unit, e, e.stats.maxHealth * share, 'true');
}

// 1. Consecrating Grenade: weapon damage around the front enemy, and the enemies hit burn: every burning enemy deals pure damage to the burning
// ones around it (itself too), and they heal less. T1: shorter cooldown. T2: wider, longer. T3: they heal even less.
class ConsecratingGrenade extends Ability {
  constructor(...args) {
    super(...args);
    this.burning = []; // [{ e, until, next }]
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const duration = this.value('BurnDuration');
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'bullet');
      fight.addStatus(e, { id: 'consecrated', duration, mods: { healAmp: this.value('HealAmpReceivePenaltyPercent') / 100 }, debuff: true });
      this.burning = this.burning.filter((b) => b.e !== e);
      this.burning.push({ e, until: fight.time + duration, next: fight.time + this.data.TickRate });
    }
  }

  tick(fight) {
    this.burning = this.burning.filter((b) => b.e.alive && b.next <= b.until + 1e-9);
    for (const b of this.burning) {
      if (fight.time + 1e-9 < b.next) continue;
      b.next += this.data.TickRate;
      const fires = this.burning.filter((o) => Math.abs((o.e.offset ?? 0) - (b.e.offset ?? 0)) <= this.value('BurnRadius')).length;
      fight.damage(this.unit, b.e, this.value('DPS') * this.data.TickRate * fires, 'true');
    }
  }
}

// 2. Gutshot: a shotgun blast from up close: weapon damage to the enemies in front, pushed back; each one hits a wall WALL of the time (his
// call): a stun and bonus weapon damage. T1: more damage. T2: shorter cooldown, a longer stun. T3: after a wall stun the next heavy melee is
// blessed.
const WALL = 0.5;
class Gutshot extends Ability {
  constructor(...args) {
    super(...args);
    this.blessedUntil = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  wantsMelee(fight) { return fight.time < this.blessedUntil; }

  cast(fight) {
    let walled = false;
    this.unit.close = fight.foes[0] ?? null;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
    for (const e of fight.near(this.value('AbilityCastRange') / 2)) {
      fight.damage(this.unit, e, this.value('Damage'), 'bullet');
      if (!(fight.rng() < WALL) || !e.alive) continue;
      walled = true;
      fight.damage(this.unit, e, this.value('BonusDamage'), 'bullet');
      fight.addStatus(e, { id: 'gutshot', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
    }
    if (walled && this.value('BuffDuration')) this.blessedUntil = fight.time + this.value('BuffDuration');
  }

  on(event, fight, p) {
    if (event !== 'melee' || p.source !== this.unit || fight.time >= this.blessedUntil) return;
    this.blessedUntil = 0;
    fight.running(this, () => bless(fight, this.unit, p.target));
  }
}

// 3. Hex-Lined Snap Trap: a trap under the front enemy; once armed it springs on it: spirit damage and an immobilize (Venator walks up and
// melees). T1: shorter cooldown. T2: held longer. T3: a third charge, and the trapped enemy takes more damage for a while.
class SnapTrap extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    fight.at(this.data.ArmTime, () => fight.running(this, () => {
      const e = fight.foes[0];
      if (!e || !this.unit.alive) return;
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'snap_trap', duration: this.value('ImmobilizeDuration'), tags: ['immobilize'], debuff: true });
      if (this.value('IncomingDamagePercentFromCaster')) fight.addStatus(e, { id: 'snap_trap_revealed', duration: this.value('RevealDuration'), mods: { damageTaken: this.value('IncomingDamagePercentFromCaster') / 100 }, debuff: true });
    }));
  }
}

// 4. Ira Domini: the crossbow comes out (the gun is away meanwhile): three stakes one after another, each heavy weapon damage through every
// enemy in line; the last one is blessed. T1: faster meanwhile. T2: shorter cooldown, a stronger blessing. T3: every stake is blessed.
const DRAW = 1; // seconds to change weapons, at the start and at the end (the wiki's notes)
const RELOAD = 0.8; // between two stakes
class IraDomini extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Crossbow' : super.status(fight); }

  cast(fight) {
    const stakes = this.data.StakeCount;
    this.until = fight.time + DRAW + (stakes - 1) * RELOAD + DRAW;
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    if (this.value('BonusMoveSpeed')) fight.addStatus(this.unit, { id: 'ira_domini', duration: this.until - fight.time, mods: { moveSpeed: this.value('BonusMoveSpeed') } });
    for (let i = 0; i < stakes; i++) {
      fight.at(DRAW + i * RELOAD, () => fight.running(this, () => {
        if (!this.unit.alive || this.unit.cantAct || this.unit.has('disarm')) return;
        const blessed = i === stakes - 1 || this.value('AllStakesBlessed') > 0;
        for (const e of fight.foes) {
          fight.damage(this.unit, e, this.value('Damage'), 'bullet');
          if (blessed) bless(fight, this.unit, e);
        }
      }));
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Consecrating Grenade', 'Fires a grenade that sets enemies on fire. Burning enemies burn each other and heal less.'],
  ['Gutshot', 'Blasts the enemies in front with a shotgun, pushing them back. One that hits a wall is stunned and hurt more.'],
  ['Hex-Lined Snap Trap', 'Kicks a trap under an enemy that damages and immobilizes it.'],
  ['Ira Domini', 'Loads a crossbow with three stakes of massive weapon damage. The last one is blessed.'],
];

module.exports = { name: 'Venator', abilities: { 1: ConsecratingGrenade, 2: Gutshot, 3: SnapTrap, 4: IraDomini }, info };
