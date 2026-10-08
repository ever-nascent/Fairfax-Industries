// Silver's abilities (deadlock.wiki/Silver, checked Oct 5 2026; page updated that day). Numbers come from the wiki data through Ability.value();
// this file is only what each ability does. Silver has two forms: her own, and the wolf Lycan Curse turns her into, with its own gun and its own
// version of abilities 1-3 (the wiki's "Silver (Transformed)", kept on the hero as OtherForm). An ability's tier counts for both of its forms.
// Standing rules used: "on hero hit / kill" is any enemy; health shares are cut against NPCs; bonus max health comes as a heal under the cap.
const { Ability } = require('./../ability');
const { DT, LIFESTEAL_VS_NPC, MELEE } = require('./../engine');
const { npcShare } = require('./../items');
const { HEROES, ABILITIES } = require('./../stats');

const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);
const isWolf = (unit) => !!find(unit, LycanCurse)?.wolf;
const share = (e) => (e.team === 'hero' ? 1 : npcShare(e));

// An ability with a wolf version: `beast` is that version (for its numbers), and each form keeps its own cooldown while the other is out.
class Dual extends Ability {
  constructor(...args) {
    super(...args);
    this.beast = new Ability(this.slot, ABILITIES[HEROES[this.unit.name].OtherForm.BoundAbilities[this.slot].Key], this.unit, this.tier);
    this.shelved = 0; // the other form's cooldown
    this.wasWolf = false;
  }

  get name() { return isWolf(this.unit) ? this.beast.data.Name : this.data.Name; }
  get cooldown() { return isWolf(this.unit) ? this.beast.cooldown : super.cooldown; }
  get castDelay() { return isWolf(this.unit) ? this.beast.castDelay : super.castDelay; }
  want(fight) { return fight.foes.length > 0; }
  cast(fight) { return isWolf(this.unit) ? this.wolfCast(fight) : this.humanCast(fight); }

  tick(fight, dt) {
    this.beast.imbues = this.imbues;
    const wolf = isWolf(this.unit);
    if (wolf !== this.wasWolf) { [this.cdLeft, this.shelved] = [this.shelved, this.cdLeft]; this.wasWolf = wolf; } else this.shelved = Math.max(0, this.shelved - dt);
    this.each?.(fight, dt);
  }
}

// 1. Slam Fire: the gun is reloaded at once and for a few shots fires far faster, each hit taking a share of the target's current health as
// weapon damage on top, with more weapon damage against NPCs. T1: more weapon damage meanwhile. T3: all the shots on one target: a bigger share
// on top. (The worse aim isn't simulated.)
// Wolf: Go For The Throat: a bite through the enemies right in front: melee damage, more the less health they have left, healing her for a share.
class SlamFire extends Dual {
  constructor(...args) {
    super(...args);
    this.shots = 0;
    this.until = 0;
    this.prey = null; // the one target of every shot so far, or false
  }

  humanCast(fight) {
    const w = this.unit.weapon;
    if (w.reloadLeft > 0 || w.clip < this.unit.stats.clip) { w.reloadLeft = 0; w.clip = this.unit.stats.clip; fight.emit('reloadEnd', { source: this.unit }); }
    this.shots = this.data.MaxShots;
    this.until = fight.time + this.value('AbilityDuration');
    this.prey = null;
  }

  wolfCast(fight) {
    const b = this.beast;
    let healing = 0;
    for (const e of fight.near(Math.max(BESIDE, b.value('AbilityCastRange') / 2))) { // those right in front of her, like the wolf's gun
      const missing = ((e.stats.maxHealth - e.health) * b.value('MissingHealthDamagePercentage')) / 100;
      healing += (fight.damage(this.unit, e, b.value('Damage') + missing * share(e), 'melee') * b.value('LifeStealPercentOnHit')) / 100 * (e.team === 'hero' ? 1 : LIFESTEAL_VS_NPC);
    }
    fight.heal(this.unit, healing, 'lifesteal');
  }

  get firing() { return this.shots > 0 && !isWolf(this.unit); }

  each(fight) {
    if (this.shots && fight.time > this.until) this.shots = 0;
    if (!this.firing) return;
    const npc = fight.foes[0] && fight.foes[0].team !== 'hero';
    fight.addStatus(this.unit, { id: 'slam_fire', duration: DT * 1.5, mods: { fireRate: this.data.BonusFireRate / 100, weaponDamage: (this.value('BaseAttackDamagePercent') + (npc ? this.data.NonPlayerBonusWeaponPower : 0)) / 100 } });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || !this.firing || p.opts.split) return;
    this.shots -= 1;
    this.prey = this.prey === null || this.prey === p.target ? p.target : false;
    const last = this.shots === 0 && this.prey === p.target ? this.value('BonusCurrentHealthDamagePercentage') : 0;
    if (p.target.alive) fight.damage(this.unit, p.target, ((p.target.health * (this.data.CurrentHealthDamagePercentage + last)) / 100) * share(p.target), 'bullet', { events: false });
  }
}

// 2. Boot Kick: a kick on the front enemy: melee damage, held in place a moment, and a mark: her next shot at it within the mark's time deals
// spirit damage on top. T2: stamina back. T3: more mark damage, and the kicked enemy deals less damage for a while.
// Wolf: Mauling Leap: melee damage on the front enemy, which loses bullet resist and takes spirit damage over time.
const HELD = 0.3; // seconds the kicked enemy is held (the wiki: "immobilized for a short time")
class BootKick extends Dual {
  constructor(...args) {
    super(...args);
    this.mark = null; // { e, until }
    this.mauled = []; // [{ e, until, next }]
  }

  humanCast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    fight.damage(this.unit, e, this.value('Damage'), 'melee');
    fight.addStatus(e, { id: 'boot_kick', duration: HELD, tags: ['immobilize'], debuff: true });
    if (this.value('OutgoingDamagePercent')) fight.addStatus(e, { id: 'boot_kick_weak', duration: this.value('DebuffDuration'), mods: { damageDealt: this.value('OutgoingDamagePercent') / 100 }, debuff: true });
    this.mark = { e, until: fight.time + this.value('MarkDuration') };
    this.unit.stamina = Math.min(Math.max(0, Math.floor(this.unit.stat('stamina'))), this.unit.stamina + this.value('StaminaRestore'));
  }

  wolfCast(fight) {
    const e = fight.foes[0];
    const b = this.beast;
    if (!e) return;
    fight.damage(this.unit, e, b.value('Damage'), 'melee');
    fight.addStatus(e, { id: 'mauling_leap', duration: b.value('DebuffDuration'), mods: { bulletResist: b.value('BulletArmorReduction') / 100 }, debuff: true });
    this.mauled.push({ e, until: fight.time + b.value('DebuffDuration'), next: fight.time + b.data.TickRate });
  }

  each(fight) {
    const b = this.beast;
    this.mauled = this.mauled.filter((m) => m.e.alive && m.next <= m.until + 1e-9);
    for (const m of this.mauled) {
      if (fight.time + 1e-9 < m.next) continue;
      m.next += b.data.TickRate;
      fight.damage(this.unit, m.e, b.value('DPS') * b.data.TickRate, 'spirit');
    }
  }

  on(event, fight, p) {
    const m = this.mark;
    if (event !== 'bulletHit' || !m || p.source !== this.unit || p.target !== m.e || p.opts.split) return;
    this.mark = null;
    if (fight.time <= m.until && m.e.alive) fight.running(this, () => fight.damage(this.unit, m.e, this.value('BonusDamage'), 'spirit'));
  }
}

// 3. Entangling Bola: spirit damage and a slow on the front enemy. T1: a stronger slow. T3: it bounces on to two more enemies, and lasts longer.
// Wolf: Tail Whack: spirit damage to the enemies around, disarmed (no attacks) and slowed for a moment.
class EntanglingBola extends Dual {
  humanCast(fight) {
    const front = fight.foes[0];
    if (!front) return;
    const more = this.value('RicochetCount') ? fight.near(this.value('RicochetRange')).filter((e) => e !== front).slice(0, this.value('RicochetCount')) : [];
    for (const e of [front, ...more]) {
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'entangling_bola', duration: this.value('DebuffDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
    }
  }

  wolfCast(fight) {
    const b = this.beast;
    for (const e of fight.near(b.value('SlashRadius'))) {
      fight.damage(this.unit, e, b.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'tail_whack', duration: b.value('DisarmDuration'), tags: ['disarm'], debuff: true });
      fight.addStatus(e, { id: 'tail_whack_slow', duration: b.value('SlowDuration'), mods: { slow: b.value('SlowPercent') / 100 }, debuff: true });
    }
  }
}

// 4. Lycan Curse: never cast: dealing damage fills her bloodlust (faster when she is low), and when it is full and the curse is off cooldown she
// turns into the wolf for a while: more max health and a heal of part of what she is missing, faster, and the wolf's gun: no clip, no reload,
// a close cone that also hits the enemies right beside its target, and every hit a stack of fire rate; she fights among the enemies. Every hit
// also keeps the wolf out a little longer. Abilities 1-3 are the wolf's meanwhile. T1: bullet and spirit resist as the wolf. T2: faster, more
// health. T3: a kill as the wolf starts its time over and readies its abilities.
// ponytail: BESIDE is how far to either side the wolf's cone reaches.
const BESIDE = 4;
class LycanCurse extends Ability {
  constructor(...args) {
    super(...args);
    this.lust = 0;
    this.wolf = false;
    this.until = 0;
    this.stacks = 0;
    this.lastHit = 0;
    this.human = null; // her own gun and health while the wolf is out
  }

  want() { return false; }
  status(fight) { return this.wolf ? `Wolf ${Math.max(0, Math.ceil(this.until - (fight?.time ?? 0)))}s` : this.cdLeft > 0 ? super.status(fight) : `${Math.floor((this.lust / this.data.MaxRage.Value) * 100)}%`; }

  turn(fight) {
    const u = this.unit;
    const form = HEROES[this.origin ?? u.name].OtherForm; // origin: the hero a copy of this ability comes from (Sinclair)
    const s = u.stats;
    const health = this.value('BonusHealth');
    this.human = { bulletDamage: s.bulletDamage, pellets: s.pellets, fireRate: s.fireRate, falloff: s.falloff, health };
    s.bulletDamage = form.Weapon.BulletDamage + (form.LevelScaling.BulletDamage || 0) * (u.boons ?? 0);
    s.pellets = 1;
    s.fireRate *= form.Weapon.RoundsPerSecond / HEROES[u.name].Weapon.RoundsPerSecond; // her fire rate items carry over
    s.falloff = { ...s.falloff, endScale: s.falloff.startScale };
    u.weapon.reloadLeft = 0;
    s.maxHealth += health;
    fight.heal(u, health + ((s.maxHealth - health - u.health) * this.value('MissingHealthPercentHeal')) / 100);
    this.wolf = true;
    this.lust = 0;
    this.stacks = 0;
    this.until = fight.time + this.value('AbilityDuration');
    fight.log.push({ t: +fight.time.toFixed(1), who: u.name, what: this.name });
  }

  back() {
    const { health, ...gun } = this.human;
    Object.assign(this.unit.stats, gun);
    this.unit.addMaxHealth(-health);
    this.human = null;
    this.wolf = false;
    this.cdLeft = this.cooldown;
    if (this.once) this.spent = true;
  }

  // A copy of the curse (Sinclair's Audience Participation): the wolf comes at once, one time only; `retire` puts things back if the copy is dropped.
  copied() { this.lust = this.data.MaxRage.Value; this.once = true; }
  retire() { if (this.wolf) this.back(); }

  tick(fight, dt) {
    const u = this.unit;
    if (this.spent) return;
    if (!this.wolf) {
      if (fight.foes.length) this.lust = Math.min(this.data.MaxRage.Value, this.lust + (this.data.MaxRage.Value * this.data.RagePercentagePerSecondInCombat * dt) / 100);
      if (this.lust >= this.data.MaxRage.Value - 1e-9 && this.cdLeft <= 0 && !u.cantAct && fight.foes.length) this.turn(fight);
      return;
    }
    if (fight.time >= this.until) { this.back(); return; }
    if (fight.time - this.lastHit > this.value('StackDuration')) this.stacks = 0;
    const resist = this.value('BulletResist') / 100;
    fight.addStatus(u, {
      id: 'lycan_curse', duration: DT * 1.5, tags: ['infiniteClip'],
      mods: { moveSpeed: this.value('BonusMoveSpeed'), bulletResist: resist, spiritResist: this.value('TechResist') / 100, fireRate: ((this.stacks / this.data.MaxStacks) * this.value('BonusFireRate')) / 100 },
    });
    u.close = fight.foes[0] ?? null;
    u.closeUntil = fight.time + MELEE.closeFor;
  }

  on(event, fight, p) {
    if (p.source !== this.unit || p.target === this.unit || this.spent) return;
    if (event === 'damage' && !this.wolf && p.dealt > 0) {
      const low = this.unit.health < (this.unit.stats.maxHealth * this.data.LowHealthFraction) / 100 ? 1 + this.data.LowHealthRageBonus.Value / 100 : 1;
      this.lust = Math.min(this.data.MaxRage.Value, this.lust + p.dealt * this.data.RagePerDamage * low);
    }
    if (!this.wolf) return;
    if (event === 'bulletHit' && !p.opts.split) {
      this.stacks = Math.min(this.data.MaxStacks, this.stacks + 1);
      this.lastHit = fight.time;
      this.until += this.data.BonusDurationOnBullet;
      for (const e of fight.near(BESIDE).filter((x) => x !== p.target)) fight.damage(this.unit, e, p.amount, 'bullet', { split: true, events: false });
    } else if (event === 'melee') this.until += this.data.BonusDurationOnHeavyMelee;
    else if (event === 'kill' && this.value('KillDurationBonus')) {
      this.until = Math.max(this.until, fight.time + this.value('KillDurationBonus'));
      for (const a of this.unit.abilities) if (a !== this) a.cdLeft = 0;
    }
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Slam Fire', 'Reloads at once and fires a few fast shots that take a share of the target\'s health. As the wolf: a healing bite.'],
  ['Boot Kick', 'Kicks an enemy and marks it: the next shot at it hurts more. As the wolf: a mauling leap.'],
  ['Entangling Bola', 'Throws a bola that damages and slows. As the wolf: a tail whack that disarms the enemies around.'],
  ['Lycan Curse', 'Dealing damage builds bloodlust. When it is full, turns into a wolf for a while, with its own attacks.'],
];

module.exports = { name: 'Silver', abilities: { 1: SlamFire, 2: BootKick, 3: EntanglingBola, 4: LycanCurse }, info };
