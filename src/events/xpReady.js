const { ourGuild } = require('../utils/guild');
const { getSettings, addXp, announceLevelUp, loadSoulsEmoji } = require('../utils/xp');
const { loadStreakEmojis } = require('../utils/trivia');

// On startup: look up the :souls: and /trivia streak bar emojis, then run voice XP.
// Voice XP (off by default, /xp-config voice): once a minute, everyone in a voice channel with at
// least one other person gets XP. Deafened members and the AFK channel don't count.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (!guild) return;
    try { loadSoulsEmoji(guild); } catch (e) { console.error('[xp] Souls emoji:', e.message); }
    try { loadStreakEmojis(guild); } catch (e) { console.error('[trivia] Streak bar emojis:', e.message); }
    setInterval(async () => {
      const s = await getSettings(guild.id);
      if (!s.voiceEnabled) return;
      for (const state of guild.voiceStates.cache.values()) {
        const { channel, member } = state;
        if (!channel || !member || member.user.bot || state.deaf || channel.id === guild.afkChannelId) continue;
        if (channel.members.filter((m) => !m.user.bot).size < 2) continue;
        const result = await addXp(member.id, s.voiceXpPerMinute);
        await announceLevelUp(guild, member.id, result);
      }
    }, 60_000);
  },
};
