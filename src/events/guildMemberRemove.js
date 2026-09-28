const { isAllowedGuild } = require('../utils/guildLock');
const { getConfig, buildPayload } = require('../utils/greetings');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    if (!isAllowedGuild(member.guild.id)) return;

    const config = await getConfig(member.guild.id, 'goodbye');
    if (!config.enabled || !config.channelId) return;

    const channel = await member.guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel) return;

    await channel.send(buildPayload(config, 'goodbye', member)).catch((error) => {
      console.error('[greetings] Failed to send goodbye message:', error);
    });
  },
};
