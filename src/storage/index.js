// JSON-file storage in /data (jsonAdapter.js). (Velvet's bot also supports MongoDB; not needed here yet.)
const { createJsonStore } = require('./jsonAdapter');

module.exports = { getStore: createJsonStore };
