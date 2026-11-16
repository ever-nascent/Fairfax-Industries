// /tournament-config (Manage Server): which roles are tournament organizers. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Tournaments themselves: utils/server/tournaments.js.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { privateReply } = require('../../utils/embeds');
const { organizerRoles, setOrganizerRole } = require('../../utils/server/tournaments');

const list = (roles) => (roles.length ? roles.map((id) => `<@&${id}>`).join(', ') : 'None. Only staff with Manage Server can run tournaments.');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tournament-config')
    .setDescription('Staff: who can run tournaments')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName('organizer-add').setDescription('Let a role run tournaments').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('organizer-remove').setDescription('Stop a role from running tournaments').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) => s.setName('show').setDescription('The roles that can run tournaments')),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'show') return privateReply(interaction, `**Organizer Roles**\n${list(await organizerRoles(interaction.guildId))}`);
    const role = interaction.options.getRole('role');
    if (role.id === interaction.guildId) return privateReply(interaction, '@everyone can\'t be an organizer role.');
    const roles = await setOrganizerRole(interaction.guildId, role.id, sub === 'organizer-add');
    const line = sub === 'organizer-add' ? `${role} can now run tournaments.` : `${role} can no longer run tournaments.`;
    return privateReply(interaction, `${line}\n\n**Organizer Roles**\n${list(roles)}`);
  },
};
