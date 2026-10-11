// Solomon's abilities (deadlock.wiki/Solomon, checked Oct 10 2026; page updated that day). Numbers come from the wiki data through
// Ability.value(); this file is only what each ability does. His pieces stay on the board and are moved by hand in the game; here nobody steers,
// so (his calls, Oct 10): squares hit the enemies standing within their reach of the front one, once each time they light up; the rooks hit again
// on every bounce (there is always a wall, the Doorman's cart rule). Taken by me: moving a piece never stops him shooting; the King's barrier goes
// up whenever ready and his one move slips a blast (like Dynamo and Mina); the Queen leaps as soon as each leap is ready; Checkmate takes any enemy.
const { Ability } = require('./../ability');
const { isBoss, npcShare } = require('./../items');

// How many times the bishop is moved before Solomon recalls it (and its cooldown starts). Infinity = it stays out all fight, the game as written.
// ponytail: the one knob for how strong the bishop is; his call once he has seen the numbers (server-plan.md "Solomon").
const BISHOP = { moves: Infinity };
const SQUARE = 3; // metres a square (the game data's GroundAuraSpacing)
const BOUNCE = 1; // seconds between two passes of the rooks. ponytail: the wiki gives no rook speed.

const boons = (a) => a.unit.boons ?? 0;
// a "power_increase" number: what the wiki data adds per boon (Ability.value() doesn't read it)
const perBoon = (field) => [].concat(field?.Scale ?? []).find((s) => s.Type === 'power_increase')?.Value ?? 0;
// how far a piece travels in one move: the enemies within that of the front one are in its way
const travel = (a) => a.value('MoveDistance') + perBoon(a.data.MoveDistance) * boons(a) * a.unit.range;
// how far its squares reach: square range grows with ability range, rounded to whole squares (the wiki)
const squares = (a) => Math.round(a.value('TileSteps') * a.unit.range) * SQUARE;
const died = (unit) => unit.statuses.some((s) => s.id === 'rejuv'); // a piece leaves the board when Solomon dies (a Rejuv getting him up)

// 1. Setup Bishop: a bishop that stays on the board. Every time its move is ready it is moved through the enemies: spirit damage (half to bosses)
// and a slow to the ones in its way; a moment later its squares light up: spirit damage to the ones standing in their reach. Its cooldown only
// starts when it is recalled. T1: moves further, a stronger slow. T2: a second bishop (taken by me: its hits deal less, the game data's multi-hit
// penalty). T3: one more square, and squares take spirit resist off, stacking.
class SetupBishop extends Ability {
  constructor(...args) {
    super(...args);
    this.out = false;
    this.moves = 0;
    this.nextMove = 0;
  }

  want(fight) { return fight.foes.length > 0 && !this.out; }
  status(fight) { return this.out ? 'On The Board' : super.status(fight); }

  cast(fight) {
    this.out = true;
    this.moves = 0;
    this.nextMove = fight.time + this.value('MoveCooldown');
  }

  recall() {
    this.out = false;
    this.cdLeft = this.cooldown;
  }

  tick(fight) {
    if (!this.out) return;
    this.cdLeft = this.cooldown; // the cooldown waits for the recall
    if (died(this.unit) || this.moves >= BISHOP.moves) { this.recall(); return; }
    if (fight.time + 1e-9 < this.nextMove || !fight.foes.length || this.unit.cantAct) return;
    this.nextMove = fight.time + this.value('MoveCooldown');
    this.moves += 1;
    for (let piece = 0; piece < this.value('MaxPieces'); piece++) {
      const share = (e) => (piece ? 1 - this.data.MultiHitPenaltyPercentage / 100 : 1) * (e.team !== 'hero' && isBoss(e) ? this.data.BossDamageScale : 1);
      for (const e of fight.near(travel(this))) {
        fight.damage(this.unit, e, this.value('ImpactDamage') * share(e), 'spirit');
        fight.addStatus(e, { id: 'bishop_slow', duration: this.value('SlowDuration'), mods: { slow: this.value('FadingSlowPercent') / 100 }, debuff: true });
      }
      fight.at(this.data.EnemyAuraModifier.PulseDelay, () => fight.running(this, () => {
        if (!this.unit.alive) return;
        for (const e of fight.near(squares(this))) {
          fight.damage(this.unit, e, this.value('Damage') * share(e), 'spirit');
          const shred = this.value('TechArmorDamageReductionPerStack');
          if (!shred || !e.alive) continue;
          const stacks = Math.min(this.value('MaxStacks'), (e.statuses.find((s) => s.id === 'bishop_squares')?.stacks ?? 0) + 1);
          fight.addStatus(e, { id: 'bishop_squares', duration: this.value('StackDuration'), stacks, mods: { spiritResist: (stacks * shred) / 100 }, debuff: true });
        }
      }));
    }
  }
}

// 2. Kingside Knight: nobody to promote, so Solomon develops himself as King (the game's self cast): double the barrier, no stamina. He has one
// move while it lasts, invulnerable on the way: it is held to slip an enemy's blast as it lands. T1: shorter cooldown. T2: a bigger barrier.
// T3: the move removes every debuff on him.
class KingsideKnight extends Ability {
  constructor(...args) {
    super(...args);
    this.until = 0;
    this.moved = true;
  }

  want(fight) { return fight.foes.length > 0 && fight.time >= this.until; }
  status(fight) { return fight && fight.time < this.until ? 'King' : super.status(fight); }

  cast(fight) {
    const duration = this.value('BuffDuration');
    this.until = fight.time + duration;
    this.moved = false;
    fight.addStatus(this.unit, { id: 'king', duration, barrier: this.value('CombatBarrier') * 2 });
  }

  move(fight) {
    this.moved = true;
    fight.log.push({ t: +fight.time.toFixed(1), who: this.unit.name, what: 'King\'s Move' });
    if (this.value('RemoveDebuffs')) fight.cleanse(this.unit);
  }

  // T3: with debuffs to remove, he also moves to shake one off (a Haunt's burn, spores or puddle)
  tick(fight) {
    if (this.moved || fight.time >= this.until || !this.value('RemoveDebuffs') || this.unit.cantAct || !this.unit.statuses.some((s) => s.debuff)) return;
    this.move(fight);
  }

  on(event, fight, p) {
    if (event !== 'blast' || p.target !== this.unit || p.parried || p.dodged || this.moved || fight.time >= this.until) return;
    p.dodged = true;
    this.move(fight);
  }
}

// 3. Rook Battery: a pair of rooks runs through the enemies in front: spirit damage and an immobilize (he walks up and melees), and again every
// time they come back off a wall (his call). T1: the enemies hit attack slower for a while (an NPC deals that much less damage, the Sinclair rule).
// T2: a share of their current health on top (cut against NPCs like every health share). T3: one more bounce, shorter cooldown, a longer immobilize.
class RookBattery extends Ability {
  want(fight) { return fight.foes.length > 0; }

  cast(fight) {
    const pass = () => fight.running(this, () => {
      if (!this.unit.alive) return;
      const slower = -this.value('FireRateSlow') / 100;
      for (const e of fight.near(travel(this))) {
        const ofHealth = ((e.health * this.value('CurrentHealthPercent')) / 100) * (e.team === 'hero' ? 1 : npcShare(e));
        fight.damage(this.unit, e, this.value('Damage') + ofHealth, 'spirit');
        fight.addStatus(e, { id: 'rook_hold', duration: this.value('ImmobilizeDuration'), tags: ['immobilize'], debuff: true });
        if (slower) fight.addStatus(e, { id: 'rook_slow', duration: this.value('DebuffDuration'), mods: e.team === 'hero' ? { fireRate: slower } : { damageDealt: slower }, debuff: true });
      }
    });
    pass();
    for (let i = 1; i <= this.value('MaxReflectCount'); i++) fight.at(i * BOUNCE, pass);
  }
}

// 4. Develop Queen: the queen crashes down on the front enemy: spirit damage around her, then her squares light up in lines: the same damage
// again, a stun and a slow to the enemies standing in their reach. She leaps and does it again every time her move is ready, until her moves are
// used up; her cooldown only starts when she leaves. T1: shorter cooldown. T2: a stronger slow, and Checkmate: an enemy she leaves below a set
// health dies (any enemy: his standing rule). T3: more leaps, one more square.
class DevelopQueen extends Ability {
  constructor(...args) {
    super(...args);
    this.out = false;
    this.left = 0; // landings still to come
    this.next = 0;
  }

  want(fight) { return fight.foes.length > 0 && !this.out; }
  status(fight) { return this.out ? 'On The Board' : super.status(fight); }

  cast(fight) {
    this.out = true;
    this.left = this.value('QueenBonusMoves');
    this.next = fight.time + this.value('MoveCooldown');
    this.land(fight);
  }

  land(fight) {
    const mate = this.value('CheckmateThreshold') && this.value('CheckmateThreshold') + perBoon(this.data.Upgrades[1].CheckmateThreshold) * boons(this);
    const hit = (reach, stun) => {
      for (const e of fight.near(reach)) {
        fight.damage(this.unit, e, this.value('Damage'), 'spirit');
        if (!e.alive) continue;
        if (mate && e.health < mate) { fight.damage(this.unit, e, e.health, 'true'); continue; }
        fight.addStatus(e, { id: 'queen_slow', duration: this.value('SlowDuration'), mods: { slow: this.value('SlowPercent') / 100 }, debuff: true });
        if (stun) fight.addStatus(e, { id: 'queen_stun', duration: this.value('StunDuration'), tags: ['stun'], debuff: true });
      }
    };
    hit(SQUARE, false);
    fight.at(0.5, () => fight.running(this, () => { if (this.unit.alive) hit(squares(this), true); })); // ponytail: the bishop's square delay; the wiki gives the queen's none
  }

  tick(fight) {
    if (!this.out) return;
    this.cdLeft = this.cooldown; // the cooldown waits until she leaves
    if (died(this.unit)) { this.out = false; return; }
    if (fight.time + 1e-9 < this.next || this.unit.cantAct) return;
    if (this.left <= 0 || !fight.foes.length) { this.out = false; return; }
    this.left -= 1;
    this.next = fight.time + this.value('MoveCooldown');
    this.land(fight);
  }
}

// What the hero pick shows: each ability's general description, in slot order (the 4th is the Ultimate). No pronouns, on purpose.
const info = [
  ['Setup Bishop', 'Sets a bishop on the board and keeps moving it through the enemies: damage and a slow, then its squares light up and damage them again.'],
  ['Kingside Knight', 'Takes the board as King: a strong barrier for a while, and one move that slips a blast.'],
  ['Rook Battery', 'Sends a pair of rooks through the enemies, damaging and immobilizing them, and again as the rooks bounce back.'],
  ['Develop Queen', 'The queen crashes down, damaging the enemies around, then stuns and damages them again along her squares, leaping to repeat it.'],
];

module.exports = { name: 'Solomon', abilities: { 1: SetupBishop, 2: KingsideKnight, 3: RookBattery, 4: DevelopQueen }, info, BISHOP };
