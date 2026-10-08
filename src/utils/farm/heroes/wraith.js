// Wraith's abilities (deadlock.wiki/Wraith, checked Oct 5 2026; page updated Oct 4). Numbers come from the wiki data through Ability.value(); this
// file is only what each ability does. Standing rules used: Project Mind (a teleport) is a way out when hurt, like his calls for the Doorman's
// Doorway, Calico's Ava and Mirage's Traveler, and its range tier keeps enemies off her a second longer, like Dynamo's; a bullet is a headshot
// with the headshot items' chance; hero-only abilities work on any enemy.
const { Ability } = require('./../ability');
const { DT } = require('./../engine');
const { HEADSHOT_CHANCE } = require('./../items');

// 1. Card Trick: cards are not on a cooldown: hitting with the gun (or a heavy melee) draws them, slower against NPCs (the wiki). A card thrown
// at the front enemy deals spirit damage around it and does what its suit says: Spade more damage, Diamond less bullet and spirit resist,
// Club a slow, Heart a heal for her (half from NPCs); a Joker does all four. The deck is two of each suit, reshuffled when it runs out, with a
// chance of a Joker instead. A fight starts with her hand full. T1: a bigger hand. T2: more damage. T3: stronger suits, more Jokers.
const SUITS = ['spade', 'diamond', 'club', 'heart'];
class CardTrick extends Ability {
  constructor(...args) {
    super(...args);
    this.drawn = 0; // towards the next card, %
    this.deck = [];
  }

  get cooldown() { return this.data.CooldownBetweenCards; } // the only wait it has
  ready() { return !this.unit.cantAct && this.charges > 0 && this.gapLeft <= 0; }
  use() { this.charges -= 1; this.gapLeft = this.data.CooldownBetweenCards; }
  tickCooldown(dt) { this.gapLeft = Math.max(0, this.gapLeft - dt); }
  status() { return this.charges ? `${this.charges} card${this.charges > 1 ? 's' : ''}` : `${Math.floor(this.drawn)}%`; }
  want(fight) { return fight.foes.length > 0; }

  suit(fight) {
    if (fight.rng() < (this.value('ImprovedJokerChance') ? 1 / 5 : 1 / 9)) return SUITS;
    if (!this.deck.length) this.deck = [...SUITS, ...SUITS];
    return [this.deck.splice(Math.floor(fight.rng() * this.deck.length), 1)[0]];
  }

  cast(fight) {
    const suits = this.suit(fight);
    const damage = this.value('Damage') * (suits.includes('spade') ? 1 + this.value('SpadeDamageBonus') / 100 : 1);
    const hit = fight.near(this.value('Radius'));
    for (const e of hit) {
      fight.damage(this.unit, e, damage, 'spirit');
      const shred = this.value('DiamondResistShred') / 100;
      if (suits.includes('diamond')) fight.addStatus(e, { id: 'card_diamond', duration: this.value('DiamondResistShredDuration'), mods: { bulletResist: shred, spiritResist: shred }, debuff: true });
      if (suits.includes('club')) fight.addStatus(e, { id: 'card_club', duration: this.value('ClubSlowDuration'), mods: { slow: this.value('ClubSlowPercent') / 100 }, debuff: true });
    }
    if (suits.includes('heart') && hit.length) {
      const first = hit[0].team === 'hero' ? 1 : this.data.HeartHealNonHeroRatio;
      fight.heal(this.unit, this.value('HeartHeal') * first * (1 + 0.5 * (hit.length - 1))); // half again for every further enemy hit (the wiki)
    }
  }

  on(event, fight, p) {
    if (p.source !== this.unit || !(event === 'bulletHit' || event === 'melee') || p.opts?.split) return;
    const d = this.data;
    const per = event === 'melee' ? d.CardResourcePerHeavyMelee : fight.rng() < HEADSHOT_CHANCE ? d.CardResourcePerBulletCrit : d.CardResourcePerBulletHit;
    this.drawn += per * (d.CardResourceGenPctScale.Value / 100) * (1 + this.unit.stat('cdr')) * (p.target.team === 'hero' ? 1 : d.NonPlayerCardResourceScale);
    while (this.drawn >= 100 && this.charges < this.maxCharges) { this.drawn -= 100; this.charges += 1; }
    if (this.charges >= this.maxCharges) this.drawn = Math.min(this.drawn, 99);
  }
}

// 2. Project Mind: used when hurt: she teleports out, out of every enemy's reach and not attacking for a moment. T1 (more range, useless here):
// enemies can't find her for LOST more seconds after she is back. T2: a barrier when she is back. T3: far shorter cooldown.
const HURT = 0.5;
const AWAY = 2;
const LOST = 1;
class ProjectMind extends Ability {
  want(fight) { return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT; }

  cast(fight) {
    fight.addStatus(this.unit, { id: 'project_mind', duration: AWAY, tags: ['void'] });
    fight.at(AWAY, () => {
      if (!this.unit.alive) return;
      if (this.tier >= 1) fight.addStatus(this.unit, { id: 'project_mind_lost', duration: LOST, tags: ['untargetable'] });
      if (this.value('CombatBarrier')) fight.addStatus(this.unit, { id: 'project_mind_barrier', duration: this.value('BarrierDuration'), barrier: this.value('CombatBarrier') });
    });
  }
}

// 3. Full Auto: for a while more fire rate, and spirit damage on every bullet. T1: shorter cooldown. T2: more fire rate, longer.
// T3: no reloading meanwhile (a reload under way is finished), better spirit scaling.
class FullAuto extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
  }

  want(fight) { return fight.foes.length > 0; }
  status(fight) { return fight && fight.time < this.until ? 'Full Auto' : super.status(fight); }

  cast(fight) {
    this.until = fight.time + this.value('AbilityDuration');
    if (this.value('UnlimitedAmmo') && this.unit.weapon.reloadLeft > 0) { this.unit.weapon.reloadLeft = 0; this.unit.weapon.clip = this.unit.stats.clip; fight.emit('reloadEnd', { source: this.unit }); }
  }

  tick(fight) {
    if (fight.time < this.until) fight.addStatus(this.unit, { id: 'full_auto', duration: DT * 1.5, mods: { fireRate: this.value('BonusFireRate') / 100 }, tags: this.value('UnlimitedAmmo') ? ['infiniteClip'] : [] });
  }

  on(event, fight, p) {
    if (event !== 'bulletHit' || p.source !== this.unit || fight.time >= this.until || p.opts.split || !p.target.alive) return;
    fight.running(this, () => fight.damage(this.unit, p.target, this.value('MagicDamagePerBullet'), 'spirit', { proc: true }));
  }
}

// 4. Telekinesis: a channel (no shooting or casting) that lifts the front enemy into the air, stunned (a boss shrugs part of it off), then
// slams it down: spirit damage and a slow. T1: more damage. T2: shorter cooldown. T3: a longer slow.
class Telekinesis extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const e = fight.foes[0];
    if (!e) return;
    const channel = this.value('AbilityChannelTime');
    fight.addStatus(e, { id: 'telekinesis', duration: channel, tags: ['stun'], debuff: true });
    fight.addStatus(this.unit, { id: 'telekinesis_channel', duration: channel, tags: ['silence'] });
    this.unit.busyUntil = Math.max(this.unit.busyUntil, fight.time + channel);
    fight.at(channel, () => fight.running(this, () => {
      if (!e.alive || !this.unit.alive) return;
      fight.damage(this.unit, e, this.value('Damage'), 'spirit');
      fight.addStatus(e, { id: 'telekinesis_slow', duration: this.value('AbilityDuration'), mods: { slow: this.data.SlowPercent / 100 }, debuff: true });
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Card Trick', 'Hitting with the gun draws cards. Each card thrown damages the enemies around and does what its suit says.'],
  ['Project Mind', 'When hurt, teleports out of the fight for a moment.'],
  ['Full Auto', 'Boosts fire rate for a while, with spirit damage on every bullet.'],
  ['Telekinesis', 'Lifts an enemy into the air, then slams it into the ground.'],
];

module.exports = { name: 'Wraith', abilities: { 1: CardTrick, 2: ProjectMind, 3: FullAuto, 4: Telekinesis }, info };
