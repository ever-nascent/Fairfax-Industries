// /help: the help menu (every command, what it does and how to use it, and tutorials for Hero Farming, Descend and the Shop). A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Only the member who ran it sees it (PRIVATE below). The pages: utils/help.js; the dropdowns and Back / Next: components/help.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { helpView, contextOf } = require('../../utils/help');

const PRIVATE = true; // false = the menu is posted for everyone to read (its buttons still only work for the member who ran it)

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Every command, what it does and how to use it, with tutorials'),
  execute: (interaction) => interaction.reply({ ...helpView(contextOf(interaction), interaction.user.id), ...(PRIVATE ? { flags: MessageFlags.Ephemeral } : {}) }),
};
