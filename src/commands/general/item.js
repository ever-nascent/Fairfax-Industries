// /item item:<name>: what any shop item does, its in-game price, what it is built from and upgrades into, with Enhanced and Corrupted buttons. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it; `autocomplete` fills the item list as they type.
// Search and the embed: utils/farm/itemInfo.js; the buttons: components/item.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { choices, resolve, itemView } = require('../../utils/farm/itemInfo');
const { privateReply } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Look up any Deadlock shop item: what it does, its cost and what it upgrades into')
    .addStringOption((o) => o.setName('item').setDescription('Start typing an item name').setRequired(true).setAutocomplete(true)),
  // Answered within Discord's 3 seconds: the search is in memory, no waiting on anything.
  autocomplete: (interaction) => interaction.respond(choices(interaction.options.getFocused())),
  async execute(interaction) {
    const text = interaction.options.getString('item', true);
    const card = resolve(text);
    if (!card) return privateReply(interaction, `No item matches "${text.slice(0, 60)}". Start typing and pick one from the list.`);
    await interaction.deferReply(); // a picture not saved yet is downloaded first
    return interaction.editReply(await itemView(card, 'details', interaction.user.id));
  },
};
