const { EmbedBuilder } = require('discord.js');
const { getStore } = require('../storage');
const { createDraftStore } = require('./drafts');
const { BRAND_COLOR } = require('../config');

const drafts = createDraftStore();

function store() {
  return getStore('reactionRoleMenus');
}

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

function startDraft(guildId, userId, { title, description, channelId, mode, color }) {
  return drafts.start(guildId, userId, { title, description, channelId, mode, color, pairs: [] });
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
  const lines = draft.pairs.map((pair) => `${pair.display} - <@&${pair.roleId}>`).join('\n');
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

async function listMenus(guildId) {
  const all = await store().all();
  return Object.entries(all).filter(([, menu]) => menu.guildId === guildId);
}

module.exports = {
  startDraft,
  getDraft: drafts.get,
  clearDraft: drafts.clear,
  addPair,
  removePair,
  buildEmbed,
  saveMenu,
  getMenu,
  deleteMenu,
  listMenus,
  parseEmoji,
  emojiKey,
};
