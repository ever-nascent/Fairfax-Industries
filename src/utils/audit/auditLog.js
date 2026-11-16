// Audit log: settings, the event list, filters, member history, and posting to the log channel.
// Every decision is in server-plan.md ("Audit log").
const { AuditLogEvent, EmbedBuilder } = require('discord.js');
const { setTimeout: sleep } = require('node:timers/promises');
const { getStore } = require('../../storage');

const { isHomeGuild } = require('../guild');

const DEFAULT_CHANNEL_ID = '1554246639760318524'; // Fairfax's own #audit-log; every other server starts with none (/audit-log-config channel)
// green = added/joined, red = deleted/removed/left, yellow = edited, blue = other.
const COLOR = { add: 0x6aa98a, remove: 0xe2574c, edit: 0xe8b640, info: 0x5865f2 };

// Every event /audit-log-config can switch on or off (key → label). All start on.
const EVENTS = {
  'message-delete': 'Message Deleted',
  'message-edit': 'Message Edited',
  'message-bulk-delete': 'Bulk Delete (Purge)',
  'message-pin': 'Message Pinned / Unpinned',
  'reaction-add': 'Reaction Added',
  'reaction-remove': 'Reaction Removed / Cleared',
  'poll-vote': 'Poll Vote Added / Removed',
  'member-join': 'Member Joined',
  'member-leave': 'Member Left',
  'member-kick': 'Member Kicked / Pruned',
  'member-ban': 'Member Banned',
  'member-unban': 'Member Unbanned',
  'member-timeout': 'Timeout Given / Removed',
  'member-roles': 'Member Roles Changed',
  'member-nickname': 'Nickname Changed',
  'member-profile': 'Username / Display Name / Avatar Changed',
  'voice-join': 'Voice: Joined a Channel',
  'voice-leave': 'Voice: Left a Channel',
  'voice-switch': 'Voice: Switched Channel',
  'voice-mod': 'Voice: Server Mute / Deafen, Disconnect, Move',
  'voice-stream': 'Voice: Streaming / Camera',
  'channel-create': 'Channel Created',
  'channel-update': 'Channel Updated (Name, Topic, Slowmode, Status, ...)',
  'channel-delete': 'Channel Deleted',
  'channel-permissions': 'Channel Permissions Changed',
  'role-create': 'Role Created',
  'role-update': 'Role Updated',
  'role-delete': 'Role Deleted',
  'server-update': 'Server Settings / Onboarding Changed',
  emoji: 'Emoji Added / Edited / Removed',
  sticker: 'Sticker Added / Edited / Removed',
  soundboard: 'Soundboard Sound Added / Edited / Removed',
  'invite-create': 'Invite Created / Updated',
  'invite-delete': 'Invite Deleted',
  'thread-create': 'Thread / Forum Post Created',
  'thread-update': 'Thread / Forum Post Updated (Archived, Locked, ...)',
  'thread-delete': 'Thread / Forum Post Deleted',
  'scheduled-event': 'Scheduled Event Created / Edited / Cancelled',
  stage: 'Stage Started / Updated / Ended',
  webhook: 'Webhook Created / Edited / Deleted',
  integration: 'Bot Added, Integrations, Command Permissions',
  'staff-edit': "Staff Changed a Member's XP, Level or Souls (/xp, /souls)",
  automod: 'AutoMod Action (Blocked Message, Alert, Timeout)',
  'automod-rule': 'AutoMod Rule Created / Edited / Deleted',
};

// One set of settings per server. Fairfax's were saved under the plain key 'settings' before the bot went public, so it still reads that one.
const defaults = (guildId) => ({ channelId: isHomeGuild(guildId) ? DEFAULT_CHANNEL_ID : null, off: [], ignoredChannels: [], ignoredMembers: [], newAccountDays: 7 });
const store = () => getStore('auditLog');
const keyOf = (guildId) => (isHomeGuild(guildId) ? 'settings' : `settings:${guildId}`);
const settingsCache = new Map(); // guild id -> settings, read once, then kept in step by updateSettings

async function getSettings(guildId) {
  if (!settingsCache.has(guildId)) settingsCache.set(guildId, { ...defaults(guildId), ...(await store().get(keyOf(guildId))) });
  return settingsCache.get(guildId);
}

async function updateSettings(guildId, mutate) {
  const next = await store().update(keyOf(guildId), (saved) => {
    const merged = { ...defaults(guildId), ...saved };
    mutate(merged);
    return merged;
  });
  settingsCache.set(guildId, next);
  return next;
}

// Posts `embed` in the log channel, unless the event is off, it happened in the log channel or an ignored channel
// (or that channel's category, or a thread's parent), or one of `userIds` is an ignored member.
async function log(guild, event, embed, { channel = null, channelId = null, userIds = [], files = [] } = {}) {
  const s = await getSettings(guild.id);
  if (s.off.includes(event)) return;
  if (userIds.some((id) => id && s.ignoredMembers.includes(id))) return;
  const ch = channel ?? guild.channels.cache.get(channelId) ?? null;
  const chain = [channelId, ch?.id, ch?.parentId, ch?.parent?.parentId].filter(Boolean);
  if (chain.some((id) => id === s.channelId || s.ignoredChannels.includes(id))) return;
  const logChannel = s.channelId && guild.channels.cache.get(s.channelId);
  if (!logChannel) return; // a server that hasn't set a log channel logs nothing
  embed.setTimestamp();
  await logChannel
    .send({ embeds: [embed], files, allowedMentions: { parse: [] } })
    .catch((e) => console.error(`[auditLog] Posting ${event} failed:`, e.message));
}

// ---- Text helpers ----

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
// Discord timestamps show in each viewer's own time zone.
const ts = (ms, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const when = (ms) => `${ts(ms)} (${ts(ms, 'R')})`;

function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const parts = [[Math.floor(s / 86400), 'd'], [Math.floor(s / 3600) % 24, 'h'], [Math.floor(s / 60) % 60, 'm'], [s % 60, 's']];
  return parts.filter(([n]) => n).slice(0, 2).map(([n, u]) => `${n}${u}`).join(' ') || '0s';
}

// "@mention `username` (`id`)": the mention alone shows "unknown user" once they leave or rename.
function who(user) {
  const id = user?.id ?? user;
  return user?.username ? `<@${id}> \`${user.username}\` (\`${id}\`)` : `<@${id}> (\`${id}\`)`;
}
async function whoId(client, id) {
  if (!id) return 'Unknown';
  return who((await client.users.fetch(id).catch(() => null)) ?? id);
}

// A log embed: one labelled field per fact, every value clipped to Discord's limits (25 fields, 6000 characters).
// Fields without a value are left out, so callers can list optional ones inline.
function entryEmbed({ color, title, description, fields = [], footer, thumbnail, image }) {
  const embed = new EmbedBuilder().setColor(color).setTitle(clip(title, 256));
  let room = 5800 - title.length - (footer?.length ?? 0);
  if (description) {
    const text = clip(description, Math.min(4096, room));
    embed.setDescription(text);
    room -= text.length;
  }
  for (const f of fields.filter((f) => f?.value).slice(0, 25)) {
    const space = Math.min(1024, room - f.name.length);
    if (space < 20) break; // out of room
    const value = clip(String(f.value), space);
    embed.addFields({ name: clip(f.name, 256), value, inline: f.inline ?? false });
    room -= f.name.length + value.length;
  }
  if (footer) embed.setFooter({ text: clip(footer, 2048) });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  return embed;
}

// A code block Discord draws in red (desktop): "No reason given" on mod actions.
const NO_REASON = '```ansi\n\u001b[31mNo reason given\u001b[0m\n```';
const reasonText = (reason, required = false) => reason || (required ? NO_REASON : null);

// ---- Member history (kept forever; /audit-log-config history) ----

const historyStore = () => getStore('auditHistory');
// Fairfax's records are keyed by the plain user id (from before the bot went public); every other server's by "<server id>:<user id>".
const historyKey = (guildId, userId) => (isHomeGuild(guildId) ? userId : `${guildId}:${userId}`);
async function addHistory(guildId, userId, type, text, extra = {}) {
  await historyStore()
    .update(historyKey(guildId, userId), (list) => [...(list ?? []), { at: Date.now(), type, text, ...extra }])
    .catch((e) => console.error('[auditLog] History save failed:', e.message));
}
const getHistory = async (guildId, userId) => (await historyStore().get(historyKey(guildId, userId))) ?? [];

// ---- Invite tracking: which invite a new member used ----

const inviteUses = new Map(); // guild id → (code → uses)
const vanityUses = new Map(); // guild id → uses
const usesIn = (guildId) => inviteUses.get(guildId) ?? inviteUses.set(guildId, new Map()).get(guildId);

async function snapshotInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const uses = usesIn(guild.id);
  uses.clear();
  for (const invite of invites.values()) uses.set(invite.code, invite.uses ?? 0);
  return invites;
}

const rememberInvite = (invite) => invite.guild && usesIn(invite.guild.id).set(invite.code, invite.uses ?? 0);
const forgetInvite = (invite) => invite.guild && usesIn(invite.guild.id).delete(invite.code);

// A line saying which invite a member just joined with.
async function usedInvite(guild) {
  const before = new Map(usesIn(guild.id));
  const invites = await snapshotInvites(guild);
  if (!invites) return 'Unknown (the bot needs Manage Server to see invites)';
  const used = invites.find((i) => i.uses > (before.get(i.code) ?? 0));
  if (used) {
    const by = used.inviterId ? ` made by <@${used.inviterId}>` : '';
    return `discord.gg/${used.code}${by}, uses: ${used.uses}${used.maxUses ? `/${used.maxUses}` : ''}`;
  }
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    const grew = vanity && vanityUses.has(guild.id) && vanity.uses > vanityUses.get(guild.id);
    if (vanity) vanityUses.set(guild.id, vanity.uses);
    if (grew) return `Vanity URL discord.gg/${vanity.code}`;
  }
  const gone = [...before.keys()].filter((code) => !invites.has(code));
  if (gone.length) return `discord.gg/${gone.join(', discord.gg/')} (used up or expired right as they joined)`;
  return 'Unknown (server discovery, a bot, or an invite made while the bot was offline)';
}

// ---- Who deleted a message (Discord only records deletes of someone else's message) ----

const seenDeletes = new Map(); // audit entry id → its count, so an old entry isn't blamed for a new delete
const deletesPrimed = new Set(); // guild ids whose existing delete entries have been remembered

async function findDeleter(guild, authorId, channelId) {
  if (deletesPrimed.has(guild.id)) await sleep(1500); // the audit entry lands just after the delete
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 }).catch(() => null);
  let found = null;
  for (const entry of logs?.entries.values() ?? []) {
    const before = seenDeletes.get(entry.id);
    seenDeletes.set(entry.id, entry.extra.count);
    const isNew = before === undefined ? deletesPrimed.has(guild.id) : entry.extra.count > before;
    if (!found && isNew && entry.targetId === authorId && entry.extra.channel.id === channelId) found = entry.executorId;
  }
  deletesPrimed.add(guild.id);
  return found;
}

async function findBulkDeleter(guild, channelId) {
  await sleep(1500);
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageBulkDelete, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();
  return entry && entry.targetId === channelId && Date.now() - entry.createdTimestamp < 60_000 ? entry.executorId : null;
}

module.exports = {
  COLOR,
  EVENTS,
  getSettings,
  updateSettings,
  log,
  clip,
  ts,
  when,
  duration,
  who,
  whoId,
  entryEmbed,
  reasonText,
  addHistory,
  getHistory,
  snapshotInvites,
  rememberInvite,
  forgetInvite,
  usedInvite,
  findDeleter,
  findBulkDeleter,
};
