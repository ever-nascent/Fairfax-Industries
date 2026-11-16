// TempVoice: temporary voice channels (modelled on tempvoice.bot). Joining a Creator Channel makes a voice channel
// for the member and moves them in; it is deleted when empty. The owner runs it from a button panel or `/voice`.
// Both go through `act`. Staff set it up with `/tempvoice`. Everything is per server (keys are channel ids).
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, OverwriteType, PermissionFlagsBits: P,
  TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { getStore } = require('../../storage');
const { BRAND_COLOR } = require('../../config');
const { findPhrase, getPhrases } = require('./censor');

const PANEL_ID = 'tv'; // custom ids: tv:<action> (panel button), tv:<action>:pick | modal, tv:admit|deny:<room id>:<user id>
const MAX_LIST = 40; // trusted / blocked / invited each (a channel holds 100 permission entries)
const DEFAULT_TEMPLATE = "{user}'s Channel";
const REGIONS = ['us-east', 'us-west', 'us-central', 'us-south', 'brazil', 'rotterdam', 'bucharest', 'hongkong', 'india', 'japan', 'russia', 'singapore', 'south-korea', 'southafrica', 'sydney'];

const configs = () => getStore('tempvoiceConfig'); // creator channel id -> { guildId, categoryId, interfaceId, template, limit, bitrate }
const rooms = () => getStore('tempvoiceRooms'); // room channel id -> { guildId, creatorId, ownerId, trusted, blocked, invited, locked, hidden, waitingId }
const saved = () => getStore('tempvoiceSaved'); // "<guild id>:<user id>" -> { name, limit, bitrate }: what an owner set last time

const making = new Set(); // members whose channel is being made right now (a double join must not make two)

const censored = async (guild, text) => !!findPhrase(text, await getPhrases(guild.id));
const fill = (template, member, n) => template.replaceAll('{user}', member.displayName).replaceAll('{number}', String(n)).slice(0, 100) || DEFAULT_TEMPLATE;
const remember = (member, patch) => saved().update(`${member.guild.id}:${member.id}`, (s) => ({ ...(s ?? {}), ...patch }));

// Everything a room's channel permissions say, rebuilt from the record (later entries win: blocked last, owner never blocked).
function overwrites(guild, rec) {
  const map = new Map();
  const put = (id, type, allow = [], deny = []) => map.set(id, { id, type, allow, deny });
  put(guild.roles.everyone.id, OverwriteType.Role, [], [...(rec.locked ? [P.Connect] : []), ...(rec.hidden ? [P.ViewChannel] : [])]);
  for (const id of [...rec.trusted, ...rec.invited]) put(id, OverwriteType.Member, [P.ViewChannel, P.Connect]);
  for (const id of rec.blocked) put(id, OverwriteType.Member, [], [P.ViewChannel, P.Connect]);
  put(rec.ownerId, OverwriteType.Member, [P.ViewChannel, P.Connect, P.Speak]);
  put(guild.members.me.id, OverwriteType.Member, [P.ViewChannel, P.Connect, P.ManageChannels, P.MoveMembers, P.SendMessages, P.EmbedLinks]);
  return [...map.values()];
}
const sync = (ch, rec) => ch.permissionOverwrites.set(overwrites(ch.guild, rec));

async function roomOf(member) {
  const ch = member.voice?.channel;
  const rec = ch && (await rooms().get(ch.id));
  return rec ? { ch, rec } : null;
}

// ---- making and removing rooms ----

async function createRoom(member, creatorId, cfg) {
  const { guild } = member;
  const all = Object.entries(await rooms().all()).filter(([, r]) => r.guildId === guild.id);
  const mine = all.find(([, r]) => r.ownerId === member.id);
  const existing = mine && guild.channels.cache.get(mine[0]);
  if (existing) return member.voice.setChannel(existing).catch(() => null); // one room each: take them back to it
  if (making.has(member.id)) return;
  making.add(member.id);
  try {
    const mem = (await saved().get(`${guild.id}:${member.id}`)) ?? {};
    const n = all.filter(([, r]) => r.creatorId === creatorId).length + 1;
    let name = mem.name ?? fill(cfg.template, member, n);
    if (await censored(guild, name)) name = fill(DEFAULT_TEMPLATE, member, n);
    const rec = { guildId: guild.id, creatorId, ownerId: member.id, trusted: [], blocked: [], invited: [], locked: false, hidden: false };
    const bitrate = mem.bitrate ?? cfg.bitrate;
    const ch = await guild.channels.create({
      name, type: ChannelType.GuildVoice, parent: cfg.categoryId, userLimit: mem.limit ?? cfg.limit ?? 0,
      ...(bitrate ? { bitrate: Math.min(bitrate, guild.maximumBitrate) } : {}), permissionOverwrites: overwrites(guild, rec),
    });
    await rooms().set(ch.id, rec);
    if (!(await member.voice.setChannel(ch).then(() => true, () => false))) await removeRoom(ch); // they left before the move
  } finally {
    making.delete(member.id);
  }
}

async function removeRoom(ch) {
  const rec = await rooms().get(ch.id);
  await rooms().delete(ch.id);
  if (rec?.waitingId) await ch.guild.channels.cache.get(rec.waitingId)?.delete().catch(() => null);
  await ch.delete('TempVoice: the channel is empty').catch(() => null);
}

// A voice state changed: a join to a Creator Channel makes a room, a join to a waiting room asks the owner, an empty room goes.
async function onVoiceChange(oldState, newState) {
  const { member } = newState;
  const old = oldState.channel;
  const now = newState.channel;
  if (old && old.id !== now?.id && old.members.size === 0 && (await rooms().get(old.id))) await removeRoom(old);
  if (!now || now.id === old?.id || member.user.bot) return;
  const cfg = await configs().get(now.id);
  if (cfg) return createRoom(member, now.id, cfg);
  const entry = Object.entries(await rooms().all()).find(([, r]) => r.waitingId === now.id);
  if (!entry) return;
  const room = member.guild.channels.cache.get(entry[0]);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PANEL_ID}:admit:${entry[0]}:${member.id}`).setLabel('Let In').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PANEL_ID}:deny:${entry[0]}:${member.id}`).setLabel('Turn Away').setStyle(ButtonStyle.Danger),
  );
  await room?.send({ content: `<@${entry[1].ownerId}>`, embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setDescription(`${member} is in the waiting room.`)], components: [row], allowedMentions: { users: [entry[1].ownerId] } }).catch(() => null);
}

// The owner's answer to a waiting-room request.
async function answerWaiting(interaction, roomId, userId, letIn) {
  const rec = await rooms().get(roomId);
  if (!rec) return 'That channel is gone.';
  if (interaction.user.id !== rec.ownerId) return `Only the owner (<@${rec.ownerId}>) can answer.`;
  const room = interaction.guild.channels.cache.get(roomId);
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return 'They left the server.';
  if (member.voice.channelId !== rec.waitingId) return `${member} isn't in the waiting room anymore.`;
  if (!letIn) {
    await member.voice.setChannel(null).catch(() => null);
    return `Turned away ${member}.`;
  }
  rec.invited = [...new Set([...rec.invited, userId])].slice(-MAX_LIST);
  await rooms().set(roomId, rec);
  await sync(room, rec);
  await member.voice.setChannel(room).catch(() => null);
  return `Let in ${member}.`;
}

// ---- what the owner can do ----

const names = (ids) => ids.map((id) => `<@${id}>`).join(', ');
const grow = (list, ids) => [...new Set([...list, ...ids])].slice(-MAX_LIST);

// Every control, panel and `/voice` alike. `input` is the new value (name, limit, bitrate, region) or user ids. Returns the reply text.
async function act(member, action, input) {
  const found = await roomOf(member);
  if (!found) return 'Join your temporary voice channel first.';
  const { ch, rec } = found;
  const guild = member.guild;
  const save = async () => { await rooms().set(ch.id, rec); await sync(ch, rec); };
  if (action === 'claim') {
    if (rec.ownerId === member.id) return 'This channel is already yours.';
    if (ch.members.has(rec.ownerId)) return `<@${rec.ownerId}> is still in the channel.`;
    rec.ownerId = member.id;
    rec.trusted = rec.trusted.filter((id) => id !== member.id);
    rec.blocked = rec.blocked.filter((id) => id !== member.id);
    await save();
    return 'You own this channel now.';
  }
  if (rec.ownerId !== member.id) return `Only the owner (<@${rec.ownerId}>) can do that.`;
  const ids = (Array.isArray(input) ? input : []).filter((id) => id !== member.id && id !== guild.members.me.id);
  const staff = (id) => guild.members.cache.get(id)?.permissions.has(P.ManageChannels);
  const kicked = async (list) => { for (const id of list) await ch.members.get(id)?.voice.setChannel(null).catch(() => null); };

  switch (action) {
    case 'name': {
      const name = String(input ?? '').trim().slice(0, 100);
      if (!name) return 'Type a name.';
      if (await censored(guild, name)) return "That name isn't allowed here.";
      // Discord allows 2 renames per 10 minutes and would make the request wait it out, so give up after a few seconds.
      await Promise.race([ch.setName(name).catch(() => null), new Promise((r) => setTimeout(r, 6000))]);
      await remember(member, { name });
      return ch.name === name ? `Renamed to **${name}**.` : 'Discord only allows **2** renames every **10** minutes. Try again soon.';
    }
    case 'limit': {
      const n = Number(input);
      if (!Number.isInteger(n) || n < 0 || n > 99) return 'Pick a number from **0** to **99** (**0** = no limit).';
      await ch.setUserLimit(n);
      await remember(member, { limit: n });
      return n ? `User limit set to **${n}**.` : 'User limit removed.';
    }
    case 'bitrate': {
      const max = guild.maximumBitrate;
      const n = Number(input);
      if (!Number.isInteger(n) || n < 8000 || n > max) return `Pick a bitrate from **8** to **${Math.floor(max / 1000)}** kbps.`;
      await ch.setBitrate(n);
      await remember(member, { bitrate: n });
      return `Bitrate set to **${n / 1000}** kbps.`;
    }
    case 'lock': rec.locked = !rec.locked; await save(); return rec.locked ? 'Locked. Only trusted and invited members can join.' : 'Unlocked. Anyone can join.';
    case 'hide': rec.hidden = !rec.hidden; await save(); return rec.hidden ? 'Hidden. Only trusted and invited members can see the channel.' : 'The channel is visible again.';
    case 'nsfw': await ch.setNSFW(!ch.nsfw).catch(() => null); return ch.nsfw ? 'Marked **NSFW**.' : 'No longer **NSFW**.';
    case 'region': await ch.setRTCRegion(input === 'auto' ? null : input); return `Region set to **${input === 'auto' ? 'Automatic' : input}**.`;
    case 'thread': {
      const thread = await ch.threads.create({ name: `${member.displayName}'s Thread`.slice(0, 100), autoArchiveDuration: 1440 }).catch(() => null);
      return thread ? `Thread started: ${thread}` : "Discord wouldn't start a thread in this channel.";
    }
    case 'waiting': {
      const old = rec.waitingId && guild.channels.cache.get(rec.waitingId);
      if (old) {
        rec.waitingId = null;
        await save();
        await old.delete().catch(() => null);
        return 'Waiting room removed.';
      }
      const wait = await guild.channels.create({
        name: `Waiting for ${ch.name}`.slice(0, 100), type: ChannelType.GuildVoice, parent: ch.parentId,
        permissionOverwrites: [{ id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.Speak] }, { id: guild.members.me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.MoveMembers] }],
      });
      rec.waitingId = wait.id;
      await save();
      return `Waiting room made: ${wait}. Lock the channel so people have to use it. You get a message here for everyone who joins it.`;
    }
    case 'trust': rec.trusted = grow(rec.trusted, ids); await save(); return ids.length ? `Trusted: ${names(ids)}. They can join while it is locked.` : 'Pick someone else.';
    case 'untrust': rec.trusted = rec.trusted.filter((id) => !ids.includes(id)); rec.invited = rec.invited.filter((id) => !ids.includes(id)); await save(); return `No longer trusted: ${names(ids)}.`;
    case 'invite': {
      rec.invited = grow(rec.invited, ids);
      await save();
      for (const id of ids) await guild.members.cache.get(id)?.send(`${member.displayName} invited you to **${ch.name}** in **${guild.name}**: ${ch.url}`).catch(() => null);
      return ids.length ? `Invited: ${names(ids)}. They got a message with a link.` : 'Pick someone else.';
    }
    case 'block': {
      const list = ids.filter((id) => !staff(id));
      rec.blocked = grow(rec.blocked, list);
      rec.trusted = rec.trusted.filter((id) => !list.includes(id));
      rec.invited = rec.invited.filter((id) => !list.includes(id));
      await save();
      await kicked(list);
      return list.length ? `Blocked: ${names(list)}.` : "Staff can't be blocked.";
    }
    case 'unblock': rec.blocked = rec.blocked.filter((id) => !ids.includes(id)); await save(); return `Unblocked: ${names(ids)}.`;
    case 'kick': {
      const list = ids.filter((id) => ch.members.has(id) && !staff(id));
      await kicked(list);
      return list.length ? `Removed from the channel: ${names(list)}.` : 'Nobody to remove.';
    }
    case 'transfer': {
      const to = ids.find((id) => ch.members.get(id) && !ch.members.get(id).user.bot);
      if (!to) return 'Pick a member who is in the channel.';
      rec.ownerId = to;
      rec.trusted = rec.trusted.filter((id) => id !== to);
      rec.blocked = rec.blocked.filter((id) => id !== to);
      rec.trusted = grow(rec.trusted, [member.id]); // the old owner stays trusted
      await save();
      return `<@${to}> owns this channel now.`;
    }
    case 'delete': await removeRoom(ch); return 'Channel deleted.';
    default: return 'Unknown action.';
  }
}

// ---- the panel ----

const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`${PANEL_ID}:${action}`).setLabel(label).setStyle(style);

function panelView() {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Voice Channel Controls')
    .setDescription([
      'Join a Creator Channel to get your own voice channel. Use these buttons while you are in it. Only the owner can use them, and the channel is deleted when it is empty.',
      '',
      '**Channel**',
      'Name, Limit, Bitrate, Region, NSFW, Thread',
      '**Access**',
      'Lock, Hide, Waiting Room, Trust, Untrust, Invite, Block, Unblock, Kick',
      '**Ownership**',
      'Claim, Transfer, Delete',
    ].join('\n'));
  const row = (...b) => new ActionRowBuilder().addComponents(...b);
  return {
    embeds: [embed],
    components: [
      row(button('name', 'Name'), button('limit', 'Limit'), button('bitrate', 'Bitrate'), button('region', 'Region'), button('nsfw', 'NSFW')),
      row(button('lock', 'Lock / Unlock'), button('hide', 'Hide / Show'), button('waiting', 'Waiting Room'), button('thread', 'Thread')),
      row(button('trust', 'Trust'), button('untrust', 'Untrust'), button('invite', 'Invite'), button('block', 'Block'), button('unblock', 'Unblock')),
      row(button('kick', 'Kick'), button('claim', 'Claim'), button('transfer', 'Transfer'), button('delete', 'Delete', ButtonStyle.Danger)),
    ],
  };
}

// The pop-up for Name, Limit and Bitrate.
function inputModal(action, current) {
  const spec = {
    name: ['Rename Channel', 'New Name', TextInputStyle.Short, current?.name, 100],
    limit: ['User Limit', 'Users (0 = no limit)', TextInputStyle.Short, String(current?.userLimit ?? 0), 2],
    bitrate: ['Bitrate', 'Bitrate in kbps', TextInputStyle.Short, String(Math.round((current?.bitrate ?? 64000) / 1000)), 3],
  }[action];
  return new ModalBuilder().setCustomId(`${PANEL_ID}:${action}:modal`).setTitle(spec[0]).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel(spec[1]).setStyle(spec[2]).setValue(spec[3] ?? '').setMaxLength(spec[4]).setRequired(true)),
  );
}

// ---- staff setup ----

async function addCreator(guild, creator, category, extra = {}) {
  const cfg = { guildId: guild.id, categoryId: category?.id ?? creator.parentId ?? null, interfaceId: null, template: DEFAULT_TEMPLATE, limit: 0, bitrate: 0, ...extra };
  await configs().set(creator.id, cfg);
  return cfg;
}

// /tempvoice setup: a category with a Creator Channel and a controls channel holding the panel.
async function setup(guild, category) {
  const parent = category ?? await guild.channels.create({ name: 'Temporary Voice', type: ChannelType.GuildCategory });
  const creator = await guild.channels.create({ name: 'Create Channel', type: ChannelType.GuildVoice, parent: parent.id });
  const controls = await guild.channels.create({
    name: 'voice-controls', type: ChannelType.GuildText, parent: parent.id,
    permissionOverwrites: [{ id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.SendMessages] }, { id: guild.members.me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] }],
  });
  await addCreator(guild, creator, parent, { interfaceId: controls.id });
  await controls.send(panelView());
  return { creator, controls };
}

// ---- keeping the records true ----

// A channel was deleted by hand: forget it (a room takes its waiting room along).
async function channelDeleted(channel) {
  if (await configs().get(channel.id)) await configs().delete(channel.id);
  const rec = await rooms().get(channel.id);
  if (rec) {
    await rooms().delete(channel.id);
    if (rec.waitingId) await channel.guild.channels.cache.get(rec.waitingId)?.delete().catch(() => null);
  }
  const entry = Object.entries(await rooms().all()).find(([, r]) => r.waitingId === channel.id);
  if (entry) await rooms().update(entry[0], (r) => ({ ...r, waitingId: null }));
}

// At startup: drop records of channels that are gone, delete rooms that emptied while the bot was off.
async function reconcile(guild) {
  await guild.channels.fetch();
  for (const [id, cfg] of Object.entries(await configs().all())) if (cfg.guildId === guild.id && !guild.channels.cache.has(id)) await configs().delete(id);
  for (const [id, rec] of Object.entries(await rooms().all())) {
    if (rec.guildId !== guild.id) continue;
    const ch = guild.channels.cache.get(id);
    if (!ch) await channelDeleted({ id, guild });
    else if (ch.members.size === 0) await removeRoom(ch);
  }
}

module.exports = { PANEL_ID, REGIONS, DEFAULT_TEMPLATE, configs, rooms, roomOf, act, answerWaiting, panelView, inputModal, onVoiceChange, addCreator, setup, channelDeleted, reconcile };
