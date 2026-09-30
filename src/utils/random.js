// Random picks. `randomInt` can be swapped out in tests for a fixed sequence.
const crypto = require('node:crypto');

const randomInt = (n) => crypto.randomInt(n);
const pickRandom = (list, rnd = randomInt) => list[rnd(list.length)];

function shuffle(list, rnd = randomInt) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Short id for games and trivia rounds (goes in button custom ids).
const shortId = () => crypto.randomUUID().slice(0, 8);

module.exports = { randomInt, pickRandom, shuffle, shortId };
