// The Shop's per-server settings (/shop-config): which sections are on, what each thing costs, the Hideout's level.
// Nothing saved = the defaults below (the old fixed numbers). Prices are in souls, as typed (not x SCALE).
const { getStore } = require('../../storage');
const { SCALE } = require('../economy/economy');
const { BOOST_PRICE, REJUV_PRICE } = require('../economy/xp');
const { HIDEOUT_PRICE, HIDEOUT_LEVEL } = require('./hideout');

// Every price, by key. `section` is the Shop section it belongs to (/shop-config turns sections on and off).
const ITEMS = {
  icon: { label: 'Hero Card (Icon)', section: 'hero-cards', price: 800 * SCALE },
  portrait: { label: 'Hero Card (Full Portrait)', section: 'hero-cards', price: 3200 * SCALE },
  boost: { label: 'Soul Boost', section: 'soul-boost', price: BOOST_PRICE },
  rejuv: { label: 'Rejuv', section: 'rejuv', price: REJUV_PRICE },
  hideout: { label: 'Hideout', section: 'hideout', price: HIDEOUT_PRICE },
  color: { label: 'Color Role', section: 'color-role', price: 1600 * SCALE }, // placeholder prices
  recolor: { label: 'Color Role Recolor', section: 'color-role', price: 400 * SCALE },
};
const SECTION_NAMES = {
  'daily-deal': 'Daily Deal', 'hero-cards': 'Hero Cards', 'soul-boost': 'Soul Boost', rejuv: 'Rejuv', hideout: 'Hideout', 'color-role': 'Color Role',
};

const settings = () => getStore('shopSettings'); // key: guild id -> { off: [section], prices: { key: souls }, hideoutLevel, colorBelow: role id }

// This server's Shop settings, ready to read: on(section), price(key), hideoutLevel, colorBelow.
async function shopConfig(guildId) {
  const s = (await settings().get(guildId)) ?? {};
  const off = new Set(s.off ?? []);
  return {
    on: (section) => !off.has(section),
    price: (key) => s.prices?.[key] ?? ITEMS[key].price,
    hideoutLevel: s.hideoutLevel ?? HIDEOUT_LEVEL,
    colorBelow: s.colorBelow ?? null,
    off,
  };
}

// `change(saved)` returns the new saved settings.
const updateShopConfig = (guildId, change) => settings().update(guildId, (s) => change({ ...(s ?? {}) }));

module.exports = { ITEMS, SECTION_NAMES, shopConfig, updateShopConfig };
