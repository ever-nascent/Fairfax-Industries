const { expireGames } = require('../utils/casino');
const { ourGuild } = require('../utils/guild');
const games = ['doorman', 'blackjack', 'sinclair', 'paradox', 'bebop', 'holliday', 'yamato', 'silver', 'rem', 'pocket'].map((name) => require(`../utils/${name}`));
const bebop = require('../utils/bebop');
const yamato = require('../utils/yamato');
const silver = require('../utils/silver');
const holliday = require('../utils/holliday');
const rem = require('../utils/rem');

// On startup, then every 30 s: call off games nobody has clicked for 5 minutes and give the bets back.
// Also looks up Bebop's :sticky_bomb:, Yamato's stance and Silver's :shell_live: / :shell_blank: emojis in the server.
// Powder Keg games left from before a restart lost their fuse timer, so they're all called off at startup.
module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    const guild = ourGuild(client);
    for (const [what, load] of [['Sticky bomb', bebop.loadBombEmoji], ['Stance', yamato.loadStanceEmojis], ['Shell', silver.loadShellEmojis], ['Remling', rem.loadRemlingEmojis]]) {
      try { if (guild) load(guild); } catch (e) { console.error(`[games] ${what} emoji:`, e.message); }
    }
    await expireGames(client, [holliday, rem], Infinity).catch((e) => console.error('[games] Powder Keg / Remling Race cleanup failed:', e));
    const sweep = () => expireGames(client, games).catch((e) => console.error('[games] Timeout check failed:', e));
    sweep();
    setInterval(sweep, 30_000);
  },
};
