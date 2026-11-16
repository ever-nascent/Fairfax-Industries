// Event handler: channelDelete.
// If staff delete a lobby voice channel by hand, clean up its record and #lfg post.

const { onChannelDeleted } = require('../utils/server/lfg');

module.exports = {
  name: 'channelDelete',
  async execute(channel, client) {
    await onChannelDeleted(client, channel.id).catch((e) => console.error('[lfg] channelDelete failed:', e));
  },
};
