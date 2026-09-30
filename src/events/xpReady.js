const path = require('node:path');
const { ourGuild, ensureEmoji } = require('../utils/guild');
const { ASSETS } = require('../utils/art');
const { getSettings, addXp, announceLevelUp, ensureSoulsEmoji } = require('../utils/xp');
const { ensureStreakEmojis } = require('../utils/trivia');

// On startup: make sure the :souls:, /trivia streak bar and :rejuv: emojis exist, then run voice XP.
// Voice XP (off by default, /xp-config voice): once a minute, everyone in a voice channel with at
// least one other person gets XP. Deafened members and the AFK channel don't count.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (!guild) return;
    await ensureSoulsEmoji(guild).catch((e) => console.error('[xp] Souls emoji failed:', e.message));
    await ensureStreakEmojis(guild).catch((e) => console.error('[trivia] Streak bar emojis failed:', e.message));
    // the Rejuv icon (deadlock.wiki "Mid-Boss.png"): Shop dropdown and /urn's Use Rejuv button
    await ensureEmoji(guild, 'rejuv', path.join(ASSETS, 'shop', 'art', 'rejuv.png')).catch((e) => console.error('[shop] Rejuv emoji failed:', e.message));
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
