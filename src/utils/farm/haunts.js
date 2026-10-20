// Hero Farming: the Haunts' special attacks (his calls, Oct 10: "why can't enemies apply debuffs too"; Haunt camps only for now, on top of
// their normal hits). The wiki's Haunt page (checked Oct 10 2026, updated Oct 6) says what each family's special does and that only medium and
// large Haunts have one; the game data gives a Haunt's ability a 10% chance. Everything else here is a placeholder he approved as a preview:
// the wiki and the game files give no damage or durations; the debuffs were made harsher the same day (his call: longer and stronger). Damage is sized from the Haunt's own damage per second, so it follows the camp's
// hardness and growth. What lands on the hero is a real debuff: debuff resist shortens it, a cleanse removes it, Unstoppable ignores the sleep,
// and a silenced Haunt can't use its special. The engine rolls and runs these (engine.js `special`).
const CHANCE = 0.1; // each second, on top of the normal hit (the game data's AbilityChance01)
const TICK = 0.5; // seconds between two ticks of a burn

const worth = (haunt, seconds) => haunt.stats.dps * seconds;
const hit = (fight, haunt, hero, seconds, type = 'spirit', opts = {}) => fight.damage(haunt, hero, worth(haunt, seconds), type, { special: true, ...opts });
// a debuff that hurts every TICK while it lasts; each Haunt keeps its own, so two Haunts' burns add up
const burn = (fight, haunt, hero, id, seconds, share, mods = {}) => fight.debuff(hero, {
  id: `${id}:${fight.enemies.indexOf(haunt)}`, duration: seconds, mods,
  dot: { source: haunt, perSecond: worth(haunt, share), type: 'spirit', every: TICK, next: fight.time + TICK },
});

// family -> { name (the Battle Log), text (the camp's details screen), use(fight, haunt, hero) | onDeath(fight, haunt, hero) }
const SPECIALS = {
  past_due: { name: 'Book Barrage', text: 'A barrage of books: damage, then asleep for a moment.',
    use(fight, haunt, hero) { hit(fight, haunt, hero, 2); if (hero.alive) fight.cc(hero, { id: 'book_sleep', duration: 2, tags: ['sleep'] }); } },
  slum_shroom: { name: 'Spore Mines', text: 'Spore mines: damage over time, a slow, and healing halved.',
    use(fight, haunt, hero) { burn(fight, haunt, hero, 'spores', 6, 0.75, { healAmp: -0.5, slow: 0.4 }); } },
  stage_hand: { name: 'Laser', text: 'A laser that leaves fire behind: a burn.',
    use(fight, haunt, hero) { burn(fight, haunt, hero, 'laser_fire', 5, 1.25); } },
  underhand: { name: 'Laser', text: 'A laser that leaves fire behind: a burn.',
    use(fight, haunt, hero) { burn(fight, haunt, hero, 'laser_fire', 5, 1.25); } },
  gutter_ghoul: { name: 'Toxic Waste', text: 'Toxic waste that leaves a puddle: damage over time.',
    use(fight, haunt, hero) { burn(fight, haunt, hero, 'toxic_puddle', 8, 0.75); } },
  barrel_mimic: { name: 'Explosion', text: 'An explosion: one heavy hit.',
    use(fight, haunt, hero) { hit(fight, haunt, hero, 3); } },
  festival_spirit: { name: 'Fireworks', text: 'A barrage of homing fireworks: several hits.',
    use(fight, haunt, hero) { for (let i = 0; i < 4; i++) fight.at(i * 0.2, () => { if (hero.alive) hit(fight, haunt, hero, 0.75); }); } },
  crabbage_pot: { name: 'Melee Slam', text: 'A melee slam: a heavy hit that can be parried.',
    use(fight, haunt, hero) { hit(fight, haunt, hero, 3, 'melee', { attack: true }); } },
  specimen: { name: 'Death Burst', text: 'Explodes when it dies.',
    onDeath(fight, haunt, hero) { hit(fight, haunt, hero, 2); } },
};

// The special a Haunt of `family` fights with (small Haunts have none).
const specialFor = (family, small) => (!small && SPECIALS[family] ? { ...SPECIALS[family], chance: CHANCE } : null);

module.exports = { SPECIALS, specialFor };
