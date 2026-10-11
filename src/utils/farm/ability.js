// Hero Farming: the base class every hero ability extends. It owns what is the same for all of them (the wiki's
// numbers, upgrade tiers, spirit scaling, cooldown and charges, imbued items, when to cast); a hero's own file (heroes/<hero>.js) only
// says what the ability does. The fight engine (engine.js) calls these hooks:
//   want(fight)          the auto-cast rule (default: cast whenever ready)
//   cast(fight)          the effect, after the wiki's cast delay
//   tick(fight, dt)      every step, for lasting effects
//   on(event, fight, p)  'damage' / 'bulletHit' / 'kill' / 'melee' ... payloads, e.g. Fixation stacking on bullet hits
//   wantsMelee(fight, t) optional: true when the hero should melee now (engine.js wantMelee)
//   passive = true       no cooldown, never cast, only tick() and on()
//   keep()               optional: the stacks it keeps for its hero after a fight ({ kills | hits | bats }), see KEEP below
// Slot 4 is the ultimate (Diviner's Kevlar, Lightning Scroll and ultimate cooldown reduction look for it).
const MIN_COOLDOWN = 0.2; // cooldown reduction stops at 80% off. ponytail: the game's own cap isn't on the wiki; reductions add up here.
const CHARGE_GAP = 1; // seconds between two charges of one ability when the wiki gives no gap (so extra charges don't all fire at once)

// Kept stacks (his calls, Oct 11): the stacks the game keeps for the whole match (Guided Owl, Assassinate, Combo and Bloodscent kills, Sticky Bomb
// hits and kills, Nox Nostra's bonus bats) stay with the hero from fight to fight, saved on its record (`stacks`: { kills, hits, bats }). Any
// kill counts; like Bebop's in the game the first KEEP.full count in full and the rest at half, and nothing counts past KEEP.cap.
// Only the hero's own ability keeps them: a copy (Sinclair's ultimate) starts at none and saves nothing.
const KEEP = { full: 7, cap: 30 };
const keptStacks = (n, full = KEEP.full, cap = KEEP.cap) => Math.min(n, full) + Math.max(0, Math.min(n, cap) - full) / 2;
// The saved stacks an ability starts from: its hero's own (buildHero's `stacks`), or none when another hero runs it (a copy, a rival's of another kit).
const keptOf = (ability, owner) => (ability.unit.name === owner ? ability.unit.kept ?? {} : {});

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
    if (!Object.keys(scales).length) return v;
    const u = this.unit;
    const im = this.imbued();
    if (scales.spirit) v += scales.spirit * this.spirit(im); // only when asked: spirit() reads `charged`, which reads value('AbilityCharges') (scaled by max_charges)
    v += (scales.weapon_damage_increase || 0) * (u.stats.weaponDamageMult - 1) * 100;
    if (scales.melee) v += scales.melee * (u.stats.lightMelee ?? 0) * (1 + u.stat('meleeDamage')); // x the hero's light melee damage
    if (scales.heavy_melee) v += scales.heavy_melee * (u.stats.heavyMelee ?? 0) * (1 + u.stat('meleeDamage')); // x its heavy melee damage (Billy's Bashdown T3)
    if ('duration' in scales) v *= u.stats.durationMult + u.mod('durationMult') + (im.duration ?? 0);
    if ('cooldown' in scales) v *= Math.max(MIN_COOLDOWN, 1 - u.stat('cdr') - (im.cdr ?? 0) - (this.charged ? u.stat('chargedCdr') : 0) - (this.ultimate ? u.stat('ultCdr') : 0));
    if ('radius' in scales || 'range' in scales) v *= u.range + (im.range ?? 0);
    return v;
  }

  // The spirit power this ability scales with: the hero's, temporary spirit (Infuser ...), imbued spirit and, for a charged ability, charged spirit.
  spirit(im = this.imbued()) {
    return this.unit.stats.spirit + this.unit.mod('spirit') + (im.spirit ?? 0) + (this.charged ? this.unit.stat('chargedSpirit') : 0);
  }

  get cooldown() { return this.value('AbilityCooldown'); }
  get castDelay() { return this.value('AbilityCastDelay'); }

  // ---- charges (Extra Charge, Rapid Recharge, Omnicharge Signet; Haze's Smoke Bomb tier 2) ----
  get charged() { return this.value('AbilityCharges') >= 1; } // the wiki gives it charges (some abilities have 1)
  get maxCharges() {
    const im = this.imbued();
    return this.charged ? Math.round(this.value('AbilityCharges') + this.unit.stat('bonusCharges') + (im.charges ?? 0)) : 1 + (im.chargesNonCharge ?? 0);
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

  // What the live fight message shows next to the ability: its cooldown, or "Ready"; passives override it.
  status() {
    const left = Math.max(this.maxCharges > 1 && this.charges > 0 ? 0 : this.cdLeft, this.gapLeft);
    return left > 0 ? `${Math.ceil(left)}s` : 'Ready';
  }

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

module.exports = { Ability, Unimplemented, Locked, MIN_COOLDOWN, spinUp, KEEP, keptStacks, keptOf };
