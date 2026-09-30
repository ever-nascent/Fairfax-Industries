const { expireGames } = require('../utils/casino');
const { ourGuild } = require('../utils/guild');
const games = ['doorman', 'blackjack', 'sinclair', 'paradox', 'bebop', 'holliday', 'yamato', 'silver', 'rem', 'pocket'].map((name) => require(`../utils/${name}`));
const bebop = require('../utils/bebop');
const yamato = require('../utils/yamato');
const silver = require('../utils/silver');
const holliday = require('../utils/holliday');
const rem = require('../utils/rem');

// On startup, then every 30 s: call off games nobody has clicked for 5 minutes and give the bets back.
// Also uploads Bebop's :sticky_bomb:, Yamato's stance and Silver's :shell_live: / :shell_blank: emojis.
// Powder Keg games left from before a restart lost their fuse timer, so they're all called off at startup.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    if (guild) await bebop.ensureBombEmoji(guild).catch((e) => console.error('[games] Sticky bomb emoji failed:', e.message));
    if (guild) await yamato.ensureStanceEmojis(guild).catch((e) => console.error('[games] Stance emojis failed:', e.message));
    if (guild) await silver.ensureShellEmojis(guild).catch((e) => console.error('[games] Shell emojis failed:', e.message));
    if (guild) await rem.ensureRemlingEmojis(guild).catch((e) => console.error('[games] Remling emojis failed:', e.message));
    await expireGames(client, [holliday, rem], Infinity).catch((e) => console.error('[games] Powder Keg / Remling Race cleanup failed:', e));
    const sweep = () => expireGames(client, games).catch((e) => console.error('[games] Timeout check failed:', e));
    sweep();
    setInterval(sweep, 30_000);
  },
};
