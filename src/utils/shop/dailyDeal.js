// Daily Deal (Shop, his pick Nov 13: a rotating shelf so there is a reason to open /shop every day): one thing a day at DEAL_OFF
// off, the same for everyone in a server, picked from the date (UTC midnight, like /urn and the quests). One per member per day.
// The thing is one the Shop already sells (a Hero Card in either style, a Soul Boost, a Rejuv), so buying goes through the usual
// buyCard / buyBoost / buyRejuv in xp.js at the deal's price. The screen: shop.js `dealView`; the button: components/shop.js.
const { createHash } = require('node:crypto');
const { HEROES } = require('../heroes');
const { updateUser, buyCard, buyBoost, buyRejuv } = require('../economy/xp');

const DEAL_OFF = 0.25; // placeholder ("Gentle", his pick): his to tune
// What can be on the shelf: `key` is the price key in shopSettings ITEMS, `section` the Shop section it belongs to (a section staff
// turned off is never the deal).
const KINDS = [
  { key: 'icon', section: 'hero-cards' },
  { key: 'portrait', section: 'hero-cards' },
  { key: 'boost', section: 'soul-boost' },
  { key: 'rejuv', section: 'rejuv' },
];

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

// Today's deal in `guildId`: { day, key, slug (a Hero Card's hero, else null), full (the usual price), price, endsAt (ms) },
// or null when every section it could come from is off. `cfg` = the server's shopConfig.
function dealOf(cfg, guildId, now = Date.now()) {
  const pool = KINDS.filter((k) => cfg.on(k.section));
  if (!pool.length) return null;
  const day = dayOf(now);
  const hash = createHash('sha1').update(`${guildId}:${day}`).digest();
  const { key, section } = pool[hash[0] % pool.length];
  const full = cfg.price(key);
  return {
    day,
    key,
    slug: section === 'hero-cards' ? HEROES[hash.readUInt16BE(1) % HEROES.length].slug : null,
    full,
    price: Math.round(full * (1 - DEAL_OFF)),
    endsAt: Date.parse(day) + 86_400_000,
  };
}

// Buys today's deal. The day is claimed first, inside the store lock, so two clicks at once can't both get the price; a buy
// that doesn't go through gives the claim back. Returns what buyCard / buyBoost / buyRejuv return, or { ok: false, reason: 'used' }.
async function buyDeal(userId, deal, now = Date.now()) {
  const claimed = await updateUser(userId, (user) => {
    if (user.dealDay === deal.day) return false;
    user.dealDay = deal.day;
    return true;
  });
  if (!claimed) return { ok: false, reason: 'used' };
  let result;
  try {
    result = deal.slug ? await buyCard(userId, `${deal.slug}:${deal.key}`, deal.price)
      : deal.key === 'boost' ? await buyBoost(userId, now, deal.price)
        : await buyRejuv(userId, deal.price);
  } finally {
    if (!result?.ok) await updateUser(userId, (user) => { user.dealDay = null; });
  }
  return result;
}

module.exports = { DEAL_OFF, dealOf, buyDeal };
