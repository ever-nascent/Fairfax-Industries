const { MessageFlags } = require('discord.js');
const { isAllowedGuild } = require('../utils/guildLock');
const { findComponentRoute } = require('../components');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!isAllowedGuild(interaction.guildId)) return;

    // Buttons and modals are routed through the component registry so each
    // feature owns its own handlers.
    const route = findComponentRoute(interaction);
    if (route) {
      await route.execute(interaction).catch((error) => console.error(`[${route.name}] ${route.label} failed:`, error));
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
      await command.execute(interaction, client);
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
