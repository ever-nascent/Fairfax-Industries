// Rebirth (his idea Oct 30; server-plan.md "Rebirth"): a hero that has won a siege and then clears /descend on Ascension 11 or higher is reborn.
// The rank follows the highest ascension that hero has cleared (so a first clear on Ascension 20 is Eternus at once), and only a clear above its
// previous best counts. Ten ranks, Seeker (Ascension 11) to Eternus (Ascension 20), each a permanent +2% health, weapon damage and spirit power,
// in the farm and in /descend. A hero keeps `rebirth` (that ascension) and `sieged` (it has won a siege) in its own part of the farm record (play.js).

const RANKS = ['Seeker', 'Acolyte', 'Sentinel', 'Mystic', 'Ritualist', 'Emissary', 'Oracle', 'Phantom', 'Ascendant', 'Eternus']; // the :rank_<name>: emojis, without the divisions
const FIRST = 11; // the first ascension that counts: rebirths start past Ascension 10
const BONUS = 0.02; // per rank (placeholder, his pick; Eternus = +20%)

const rankOf = (ascension) => (ascension >= FIRST ? Math.min(RANKS.length, ascension - FIRST + 1) : 0);
const statMult = (rank) => 1 + BONUS * rank;
// "<emoji> Seeker" (the emoji only if the server has one), or null for no rank.
const rankText = (guild, rank) => {
  const name = RANKS[rank - 1];
  if (!name) return null;
  const emoji = require('../guild').emojiNamed(guild,`rank_${name.toLowerCase()}`);
  return `${emoji ? `${emoji} ` : ''}${name}`;
};

module.exports = { RANKS, FIRST, BONUS, rankOf, statMult, rankText };
