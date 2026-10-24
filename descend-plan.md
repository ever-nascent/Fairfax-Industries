# /descend: a roguelite mode for Hero Farming (plan, Oct 24, 2026; **built in full Oct 24, his ask**: what was decided is in server-plan.md "Descend")

His calls so far: starts at level 0 with no items; random items found as you go, **3 offered, pick 1** (like Street Brawl); ability points as you level;
**12 item slots stay the limit**; **items keep their upgrade paths**; **score = how far you get**; a **token** is possible as a reward;
**not the camp / roam / siege path: randomized enemies that get harder, like a real roguelike (Binding of Isaac).**

## What already exists that this reuses (checked in the code Oct 24)
- `runStages(hero, stages, { rng, maxSecondsPerStage, watch })` in `targets.js` runs ANY list of `{ name, enemies() }` with one hero; health, cooldowns and the clock carry between stages (waves already use it). A descent room is one such stage.
- `enemy(name, { maxHealth, dps, bulletResist, spiritResist, distance, healthRegen, dpsMaxHealthPct, damageType, blast, souls })` in `engine.js` builds any enemy. `assets/farm/npcs.json` has the real numbers for troopers, Haunts, Guardian, Walker, Mid-Boss, Shrine, Patron.
- `simulate(heroName, key, { boons, items, tiers, unlocked, buffs, kept, ... })` in `play.js` builds the hero and plays, replays and logs a fight (frames for the live message, Damage Breakdown). It only knows `TARGETS` keys, `'siege'` and `'waves'`, so it needs a `'descend'` branch (or the part below the stage list pulled out).
- `levels.js`: `THRESHOLDS`, `UNLOCKS`, `POINTS`, `TIER_COSTS`, `POOL` (156 items), `priceFor` / `heldIn` (upgrade paths), `MAX_ITEMS` 12, `rollLegendary`. `TRAITS` in `play.js` (Armored / Warded / Ironclad / Brittle) can be reused as enemy affixes.
- `kept` on a hero (Glass Cannon stacks) is how state survives between fights; run health can be carried the same way.
- `farm-sim.js` for tuning (add a `descend` command, same style as `waves`).

## The run
**State lives on the member, NOT on a hero's record** (`descent` next to `bestWave` and `tokens`), so a run can never touch a hero's real souls, items or level:
`{ hero, seed, room, level, tiers, items, legendary, buffs, rejuvs, health, kept, offer, points, phase }`. `phase`: `'offer'` (picking), `'ready'` (next room waiting), `'over'`.
Everything random comes from `seed + room`, so closing Discord can't reroll an offer or a room. Plus `bestDescent` (rooms, hero) per member and per hero.

**Rooms and floors.** A floor is 5 rooms: 4 fights + a boss. Endless; the score is rooms cleared.
1. `/descend` -> pick a hero (or resume the run) -> level 0, no items, 1 starting ability.
2. A fight room (live message, same as now). Win -> the hero gains 1 level (boons + ability points, abilities unlock at 0 / 2 / 4 / 7 as usual) and gets an **offer of 3 items** (weapon / vitality / spirit mixed, tier rises with depth: T1-2 early, up to T4 deep).
3. Pick 1, or **skip** (and heal a little). With 12 items full, a pick must replace one (the old one is lost, no sell-back, there are no souls in a run).
4. Ability points are spent from the same dropdown as the hero screen.
5. Health carries over with a small breather (like waves' 15%).
6. A **boss room** every 5th room, chosen at random from the real bosses (Guardian, Walker, Mid-Boss, Base Guardian, Shrine, Patron), scaled to the depth. Its reward is a bigger pick: **1 of 3 permanent buffs**, or on floor 3+ **1 of 3 legendaries** (the 13th slot). Boss rooms also drop a **Rejuv** (an extra life, as the Mid-Boss does now).
7. A hero's death ends the run (unless a Rejuv). The summary shows the rooms, the build and the Damage Breakdown button.

**Enemies (this is the "not a fixed ladder" part).** Each room has a **threat budget** = base x growth^room. The generator spends it on random archetypes, each with a cost:
- tank (lots of health, low damage), swarm (many small), glass cannon (high dps, low health, far away), healer (medic trooper, heals others), bruiser (melee), caster (spirit damage, a `blast`),
- plus **affixes** rolled on some enemies from room ~4 (the Isaac "champion" idea): the four `TRAITS`, and new ones such as Regenerating, Berserk (more dps under half health), Shielded, Silencing, Armor-breaking (cuts the hero's resists).
- Rooms should be telegraphed before the fight ("Room 12: 2 Tanks, 1 Healer, Warded") so a pick can answer the next room, like choosing items in Isaac.
- Scaling should be compounding like waves (`growth`), because a kitted hero is many times a fresh one.

**Items.** The offer is drawn from `POOL` by tier. If the hero holds a component, its upgrades are added to the offer more often; taking one **upgrades the component in place** (no extra slot, no cost). Excluded in a run: items that need real souls or the farm record (Golden Goose Egg, Hatch Egg, Eternal Gift's souls, Trophy Collector / Cultist Sacrifice souls), corruption and the Broker. (To verify against `items.js` before coding.)

## Rewards
- **Score:** rooms cleared; a `/descend leaderboard` (server best, and each member's best hero).
- **Token:** the first time a member reaches a set depth (e.g. room 25 = floor 5), once for the member, not per hero. His call: which depth, and whether it is per member or per hero.
- **No souls** (so it can't replace farming or touch the economy). Optional later: a hero-card badge per hero for the deepest floor.

## Build order (a checkpoint after each, nothing in Discord until step 3)
1. **Generator + sim.** `src/utils/farm/descent.js`: room generation, offers, level/points rules, pure functions. `node tools/farm-sim.js descend`: a bot that picks at random vs a bot that picks well, over many seeds. Checkpoint: the median depth of each (target to agree: random picks die around floor 3-4, good picks floor 8+; his call).
2. **Run state + tests.** Start, pick, skip, replace, upgrade-in-place, Rejuv, resume, seed reproducibility (`test/descent.test.js`). Checkpoint: tests pass.
3. **Screen mock-ups, one at a time** (his way): room telegraph, the 3-item offer, the boss reward, the run summary.
4. **`/descend` and the buttons** wired into `components/farm.js`, with the live fight message and Damage Breakdown reused.
5. **Boss rooms, buffs, legendaries, Rejuvs.**
6. **Leaderboard + token.**
7. **Tuning pass** with the sim, then the Discord check.

## Open questions for him
- Free to start any time, or one run per day? (Nothing is paid, so no cooldown is needed.)
- Does abandoning a run end it, or can a member keep one run waiting for days?
- Token depth, and per member or per hero.
- Do enemies see the hero's build (e.g. spirit-heavy builds meet more Warded)? Cheap, but it can feel unfair.
- A skip instead of a pick: what does it give (a heal? a free ability point?).

## To check in the code before coding (not verified yet)
- Whether `buildHero` can start a hero at a given health, or the run must set `hero.health` after building.
- Which items touch souls or the farm record, so they can be left out.
- How `kept` carries across separate Discord interactions (the hero is rebuilt each fight).
- The best place for the `'descend'` branch: inside `simulate`, or a new function sharing its frame and log code.
