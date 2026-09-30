const { EmbedBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { BRAND_COLOR } = require('../config');
const { isAllowedGuild } = require('./guild');

// Discord allows 20 unique reactions per message.
const MAX_OPTIONS = 20;

// Reason on role changes from a menu; the audit log shows these as picked by the member (see auditLog.js).
const SELF_PICKED = 'Self-picked from a #roles menu';

// Posted menus. key: message id
const store = () => getStore('reactionRoleMenus');

// Unposted drafts, one per (server, member). Saved to data/ so a restart doesn't lose them.
const drafts = () => getStore('reactionRoleDrafts');
const draftKey = (guildId, userId) => `${guildId}_${userId}`;

function parseEmoji(raw) {
  const text = raw.trim();
  const match = text.match(/^<a?:\w{2,32}:(\d{17,19})>$/);
  return match ? { key: match[1], display: text } : { key: text, display: text };
}

// Key used to look up a reaction's role: custom emoji id, or the unicode char
// itself. Must line up with what parseEmoji stores when the menu is built.
function emojiKey(emoji) {
  return emoji.id ?? emoji.name;
}

async function startDraft(guildId, userId, { title, description, channelId, mode, color }) {
  return drafts().set(draftKey(guildId, userId), { title, description, channelId, mode, color, pairs: [] });
}

const getDraft = (guildId, userId) => drafts().get(draftKey(guildId, userId));
const saveDraft = (guildId, userId, draft) => drafts().set(draftKey(guildId, userId), draft);
const clearDraft = (guildId, userId) => drafts().delete(draftKey(guildId, userId));

// Why the bot can't hand out this role, or null if it can.
function roleProblem(role, guild) {
  if (role.id === guild.id) return "@everyone can't be a reaction role.";
  if (role.managed) return `${role} belongs to a bot or integration, so it can't be given out.`;
  if (role.comparePositionTo(guild.members.me.roles.highest) >= 0) {
    return `I can't give ${role}: it's at or above my highest role. Drag my role above it in Server Settings → Roles, then try again.`;
  }
  return null;
}

// True if the draft is full and `raw` isn't already in it (re-adding an emoji replaces its role).
function draftIsFull(draft, raw) {
  const { key } = parseEmoji(raw);
  return draft.pairs.length >= MAX_OPTIONS && !draft.pairs.some((pair) => pair.key === key);
}

function addPair(draft, raw, role) {
  const { key, display } = parseEmoji(raw);
  draft.pairs = draft.pairs.filter((pair) => pair.key !== key);
  draft.pairs.push({ key, display, roleId: role.id });
}

function removePair(draft, role) {
  const before = draft.pairs.length;
  draft.pairs = draft.pairs.filter((pair) => pair.roleId !== role.id);
  return draft.pairs.length < before;
}

function buildEmbed(draft) {
  const lines = draft.pairs.map((pair) => `> ${pair.display} \`-\` <@&${pair.roleId}>`).join('\n');
  return new EmbedBuilder()
    .setTitle(draft.title || null)
    .setDescription([draft.description, lines].filter(Boolean).join('\n\n') || null)
    .setColor(draft.color ?? BRAND_COLOR);
}

async function saveMenu(messageId, guildId, channelId, draft) {
  await store().set(messageId, {
    guildId,
    channelId,
    mode: draft.mode,
    roles: Object.fromEntries(draft.pairs.map((pair) => [pair.key, pair.roleId])),
  });
}

async function getMenu(messageId) {
  return store().get(messageId);
}

async function deleteMenu(messageId) {
  await store().delete(messageId);
}

// A reaction on a posted menu: { menu, roleId, member }, or null if it's nothing to act on
// (a bot, another server, a message that isn't a menu, an emoji that isn't on the menu).
async function menuReaction(reaction, user) {
  if (user.bot) return null;
  if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
  const { guild } = reaction.message;
  if (!guild || !isAllowedGuild(guild.id)) return null;
  const menu = await getMenu(reaction.message.id);
  const roleId = menu?.roles[emojiKey(reaction.emoji)];
  if (!roleId) return null;
  const member = await guild.members.fetch(user.id).catch(() => null);
  return member && { menu, roleId, member, message: reaction.message };
}

async function listMenus(guildId) {
  const all = await store().all();
  return Object.entries(all).filter(([, menu]) => menu.guildId === guildId);
}

module.exports = {
  MAX_OPTIONS,
  SELF_PICKED,
  startDraft,
  getDraft,
  saveDraft,
  clearDraft,
  roleProblem,
  draftIsFull,
  addPair,
  removePair,
  buildEmbed,
  saveMenu,
  getMenu,
  deleteMenu,
  listMenus,
  menuReaction,
  emojiKey,
};
