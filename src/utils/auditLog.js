// Audit log: settings, the event list, filters, member history, and posting to the log channel.
// Every decision is in server-plan.md ("Audit log").
const { AuditLogEvent, EmbedBuilder } = require('discord.js');
const { setTimeout: sleep } = require('node:timers/promises');
const { getStore } = require('../storage');

const DEFAULT_CHANNEL_ID = '1554246639760318524';
// green = added/joined, red = deleted/removed/left, yellow = edited, blue = other.
const COLOR = { add: 0x6aa98a, remove: 0xe2574c, edit: 0xe8b640, info: 0x5865f2 };

// Every event /audit-log-config can switch on or off (key → label). All start on.
const EVENTS = {
  'message-delete': 'Message deleted',
  'message-edit': 'Message edited',
  'message-bulk-delete': 'Bulk delete (purge)',
  'message-pin': 'Message pinned / unpinned',
  'reaction-add': 'Reaction added',
  'reaction-remove': 'Reaction removed / cleared',
  'poll-vote': 'Poll vote added / removed',
  'member-join': 'Member joined',
  'member-leave': 'Member left',
  'member-kick': 'Member kicked / pruned',
  'member-ban': 'Member banned',
  'member-unban': 'Member unbanned',
  'member-timeout': 'Timeout given / removed',
  'member-roles': 'Member roles changed',
  'member-nickname': 'Nickname changed',
  'member-profile': 'Username / display name / avatar changed',
  'voice-join': 'Voice: joined a channel',
  'voice-leave': 'Voice: left a channel',
  'voice-switch': 'Voice: switched channel',
  'voice-mod': 'Voice: server mute / deafen, disconnect, move',
  'voice-stream': 'Voice: streaming / camera',
  'channel-create': 'Channel created',
  'channel-update': 'Channel updated (name, topic, slowmode, status, ...)',
  'channel-delete': 'Channel deleted',
  'channel-permissions': 'Channel permissions changed',
  'role-create': 'Role created',
  'role-update': 'Role updated',
  'role-delete': 'Role deleted',
  'server-update': 'Server settings / onboarding changed',
  emoji: 'Emoji added / edited / removed',
  sticker: 'Sticker added / edited / removed',
  soundboard: 'Soundboard sound added / edited / removed',
  'invite-create': 'Invite created / updated',
  'invite-delete': 'Invite deleted',
  'thread-create': 'Thread / forum post created',
  'thread-update': 'Thread / forum post updated (archived, locked, ...)',
  'thread-delete': 'Thread / forum post deleted',
  'scheduled-event': 'Scheduled event created / edited / cancelled',
  stage: 'Stage started / updated / ended',
  webhook: 'Webhook created / edited / deleted',
  integration: 'Bot added, integrations, command permissions',
  automod: 'AutoMod action (blocked message, alert, timeout)',
  'automod-rule': 'AutoMod rule created / edited / deleted',
};

const DEFAULTS = { channelId: DEFAULT_CHANNEL_ID, off: [], ignoredChannels: [], ignoredMembers: [], newAccountDays: 7 };
const store = () => getStore('auditLog');
let settings = null; // read once, then kept in step by updateSettings

async function getSettings() {
  settings ??= { ...structuredClone(DEFAULTS), ...(await store().get('settings')) };
  return settings;
}

async function updateSettings(mutate) {
  settings = await store().update('settings', (saved) => {
    const next = { ...structuredClone(DEFAULTS), ...saved };
    mutate(next);
    return next;
  });
  return settings;
}

// Posts `embed` in the log channel, unless the event is off, it happened in the log channel or an ignored channel
// (or that channel's category, or a thread's parent), or one of `userIds` is an ignored member.
async function log(guild, event, embed, { channel = null, channelId = null, userIds = [], files = [] } = {}) {
  const s = await getSettings();
  if (s.off.includes(event)) return;
  if (userIds.some((id) => id && s.ignoredMembers.includes(id))) return;
  const ch = channel ?? guild.channels.cache.get(channelId) ?? null;
  const chain = [channelId, ch?.id, ch?.parentId, ch?.parent?.parentId].filter(Boolean);
  if (chain.some((id) => id === s.channelId || s.ignoredChannels.includes(id))) return;
  const logChannel = guild.channels.cache.get(s.channelId);
  if (!logChannel) return;
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
async function addHistory(userId, type, text, extra = {}) {
  await historyStore()
    .update(userId, (list) => [...(list ?? []), { at: Date.now(), type, text, ...extra }])
    .catch((e) => console.error('[auditLog] History save failed:', e.message));
}
const getHistory = async (userId) => (await historyStore().get(userId)) ?? [];

// ---- Invite tracking: which invite a new member used ----

const inviteUses = new Map(); // code → uses
let vanityUses = null;

async function snapshotInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  inviteUses.clear();
  for (const invite of invites.values()) inviteUses.set(invite.code, invite.uses ?? 0);
  return invites;
}

const rememberInvite = (invite) => inviteUses.set(invite.code, invite.uses ?? 0);
const forgetInvite = (invite) => inviteUses.delete(invite.code);

// A line saying which invite a member just joined with.
async function usedInvite(guild) {
  const before = new Map(inviteUses);
  const invites = await snapshotInvites(guild);
  if (!invites) return 'Unknown (the bot needs Manage Server to see invites)';
  const used = invites.find((i) => i.uses > (before.get(i.code) ?? 0));
  if (used) {
    const by = used.inviterId ? ` made by <@${used.inviterId}>` : '';
    return `discord.gg/${used.code}${by}, uses: ${used.uses}${used.maxUses ? `/${used.maxUses}` : ''}`;
  }
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    const grew = vanity && vanityUses !== null && vanity.uses > vanityUses;
    if (vanity) vanityUses = vanity.uses;
    if (grew) return `Vanity URL discord.gg/${vanity.code}`;
  }
  const gone = [...before.keys()].filter((code) => !invites.has(code));
  if (gone.length) return `discord.gg/${gone.join(', discord.gg/')} (used up or expired right as they joined)`;
  return 'Unknown (server discovery, a bot, or an invite made while the bot was offline)';
}

// ---- Who deleted a message (Discord only records deletes of someone else's message) ----

const seenDeletes = new Map(); // audit entry id → its count, so an old entry isn't blamed for a new delete
let deletesPrimed = false;

async function findDeleter(guild, authorId, channelId) {
  if (deletesPrimed) await sleep(1500); // the audit entry lands just after the delete
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 }).catch(() => null);
  let found = null;
  for (const entry of logs?.entries.values() ?? []) {
    const before = seenDeletes.get(entry.id);
    seenDeletes.set(entry.id, entry.extra.count);
    const isNew = before === undefined ? deletesPrimed : entry.extra.count > before;
    if (!found && isNew && entry.targetId === authorId && entry.extra.channel.id === channelId) found = entry.executorId;
  }
  deletesPrimed = true;
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
