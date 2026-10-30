// Every slash command, button, dropdown and pop-up arrives here first (Discord's interactionCreate event).
// Buttons/dropdowns/pop-ups go to the first route in components/ that `matches`; slash commands go to client.commands by name.
// If you wonder "where does clicking X go?", find the button's customId and search components/ for it.
const { MessageFlags } = require('discord.js');
const { isAllowedGuild } = require('../utils/guild');
const { findComponentRoute } = require('../components');
const { withQuests } = require('../utils/economy/quests'); // tells a member privately when a quest they just finished paid

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!isAllowedGuild(interaction.guildId)) return;

    // Buttons and modals are routed through the component registry so each
    // feature owns its own handlers.
    const route = findComponentRoute(interaction);
    if (route) {
      await withQuests(interaction, () => route.execute(interaction)).catch((error) => console.error(`[${route.name}] ${route.label} failed:`, error));
      return;
    }

    // Autocomplete arrives as its own interaction type and must be answered
    // within 3 seconds, so it's routed to the command's own `autocomplete`
    // handler and never falls through to `execute`.
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction, client);
      } catch (error) {
        console.error(`[command] Autocomplete failed for /${interaction.commandName}:`, error);
      }
      return;
    }

    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await withQuests(interaction, () => command.execute(interaction, client));
    } catch (error) {
      console.error(`[command] Error running /${interaction.commandName}:`, error);
      const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (replyError) {
        console.error(`[command] Failed to report error for /${interaction.commandName}:`, replyError.message);
      }
    }
  },
};
