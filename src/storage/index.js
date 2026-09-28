// JSON-file storage in /data. (Velvet's bot also supports MongoDB; not needed here yet.)
const { createJsonStore } = require('./jsonAdapter');

async function initStorage() {
  console.log('[storage] using JSON file storage');
}

function getStore(collection) {
  return createJsonStore(collection);
}

module.exports = { initStorage, getStore };
