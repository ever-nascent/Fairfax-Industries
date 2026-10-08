// Calico's abilities (deadlock.wiki/Calico, checked Oct 3 2026). Numbers come from the wiki data through Ability.value(); this file is only
// what each ability does. His calls (Oct 3): Ava is a way out when hurt (enemies lose track of her; she deals no damage as the cat); Leaping
// Slash's tier 2 makes an enemy that dies soon after the slash worth half again its own souls. "On hero hit" effects work on any enemy.
const { Ability } = require('./../ability');

// 1. Gloom Bombs: a cluster of bombs, one to each enemy from the front, the rest going round again; an enemy hit more than once takes less from
// the later ones. T2: every bomb hit opens the enemy up to melee for a while (stacking). ponytail: the cluster reaches REACH bomb radii.
const REACH = 4;
class GloomBombs extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    fight.at(this.data.Lifetime, () => fight.running(this, () => {
      const hit = new Set();
      const open = this.value('MeleeResistReduction');
      for (let i = 0; i < this.value('GrenadeCount'); i++) {
        const reach = fight.near(this.value('Radius') * REACH);
        const e = reach[i % reach.length];
        if (!e || !this.unit.alive) return;
        fight.damage(this.unit, e, this.value('Damage') * (hit.has(e) ? this.data.MultiHitPenaltyPercentage / 100 : 1), 'spirit');
        hit.add(e);
        if (open) {
          const before = e.statuses.find((s) => s.id === 'gloom_open')?.mods.meleeTaken ?? 0;
          fight.addStatus(e, { id: 'gloom_open', duration: this.value('MeleeResistReductionDuration'), mods: { meleeTaken: before - open / 100 }, debuff: true });
        }
      }
    }));
  }
}

// 2. Leaping Slash: slashes every enemy around the front one for melee damage, and heals if it hit anything. T2 (his call): an enemy that dies
// within the bounty window is worth BOUNTY of its own souls more on a won trip (bosses carry no souls of their own). T3: half the cooldown back.
const BOUNTY = 0.5;
class LeapingSlash extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const hit = fight.near(this.value('SlashRadius'));
    if (!hit.length) return;
    for (const e of hit) {
      if (this.value('BonusGoldOnKill')) fight.addStatus(e, { id: 'slash_bounty', duration: this.value('BountyDuration'), tags: ['bounty'], debuff: true }); // first: the slash's own kill counts
      fight.damage(this.unit, e, this.value('ImpactDamage'), 'melee', { melee: true });
    }
    fight.heal(this.unit, this.value('HealAmount'));
    this.cdLeft *= 1 - this.value('CooldownRefundPercent') / 100;
  }

  on(event, fight, { target }) {
    if (event !== 'kill' || !target.has('bounty') || target.bountyPaid) return;
    target.bountyPaid = true;
    fight.bonusSouls += (target.stats.souls ?? 0) * BOUNTY;
  }
}

// 3. Ava: the cat. In the game it is fast and deals no damage; here (his call) it is a way out when hurt: enemies lose track of her and she
// doesn't attack for a few seconds (out-of-combat regen may start). T1: twice as long. T2: health regen meanwhile. T3: more damage for a while
// after she changes back, the longer she was away the more. ponytail: AWAY seconds as the cat per 15 s of the game's duration.
const AWAY = 4;
const HURT = 0.5;
class Ava extends Ability {
  want(fight) {
    return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT;
  }

  cast(fight) {
    const away = AWAY * (this.value('BuffDuration') / this.data.BuffDuration.Value);
    fight.addStatus(this.unit, { id: 'ava', duration: away, tags: ['void'], regen: this.value('HealthRegen') });
    const amp = this.value('OutgoingDamagePercent');
    if (amp) {
      fight.at(away, () => fight.addStatus(this.unit, {
        id: 'ava_pounce', duration: this.value('DamageAmpDuration'), mods: { damageDealt: (amp / 100) * Math.min(1, away / this.value('DamageAmpBuildDuration')) },
      }));
    }
  }
}

// 4. Return to Shadows: vanishes (can't be targeted, doesn't attack), dealing spirit damage around her as she goes and again as she returns.
// Used when hurt. T3: heals on return and makes her other abilities ready again.
class ReturnToShadows extends Ability {
  want(fight) {
    return fight.foes.length > 0 && this.unit.health < this.unit.stats.maxHealth * HURT;
  }

  burst(fight) {
    for (const e of fight.near(this.value('Radius'))) fight.damage(this.unit, e, this.value('Damage'), 'spirit');
  }

  cast(fight) {
    const away = this.value('AbilityChannelTime');
    this.burst(fight);
    fight.addStatus(this.unit, { id: 'shadows', duration: away, tags: ['void'] });
    fight.at(away, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      this.burst(fight);
      fight.heal(this.unit, this.value('HealAmount'));
      if (this.value('RefundCooldowns')) for (const a of this.unit.abilities) if (a !== this) a.refresh();
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Gloom Bombs', 'Throws a cluster of bombs that explode a moment later.'],
  ['Leaping Slash', 'Dashes in and slashes every enemy around, healing if it hits.'],
  ['Ava', 'Turns into the cat Ava and slips away when hurt: enemies lose track for a few seconds.'],
  ['Return to Shadows', 'Vanishes into the shadows, damaging nearby enemies on the way out and again on the way back.'],
];

module.exports = { name: 'Calico', abilities: { 1: GloomBombs, 2: LeapingSlash, 3: Ava, 4: ReturnToShadows }, info };
