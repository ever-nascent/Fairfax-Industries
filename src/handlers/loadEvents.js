const fs = require('node:fs');
const path = require('node:path');

const EVENTS_DIR = path.join(__dirname, '..', 'events');

function loadEvents(client) {
  // Every feature owns its own startup (clientReady) handler, so there can be more than Node's default 10 listeners on purpose (work that needs no Discord runs in index.js instead).
  client.setMaxListeners(30);
  // A file exports one event, or an array of them (auditLog.js listens to many).
  const files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith('.js'));
  for (const event of files.flatMap((file) => require(path.join(EVENTS_DIR, file)))) {
    // one failing handler is logged with its event's name and never reaches the others
    const listener = async (...args) => {
      try {
        await event.execute(...args, client);
      } catch (error) {
        console.error(`[event] ${event.name} handler failed:`, error);
      }
    };
    if (event.once) {
      client.once(event.name, listener);
    } else {
      client.on(event.name, listener);
    }
  }
}

module.exports = { loadEvents };
