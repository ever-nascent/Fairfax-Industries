// XP, levels and souls. Members earn XP by chatting (and optionally by sitting in voice);
// every level-up pays souls, the server currency. Rules are in server-plan.md ("XP / levels").
const { EmbedBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { SCALE } = require('./economy');
const { CARD_COLOR } = require('./rankCard');
const { setSoulsEmoji, soulsText } = require('./format');
const { pickRandom } = require('./random');
const { findEmoji } = require('./guild');
const ledger = require('./soulsLedger');

const MAX_LEVEL = 99;
const DEFAULTS = {
  minXp: 15, // XP per counted message is random between minXp and maxXp
  maxXp: 25,
  cooldownSeconds: 60, // at most one counted message per this many seconds
  voiceEnabled: false,
  voiceXpPerMinute: 10,
  levelUpChannelId: null, // null = level-ups aren't announced
  minLength: 0, // chat messages shorter than this (characters) earn no XP; 0 = any message counts
  ignoredChannelIds: [], // channels (or categories) where chat and voice earn no XP
};
const URN_BASE = 100 * SCALE; // day 1 of a streak
const URN_PER_DAY = 20 * SCALE; // extra per day in a row
const URN_MAX_DAYS = 7; // streak bonus stops growing here
const BOOST_PRICE = 1600 * SCALE; // Soul Boost (Shop): 2x XP and souls for an hour; buying again adds an hour
const BOOST_MS = 60 * 60 * 1000;
const REJUV_PRICE = 3200 * SCALE; // Rejuv (Shop): saves a broken /urn streak; carry up to REJUV_MAX, like the in-game 3 credits
const REJUV_MAX = 3;
const TRIVIA_BASE = 25 * SCALE; // /trivia: a right answer pays this, +TRIVIA_STEP for each right answer in a row before it
const TRIVIA_STEP = 5 * SCALE;
const TRIVIA_MAX_STREAK = 10; // 25, 30 ... 70 at 10 in a row
const TRIVIA_DAILY = 10; // right answers that pay per UTC day; after that trivia is for fun

// ponytail: a write rewrites data/xp.json (chat/voice XP is batched, see addXp). Fine for one community server; move to SQLite if it gets slow.
const users = () => getStore('xp'); // key: user id (the bot only serves one server)
const settings = () => getStore('xpSettings'); // key: guild id

// XP needed to go from `level` to `level + 1` (the MEE6 curve).
const xpToNext = (level) => 5 * level * level + 50 * level + 100;
// Souls paid for reaching `level`.
const soulsFor = (level) => Math.round(25 * SCALE * level ** 1.5);

// Total XP a member has on reaching `level` (the start of that level).
const xpForLevel = (level) => Array.from({ length: Math.min(level, MAX_LEVEL) }, (_, l) => xpToNext(l)).reduce((a, b) => a + b, 0);

// Total XP -> { level, into (XP into this level), need (XP this level takes) }.
function progress(totalXp) {
  let level = 0;
  let rest = totalXp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) rest -= xpToNext(level++);
  return { level, into: rest, need: level < MAX_LEVEL ? xpToNext(level) : 0 };
}

// cards: owned hero cards as '<slug>:<style>'; card: the one /rank shows (null = plain card).
// boostUntil: when their Soul Boost runs out (ms timestamp; 0 = never bought).
// triviaStreak: right answers in a row; triviaDay / triviaPaid: the UTC day and how many right answers paid on it.
// rejuvs: Rejuvs they carry (0-3).
const blankUser = () => ({
  xp: 0, level: 0, souls: 0, lastXpAt: 0, urnDay: null, urnStreak: 0, cards: [], card: null, boostUntil: 0,
  triviaStreak: 0, triviaDay: null, triviaPaid: 0, rejuvs: 0,
});

// 2 while a Soul Boost is running, else 1. Doubles chat/voice XP, level-up souls, /urn and /trivia; never game winnings.
const boostMultiplier = (user, now = Date.now()) => (user.boostUntil > now ? 2 : 1);

async function getUser(userId) {
  return { ...blankUser(), ...(await users().get(userId)) };
}

// Changes one user inside the store lock. `change(user)` edits the copy it gets and returns the result for
// the caller; the file is only written if the user actually changed.
async function updateUser(userId, change, options) {
  let result;
  await users().update(userId, (current) => {
    const user = { ...blankUser(), ...current };
    const before = JSON.stringify(user);
    result = change(user);
    return JSON.stringify(user) === before ? current : user;
  }, options);
  return result;
}

async function getSettings(guildId) {
  return { ...DEFAULTS, ...(await settings().get(guildId)) };
}

async function updateSettings(guildId, change) {
  return settings().update(guildId, (current) => {
    const copy = { ...DEFAULTS, ...current };
    change(copy);
    return copy;
  });
}

// True if `channel` (or its category, or a thread's parent) is on the no-XP list.
const isIgnored = (s, channel) =>
  [channel.id, channel.parentId, channel.parent?.parentId].some((id) => id && s.ignoredChannelIds.includes(id));

const lastText = new Map(); // user id -> their previous message, so repeating yourself earns nothing
const sameText = (text) => text.trim().toLowerCase();

// Does a chat message count towards XP? Not: system messages, webhooks, ignored channels, too short, or the same
// text as that member's previous message. `censored` = the censor is deleting it. Remembers the text either way.
function chatCounts(message, s, censored = false) {
  const text = sameText(message.content ?? '');
  const repeat = text !== '' && lastText.get(message.author.id) === text;
  lastText.set(message.author.id, text);
  return !(message.system || message.webhookId || censored || repeat || isIgnored(s, message.channel) || text.length < s.minLength);
}

// Who earns voice XP this minute: members in a channel with at least one other listener (bots, deafened members, the
// AFK channel and ignored channels don't count). Returns member ids.
function voiceEarners(guild, s) {
  const byChannel = new Map();
  for (const { channel, member, deaf } of guild.voiceStates.cache.values()) {
    if (!channel || !member || member.user.bot || deaf || channel.id === guild.afkChannelId || isIgnored(s, channel)) continue;
    byChannel.set(channel.id, [...(byChannel.get(channel.id) ?? []), member.id]);
  }
  return [...byChannel.values()].filter((ids) => ids.length >= 2).flat();
}

// Adds XP (respecting the chat cooldown when `fromChat`), pays souls for every level gained.
// Returns { user, gained: [levels reached], souls: souls paid } or null if nothing changed.
async function addXp(userId, amount, { fromChat = false, cooldownSeconds = 0 } = {}) {
  const result = await updateUser(userId, (user) => {
    const now = Date.now();
    if (user.level >= MAX_LEVEL) return null;
    if (fromChat && now - user.lastXpAt < cooldownSeconds * 1000) return null;
    if (fromChat) user.lastXpAt = now;

    const boost = boostMultiplier(user, now);
    user.xp += amount * boost;
    const { level } = progress(user.xp);
    const gained = [];
    for (let l = user.level + 1; l <= level; l++) gained.push(l);
    const souls = gained.reduce((sum, l) => sum + soulsFor(l), 0) * boost;
    user.level = level;
    user.souls += souls;
    return { user, gained, souls };
  }, { defer: true }); // chat/voice XP is written within a few seconds, not on every message
  if (result?.souls) ledger.record(userId, result.souls, 'level-up', result.user.souls);
  return result;
}

// Daily Soul Urn. Days are UTC calendar days; claiming on consecutive days grows the streak.
// A streak of 2+ days that broke can be saved with a Rejuv (however many days were missed). If they carry one,
// the first call only asks ({ ask: true }); call again with rejuv: true (use it) or false (start over, keep it).
// Returns { claimed: false, user } (already claimed today), { claimed: false, ask: true, user },
// or { claimed: true, souls, user, rejuvUsed }.
async function claimUrn(userId, now = new Date(), { rejuv } = {}) {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const result = await updateUser(userId, (user) => {
    if (user.urnDay === today) return { claimed: false, user };
    const broke = user.urnDay !== yesterday && user.urnStreak >= 2;
    if (broke && user.rejuvs > 0 && rejuv === undefined) return { claimed: false, ask: true, user };
    const rejuvUsed = broke && user.rejuvs > 0 && rejuv === true;
    if (rejuvUsed) user.rejuvs--;
    user.urnStreak = user.urnDay === yesterday || rejuvUsed ? user.urnStreak + 1 : 1;
    user.urnDay = today;
    const souls = (URN_BASE + URN_PER_DAY * (Math.min(user.urnStreak, URN_MAX_DAYS) - 1)) * boostMultiplier(user, now.getTime());
    user.souls += souls;
    return { claimed: true, souls, user, rejuvUsed };
  });
  if (result.claimed) ledger.record(userId, result.souls, 'urn', result.user.souls);
  return result;
}

// Buys a Rejuv (saves a broken /urn streak). Returns { ok: true, user } or { ok: false, reason: 'full' | 'souls' }.
async function buyRejuv(userId) {
  const result = await updateUser(userId, (user) => {
    if (user.rejuvs >= REJUV_MAX) return { ok: false, reason: 'full' };
    if (user.souls < REJUV_PRICE) return { ok: false, reason: 'souls' };
    user.souls -= REJUV_PRICE;
    user.rejuvs++;
    return { ok: true, user };
  });
  if (result.ok) ledger.record(userId, -REJUV_PRICE, 'shop:rejuv', result.user.souls);
  return result;
}

// Adds `delta` souls (negative = spend). `meta` says why, for the souls ledger: a reason ('farm', 'hideout' ...,
// see soulsLedger.js) or { reason, with }. Returns the updated user, or null if they can't afford it.
async function changeSouls(userId, delta, meta = 'other') {
  const user = await updateUser(userId, (user) => {
    if (user.souls + delta < 0) return null;
    user.souls += delta;
    return user;
  });
  if (user) ledger.record(userId, delta, meta, user.souls);
  return user;
}

// What the next right /trivia answer would pay (before a Soul Boost), and how many paid answers are left today.
function triviaOdds(user, now = new Date()) {
  const paid = user.triviaDay === now.toISOString().slice(0, 10) ? user.triviaPaid : 0;
  const left = TRIVIA_DAILY - paid;
  return { left, souls: left > 0 ? TRIVIA_BASE + TRIVIA_STEP * Math.min(user.triviaStreak, TRIVIA_MAX_STREAK - 1) : 0 };
}

// A /trivia answer. Right: the streak grows (max TRIVIA_MAX_STREAK) and pays triviaOdds, doubled by a running
// Soul Boost, while today's TRIVIA_DAILY paid answers last. Wrong (or time's up): the streak starts over.
// Returns { user, streak, souls (paid) }.
async function triviaAnswer(userId, right, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const result = await updateUser(userId, (user) => {
    const souls = right ? triviaOdds(user, now).souls * boostMultiplier(user, now.getTime()) : 0;
    if (user.triviaDay !== today) Object.assign(user, { triviaDay: today, triviaPaid: 0 });
    user.triviaStreak = right ? Math.min(user.triviaStreak + 1, TRIVIA_MAX_STREAK) : 0;
    if (souls) {
      user.triviaPaid++;
      user.souls += souls;
    }
    return { user, streak: user.triviaStreak, souls };
  });
  ledger.record(userId, result.souls, 'trivia', result.user.souls);
  return result;
}

// Buys an hour of Soul Boost (added on top of any time left). Returns { ok: true, user } or { ok: false, reason: 'souls' }.
async function buyBoost(userId, now = Date.now()) {
  const result = await updateUser(userId, (user) => {
    if (user.souls < BOOST_PRICE) return { ok: false, reason: 'souls' };
    user.souls -= BOOST_PRICE;
    user.boostUntil = Math.max(now, user.boostUntil) + BOOST_MS;
    return { ok: true, user };
  });
  if (result.ok) ledger.record(userId, -BOOST_PRICE, 'shop:boost', result.user.souls);
  return result;
}

// Buys hero card `key` ('<slug>:<style>') for `price` souls and puts it on their /rank.
// Returns { ok: true, user } or { ok: false, reason: 'owned' | 'souls' }.
async function buyCard(userId, key, price) {
  const result = await updateUser(userId, (user) => {
    if (user.cards.includes(key)) return { ok: false, reason: 'owned' };
    if (user.souls < price) return { ok: false, reason: 'souls' };
    user.souls -= price;
    user.cards = [...user.cards, key];
    user.card = key;
    return { ok: true, user };
  });
  if (result.ok) ledger.record(userId, -price, 'shop:card', result.user.souls);
  return result;
}

// Puts an owned card on their /rank (null = plain card). Returns false if they don't own it.
function equipCard(userId, key) {
  return updateUser(userId, (user) => {
    if (key !== null && !user.cards.includes(key)) return false;
    user.card = key;
    return true;
  });
}

// Staff edits (/xp, /souls). Each takes the current value and the amount, returns the new value.
const EDITS = {
  add: (value, amount) => value + amount,
  subtract: (value, amount) => value - amount,
  set: (_value, amount) => amount,
  'set-level': (_value, level) => xpForLevel(level), // XP only: the start of that level
  reset: () => 0,
};

// Pure: a copy of `user` with `stat` ('xp' or 'souls') edited. Never below 0; the level follows
// the XP, and levels gained this way pay no souls.
function applyEdit(user, { stat, action, amount = 0 }) {
  const edited = { ...user, [stat]: Math.max(0, EDITS[action](user[stat], amount)) };
  return { ...edited, level: progress(edited.xp).level };
}

// Saves applyEdit's result. Returns the updated user.
async function editUser(userId, edit) {
  let before = 0;
  const user = await users().update(userId, (current) => {
    const old = { ...blankUser(), ...current };
    before = old.souls;
    return applyEdit(old, edit);
  });
  ledger.record(userId, user.souls - before, 'staff', user.souls);
  return user;
}

// Top `count` members by `by` ('xp' or 'souls'): [{ userId, ...user }].
async function leaderboard(count = 10, by = 'xp') {
  const all = await users().all();
  return Object.entries(all)
    .map(([userId, u]) => ({ userId, ...blankUser(), ...u }))
    .filter((u) => u[by] > 0)
    .sort((a, b) => b[by] - a[by])
    .slice(0, count);
}

// Where a member stands: { position, total } (total = members with any of `by`), position null if they have none.
async function standing(userId, by = 'xp') {
  const values = Object.values(await users().all()).map((u) => u[by] ?? 0).filter((v) => v > 0);
  const mine = (await getUser(userId))[by];
  return { position: mine > 0 ? values.filter((v) => v > mine).length + 1 : null, total: values.length };
}

// The server's :souls: emoji, put in front of every soul count (format.js). Found on startup.
function loadSoulsEmoji(guild) {
  setSoulsEmoji(findEmoji(guild, 'souls').toString());
}

// The Shopkeeper's level-up lines (original, in his voice). {member} and {level} are filled in.
const LEVEL_UP_LINES = [
  "Look who's movin' up in the world! {member} just hit **level {level}**.",
  "{member} made **level {level}**. Keep it up, kid, you're gonna need those Souls in my shop.",
  "Well, would ya look at that. {member}'s at **level {level}** now. Drinks are on you.",
  '{member} hit **level {level}**! I had money on ya the whole time. Mostly.',
  "**Level {level}** for {member}. Don't let it go to your head, pal.",
];

// Posts a level-up in the configured channel (if any): a Shopkeeper line + Level / Earned.
async function announceLevelUp(guild, userId, result) {
  const { levelUpChannelId } = await getSettings(guild.id);
  if (!levelUpChannelId || !result?.gained.length) return;
  const channel = await guild.channels.fetch(levelUpChannelId).catch(() => null);
  if (!channel) return;
  const level = result.gained[result.gained.length - 1];
  const text = pickRandom(LEVEL_UP_LINES).replace('{member}', `<@${userId}>`).replace('{level}', level);
  const embed = new EmbedBuilder()
    .setColor(CARD_COLOR)
    .setDescription(text)
    .addFields({ name: 'Level', value: String(level), inline: true }, { name: 'Earned', value: soulsText(result.souls), inline: true });
  await channel
    .send({ embeds: [embed], allowedMentions: { parse: [] } }) // shows the member, doesn't ping them
    .catch((error) => console.error('[xp] Failed to announce level-up:', error.message));
}

module.exports = {
  announceLevelUp,
  loadSoulsEmoji,
  MAX_LEVEL,
  URN_MAX_DAYS,
  BOOST_PRICE,
  BOOST_MS,
  TRIVIA_MAX_STREAK,
  TRIVIA_DAILY,
  triviaOdds,
  triviaAnswer,
  buyBoost,
  buyRejuv,
  REJUV_PRICE,
  REJUV_MAX,
  xpToNext,
  xpForLevel,
  soulsFor,
  progress,
  getUser,
  getSettings,
  updateSettings,
  addXp,
  chatCounts,
  voiceEarners,
  isIgnored,
  standing,
  claimUrn,
  changeSouls,
  buyCard,
  equipCard,
  EDITS,
  applyEdit,
  editUser,
  leaderboard,
};
