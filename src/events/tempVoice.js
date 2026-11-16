// Event handler: voiceStateUpdate, channelDelete, clientReady.
// TempVoice: make a room when someone joins a Creator Channel, delete empty ones, keep the records true.

const tv = require('../utils/server/tempVoice');

const log = (what) => (e) => console.error(`[tempvoice] ${what} failed:`, e.message);
module.exports = [
  {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
      if (oldState.channelId === newState.channelId) return;
      await tv.onVoiceChange(oldState, newState).catch(log('Voice change'));
    },
  },
  {
    name: 'channelDelete',
    async execute(channel) {
      if (channel.guild) await tv.channelDeleted(channel).catch(log('Channel cleanup'));
    },
  },
  {
    name: 'clientReady',
    once: true,
    async execute(client) {
      for (const guild of client.guilds.cache.values()) await tv.reconcile(guild).catch(log(`Startup check in "${guild.name}"`));
    },
  },
];
