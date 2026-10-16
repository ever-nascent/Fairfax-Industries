// Deadman Danny's abilities (deadlock.wiki/Deadman_Danny, checked Oct 16 2026; data updated Oct 15). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. Standing rule used: "on hero hit" is any enemy.
// His calls (Oct 16): the charged shot is only fired to cash in a Strix Salvo mark; Close The Deal waits until an enemy is below 50% health.
// Taken by me (say if wrong): the charge takes CHARGE_TIME (the game data gives none), the grab GRAB_TIME, Chimera's T1 (faster venting: heat
// isn't simulated) shortens the cooldown by T1_CUT, Jettison Fuel's spray builds up items like his shots would at his fire rate.
// Not simulated: steering the flight, heat and overheating, a charged shot hurting himself (it hits an enemy every time).
const { Ability } = require('./../ability');
const { DT, DUEL } = require('./../engine');
const { HEROES } = require('./../stats');

const CHARGE_TIME = 0.5; // ponytail: seconds to charge a shot at his base fire rate (fire rate items shorten it, the wiki); placeholder
const CHARGED = { damage: 48, perBoon: 1.6, ammo: 2, buildUp: 3, radius: 2.5, edge: 0.7 }; // the wiki: 48 weapon damage in 2.5 m, 70% at the edge, 3x build-up; +1.6 a boon (LevelScaling.BulletDamageAltFire)
const GRAB_TIME = 2; // ponytail: seconds up and down with the grabbed enemy (the wiki gives no duration); placeholder
const HEIGHT = 1700 / 39.37; // Close The Deal's MaxHeight in metres (the game's units are inches): about 43 m
const T1_CUT = 4; // ponytail: Chimera Mk1 T1's -4%/s heat drain read as -4 s cooldown; placeholder
const boons = (a) => a.unit.boons ?? 0;
const area = (fight, radius) => (fight.foes.length ? fight.near(radius) : []); // a delayed effect may land when nobody is left standing
const salvo = (unit) => unit.abilities.find((a) => a instanceof StrixSalvo);

// 1. Strix Salvo: missiles land along a line through the group, one per enemy (up to 3, 5 at T3), and go off a moment later: spirit damage and a
// mark. A charged shot at a marked enemy uses a mark up: bonus spirit damage and a fading slow. Danny charges a shot only when there is a mark to
// cash in (his call), so this ability also fires his charged shots. T1: shorter cooldown. T2: more damage. T3: +2 missiles, longer, better scaling.
class StrixSalvo extends Ability {
  constructor(...args) {
    super(...args);
    this.marks = new Map(); // enemy -> [when each mark runs out]
    this.charging = false;
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const hit = area(fight, this.value('Range')).slice(0, Math.round(this.value('MarksTotal')));
    fight.at(this.data.MineArmTime, () => {
      for (const e of hit) {
        if (!e.alive) continue;
        fight.running(this, () => fight.damage(this.unit, e, this.value('Damage'), 'spirit'));
        this.mark(fight, e);
      }
    });
  }

  mark(fight, e) { this.marks.set(e, [...(this.marks.get(e) ?? []), fight.time + this.value('CoatedDuration')]); }

  marked(fight) {
    for (const [e, until] of this.marks) {
      const left = until.filter((t) => t > fight.time);
      if (!e.alive || !left.length) this.marks.delete(e); else this.marks.set(e, left);
    }
    return fight.foes.find((e) => this.marks.has(e));
  }

  status(fight) { const n = fight ? [...this.marks.values()].reduce((s, l) => s + l.filter((t) => t > fight.time).length, 0) : 0; return n ? `${super.status(fight)}  -  ${n} marked` : super.status(fight); }

  tick(fight) {
    const u = this.unit;
    const w = u.weapon;
    if (this.charging || w.reloadLeft > 0 || w.clip < CHARGED.ammo || fight.time < u.busyUntil || u.cantAct || u.has('stun') || u.has('disarm')) return;
    if (!this.marked(fight)) return;
    const rate = u.stats.fireRate * (1 + u.mod('fireRate'));
    const wait = (CHARGE_TIME * HEROES[u.name].Weapon.RoundsPerSecond) / Math.max(0.1, rate);
    this.charging = true;
    u.busyUntil = fight.time + wait; // the gun is held while it charges
    fight.at(wait, () => { this.charging = false; this.fire(fight); });
  }

  // The charged shot: two rounds, an explosion (weapon damage, less at its edge), 3x build-up; on a marked enemy one mark is used up.
  fire(fight) {
    const u = this.unit;
    const w = u.weapon;
    const target = this.marked(fight);
    if (!target || !u.alive || u.cantAct || u.has('stun') || u.has('disarm') || w.clip < CHARGED.ammo || w.reloadLeft > 0) return;
    w.clip -= CHARGED.ammo;
    if (!(target.team === 'hero' && fight.rng() < DUEL.miss)) {
      const s = u.stats;
      const base = (CHARGED.damage + CHARGED.perBoon * boons(this)) * (s.weaponDamageMult + u.mod('weaponDamage') + u.items.reduce((sum, it) => sum + it.weaponBonus(fight, target), 0));
      const front = target.offset ?? 0;
      for (const e of fight.foes.filter((x) => Math.abs((x.offset ?? 0) - front) <= CHARGED.radius * u.range)) {
        fight.damage(u, e, base * (e === target ? 1 : CHARGED.edge), 'bullet', { landed: CHARGED.buildUp, ...(e.team === 'hero' ? { attack: true } : {}) });
      }
      const marks = this.marks.get(target);
      if (marks && target.alive) {
        marks.shift();
        fight.running(this, () => fight.damage(u, target, this.value('CoatedDamage'), 'spirit'));
        fight.addStatus(target, { id: 'strix_slow', duration: this.value('CoatedSlowDuration'), mods: { slow: this.data.CoatedSlowPercent / 100 }, debuff: true });
      }
    }
    if (w.clip <= 0) fight.reload(u);
  }
}

// 2. Chimera Mk1: he flies for the channel (airborne, still shooting), then dives into the enemies: spirit and weapon damage around the front one,
// and they are launched (a stun). The dive costs him a share of his max health. T1: shorter cooldown (T1_CUT). T2: a hit heals him and spares
// him the self-damage. T3: more damage, and a hit halves the cooldown. The cooldown is shorter with every boon (the wiki data).
class ChimeraMk1 extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  get cooldown() {
    const base = this.data.AbilityCooldown.Value;
    const perBoon = [].concat(this.data.AbilityCooldown.Scale).find((s) => s.Type === 'power_increase')?.Value ?? 0;
    return super.cooldown * Math.max(0.2, (base + perBoon * boons(this) - (this.tier >= 1 ? T1_CUT : 0)) / base);
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Flying' : super.status(fight); }

  cast(fight) {
    const flight = this.value('AbilityChannelTime');
    this.until = fight.time + flight;
    fight.addStatus(this.unit, { id: 'chimera_flight', duration: flight, tags: ['airborne'] });
    fight.at(flight, () => { if (this.unit.alive) fight.running(this, () => this.dive(fight)); });
  }

  dive(fight) {
    const u = this.unit;
    const hit = area(fight, this.value('Radius'));
    for (const e of hit) {
      fight.damage(u, e, this.value('ExplosionDamage'), 'spirit');
      fight.damage(u, e, this.value('ExplosionBulletDamage'), 'bullet', e.team === 'hero' ? { attack: true } : {});
      fight.addStatus(e, { id: 'chimera_launch', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
    }
    if (hit.length) {
      fight.heal(u, this.value('HealOnHit'));
      const cut = this.value('OverheatLockoutDurationReductionOnPlayerHitPercent');
      if (cut) this.cdLeft *= 1 - cut / 100;
    }
    if (!(hit.length && this.value('SelfDamageReductionOnPlayerHitPercent') >= 100)) fight.damage(u, u, (u.stats.maxHealth * this.data.MaxHealthSelfDamagePercent) / 100, 'spirit', { events: false });
    if (!hit.length) fight.addStatus(u, { id: 'chimera_self_stun', duration: this.data.OverheatStunDurationSelf, tags: ['stun'] });
  }
}

// 3. Jettison Fuel: he sprays fuel for the channel instead of shooting: weapon damage every step to the enemies within its reach and their bullet
// resist shredded, then a backblast of spirit damage on them. T1: shorter cooldown. T2: a bigger backblast, and a hit gives him fire rate. T3: more
// shred, and the backblast marks every enemy it hits (Strix Salvo's mark).
class JettisonFuel extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  reach(fight) { const front = fight.foes[0]; return front ? this.value('AbilityCastRange') - fight.distance(this.unit, front) : -1; }
  want(fight) { return this.reach(fight) >= 0; }
  status(fight) { return fight && fight.time < this.until ? 'Spraying' : super.status(fight); }

  cast(fight) {
    const spray = this.value('AbilityDuration');
    this.until = fight.time + spray;
    this.unit.busyUntil = Math.max(this.unit.busyUntil, this.until);
    fight.at(spray, () => { if (this.unit.alive && !this.unit.cantAct) fight.running(this, () => this.backblast(fight)); });
  }

  tick(fight, dt) {
    if (fight.time > this.until + 1e-9 || this.unit.cantAct || this.unit.has('stun')) return;
    const u = this.unit;
    const landed = dt * u.stats.fireRate * (1 + u.mod('fireRate')); // build-up like the shots it replaces (taken by me)
    for (const e of this.inReach(fight)) {
      fight.damage(u, e, this.value('DPS') * dt, 'bullet', { landed, ...(e.team === 'hero' ? { attack: true } : {}) });
      fight.addStatus(e, { id: 'jettison_shred', duration: this.value('DebuffDuration'), mods: { bulletResist: this.value('BulletResistReduction') / 100 }, debuff: true });
    }
  }

  inReach(fight) { const r = this.reach(fight); return r < 0 ? [] : area(fight, r); }

  backblast(fight) {
    const hit = this.inReach(fight);
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('ScorchDamage'), 'spirit');
      if (this.value('BurstMarkStacks') && e.alive) salvo(this.unit)?.mark?.(fight, e);
    }
    if (hit.length && this.value('BonusFireRate')) fight.addStatus(this.unit, { id: 'jettison_fire_rate', duration: this.value('BuffDuration'), mods: { fireRate: this.value('BonusFireRate') / 100 } });
  }
}

// 4. Close The Deal: once an enemy is below half health (his call), he grabs the lowest one and flies it up and down (GRAB_TIME: neither of them
// acts; a boss shrugs off part of the hold): spirit damage on landing, more for the height fallen and more again if it is below half health,
// then a short stun. He takes a share of it himself and is stunned a moment. T1: more damage. T2: shorter cooldown. T3: longer stun, more a metre.
class CloseTheDeal extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  low(fight) {
    const share = (e) => e.health / e.stats.maxHealth;
    return fight.foes.filter((e) => share(e) * 100 < this.data.LowHealthEnemyThresholdPct).sort((a, b) => share(a) - share(b))[0];
  }

  want(fight) { return !!this.low(fight); }
  status(fight) { return fight && fight.time < this.until ? 'Grabbing' : super.status(fight); }

  cast(fight) {
    const e = this.low(fight) ?? fight.foes[0];
    if (!e) return;
    const u = this.unit;
    this.until = fight.time + GRAB_TIME;
    fight.addStatus(e, { id: 'deal_grab', duration: GRAB_TIME, tags: ['stun'], debuff: true });
    fight.addStatus(u, { id: 'deal_flight', duration: GRAB_TIME, tags: ['silence', 'airborne'] });
    u.busyUntil = Math.max(u.busyUntil, this.until);
    fight.at(GRAB_TIME, () => fight.running(this, () => this.land(fight, e)));
  }

  land(fight, e) {
    const u = this.unit;
    if (!u.alive || !e.alive) return;
    let amount = this.value('Damage') + this.value('DamagePerMeter') * HEIGHT;
    if ((e.health / e.stats.maxHealth) * 100 < this.data.LowHealthEnemyThresholdPct) amount *= 1 + this.data.BonusDamagePercent / 100;
    fight.damage(u, e, amount, 'spirit');
    if (e.alive) fight.addStatus(e, { id: 'deal_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
    fight.damage(u, u, (amount * this.data.SelfDamagePercent) / 100, 'spirit', { events: false });
    if (u.alive) fight.addStatus(u, { id: 'deal_self_stun', duration: this.data.StunDurationSelf, tags: ['stun'] });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Strix Salvo', 'Fires missiles that land among the enemies and mark them. A charged shot at a marked enemy cashes the mark in.'],
  ['Chimera Mk1', 'Flies on a jetpack, then dives into the enemies with an explosion that launches them.'],
  ['Jettison Fuel', 'Sprays burning fuel that shreds bullet resist, ending in a backblast.'],
  ['Close The Deal', 'Grabs a weakened enemy, flies it high into the air and crashes back down.'],
];

module.exports = { name: 'Deadman Danny', abilities: { 1: StrixSalvo, 2: ChimeraMk1, 3: JettisonFuel, 4: CloseTheDeal }, info };
