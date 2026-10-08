// Graves' abilities (deadlock.wiki/Graves, checked Oct 5 2026; page updated Oct 2). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. His calls (Oct 5): Ghouls draw fire; the jar starts a fight full and is emptied when she dies, and only
// death refills it, like the game; the gun deals full damage anywhere (stats.js NO_FALLOFF); Grasping Hands' tier 1 (a longer rift, useless here)
// grabs the enemies a second time when the rift closes.
// Her summons are not units: Deadheads and Ghouls are kept on the ability that owns them and deal Graves' damage.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');
const { isBoss, npcShare } = require('./../items');
const { HEROES } = require('./../stats');

const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);

// 1. Jar of Dead: throws a jar of Deadheads, each striking the front enemy (the gun's target) again and again for spirit damage until its time
// is up. No cooldown: a jar costs death, collected when anything dies (a trooper or one of her Ghouls 1, a Haunt 3, a boss or hero 5).
// T1: each death heals. T2: a strike slows. T3: more Deadheads, for longer.
// The gun's own rule lives here too (slot 1 is never locked): every 13th shot in a row on the same enemy deals double.
const DOUBLE_EVERY = 13;
class JarOfDead extends Ability {
  constructor(...args) {
    super(...args);
    this.death = 0; // collected towards the next jar
    this.heads = []; // [{ until, next }]
    this.aim = null; // the enemy the gun is on, and how many shots in a row it has taken
    this.streak = 0;
    this.down = false;
  }

  get cost() { return Math.max(1, Math.round(this.value('ResourceCost') / this.data.ResourcePerPickup)); } // death per jar: 12, less with cooldown reduction
  ready() { return !this.unit.cantAct && this.charges > 0 && this.gapLeft <= 0; }
  get cooldown() { return this.chargeGap; } // the only wait it has: the 13 s between two jars
  use() { this.charges -= 1; this.gapLeft = this.chargeGap; }
  tickCooldown(dt) { this.gapLeft = Math.max(0, this.gapLeft - dt); } // jars never come back with time
  status() { return !this.charges ? 'Empty' : this.gapLeft > 0 ? `${Math.ceil(this.gapLeft)}s` : 'Ready'; }
  want(fight) { return fight.foes.length > 0; }

  collect(fight, death) {
    fight.heal(this.unit, this.value('HealPerPickup') * death);
    this.death += death;
    while (this.death >= this.cost && this.charges < this.maxCharges) { this.death -= this.cost; this.charges += 1; }
    if (this.charges >= this.maxCharges) this.death = 0;
  }

  // what a dead enemy leaves in the jar
  reap(fight, dead) {
    const d = this.data;
    this.collect(fight, dead.team === 'hero' ? d.PickupsPerHeroDeath : isBoss(dead) ? d.PickupsPerBossDeath : /Haunt/.test(dead.name) ? d.PickupsPerNeutralTrooperDeath : d.PickupsPerDeath);
  }

  cast(fight) {
    const until = fight.time + this.value('SkullLifetime');
    for (let i = 0; i < this.value('SkullCount'); i++) this.heads.push({ until, next: fight.time + this.data.TargetSearchInitialDelayMin + i * this.data.TargetSearchInitialStagger });
  }

  tick(fight) {
    const down = this.unit.statuses.some((s) => s.id === 'rejuv'); // she died and a Rejuv is getting her up: the jar is lost (his call)
    if (down && !this.down) { this.charges = 0; this.death = 0; }
    this.down = down;
    this.heads = this.heads.filter((h) => h.until > fight.time);
    const [a, b] = [this.data.TargetSearchDelayMin, this.data.TargetSearchDelayMax];
    for (const h of this.heads) {
      const target = fight.foes[0];
      if (!target || fight.time + 1e-9 < h.next) continue;
      h.next = fight.time + Math.min(a, b) + Math.abs(a - b) * fight.rng();
      fight.damage(this.unit, target, this.value('Damage'), 'spirit');
      if (this.value('SlowPercent')) fight.addStatus(target, { id: 'deadhead_slow', duration: this.value('SlowDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
      find(this.unit, EssenceTheft)?.summoned(fight, target, 'SkullBuildUp');
    }
  }

  on(event, fight, p) {
    if (event === 'kill' && p.target !== this.unit) this.reap(fight, p.target);
    if (p.source !== this.unit) return;
    if (event === 'reloadStart') this.streak = 0;
    if (event !== 'bulletHit') return;
    if (p.target !== this.aim) { this.aim = p.target; this.streak = 0; }
    if (++this.streak % DOUBLE_EVERY || !p.target.alive) return;
    fight.damage(this.unit, p.target, p.amount, 'bullet', { events: false }); // the same shot again, not another bullet
    if (!p.target.alive) this.reap(fight, p.target); // no 'kill' event without events
  }
}

// 2. Grasping Hands: a rift opens under the enemies within half its length of the front one: spirit damage and an immobilize (she walks up and
// melees), and a Ghoul is raised. T1 (his call): the rift grabs them once more as it closes. T2: more damage, longer. T3: a second Ghoul.
// Every Ghoul is kept here, whoever raised it (Borrowed Decree's too: this slot unlocks first). The numbers are Borrowed Decree's (its innate).
// A Ghoul walks up to the enemies, then claws at Haunts and troopers once a second (melee damage, to those right around the front one) until
// its time is up; anything else (a boss, a rival hero) it blows up on: spirit damage around it and a slow. While a Ghoul is clawing, an enemy's
// hit lands on it instead of Graves DRAW_FIRE of the time (his call: Ghouls draw fire). A Ghoul's death is 1 death for the jar.
// ponytail: WALK, SWING and DRAW_FIRE are placeholders (the wiki gives no Ghoul speeds); his to tune.
const WALK = 2;
const SWING = 1;
const DRAW_FIRE = 0.5;
class GraspingHands extends Ability {
  constructor(...args) {
    super(...args);
    this.ghouls = []; // [{ arrive, until, next, health }]
  }

  get decree() { return this.unit.abilities.find((a) => a.data.Name === 'Borrowed Decree'); } // locked or not, it has the Ghouls' numbers (by name: Sinclair may hold a copy)
  want(fight) { return fight.foes.length > 0; }

  raise(fight, count) {
    const d = this.decree;
    for (let i = 0; i < count && this.ghouls.length < d.data.SummonMaxCount; i++) {
      this.ghouls.push({ arrive: fight.time + WALK / (1 + d.value('MoveSpeedPercent') / 100), until: fight.time + d.value('SummonLifetime'), next: 0, health: d.value('SummonHealth') });
    }
  }

  grab(fight, reach, hurt) {
    for (const e of fight.near(reach)) {
      if (hurt) fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'grasping_hands', duration: this.value('ImmobilizeDuration'), tags: ['immobilize'], debuff: true });
    }
  }

  cast(fight) {
    const reach = this.value('ZombieWallLength') / 2;
    this.grab(fight, reach, true);
    this.raise(fight, this.value('SummonCount'));
    if (this.tier >= 1) fight.at(this.value('AbilityDuration'), () => fight.running(this, () => { if (this.unit.alive) this.grab(fight, reach, false); }));
  }

  // A Ghoul is gone (blown up, killed or out of time). T3 of Borrowed Decree: its death takes a share of the current health of the enemies around.
  bury(fight, ghoul) {
    const d = this.decree;
    this.ghouls = this.ghouls.filter((g) => g !== ghoul);
    const share = d.value('CurrentHealthDamagePercentage') / 100;
    if (share) for (const e of fight.near(d.value('ExplosionRadius'))) fight.damage(this.unit, e, e.health * share * (e.team === 'hero' ? 1 : npcShare(e)), 'spirit');
    const jar = find(this.unit, JarOfDead);
    jar?.collect(fight, jar.data.PickupsPerDeath);
  }

  tick(fight) {
    const d = this.decree;
    const theft = find(this.unit, EssenceTheft);
    for (const g of [...this.ghouls]) {
      if (g.health <= 0 || fight.time >= g.until) { this.bury(fight, g); continue; }
      const front = fight.foes[0];
      if (!front || fight.time < g.arrive || fight.time + 1e-9 < g.next) continue;
      if (front.team === 'hero' || isBoss(front)) {
        for (const e of fight.near(d.value('ExplosionRadius'))) {
          fight.damage(this.unit, e, d.value('Damage'), 'spirit');
          fight.addStatus(e, { id: 'ghoul_slow', duration: d.value('SlowDuration'), mods: { slow: d.data.SlowPercent / 100 }, debuff: true });
          theft?.summoned(fight, e, 'ZombieExplosionBuildUp');
        }
        this.bury(fight, g);
        continue;
      }
      g.next = fight.time + SWING;
      for (const e of fight.near(d.data.SummonSearchRadius)) {
        fight.damage(this.unit, e, d.value('SummonMeleeDamage'), 'melee');
        theft?.summoned(fight, e, 'ZombieMeleeBuildUp');
      }
    }
  }

  on(event, fight, hit) {
    if (event !== 'attacked' || hit.target !== this.unit || !hit.opts.attack || hit.source.team !== 'enemy') return;
    const ghoul = this.ghouls.find((g) => g.health > 0 && fight.time >= g.arrive);
    if (!ghoul || !(fight.rng() < DRAW_FIRE)) return;
    ghoul.health -= hit.amount;
    hit.amount = 0;
  }
}

// 3. Essence Theft (passive): shooting an enemy steals its weapon damage and spirit resist, up to the maximum after ShootDurationForMax seconds
// of shots: it loses them, Graves gains them. Bullets build less from far away (the game data's falloff: half at 17 m; the wiki). Left alone for
// a moment it drains again, and it is gone when the enemy dies. An enemy that deals spirit damage loses no damage, a 'mixed' one half (like the
// Doorman's bell); a rival hero's gun loses it as weapon damage. T1 / T2: more to steal. T3: one more enemy at a time, and her summons steal too.
class EssenceTheft extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    this.stolen = new Map(); // enemy -> { share 0-1, last: when it last built }
    this.weapon = 0; // weapon damage she has right now, for the fight message
  }

  status() { return this.weapon ? `+${Math.round(this.weapon * 100)}% Weapon` : 'Passive'; }

  build(fight, target, share) {
    if (!target.alive || target === this.unit || !(share > 0)) return;
    let s = this.stolen.get(target);
    if (!s) {
      if (this.stolen.size >= this.value('MaxStolenTargets')) return;
      this.stolen.set(target, s = { share: 0 });
    }
    s.share = Math.min(1, s.share + share);
    s.last = fight.time;
  }

  summoned(fight, target, field) { this.build(fight, target, this.value(field)); } // T3: a Deadhead's strike, a Ghoul's claw or blast

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit) return;
    const w = HEROES[this.unit.name].Weapon;
    const d = fight.distance(this.unit, p.target);
    const far = Math.min(1, Math.max(0, (d - w.FalloffStartRange) / (w.FalloffEndRange - w.FalloffStartRange)));
    this.build(fight, p.target, (w.FalloffStartScale + (w.FalloffEndScale - w.FalloffStartScale) * far) / (this.data.ShootDurationForMax * this.unit.stats.fireRate));
  }

  tick(fight) {
    let weapon = 0;
    let through = 1; // her stolen spirit resists multiply (the wiki)
    for (const [e, s] of this.stolen) {
      if (fight.time - s.last > this.data.DebuffModifier.BuildUpDecayDelay) s.share -= (DT * this.data.ProgressLossMultiplier) / this.data.ShootDurationForMax;
      if (!e.alive || s.share <= 0) { this.stolen.delete(e); continue; }
      const damage = (s.share * this.value('MaxStolenAttackDamage')) / 100;
      const resist = (s.share * this.value('MaxStolenSpiritResist')) / 100;
      const mods = { spiritResist: -resist };
      if (e.team === 'hero') mods.weaponDamage = -damage;
      else if (e.stats.damageType !== 'spirit') mods.damageDealt = -damage * (e.stats.damageType === 'mixed' ? 0.5 : 1);
      fight.addStatus(e, { id: 'essence_theft', duration: DT * 1.5, mods, debuff: true });
      weapon += damage;
      through *= 1 - resist;
    }
    this.weapon = weapon;
    if (weapon) fight.addStatus(this.unit, { id: 'essence_stolen', duration: DT * 1.5, mods: { weaponDamage: weapon, spiritResist: 1 - through } });
  }
}

// 4. Borrowed Decree: after a short channel, a gravestone that raises Ghouls every few seconds while it stands (see Grasping Hands for what a
// Ghoul does). T1: faster Ghouls. T2: it stands longer and raises them faster. T3: a Ghoul's death takes a share of current health.
class BorrowedDecree extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.next = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Summoning' : super.status(fight); }

  cast(fight) {
    const channel = this.value('AbilityChannelTime');
    fight.addStatus(this.unit, { id: 'decree_channel', duration: channel, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + channel);
    fight.at(channel, () => {
      if (!this.unit.alive) return;
      this.until = fight.time + this.value('AbilityDuration');
      this.next = fight.time + this.data.SummonInitialDelay;
    });
  }

  tick(fight) {
    if (fight.time >= this.until || fight.time + 1e-9 < this.next) return;
    this.next += this.value('SummonFrequency');
    find(this.unit, GraspingHands)?.raise(fight, this.data.SummonBurstCount);
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Jar of Dead', 'Throws a jar of Deadheads that keep striking the enemy. Only the death of things nearby refills the jar.'],
  ['Grasping Hands', 'Opens a rift under the enemies that damages and immobilizes them, and raises a Ghoul.'],
  ['Essence Theft', 'The gun steals weapon damage and spirit resist from the enemy it is on.'],
  ['Borrowed Decree', 'Raises a gravestone that keeps summoning Ghouls. Ghouls claw at Haunts and troopers, draw fire, and blow up on anything bigger.'],
];

// copyWith: what a copy of the ultimate needs beside it (Sinclair's Audience Participation): Grasping Hands keeps the Ghouls.
module.exports = { name: 'Graves', abilities: { 1: JarOfDead, 2: GraspingHands, 3: EssenceTheft, 4: BorrowedDecree }, info, DRAW_FIRE, copyWith: [2] };
