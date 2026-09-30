const fs = require('node:fs');
const path = require('node:path');

const EVENTS_DIR = path.join(__dirname, '..', 'events');

function loadEvents(client) {
  // A file exports one event, or an array of them (auditLog.js listens to many).
  const files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith('.js'));
  for (const event of files.flatMap((file) => require(path.join(EVENTS_DIR, file)))) {
    const listener = (...args) => event.execute(...args, client);
    if (event.once) {
      client.once(event.name, listener);
    } else {
      client.on(event.name, listener);
    }
  }
}

module.exports = { loadEvents };
