// An event file: loadEvents.js hooks `execute` to the Discord event in `name`.
// At startup: logs that the bot is online and leaves any server that is not ours (GUILD_ID in config.js).
const { isAllowedGuild } = require('../utils/guild');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    console.log(`[ready] Logged in as ${client.user.tag}`);
    for (const guild of client.guilds.cache.values()) {
      if (isAllowedGuild(guild.id)) {
        console.log(`[ready] Serving "${guild.name}"`);
        continue;
      }
      console.warn(`[guildLock] Leaving unauthorized guild "${guild.name}" (${guild.id})`);
      await guild.leave();
    }
    console.log('[ready] Bot is running. Keep this window open. Close it to stop the bot.');
  },
};
