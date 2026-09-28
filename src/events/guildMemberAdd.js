const { isAllowedGuild } = require('../utils/guildLock');
const { getConfig, buildPayload } = require('../utils/greetings');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    if (!isAllowedGuild(member.guild.id)) return;

    const config = await getConfig(member.guild.id, 'welcome');
    if (!config.enabled || !config.channelId) return;

    const channel = await member.guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel) return;

    await channel.send(buildPayload(config, 'welcome', member)).catch((error) => {
      console.error('[greetings] Failed to send welcome message:', error);
    });
  },
};
