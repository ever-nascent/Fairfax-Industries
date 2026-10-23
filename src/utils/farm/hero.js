// Hero Farming: builds a fighting hero (a Unit) from the wiki data. Each file in heroes/ is one character's own
// ability logic: `module.exports = { name: 'Haze', abilities: { 1: SleepDagger, 2: ..., 3: ..., 4: ... } }`
// (a slot may be left out). They are loaded by hero name, like src/commands/. A hero without a file still fights with
// its gun; its abilities never fire.
const fs = require('node:fs');
const path = require('node:path');
const { Unit } = require('./engine');
const { Unimplemented, Locked } = require('./ability');
const { HEROES, ABILITIES, heroStats, cardFor } = require('./stats');
const { makeItems, NO_ULT_IMBUE } = require('./items');

const DIR = path.join(__dirname, 'heroes');
const LOGIC = Object.fromEntries(
  fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => require(path.join(DIR, f))).map((h) => [h.name, h]),
);

const heroNames = () => Object.keys(HEROES);
// Heroes a member can pick: the ones whose abilities have their own logic (a file in heroes/). The rest wait for theirs.
const roster = () => heroNames().filter((n) => LOGIC[n]);
const heroInfo = (name) => LOGIC[name]?.info ?? [];

/** @param tiers upgrades bought per slot, e.g. { 1: 2 }; @param boons level-ups; @param items item names; @param buffs permanent buffs; @param unlocked how many abilities
 *  (slots 1-4 in order) are unlocked; @param corrupted its corrupted item { name, drawback, amount } | null; @param imbues { item name: ability slot };
 *  @param copies the heroes whose ultimate Sinclair may copy: the member's other unlocked heroes (default: the whole roster, for simulations and rivals);
 *  @param kept the kill stacks it brings into the fight ({ item name: stacks }: Glass Cannon, Trophy Collector; items.js KEPT) */
function buildHero(name, { boons = 0, items = [], buffs = {}, bridge = [], tiers = {}, unlocked = 4, corrupted = null, imbues = {}, copies = null, kept = {} } = {}) {
  const data = HEROES[name];
  if (!data) throw new Error(`Unknown hero: ${name}`);
  const unit = new Unit({ name, team: 'hero', stats: heroStats(data, { boons, items, buffs, bridge, corrupted }) });
  unit.boons = boons; // item numbers that scale per boon read it
  unit.copies = copies ?? roster().filter((n) => n !== name);
  unit.kept = kept;
  unit.items = makeItems(items.map((n) => cardFor(n, corrupted)), unit, imbues);
  unit.abilities = Object.entries(data.BoundAbilities).map(([slot, { Key }]) => {
    const Cls = Number(slot) > unlocked ? Locked : LOGIC[name]?.abilities[slot] || Unimplemented;
    return new Cls(Number(slot), ABILITIES[Key], unit, tiers[slot] || 0);
  });
  for (const it of unit.items) if (it.imbueSlot && !(NO_ULT_IMBUE.has(it.name) && it.imbueSlot === 4)) unit.abilities.find((a) => a.slot === it.imbueSlot)?.imbues.push(it); // (an old pick of the ultimate does nothing)
  return unit;
}

module.exports = { buildHero, heroNames, roster, heroInfo, implemented: Object.keys(LOGIC), logicOf: (name) => LOGIC[name] };
