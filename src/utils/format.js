// How numbers and souls are written in messages.

const fmt = (n) => n.toLocaleString('en-US');

// The server's :souls: emoji (xp.js looks it up by name on startup), put in front of every soul count.
let soulsEmoji = '';
const setSoulsEmoji = (emoji) => (soulsEmoji = emoji);
const soulsIcon = () => (soulsEmoji ? `${soulsEmoji} ` : ''); // with a trailing space

// The server's :rejuv: emoji (xp.js looks it up on startup), put in front of every "Rejuv" members read.
let rejuvEmoji = '';
const setRejuvEmoji = (emoji) => (rejuvEmoji = emoji);
const rejuvIcon = () => (rejuvEmoji ? `${rejuvEmoji} ` : ''); // with a trailing space

// ":souls: 1,600 souls" and ":souls: **1,600 souls**".
const soulsText = (n) => `${soulsIcon()}${fmt(n)} Souls`;
const boldSouls = (n) => `${soulsIcon()}**${fmt(n)} Souls**`;

module.exports = { fmt, setSoulsEmoji, soulsIcon, soulsText, boldSouls, setRejuvEmoji, rejuvIcon };
