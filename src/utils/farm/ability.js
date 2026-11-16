// Hero Farming: the base class every hero ability extends. It owns what is the same for all of them (the wiki's
// numbers, upgrade tiers, spirit scaling, cooldown and charges, imbued items, when to cast); a hero's own file (heroes/<hero>.js) only
// says what the ability does. The fight engine (engine.js) calls these hooks:
//   want(fight)          the auto-cast rule (default: cast whenever ready)
//   cast(fight)          the effect, after the wiki's cast delay
//   tick(fight, dt)      every step, for lasting effects
//   on(event, fight, p)  'damage' / 'bulletHit' / 'kill' / 'melee'... payloads, e.g. Fixation stacking on bullet hits
//   wantsMelee(fight, t) optional: true when the hero should melee now (engine.js wantMelee)
//   passive = true       no cooldown, never cast, only tick() and on()
// Slot 4 is the ultimate (Diviner's Kevlar, Lightning Scroll and ultimate cooldown reduction look for it).
const MIN_COOLDOWN = 0.2; // cooldown reduction stops at 80% off. the game's own cap isn't on the wiki; reductions add up here.
const CHARGE_GAP = 1; // seconds between two charges of one ability when the wiki gives no gap (so extra charges don't all fire at once)

class Ability {
  /** @param slot 1-4, @param data the wiki's entry (abilities.json), @param unit the hero, @param tier upgrades bought, 0-3 */
  constructor(slot, data, unit, tier = 0) {
    this.slot = slot;
    this.data = data;
    this.unit = unit;
    this.tier = tier;
    this.cdLeft = 0; // a one-charge ability: seconds until it is ready; a charged one: until its next charge comes back
    this.gapLeft = 0;
    this.imbues = []; // items imbued into it (items.js `imbue`), set by buildHero
  }

  get name() { return this.data.Name; }
  get ultimate() { return this.slot === 4; }

  // What the items imbued into this ability add: { spirit, cdr, duration, range, charges, chargesNonCharge }.
  imbued() {
    const sum = {};
    for (const it of this.imbues) for (const [k, v] of Object.entries(it.imbue ?? {})) sum[k] = (sum[k] ?? 0) + v;
    return sum;
  }

  // A wiki number, with upgrades and scaling applied. Fields are a plain number or { Value, Scale: {Value, Type} | [..] }.
  // Upgrade tiers (data.Upgrades[0..2]) are deltas added on top; a missing field counts as 0 (upgrades can add one).
  // Scaling types handled: spirit (x spirit power), weapon_damage_increase (x bonus weapon damage %),
  // melee (x light melee damage), duration (x duration multiplier), cooldown (x 1 - cooldown reduction), radius / range (x ability range); other types are ignored.
  value(field) {
    const parts = [this.data[field], ...(this.data.Upgrades || []).slice(0, this.tier).map((u) => u[field])];
    let v = 0;
    const scales = {};
    for (const p of parts.filter((x) => x !== undefined)) {
      const n = typeof p === 'number' ? { Value: p } : p;
      v += n.Value;
      // an upgrade's scale adds to the base one, or multiplies it ("Multiply": Apollo's Flawless Advance T3, x1.15 spirit scaling)
      for (const sc of [].concat(n.Scale || [])) scales[sc.Type] = sc.Multiply ? (scales[sc.Type] || 0) * sc.Value : (scales[sc.Type] || 0) + sc.Value;
    }
    if (!Object.keys(scales).length) { if (/Damage/.test(field)) this.sShare = 0; return v; }
    const u = this.unit;
    const im = this.imbued();
    const base = v;
    if (scales.spirit) v += scales.spirit * this.spirit(im);
    if (scales.spirit || /Damage/.test(field)) this.sShare = v > 0 ? (v - base) / v : 0; // the share of a damage number that is spirit power (the Damage Breakdown's lines; weapon-damage scaling counts as base) // only when asked: spirit() reads `charged`, which reads value('AbilityCharges') (scaled by max_charges)
    v += (scales.weapon_damage_increase || 0) * (u.stats.weaponDamageMult - 1) * 100;
    if (scales.melee) v += scales.melee * (u.stats.lightMelee ?? 0) * (1 + u.stat('meleeDamage')); // x the hero's light melee damage
    if (scales.heavy_melee) v += scales.heavy_melee * (u.stats.heavyMelee ?? 0) * (1 + u.stat('meleeDamage')); // x its heavy melee damage (Billy's Bashdown T3)
    if ('duration' in scales) v *= u.stats.durationMult + u.mod('durationMult') + (im.duration ?? 0);
    if ('cooldown' in scales) v *= Math.max(MIN_COOLDOWN, 1 - u.stat('cdr') - (im.cdr ?? 0) - (this.charged ? u.stat('chargedCdr') : 0) - (this.ultimate ? u.stat('ultCdr') : 0));
    if ('radius' in scales || 'range' in scales) v *= u.range + (im.range ?? 0);
    return v;
  }

  // The spirit power this ability scales with: the hero's, temporary spirit (Infuser...), imbued spirit and, for a charged ability, charged spirit.
  spirit(im = this.imbued()) {
    return this.unit.stats.spirit + (this.unit.mod('spirit') + (im.spirit ?? 0) + (this.charged ? this.unit.stat('chargedSpirit') : 0)) * (this.unit.stats.spiritMult ?? 1); // Boundless Spirit's % takes in every source (the wiki)
  }

  // Seconds after its cast delay that the hero casts no other ability (Bullet Dance can't be cut short by a cast). The game's
  // flags: a channelled ultimate holds the hero for its channel (9999 = until it ends itself: the hero's file handles those), an exclusive one
  // (Bullet Dance, Heavy Barrage, Last Stand) for its duration. A stun or anything else that stops the hero ends it (engine.js step).
  get lockout() {
    if (!this.ultimate) return 0;
    const bits = this.data.BehaviourBits ?? [];
    const channel = this.data.AbilityChannelTime === undefined ? 0 : this.value('AbilityChannelTime');
    if (bits.includes('BehaviorChannelled') && channel > 0 && channel < 100) return channel;
    return bits.includes('BehaviorExclusiveUse') ? this.value('AbilityDuration') : 0;
  }

  get cooldown() { return this.value('AbilityCooldown'); }
  get castDelay() { return this.value('AbilityCastDelay'); }

  // ---- charges (Extra Charge, Rapid Recharge, Omnicharge Signet; Haze's Smoke Bomb tier 2) ----
  // The wiki gives it charges (some abilities have 1), or Omnicharge Signet does: then it counts as charged for Extra Charge, Rapid Recharge and the
  // charged-ability bonuses too (the wiki).
  get charged() { return this.value('AbilityCharges') >= 1 || (this.imbued().chargesNonCharge ?? 0) > 0; }
  get maxCharges() {
    const im = this.imbued();
    if (!this.charged) return 1;
    const own = this.value('AbilityCharges') >= 1 ? this.value('AbilityCharges') + (im.charges ?? 0) : 1 + im.chargesNonCharge;
    return Math.round(own + this.unit.stat('bonusCharges'));
  }
  get charges() { return (this._charges ??= this.maxCharges); }
  set charges(n) { this._charges = Math.max(0, Math.min(this.maxCharges, n)); }
  // seconds between two uses of a charged ability (the wiki's, less charge cooldown items' cut)
  get chargeGap() { return Math.max(CHARGE_GAP, this.value('AbilityCooldownBetweenCharge')) * Math.max(0.1, 1 - this.unit.stat('chargeGapCut')); }

  use() {
    if (this.maxCharges <= 1) { this.cdLeft = this.cooldown; return; }
    this.charges -= 1;
    this.gapLeft = this.chargeGap;
    if (this.cdLeft <= 0) this.cdLeft = this.cooldown;
  }

  // One step of cooldown: a charged ability gets a charge back each time its cooldown runs out, and starts the next one while it isn't full.
  tickCooldown(dt) {
    this.gapLeft = Math.max(0, this.gapLeft - dt);
    if (this.maxCharges <= 1) { this.cdLeft = Math.max(0, this.cdLeft - dt); return; }
    if (this.charges >= this.maxCharges) { this.cdLeft = 0; return; }
    this.cdLeft -= dt;
    if (this.cdLeft <= 0) { this.charges += 1; this.cdLeft = this.charges < this.maxCharges ? this.cooldown : 0; }
  }

  // Back to full: every charge, no cooldown (Refresher).
  refresh() { this.cdLeft = 0; this.gapLeft = 0; this.charges = this.maxCharges; }

  // What the live fight message shows next to the ability: its cooldown, or "Ready"; a charged one with a charge in hand says how many ("Ready x2")
  // and, while one is still coming back, how long ("Ready x1  -  4s"); passives override it.
  status() {
    if (this.maxCharges > 1 && this.charges > 0) {
      const back = this.charges < this.maxCharges && this.cdLeft > 0 ? `  -  ${Math.ceil(this.cdLeft)}s` : '';
      return `Ready x${this.charges}${back}`;
    }
    const left = Math.max(this.cdLeft, this.gapLeft);
    return left > 0 ? `${Math.ceil(left)}s` : 'Ready';
  }

  // Whether any of its numbers scale with melee damage (engine.js damage gives such an ability 50% of the Weapon Damage bonus, the wiki).
  get meleeScaled() { return (this._meleeScaled ??= /"Type":"(heavy_)?melee"/.test(JSON.stringify(this.data))); }

  // Stacks the game keeps for good (Sticky Bomb, Combo, Guided Owl, Nox Nostra, Still Life, Bloodscent, Leech Therapy). in
  // Descend they last the whole run (descent.js puts them in the run's `kept`, by ability name); on the farm every fight starts without them.
  // Such an ability reads what it brings in with carried(), and has keep() (what it leaves) and stackText() (the screens' Stacks line).
  carried(fallback = 0) { return this.unit.kept?.[this.data.Name] ?? fallback; }

  // Timing for an ability whose stack needs the enemy dead soon after it lands (Assassinate, Guided Owl, Combo; "the hero
  // should try to use it at that specific time"). The hero's damage per second so far this fight (gun, abilities, items: engine.js `dealt`;
  // nothing to go on in the first second), and whether `e` would die within `seconds` of taking `burst` at that rate.
  dps(fight) { return fight.time > 1 ? (fight.dealt.get(this.unit) ?? 0) / fight.time : 0; }
  diesWithin(fight, e, burst, seconds) { return e.health <= burst + this.dps(fight) * seconds; }

  ready() {
    if (this.passive || !(this.cooldown > 0) || this.unit.cantAct) return false;
    return this.maxCharges > 1 ? this.charges > 0 && this.gapLeft <= 0 : this.cdLeft <= 0;
  }
  want() { return true; }
  cast() {}
  tick() {}
  on() {}
}

// A hero with no file in heroes/ still fights with its gun; its abilities just never fire.
class Unimplemented extends Ability {
  get passive() { return true; }
}

// True while one of the unit's abilities of these kinds is ready to cast: an ultimate's want() uses it to wait for its combo (
// Seven ulted before his stun and ball). A locked or cooling-down one doesn't hold it.
const anyReady = (unit, ...kinds) => unit.abilities.some((a) => kinds.some((K) => a instanceof K) && a.ready());

// An ability the hero hasn't unlocked yet (levels.js): it never fires and does nothing.
class Locked extends Ability {
  get passive() { return true; }
  status() { return 'Locked'; }
}

// A gun that spins up (McGinnis, Victor): from the stat sheet's fire rate to the wiki's fire rate at full spin while the hero fires, winding down
// while it doesn't (a reload). `state.spin` (0-1) is kept by the hero's slot-1 ability, which calls this every step with the wiki's weapon data.
function spinUp(state, weapon, fight, dt) {
  const u = state.unit;
  const firing = fight.foes.length > 0 && u.weapon.reloadLeft <= 0 && fight.time >= u.busyUntil && !u.cantAct && !u.has('disarm');
  state.spin = Math.min(1, Math.max(0, (state.spin ?? 0) + dt * (firing ? weapon.SpinAcceleration : -weapon.SpinDeceleration)));
  if (state.spin) fight.addStatus(u, { id: 'spin_up', duration: dt * 1.5, mods: { fireRate: state.spin * (weapon.RoundsPerSecondAtMaxSpin / weapon.RoundsPerSecond - 1) } });
}

// What a fight leaves of the hero's ability stacks: { ability name: what its keep() gives }.
const abilityStacks = (hero) => Object.fromEntries(hero.abilities.filter((a) => a.keep).map((a) => [a.data.Name, a.keep()]));

module.exports = { Ability, Unimplemented, Locked, anyReady, MIN_COOLDOWN, spinUp, abilityStacks };
