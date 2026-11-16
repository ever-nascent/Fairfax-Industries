// /managetags add|delete|list: ticket tags, text snippets staff send with /tag. Ticket admins only. A slash command.
// `data` is what Discord shows (name, description, options); `execute` runs when someone uses it. Rules: utils/server/tickets.js; the text pop-up: components/tickets.js.
const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { privateReply } = require('../../utils/embeds');
const K = require('../../utils/server/tickets');

const tagOption = (o) => o.setName('id').setDescription('The tag id').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('managetags')
    .setDescription('Ticket admins: the tags staff send with /tag')
    .addSubcommand((s) => s.setName('add').setDescription('Make a tag, or change one (a pop-up takes the text)').addStringOption(tagOption))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a tag').addStringOption((o) => tagOption(o).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Every tag')),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const tags = (await K.guildTags(interaction.guildId)).filter((t) => t.id.includes(typed));
    return interaction.respond(tags.slice(0, 25).map((t) => ({ name: t.id, value: t.id })));
  },

  async execute(interaction) {
    const settings = await K.getSettings(interaction.guildId);
    if (!K.isAdmin(settings, interaction.member, interaction.memberPermissions)) return privateReply(interaction, 'Only ticket admins can manage tags.');
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const tags = await K.guildTags(interaction.guildId);
      return privateReply(interaction, `**Tags**\n${tags.length ? tags.map((t) => `\`${t.id}\`: ${t.content.replace(/\s+/g, ' ').slice(0, 60)}`).join('\n') : 'None. Make one with `/managetags add`.'}`.slice(0, 4000));
    }
    const id = interaction.options.getString('id').trim().toLowerCase();
    if (sub === 'delete') return privateReply(interaction, (await K.deleteTag(interaction.guildId, id)) ? `Deleted the tag \`${id}\`.` : `There is no tag \`${id}\`.`);
    if (!K.TAG_ID.test(id)) return privateReply(interaction, K.WHY_NOT.tagId);
    const old = await K.getTag(interaction.guildId, id);
    return interaction.showModal(new ModalBuilder().setCustomId(`${K.TAGSET_ID}:${id}`).setTitle(`Tag: ${id}`).addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content').setLabel('The text to send').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(true).setValue(old?.content ?? '')),
    ));
  },
};
