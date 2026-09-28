const { onChannelDeleted } = require('../utils/lfg');

// If staff delete a lobby voice channel by hand, clean up its record and #lfg post.
module.exports = {
  name: 'channelDelete',
  async execute(channel, client) {
    await onChannelDeleted(client, channel.id).catch((e) => console.error('[lfg] channelDelete failed:', e));
  },
};
