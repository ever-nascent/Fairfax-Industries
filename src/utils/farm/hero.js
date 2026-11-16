// Hero Farming: builds a fighting hero (a Unit) from the wiki data. Each file in heroes/ is one character's own
// ability logic: `module.exports = { name: 'Haze', abilities: { 1: SleepDagger, 2: ..., 3: ..., 4: ... } }`
// (a slot may be left out). They are loaded by hero name, like src/commands/. A hero without a file still fights with
// its gun; its abilities never fire.
const fs = require('node:fs');
const path = require('node:path');
const { Unit } = require('./engine');
const { Unimplemented, Locked } = require('./ability');
const { HEROES, ABILITIES, heroStats, cardFor, FRAGILE_BREAK } = require('./stats');
const { makeItems, NO_ULT_IMBUE } = require('./items');
const { stackResist } = require('./buffs');

const DIR = path.join(__dirname, 'heroes');
const LOGIC = Object.fromEntries(
  fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => require(path.join(DIR, f))).map((h) => [h.name, h]),
);

const heroNames = () => Object.keys(HEROES);
// Heroes a member can pick: the ones whose abilities have their own logic (a file in heroes/). The rest wait for theirs.
const roster = () => heroNames().filter((n) => LOGIC[n]);
const heroInfo = (name) => LOGIC[name]?.info ?? [];

// The "vs. NPCs" bonuses (Monster Rounds) at `scale` of the wiki's numbers: in /descend every enemy is an NPC, so a tier 1 item was always on (his call Nov 2: halved there).
function scaleNpc(s, scale) {
  const w = s.npcWeapon * (1 - scale);
  s.weaponDamageMult -= w;
  s.npcWeapon -= w;
  const r = s.npcBulletResist;
  if (r > 0 && r < 1) { // resists multiply, so take the item's share out of the stack and put the scaled share back
    s.bulletResist = 1 - (1 - s.bulletResist) * (1 - r * scale) / (1 - r);
    s.npcBulletResist = r * scale;
  }
}

/** @param tiers upgrades bought per slot, e.g. { 1: 2 }; @param boons level-ups; @param items item names; @param buffs permanent buffs; @param unlocked how many abilities
 *  (slots 1-4 in order) are unlocked; @param corrupted its corrupted item { name, drawback, amount } | null; @param imbues { item name: ability slot };
 *  @param copies the heroes whose ultimate Sinclair may copy: the member's other unlocked heroes (default: the whole roster, for simulations and rivals);
 *  @param kept the kill stacks it brings into the fight ({ item name: stacks }: Glass Cannon, Trophy Collector; items.js KEPT) */
function buildHero(name, { boons = 0, items = [], buffs = {}, bridge = [], tiers = {}, unlocked = 4, corrupted = null, enhanced = [], fragile = [], tempered = {}, imbues = {}, copies = null, kept = {}, healthScale = 1, rebirth = 0, npcScale = 1, tuning = 0, itemCd = {}, aura = 0, lesson = null } = {}) {
  const data = HEROES[name];
  if (!data) throw new Error(`Unknown hero: ${name}`);
  const unit = new Unit({ name, team: 'hero', stats: heroStats(data, { boons, items, buffs, bridge, corrupted, enhanced, fragile, tempered, rebirth }) });
  healthScale *= 1 + tuning; // /descend's per-hero tuning (descent.js TUNING): this much more (or less) health and damage
  if (healthScale !== 1) unit.health = unit.stats.maxHealth *= healthScale; // a /descend ascension (A14: lower max health)
  if (tuning) unit.stats.damageDealt = (unit.stats.damageDealt ?? 0) + tuning;
  if (npcScale !== 1) scaleNpc(unit.stats, npcScale);
  if (lesson) unit.lesson = lesson; // Dynamo's Lesson (Descend): damage to and from the kinds it studied (engine.js damage)
  if (aura) { unit.stats.bulletResist = stackResist(unit.stats.bulletResist, aura); unit.stats.spiritResist = stackResist(unit.stats.spiritResist, aura); } // Rem's Lil Helper (Descend): its resist while it lives
  unit.boons = boons; // item numbers that scale per boon read it
  unit.copies = copies ?? roster().filter((n) => n !== name);
  unit.kept = kept;
  unit.items = makeItems(items.map((n) => cardFor(n, corrupted, enhanced, fragile, tempered)), unit, imbues);
  for (const it of unit.items) if (itemCd[it.name]) it.cdScale = itemCd[it.name]; // Paradox's Time Capsule (Descend): this Item's own cooldown
  unit.held = [...items]; // every item's name, plain-stat ones too (unit.items has only the ones with effects); the screens list them (icons.js)
  unit.abilities = Object.entries(data.BoundAbilities).map(([slot, { Key }]) => {
    const Cls = Number(slot) > unlocked ? Locked : LOGIC[name]?.abilities[slot] || Unimplemented;
    return new Cls(Number(slot), ABILITIES[Key], unit, tiers[slot] || 0);
  });
  const gone = items.filter((n) => fragile.includes(n));
  if (gone.length) { // a Fragile Item shatters the moment the hero is nearly dead (the engine asks every step): its stats and effects go, the rest of the sheet stays as the fight left it
    unit.shatter = () => {
      if (unit.health >= unit.stats.maxHealth * FRAGILE_BREAK) return;
      unit.shatter = null;
      const sheet = (list) => heroStats(data, { boons, items: list, buffs, bridge, corrupted, enhanced, fragile, tempered, rebirth });
      const [before, after] = [sheet(items), sheet(items.filter((n) => !gone.includes(n)))];
      for (const key of Object.keys(after)) if (typeof after[key] === 'number' && key !== 'maxHealth') unit.stats[key] += after[key] - before[key];
      for (const by of ['weaponBy', 'spiritBy', 'lifestealBy', 'spiritLifestealBy']) for (const n of gone) delete unit.stats[by][n];
      unit.addMaxHealth((after.maxHealth - before.maxHealth) * healthScale);
      unit.items = unit.items.filter((it) => !gone.includes(it.name));
      unit.held = unit.held.filter((n) => !gone.includes(n));
      for (const a of unit.abilities) a.imbues = a.imbues.filter((it) => !gone.includes(it.name));
      unit.fragileBroke = gone;
    };
  }
  for (const it of unit.items) if (it.imbueSlot && !(NO_ULT_IMBUE.has(it.name) && it.imbueSlot === 4)) unit.abilities.find((a) => a.slot === it.imbueSlot)?.imbues.push(it); // (an old pick of the ultimate does nothing)
  return unit;
}

module.exports = { buildHero, heroNames, roster, heroInfo, implemented: Object.keys(LOGIC), logicOf: (name) => LOGIC[name] };
