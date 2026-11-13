// Color Role (Shop): a role of the member's own, with a name and a hex colour they pick. Buying again recolors it
// (or renames it) for the smaller price. One per member per server, kept in data/colorRoles.json.
// The role is made just under the bot's top role (or under the role /shop-config color-below names).
const { ActionRowBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getStore } = require('../../storage');
const { changeSouls } = require('../economy/xp');
const { findPhrase, getPhrases } = require('../server/censor');

const MODAL_ID = 'shop_color_modal'; // custom id: shop_color_modal:<userId>
const ROLE_LIMIT = 250; // Discord's roles per server
const NAME_MAX = 32;

const records = () => getStore('colorRoles'); // key: `<guild id>:<user id>` -> { roleId }
const keyOf = (guildId, userId) => `${guildId}:${userId}`;

// Their Color Role, or null (they have none, or it was deleted by hand).
async function getColorRole(guild, userId) {
  const saved = await records().get(keyOf(guild.id, userId));
  return (saved && guild.roles.cache.get(saved.roleId)) || null;
}

// "#E39A3B" / "e39a3b" -> 0xe39a3b, or null. Pure black is nudged: Discord reads 0 as "no colour".
function parseColor(text) {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return m ? Math.max(1, parseInt(m[1], 16)) : null;
}

// The pop-up: a name and a hex colour, filled in with what they have now.
function colorModal(userId, role) {
  const field = (id, label, placeholder, value, max) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setPlaceholder(placeholder).setRequired(true).setMaxLength(max);
    if (value) input.setValue(value);
    return new ActionRowBuilder().addComponents(input);
  };
  return new ModalBuilder().setCustomId(`${MODAL_ID}:${userId}`).setTitle(role ? 'Recolor Your Role' : 'Make Your Color Role').addComponents(
    field('name', 'Role Name', 'The Don', role?.name ?? '', NAME_MAX),
    field('color', 'Color (Hex)', '#e39a3b', role ? `#${role.color.toString(16).padStart(6, '0')}` : '', 7),
  );
}

// Buys (or recolors) their Color Role. `cfg` is the server's shopConfig. Returns { ok: true, recolor, role }, or
// { ok: false, reason: 'color' | 'name' | 'censored' | 'souls' | 'perms' | 'full' }. Souls come back if Discord refuses.
async function buyColorRole(member, nameText, colorText, cfg) {
  const { guild } = member;
  const color = parseColor(colorText);
  const name = nameText.trim().slice(0, NAME_MAX);
  if (color === null) return { ok: false, reason: 'color' };
  if (!name) return { ok: false, reason: 'name' };
  if (findPhrase(name, await getPhrases(guild.id))) return { ok: false, reason: 'censored' };

  const role = await getColorRole(guild, member.id);
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || (role && !role.editable)) return { ok: false, reason: 'perms' };
  if (!role && guild.roles.cache.size >= ROLE_LIMIT) return { ok: false, reason: 'full' };

  const price = cfg.price(role ? 'recolor' : 'color');
  if (!(await changeSouls(member.id, -price, 'shop:color'))) return { ok: false, reason: 'souls' };
  try {
    let made = role;
    if (role) await role.edit({ name, color, reason: 'Shop: Color Role recolored' });
    else {
      const below = (cfg.colorBelow && guild.roles.cache.get(cfg.colorBelow)) || me.roles.highest;
      made = await guild.roles.create({ name, color, position: Math.max(1, below.position - 1), reason: `Shop: Color Role for ${member.user.tag}` });
      await records().set(keyOf(guild.id, member.id), { roleId: made.id });
    }
    if (!member.roles.cache.has(made.id)) await member.roles.add(made, 'Shop: Color Role');
    return { ok: true, recolor: !!role, role: made };
  } catch (error) {
    await changeSouls(member.id, price, 'shop:color'); // refund
    throw error;
  }
}

module.exports = { MODAL_ID, getColorRole, parseColor, colorModal, buyColorRole };
