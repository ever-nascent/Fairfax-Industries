require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { loadEvents } = require('./handlers/loadEvents');
const { initStorage, getStore } = require('./storage');
const { deployCommands } = require('./deploy-commands');

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    console.error('[fatal] DISCORD_TOKEN is not set. Run setup.py once so it saves your token to .env.');
    process.exit(1);
  }

  await initStorage();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // needed to give/remove roles
      GatewayIntentBits.GuildMessageReactions, // needed to see reactions
      GatewayIntentBits.GuildVoiceStates, // needed to see who is in LFG lobbies / voice XP
      GatewayIntentBits.GuildMessages, // chat XP, audit log
      // Audit log: message text (privileged, switched on in the Developer Portal), Discord's own audit log entries,
      // invite uses, AutoMod actions, poll votes.
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.AutoModerationExecution,
      GatewayIntentBits.GuildMessagePolls,
    ],
    // Partials let the bot react to reactions on messages posted before it started.
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
  });
  client.commands = loadCommands();

  client.on('error', (error) => console.error('[client] Unhandled error from an event handler:', error));
  client.on('shardError', (error) => console.error('[client] Connection error:', error.message));
  client.on('warn', (message) => console.warn('[client] Warning:', message));
  client.on('shardDisconnect', (event, id) => console.warn(`[client] Shard ${id} disconnected (code ${event.code}); discord.js will reconnect`));
  loadEvents(client);
  // Slash commands are registered here, only when one changed, so a host only needs `npm start`. A failure isn't fatal: the old ones keep working.
  client.once('clientReady', () =>
    deployCommands(client.commands, new REST().setToken(process.env.DISCORD_TOKEN), getStore('commands')).catch((error) =>
      console.error('[deploy] Could not register slash commands (run `npm run deploy` later):', error.message),
    ),
  );

  await client.login(process.env.DISCORD_TOKEN);

  const shutdown = async (signal) => {
    console.log(`[shutdown] Received ${signal}`);
    await client.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (error) => console.error('[fatal] Unhandled promise rejection:', error));
// Everything is saved to files as it happens, so a stray error in a timer or callback is logged and the bot keeps running.
process.on('uncaughtException', (error) => console.error('[fatal] Uncaught exception:', error));

main().catch((error) => {
  console.error('[fatal] Failed to start bot:', error);
  process.exit(1);
});
