const { ourGuild } = require('../utils/guild');
const { getSettings, addXp, announceLevelUp, loadSoulsEmoji, voiceEarners } = require('../utils/xp');
const { loadStreakEmojis } = require('../utils/trivia');

// On startup: look up the :souls: and /trivia streak bar emojis, then run voice XP.
// Voice XP (off by default, /xp-config voice): once a minute, everyone in a voice channel with at
// least one other listener gets XP (voiceEarners: not deafened, not the AFK channel, not an ignored channel).
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (!guild) return;
    try { loadSoulsEmoji(guild); } catch (e) { console.error('[xp] Souls emoji:', e.message); }
    try { loadStreakEmojis(guild); } catch (e) { console.error('[trivia] Streak bar emojis:', e.message); }
    setInterval(async () => {
      try {
        const s = await getSettings(guild.id);
        if (!s.voiceEnabled) return;
        for (const id of voiceEarners(guild, s)) {
          const result = await addXp(id, s.voiceXpPerMinute);
          await announceLevelUp(guild, id, result);
        }
      } catch (e) {
        console.error('[xp] Voice XP:', e.message);
      }
    }, 60_000);
  },
};
