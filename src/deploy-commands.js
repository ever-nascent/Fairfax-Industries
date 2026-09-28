// Registers the bot's slash commands in the Fairfax Industries server.
// Run again whenever a command is added or its options change.
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { GUILD_ID } = require('./config');

async function main() {
  const commands = [...loadCommands().values()].map((command) => command.data.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const app = await rest.get(Routes.currentApplication()); // no need to store the client ID
  const result = await rest.put(Routes.applicationGuildCommands(app.id, GUILD_ID), { body: commands });
  console.log(`[deploy] Registered ${result.length} command(s): ${result.map((c) => '/' + c.name).join(', ')}`);
}

main().catch((error) => {
  console.error('[deploy] Failed to deploy commands:', error);
  process.exit(1);
});
