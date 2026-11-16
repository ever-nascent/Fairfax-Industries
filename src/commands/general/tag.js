// /tag id: staff send one of the server's saved tags (text snippets) in the channel. A slash command.
// `data` is what Discord shows (name, description, options); `execute` runs when someone uses it. Tags are made with /managetags (commands/admin/managetags.js).
const { SlashCommandBuilder } = require('discord.js');
const { privateReply } = require('../../utils/embeds');
const K = require('../../utils/server/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Ticket staff: send a saved tag')
    .addStringOption((o) => o.setName('id').setDescription('The tag').setAutocomplete(true).setRequired(true)),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const tags = (await K.guildTags(interaction.guildId)).filter((t) => t.id.includes(typed));
    return interaction.respond(tags.slice(0, 25).map((t) => ({ name: t.id, value: t.id })));
  },

  async execute(interaction) {
    const settings = await K.getSettings(interaction.guildId);
    if (!K.isStaff(settings, interaction.member, interaction.memberPermissions)) return privateReply(interaction, K.WHY_NOT.staff);
    const id = interaction.options.getString('id');
    const tag = await K.getTag(interaction.guildId, id);
    if (!tag) return privateReply(interaction, `There is no tag \`${id.slice(0, 40)}\`. Pick one from the list.`);
    return interaction.reply({ content: tag.content, allowedMentions: { parse: ['users'] } }); // never @everyone or a role
  },
};
