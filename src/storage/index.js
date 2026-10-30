// JSON-file storage in /data (jsonAdapter.js). (Velvet's bot also supports MongoDB; not needed here yet.)
const { createJsonStore } = require('./jsonAdapter');
const { currentGuild } = require('../utils/guildContext');

// Stores whose entries are a member's own progress: one copy per server (his call, Oct 30). Their keys are saved as
// `<server id>:<user id>`; `getStore` hands back a view of the current server's part (guildContext.js), so callers
// keep using plain user ids. `all()` lists only this server's entries, ids without the prefix.
const PER_SERVER = new Set(['xp', 'farm', 'quests', 'lockle', 'hideouts']);

function serverView(raw) {
  const key = (k) => `${currentGuild()}:${k}`;
  return {
    get: (k) => raw.get(key(k)),
    set: (k, value) => raw.set(key(k), value),
    delete: (k) => raw.delete(key(k)),
    update: (k, mutator, options) => raw.update(key(k), mutator, options),
    take: (k, predicate) => raw.take(key(k), predicate),
    async all() {
      const prefix = `${currentGuild()}:`;
      return Object.fromEntries(Object.entries(await raw.all()).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
    },
  };
}

// The store called `name`; a per-server one is the current server's view of it.
const getStore = (name) => (PER_SERVER.has(name) ? serverView(createJsonStore(name)) : createJsonStore(name));
// Every server's entries together, keys as saved. Only for the one-time migration, backups and the transfer.
const getRawStore = createJsonStore;

module.exports = { getStore, getRawStore, PER_SERVER };
