// Tickets: a message in a ticket channel remembers when it was written (auto-close) and the first staff answer (utils/server/tickets.js `noteActivity`).
// An opener who leaves the server gets their tickets closed when auto-close is told to (`closeForLeaver`). A file may export an array of events.
const K = require('../utils/server/tickets');

module.exports = [
  {
    name: 'messageCreate',
    async execute(message) {
      if (message.guild) await K.noteActivity(message);
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      await K.closeForLeaver(member.guild, member.id);
    },
  },
];
