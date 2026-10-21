// Nurse Harrow's abilities (deadlock.wiki/Nurse_Harrow, checked Oct 20 2026, the day she came out; the page is still being written). Numbers come
// from the wiki data through Ability.value(); this file is only what each ability does. Standing rules used: "on hero hit" is any enemy; a buff
// that lasts the match lasts the rest of the fight; a heal meant for allies is her own (Kelvin's rule), so her syringes heal her.
// Taken by me (say if wrong): the 4 leeches share out over the enemies in the jar's radius (a lone enemy carries all 4) and crawl back LEECH_RETURN s
// after they finish; Wretched Vapors goes on herself whenever it is ready, and the specters still there when the rush ends hit her at once;
// she loads her syringes below NEEDLES_BELOW of her health and puts them away at full health (the rest of the clip is refunded as a partial charge);
// her syringes heal the moment they land; Lurking Terrors fears every enemy in its reach once per cast (enemies on a farm always face her).
// Not simulated: the leeches' hunting and crawling, headshots, the fear's direction.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');

const LEECH_RETURN = 1; // ponytail: seconds a fed leech takes to crawl back to her; placeholder
const NEEDLES_BELOW = 0.6; // ponytail: the share of her max health below which she loads her syringes; placeholder
const boons = (a) => a.unit.boons ?? 0;
// a "power_increase" number: what the wiki data adds per boon (Ability.value() doesn't read it)
const perBoon = (field) => [].concat(field?.Scale ?? []).find((s) => s.Type === 'power_increase')?.Value ?? 0;
const leeches = (unit) => unit.abilities.find((a) => a instanceof LeechTherapy)?.stacks ?? 0; // a copy of her ultimate (Sinclair) has none
const slower = (e, share) => (e.team === 'hero' ? { fireRate: -share } : { damageDealt: -share }); // an NPC attacking slower deals that much less (Kelvin's rule)
function addStamina(unit, amount) {
  const max = Math.max(0, Math.floor(unit.stat('stamina')));
  unit.staminaCharge += amount;
  while (unit.staminaCharge >= 1 && unit.stamina < max) { unit.stamina++; unit.staminaCharge -= 1; }
  if (unit.stamina >= max) unit.staminaCharge = 0;
}

// 1. Leech Therapy: a jar of leeches bursts on the front enemy; they latch on to the enemies around it and feed: spirit damage over time, and a rival
// hero's buffs run out faster. Fed leeches crawl back to her: she heals what they drained and keeps each one, up to a maximum, for the rest of the
// fight: health regen and fire rate per leech. T1: each leech brings her the stamina it drained. T2: shorter cooldown, spirit power per leech.
// T3: a wider jar, more damage, more leeches kept.
class LeechTherapy extends Ability {
  constructor(...args) {
    super(...args);
    this.stacks = 0;
    this.feeding = []; // [{ e, until, drained }]
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return this.stacks ? `${super.status(fight)}  -  ${this.stacks} Leeches` : super.status(fight); }

  cast(fight) {
    const hit = fight.near(this.value('Radius'));
    if (!hit.length) return;
    const until = fight.time + this.value('AbilityDuration');
    for (let i = 0; i < this.data.LeechCount; i++) this.feeding.push({ e: hit[i % hit.length], from: fight.time, until, drained: 0 });
  }

  tick(fight, dt) {
    const u = this.unit;
    for (const leech of this.feeding.filter((l) => fight.time < l.until && l.e.alive)) {
      leech.drained += fight.damage(u, leech.e, this.value('DPS') * dt, 'spirit');
      for (const s of leech.e.statuses) if (!s.debuff && s.until - fight.time > 0.5 && s.until !== Infinity) s.until -= this.data.LeechEatDurationPerSecond * dt;
    }
    for (const leech of this.feeding.filter((l) => fight.time >= l.until || !l.e.alive)) {
      this.feeding.splice(this.feeding.indexOf(leech), 1);
      fight.at(LEECH_RETURN, () => this.pickUp(fight, leech.drained, Math.min(fight.time, leech.until) - leech.from));
    }
    const mods = { fireRate: (this.stacks * this.data.FireRatePerLeechPickup) / 100, spirit: this.stacks * this.value('SpiritPowerPerLeechStack') };
    if (this.stacks) fight.addStatus(u, { id: 'leeches', duration: DT * 1.5, mods });
  }

  pickUp(fight, drained, fed) {
    const u = this.unit;
    if (!u.alive) return;
    fight.heal(u, (drained * this.data.HealPercentOfLeechDamage) / 100);
    if (this.value('LeechStaminaDrain')) addStamina(u, this.value('LeechStaminaDrain') * fed);
    if (this.stacks >= this.value('MaxLeechBonusStacks')) return;
    this.stacks++;
    u.stats.healthRegen = (u.stats.healthRegen ?? 0) + this.data.RegenPerLeechPickup.Value + perBoon(this.data.RegenPerLeechPickup) * boons(this);
  }
}

// 2. Wretched Vapors: a rush on herself, then a crash. During the rush everything she does is faster (fire rate, reloads, cooldowns) and the
// damage she takes is held back as specters; healing she gets meanwhile clears specters first. When the rush ends, the specters left hit her
// with extra damage, and for the crash everything is slower. T1: shorter cooldown. T2: a longer rush, more healing during it. T3: a faster
// rush, and the cast clears her debuffs (not crowd control).
const SPECTERS = 1e9; // the held-back damage is soaked by a barrier this big; what it soaked is the specters
class WretchedVapors extends Ability {
  constructor(...args) {
    super(...args);
    this.rush = 0;
    this.crash = 0;
    this.specters = 0;
    this.last = 0; // her health after the last step, to catch healing during the rush
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.rush ? 'Rushing' : fight && fight.time < this.crash ? 'Crashing' : super.status(fight); }

  cast(fight) {
    const u = this.unit;
    const length = this.value('AbilityDuration');
    this.rush = fight.time + length;
    this.crash = this.rush + this.data.CrashDuration;
    this.specters = 0;
    this.last = u.health;
    if (this.value('DispelDebuffs')) fight.cleanse(u, 1, { stuns: false });
    const speed = this.value('RushTimeScaleBonusPercent') / 100;
    fight.addStatus(u, { id: 'specter_rush', duration: length, barrier: SPECTERS, mods: { fireRate: speed, reloadSpeed: speed, healAmp: this.value('HealingEffectivenessPercent') / 100 } });
    fight.at(length, () => this.wearOff(fight));
  }

  held(u) { const s = u.statuses.find((x) => x.id === 'specter_rush'); return s ? SPECTERS - s.barrier : 0; }

  tick(fight, dt) {
    const u = this.unit;
    if (fight.time < this.rush) {
      this.specters = this.held(u);
      const healed = u.health - this.last;
      if (healed > 0 && this.specters > 0) { // healing clears specters before it heals her
        const cleared = Math.min(healed, this.specters);
        u.health -= cleared;
        u.statuses.find((x) => x.id === 'specter_rush').barrier += cleared;
        this.specters -= cleared;
      }
      this.last = u.health;
      this.speedUp(fight, dt * (this.value('RushTimeScaleBonusPercent') / 100));
    } else if (fight.time < this.crash) {
      fight.addStatus(u, { id: 'specter_crash', duration: DT * 1.5, mods: { fireRate: -this.data.CrashTimeScalePenaltyPercent / 100, reloadSpeed: -this.data.CrashTimeScalePenaltyPercent / 100 } });
      this.speedUp(fight, -dt * (this.data.CrashTimeScalePenaltyPercent / 100));
    }
  }

  // her other cooldowns run faster (or slower) by `extra` seconds this step
  speedUp(fight, extra) {
    for (const a of this.unit.abilities) if (a !== this && a.cdLeft > 0) a.cdLeft = Math.max(0, a.cdLeft - extra);
    for (const it of this.unit.items) if (it.cdLeft > 0) it.cdLeft = Math.max(0, it.cdLeft - extra);
  }

  wearOff(fight) {
    const u = this.unit;
    const owed = this.held(u);
    fight.removeStatus(u, 'specter_rush');
    this.specters = 0;
    if (u.alive && owed > 0) fight.damage(u, u, owed * (1 + this.data.DeferredDamageBonusPercent / 100), 'true', { events: false });
  }
}

// 3. Healing Needles: when she is hurt and has a charge, she swaps her gun for a clip of syringes and shoots herself with them (the gun is held
// meanwhile): each heals her. She puts them away at full health, the unused syringes coming back as part of a charge. Charges come back from
// the damage she deals (a third as fast against non-heroes) and slowly from each leech she keeps; cooldown reduction speeds that up.
// T1: a second charge. T2: more healing, and each syringe gives back stamina. T3: better scaling, and each syringe stretches her buffs (not her
// ultimate's) a little, up to twice their length.
class HealingNeedles extends Ability {
  constructor(...args) {
    super(...args);
    this.stock = this.data.AbilityChargesInitial;
    this.meter = 0; // % of the next charge
    this.loaded = 0; // syringes left in the clip
    this.swapAt = 0;
    this.shot = 0;
    this.lastHit = -Infinity;
    this.stretched = new Map(); // status -> { cap, done }: how far it may be stretched in all, and how far it has been
  }

  // its own charges (the meter, not a cooldown); the cooldown is the swap back to the gun after putting them away (the wiki's SwapEndDelay)
  get cooldown() { return this.data.SwapEndDelay; }
  tickCooldown(dt) { this.cdLeft = Math.max(0, this.cdLeft - dt); }
  ready() { return !this.unit.cantAct && this.stock >= 1 && !this.loaded && this.cdLeft <= 0; }
  use() { this.stock -= 1; }
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * NEEDLES_BELOW; }
  status() { return this.loaded ? 'Syringes' : this.stock >= 1 ? (this.stock > 1 ? `Ready x${this.stock}` : 'Ready') : `${Math.floor(this.meter)}%`; }

  gain(share) {
    this.meter += share * (100 / Math.max(1, this.value('ChargeGenPctScale')));
    while (this.meter >= 100) { this.meter -= 100; this.stock = Math.min(this.maxCharges, this.stock + 1); }
    if (this.stock >= this.maxCharges) this.meter = Math.min(this.meter, 99);
  }

  cast(fight) {
    const u = this.unit;
    this.loaded = Math.max(1, Math.round(u.stats.clip));
    this.swapAt = fight.time + this.data.SwapInDelay;
    this.shot = 0;
    u.busyUntil = Math.max(u.busyUntil, this.swapAt + DT);
  }

  tick(fight, dt) {
    const u = this.unit;
    if (this.stock < this.maxCharges) this.gain(this.data.ChargePercentPerSecondPerLeech * leeches(u) * dt);
    if (!this.loaded || fight.time < this.swapAt || u.cantAct || u.has('stun')) return;
    if (u.health >= u.stats.maxHealth) { this.putAway(fight); return; }
    u.busyUntil = Math.max(u.busyUntil, fight.time + DT * 1.5);
    this.shot += u.stats.fireRate * (1 + u.mod('fireRate')) * dt;
    while (this.shot >= 1 && this.loaded > 0) {
      this.shot -= 1;
      this.loaded--;
      fight.heal(u, this.value('HealRegen'));
      if (this.value('StaminaRestorePerHit')) addStamina(u, this.value('StaminaRestorePerHit'));
      if (this.value('BuffExtendPercentPerShot')) this.stretch(fight);
    }
    if (!this.loaded) this.putAway(fight);
  }

  // ponytail: a status keeps no length of its own, so the cap is what was left of it the first time it was stretched
  stretch(fight) {
    for (const s of this.unit.statuses) {
      if (s.debuff || s.ult || s.until === Infinity || s.until - fight.time < 0.5) continue;
      const left = s.until - fight.time;
      const done = this.stretched.get(s) ?? { cap: left * (this.data.BuffExtendMaxDurationPercent / 100 - 1), done: 0 };
      const add = Math.min(left * (this.value('BuffExtendPercentPerShot') / 100), done.cap - done.done);
      if (add <= 0) continue;
      s.until += add;
      this.stretched.set(s, { ...done, done: done.done + add });
    }
  }

  putAway(fight) {
    const u = this.unit;
    if (this.loaded) this.gain((this.loaded / Math.max(1, Math.round(u.stats.clip))) * 100);
    this.loaded = 0;
    this.cdLeft = this.cooldown;
    u.busyUntil = Math.max(Math.min(u.busyUntil, fight.time), fight.time + this.cooldown);
  }

  on(event, fight, p) {
    if (event !== 'damage' || p.source !== this.unit || p.target === this.unit || !(p.dealt > 0) || this.stock >= this.maxCharges) return;
    if (fight.time - this.lastHit < this.data.ChargeHitCooldown) return;
    this.lastHit = fight.time;
    const per = p.opts.melee ? this.data.ChargePercentPerHeavyMelee : p.type === 'bullet' ? this.data.ChargePercentPerBulletHit : this.data.ChargePercentPerAbilityHit;
    this.gain(per * (p.target.team === 'hero' ? 1 : this.data.NonHeroChargeScalePercent / 100));
  }
}

// 4. Lurking Terrors: after opening her bag she channels (no shooting): spirit damage every moment to the enemies within its reach, who are
// slowed and attack slower; each one that has looked at her long enough flees in fear (it can't attack or use its abilities) for a while, longer
// with every leech she keeps. A boss shrugs off part of the fear. T1: shorter cooldown. T2: a bigger slow, more damage. T3: a longer channel,
// better scaling, and she can't be hurt while channelling.
class LurkingTerrors extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.terror = new Map(); // enemy -> seconds looked at her this cast, or 'feared'
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Channeling' : super.status(fight); }

  reach(fight) {
    const front = fight.foes[0];
    return front ? fight.foes.filter((e) => fight.distance(this.unit, front) + (e.offset ?? 0) - (front.offset ?? 0) <= this.value('AbilityCastRange')) : [];
  }

  cast(fight) {
    const u = this.unit;
    const length = this.value('AbilityChannelTime');
    this.until = fight.time + length;
    this.terror = new Map();
    u.busyUntil = Math.max(u.busyUntil, this.until);
    if (this.value('ChannelDamageImmune')) fight.addStatus(u, { id: 'terrors_immune', duration: length, mods: { damageTaken: -1 }, ult: true });
  }

  tick(fight, dt) {
    if (fight.time >= this.until) return;
    const u = this.unit;
    if (u.cantAct || u.has('stun')) { this.until = fight.time; u.busyUntil = Math.min(u.busyUntil, fight.time); fight.removeStatus(u, 'terrors_immune'); return; }
    const linger = this.data.SlowLingerDuration;
    for (const e of this.reach(fight)) {
      fight.damage(u, e, this.value('DPS') * dt, 'spirit');
      if (!e.alive) continue;
      fight.addStatus(e, { id: 'terrors_slow', duration: linger, mods: { slow: this.value('SlowPercent') / 100, ...slower(e, this.value('FireRateSlow') / 100) }, debuff: true });
      const looked = this.terror.get(e) ?? 0;
      if (looked === 'feared') continue;
      if (looked + dt + 1e-9 < this.data.BuildupTime) { this.terror.set(e, looked + dt); continue; }
      this.terror.set(e, 'feared');
      const fear = this.value('DebuffDuration') + this.value('FearDurationPerLeechStack') * leeches(u);
      fight.addStatus(e, { id: 'terrors_fear', duration: fear, tags: ['disarm', 'silence'], debuff: true });
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Leech Therapy', 'Throws a jar of leeches that feed on enemies. Fed leeches come back to heal and stay for the fight: regen and fire rate.'],
  ['Wretched Vapors', 'A rush that speeds up everything and holds back damage taken, then a crash where the held damage lands.'],
  ['Healing Needles', 'Loads a clip of healing syringes when hurt. Charges come back from dealing damage and from kept leeches.'],
  ['Lurking Terrors', 'Opens a bag of horrors: spirit damage and a slow on the enemies in front, who flee in fear once terrified.'],
];

module.exports = { name: 'Nurse Harrow', abilities: { 1: LeechTherapy, 2: WretchedVapors, 3: HealingNeedles, 4: LurkingTerrors }, info };
