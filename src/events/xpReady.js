// Event handler: clientReady.
// On startup: look up the :souls: and /trivia streak bar emojis, then run voice XP.
// Voice XP (off by default, /xp-config voice): once a minute, everyone in a voice channel with at
// least one other listener gets XP (voiceEarners: not deafened, not the AFK channel, not an ignored channel).

const { ourGuild } = require('../utils/guild');
const { getSettings, addXp, announceLevelUp, loadSoulsEmoji, voiceEarners } = require('../utils/economy/xp');
const { loadStreakEmojis } = require('../utils/games/trivia');
const { runInGuild } = require('../utils/guildContext');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (!guild) return;
    try { loadSoulsEmoji(guild); } catch (e) { console.error('[xp] Souls emoji:', e.message); }
    try { loadStreakEmojis(guild); } catch (e) { console.error('[trivia] Streak bar emojis:', e.message); }
    setInterval(() => {
      for (const g of client.guilds.cache.values()) {
        runInGuild(g.id, async () => {
          try {
            const s = await getSettings(g.id);
            if (!s.voiceEnabled) return;
            for (const id of voiceEarners(g, s)) {
              const result = await addXp(id, s.voiceXpPerMinute);
              await announceLevelUp(g, id, result);
            }
          } catch (e) {
            console.error(`[xp] Voice XP in "${g.name}":`, e.message);
          }
        });
      }
    }, 60_000);
  },
};
