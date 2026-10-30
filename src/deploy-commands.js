// Registers the bot's slash commands with Discord. The bot does this itself on startup (only when a command changed),
// so `npm start` is all a host needs; `npm run deploy` does it by hand.
// Every command is registered for every server the bot is in, and only works inside a server (not in DMs). A command whose
// file sets `homeOnly: true` is built for the Fairfax server alone (stream alerts, the audit log, Hideouts ...): it is
// registered in Fairfax only, so other servers never see it.
try { process.loadEnvFile(); } catch {}
const crypto = require('node:crypto');
const { REST, Routes, InteractionContextType, ApplicationIntegrationType } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { GUILD_ID } = require('./config');

// `commands` (a Map of loaded commands) split into what goes to every server and what goes to Fairfax only.
function commandBodies(commands) {
  const body = (command) => ({ ...command.data.toJSON(), contexts: [InteractionContextType.Guild], integration_types: [ApplicationIntegrationType.GuildInstall] });
  const all = [...commands.values()];
  return { everywhere: all.filter((c) => !c.homeOnly).map(body), home: all.filter((c) => c.homeOnly).map(body) };
}

// Registers `commands`. With `store`, skips the request when they're the same as last time.
async function deployCommands(commands, rest, store) {
  const { everywhere, home } = commandBodies(commands);
  const hash = crypto.createHash('sha256').update(JSON.stringify({ everywhere, home })).digest('hex');
  if (store && (await store.get('hash')) === hash) return null;
  const app = await rest.get(Routes.currentApplication()); // no need to store the client ID
  const result = await rest.put(Routes.applicationCommands(app.id), { body: everywhere });
  // Fairfax's own list replaces what was there (before Oct 30 it held every command, which would show twice next to the global ones).
  const homeResult = await rest.put(Routes.applicationGuildCommands(app.id, GUILD_ID), { body: home });
  await store?.set('hash', hash);
  console.log(`[deploy] Registered ${result.length} command(s) everywhere: ${result.map((c) => '/' + c.name).join(', ')}; ${homeResult.length} in Fairfax only: ${homeResult.map((c) => '/' + c.name).join(', ')}`);
  return result;
}

if (require.main === module) {
  deployCommands(loadCommands(), new REST().setToken(process.env.DISCORD_TOKEN)).catch((error) => {
    console.error('[deploy] Failed to deploy commands:', error);
    process.exit(1);
  });
}

module.exports = { deployCommands, commandBodies };
