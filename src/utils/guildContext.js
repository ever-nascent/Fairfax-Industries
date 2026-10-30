// Which server the code is running for. Player data (XP, souls, farm, quests ...) is kept per server, and the stores in
// storage/index.js read this to pick the server's part. Set it where work begins: an interaction, a message, a timer.
// Anything started inside inherits it (timeouts, detached promises, the storage lock). Asking for it when none is set
// throws, so a missed entry point fails loudly instead of touching the wrong server's data.
const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();

// Runs `fn` for `guildId`; returns what `fn` returns.
const runInGuild = (guildId, fn) => context.run(guildId, fn);

// The server the current work is for. Throws when there is none.
function currentGuild() {
  const guildId = context.getStore();
  if (!guildId) throw new Error('no server set for this work (wrap the entry point in runInGuild)');
  return guildId;
}

// For tests: makes the rest of the current async flow run for `guildId`.
const enterGuild = (guildId) => context.enterWith(guildId);

module.exports = { runInGuild, currentGuild, enterGuild };
