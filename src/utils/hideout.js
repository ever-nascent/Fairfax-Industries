// Hideout (Shop, level 20+, 6,400 souls): a private voice channel + a matching text channel, one per member,
// kept for good. Only the owner, staff (Administrator) and members the owner adds get in. The owner runs it from
// a control panel the bot pins in the text channel. Rules: server-plan.md ("Hideout").
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, OverwriteType, PermissionFlagsBits: P,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} = require('discord.js');
const { getStore } = require('../storage');
const { getUser, changeSouls } = require('./xp');
const { findOrCreateChannel } = require('./guild');
const { withLock } = require('../storage/mutex');

const HIDEOUT_PRICE = 6400;
const HIDEOUT_LEVEL = 20;
const RENAME_EVERY_MS = 24 * 60 * 60_000; // one rename a day
const CATEGORY = 'Hideouts'; // made on startup; staff can switch it with /hideout-config category
const COLOR = 0xa8702c; // bronze, like the Tier 4 panel
const PANEL_ID = 'hideout'; // custom ids: hideout:<owner id>:<rename|limit> (buttons), add_pick / remove_pick
// (the pickers on the panel), rename_modal / limit_modal (the pop-ups)

// key: owner id -> { name, voiceId, textId, panelId, members: [ids], renamedAt } ({ pending: true } while buying)
const hideouts = () => getStore('hideouts');
const settings = () => getStore('hideoutSettings'); // key: guild id -> { categoryId }

const getHideout = (userId) => hideouts().get(userId);

// What the owner and the members they add may do in both channels.
const GUEST = [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks, P.AddReactions];

// Who may see the channels: nobody but the bot (and staff, who are Administrators); plus the owner and their
// members while `present`.
function overwrites(guild, ownerId, hideout, present = true) {
  // type: saved ids may belong to members who aren't cached (or have left), so say they're members
  const list = [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: guild.members.me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.SendMessages, P.ManageMessages, P.EmbedLinks] },
  ];
  if (present) for (const id of [ownerId, ...hideout.members]) list.push({ id, type: OverwriteType.Member, allow: GUEST });
  return list;
}

// "Zechariah's Hideout" -> "zechariahs-hideout" (text channel names are lowercase, no spaces).
const textName = (name) => name.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'hideout';

// On startup: the Hideouts category (made if missing, unless staff picked another).
async function ensureCategory(guild) {
  const saved = (await settings().get(guild.id)) ?? {};
  await guild.channels.fetch();
  const category = await findOrCreateChannel(guild, { name: CATEGORY, type: ChannelType.GuildCategory }, saved.categoryId);
  await settings().set(guild.id, { ...saved, categoryId: category.id });
}

// /hideout-config category: new Hideouts go there, and the existing ones move there too.
async function setCategory(guild, category) {
  await settings().update(guild.id, (s) => ({ ...s, categoryId: category.id }));
  for (const h of Object.values(await hideouts().all())) {
    for (const id of [h.voiceId, h.textId]) await guild.channels.cache.get(id)?.setParent(category.id, { lockPermissions: false }).catch(() => null);
  }
}

// Buys a Hideout: checks level, souls and that they don't own one, takes the souls, makes both channels and
// pins the control panel. Returns null, or why not: 'level' | 'owned' | 'souls'.
async function buyHideout(member) {
  if ((await getUser(member.id)).level < HIDEOUT_LEVEL) return 'level';
  let fresh = false;
  await hideouts().update(member.id, (current) => {
    if (current) return current;
    fresh = true;
    return { pending: true }; // holds the spot so a double click can't buy twice
  });
  if (!fresh) return 'owned';
  if (!(await changeSouls(member.id, -HIDEOUT_PRICE))) {
    await hideouts().delete(member.id);
    return 'souls';
  }
  try {
    const hideout = await makeChannels(member.guild, member.id, { name: `${member.displayName}'s Hideout`, members: [], renamedAt: 0 });
    await hideouts().set(member.id, hideout);
    console.log(`[hideout] ${member.user.tag} bought a Hideout`);
    return null;
  } catch (error) {
    await hideouts().delete(member.id);
    await changeSouls(member.id, HIDEOUT_PRICE); // refund
    throw error;
  }
}

// Makes whichever of the two channels doesn't exist (both when buying; one if staff deleted it by hand), with the
// saved name, members and access, and a freshly pinned panel in a new text channel. Returns the updated hideout.
async function makeChannels(guild, ownerId, hideout, present = true) {
  const { categoryId } = (await settings().get(guild.id)) ?? {};
  const next = { ...hideout };
  const make = (name, type) =>
    guild.channels.create({ name, type, parent: categoryId, permissionOverwrites: overwrites(guild, ownerId, next, present), reason: 'Hideout' });
  if (!guild.channels.cache.has(next.voiceId)) next.voiceId = (await make(next.name, ChannelType.GuildVoice)).id;
  if (!guild.channels.cache.has(next.textId)) {
    const text = await make(textName(next.name), ChannelType.GuildText);
    next.textId = text.id;
    const panel = await text.send(await panelMessage(guild, ownerId, next));
    await panel.pin().catch(() => null);
    next.panelId = panel.id;
  }
  return next;
}

// A channel was deleted: if it was part of a Hideout, make it again (staff remove one with /hideout-config remove).
// One at a time per owner, so deleting both channels at once doesn't make doubles.
async function channelDeleted(guild, channelId) {
  const entry = Object.entries(await hideouts().all()).find(([, h]) => h.voiceId === channelId || h.textId === channelId);
  if (!entry) return;
  const [ownerId] = entry;
  await withLock(`hideout:${ownerId}`, async () => {
    const h = await getHideout(ownerId);
    if (!h || h.pending) return; // removed meanwhile
    const present = await guild.members.fetch(ownerId).then(() => true, () => false);
    await hideouts().set(ownerId, await makeChannels(guild, ownerId, h, present));
    console.log(`[hideout] Remade a deleted Hideout channel for ${ownerId}`);
  });
}

// On startup: catch up on what happened while the bot was off. Remakes deleted channels, hides Hideouts whose
// owner left, opens the ones whose owner came back.
async function reconcile(guild) {
  for (const [ownerId, h] of Object.entries(await hideouts().all())) {
    if (h.pending) continue;
    await withLock(`hideout:${ownerId}`, async () => {
      const present = await guild.members.fetch(ownerId).then(() => true, () => false);
      const next = await makeChannels(guild, ownerId, h, present);
      if (next.voiceId !== h.voiceId || next.textId !== h.textId) await hideouts().set(ownerId, next);
      await applyAccess(guild, ownerId, next, present);
    }).catch((e) => console.error(`[hideout] Startup check failed for ${ownerId}:`, e.message));
  }
}

// /hideout-config remove: ends a member's Hideout (no refund) and deletes both channels.
async function removeHideout(guild, ownerId) {
  const h = await getHideout(ownerId);
  if (!h || h.pending) return false;
  await hideouts().delete(ownerId); // first, so deleting the channels doesn't remake them
  for (const id of [h.voiceId, h.textId]) await guild.channels.cache.get(id)?.delete('Hideout removed by staff').catch(() => null);
  return true;
}

// ---- control panel ----

async function panelMessage(guild, ownerId, hideout, now = Date.now()) {
  const voice = guild.channels.cache.get(hideout.voiceId);
  const icon = guild.emojis.cache.find((e) => e.name === 'hideout')?.imageURL();
  const nextRename = hideout.renamedAt + RENAME_EVERY_MS;
  const members = hideout.members.length ? `${hideout.members.length}: ${hideout.members.map((id) => `<@${id}>`).join(', ')}` : 'Just you';
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: 'Hideout', iconURL: icon })
    .setThumbnail(icon ?? null)
    .setTitle(voice?.name ?? 'Hideout')
    .setDescription('Your keys, pal. Only you, staff and the people you add can get in here.')
    .addFields(
      { name: 'Owner', value: `<@${ownerId}>`, inline: true },
      { name: 'Voice Limit', value: voice?.userLimit ? String(voice.userLimit) : 'No limit', inline: true },
      { name: 'Rename', value: nextRename <= now ? 'Available now' : `Next <t:${Math.floor(nextRename / 1000)}:R>`, inline: true },
      { name: 'Members', value: members.slice(0, 1024) },
    );
  const id = (action) => `${PANEL_ID}:${ownerId}:${action}`;
  const add = new UserSelectMenuBuilder().setCustomId(id('add_pick')).setPlaceholder('Add Members').setMinValues(1).setMaxValues(10);
  // a dropdown needs at least one option, so with nobody to remove it shows a greyed-out stand-in
  const removable = hideout.members.slice(0, 25);
  const remove = new StringSelectMenuBuilder()
    .setCustomId(id('remove_pick'))
    .setPlaceholder(removable.length ? 'Remove Members' : 'Remove Members (Nobody Added Yet)')
    .setMinValues(1)
    .setMaxValues(Math.max(removable.length, 1))
    .setDisabled(!removable.length)
    .addOptions(
      removable.length
        ? removable.map((m) => ({ label: guild.members.cache.get(m)?.displayName ?? m, value: m }))
        : [{ label: 'Nobody', value: 'none' }],
    );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(add),
      new ActionRowBuilder().addComponents(remove),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(id('rename')).setLabel('Rename').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(id('limit')).setLabel('User Limit').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function refreshPanel(guild, ownerId, hideout) {
  const text = guild.channels.cache.get(hideout.textId);
  await text?.messages.edit(hideout.panelId, await panelMessage(guild, ownerId, hideout)).catch((e) => console.error('[hideout] Panel update failed:', e.message));
}

// Both channels' permissions from the saved hideout (after members change, or the owner leaves / comes back).
async function applyAccess(guild, ownerId, hideout, present = true) {
  for (const id of [hideout.voiceId, hideout.textId]) {
    await guild.channels.cache.get(id)?.permissionOverwrites.set(overwrites(guild, ownerId, hideout, present), 'Hideout access');
  }
}

// Changes the saved hideout, applies it, and redraws the panel. `change(hideout)` edits it in place.
async function updateHideout(guild, ownerId, change) {
  const next = await hideouts().update(ownerId, (h) => {
    if (!h || h.pending) return h;
    const copy = structuredClone(h);
    change(copy);
    return copy;
  });
  await applyAccess(guild, ownerId, next);
  await refreshPanel(guild, ownerId, next);
  return next;
}

// The Rename / User Limit pop-ups (the member pickers sit on the panel itself). Only for the owner (checked by the caller).
function panelModal(action, ownerId, hideout, guild) {
  const id = (what) => `${PANEL_ID}:${ownerId}:${what}`;
  if (action === 'rename') {
    const voice = guild.channels.cache.get(hideout.voiceId);
    return new ModalBuilder().setCustomId(id('rename_modal')).setTitle('Rename Your Hideout').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('New Name (Both Channels)').setStyle(TextInputStyle.Short).setMaxLength(90).setRequired(true).setValue(voice?.name ?? ''),
      ),
    );
  }
  return new ModalBuilder().setCustomId(id('limit_modal')).setTitle('Voice User Limit').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('limit').setLabel('0-99 (0 = No Limit)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true),
    ),
  );
}

// Renames both channels, once a day. Returns an error message or null.
async function rename(guild, ownerId, name, now = Date.now()) {
  const h = await getHideout(ownerId);
  if (now - h.renamedAt < RENAME_EVERY_MS) return `You can rename again <t:${Math.floor((h.renamedAt + RENAME_EVERY_MS) / 1000)}:R>.`;
  await guild.channels.cache.get(h.voiceId)?.setName(name, 'Hideout renamed');
  await guild.channels.cache.get(h.textId)?.setName(textName(name), 'Hideout renamed');
  await updateHideout(guild, ownerId, (x) => Object.assign(x, { name, renamedAt: now }));
  return null;
}

async function setLimit(guild, ownerId, limit) {
  const h = await getHideout(ownerId);
  await guild.channels.cache.get(h.voiceId)?.setUserLimit(limit, 'Hideout user limit');
  await refreshPanel(guild, ownerId, h);
}

// Adds members (not bots, not the owner). Returns the ones added.
async function addMembers(guild, ownerId, users) {
  const ids = users.filter((u) => !u.bot && u.id !== ownerId).map((u) => u.id);
  await updateHideout(guild, ownerId, (h) => (h.members = [...new Set([...h.members, ...ids])]));
  return ids;
}

const removeMembers = (guild, ownerId, ids) => updateHideout(guild, ownerId, (h) => (h.members = h.members.filter((m) => !ids.includes(m))));

// The owner left: nobody but staff sees the channels until they come back. Came back: access as before.
async function ownerLeftOrReturned(member, present) {
  const h = await getHideout(member.id);
  if (!h || h.pending) return;
  await applyAccess(member.guild, member.id, h, present);
  console.log(`[hideout] ${member.user.tag} ${present ? 'came back: Hideout opened again' : 'left: Hideout hidden'}`);
}

module.exports = {
  HIDEOUT_PRICE, HIDEOUT_LEVEL, PANEL_ID, getHideout, ensureCategory, setCategory, buyHideout, panelMessage, panelModal,
  rename, setLimit, addMembers, removeMembers, ownerLeftOrReturned, channelDeleted, removeHideout, makeChannels, reconcile, textName, overwrites,
};
