// How numbers and souls are written in messages.

const fmt = (n) => n.toLocaleString('en-US');

// The server's :souls: emoji (xp.js uploads it on startup), put in front of every soul count.
let soulsEmoji = '';
const setSoulsEmoji = (emoji) => (soulsEmoji = emoji);
const soulsIcon = () => (soulsEmoji ? `${soulsEmoji} ` : ''); // with a trailing space

// ":souls: 1,600 souls" and ":souls: **1,600 souls**".
const soulsText = (n) => `${soulsIcon()}${fmt(n)} Souls`;
const boldSouls = (n) => `${soulsIcon()}**${fmt(n)} Souls**`;

module.exports = { fmt, setSoulsEmoji, soulsIcon, soulsText, boldSouls };
