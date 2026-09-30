// Registers the bot's slash commands in the Fairfax Industries server. The bot does this itself on startup
// (only when a command changed), so `npm start` is all a host needs; `npm run deploy` does it by hand.
require('dotenv').config();
const crypto = require('node:crypto');
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { GUILD_ID } = require('./config');

// Registers `commands` (a Map of loaded commands). With `store`, skips the request when they're the same as last time.
async function deployCommands(commands, rest, store) {
  const body = [...commands.values()].map((command) => command.data.toJSON());
  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (store && (await store.get('hash')) === hash) return null;
  const app = await rest.get(Routes.currentApplication()); // no need to store the client ID
  const result = await rest.put(Routes.applicationGuildCommands(app.id, GUILD_ID), { body });
  await store?.set('hash', hash);
  console.log(`[deploy] Registered ${result.length} command(s): ${result.map((c) => '/' + c.name).join(', ')}`);
  return result;
}

if (require.main === module) {
  deployCommands(loadCommands(), new REST().setToken(process.env.DISCORD_TOKEN)).catch((error) => {
    console.error('[deploy] Failed to deploy commands:', error);
    process.exit(1);
  });
}

module.exports = { deployCommands };
