// LFG (looking-for-group) infrastructure: roles, regional LFG channels, voice lobbies
// and their auto-cleanup. The bot creates anything missing when it starts.
const { ChannelType } = require('discord.js');
const { getStore } = require('../storage');
const { findOrCreateChannel } = require('./guild');

// Current Deadlock ranks (July 30, 2026 Ranked Mode update), lowest -> highest.
const RANKS = [
  'Initiate', 'Seeker', 'Acolyte', 'Sentinel', 'Mystic', 'Ritualist',
  'Emissary', 'Oracle', 'Phantom', 'Ascendant', 'Eternus',
];

const MODES = {
  standard: { label: 'Standard', lfgRole: 'LFG Standard' },
  streetbrawl: { label: 'Street Brawl', lfgRole: 'LFG Street Brawl' },
  ranked: { label: 'Ranked' }, // LFG role depends on the rank
};

// Region -> channel. /lfg posts in whichever region channel it's run in.
const REGIONS = {
  na: { label: 'NA', channel: 'lfg-na' },
  sa: { label: 'SA', channel: 'lfg-sa' },
  eu: { label: 'EU', channel: 'lfg-eu' },
  ru: { label: 'RU', channel: 'lfg-ru' },
  asia: { label: 'Asia', channel: 'lfg-asia' },
  oce: { label: 'OCE', channel: 'lfg-oce' },
  africa: { label: 'Africa', channel: 'lfg-africa' },
};
const LFG_CATEGORY = 'LFG'; // holds the region channels and (by default) the lobby voice channels
const LEGACY_CATEGORY = 'LFG Lobbies'; // old layout, replaced by LFG_CATEGORY
const DEFAULT_TIMEOUT_MINUTES = 5; // delete a lobby after this long with nobody in it (/lfg-config timeout)
let timeoutMinutes = DEFAULT_TIMEOUT_MINUTES;

const lfgRoleName = (rank) => `LFG ${rank}`;
// Every LFG ping role, in the order the #roles LFG Pings dropdown lists them.
const PING_ROLES = [MODES.standard.lfgRole, MODES.streetbrawl.lfgRole, ...RANKS.map(lfgRoleName)];

// Ranked parties in Deadlock: max 1 rank apart; Eternus can only queue with Eternus.
function joinableRanks(rank) {
  if (rank === 'Eternus') return ['Eternus'];
  const i = RANKS.indexOf(rank);
  return RANKS.slice(Math.max(0, i - 1), i + 2).filter((r) => r !== 'Eternus');
}

const lobbies = () => getStore('lfgLobbies');
const settings = () => getStore('lfgSettings');

// ---------- infrastructure ----------

async function ensureRole(guild, name, saved) {
  let role = (saved[name] && guild.roles.cache.get(saved[name])) || guild.roles.cache.find((r) => r.name === name);
  if (!role) {
    role = await guild.roles.create({ name, mentionable: false, reason: 'LFG setup' });
    console.log(`[lfg] Created role @${name}`);
  }
  saved[name] = role.id;
  return role;
}

async function ensureInfrastructure(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const saved = (await settings().get(guild.id)) ?? { roles: {} };

  const names = [
    ...RANKS, // rank roles members hold (given by a reaction-role menu)
    ...PING_ROLES,
  ];
  for (const name of names) await ensureRole(guild, name, saved.roles);

  const cache = guild.channels.cache;
  const lfgCategory = await findOrCreateChannel(guild, { name: LFG_CATEGORY, type: ChannelType.GuildCategory }, saved.lfgCategoryId);
  saved.lfgCategoryId = lfgCategory.id; // saved so renaming the category in Discord doesn't make a new one

  saved.regionChannels ??= {};
  for (const [key, region] of Object.entries(REGIONS)) {
    const options = { name: region.channel, type: ChannelType.GuildText, parent: lfgCategory.id };
    saved.regionChannels[key] = (await findOrCreateChannel(guild, options, saved.regionChannels[key])).id;
  }

  // Lobby category: whatever /lfg-config set, unless it's gone or the old "LFG Lobbies".
  const current = cache.get(saved.categoryId);
  if (!current || current.name === LEGACY_CATEGORY) saved.categoryId = lfgCategory.id;
  delete saved.lfgChannelId; // old single #lfg channel

  saved.timeoutMinutes ??= DEFAULT_TIMEOUT_MINUTES;
  saved.disabledModes ??= [];
  timeoutMinutes = saved.timeoutMinutes;
  await settings().set(guild.id, saved);
  console.log(`[lfg] Ready: ${names.length} roles, ${Object.keys(REGIONS).length} region channels, lobbies in "${cache.get(saved.categoryId)?.name}"`);
  return saved;
}

// Which region a channel belongs to (null if it isn't a region channel).
function regionForChannel(cfg, channelId) {
  const key = Object.keys(cfg.regionChannels ?? {}).find((k) => cfg.regionChannels[k] === channelId);
  return key ? { key, ...REGIONS[key] } : null;
}

const getSettings = (guildId) => settings().get(guildId);
const getTimeoutMinutes = () => timeoutMinutes;

// Change saved settings (used by /lfg-config). `change` edits the settings object in place.
async function updateSettings(guildId, change) {
  const next = await settings().update(guildId, (current) => {
    const copy = { ...(current ?? { roles: {} }) };
    change(copy);
    return copy;
  });
  timeoutMinutes = next.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
  return next;
}

// ---------- lobby lifecycle ----------

const timers = new Map(); // channelId -> timeout

function cancelDeletion(channelId) {
  clearTimeout(timers.get(channelId));
  timers.delete(channelId);
}

function scheduleDeletion(client, channelId) {
  if (timers.has(channelId)) return;
  const minutes = timeoutMinutes;
  timers.set(
    channelId,
    setTimeout(() => closeLobby(client, channelId, { why: `empty for ${minutes} min` }), minutes * 60 * 1000),
  );
}

// Delete the #lfg post for a lobby that no longer exists.
async function deletePost(client, lobby) {
  if (!lobby?.messageId) return;
  const text = await client.channels.fetch(lobby.textChannelId).catch(() => null);
  const msg = await text?.messages?.fetch(lobby.messageId).catch(() => null);
  await msg?.delete().catch((e) => console.error('[lfg] post delete failed:', e.message));
}

// force = staff close: deletes even if people are inside.
async function closeLobby(client, channelId, { why, force = false }) {
  cancelDeletion(channelId);
  const lobby = await lobbies().get(channelId);
  if (!lobby) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel && channel.members.size > 0 && !force) return false; // someone joined at the last second
  await lobbies().delete(channelId); // remove first so the channelDelete event doesn't double-handle
  if (channel) await channel.delete(`LFG lobby ${why}`).catch((e) => console.error('[lfg] delete failed:', e.message));
  await deletePost(client, lobby);
  console.log(`[lfg] Closed lobby ${channelId} (${why})`);
  return true;
}

// Someone deleted a lobby's voice channel by hand.
async function onChannelDeleted(client, channelId) {
  const lobby = await lobbies().get(channelId);
  if (!lobby) return;
  cancelDeletion(channelId);
  await lobbies().delete(channelId);
  await deletePost(client, lobby);
  console.log(`[lfg] Lobby ${channelId} was deleted manually`);
}

const isLobby = async (channelId) => Boolean(await lobbies().get(channelId));

// Voice channels of the lobbies that are open right now.
async function openLobbies(guild) {
  const all = await lobbies().all();
  return Object.keys(all).map((id) => guild.channels.cache.get(id)).filter(Boolean);
}

async function registerLobby(client, channel, data) {
  await lobbies().set(channel.id, { ...data, createdAt: Date.now() });
  scheduleDeletion(client, channel.id); // starts empty; timer cancels as soon as someone joins
}

async function findOpenLobbyFor(guild, userId) {
  const all = await lobbies().all();
  for (const [channelId, lobby] of Object.entries(all)) {
    if (lobby.ownerId === userId && guild.channels.cache.has(channelId)) return channelId;
  }
  return null;
}

// Called whenever someone joins/leaves/moves voice.
async function onVoiceChange(client, channel) {
  if (!channel || !(await lobbies().get(channel.id))) return;
  if (channel.members.size === 0) scheduleDeletion(client, channel.id);
  else cancelDeletion(channel.id);
}

// After a restart: forget deleted lobbies, restart timers for empty ones.
async function reconcile(client) {
  for (const channelId of Object.keys(await lobbies().all())) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) await lobbies().delete(channelId);
    else if (channel.members.size === 0) scheduleDeletion(client, channelId);
  }
}

module.exports = {
  RANKS,
  MODES,
  regionForChannel,
  lfgRoleName,
  PING_ROLES,
  joinableRanks,
  ensureInfrastructure,
  getSettings,
  getTimeoutMinutes,
  updateSettings,
  closeLobby,
  onChannelDeleted,
  isLobby,
  openLobbies,
  registerLobby,
  findOpenLobbyFor,
  onVoiceChange,
  reconcile,
};
