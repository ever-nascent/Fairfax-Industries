require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { loadEvents } = require('./handlers/loadEvents');
const { initStorage } = require('./storage');

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
  loadEvents(client);

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

main().catch((error) => {
  console.error('[fatal] Failed to start bot:', error);
  process.exit(1);
});
