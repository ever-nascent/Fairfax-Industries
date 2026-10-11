// Rat King's abilities (deadlock.wiki/Rat_King, checked Oct 10 2026; page updated that day). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. His calls (Oct 10): Rat Swarm's rats are dealt round the enemies in reach, one each
// from the front; the banner is slammed right after the charge-up; Royal Pestments goes on whenever it is ready.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');

// 1. Scrap Grenade: bounces to the front enemy and goes off several times: bullet damage and a slow to the enemies around, the last one after a
// longer fuse. T1: shorter cooldown. T2: more damage. T3: one more detonation at the end, bigger: far more damage, wider, a stronger slow.
class ScrapGrenade extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const hasBig = this.value('BigExplosionDamage') > 0;
    const blast = (big) => fight.running(this, () => {
      if (!this.unit.alive) return;
      for (const e of fight.near(this.value(big ? 'BigExplosionRadius' : 'ShrapnelSphereRadius'))) {
        fight.damage(this.unit, e, this.value(big ? 'BigExplosionDamage' : 'DamagePerShrapnel'), 'bullet');
        fight.addStatus(e, { id: big ? 'scrap_big_slow' : 'scrap_slow', duration: this.value('SlowDuration'), mods: { slow: this.value(big ? 'BigExplosionSlowPercent' : 'SlowPercent') / 100 }, debuff: true });
      }
    });
    const count = this.value('Detonations');
    let at = this.data.FirstBounceDetonateTimer;
    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      if (i) at += last ? this.data.FinalBounceDetonateTimer : this.data.AdditionalBounceDetonateTimer;
      fight.at(at, () => blast(last && hasBig));
    }
  }
}

// 2. Rat Swarm: a swarm of rats leaps onto the enemies in reach, dealt round from the front (his call), at most so many on one enemy. Each rat
// bites once a second while it hangs on: spirit damage and a little bullet resist off, which lasts a while and is refreshed by every bite.
// The banner's rats (Rule, Ratannia!) are kept here too. T1: a second charge. T2: a bigger swarm, the resist loss lasts longer.
// T3: more damage and more resist off per bite.
class RatSwarm extends Ability {
  constructor(...args) {
    super(...args);
    this.rats = []; // [{ e, until, next }]
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && !this.ready() && this.rats.length ? `${this.rats.length} Rats` : super.status(fight); }

  // One rat onto `e`; false when it already carries all it can.
  attach(fight, e) {
    if (this.rats.filter((r) => r.e === e).length >= this.data.MaxRats) return false;
    this.rats.push({ e, until: fight.time + this.value('AbilityDuration'), next: fight.time + this.data.BiteInterval });
    return true;
  }

  // `count` rats dealt round `targets`, one each, until they run out or nobody can carry another.
  release(fight, count, targets) {
    for (let left = count, placed = true; left > 0 && placed;) {
      placed = false;
      for (const e of targets) if (left > 0 && this.attach(fight, e)) { left--; placed = true; }
    }
  }

  cast(fight) { this.release(fight, this.value('RatSwarmCols') * this.value('RatSwarmRows'), fight.near(this.data.Radius)); }

  tick(fight) {
    this.rats = this.rats.filter((r) => r.e.alive && r.next <= r.until + 1e-9);
    for (const r of this.rats) {
      if (fight.time + 1e-9 < r.next || !r.e.alive) continue;
      r.next += this.data.BiteInterval;
      const off = r.e.statuses.find((s) => s.id === 'rat_bites')?.mods.bulletResist ?? 0;
      fight.addStatus(r.e, { id: 'rat_bites', duration: this.value('DebuffDuration'), mods: { bulletResist: off + this.value('ArmorReductionPerBite') / 100 }, debuff: true });
      fight.damage(this.unit, r.e, this.value('DamagePerBite'), 'spirit');
    }
  }
}

// 3. Royal Pestments: scrap armour: a barrier worth a share of his max health. While it holds, every weapon hit on him has a chance to be sent
// back at the attacker for its full damage (the hit still lands on the barrier). The barrier gets nothing from his resists (the wiki: `raw`).
// Put on whenever ready (his call). T1: longer.
// T2: shorter cooldown, a better chance. T3: a bigger barrier, and no hit deals more than a set amount while it holds.
class RoyalPestments extends Ability {
  armor() { return this.unit.statuses.find((s) => s.id === 'pestments' && s.barrier > 0); }
  want(fight) { return fight.foes.length > 0 && !this.armor(); }
  status(fight) { return this.armor() ? 'Armored' : super.status(fight); }

  cast(fight) {
    fight.addStatus(this.unit, { id: 'pestments', duration: this.value('AbilityDuration'), barrier: (this.unit.stats.maxHealth * this.value('MaxHealthPct')) / 100, raw: true });
  }

  on(event, fight, hit) {
    if (event !== 'attacked' || hit.target !== this.unit || !this.armor()) return;
    const most = this.value('MaxDamagePerHit');
    if (most) hit.amount = Math.min(hit.amount, most);
    if (hit.type === 'bullet' && fight.rng() < this.value('ReturnFireChance') / 100) {
      fight.damage(this.unit, hit.source, (hit.amount * this.data.BulletDamageReflectedPct) / 100, 'bullet', { events: false });
    }
  }
}

// 4. Rule, Ratannia!: a charge-up without shooting, then the banner is slammed down at once (his call): bullet damage and a knock-up to the
// enemies in reach. While it stands he is faster and takes less damage, the enemies in reach are slowed, and a rat jumps out every moment
// onto one of them in turn, biting like Rat Swarm's. T1: faster still. T2: stands longer, reaches further. T3: more damage, more protection.
class RuleRatannia extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.nextRat = 0;
    this.turn = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? `${Math.ceil(this.until - fight.time)}s Left` : super.status(fight); }

  on(event, fight, p) {
    if (event === 'cast' && p.ability === this) this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
  }

  cast(fight) {
    for (const e of fight.near(this.value('Radius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'bullet');
      fight.addStatus(e, { id: 'ratannia_toss', duration: this.data.TossDuration, tags: ['stun'], debuff: true });
    }
    this.until = fight.time + this.value('FlagDuration');
    this.nextRat = fight.time + this.data.EnemyFlagAuraModifier.RatSpawnInterval;
  }

  tick(fight) {
    if (fight.time >= this.until) return;
    fight.addStatus(this.unit, { id: 'ratannia', duration: DT * 1.5, mods: { moveSpeed: this.value('BonusMoveSpeed'), damageTaken: -this.value('AllyDamageReduction') / 100, slow: -1 } }); // slow: -1 = immune to slows near the banner (the wiki)
    const reach = fight.near(this.value('Radius'));
    for (const e of reach) fight.addStatus(e, { id: 'ratannia_slow', duration: DT * 1.5, mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    if (fight.time + 1e-9 < this.nextRat || !reach.length) return;
    const aura = this.data.EnemyFlagAuraModifier;
    this.nextRat += aura.RatSpawnInterval;
    const from = this.turn++ % reach.length; // each rat starts with the next enemy along
    this.unit.abilities.find((a) => a instanceof RatSwarm)?.release(fight, aura.RatsPerSpawn, [...reach.slice(from), ...reach.slice(0, from)]);
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Scrap Grenade', 'Throws a grenade of scrap that goes off several times, damaging and slowing the enemies around it.'],
  ['Rat Swarm', 'Sends a swarm of rats onto the enemies. Every bite deals spirit damage and wears down bullet resist.'],
  ['Royal Pestments', 'Puts on scrap armour: a barrier that can send weapon hits back at the attacker while it holds.'],
  ['Rule, Ratannia!', 'Slams the banner of Ratannia into the ground: the sewers erupt under the enemies, rats pour out, and the banner protects while it stands.'],
];

// copyWith: what a copy of the ultimate needs beside it (Sinclair's Audience Participation): Rat Swarm keeps the banner's rats.
module.exports = { name: 'Rat King', abilities: { 1: ScrapGrenade, 2: RatSwarm, 3: RoyalPestments, 4: RuleRatannia }, info, copyWith: [2] };
