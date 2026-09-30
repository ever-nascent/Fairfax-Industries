// Audit log: everything Discord reports through gateway events (Discord's own audit log entries go through
// utils/auditEntries.js). The bot's own messages, reactions and actions are never logged.
const { AttachmentBuilder, AutoModerationActionType, AutoModerationRuleTriggerType } = require('discord.js');
const { isAllowedGuild, ourGuild } = require('../utils/guild');
const audit = require('../utils/auditLog');
const memory = require('../utils/auditMessages');
const { handleEntry } = require('../utils/auditEntries');

const { COLOR, log, clip, when, duration, who, whoId, entryEmbed } = audit;
const inOurGuild = (thing) => thing?.guildId && isAllowedGuild(thing.guildId);
const jump = (guildId, channelId, messageId) => `[Go to message](https://discord.com/channels/${guildId}/${channelId}/${messageId})`;
const channelLine = (id) => `<#${id}> (\`${id}\`)`;
const fail = (what) => (e) => console.error(`[auditLog] ${what} failed:`, e.message);

// "Ghost ping" value for mentions that vanished with a delete or edit.
function ghostPing(mentions) {
  if (!mentions) return null;
  const pinged = [...mentions.users.map((id) => `<@${id}>`), ...mentions.roles.map((id) => `<@&${id}>`), mentions.everyone ? '@everyone/@here' : null];
  return pinged.filter(Boolean).join(', ') || null;
}

// Mentions in `before` that are gone from `after`.
function droppedMentions(before, after) {
  if (!before) return null;
  const users = before.users.filter((id) => !after?.users.includes(id));
  const roles = before.roles.filter((id) => !after?.roles.includes(id));
  const everyone = before.everyone && !after?.everyone;
  return users.length || roles.length || everyone ? { users, roles, everyone } : null;
}

function size(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// "• `clip.png` - image/png · 120.4 KB · 800×600 [spoiler] · id `123` (copy below)"
function fileLine(f) {
  const facts = [f.type, size(f.size), f.width && f.height ? `${f.width}×${f.height}` : null, f.seconds ? `${f.seconds.toFixed(1)}s audio` : null];
  const flags = [f.spoiler ? 'spoiler' : null, f.alt ? `alt: "${f.alt}"` : null].filter(Boolean);
  return [
    `• \`${f.name ?? '(unnamed)'}\``,
    facts.some(Boolean) ? ` - ${facts.filter(Boolean).join(' · ')}` : '',
    flags.length ? ` [${flags.join(', ')}]` : '',
    f.id ? ` · id \`${f.id}\`` : '',
    f.copy ? ' (copy below)' : '',
  ].join('');
}

const attachmentList = (files, stickers) =>
  [...(files ?? []).map(fileLine), ...(stickers ?? []).map((s) => `• Sticker \`${s}\``)].join('\n') || null;

// ---- Messages ----

async function messageDelete(message, client) {
  if (!inOurGuild(message)) return;
  const saved = memory.take(message.id);
  const authorId = message.author?.id ?? saved?.author;
  if (saved?.own || authorId === client.user.id) return;
  const { guild } = message;
  const known = !message.partial || Boolean(saved);
  const content = message.partial ? saved?.content : message.content;
  const files = saved?.files ?? (message.partial ? [] : message.attachments.map(memory.fileInfo));
  const stickers = saved?.stickers ?? (message.partial ? [] : message.stickers.map((s) => s.name));
  const deleter = authorId ? await audit.findDeleter(guild, authorId, message.channelId) : null;
  const author = message.author ?? (authorId ? await client.users.fetch(authorId).catch(() => null) : null);
  const copies = files.filter((f) => f.copy);
  const ghost = ghostPing(saved?.mentions ?? (message.partial ? null : memory.mentionsOf(message)));
  const sentAt = saved?.at ?? message.createdTimestamp;

  // Three cases: the text, a message known to have no text, or one sent before the log started.
  let description = content || (known ? '*No text content*' : '*Content could not be recovered (sent before the audit log started, or over 7 days ago)*');
  const list = attachmentList(files, stickers);
  if (list) description += `\n\n**Attachments (${files.length + stickers.length}):**\n${list}`;

  const embed = entryEmbed({
    color: COLOR.remove,
    title: ghost ? 'Message Deleted (Ghost Ping)' : 'Message Deleted',
    description,
    fields: [
      { name: 'Author', value: author ? who(author) : 'Unknown', inline: true },
      { name: 'Channel', value: channelLine(message.channelId), inline: true },
      {
        name: 'Deleted by',
        value: deleter && deleter !== authorId ? await whoId(client, deleter) : "The author, or unknown (Discord doesn't record who deletes their own message)",
        inline: true,
      },
      { name: 'Ghost Ping', value: ghost },
      {
        name: 'Details',
        value: [
          `**Message ID:** \`${message.id}\``,
          `**Channel ID:** \`${message.channelId}\``,
          sentAt ? `**Posted:** ${when(sentAt)}` : null,
        ].filter(Boolean).join('\n'),
      },
    ],
    footer: `User ID: ${authorId ?? 'unknown'}`,
    thumbnail: author?.displayAvatarURL?.(),
    image: copies[0] ? `attachment://${copies[0].copy}` : null,
  });
  const attachments = copies.map((f) => new AttachmentBuilder(memory.copyPath(f), { name: f.copy }));
  await log(guild, 'message-delete', embed, { channelId: message.channelId, userIds: [authorId, deleter], files: attachments });
  memory.deleteCopies(saved);
}

async function messageUpdate(oldMessage, message, client) {
  if (!inOurGuild(message) || message.author?.id === client.user.id) return;
  if (message.partial) message = await message.fetch().catch(() => message);
  if (!message.author) return;
  const saved = memory.get(message.id);
  const before = oldMessage.partial ? saved?.content : oldMessage.content;
  const after = message.content;
  if (before === after) return; // link previews loading, pins, embeds: not an edit
  // Without the old text, only count it as an edit if Discord marked it edited just now.
  if (before === undefined && !(message.editedTimestamp > Date.now() - 10_000)) return;
  const beforeMentions = saved?.mentions ?? (oldMessage.partial ? null : memory.mentionsOf(oldMessage));
  memory.update(message);
  const ghost = ghostPing(droppedMentions(beforeMentions, memory.mentionsOf(message)));

  const beforeText = before === undefined ? '*Could not be recovered (sent before the audit log started, or over 7 days ago)*' : before || '*No text content*';
  const tooLong = beforeText.length > 1024 || after.length > 1024;
  const embed = entryEmbed({
    color: COLOR.edit,
    title: ghost ? 'Message Edited (Ghost Ping)' : 'Message Edited',
    fields: [
      { name: 'Author', value: who(message.author), inline: true },
      { name: 'Channel', value: channelLine(message.channelId), inline: true },
      { name: 'Jump', value: `[Go to message](${message.url})`, inline: true },
      { name: 'Before', value: beforeText },
      { name: 'After', value: after || '*No text content*' },
      { name: 'Ghost Ping (mentions removed by the edit)', value: ghost },
      { name: 'Full Text', value: tooLong ? 'Too long for the embed: see the attached file.' : null },
      { name: 'Posted', value: when(message.createdTimestamp), inline: true },
      { name: 'Edited', value: message.editedTimestamp ? when(message.editedTimestamp) : null, inline: true },
    ],
    footer: `Message ID: ${message.id} | User ID: ${message.author.id}`,
  });
  const files = tooLong
    ? [new AttachmentBuilder(Buffer.from(`BEFORE\n${before ?? '(unknown)'}\n\nAFTER\n${after}\n`), { name: `edit-${message.id}.txt` })]
    : [];
  await log(message.guild, 'message-edit', embed, { channel: message.channel, userIds: [message.author.id], files });
}

async function messageDeleteBulk(messages, channel, client) {
  if (!inOurGuild(channel)) return;
  const { guild } = channel;
  const deleter = await audit.findBulkDeleter(guild, channel.id);
  const lines = [];
  const saves = [];
  const authors = new Set();
  let recovered = 0;
  for (const message of [...messages.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
    const saved = memory.take(message.id);
    saves.push(saved);
    const authorId = message.author?.id ?? saved?.author;
    if (authorId) authors.add(authorId);
    const name = message.author?.username ?? saved?.username ?? (saved?.own || authorId === client.user.id ? client.user.username : 'unknown');
    const at = saved?.at ?? message.createdTimestamp;
    const text = message.partial ? saved?.content : message.content;
    if (text !== undefined) recovered++;
    const files = (saved?.files ?? (message.partial ? [] : message.attachments.map(memory.fileInfo))).map((f) => f.name).join(', ');
    lines.push(
      `[${at ? new Date(at).toISOString().replace('T', ' ').slice(0, 19) : '?'} UTC] ${name} (${authorId ?? '?'}): ${text ?? '(text unknown)'}${files ? ` [files: ${files}]` : ''}`,
    );
  }
  const embed = entryEmbed({
    color: COLOR.remove,
    title: 'Bulk Delete',
    fields: [
      { name: 'Channel', value: channelLine(channel.id), inline: true },
      { name: 'Messages', value: `${messages.size} (text recovered for ${recovered})`, inline: true },
      { name: 'Deleted by', value: deleter ? await whoId(client, deleter) : 'Unknown', inline: true },
      { name: `Authors (${authors.size})`, value: [...authors].map((id) => `<@${id}>`).join(' ') },
      { name: 'Full List', value: 'Every deleted message the bot had saved is in the attached file.' },
    ],
    footer: `Channel ID: ${channel.id}`,
  });
  const file = new AttachmentBuilder(Buffer.from(`${lines.join('\n')}\n`), { name: `bulk-delete-${channel.name}-${Date.now()}.txt` });
  await log(guild, 'message-bulk-delete', embed, { channel, userIds: [deleter], files: [file] });
  for (const saved of saves) memory.deleteCopies(saved);
}

// ---- Reactions and polls ----

async function reaction(event, reactionObj, user, client) {
  if (user.id === client.user.id) return;
  const message = reactionObj.message;
  if (!inOurGuild(message)) return;
  const added = event === 'reaction-add';
  const authorId = message.author?.id ?? memory.get(message.id)?.author;
  const { emoji } = reactionObj;
  if (user.partial) user = await user.fetch().catch(() => user);
  const embed = entryEmbed({
    color: added ? COLOR.add : COLOR.remove,
    title: added ? 'Reaction Added' : 'Reaction Removed',
    fields: [
      { name: 'Member', value: who(user), inline: true },
      { name: 'Emoji', value: `${emoji} \`${emoji.name ?? '?'}\`${emoji.id ? ` (\`${emoji.id}\`)` : ''}`, inline: true },
      { name: 'Channel', value: channelLine(message.channelId), inline: true },
      { name: 'Message', value: jump(message.guildId, message.channelId, message.id), inline: true },
      { name: 'Message Author', value: authorId ? `<@${authorId}> (\`${authorId}\`)` : null, inline: true },
    ],
    footer: `User ID: ${user.id} | Message ID: ${message.id}`,
  });
  await log(message.guild, event, embed, { channelId: message.channelId, userIds: [user.id] });
}

async function reactionsCleared(message, emoji) {
  if (!inOurGuild(message)) return;
  const embed = entryEmbed({
    color: COLOR.remove,
    title: emoji ? 'Reaction Cleared' : 'All Reactions Cleared',
    fields: [
      { name: 'Emoji', value: emoji ? `${emoji} \`${emoji.name ?? '?'}\`` : 'All of them', inline: true },
      { name: 'Channel', value: channelLine(message.channelId), inline: true },
      { name: 'Message', value: jump(message.guildId, message.channelId, message.id), inline: true },
    ],
    footer: `Message ID: ${message.id}`,
  });
  await log(message.guild, 'reaction-remove', embed, { channelId: message.channelId });
}

async function pollVote(added, answer, userId, client) {
  const message = answer.poll?.message;
  if (!inOurGuild(message) || userId === client.user.id) return;
  const embed = entryEmbed({
    color: added ? COLOR.add : COLOR.remove,
    title: added ? 'Poll Vote Added' : 'Poll Vote Removed',
    fields: [
      { name: 'Member', value: await whoId(client, userId), inline: true },
      { name: added ? 'Voted For' : 'Took Back Vote For', value: answer.text ?? '?', inline: true },
      { name: 'Channel', value: channelLine(message.channelId), inline: true },
      { name: 'Poll', value: answer.poll.question?.text },
      { name: 'Message', value: jump(message.guildId, message.channelId, message.id), inline: true },
    ],
    footer: `User ID: ${userId} | Message ID: ${message.id}`,
  });
  await log(message.guild, 'poll-vote', embed, { channelId: message.channelId, userIds: [userId] });
}

// ---- Members ----

async function memberJoin(member) {
  if (!isAllowedGuild(member.guild.id) || member.id === member.client.user.id) return;
  const { guild, user } = member;
  const s = await audit.getSettings();
  const age = Date.now() - user.createdTimestamp;
  const isNew = age < s.newAccountDays * 86_400_000;
  const history = await audit.getHistory(member.id);
  const lastLeave = history.findLast((h) => h.type === 'leave');
  const invite = await audit.usedInvite(guild);
  const joins = history.filter((h) => h.type === 'join').length;

  const embed = entryEmbed({
    color: isNew ? COLOR.edit : COLOR.add,
    title: isNew ? 'Member Joined (New Account)' : 'Member Joined',
    description: `${who(user)}${user.bot ? ' (bot)' : ''}`,
    fields: [
      { name: 'Account Created', value: when(user.createdTimestamp), inline: true },
      { name: 'Member Number', value: `#${guild.memberCount}`, inline: true },
      { name: 'Invite Used', value: invite, inline: true },
      { name: 'New Account', value: isNew ? `Created ${duration(age)} ago (under ${s.newAccountDays} days)` : null },
      { name: 'Rejoined', value: lastLeave ? `Last left ${when(lastLeave.at)}${joins ? `; joined ${joins} time(s) before` : ''}` : null },
      { name: 'Roles Before Leaving', value: lastLeave ? lastLeave.roles?.join(', ') || 'None' : null },
    ],
    footer: `User ID: ${user.id}`,
    thumbnail: user.displayAvatarURL(),
  });
  await log(guild, 'member-join', embed, { userIds: [user.id] });
  await audit.addHistory(user.id, 'join', `Joined (account ${duration(age)} old, invite: ${invite})`);
}

async function memberLeave(member) {
  if (!isAllowedGuild(member.guild.id) || member.id === member.client.user.id) return;
  const { guild, user } = member;
  const roles = member.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
  const embed = entryEmbed({
    color: COLOR.remove,
    title: 'Member Left',
    description: `${who(user)}${user.bot ? ' (bot)' : ''}`,
    fields: [
      { name: 'Account Created', value: when(user.createdTimestamp), inline: true },
      { name: 'Joined', value: member.joinedTimestamp ? when(member.joinedTimestamp) : 'Unknown', inline: true },
      { name: 'Time Here', value: member.joinedTimestamp ? duration(Date.now() - member.joinedTimestamp) : null, inline: true },
      { name: `Roles (${roles.size})`, value: roles.map((r) => `${r}`).join(', ') || 'None' },
      { name: 'Members Now', value: `${guild.memberCount}`, inline: true },
    ],
    footer: `User ID: ${user.id}`,
    thumbnail: user.displayAvatarURL(),
  });
  await log(guild, 'member-leave', embed, { userIds: [user.id] });
  await audit.addHistory(user.id, 'leave', `Left after ${member.joinedTimestamp ? duration(Date.now() - member.joinedTimestamp) : '?'}`, { roles: roles.map((r) => r.name) });
}

// Username, display name and avatar are account-wide, so Discord sends them as a user update.
async function userUpdate(oldUser, user, client) {
  const guild = ourGuild(client);
  if (!guild?.members.cache.has(user.id) || user.id === client.user.id || oldUser.partial) return;
  const fields = [];
  if (oldUser.username !== user.username) fields.push({ name: 'Username', value: `\`${oldUser.username}\` → \`${user.username}\`` });
  if (oldUser.globalName !== user.globalName) fields.push({ name: 'Display Name', value: `${oldUser.globalName ?? '*none*'} → ${user.globalName ?? '*none*'}` });
  const avatarChanged = oldUser.avatar !== user.avatar;
  if (!fields.length && !avatarChanged) return;
  if (avatarChanged) fields.push({ name: 'Avatar', value: `[Old](${oldUser.displayAvatarURL({ size: 512 })}) → [New](${user.displayAvatarURL({ size: 512 })})` });
  const embed = entryEmbed({
    color: COLOR.edit,
    title: avatarChanged && fields.length === 1 ? 'Avatar Changed' : 'Profile Updated',
    description: who(user),
    fields,
    footer: `User ID: ${user.id}`,
    thumbnail: avatarChanged ? user.displayAvatarURL({ size: 256 }) : null,
  });
  await log(guild, 'member-profile', embed, { userIds: [user.id] });
  for (const f of fields.filter((f) => f.name !== 'Avatar')) await audit.addHistory(user.id, 'name', `${f.name}: ${f.value.replace(/`/g, '')}`);
}

// Per-server avatar (the rest of a member edit comes from Discord's audit log, with who did it).
async function memberUpdate(oldMember, member) {
  if (!isAllowedGuild(member.guild.id) || oldMember.partial || oldMember.avatar === member.avatar) return;
  if (member.id === member.client.user.id) return;
  const old = oldMember.avatar ? `[Old](${oldMember.displayAvatarURL({ size: 512 })})` : 'None';
  const now = member.avatar ? `[New](${member.displayAvatarURL({ size: 512 })})` : 'None (uses their main avatar)';
  const embed = entryEmbed({
    color: COLOR.edit,
    title: 'Server Avatar Changed',
    description: who(member.user),
    fields: [{ name: 'Server Avatar', value: `${old} → ${now}` }],
    footer: `User ID: ${member.id}`,
    thumbnail: member.displayAvatarURL({ size: 256 }),
  });
  await log(member.guild, 'member-profile', embed, { userIds: [member.id] });
}

// ---- Voice ----

const joinedVoiceAt = new Map(); // member id → when they joined their current channel

async function voiceUpdate(oldState, state, client) {
  if (!isAllowedGuild(state.guild.id) || state.id === client.user.id) return;
  const user = state.member?.user ?? (await client.users.fetch(state.id).catch(() => null));
  const member = { name: 'Member', value: who(user ?? state.id), inline: true };
  const stayed = { name: 'Time There', value: joinedVoiceAt.has(state.id) ? duration(Date.now() - joinedVoiceAt.get(state.id)) : null, inline: true };
  const post = (event, color, title, fields, channelId) =>
    log(state.guild, event, entryEmbed({ color, title, fields: [member, ...fields], footer: `User ID: ${state.id}` }), { userIds: [state.id], channelId });

  if (oldState.channelId !== state.channelId) {
    if (!oldState.channelId) {
      joinedVoiceAt.set(state.id, Date.now());
      return post('voice-join', COLOR.add, 'Voice Channel Joined', [{ name: 'Channel', value: channelLine(state.channelId), inline: true }], state.channelId);
    }
    if (!state.channelId) {
      joinedVoiceAt.delete(state.id);
      return post('voice-leave', COLOR.remove, 'Voice Channel Left', [{ name: 'Channel', value: channelLine(oldState.channelId), inline: true }, stayed], oldState.channelId);
    }
    joinedVoiceAt.set(state.id, Date.now());
    return post(
      'voice-switch',
      COLOR.edit,
      'Voice Channel Switched',
      [{ name: 'From', value: channelLine(oldState.channelId), inline: true }, { name: 'To', value: channelLine(state.channelId), inline: true }, stayed],
      state.channelId,
    );
  }

  if (!state.channelId) return;
  const where = { name: 'Channel', value: channelLine(state.channelId), inline: true };
  if (oldState.streaming !== state.streaming) {
    await post('voice-stream', state.streaming ? COLOR.add : COLOR.remove, state.streaming ? 'Screen Share Started' : 'Screen Share Stopped', [where], state.channelId);
  }
  if (oldState.selfVideo !== state.selfVideo) {
    await post('voice-stream', state.selfVideo ? COLOR.add : COLOR.remove, state.selfVideo ? 'Camera On' : 'Camera Off', [where], state.channelId);
  }
}

// ---- AutoMod ----

const AUTOMOD_ACTIONS = {
  [AutoModerationActionType.BlockMessage]: 'Blocked the message',
  [AutoModerationActionType.SendAlertMessage]: 'Sent an alert',
  [AutoModerationActionType.Timeout]: 'Timed out the member',
  [AutoModerationActionType.BlockMemberInteraction]: 'Blocked the member from interacting',
};

async function autoModAction(execution, client) {
  const { guild, action } = execution;
  if (!isAllowedGuild(guild.id)) return;
  const rule = execution.autoModerationRule ?? (await guild.autoModerationRules.fetch(execution.ruleId).catch(() => null));
  const embed = entryEmbed({
    color: COLOR.remove,
    title: 'AutoMod Action',
    fields: [
      { name: 'Member', value: await whoId(client, execution.userId), inline: true },
      { name: 'Action', value: AUTOMOD_ACTIONS[action.type] ?? 'Took an action', inline: true },
      { name: 'Channel', value: execution.channelId ? channelLine(execution.channelId) : null, inline: true },
      { name: 'Rule', value: `\`${rule?.name ?? '?'}\` (\`${execution.ruleId}\`)`, inline: true },
      { name: 'Trigger', value: AutoModerationRuleTriggerType[execution.ruleTriggerType] ?? 'Unknown', inline: true },
      { name: 'Timeout', value: action.metadata?.durationSeconds ? duration(action.metadata.durationSeconds * 1000) : null, inline: true },
      { name: 'Message', value: execution.content },
      { name: 'Matched Keyword', value: execution.matchedKeyword, inline: true },
      { name: 'Matched Text', value: execution.matchedContent, inline: true },
    ],
    footer: `User ID: ${execution.userId} | Rule ID: ${execution.ruleId}`,
  });
  await log(guild, 'automod', embed, { channelId: execution.channelId, userIds: [execution.userId] });
}

// ---- Startup ----

async function ready(client) {
  const guild = ourGuild(client);
  if (!guild) return;
  await audit.snapshotInvites(guild);
  await audit.findDeleter(guild); // remembers existing delete entries so they aren't blamed for new deletes
  await guild.autoModerationRules.fetch().catch(() => null);
  const s = await audit.getSettings();
  if (!guild.channels.cache.has(s.channelId)) console.warn(`[auditLog] Log channel ${s.channelId} not found: set one with /audit-log-config channel.`);
  else console.log(`[auditLog] Logging to #${guild.channels.cache.get(s.channelId).name}`);
}

module.exports = [
  { name: 'clientReady', once: true, execute: (client) => ready(client).catch(fail('Startup')) },
  {
    name: 'messageCreate',
    execute: (message) => (inOurGuild(message) ? memory.remember(message).catch(fail('Saving a message')) : null),
  },
  { name: 'messageDelete', execute: (m, client) => messageDelete(m, client).catch(fail('Message delete')) },
  { name: 'messageUpdate', execute: (o, m, client) => messageUpdate(o, m, client).catch(fail('Message edit')) },
  { name: 'messageDeleteBulk', execute: (ms, ch, client) => messageDeleteBulk(ms, ch, client).catch(fail('Bulk delete')) },
  // discord.js passes (reaction, user, details); the loader adds the client last.
  { name: 'messageReactionAdd', execute: (r, u, ...rest) => reaction('reaction-add', r, u, rest.at(-1)).catch(fail('Reaction add')) },
  { name: 'messageReactionRemove', execute: (r, u, ...rest) => reaction('reaction-remove', r, u, rest.at(-1)).catch(fail('Reaction remove')) },
  { name: 'messageReactionRemoveAll', execute: (m) => reactionsCleared(m, null).catch(fail('Reactions cleared')) },
  { name: 'messageReactionRemoveEmoji', execute: (r) => reactionsCleared(r.message, r.emoji).catch(fail('Reaction cleared')) },
  { name: 'messagePollVoteAdd', execute: (a, id, client) => pollVote(true, a, id, client).catch(fail('Poll vote')) },
  { name: 'messagePollVoteRemove', execute: (a, id, client) => pollVote(false, a, id, client).catch(fail('Poll vote')) },
  { name: 'guildMemberAdd', execute: (m) => memberJoin(m).catch(fail('Member join')) },
  { name: 'guildMemberRemove', execute: (m) => memberLeave(m).catch(fail('Member leave')) },
  { name: 'guildMemberUpdate', execute: (o, m) => memberUpdate(o, m).catch(fail('Member update')) },
  { name: 'userUpdate', execute: (o, u, client) => userUpdate(o, u, client).catch(fail('Profile update')) },
  { name: 'voiceStateUpdate', execute: (o, s, client) => voiceUpdate(o, s, client).catch(fail('Voice update')) },
  { name: 'autoModerationActionExecution', execute: (e, client) => autoModAction(e, client).catch(fail('AutoMod action')) },
  { name: 'inviteCreate', execute: (invite) => audit.rememberInvite(invite) },
  { name: 'inviteDelete', execute: (invite) => audit.forgetInvite(invite) },
  {
    name: 'guildAuditLogEntryCreate',
    execute: (entry, guild) => (isAllowedGuild(guild.id) ? handleEntry(entry, guild).catch(fail('Audit log entry')) : null),
  },
];
