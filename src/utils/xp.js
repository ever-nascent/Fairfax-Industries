// XP, levels and souls. Members earn XP by chatting (and optionally by sitting in voice);
// every level-up pays souls, the server currency. Rules are in server-plan.md ("XP / levels").
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { CARD_COLOR } = require('./rankCard');

const MAX_LEVEL = 99;
const DEFAULTS = {
  minXp: 15, // XP per counted message is random between minXp and maxXp
  maxXp: 25,
  cooldownSeconds: 60, // at most one counted message per this many seconds
  voiceEnabled: false,
  voiceXpPerMinute: 10,
  levelUpChannelId: null, // null = level-ups aren't announced
};
const URN_BASE = 100; // day 1 of a streak
const URN_PER_DAY = 20; // extra per day in a row
const URN_MAX_DAYS = 7; // streak bonus stops growing here

// ponytail: every write rewrites data/xp.json. Fine for one community server; move to SQLite if it gets slow.
const users = () => getStore('xp'); // key: user id (the bot only serves one server)
const settings = () => getStore('xpSettings'); // key: guild id

// XP needed to go from `level` to `level + 1` (the MEE6 curve).
const xpToNext = (level) => 5 * level * level + 50 * level + 100;
// Souls paid for reaching `level`.
const soulsFor = (level) => Math.round(25 * level ** 1.5);

// Total XP -> { level, into (XP into this level), need (XP this level takes) }.
function progress(totalXp) {
  let level = 0;
  let rest = totalXp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) rest -= xpToNext(level++);
  return { level, into: rest, need: level < MAX_LEVEL ? xpToNext(level) : 0 };
}

const blankUser = () => ({ xp: 0, level: 0, souls: 0, lastXpAt: 0, urnDay: null, urnStreak: 0 });

async function getUser(userId) {
  return { ...blankUser(), ...(await users().get(userId)) };
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

// Adds XP (respecting the chat cooldown when `fromChat`), pays souls for every level gained.
// Returns { user, gained: [levels reached], souls: souls paid } or null if nothing changed.
async function addXp(userId, amount, { fromChat = false, cooldownSeconds = 0 } = {}) {
  let result = null;
  await users().update(userId, (current) => {
    const user = { ...blankUser(), ...current };
    const now = Date.now();
    if (user.level >= MAX_LEVEL) return current;
    if (fromChat && now - user.lastXpAt < cooldownSeconds * 1000) return current;
    if (fromChat) user.lastXpAt = now;

    user.xp += amount;
    const { level } = progress(user.xp);
    const gained = [];
    for (let l = user.level + 1; l <= level; l++) gained.push(l);
    const souls = gained.reduce((sum, l) => sum + soulsFor(l), 0);
    user.level = level;
    user.souls += souls;
    result = { user, gained, souls };
    return user;
  });
  return result;
}

// Daily Soul Urn. Days are UTC calendar days; claiming on consecutive days grows the streak.
async function claimUrn(userId, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  let result;
  await users().update(userId, (current) => {
    const user = { ...blankUser(), ...current };
    if (user.urnDay === today) {
      result = { claimed: false, user };
      return current;
    }
    user.urnStreak = user.urnDay === yesterday ? user.urnStreak + 1 : 1;
    user.urnDay = today;
    const souls = URN_BASE + URN_PER_DAY * (Math.min(user.urnStreak, URN_MAX_DAYS) - 1);
    user.souls += souls;
    result = { claimed: true, souls, user };
    return user;
  });
  return result;
}

// Top `count` members by XP: [{ userId, ...user }].
async function leaderboard(count = 10) {
  const all = await users().all();
  return Object.entries(all)
    .map(([userId, u]) => ({ userId, ...blankUser(), ...u }))
    .filter((u) => u.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, count);
}

// The server's :souls: emoji, put in front of every soul count. Uploaded on startup if missing.
const SOULS_EMOJI_FILE = path.join(__dirname, '..', '..', 'assets', 'card', 'souls.png'); // deadlock.wiki
let soulsEmoji = '';
const soulsIcon = () => (soulsEmoji ? `${soulsEmoji} ` : ''); // with a trailing space

async function ensureSoulsEmoji(guild) {
  const emojis = await guild.emojis.fetch();
  let emoji = emojis.find((e) => e.name === 'souls');
  if (!emoji) {
    emoji = await guild.emojis.create({ attachment: SOULS_EMOJI_FILE, name: 'souls', reason: 'Souls icon for XP messages' });
    console.log('[xp] Uploaded the :souls: emoji');
  }
  soulsEmoji = emoji.toString();
}

// Posts a level-up in the configured channel (if any). Placeholder wording.
async function announceLevelUp(guild, userId, result) {
  const { levelUpChannelId } = await getSettings(guild.id);
  if (!levelUpChannelId || !result?.gained.length) return;
  const channel = await guild.channels.fetch(levelUpChannelId).catch(() => null);
  if (!channel) return;
  const level = result.gained[result.gained.length - 1];
  const text = `<@${userId}> reached **level ${level}** and earned ${soulsIcon()}**${result.souls.toLocaleString('en-US')} souls**.`;
  await channel
    .send({ embeds: [new EmbedBuilder().setColor(CARD_COLOR).setDescription(text)] })
    .catch((error) => console.error('[xp] Failed to announce level-up:', error.message));
}

module.exports = {
  announceLevelUp,
  ensureSoulsEmoji,
  soulsIcon,
  MAX_LEVEL,
  DEFAULTS,
  URN_BASE,
  URN_PER_DAY,
  URN_MAX_DAYS,
  xpToNext,
  soulsFor,
  progress,
  getUser,
  getSettings,
  updateSettings,
  addXp,
  claimUrn,
  leaderboard,
};
