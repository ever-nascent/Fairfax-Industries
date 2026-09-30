const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { replyEmbed } = require('../../utils/embeds');
const { getPhrases, addPhrase, removePhrase } = require('../../utils/censor');

const titled = (interaction, title, text) =>
  interaction.reply({ embeds: [replyEmbed(text).setTitle(title)], flags: MessageFlags.Ephemeral });

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auto-mod')
    .setDescription('Staff: the Shopkeeper keeps the shop clean')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((g) =>
      g
        .setName('censor')
        .setDescription('Phrases that get deleted on sight')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Censor a word or phrase (whole words only)')
            .addStringOption((o) =>
              o.setName('phrase').setDescription('Word or phrase; separate several with commas').setMaxLength(1000).setRequired(true),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Stop censoring a phrase')
            .addStringOption((o) =>
              o.setName('phrase').setDescription('Phrase to remove').setMaxLength(100).setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('Show the censored phrases (only you see them)')),
    ),

  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const phrases = await getPhrases(interaction.guildId);
    await interaction.respond(phrases.filter((p) => p.includes(typed)).slice(0, 25).map((p) => ({ name: p, value: p })));
  },

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    // Only `censor` exists so far; more groups (spam, links, ...) go beside it.
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'list') {
      const phrases = await getPhrases(guildId);
      const text = phrases.length ? phrases.map((p) => `- ${p}`).join('\n') : 'Nothing censored yet.';
      return interaction.reply({ embeds: [replyEmbed(text.slice(0, 4000)).setTitle('Censored phrases')], flags: MessageFlags.Ephemeral });
    }

    const phrase = interaction.options.getString('phrase');
    if (sub === 'add' && phrase.includes(',')) {
      const added = [];
      let skipped = 0;
      for (const p of phrase.split(',').map((s) => s.trim()).filter(Boolean)) (await addPhrase(guildId, p)) ? added.push(p) : skipped++;
      const text = `Added ${added.length}${skipped ? `, ${skipped} already on the list` : ''}. Messages containing them will be deleted on sight.`;
      return titled(interaction, `Now Censoring ${added.length} Phrases`, text);
    }
    if (sub === 'add') {
      const added = await addPhrase(guildId, phrase);
      return titled(interaction, added ? `Now Censoring: ${phrase}` : `Already Censored: ${phrase}`, added ? 'Messages containing it will be deleted on sight.' : 'It is already on the list.');
    }
    const removed = await removePhrase(guildId, phrase);
    return titled(interaction, removed ? `No Longer Censoring: ${phrase}` : `Not Censored: ${phrase}`, removed ? 'Messages containing it will be left alone.' : "It isn't on the list.");
  },
};
