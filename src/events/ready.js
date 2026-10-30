// An event file: loadEvents.js hooks `execute` to the Discord event in `name`.
// At startup: logs that the bot is online and which servers it is in. (Until Oct 30 it left every server but Fairfax.)

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    console.log(`[ready] Logged in as ${client.user.tag}`);
    console.log(`[ready] In ${client.guilds.cache.size} server(s): ${[...client.guilds.cache.values()].map((g) => `"${g.name}"`).join(', ')}`);
    console.log('[ready] Bot is running. Keep this window open. Close it to stop the bot.');
  },
};
