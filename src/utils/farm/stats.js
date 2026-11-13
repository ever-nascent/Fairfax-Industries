// Hero Farming: a hero's fighting stats = the wiki's base stats + level boons + the items it holds.
// This file is the stats: the innate stat lines on the wiki's item cards (ITEM_STATS), and corruption (a corrupted item's card has the
// game's corrupted bonuses added, and the hero carries its one drawback). What an item does beyond its stats (procs, actives, buffs) is in items.js.
// Data comes from `npm run farm-data` (assets/farm/*.json). Rules: server-plan.md ("Hero Farming").
const path = require('node:path');
const { ASSETS } = require('../art');
const { applyBuffs, BRIDGE, KIT_BUFFS, stackResist } = require('./buffs');
const { PRECISION, HEADSHOT_BONUS } = require('./engine');
const { statMult } = require('./rebirth');

const load = (name) => require(path.join(ASSETS, 'farm', `${name}.json`));
const HEROES = load('heroes');
const ABILITIES = load('abilities');
const ITEMS = Object.values(load('items'));
const LEGENDARIES = Object.values(load('legendaries')); // Tier 5, never sold: they only drop (levels.js rollLegendary)

const itemByName = (name) => ITEMS.find((i) => i.Name.toLowerCase() === String(name).toLowerCase())
  ?? LEGENDARIES.find((i) => i.Name.toLowerCase() === String(name).toLowerCase());

// Precision on items (his ask, Oct 22: "add precision % increases to any item that you think should have precision, and add headshot precision to
// items that you personally think should have them"): flat points on the item's innate stats, written onto the loaded cards below so the shop
// pictures, the item pages and the stat sheet all see them. Two groups: the headshot items (Crippling Headshot +15 is his call; the others
// "slightly", +5), and my picks, the items whose bullet speed / zoom did nothing in fights (distance isn't a factor here), bigger for a higher
// tier. The base is 25 and a buff is 1. ponytail: placeholder numbers apart from Crippling Headshot's.
// Oct 28 (his ask): two stats, shown apart on the hero card: Precision (does the bullet land: spread pellets far away; my picks, the bullet speed /
// zoom / range items and Lucky Shot) and Headshot Precision (the headshot chance in %; the headshot items, plus Sharpshooter's zoom).
// Oct 29 (his calls): the headshot items give Headshot Precision only, and the most of it; an item with bullet velocity (its card's Bullet
// Velocity line) gives Precision, a lot (VELOCITY.precision a % of velocity: +10 for the usual +60%; +15 until his "a bit" less), and some Headshot Precision, less than any
// headshot item (VELOCITY.headshot a %, at most VELOCITY.headshotMax). The fights have no bullet travel time, so this is what velocity does.
const num = (v) => (typeof v === 'number' ? v : parseFloat(v) || 0); // the wiki writes distances "7m"
const ITEM_PRECISION = { 'Long Range': 5, 'Lucky Shot': 5 }; // no bullet velocity; my picks (Oct 22)
// a set amount (none from velocity on top); Infinite Rounds 25, his call Oct 29: a legendary beats every headshot item
const ITEM_HEADSHOT = { 'Crippling Headshot': 15, 'Headshot Booster': 5, 'Weakening Headshot': 5, Headhunter: 5, 'Spirit Rend': 5, 'Infinite Rounds': 25 };
const VELOCITY = { precision: 1 / 6, headshot: 1 / 20, headshotMax: 4 }; // ponytail: my placeholders
const velocityOf = (card) => num(Object.values(card).filter((info) => info?.Type).flatMap((info) => [...(info.Main ?? []), ...(info.Alt ?? [])])
  .find((l) => l.Key === 'BonusBulletSpeedPercent')?.Value);
// Written (or rewritten) from the card's own velocity, so an enhanced / corrupted card with more velocity gets more Precision (his call, Oct 31).
function setPrecision(card) {
  const innate = Object.values(card).find((info) => info?.Type === 'Innate');
  if (!innate) return;
  innate.Main = innate.Main.filter((l) => l.Key !== 'Precision' && l.Key !== 'HeadshotPrecision');
  const v = velocityOf(card);
  const precision = (ITEM_PRECISION[card.Name] ?? 0) + Math.round(v * VELOCITY.precision);
  const headshot = ITEM_HEADSHOT[card.Name] ?? Math.min(VELOCITY.headshotMax, Math.round(v * VELOCITY.headshot));
  if (precision) innate.Main.push({ Key: 'Precision', Value: precision, Label: 'Precision', Prefix: '{s:sign}', Postfix: '' });
  if (headshot) innate.Main.push({ Key: 'HeadshotPrecision', Value: headshot, Label: 'Headshot Precision', Prefix: '{s:sign}', Postfix: '' });
}
for (const card of [...ITEMS, ...LEGENDARIES]) setPrecision(card);
// Innate item stat -> change to the stat sheet. Values are the wiki's: flat amounts, or percents (divided here).
// Anything not listed (zoom, bullet speed, gravity, footsteps, melee resist: nothing on a farm uses them) is ignored.
const ITEM_STATS = {
  BonusHealth: (s, v) => { s.maxHealth += v; },
  BonusBaseHealth: (s, v) => { s.baseHealthPct += v / 100; }, // Colossus: % more of the hero's own health
  BonusHealthRegen: (s, v) => { s.healthRegen += v; },
  BaseAttackDamagePercent: (s, v) => { s.weaponDamageMult += v / 100; },
  BonusFireRate: (s, v) => { s.fireBonus += v / 100; }, // fire rate increases add up (the wiki; his call Oct 31); heroStats turns the sum into fireRate
  BonusClipSizePercent: (s, v) => { s.clip *= 1 + v / 100; },
  BulletResist: (s, v) => { s.bulletResist = stackResist(s.bulletResist, v / 100); }, // each resist takes its share of what the others let through
  TechResist: (s, v) => { s.spiritResist = stackResist(s.spiritResist, v / 100); },
  MeleeResistPercent: (s, v) => { s.meleeResist = stackResist(s.meleeResist, v / 100); }, // only melee hits: bullet and spirit resist don't touch them
  TechPower: (s, v) => { s.spirit += v; },
  SpiritPower: (s, v) => { s.spirit += v; },
  SpiritPowerInnate: (s, v) => { s.spirit += v; },
  BulletLifestealPercent: (s, v) => { s.lifesteal = stackResist(s.lifesteal, v / 100); }, // lifesteal stacks multiplicatively (the wiki), like resists
  CooldownReduction: (s, v) => { s.cdr += v / 100; },
  ItemCooldownReduction: (s, v) => { s.itemCdr += v / 100; },
  UltimateCooldownReduction: (s, v) => { s.ultCdr += v / 100; },
  BonusAbilityDurationPercent: (s, v) => { s.durationMult += v / 100; },
  OutOfCombatHealthRegen: (s, v) => { s.oocRegen += v; }, // per second, after a few seconds without taking damage
  AbilityLifestealPercentHero: (s, v) => { s.spiritLifesteal = stackResist(s.spiritLifesteal, v / 100); }, // heal from the damage its abilities and items deal
  AbilityLifestealPercentHeroPassive: (s, v) => { s.spiritLifesteal = stackResist(s.spiritLifesteal, v / 100); },
  TechPowerPercent: (s, v) => { s.spiritMult += v / 100; }, // % more spirit power
  MaxHealthLossPercent: (s, v) => { s.healthMult += v / 100; }, // Glass Cannon: -13
  // every farm enemy is an NPC; a rival hero is not, so a duel takes these back off (engine.js shotDamage / damage; npcWeapon, npcBulletResist)
  NonPlayerBonusWeaponPower: (s, v) => { s.weaponDamageMult += v / 100; s.npcWeapon += v / 100; },
  NonPlayerBulletResist: (s, v) => { s.bulletResist = stackResist(s.bulletResist, v / 100); s.npcBulletResist = stackResist(s.npcBulletResist, v / 100); },
  BonusMoveSpeed: (s, v) => { s.moveSpeed += v; }, // m/s: the chance to dodge a blast (engine.js DODGE)
  BonusSprintSpeed: (s, v) => { s.moveSpeed += v; }, // getting out of the way is a sprint
  TechRangeMultiplier: (s, v) => { s.rangeMult += v / 100; }, // ability range: how far area abilities and items reach (engine.js near)
  SlowResistancePercent: (s, v) => { s.slowResist = stackResist(s.slowResist, v / 100); }, // a slow on the hero is that much weaker (engine.js slowed)
  StatusResistancePercent: (s, v) => { s.statusResist = stackResist(s.statusResist, v / 100); }, // debuff resist: shortens an enemy blast's curse
  InnateStatusResistancePercent: (s, v) => { s.statusResist = stackResist(s.statusResist, v / 100); },
  HealAmpCastPercent: (s, v) => { s.healAmp += v / 100; },
  BonusMeleeDamagePercent: (s, v) => { s.meleeDamage += v / 100; },
  Stamina: (s, v) => { s.stamina += v; },
  StaminaCooldownReduction: (s, v) => { s.staminaCdr += v / 100; },
  SlideScale: (s, v) => { s.slideScale += v / 100; },
  Precision: (s, v) => { s.precision += v; }, // flat points (ITEM_PRECISION above, engine.js pelletChance)
  HeadshotPrecision: (s, v) => { s.headshot += v; }, // flat points, the headshot chance in % (ITEM_HEADSHOT above, engine.js headshotChance)
  BonusAttackRangePercent: (s, v) => { s.attackRange += v / 100; }, // pushes weapon falloff out
  OutgoingDamagePenaltyPercent: (s, v) => { s.damageDealt += v / 100; }, // Golden Goose Egg: -15% damage dealt
  BonusAbilityCharges: (s, v) => { s.bonusCharges += v; }, // charged abilities only (ability.js maxCharges)
  BonusSpiritForChargedAbilities: (s, v) => { s.chargedSpirit += v; },
  CooldownReductionOnChargedAbilities: (s, v) => { s.chargedCdr += v / 100; },
  CooldownBetweenChargeReduction: (s, v) => { s.chargeGapCut += v / 100; },
};

// Items whose Passive entry is plain stats, always on: item -> the keys of that entry to add like innate stats.
const PASSIVE_STATS = {
  'Superior Cooldown': ['CooldownReduction'], 'Transcendent Cooldown': ['CooldownReduction', 'ItemCooldownReduction'],
  'Greater Expansion': ['TechRangeMultiplier'], 'Superior Duration': ['BonusAbilityDurationPercent'],
  'Debuff Reducer': ['StatusResistancePercent'], 'Enduring Speed': ['SlowResistancePercent'], 'Healing Booster': ['HealAmpCastPercent'], 'Heroic Aura': ['BulletResist'],
  Witchmail: ['CooldownReduction'], 'Mystic Conduit': ['TechRangeMultiplier', 'CooldownReduction'], // Mystic Conduit's aura, at full strength on its holder
};
// A number from an item's Passive / Active / other non-innate entries (the effect numbers).
function effectValue(card, key) {
  for (const info of Object.keys(card).filter((k) => k.startsWith('Info')).map((k) => card[k])) {
    if (info.Type === 'Innate') continue;
    const hit = [...info.Main, ...info.Alt].find((e) => e.Key === key);
    if (hit) return num(hit.Value);
  }
  return num(card.Other?.[key]?.Value);
}

// The innate stat lines of an item card: [[key, value], ...].
function innateStats(card) {
  return Object.entries(card)
    .filter(([k, info]) => k.startsWith('Info') && info.Type === 'Innate')
    .flatMap(([, info]) => [...info.Main, ...info.Alt])
    .filter((s) => typeof s.Value === 'number' || /^-?[\d.]+m$/.test(s.Value)) // speeds are written "2.0m"
    .map((s) => [s.Key, parseFloat(s.Value)]);
}

// ---- corruption (his calls, Oct 3; levels.js has the Broker) ----
// A corrupted item's card: the game's CorruptedUpgrades are added to the item's own numbers wherever the card has them (a cooldown change goes to the
// cooldown of its active, or of its proc for ProcCooldown); a key the card doesn't have becomes a new stat line. Kept per item name.
const upgradedCards = new Map();
function upgradedCard(card, field) {
  if (!card?.[field]) return card;
  const cacheKey = `${field}:${card.Name}`;
  if (upgradedCards.has(cacheKey)) return upgradedCards.get(cacheKey);
  const out = structuredClone(card);
  const infos = Object.keys(out).filter((k) => k.startsWith('Info')).map((k) => out[k]);
  for (const [key, delta] of Object.entries(card[field])) {
    const d = num(delta);
    let found = false;
    for (const e of infos.flatMap((i) => [...i.Main, ...i.Alt]).concat(Object.values(out.Other ?? {}))) {
      if (e.Key !== key) continue;
      e.Value = typeof e.Value === 'number' || e.Value == null ? num(e.Value) + d : `${num(e.Value) + d}m`;
      found = true;
    }
    if (found) continue;
    if (key === 'AbilityCooldown' || key === 'ProcCooldown' || key === 'AbilityChargeUpTime') {
      const info = key === 'ProcCooldown' ? infos.find((i) => i.Type !== 'Active' && i.Type !== 'Innate' && i.Cooldown) : infos.find((i) => i.Type === 'Active' && i.Cooldown) ?? infos.find((i) => i.Type !== 'Innate' && i.Cooldown);
      if (info) { info.Cooldown = Math.max(0.1, info.Cooldown + d); continue; }
      if (out.Other?.AbilityCooldown) { out.Other.AbilityCooldown.Value = num(out.Other.AbilityCooldown.Value) + d; continue; }
    }
    let innate = infos.find((i) => i.Type === 'Innate');
    if (!innate) { innate = { Type: 'Innate', Main: [], Alt: [] }; out.InfoCorrupted = innate; }
    innate.Alt.push({ Key: key, Value: d });
  }
  setPrecision(out);
  upgradedCards.set(cacheKey, out);
  return out;
}
const corruptCard = (card) => upgradedCard(card, 'CorruptedUpgrades');
const enhancedCard = (card) => upgradedCard(card, 'PropertyUpgrades');

// The one drawback a corrupted item carries (the wiki's list, by item tier: [low, high] for tier 3 and for tier 4). Rolled once (levels.js rollDrawback).
const DRAWBACKS = {
  cooldown: { name: 'Ability Cooldown', unit: '%', range: [[12, 15], [15, 20]], apply: (s, v) => { s.cdr -= v / 100; } },
  range: { name: 'Ability Range', unit: '%', range: [[17, 23], [22, 29]], apply: (s, v) => { s.rangeMult -= v / 100; } },
  duration: { name: 'Ability Duration', unit: '%', range: [[13, 18], [17, 23]], apply: (s, v) => { s.durationMult -= v / 100; } },
  spirit: { name: 'Spirit Power', unit: '', range: [[26, 35], [39, 52]], apply: (s, v) => { s.spirit -= v; } },
  stamina: { name: 'Stamina', unit: '', range: [[1, 2], [1, 2]], whole: true, apply: (s, v) => { s.stamina -= v; } },
  staminaRecovery: { name: 'Stamina Recovery', unit: '%', range: [[16, 24], [21, 28]], apply: (s, v) => { s.staminaRegen -= v / 100; } },
  moveSpeed: { name: 'Move Speed', unit: ' m/s', range: [[1.7, 2.3], [2.34, 3.16]], apply: (s, v) => { s.moveSpeed -= v; } },
  maxHealth: { name: 'Max Health', unit: '', range: [[298, 403], [468, 633]], whole: true, apply: (s, v) => { s.maxHealth -= v; } },
  bulletResist: { name: 'Bullet Resist', unit: '%', range: [[12, 17], [16, 21]], apply: (s, v) => { s.bulletResist = stackResist(s.bulletResist, -v / 100); } },
  spiritResist: { name: 'Spirit Resist', unit: '%', range: [[12, 17], [16, 21]], apply: (s, v) => { s.spiritResist = stackResist(s.spiritResist, -v / 100); } },
  weaponDamage: { name: 'Weapon Damage', unit: '%', range: [[34, 46], [47, 64]], apply: (s, v) => { s.weaponDamageMult -= v / 100; } },
  fireRate: { name: 'Fire Rate', unit: '%', range: [[22, 29], [26, 35]], apply: (s, v) => { s.fireMult *= 1 - v / 100; } },
};
const drawbackText = ({ drawback, amount }) => `-${+amount.toFixed(2)}${DRAWBACKS[drawback].unit} ${DRAWBACKS[drawback].name}`;

// The card an item fights with: its corrupted card if it is the hero's corrupted item.
// `corrupted`: { name, drawback, amount }, null, or a list of them (a /descend run can carry several, his call Oct 30; a farm hero has one).
const corruptedList = (corrupted) => [].concat(corrupted ?? []);
// A Fragile Item (his ask, Oct 30; descent.js, the Broker's stall): the Broker's cracked gift, weaker until he mends it. Its innate stat lines (the
// numbers on the card's stat list) are scaled by FRAGILE; its passive and active effects are left alone. ponytail: scale effect numbers too if this is too mild.
const FRAGILE = 0.7;
const FRAGILE_BREAK = 0.10; // a hero under this share of its health shatters its Fragile Items, mid-fight (hero.js; his call, Oct 30)
function fragileCard(card) {
  if (!card) return card;
  const cacheKey = `fragile:${card.Name}`;
  if (upgradedCards.has(cacheKey)) return upgradedCards.get(cacheKey);
  const out = structuredClone(card);
  for (const info of Object.keys(out).filter((k) => k.startsWith('Info')).map((k) => out[k]).filter((i) => i.Type === 'Innate')) {
    for (const e of [...info.Main, ...info.Alt]) {
      if (typeof e.Value === 'number') e.Value *= FRAGILE;
      else if (/^-?[\d.]+m$/.test(e.Value)) e.Value = `${parseFloat(e.Value) * FRAGILE}m`;
    }
  }
  upgradedCards.set(cacheKey, out);
  return out;
}
const cardFor = (name, corrupted, enhanced = [], fragile = []) => {
  let card = itemByName(name);
  if (enhanced.includes(name)) card = enhancedCard(card);
  if (fragile.includes(name)) card = fragileCard(card);
  return corruptedList(corrupted).some((c) => c.name === name) ? corruptCard(card) : card;
};

// Guns that deal full damage at any distance: Graves' beam (the wiki: no falloff; his call, Oct 5: its 17 m limit isn't simulated). The game data's
// falloff numbers for it only shape Essence Theft's build-up (heroes/graves.js).
const NO_FALLOFF = new Set(['Graves']);
// Pellets of a spread shot that always land: one of Rat King's two is perfectly accurate (the wiki); the other can miss like any shotgun pellet.
const SURE_PELLETS = { 'Rat King': 1 };

// Stat sheet for a wiki hero (an entry of heroes.json) with `boons` level-ups, a list of item names, the member's permanent
// buffs ({ key: count }, buffs.js) and its corrupted item ({ name, drawback, amount } | null).
function heroStats(hero, { boons = 0, items = [], buffs = {}, bridge = [], corrupted = null, enhanced = [], fragile = [], rebirth = 0 } = {}) {
  const w = hero.Weapon;
  const ls = hero.LevelScaling || {};
  const s = {
    maxHealth: hero.MaxHealth + (ls.MaxHealth || 0) * boons,
    healthRegen: hero.BaseHealthRegen || 0,
    bulletDamage: w.BulletDamage + (ls.BulletDamage || 0) * boons, // per bullet
    pellets: w.HitOnceAcrossAllBullets ? 1 : w.BulletsPerShot, // Drifter's 3 pellets deal one shot's damage however many hit (the wiki)
    surePellets: SURE_PELLETS[hero.Name] ?? 0,
    fireRate: w.RoundsPerSecond, // the final rate, set at the end from fireBonus and fireMult
    fireBonus: 0, // the sum of every fire rate increase (items, buffs, Warden's spirit)
    fireMult: 1, // decreases (a corrupted drawback) multiply
    clip: w.ClipSize,
    reload: w.ReloadTime,
    falloff: { start: w.FalloffStartRange, end: w.FalloffEndRange, startScale: w.FalloffStartScale, endScale: NO_FALLOFF.has(hero.Name) ? w.FalloffStartScale : w.FalloffEndScale },
    weaponDamageMult: 1,
    spirit: (ls.TechPower || 0) * boons,
    bulletResist: 0,
    meleeResist: 0,
    spiritResist: ((ls.TechResist || 0) * boons) / 100, // Kelvin: 0.625% a level (wiki)
    lifesteal: 0,
    spiritLifesteal: 0,
    weaponBy: {}, // item -> the bonus weapon damage it gave (a fraction); spiritBy: item -> the spirit power (the Damage Breakdown names them)
    spiritBy: {},
    lifestealBy: {}, // item -> how much of lifesteal / spiritLifesteal it gave (the Healing page names them)
    spiritLifestealBy: {},
    oocRegen: 0,
    spiritMult: 1,
    healthMult: 0,
    baseHealthPct: 0,
    cdr: 0,
    itemCdr: 0,
    ultCdr: 0,
    durationMult: 1,
    moveSpeed: hero.MaxMoveSpeed,
    rangeMult: 1,
    statusResist: 0,
    healAmp: 0,
    damageDealt: 0,
    heavyMelee: (hero.HeavyMeleeDamage || 0) + (ls.HeavyMeleeDamage || 0) * boons,
    lightMelee: (hero.LightMeleeDamage || 0) + (ls.LightMeleeDamage || 0) * boons, // what an ability's "melee" scaling multiplies (Bebop's Uppercut and Grapple Arm)
    meleeDamage: 0,
    stamina: hero.Stamina || 0,
    staminaCooldown: hero.StaminaCooldown || 5,
    staminaCdr: 0,
    staminaRegen: 0,
    slideScale: 0,
    attackRange: 0,
    precision: PRECISION.base, // flat points: above the base, more spread pellets landing (engine.js)
    headshot: PRECISION.base, // Headshot Precision: the headshot chance in % (engine.js headshotChance; his call, Oct 28: apart from Precision)
    headshotBonus: HEADSHOT_BONUS + (hero.CritDamageBonusPercent || 0) / 100, // a headshot's bonus bullet damage (engine.js HEADSHOT_BONUS)
    noHeadshot: hero.Weapon?.CanCrit === false || hero.Name === 'Graves', // Graves: the wiki says she can't crit, her beam's data says it can // the wiki: Deadman Danny and Paige can't headshot (Oct 29, his call for Danny)
    bonusCharges: 0,
    chargedSpirit: 0,
    chargedCdr: 0,
    chargeGapCut: 0,
    npcWeapon: 0,
    slowResist: 0,
    npcBulletResist: 0,
  };
  const baseHealth = s.maxHealth;
  const levels = s.spirit; // the spirit power the hero's own levels give
  for (const name of items) {
    const card = cardFor(name, corrupted, enhanced, fragile);
    if (!card) throw new Error(`Unknown item: ${name}`);
    const [bullet, spirit, weapon, power] = [s.lifesteal, s.spiritLifesteal, s.weaponDamageMult, s.spirit];
    for (const [key, value] of innateStats(card)) ITEM_STATS[key]?.(s, value);
    for (const key of PASSIVE_STATS[name] ?? []) ITEM_STATS[key]?.(s, effectValue(card, key));
    if (s.lifesteal > bullet) s.lifestealBy[name] = s.lifesteal - bullet;
    if (s.spiritLifesteal > spirit) s.spiritLifestealBy[name] = s.spiritLifesteal - spirit;
    if (s.weaponDamageMult > weapon) s.weaponBy[name] = s.weaponDamageMult - weapon;
    if (s.spirit > power) s.spiritBy[name] = s.spirit - power;
  }
  for (const c of corruptedList(corrupted)) if (items.includes(c.name)) DRAWBACKS[c.drawback]?.apply(s, c.amount);
  applyBuffs(s, buffs);
  for (const key of bridge) KIT_BUFFS[key]?.apply(s); // the bridge buffs, and the Soul Urn's carrier (buffs.js)
  const reborn = statMult(rebirth); // Rebirth (rebirth.js): a permanent bonus to health, weapon damage and spirit power
  s.weaponDamageMult *= reborn;
  s.spiritMult *= reborn;
  s.spirit *= s.spiritMult;
  for (const name of Object.keys(s.spiritBy)) s.spiritBy[name] *= s.spiritMult;
  if (levels > 0) s.spiritBy.Levels = levels * s.spiritMult;
  s.maxHealth = Math.max(1, (s.maxHealth + baseHealth * s.baseHealthPct) * (1 + s.healthMult) * reborn);
  s.bulletDamage += (hero.SpiritScaling?.BulletDamage || 0) * s.spirit; // Grey Talon: +0.08 bullet damage and a little move speed per spirit power (wiki)
  s.moveSpeed += ((hero.SpiritScaling?.MaxMoveSpeed || 0) + (hero.SpiritScaling?.SprintSpeed || 0)) * s.spirit; // sprint speed counts like move speed (Wraith: 0.05 a point)
  s.healthRegen += (hero.SpiritScaling?.BaseHealthRegen || 0) * s.spirit; // Victor: 0.08 a second per spirit power (wiki)
  s.fireBonus += ((hero.SpiritScaling?.FireRate || 0) * s.spirit) / 100; // Warden: 0.21% fire rate per spirit power (wiki)
  s.fireRate = w.RoundsPerSecond * (1 + s.fireBonus) * s.fireMult;
  for (const [key, stat] of [['BulletResist', 'bulletResist'], ['TechResist', 'spiritResist']]) s[stat] = stackResist(s[stat], ((hero.SpiritScaling?.[key] || 0) * s.spirit) / 100); // Venator: 0.12% of each per spirit power (wiki)
  s.clip = Math.ceil(s.clip - 1e-9); // the wiki (Extended Magazine): the ammo a percentage adds is rounded up (1e-9 keeps 10 x 1.3 at 13)
  s.clip = Math.floor(s.clip + (hero.SpiritScaling?.ClipSize || 0) * s.spirit); // Haze: +0.5 rounds per spirit power (wiki)
  if (w.ReloadSingle) s.reload = w.ReloadDelay + w.ReloadTime * s.clip; // shell by shell (Abrams): a pause, then ReloadTime for every round
  return s;
}

module.exports = { HEROES, ABILITIES, ITEMS, LEGENDARIES, itemByName, innateStats, heroStats, ITEM_STATS, effectValue, corruptCard, enhancedCard, fragileCard, FRAGILE, FRAGILE_BREAK, cardFor, DRAWBACKS, drawbackText };
