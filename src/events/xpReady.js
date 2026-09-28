const { isAllowedGuild } = require('../utils/guildLock');
const { getSettings, addXp, announceLevelUp, ensureSoulsEmoji } = require('../utils/xp');

// On startup: make sure the :souls: emoji exists, then run voice XP.
// Voice XP (off by default, /xp-config voice): once a minute, everyone in a voice channel with at
// least one other person gets XP. Deafened members and the AFK channel don't count.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    for (const guild of client.guilds.cache.values()) {
      if (isAllowedGuild(guild.id)) await ensureSoulsEmoji(guild).catch((e) => console.error('[xp] Souls emoji failed:', e.message));
    }
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        if (!isAllowedGuild(guild.id)) continue;
        const s = await getSettings(guild.id);
        if (!s.voiceEnabled) continue;
        for (const state of guild.voiceStates.cache.values()) {
          const { channel, member } = state;
          if (!channel || !member || member.user.bot || state.deaf || channel.id === guild.afkChannelId) continue;
          if (channel.members.filter((m) => !m.user.bot).size < 2) continue;
          const result = await addXp(member.id, s.voiceXpPerMinute);
          await announceLevelUp(guild, member.id, result);
        }
      }
    }, 60_000);
  },
};
