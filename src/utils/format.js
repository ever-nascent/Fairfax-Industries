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

// Shared display casing for short UI lines, including Hero Farming's Battle Log.
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'at', 'for', 'on', 'by', 'per', 'vs']);
const titleCase = (text) => text.replace(/<a?:\w+:\d+>|(?<![\dA-Za-z'])[A-Za-z][A-Za-z']*/g, (word, at) => (word[0] === '<' || (at > 0 && SMALL_WORDS.has(word)) ? word : word[0].toUpperCase() + word.slice(1)));

module.exports = { fmt, setSoulsEmoji, soulsIcon, soulsText, boldSouls, setRejuvEmoji, rejuvIcon, titleCase };
