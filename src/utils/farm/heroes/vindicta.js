// Vindicta's abilities (deadlock.wiki/Vindicta, checked Oct 5 2026; page updated that day). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. Standing rules used: "hero kill" bonuses count any enemy and last the fight only;
// health shares are cut against NPCs; like Apollo's ultimate, Assassinate is held for an enemy below half health.
const { Ability } = require('./../ability');
const { DT, headshotChance } = require('./../engine');
const { HEROES } = require('./../stats');
const { npcShare } = require('./../items');
const { stackResist } = require('./../buffs');

// 1. Stake: a stake among the enemies: spirit damage and a slow on those around the front one, tethered for a moment (nobody walks away here,
// so the tether itself changes nothing). T1: more damage. T2: far shorter cooldown. T3: longer, wider.
class Stake extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    for (const e of fight.near(this.value('CaptureRadius'))) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'stake', duration: this.value('ChainDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    }
  }
}

// 2. Flight: in the air for a while (enemies still shoot at her): every bullet deals spirit damage on top. T1: while flying, +50% of her base
// clip to her max ammo, and taking off restores 50% of her max ammo (rounded up, never past the new max; it doesn't reload: the wiki, Oct 29).
// T2: longer. T3: more spirit damage a bullet, and a kill starts the flight's time over. (The wiki's +50% item range while flying isn't here:
// the fights have no item cast range.)
class Flight extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.extraClip = 0; // T1's max ammo while flying
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Flying' : super.status(fight); }

  cast(fight) {
    this.until = fight.time + this.value('AbilityDuration');
    const pct = this.value('BonusClipSizePercent') / 100;
    if (!pct || this.extraClip) return;
    const s = this.unit.stats;
    const w = this.unit.weapon;
    const restore = Math.ceil(s.clip * pct);
    this.extraClip = Math.round(HEROES.Vindicta.Weapon.ClipSize * pct);
    s.clip += this.extraClip;
    if (w.reloadLeft <= 0) w.clip = Math.min(s.clip, w.clip + restore);
  }

  tick(fight) {
    if (fight.time < this.until) fight.addStatus(this.unit, { id: 'flight', duration: DT * 1.5, tags: ['airborne'] });
    else if (this.extraClip) { // landed: the extra ammo goes
      this.unit.stats.clip -= this.extraClip;
      this.unit.weapon.clip = Math.min(this.unit.weapon.clip, this.unit.stats.clip);
      this.extraClip = 0;
    }
  }

  on(event, fight, p) {
    if (p.source !== this.unit || fight.time >= this.until) return;
    if (event === 'bulletHit' && !p.opts.split && p.target.alive) fight.running(this, () => fight.damage(this.unit, p.target, this.value('MagicDamagePerBullet'), 'spirit', { proc: true }));
    else if (event === 'kill' && this.value('RefreshOnKill')) this.until = fight.time + this.value('AbilityDuration');
  }
}

// 3. Crow Familiar: the crow hits the front enemy: spirit damage, less bullet and spirit resist for a while, and a bleed of a share of its
// current health every second (cut against NPCs). T1: it heals less. T2: a stronger bleed, shorter cooldown. T3: longer, bigger shreds.
class CrowFamiliar extends Ability {
  constructor(...args) {
    super(...args);
    this.bleeds = []; // [{ e, until, next }]
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    const duration = this.value('DebuffDuration');
    fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit');
    fight.addStatus(e, { id: 'crow_familiar', duration, debuff: true, mods: { bulletResist: this.value('BulletResistReduction') / 100, spiritResist: this.value('TechArmorDamageReduction') / 100, healAmp: this.value('HealAmpReceivePenaltyPercent') / 100 } });
    this.bleeds = this.bleeds.filter((b) => b.e !== e);
    this.bleeds.push({ e, until: fight.time + duration, next: fight.time + this.data.TickRate });
  }

  tick(fight) {
    this.bleeds = this.bleeds.filter((b) => b.e.alive && b.next <= b.until + 1e-9);
    for (const b of this.bleeds) {
      if (fight.time + 1e-9 < b.next) continue;
      b.next += this.data.TickRate;
      fight.damage(this.unit, b.e, ((b.e.health * this.value('DotHealthPercent')) / 100) * this.data.TickRate * (b.e.team === 'hero' ? 1 : npcShare(b.e)), 'spirit');
    }
  }
}

// 4. Assassinate: held for an enemy below half health (the weakest one, wherever it stands): a second scoped without shooting, then the shot:
// spirit damage, plus a bonus that grows the lower the target is below half. A kill (the enemy dead within KILL_WINDOW of the shot) adds
// weapon damage for the rest of the fight; the shot waits for an enemy it will kill in time. 2 charges, 2.5 s apart (the wiki's, ability.js),
// and a headshot adds 20%. (The wiki's kill window is 4 s; KILL_WINDOW is his 3. It pierces in the game; here it hits only its target.)
// T1: shorter cooldown. T2: a bigger bonus. T3: more weapon damage per kill. (The game's bonus souls for a kill are not paid here.)
const KILL_WINDOW = 3; // seconds after the shot that its kill still counts (his call, Oct 29)
class Assassinate extends Ability {
  constructor(...args) {
    super(...args);
    this.kills = this.carried(); // a Descend run's kills (ability.js carried; the game keeps them all match)
    this.marked = []; // [{ e, until }] enemies shot, while their death still counts
  }

  keep() { return this.kills; }
  stackText() { return this.kills ? `${this.kills} kills: +${+(this.kills * this.value('WeaponDamageBonusPerKill')).toFixed(1)}% Weapon Damage` : null; }

  // the shot's damage on `e` (more the lower it is below half)
  shot(e) {
    const low = this.data.LowHealthEnemyThresholdPct / 100;
    const under = Math.max(0, 1 - e.health / e.stats.maxHealth / low); // 0 at half health, 1 at none left
    return this.value('Damage') + this.value('LowHealthEnemyDamageBonus') * under;
  }

  // An enemy below half health that the shot, and what the hero deals after it, kills within KILL_WINDOW: only then does the kill count
  // (his call, Oct 29), so the shot waits for one. The weakest such enemy first.
  // Every charge in hand counts (Oct 29, his ask: she held both on a Walker at 1k of 4k): the next one fires a gap and a scope later, and its own
  // kill window starts then.
  prey(fight) {
    const low = this.data.LowHealthEnemyThresholdPct / 100;
    const shots = Math.max(1, this.charges);
    const seconds = KILL_WINDOW + (shots - 1) * (this.chargeGap + this.castDelay);
    const landed = (e) => this.shot(e) * (1 - Math.min(0.9, stackResist(e.stats.spiritResist, e.mod('spiritResist')))); // after its spirit resist (a boss's)
    return fight.foes.filter((e) => e.health < e.stats.maxHealth * low && this.diesWithin(fight, e, landed(e) * shots, seconds))
      .sort((a, b) => a.health / a.stats.maxHealth - b.health / b.stats.maxHealth)[0];
  }

  get castDelay() { return this.data.TimeToFullCharge; }
  want(fight) { return !!this.prey(fight); }
  status(fight) { return this.kills ? `${super.status(fight)}  -  +${this.kills * this.value('WeaponDamageBonusPerKill')}% Weapon` : super.status(fight); }

  on(event, fight, p) {
    // a marked enemy dying within KILL_WINDOW of a shot, whatever killed it: counted as it dies (the fight ends on the last one's death)
    if (event === 'kill' && this.marked.some((m) => m.e === p.target && m.until >= fight.time)) { this.kills += 1; this.marked = this.marked.filter((m) => m.e !== p.target); }
    if (event !== 'cast' || p.ability !== this) return;
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
    this.aim = this.prey(fight); // the enemy it scopes in on
  }

  cast(fight) {
    // the enemy it aimed at; if that one died while scoping, another below half health; never one above half (his call, Oct 29)
    const low = this.data.LowHealthEnemyThresholdPct / 100;
    const e = this.aim?.alive ? this.aim : this.prey(fight) ?? fight.foes.filter((f) => f.health < f.stats.maxHealth * low)[0];
    this.aim = null;
    if (!e) return;
    const head = fight.rng() < headshotChance(this.unit) ? 1 + this.data.HeadshotBonus / 100 : 1; // a headshot: +20% (the wiki)
    const marked = this.marked.some((m) => m.e === e); // the kill event only counts an enemy already shot
    if (!marked) this.marked.push({ e, until: fight.time + KILL_WINDOW });
    fight.damage(this.unit, e, this.shot(e) * head, 'spirit');
    if (marked && e.alive) for (const m of this.marked) if (m.e === e) m.until = fight.time + KILL_WINDOW; // a second shot starts its window over
  }

  tick(fight) {
    this.kills += new Set(this.marked.filter((m) => !m.e.alive).map((m) => m.e)).size; // died without a kill event (two shots, one kill)
    this.marked = this.marked.filter((m) => m.e.alive && m.until > fight.time);
    if (this.kills) fight.addStatus(this.unit, { id: 'assassinate', duration: DT * 1.5, mods: { weaponDamage: (this.kills * this.value('WeaponDamageBonusPerKill')) / 100 } });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Stake', 'Throws a stake that damages and slows the enemies around it.'],
  ['Flight', 'Takes to the air for a while: every bullet deals bonus spirit damage.'],
  ['Crow Familiar', 'Sends a crow that damages an enemy, weakens its resists and makes it bleed.'],
  ['Assassinate', 'Waits for a weakened enemy, then fires a scoped shot that hits harder the lower its health. Kills add weapon damage.'],
];

module.exports = { name: 'Vindicta', abilities: { 1: Stake, 2: Flight, 3: CrowFamiliar, 4: Assassinate }, info };
