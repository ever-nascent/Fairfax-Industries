// The tickets' clock (utils/server/tickets.js `sweep`): on startup, then every minute, a ticket whose close request ran out of time
// or that the server's auto-close rules say is done is closed. Anything missed while the bot was off happens at the next start.
const { sweep } = require('../utils/server/tickets');

const CHECK_MS = 60_000;

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const tick = () => sweep(client).catch((e) => console.error('[tickets] Sweep failed:', e));
    await tick();
    setInterval(tick, CHECK_MS).unref();
  },
};
