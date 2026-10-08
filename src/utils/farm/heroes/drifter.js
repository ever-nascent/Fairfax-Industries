// Drifter's abilities (deadlock.wiki/Drifter, checked Oct 3 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 3): an enemy in Eternal Night's darkness can't attack him at all. An enemy is "isolated" when it is
// the only one left standing, or in the darkness. Bloodscent's kill bonus lasts the fight only, like the other heroes' growing bonuses.
const { Ability } = require('./../ability');
const { DT, MELEE } = require('./../engine');
const { npcShare } = require('./../items');

const alone = (fight) => fight.enemies.filter((e) => e.alive).length === 1;
const isolated = (fight, e) => e.alive && (e.has('dark') || alone(fight));

// 1. Rend: a swipe through the enemies in reach for spirit damage (the wiki data calls it BonusDamage); the close ones also take melee damage.
// T3: a share of heavy melee damage instead, and the close ones are silenced.
class Rend extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const close = fight.near(this.value('RangeForBonusDamage'));
    for (const e of fight.near(this.value('AbilityCastRange'))) {
      fight.damage(this.unit, e, this.value('BonusDamage'), 'spirit');
      if (!close.includes(e)) continue;
      fight.damage(this.unit, e, this.value('Damage') + this.value('DamageHeavyMelee'), 'melee', { melee: true });
      fight.addStatus(e, { id: 'rend_silence', duration: this.value('DebuffDuration'), tags: ['silence'], debuff: true });
    }
  }
}

// 2. Stalker's Mark: the front enemy bleeds a share of its current health every tick (cut against NPCs like every health-share effect), and
// Drifter teleports behind it: he stands close to it for a moment. T1: it loses bullet resist. T3: it heals less.
class StalkersMark extends Ability {
  constructor(...args) {
    super(...args);
    this.mark = null; // { target, until, next }
  }

  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const target = fight.foes[0];
    if (!target) return;
    const duration = this.value('AbilityDuration');
    this.mark = { target, until: fight.time + duration, next: fight.time + this.data.TickRate };
    fight.addStatus(target, {
      id: 'stalkers_mark', duration, debuff: true,
      mods: { bulletResist: this.value('BulletResistReduction') / 100, healAmp: this.value('HealAmpReceivePenaltyPercent') / 100 },
    });
    this.unit.close = target;
    this.unit.closeUntil = fight.time + MELEE.closeFor;
  }

  tick(fight) {
    const m = this.mark;
    if (!m || fight.time + 1e-9 < m.next) return;
    if (!m.target.alive || fight.time > m.until + 1e-9) { this.mark = null; return; }
    m.next += this.data.TickRate;
    const share = m.target.team === 'hero' ? 1 : npcShare(m.target);
    fight.damage(this.unit, m.target, ((m.target.health * this.value('DotHealthPercent')) / 100) * this.data.TickRate * share, 'spirit');
  }
}

// 3. Bloodscent (passive): more damage to an isolated enemy; every isolated enemy that dies adds weapon damage for the rest of the fight.
// T1: faster while an enemy is isolated. T2: such a death heals part of the missing health and gives stamina back.
class Bloodscent extends Ability {
  get passive() { return true; }

  constructor(...args) {
    super(...args);
    this.kills = 0;
  }

  status() { return this.kills ? `+${this.kills * this.data.WeaponDmgPerIsolationKill}% Weapon` : 'Passive'; }

  tick(fight) {
    const prey = fight.enemies.filter((e) => isolated(fight, e));
    for (const e of prey) fight.addStatus(e, { id: 'bloodscent', duration: DT * 1.5, mods: { damageTaken: this.value('AmpDamagePercent') / 100 }, tags: ['isolated'] });
    const mods = { weaponDamage: (this.kills * this.data.WeaponDmgPerIsolationKill) / 100, moveSpeed: prey.length ? this.value('BonusMoveSpeed') : 0 };
    if (mods.weaponDamage || mods.moveSpeed) fight.addStatus(this.unit, { id: 'bloodscent_hunt', duration: DT * 1.5, mods });
  }

  on(event, fight, { target }) {
    if (event !== 'kill' || target === this.unit || !target.has('isolated') || target.scented) return;
    target.scented = true;
    this.kills++;
    fight.heal(this.unit, ((this.unit.stats.maxHealth - this.unit.health) * this.value('HealOnKillPct')) / 100);
    this.unit.stamina = Math.min(Math.max(0, Math.floor(this.unit.stat('stamina'))), this.unit.stamina + this.value('StaminaToRestore'));
  }
}

// 4. Eternal Night: darkness on the strongest enemies: they count as isolated and (his call) can't attack him at all while it lasts, hits or
// blasts. T1: far more sprint speed meanwhile. T3: longer, and one more enemy.
class EternalNight extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const duration = this.value('AbilityDuration');
    const darkened = [...fight.foes].sort((a, b) => b.health - a.health).slice(0, this.value('MaxTargets'));
    for (const e of darkened) fight.addStatus(e, { id: 'eternal_night', duration, tags: ['dark', 'blind'], debuff: true });
    fight.addStatus(this.unit, { id: 'night_stride', duration, mods: { moveSpeed: this.value('BonusSprintSpeed') } });
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Rend', 'Swipes at the enemies ahead for spirit damage. The close ones take melee damage too.'],
  ["Stalker's Mark", 'Marks an enemy, making it bleed, and teleports behind it.'],
  ['Bloodscent', 'Deals more damage to an enemy left on its own. Every such kill adds weapon damage for the fight.'],
  ['Eternal Night', 'Wraps the strongest enemies in darkness: they count as alone and cannot see to attack.'],
];

module.exports = { name: 'Drifter', abilities: { 1: Rend, 2: StalkersMark, 3: Bloodscent, 4: EternalNight }, info };
