// Discord's own audit log entries (who changed what, and why) → posts in the audit log channel.
// Message deletes and AutoMod actions are logged from their gateway events instead (auditLog events file).
const { AuditLogEvent: A, ChannelType, PermissionsBitField, OverwriteType } = require('discord.js');
const { COLOR, log, clip, when, duration, whoId, entryEmbed, reasonText, addHistory } = require('./auditLog');
const memory = require('./auditMessages');

// Entry type → [event key in /audit-log-config, title].
const TYPES = {
  [A.GuildUpdate]: ['server-update', 'Server Settings Updated'],
  [A.ChannelCreate]: ['channel-create', 'Channel Created'],
  [A.ChannelUpdate]: ['channel-update', 'Channel Updated'],
  [A.ChannelDelete]: ['channel-delete', 'Channel Deleted'],
  [A.ChannelOverwriteCreate]: ['channel-permissions', 'Channel Permissions Added'],
  [A.ChannelOverwriteUpdate]: ['channel-permissions', 'Channel Permissions Updated'],
  [A.ChannelOverwriteDelete]: ['channel-permissions', 'Channel Permissions Removed'],
  [A.MemberKick]: ['member-kick', 'Member Kicked'],
  [A.MemberPrune]: ['member-kick', 'Members Pruned'],
  [A.MemberBanAdd]: ['member-ban', 'Member Banned'],
  [A.MemberBanRemove]: ['member-unban', 'Member Unbanned'],
  [A.MemberRoleUpdate]: ['member-roles', 'Member Roles Updated'],
  [A.MemberMove]: ['voice-mod', 'Members Moved'],
  [A.MemberDisconnect]: ['voice-mod', 'Members Disconnected From Voice'],
  [A.BotAdd]: ['integration', 'Bot Added'],
  [A.RoleCreate]: ['role-create', 'Role Created'],
  [A.RoleUpdate]: ['role-update', 'Role Updated'],
  [A.RoleDelete]: ['role-delete', 'Role Deleted'],
  [A.InviteCreate]: ['invite-create', 'Invite Created'],
  [A.InviteUpdate]: ['invite-create', 'Invite Updated'],
  [A.InviteDelete]: ['invite-delete', 'Invite Deleted'],
  [A.WebhookCreate]: ['webhook', 'Webhook Created'],
  [A.WebhookUpdate]: ['webhook', 'Webhook Updated'],
  [A.WebhookDelete]: ['webhook', 'Webhook Deleted'],
  [A.EmojiCreate]: ['emoji', 'Emoji Added'],
  [A.EmojiUpdate]: ['emoji', 'Emoji Updated'],
  [A.EmojiDelete]: ['emoji', 'Emoji Removed'],
  [A.MessagePin]: ['message-pin', 'Message Pinned'],
  [A.MessageUnpin]: ['message-pin', 'Message Unpinned'],
  [A.IntegrationCreate]: ['integration', 'Integration Added'],
  [A.IntegrationUpdate]: ['integration', 'Integration Updated'],
  [A.IntegrationDelete]: ['integration', 'Integration Removed'],
  [A.StageInstanceCreate]: ['stage', 'Stage Started'],
  [A.StageInstanceUpdate]: ['stage', 'Stage Updated'],
  [A.StageInstanceDelete]: ['stage', 'Stage Ended'],
  [A.StickerCreate]: ['sticker', 'Sticker Added'],
  [A.StickerUpdate]: ['sticker', 'Sticker Updated'],
  [A.StickerDelete]: ['sticker', 'Sticker Removed'],
  [A.GuildScheduledEventCreate]: ['scheduled-event', 'Event Created'],
  [A.GuildScheduledEventUpdate]: ['scheduled-event', 'Event Updated'],
  [A.GuildScheduledEventDelete]: ['scheduled-event', 'Event Cancelled'],
  [A.ThreadCreate]: ['thread-create', 'Thread Created'],
  [A.ThreadUpdate]: ['thread-update', 'Thread Updated'],
  [A.ThreadDelete]: ['thread-delete', 'Thread Deleted'],
  [A.ApplicationCommandPermissionUpdate]: ['integration', 'Command Permissions Updated'],
  [A.SoundboardSoundCreate]: ['soundboard', 'Soundboard Sound Added'],
  [A.SoundboardSoundUpdate]: ['soundboard', 'Soundboard Sound Updated'],
  [A.SoundboardSoundDelete]: ['soundboard', 'Soundboard Sound Removed'],
  [A.AutoModerationRuleCreate]: ['automod-rule', 'AutoMod Rule Created'],
  [A.AutoModerationRuleUpdate]: ['automod-rule', 'AutoMod Rule Updated'],
  [A.AutoModerationRuleDelete]: ['automod-rule', 'AutoMod Rule Deleted'],
  [A.OnboardingPromptCreate]: ['server-update', 'Onboarding Question Added'],
  [A.OnboardingPromptUpdate]: ['server-update', 'Onboarding Question Updated'],
  [A.OnboardingPromptDelete]: ['server-update', 'Onboarding Question Removed'],
  [A.OnboardingCreate]: ['server-update', 'Onboarding Set Up'],
  [A.OnboardingUpdate]: ['server-update', 'Onboarding Updated'],
  [A.HomeSettingsCreate]: ['server-update', 'Server Guide Set Up'],
  [A.HomeSettingsUpdate]: ['server-update', 'Server Guide Updated'],
  [A.VoiceChannelStatusCreate]: ['channel-update', 'Voice Channel Status Set'],
  [A.VoiceChannelStatusDelete]: ['channel-update', 'Voice Channel Status Cleared'],
  [A.CreatorMonetizationRequestCreated]: ['server-update', 'Monetization Requested'],
  [A.CreatorMonetizationTermsAccepted]: ['server-update', 'Monetization Terms Accepted'],
};

// Mod actions that show "No reason given" in red when there's no reason.
const NEEDS_REASON = new Set([A.MemberKick, A.MemberBanAdd, A.MemberPrune]);

const LABELS = {
  name: 'Name', topic: 'Topic', nsfw: 'Age-restricted', rate_limit_per_user: 'Slowmode', bitrate: 'Bitrate',
  user_limit: 'User limit', position: 'Position', parent_id: 'Category', type: 'Type', color: 'Colour',
  hoist: 'Shown separately', mentionable: 'Mentionable', permissions: 'Permissions', allow: 'Allowed', deny: 'Denied',
  icon_hash: 'Icon', unicode_emoji: 'Role icon emoji', nick: 'Nickname', deaf: 'Server deafened', mute: 'Server muted',
  communication_disabled_until: 'Timed out until', code: 'Code', channel_id: 'Channel', inviter_id: 'Created by',
  max_uses: 'Max uses', max_age: 'Expires after', temporary: 'Temporary membership', uses: 'Uses', archived: 'Archived',
  locked: 'Locked', auto_archive_duration: 'Hide after inactivity', default_auto_archive_duration: 'Default hide after inactivity',
  afk_channel_id: 'AFK channel', afk_timeout: 'AFK timeout', system_channel_id: 'System messages channel',
  rules_channel_id: 'Rules channel', public_updates_channel_id: 'Community updates channel',
  safety_alerts_channel_id: 'Safety alerts channel', verification_level: 'Verification level',
  explicit_content_filter: 'Explicit media filter', default_message_notifications: 'Default notifications',
  mfa_level: '2FA for moderation', owner_id: 'Owner', vanity_url_code: 'Vanity URL', splash_hash: 'Invite background',
  banner_hash: 'Banner', discovery_splash_hash: 'Discovery background', description: 'Description',
  preferred_locale: 'Language', premium_progress_bar_enabled: 'Boost progress bar', widget_enabled: 'Widget',
  widget_channel_id: 'Widget channel', system_channel_flags: 'System message settings', avatar_hash: 'Avatar',
  status: 'Status', location: 'Location', scheduled_start_time: 'Starts', scheduled_end_time: 'Ends',
  video_quality_mode: 'Video quality', rtc_region: 'Voice region', available_tags: 'Forum tags', applied_tags: 'Tags',
  trigger_metadata: 'Trigger settings', actions: 'Actions', exempt_roles: 'Exempt roles', exempt_channels: 'Exempt channels',
  enabled: 'Enabled', volume: 'Volume', emoji_name: 'Emoji', invitable: 'Members can invite', tags: 'Related emoji',
  permission_overwrites: 'Permission overwrites', $add: 'Roles added', $remove: 'Roles removed',
};
const label = (key) => LABELS[key] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// "SendMessages" → "Send Messages"
const spaced = (flag) => flag.replace(/([a-z])([A-Z])/g, '$1 $2');
const perms = (bits) => new PermissionsBitField(BigInt(bits ?? 0)).bitfield;
const names = (bits) => new PermissionsBitField(bits).toArray().map(spaced);

// Permission names gained and lost between two permission bitfields.
const permDiff = (oldBits, newBits) => ({
  granted: names(perms(newBits) & ~perms(oldBits)),
  revoked: names(perms(oldBits) & ~perms(newBits)),
});

function show(key, value, entry) {
  if (value === undefined || value === null || value === '') return '*none*';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('channel_id') || key === 'parent_id') return `<#${value}>`;
  if (key === 'owner_id' || key === 'inviter_id') return `<@${value}> (\`${value}\`)`;
  if (key === 'color') return `\`#${Number(value).toString(16).padStart(6, '0')}\``;
  if (key === 'rate_limit_per_user' || key === 'afk_timeout') return value ? duration(value * 1000) : 'Off';
  if (key === 'bitrate') return `${value / 1000} kbps`;
  if (key === 'user_limit' || key === 'max_uses') return value ? String(value) : 'Unlimited';
  if (key === 'max_age') return value ? duration(value * 1000) : 'Never';
  if (key.endsWith('archive_duration')) return duration(value * 60_000);
  if (key === 'communication_disabled_until' || key.startsWith('scheduled_')) return when(Date.parse(value));
  if (key === 'type' && ['Channel', 'Thread'].includes(entry.targetType)) return ChannelType[value] ?? value;
  if (key.endsWith('_hash')) return 'Changed';
  if (key === 'exempt_roles') return value.map((id) => `<@&${id}>`).join(', ') || '*none*';
  if (key === 'exempt_channels') return value.map((id) => `<#${id}>`).join(', ') || '*none*';
  if (typeof value === 'object') return `\`${clip(JSON.stringify(value), 300)}\``;
  return `\`${clip(String(value), 300)}\``;
}

const overwriteTarget = (o) => (String(o.type) === String(OverwriteType.Member) ? `<@${o.id}>` : `<@&${o.id}>`);
function overwriteLine(o) {
  const allow = names(perms(o.allow)).join(', ');
  const deny = names(perms(o.deny)).join(', ');
  return `${overwriteTarget(o)}: ${[allow && `allow ${allow}`, deny && `deny ${deny}`].filter(Boolean).join('; ') || 'nothing set'}`;
}

// Channel permission overwrite edits: what is now allowed, now denied, and back to default.
function overwriteFields(entry) {
  const allow = entry.changes.find((c) => c.key === 'allow');
  const deny = entry.changes.find((c) => c.key === 'deny');
  if (!allow && !deny) return [];
  const [oa, na, od, nd] = [allow?.old, allow?.new, deny?.old, deny?.new].map(perms);
  return [
    { name: 'Now Allowed', value: names(na & ~oa).join(', ') },
    { name: 'Now Denied', value: names(nd & ~od).join(', ') },
    { name: 'Reset to Default', value: names((oa | od) & ~(na | nd)).join(', ') },
  ];
}

// One field per changed setting, "before → after" (just the value, for something created or deleted).
function changeFields(entry) {
  const fields = [];
  for (const change of entry.changes) {
    const { key } = change;
    const hasOld = 'old' in change;
    const hasNew = 'new' in change;
    if (key === 'allow' || key === 'deny') continue; // overwriteFields
    if (key === '$add' || key === '$remove') {
      fields.push({ name: key === '$add' ? 'Added' : 'Removed', value: change.new.map((r) => `<@&${r.id}>`).join(', '), inline: true });
    } else if (key === 'permissions' && hasOld && hasNew) {
      const { granted, revoked } = permDiff(change.old, change.new);
      fields.push({ name: 'Permissions Granted', value: granted.join(', ') }, { name: 'Permissions Revoked', value: revoked.join(', ') });
    } else if (key === 'permissions') {
      fields.push({ name: 'Permissions', value: names(perms(hasNew ? change.new : change.old)).join(', ') || 'None' });
    } else if (key === 'permission_overwrites') {
      fields.push({ name: 'Permission Overwrites', value: (change.new ?? change.old ?? []).map(overwriteLine).join('\n') || 'None' });
    } else {
      const value = hasOld && hasNew ? `${show(key, change.old, entry)} → ${show(key, change.new, entry)}` : show(key, hasNew ? change.new : change.old, entry);
      fields.push({ name: label(key), value, inline: value.length <= 40 });
    }
  }
  return [...fields, ...overwriteFields(entry)];
}

// The field an entry's target goes in (the footer's ID label is the same, "User" for members).
const TARGET_FIELD = {
  User: 'Member', Channel: 'Channel', Thread: 'Thread', Role: 'Role', Guild: 'Server', Invite: 'Invite', Webhook: 'Webhook',
  Emoji: 'Emoji', Integration: 'Integration', StageInstance: 'Stage', Sticker: 'Sticker', GuildScheduledEvent: 'Event',
  ApplicationCommand: 'Command', AutoModeration: 'Rule', SoundboardSound: 'Sound', GuildOnboardingPrompt: 'Question',
};
const idLabel = (entry) => (entry.targetType === 'User' ? 'User' : (TARGET_FIELD[entry.targetType] ?? 'Target'));

// The name of a thing, even once it's deleted (it's in the entry's changes).
const nameOf = (entry) => entry.target?.name ?? entry.changes.find((c) => c.key === 'name')?.[entry.actionType === 'Delete' ? 'old' : 'new'];

// "mention `name` (`id`)", or "`name` (`id`)" for something already deleted.
async function targetText(entry, guild) {
  const id = entry.targetId;
  const name = nameOf(entry);
  const tail = `${name ? `\`${name}\` ` : ''}(\`${id}\`)`;
  switch (entry.targetType) {
    case 'User':
      return whoId(guild.client, id);
    case 'Channel':
    case 'Thread':
      return guild.channels.cache.has(id) ? `<#${id}> ${tail}` : tail;
    case 'Role':
      return guild.roles.cache.has(id) ? `<@&${id}> ${tail}` : tail;
    case 'Guild':
      return `\`${guild.name}\``;
    case 'Invite':
      return `discord.gg/${entry.target?.code ?? entry.changes.find((c) => c.key === 'code')?.[entry.actionType === 'Delete' ? 'old' : 'new'] ?? '?'}`;
    case 'Emoji':
      return guild.emojis.cache.has(id) ? `${guild.emojis.cache.get(id)} ${tail}` : tail;
    default:
      return id ? tail : name ? `\`${name}\`` : null;
  }
}

// The channel an entry happened in, for the ignored-channels filter.
function channelIdOf(entry) {
  if (['Channel', 'Thread'].includes(entry.targetType)) return entry.targetId;
  return entry.extra?.channel?.id ?? null;
}

// Fields some entry types carry on top of their changes (who an overwrite is for, how many were moved, ...).
async function extraFields(entry, guild) {
  const x = entry.extra;
  switch (entry.action) {
    case A.ChannelOverwriteCreate:
    case A.ChannelOverwriteUpdate:
    case A.ChannelOverwriteDelete: {
      if (!x) return [];
      const member = x.user || String(x.type) === String(OverwriteType.Member);
      return [{ name: 'For', value: member ? await whoId(guild.client, x.id) : `<@&${x.id}>${x.name ? ` \`${x.name}\`` : ''} (\`${x.id}\`)`, inline: true }];
    }
    case A.MemberKick:
    case A.MemberBanAdd:
    case A.MemberBanRemove:
    case A.BotAdd: {
      const user = await guild.client.users.fetch(entry.targetId).catch(() => null);
      return user?.createdTimestamp ? [{ name: 'Account Created', value: when(user.createdTimestamp), inline: true }] : [];
    }
    case A.MemberPrune:
      return [
        { name: 'Removed', value: `${x.removed} member(s)`, inline: true },
        { name: 'Inactive For', value: `${x.days} days`, inline: true },
      ];
    case A.MemberMove:
      return [
        { name: 'Moved', value: `${x.count} member(s)`, inline: true },
        { name: 'To', value: `<#${x.channel.id}>`, inline: true },
      ];
    case A.MemberDisconnect:
      return [{ name: 'Disconnected', value: `${x.count} member(s)`, inline: true }];
    case A.StageInstanceCreate:
    case A.StageInstanceUpdate:
    case A.StageInstanceDelete:
      return [{ name: 'Stage Channel', value: `<#${x.channel.id}>`, inline: true }];
    case A.MessagePin:
    case A.MessageUnpin: {
      const text = memory.get(x.messageId)?.content ?? x.channel.messages?.cache.get(x.messageId)?.content;
      return [
        { name: 'Channel', value: `<#${x.channel.id}>`, inline: true },
        { name: 'Jump', value: `[Go to message](https://discord.com/channels/${guild.id}/${x.channel.id}/${x.messageId})`, inline: true },
        { name: 'Message', value: text || '*Text unknown or empty*' },
      ];
    }
    default:
      return [];
  }
}

function colorOf(entry) {
  if (entry.action === A.MemberBanRemove) return COLOR.add;
  return { Create: COLOR.add, Delete: COLOR.remove, Update: COLOR.edit }[entry.actionType] ?? COLOR.info;
}

// Target, extra facts, the changes, then By and Reason; the footer carries the target's ID.
async function post(entry, guild, event, title, { by, fields = changeFields(entry), color = colorOf(entry), required = false, reason } = {}) {
  const pinned = entry.action === A.MessagePin || entry.action === A.MessageUnpin;
  const embed = entryEmbed({
    color,
    title,
    fields: [
      { name: pinned ? 'Author' : (TARGET_FIELD[entry.targetType] ?? 'Target'), value: await targetText(entry, guild), inline: true },
      ...(await extraFields(entry, guild)),
      ...fields,
      { name: 'By', value: by ?? (entry.executorId ? await whoId(guild.client, entry.executorId) : null), inline: true },
      { name: 'Reason', value: reason === undefined ? reasonText(entry.reason, required) : reason },
    ],
    footer: pinned ? `Message ID: ${entry.extra.messageId}` : entry.targetId ? `${idLabel(entry)} ID: ${entry.targetId}` : null,
    thumbnail: entry.targetType === 'Guild' && entry.changes.some((c) => c.key === 'icon_hash') ? guild.iconURL() : null,
  });
  await log(guild, event, embed, { channelId: channelIdOf(entry), userIds: [entry.executorId, entry.targetType === 'User' ? entry.targetId : null] });
}

// Roles the bot hands out from the #roles menus are logged as picked by the member; the bot's other role changes aren't.
async function roleUpdate(entry, guild, own) {
  const selfPicked = own && entry.reason?.startsWith('Self-picked');
  if (own && !selfPicked) return;
  const color = entry.changes.every((c) => c.key === '$remove') ? COLOR.remove : COLOR.add;
  if (!selfPicked) return post(entry, guild, 'member-roles', 'Member Roles Updated', { color });
  await post(entry, guild, 'member-roles', 'Member Roles Updated (Self-Picked)', {
    color,
    by: 'Themselves',
    reason: null,
    fields: [...changeFields(entry), { name: 'How', value: entry.reason.replace(/^Self-picked from/, 'Picked from') }],
  });
}

// A member edit can hold a nickname, a timeout, and a server mute/deafen at once: each is logged under its own event.
async function memberUpdate(entry, guild) {
  const by = await whoId(guild.client, entry.executorId);
  const byText = entry.executorId === entry.targetId ? 'themselves' : by;

  for (const change of entry.changes) {
    if (change.key === 'nick') {
      await post(entry, guild, 'member-nickname', 'Nickname Changed', {
        by,
        fields: [
          { name: 'Before', value: change.old ?? '*none*', inline: true },
          { name: 'After', value: change.new ?? '*none*', inline: true },
        ],
      });
      await addHistory(entry.targetId, 'nickname', `Nickname: ${change.old ?? '(none)'} → ${change.new ?? '(none)'}, by ${byText}`);
    } else if (change.key === 'communication_disabled_until') {
      const until = change.new ? Date.parse(change.new) : null;
      const fields = until
        ? [
            { name: 'Until', value: when(until), inline: true },
            { name: 'Length', value: duration(until - Date.now()), inline: true },
          ]
        : [];
      await post(entry, guild, 'member-timeout', until ? 'Member Timed Out' : 'Timeout Removed', {
        by, fields, color: until ? COLOR.remove : COLOR.add, required: Boolean(until),
      });
      const text = until ? `Timed out for ${duration(until - Date.now())} by ${by}` : `Timeout removed by ${by}`;
      await addHistory(entry.targetId, 'timeout', `${text}${entry.reason ? ` (reason: ${entry.reason})` : ''}`);
    } else if (change.key === 'mute' || change.key === 'deaf') {
      const what = change.key === 'mute' ? 'Muted' : 'Deafened';
      await post(entry, guild, 'voice-mod', change.new ? `Server ${what}` : `Server Un${what.toLowerCase()}`, {
        by, fields: [], color: change.new ? COLOR.remove : COLOR.add,
      });
      await addHistory(entry.targetId, 'voice', `Server ${change.new ? '' : 'un'}${what.toLowerCase()} by ${by}`);
    } else {
      await post(entry, guild, 'member-profile', 'Member Updated', { by, fields: changeFields({ ...entry, changes: [change] }) });
    }
  }
}

async function handleEntry(entry, guild) {
  const own = entry.executorId === guild.client.user.id;
  if (entry.action === A.MemberRoleUpdate) return roleUpdate(entry, guild, own);
  if (own) return; // the bot's own work (LFG lobbies, emoji uploads, ...) isn't logged
  if (entry.action === A.MemberUpdate) return memberUpdate(entry, guild);
  const type = TYPES[entry.action];
  if (!type) return;
  const [event, title] = type;
  await post(entry, guild, event, title, { required: NEEDS_REASON.has(entry.action) });

  const history = { [A.MemberKick]: 'Kicked', [A.MemberBanAdd]: 'Banned', [A.MemberBanRemove]: 'Unbanned' }[entry.action];
  if (history) {
    const by = await whoId(guild.client, entry.executorId);
    await addHistory(entry.targetId, history.toLowerCase(), `${history} by ${by}${entry.reason ? ` (reason: ${entry.reason})` : ' (no reason given)'}`);
  }
}

module.exports = { handleEntry, TYPES, changeFields, permDiff };
