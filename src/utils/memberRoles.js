// Roles that sort the member list: owner and staff on top, everyone else as Citizens.
// Shown separately in the member list, not @mentionable.
const { PermissionFlagsBits: P } = require('discord.js');

// Highest first, with the permissions each gets. The bot creates any that are missing, placed just
// under its own role in this order. Permissions are only set on creation, so edits in Discord stick.
const MEMBER_ROLES = {
  'Don of the Cursed Apple': [], // server owner already has every permission
  'Shrine Keeper': [P.Administrator], // admins
  'Base Guardian': [ // mods: kick, timeout, voice mute/deafen, move between VCs, nicknames, delete messages
    P.KickMembers, P.ModerateMembers, P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.ManageNicknames, P.ManageMessages,
  ],
  'Citizen of the Cursed Apple': [],
};
const [OWNER_ROLE, , , CITIZEN_ROLE] = Object.keys(MEMBER_ROLES);
const STAFF_ROLES = Object.keys(MEMBER_ROLES).slice(0, 3);
// Picking one of these in #roles unlocks the server: Citizen carries View Channel, @everyone doesn't.
const PATRON_ROLES = ['The Archmother', 'The Hidden King'];

const findRole = (guild, name) => guild.roles.cache.find((r) => r.name === name);

// Gives the Citizen role (the server unlock) to a (non-bot) member who doesn't have it yet.
async function giveCitizen(member, reason) {
  const role = findRole(member.guild, CITIZEN_ROLE);
  if (member.user.bot || !role || member.roles.cache.has(role.id)) return;
  await member.roles.add(role, reason);
}

// Staff and anyone holding a Patron role (picked in #roles) are unlocked.
const isUnlocked = (member) => member.roles.cache.some((r) => PATRON_ROLES.includes(r.name) || STAFF_ROLES.includes(r.name));

// Startup: create missing roles, give the owner the Don role, and unlock members who hold a Patron or staff role.
async function ensureMemberRoles(guild) {
  await guild.roles.fetch();
  // Lowest first, each moved to just under the bot's role, so they end up in MEMBER_ROLES order.
  // Only new roles are moved, so reordering them by hand in Discord sticks.
  for (const [name, permissions] of Object.entries(MEMBER_ROLES).reverse()) {
    if (findRole(guild, name)) continue;
    const role = await guild.roles.create({ name, hoist: true, mentionable: false, permissions, reason: 'Member roles' });
    await role.setPosition(guild.members.me.roles.highest.position - 1);
    console.log(`[roles] Created role @${name}`);
  }

  const members = await guild.members.fetch();
  const owner = members.get(guild.ownerId);
  const don = findRole(guild, OWNER_ROLE);
  if (owner && !owner.roles.cache.has(don.id)) await owner.roles.add(don, 'Server owner');
  for (const member of members.values()) if (isUnlocked(member)) await giveCitizen(member, 'Holds a Patron or staff role');
}

module.exports = { ensureMemberRoles, giveCitizen, isUnlocked };
