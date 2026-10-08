// Shiv's abilities (deadlock.wiki/Shiv, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value(); this file
// is only what each ability does. Standing rules used: Killing Blow's execute threshold is cut against NPCs like every health share (his call for
// Grey Talon's owl), and so is the knives' current-health damage. Taken by me: rage is full at BonusAbilityResource (10) in the game data.
const { Ability } = require('./../ability');
const { DT, MELEE } = require('./../engine');
const { npcShare } = require('./../items');
const { stackResist } = require('./../buffs');

const enraged = (unit) => !!unit.abilities.find((a) => a instanceof KillingBlow)?.full;
const share = (e) => (e.team === 'hero' ? 1 : npcShare(e));

// 1. Serrated Knives: a knife at the front enemy: a bleed of spirit damage every second; each knife adds a stack and starts the bleed's time
// again. At full rage a knife also takes a share of the target's current health and slows it. T1: longer. T2: more charges. T3: more bleed.
class SerratedKnives extends Ability {
  constructor(...args) {
    super(...args);
    this.bleeds = new Map(); // enemy -> { stacks, until, next }
  }

  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    if (enraged(this.unit)) {
      fight.damage(this.unit, e, ((e.health * this.value('FullRageCurrentHealthDamagePct')) / 100) * share(e), 'spirit');
      fight.addStatus(e, { id: 'serrated_slow', duration: this.value('BleedDuration'), mods: { slow: this.data.MovementSlow / 100 }, debuff: true });
    }
    const b = this.bleeds.get(e) ?? { stacks: 0, next: fight.time + this.data.BleedTickRate };
    b.stacks += 1;
    b.until = fight.time + this.value('BleedDuration');
    this.bleeds.set(e, b);
  }

  tick(fight) {
    for (const [e, b] of this.bleeds) {
      if (!e.alive || b.next > b.until + 1e-9) { this.bleeds.delete(e); continue; }
      if (fight.time + 1e-9 < b.next) continue;
      b.next += this.data.BleedTickRate;
      fight.damage(this.unit, e, b.stacks * this.value('BleedDPSPerStack') * this.data.BleedTickRate, 'spirit');
    }
  }
}

// 2. Slice and Dice: a dash through the enemies in its path: spirit damage, and each hit takes spirit resist off them (stacking, each stack on
// its own clock). At full rage an echo retraces the dash a moment later and hits them again. T1: shorter cooldown. T2: a bigger shred, further.
// T3: more damage, and every enemy hit takes time off the cooldown.
const ECHO = 1; // seconds until the echo. ponytail: the wiki says "after a short delay"
class SliceAndDice extends Ability {
  constructor(...args) {
    super(...args);
    this.shreds = new Map(); // enemy -> [when each stack runs out]
  }

  want(fight) { return fight.foes.length > 0; }

  slash(fight) {
    const hit = fight.near(this.value('DashRange'));
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('ImpactDamage'), 'spirit');
      this.shreds.set(e, [...(this.shreds.get(e) ?? []), fight.time + this.value('DebuffDuration')]);
    }
    return hit;
  }

  cast(fight) {
    const hit = this.slash(fight);
    this.unit.close = fight.foes[0] ?? null;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
    const cut = Math.min(this.value('MaxCooldownReductionsFromHits'), hit.length) * 1;
    for (const e of hit.slice(0, cut)) this.cdLeft = Math.max(0, this.cdLeft - this.value(e.team === 'hero' ? 'CooldownReductionOnHit' : 'CooldownReductionOnHitNonHero'));
    if (enraged(this.unit)) fight.at(ECHO, () => fight.running(this, () => { if (this.unit.alive) this.slash(fight); }));
  }

  tick(fight) {
    for (const [e, stacks] of this.shreds) {
      const left = stacks.filter((until) => until > fight.time);
      if (!e.alive || !left.length) { this.shreds.delete(e); continue; }
      this.shreds.set(e, left);
      fight.addStatus(e, { id: 'slice_and_dice', duration: DT * 1.5, mods: { spiritResist: (left.length * this.value('TechArmorDamageReduction')) / 100 }, debuff: true });
    }
  }
}

// 3. Bloodletting: always on: a share of every hit Shiv takes is put off and bled out over the next seconds instead (more at full rage). Used
// when a lot is waiting: it clears a share of it. T1: shorter cooldown. T2: clears more. T3: more is put off.
const WORTH = 0.08; // cast once the damage waiting is this share of max health
class Bloodletting extends Ability {
  constructor(...args) {
    super(...args);
    this.owed = []; // [{ perSecond, until }]
  }

  waiting(fight) { return this.owed.reduce((sum, o) => sum + o.perSecond * Math.max(0, o.until - fight.time), 0); }
  want(fight) { return this.waiting(fight) > this.unit.stats.maxHealth * WORTH; }

  cast(fight) {
    const keep = 1 - this.value('DeferClearPct') / 100;
    for (const o of this.owed) o.perSecond *= keep;
  }

  on(event, fight, hit) {
    if (event !== 'attacked' || hit.target !== this.unit || !(hit.amount > 0) || hit.source === this.unit) return;
    const put = (hit.amount * (this.value('DamagePctDeferred') + (enraged(this.unit) ? this.data.DamagePctDeferredMaxRage : 0))) / 100;
    hit.amount -= put;
    const resist = hit.type === 'bullet' ? stackResist(this.unit.stats.bulletResist, this.unit.mod('bulletResist')) : hit.type === 'spirit' ? stackResist(this.unit.stats.spiritResist, this.unit.mod('spiritResist')) : 0;
    const duration = this.value('DeferredDamageDuration');
    this.owed.push({ perSecond: (put * (1 - Math.min(0.9, resist))) / duration, until: fight.time + duration });
  }

  tick(fight, dt) {
    this.owed = this.owed.filter((o) => o.until > fight.time);
    const due = this.owed.reduce((sum, o) => sum + o.perSecond, 0) * dt;
    if (due > 0) fight.damage(this.unit, this.unit, due, 'true', { events: false });
  }
}

// 4. Killing Blow. Passive: dealing damage fills Shiv with rage (it drains again after a while without dealing any); at full rage he deals more
// damage and his other abilities change. Active, used when it will finish the front enemy: a leap for damage, and an enemy below the threshold
// (cut against NPCs like every health share) is executed outright; a kill makes it ready again for a while.
// T1: faster at full rage. T2: more damage at full rage, shorter cooldown. T3: a higher threshold.
class KillingBlow extends Ability {
  constructor(...args) {
    super(...args);
    this.rage = 0;
    this.lastHit = -Infinity;
    this.again = 0; // a kill lets him strike again until then
  }

  get full() { return this.rage >= this.data.BonusAbilityResource - 1e-9; }
  threshold(e) { return (this.value('EnemyHealthPercent') / 100) * share(e) * e.stats.maxHealth; }
  ready() { return super.ready() || (!this.unit.cantAct && this.again > 0); }
  status(fight) { return this.full && !super.ready() ? 'Enraged' : super.status(fight); }

  want(fight) {
    const e = fight.foes[0];
    return !!e && e.health <= Math.max(this.threshold(e), this.data.Damage);
  }

  use() {
    if (this.again > 0 && this.cdLeft > 0) return; // a recast: the cooldown is already running
    super.use();
  }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    this.again = 0;
    this.unit.close = e;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
    if (e.health <= this.threshold(e)) fight.damage(this.unit, e, e.health, 'true');
    else fight.damage(this.unit, e, this.data.Damage, 'spirit');
    if (!e.alive) this.again = fight.time + this.value('RecastWindow');
  }

  on(event, fight, p) {
    if (event !== 'damage' || p.source !== this.unit || p.target === this.unit || !(p.dealt > 0)) return;
    this.lastHit = fight.time;
    const gain = p.opts.melee ? this.data.RagePerHeavyMelee : p.dealt * (p.type === 'bullet' ? this.data.RagePerWeaponDamage : this.data.RagePerSpiritDamage);
    this.rage = Math.min(this.data.BonusAbilityResource, this.rage + gain);
  }

  tick(fight, dt) {
    if (this.again && fight.time > this.again) this.again = 0;
    if (fight.time - this.lastHit > this.value('RageDrainDelayDuration')) this.rage = Math.max(0, this.rage - this.data.RageDrainRate * dt);
    if (this.full) fight.addStatus(this.unit, { id: 'full_rage', duration: DT * 1.5, mods: { damageDealt: this.value('BuffDamage') / 100, moveSpeed: this.value('BonusMoveSpeed') } });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Serrated Knives', 'Throws a knife that makes an enemy bleed. More knives stack the bleed.'],
  ['Slice and Dice', 'Dashes through the enemies, damaging them and cutting their spirit resist.'],
  ['Bloodletting', 'Part of every hit taken is put off and bled out slowly. Activate to clear some of it.'],
  ['Killing Blow', 'Dealing damage builds rage, which powers up everything. Leaps to finish off a weakened enemy.'],
];

module.exports = { name: 'Shiv', abilities: { 1: SerratedKnives, 2: SliceAndDice, 3: Bloodletting, 4: KillingBlow }, info };
