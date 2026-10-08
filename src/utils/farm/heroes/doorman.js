// The Doorman's abilities (deadlock.wiki/The_Doorman, checked Oct 3 2026). Numbers come from the wiki data through Ability.value(); this file
// is only what each ability does. His calls (Oct 3): Doorway is a way out through the door when hurt; a Hotel Guest checks out late half the
// time; Call Bell's worse aim is 20% less weapon damage.
const { Ability } = require('./../ability');
const { isBoss } = require('./../items');

// 1. Call Bell: hits the front enemy, then goes off (the Doorman shoots it): spirit damage around it, a slow, and worse aim, which here is less
// weapon damage (his call: half the accuracy penalty; an enemy that deals spirit damage loses nothing, a 'mixed' one half). T1: a second charge.
// ponytail: it goes off RING seconds after it lands.
const RING = 0.5;
const AIM = 0.5; // share of the accuracy penalty that becomes lost weapon damage
class CallBell extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const target = fight.foes[0];
    if (!target) return;
    fight.damage(this.unit, target, this.value('ImpactDamage'), 'spirit');
    fight.at(RING, () => fight.running(this, () => {
      if (!this.unit.alive) return;
      const lost = (this.data.DebuffAccuracy / 100) * AIM; // negative
      for (const e of fight.near(this.value('Radius'))) {
        fight.damage(this.unit, e, this.value('ExplosionDamage'), 'spirit');
        const mods = { slow: this.data.SlowPercent / 100 };
        if (e.team === 'hero') mods.weaponDamage = lost; // a rival hero's gun
        else if (e.stats.damageType !== 'spirit') mods.damageDealt = lost * (e.stats.damageType === 'mixed' ? 0.5 : 1);
        fight.addStatus(e, { id: 'call_bell', duration: this.value('AbilityDuration'), mods, debuff: true });
      }
    }));
  }
}

// 2. Doorway: a travel tool in the game; here (his call) a way out. Opened when he is hurt; while the doors are open, each time he is below half
// health he steps through: out of reach (and not attacking) for a moment, at most once every DoorwayCloseCooldown seconds. T1: open longer.
// T2: he comes back with a barrier (once per cast). T3 (doors further apart): a longer trip.
const TRIP = 2;
const LONG_TRIP = 3;
const HURT = 0.5;
class Doorway extends Ability {
  constructor(...args) {
    super(...args);
    this.openUntil = 0;
    this.nextTrip = 0;
    this.barrier = false;
  }

  open(fight) { return fight.time < this.openUntil; }
  hurt() { return this.unit.health < this.unit.stats.maxHealth * HURT; }
  status(fight) { return fight && this.open(fight) ? `Open ${Math.ceil(this.openUntil - fight.time)}s` : super.status(fight); }

  want(fight) {
    return fight.foes.length > 0 && !this.open(fight) && this.hurt();
  }

  cast(fight) {
    this.openUntil = fight.time + this.value('AbilityDuration');
    this.nextTrip = 0;
    this.barrier = this.value('CombatBarrier') > 0;
  }

  tick(fight) {
    if (!this.open(fight) || !this.hurt() || fight.time < this.nextTrip || this.unit.cantAct) return;
    const away = this.tier >= 3 ? LONG_TRIP : TRIP;
    this.nextTrip = fight.time + this.data.DoorwayCloseCooldown;
    fight.addStatus(this.unit, { id: 'doorway', duration: away, tags: ['void'] });
    if (!this.barrier) return;
    this.barrier = false;
    fight.at(away, () => fight.addStatus(this.unit, { id: 'doorway_barrier', duration: this.value('BarrierDuration'), barrier: this.value('CombatBarrier') }));
  }
}

// 3. Luggage Cart: runs through the enemies in reach for spirit damage and drags the ones that aren't bosses along, leaving them bunched where
// it stops. T2: more damage when it hits the wall. T3: and a stun. ponytail: every cart ends in a wall, like Abrams' charge.
class LuggageCart extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const hit = fight.near(this.value('AbilityCastRange'));
    const dragged = hit.filter((e) => !isBoss(e));
    const stop = Math.max(0, ...dragged.map((e) => e.offset ?? 0));
    for (const e of dragged) e.offset = stop;
    for (const e of hit) {
      fight.damage(this.unit, e, this.value('CartDamage') + this.value('WallImpactDamage'), 'spirit');
      fight.addStatus(e, { id: 'cart_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
    }
  }
}

// 4. Hotel Guest: after its channel the strongest enemy is sent to the Baroness Hotel: gone from the fight (can't act, can't be hit) for the
// stay, which it pays for in spirit damage, and again if it checks out late (his call: half the time), then it is frozen a moment. A boss
// resists the stay like a stun but still pays. T2: more damage, a stun on a late checkout. T3: the Doorman is Unstoppable meanwhile, and a late
// checkout cuts the cooldown short.
const LATE_CHANCE = 0.5;
class HotelGuest extends Ability {
  want(fight) {
    return fight.foes.length > 0;
  }

  cast(fight) {
    const channel = this.value('AbilityChannelTime');
    fight.addStatus(this.unit, { id: 'hotel_channel', duration: channel, tags: ['hold'] });
    fight.at(channel, () => fight.running(this, () => this.checkIn(fight)));
  }

  checkIn(fight) {
    const guest = fight.foes.reduce((best, e) => (!best || e.health > best.health ? e : best), null);
    if (!this.unit.alive || !guest) return;
    const stay = this.data.AbilityDuration * (1 - (guest.stats.ccResist ?? 0));
    fight.damage(this.unit, guest, this.value('Damage'), 'spirit');
    fight.addStatus(guest, { id: 'hotel', duration: this.data.AbilityDuration, tags: ['stun', 'void'], mods: { damageTaken: -1 }, debuff: true });
    if (this.value('UnstoppableWhileHotelOccupied')) fight.addStatus(this.unit, { id: 'hotel_host', duration: stay, tags: ['unstoppable'] });
    fight.at(stay + 0.1, () => fight.running(this, () => { // just after the doors open
      if (!guest.alive) return;
      if (fight.rng() < LATE_CHANCE) {
        fight.damage(this.unit, guest, this.value('LateCheckoutDamage'), 'spirit');
        fight.addStatus(guest, { id: 'hotel_late', duration: this.value('LateCheckoutStun'), tags: ['stun'], debuff: true });
        const short = this.value('LateCheckoutCooldown');
        if (short) this.cdLeft = Math.min(this.cdLeft, short);
      }
      fight.addStatus(guest, { id: 'hotel_checkout', duration: this.data.TimeSlowDuration, tags: ['stun'], debuff: true });
    }));
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Call Bell', 'Throws a call bell that damages on impact, then explodes, slowing enemies and spoiling their aim.'],
  ['Doorway', 'Opens a pair of doors: a way out of reach for a moment whenever things get dangerous.'],
  ['Luggage Cart', 'Sends a luggage cart through the enemies, damaging them and dragging them along.'],
  ['Hotel Guest', 'Sends the strongest enemy to the Baroness Hotel. The stay is paid for in damage, and a late checkout costs extra.'],
];

module.exports = { name: 'The Doorman', abilities: { 1: CallBell, 2: Doorway, 3: LuggageCart, 4: HotelGuest }, info };
