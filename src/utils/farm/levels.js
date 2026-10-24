// Hero Farming: hero levels (boons), ability points and the 12 item slots (his calls, Oct 1-2; server-plan.md "Hero Farming").
// A hero levels up from the souls its trips have paid out (`earned` on the member's farm record), at the game's own thresholds (the wiki's
// Boon page) scaled by the same PAYOUT_SCALE as the payouts, so a level takes about as many trips as it takes a match's worth of farming.
// Each level is one boon (stats: heroStats `boons`). Ability unlocks and points follow the game's table.
const { PAYOUT_SCALE } = require('./targets');
const { ITEMS, LEGENDARIES, DRAWBACKS } = require('./stats');

// total souls (the game's scale) for level 0, 1, 2 ... 35. Level 0 is the 600 souls every player starts a match with.
const THRESHOLDS = [600, 800, 1100, 1500, 2000, 2600, 3200, 3800, 4500, 5200, 5900, 6600, 7400, 8200, 9000, 9800, 10700, 11600, 12500, 13400,
  14400, 15500, 16700, 18000, 19500, 21200, 23100, 25200, 27500, 30000, 32700, 35600, 38700, 42000, 45500, 49200];
const MAX_LEVEL = THRESHOLDS.length - 1;
const START = THRESHOLDS[0];
const UNLOCKS = (level) => (level >= 7 ? 4 : level >= 4 ? 3 : level >= 2 ? 2 : 1); // levels 0, 2, 4 and 7 unlock an ability
const POINTS = (level) => (level >= 8 ? level - 3 : [0, 1, 1, 2, 2, 3, 4, 4][level]); // total ability points at a level (32 at the max)
const TIER_COSTS = [1, 2, 5]; // points to buy tier 1, 2, 3 of an ability
const MAX_TIER = TIER_COSTS.length;

// Camps pay more as the hero levels. ponytail: +3% per level (x2 at the max) is a placeholder, he hasn't said how much.
const CAMP_BONUS_PER_LEVEL = 0.03;
const campMultiplier = (level) => 1 + CAMP_BONUS_PER_LEVEL * level;

// Where a hero stands, from the souls its trips have earned.
// Returns { level, unlocks, points (total), into, needed (souls of this level, in earned-souls units), max }.
function progress(earned = 0) {
  const total = earned / PAYOUT_SCALE + START;
  let level = 0;
  while (level < MAX_LEVEL && total >= THRESHOLDS[level + 1]) level++;
  const max = level === MAX_LEVEL;
  return {
    level, unlocks: UNLOCKS(level), points: POINTS(level), max,
    into: max ? 1 : (total - THRESHOLDS[level]) * PAYOUT_SCALE,
    needed: max ? 1 : (THRESHOLDS[level + 1] - THRESHOLDS[level]) * PAYOUT_SCALE,
  };
}

// Points already put into abilities: tiers = { <slot>: tier 0-3 }.
const pointsSpent = (tiers = {}) => Object.values(tiers).reduce((sum, t) => sum + TIER_COSTS.slice(0, t).reduce((a, b) => a + b, 0), 0);

// The level at which the nth ability unlocks (for "Unlocks at level N").
const unlockLevel = (slot) => [0, 0, 2, 4, 7][slot];

// ---- items: 12 slots for any mix of weapon, vitality and spirit items, like the game (his correction, Oct 3); wiki prices, paid from the server balance ----
// The pool is every shop item: each one's card is in fights (stats.js stats, items.js effects; his call, Oct 3).
const SLOTS = ['weapon', 'vitality', 'spirit'];
const MAX_ITEMS = 12;
const countItems = (items) => SLOTS.reduce((n, slot) => n + (items[slot]?.length ?? 0), 0);
const SLOT_OF = { Weapon: 'weapon', Armor: 'vitality', Tech: 'spirit' }; // the wiki's slot names
const SELL_BACK = 0.5; // an item sells for half its price, like the game (his call, Oct 2: changing a build costs souls)
// A corrupted item sells for half of what it cost: its price and the corruption's (his call, Oct 3).
const sellPrice = (card, corrupted = null) => Math.round(card.Cost * (corrupted?.name === card.Name ? 2 : 1) * SELL_BACK);
// in the wiki data but taken out of the game's shop (deadlock-api.com); the wiki's Tier 5 items are Street Brawl only, not in its data. Silencer was
// here Oct 2 - Oct 22 (disabled in the game then; back since, his call to sell it again).
const RETIRED = new Set();
const POOL = Object.fromEntries(SLOTS.map((slot) => [slot, ITEMS
  .filter((c) => SLOT_OF[c.Slot] === slot && c.Cost > 0 && !RETIRED.has(c.Name))
  .sort((a, b) => a.Tier - b.Tier || a.Cost - b.Cost || a.Name.localeCompare(b.Name))
  .map((c) => c.Name)]));
const ITEM_POOL = SLOTS.flatMap((slot) => POOL[slot]);

// ---- corruption (his calls, Oct 3): The Broker corrupts one owned tier 3 or 4 item per hero, for its price again, while he is open ----
// Open 30 minutes every 3 hours (UTC: 00:00-00:30, 03:00-03:30 ...), the same for everyone.
const BROKER = { every: 3 * 3600 * 1000, open: 30 * 60 * 1000 };
const brokerOpen = (now = Date.now()) => now % BROKER.every < BROKER.open;
const brokerNext = (now = Date.now()) => (brokerOpen(now) ? now : now - (now % BROKER.every) + BROKER.every); // when it next opens (now if open)
const brokerCloses = (now = Date.now()) => now - (now % BROKER.every) + BROKER.open;
const corruptible = (card) => !!card?.CorruptedUpgrades;
const corruptPrice = (card) => card.Cost;
// Items the wiki says can't roll a drawback of a kind (their own effect would undo it).
const NO_DRAWBACK = { 'Cursed Relic': ['cooldown'], 'Plated Armor': ['bulletResist'] };
// The one drawback: a random kind, a random amount in the item's tier range. Returns { drawback, amount }.
function rollDrawback(card, rng = Math.random) {
  const kinds = Object.keys(DRAWBACKS).filter((k) => !NO_DRAWBACK[card.Name]?.includes(k));
  const drawback = kinds[Math.floor(rng() * kinds.length)];
  const d = DRAWBACKS[drawback];
  const [lo, hi] = d.range[card.Tier >= 4 ? 1 : 0];
  const amount = d.whole ? lo + Math.floor(rng() * (hi - lo + 1)) : +(lo + rng() * (hi - lo)).toFixed(2);
  return { drawback, amount };
}

// Upgrade paths, like the game (his call, Oct 3): an item's price includes its components, so a member who owns one pays the difference and the
// component is used up (its slot is the new item's). priceFor gives { price, used: [component names owned] } for a member's items.
const BY_KEY = new Map(ITEMS.map((c) => [c.Key, c]));
const componentsOf = (card) => (card.Components ?? []).map((key) => BY_KEY.get(key)).filter(Boolean);
function priceFor(card, items) {
  const used = componentsOf(card).filter((c) => SLOTS.some((slot) => items[slot]?.includes(c.Name)));
  return { price: card.Cost - used.reduce((sum, c) => sum + c.Cost, 0), used: used.map((c) => c.Name) };
}
// The owned item that already holds `name` as a component, at any depth (an upgrade keeps its components' stats, so a second copy is refused;
// his call, Oct 3), or undefined.
const BY_NAME = new Map(ITEMS.map((c) => [c.Name, c]));
function heldIn(name, items) {
  const inside = (card) => componentsOf(card).some((c) => c.Name === name || inside(c));
  return SLOTS.flatMap((slot) => items[slot] ?? []).find((owned) => BY_NAME.has(owned) && inside(BY_NAME.get(owned)));
}

// Legendaries (his calls, Oct 2): all 17 of the game's Tier 5 items (Street Brawl's) can drop. Every enemy killed in a fight the hero wins
// (a wave run: the waves it cleared) has a 1% chance (his call, Oct 22; it was 0.01%); a legendary can't be sold.
// The legendary slot (his call, Oct 22): a 13th slot of its own, not one of the 12, that shows once the hero has a legendary and always holds
// one (record `legendary`, the one equipped). Every legendary the hero gets is kept (`legendaries`, each at most once per hero), and the member
// can change which one is in the slot at will (play.js equipLegendary).
const LEGENDARY_CHANCE = 0.01;
const SIEGE_LEGENDARY_CHANCE = 0.05; // a won siege rolls this once instead of the per-kill chance (his call, Oct 22)
const LEGENDARY_NAMES = LEGENDARIES.map((c) => c.Name);
// The legendary `kills` kills bring (one roll of `chance` each), never one in `owned`, or null.
function rollLegendary(kills, rng = Math.random, owned = [], chance = LEGENDARY_CHANCE) {
  const pool = LEGENDARY_NAMES.filter((n) => !owned.includes(n));
  if (!pool.length) return null;
  for (let i = 0; i < kills; i++) if (rng() < chance) return pool[Math.floor(rng() * pool.length)];
  return null;
}

// A member's items as { weapon: [names], vitality: [...], spirit: [...] } (older records may hold a single name per slot).
const itemsOf = (items = {}) => Object.fromEntries(SLOTS.map((slot) => [slot, [].concat(items[slot] ?? []).filter(Boolean)]));

module.exports = {
  THRESHOLDS, MAX_LEVEL, TIER_COSTS, MAX_TIER, SLOTS, MAX_ITEMS, countItems, priceFor, heldIn, LEGENDARY_NAMES, rollLegendary, SIEGE_LEGENDARY_CHANCE, SLOT_OF, sellPrice, POOL, ITEM_POOL, itemsOf,
  BROKER, brokerOpen, brokerNext, brokerCloses, corruptible, corruptPrice, rollDrawback,
  progress, pointsSpent, unlockLevel, campMultiplier, UNLOCKS, POINTS,
};
