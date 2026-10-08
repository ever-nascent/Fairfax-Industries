// Sinclair's abilities (deadlock.wiki/Sinclair, checked Oct 5 2026; page updated that day). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. His calls (Oct 5): Audience Participation copies the ultimate of a random hero the
// member has unlocked (a rival hero's in a duel), and it must work for every hero's ultimate; Rabbit Hex works on any enemy; Vexing Bolt always
// deals its full damage.
const { Ability } = require('./../ability');
const { isBoss } = require('./../items');
const { HEROES, ABILITIES } = require('./../stats');

const find = (unit, Cls) => unit.abilities.find((a) => a instanceof Cls);

// 1. Vexing Bolt: a bolt at the front enemy that grows as it flies. It always deals its maximum damage (his call, Oct 5: the redirect, which
// gives it the longer flight, is assumed), to everything around it, half to bosses. With an Assistant out, the Assistant casts one too, weaker.
// T1: the bolt makes them attack slower. T3: a far higher maximum, a stronger Assistant bolt.
class VexingBolt extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const front = fight.foes[0];
    if (!front) return;
    const damage = this.value('MaxDamage');
    const bolts = [1, ...(find(this.unit, SpectralAssistant)?.out(fight) ? [this.value('CloneDamagePercentage') / 100] : [])];
    const slower = -this.value('FireRateSlow') / 100;
    for (const strength of bolts) {
      for (const e of fight.near(this.value('Radius'))) {
        fight.damage(this.unit, e, damage * strength * (e.team !== 'hero' && isBoss(e) ? this.data.BossDamageScale : 1), 'spirit');
        if (slower) fight.addStatus(e, { id: 'vexing_bolt', duration: this.value('DebuffDuration'), mods: e.team === 'hero' ? { fireRate: slower } : { damageDealt: slower }, debuff: true });
      }
    }
  }
}

// 2. Spectral Assistant: summoned when the gun runs dry: the gun is reloaded at once (the wiki), and for a while every shot of Sinclair's that
// hits is followed by one from the Assistant: spirit damage. T2: longer. T3: more fire rate meanwhile, a stronger Assistant.
class SpectralAssistant extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  out(fight) { return fight.time < this.until; }
  want(fight) { return fight.foes.length > 0 && this.unit.weapon.reloadLeft > 0; }
  status(fight) { return fight && this.out(fight) ? 'Assisting' : super.status(fight); }

  cast(fight) {
    const w = this.unit.weapon;
    if (w.reloadLeft > 0) { w.reloadLeft = 0; w.clip = this.unit.stats.clip; fight.emit('reloadEnd', { source: this.unit }); }
    this.until = fight.time + this.value('AbilityDuration');
    if (this.value('BonusFireRate')) fight.addStatus(this.unit, { id: 'spectral_assistant', duration: this.value('AbilityDuration'), mods: { fireRate: this.value('BonusFireRate') / 100 } });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || !this.out(fight) || p.opts.split || !p.target.alive) return;
    fight.running(this, () => fight.damage(this.unit, p.target, this.value('Damage'), 'spirit'));
  }
}

// 3. Rabbit Hex: a moment after the cast the enemies around the front one are rabbits for a while: they can't attack or cast, and take more
// damage (his call: any enemy, not only heroes; a boss shrugs part of it off). T2: longer. T3: wider, more damage taken.
class RabbitHex extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    fight.at(this.data.DetonationDelay, () => {
      if (!this.unit.alive) return;
      for (const e of fight.near(this.value('Radius'))) {
        fight.addStatus(e, { id: 'rabbit_hex', duration: this.value('HexDuration'), tags: ['disarm', 'silence'], debuff: true });
        fight.addStatus(e, { id: 'rabbit_hex_amp', duration: this.value('HexDuration'), mods: { damageTaken: this.value('DamageAmpPercentage') / 100 }, debuff: true });
      }
    });
  }
}

// 4. Audience Participation: copies an ultimate: a rival hero's in a duel, else that of a random hero the member has unlocked (unit.copies;
// his call). The copy has this ability's tier and is used by its own rules (some wait for the right moment); once it has been used, this
// ability's cooldown becomes a share of the copied one's. The copy (and whatever of its hero's kit it can't work without: a hero file's
// `copyWith`) sits hidden among Sinclair's abilities until the next copy replaces it.
class AudienceParticipation extends Ability {
  constructor(...args) {
    super(...args);
    this.act = []; // the copy and its helpers
    this.copy = null; // the copy while it is still to be used
  }

  // the heroes whose ultimate can be copied right now
  pool(fight) {
    const { logicOf } = require('./../hero'); // here, not at the top: hero.js loads this file
    const copyable = (n) => n !== this.unit.name && !!logicOf(n)?.abilities[4];
    const rival = fight.foes.find((e) => e.team === 'hero' && copyable(e.name));
    return rival ? [rival.name] : (this.unit.copies ?? []).filter(copyable);
  }

  want(fight) { return fight.foes.length > 0 && !this.copy && this.pool(fight).length > 0; }
  status(fight) { return this.copy ? this.copy.name : super.status(fight); }

  cast(fight) {
    const { logicOf } = require('./../hero');
    const pool = this.pool(fight);
    if (!pool.length) return;
    const hero = pool[Math.floor(fight.rng() * pool.length)];
    const logic = logicOf(hero);
    for (const old of this.act) old.retire?.(fight);
    this.unit.abilities = this.unit.abilities.filter((a) => !this.act.includes(a));
    const make = (slot) => Object.assign(new logic.abilities[slot](slot, ABILITIES[HEROES[hero].BoundAbilities[slot].Key], this.unit, slot === 4 ? this.tier : 0), { origin: hero, hidden: true });
    const helpers = (logic.copyWith ?? []).map(make);
    for (const h of helpers) h.ready = () => false; // there for the copy, never cast
    const copy = make(4);
    const done = () => { copy.ready = () => false; this.copy = null; this.cdLeft = (copy.cooldown * this.data.CopyCooldownPercentage) / 100; };
    const use = copy.use.bind(copy);
    copy.use = () => { use(); done(); };
    this.act = [...helpers, copy];
    this.copy = copy;
    this.unit.abilities.push(...this.act);
    fight.log.push({ t: +fight.time.toFixed(1), who: this.unit.name, what: `${copy.name} (copied from ${hero})` });
    if (copy.copied || copy.passive) { copy.copied?.(fight); done(); } // an ultimate that is never cast: it is simply in effect
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Vexing Bolt', 'Fires a bolt of magic that hits harder the further it flies. An Assistant casts one too.'],
  ['Spectral Assistant', 'Summons an Assistant when the gun runs dry: reloaded at once, and every shot is followed by the Assistant\'s.'],
  ['Rabbit Hex', 'Turns the enemies in an area into rabbits: they cannot act and take more damage.'],
  ['Audience Participation', 'Copies the ultimate of another unlocked hero, picked at random, or a rival hero\'s.'],
];

module.exports = { name: 'Sinclair', abilities: { 1: VexingBolt, 2: SpectralAssistant, 3: RabbitHex, 4: AudienceParticipation }, info };
