// Vindicta's abilities (deadlock.wiki/Vindicta, checked Oct 5 2026; page updated that day). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. Standing rules used: "hero kill" bonuses count any enemy (Assassinate's are kept for good since Oct 11, ability.js KEEP);
// health shares are cut against NPCs; like Apollo's ultimate, Assassinate is held for an enemy below half health.
const { Ability, KEEP, keptStacks, keptOf } = require('./../ability');
const { DT } = require('./../engine');
const { npcShare } = require('./../items');

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

// 2. Flight: in the air for a while (enemies still shoot at her): every bullet deals spirit damage on top. T1: half a clip more ammo as she
// takes off. T2: longer. T3: more spirit damage a bullet, and a kill starts the flight's time over.
class Flight extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Flying' : super.status(fight); }

  cast(fight) {
    this.until = fight.time + this.value('AbilityDuration');
    const w = this.unit.weapon;
    if (this.value('BonusClipSizePercent') && w.reloadLeft <= 0) w.clip += Math.ceil((this.unit.stats.clip * this.value('BonusClipSizePercent')) / 100);
  }

  tick(fight) {
    if (fight.time < this.until) fight.addStatus(this.unit, { id: 'flight', duration: DT * 1.5, tags: ['airborne'] });
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
// spirit damage, plus a bonus that grows the lower the target is below half. A kill adds weapon damage, kept for good (ability.js KEEP).
// T1: shorter cooldown. T2: a bigger bonus. T3: more weapon damage per kill. (The game's bonus souls for a kill are not paid here.)
class Assassinate extends Ability {
  constructor(...args) {
    super(...args);
    this.kills = Math.min(KEEP.cap, keptOf(this, 'Vindicta').kills ?? 0); // kept from earlier fights
  }

  get bonus() { return keptStacks(this.kills) * this.value('WeaponDamageBonusPerKill'); }
  keep() { return { kills: this.kills }; }
  keptText() { return this.kills ? `${this.name}: ${this.kills} kills, +${+this.bonus.toFixed(1)}% Weapon Damage` : null; }

  prey(fight) {
    const low = this.data.LowHealthEnemyThresholdPct / 100;
    return fight.foes.filter((e) => e.health < e.stats.maxHealth * low).sort((a, b) => a.health / a.stats.maxHealth - b.health / b.stats.maxHealth)[0];
  }

  get castDelay() { return this.data.TimeToFullCharge; }
  want(fight) { return !!this.prey(fight); }
  status(fight) { return this.kills && !this.ready() ? `+${+this.bonus.toFixed(1)}% Weapon` : super.status(fight); }

  on(event, fight, p) {
    if (event === 'cast' && p.ability === this) this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + this.castDelay);
  }

  cast(fight) {
    const e = this.prey(fight) ?? fight.foes[0];
    if (!e) return;
    const low = this.data.LowHealthEnemyThresholdPct / 100;
    const under = Math.max(0, 1 - e.health / e.stats.maxHealth / low); // 0 at half health, 1 at none left
    fight.damage(this.unit, e, this.value('Damage') + this.value('LowHealthEnemyDamageBonus') * under, 'spirit');
    if (!e.alive) this.kills = Math.min(KEEP.cap, this.kills + 1);
  }

  tick(fight) {
    if (this.kills) fight.addStatus(this.unit, { id: 'assassinate', duration: DT * 1.5, mods: { weaponDamage: this.bonus / 100 } });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Stake', 'Throws a stake that damages and slows the enemies around it.'],
  ['Flight', 'Takes to the air for a while: every bullet deals bonus spirit damage.'],
  ['Crow Familiar', 'Sends a crow that damages an enemy, weakens its resists and makes it bleed.'],
  ['Assassinate', 'Waits for a weakened enemy, then fires a scoped shot that hits harder the lower its health. Kills add weapon damage for good.'],
];

module.exports = { name: 'Vindicta', abilities: { 1: Stake, 2: Flight, 3: CrowFamiliar, 4: Assassinate }, info };
