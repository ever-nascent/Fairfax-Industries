// /stats user|server: ticket numbers for ticket staff (tickets opened, claimed, first answer time, ratings). A slash command.
// `data` is what Discord shows (name, description, options); `execute` runs when someone uses it. Numbers come from closed tickets saved since tickets were switched on: utils/server/tickets.js.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BRAND_COLOR } = require('../../config');
const { privateReply } = require('../../utils/embeds');
const K = require('../../utils/server/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Ticket staff: ticket statistics')
    .addSubcommand((s) => s.setName('user').setDescription('Statistics for one member').addUserOption((o) => o.setName('user').setDescription('Who (empty = you)')))
    .addSubcommand((s) => s.setName('server').setDescription('Statistics for the whole server')),

  async execute(interaction) {
    const settings = await K.getSettings(interaction.guildId);
    if (!K.isStaff(settings, interaction.member, interaction.memberPermissions)) return privateReply(interaction, K.WHY_NOT.staff);
    const { history, feedback, open } = await K.statsData(interaction.guildId);
    const embed = new EmbedBuilder().setColor(BRAND_COLOR);
    if (interaction.options.getSubcommand() === 'user') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const s = K.userStats(user.id, history, feedback, open);
      embed.setTitle(`Ticket Stats: ${user.username}`).addFields(
        { name: 'Tickets Opened', value: `**${s.opened}**`, inline: true },
        { name: 'Tickets Claimed', value: `**${s.claimed}**`, inline: true },
        { name: 'First Answer Time', value: K.duration(s.response), inline: true },
        { name: 'Rating Of Claimed Tickets', value: K.stars(s.ratings) },
      );
    } else {
      const s = K.serverStats(history, feedback, open);
      embed.setTitle('Ticket Stats: Server').addFields(
        { name: 'Tickets Opened', value: `**${s.opened}**`, inline: true },
        { name: 'Open Now', value: `**${s.open}**`, inline: true },
        { name: 'Closed', value: `**${s.closed}**`, inline: true },
        { name: 'First Answer Time', value: K.duration(s.response), inline: true },
        { name: 'Ticket Length', value: K.duration(s.length), inline: true },
        { name: 'Rating', value: K.stars(s.ratings), inline: true },
        { name: 'Most Claims', value: s.top.length ? s.top.map(([id, n], i) => `**${i + 1}.** <@${id}> (**${n}**)`).join('\n') : 'None' },
      );
    }
    return interaction.reply({ embeds: [embed.setFooter({ text: 'Counted from tickets closed since tickets were switched on.' })], flags: 64, allowedMentions: { parse: [] } });
  },
};
