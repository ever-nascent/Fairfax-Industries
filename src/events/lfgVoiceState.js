// Event handler: voiceStateUpdate.
// Fires when someone joins, leaves or moves between voice channels.

const { onVoiceChange } = require('../utils/server/lfg');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState, client) {
    if (oldState.channelId === newState.channelId) return; // mute/deafen etc.
    await onVoiceChange(client, oldState.channel);
    await onVoiceChange(client, newState.channel);
  },
};
