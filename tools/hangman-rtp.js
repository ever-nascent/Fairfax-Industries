// What Don't Wake the Bookwyrm returns in the long run, by how well the player plays (`node tools/hangman-rtp.js`; never touches data/).
// Each strategy plays every word of every chapter once (a chapter is picked first, so each chapter counts a third):
//   frequency   guesses letters in English letter-frequency order and types the word only once only letters are missing: a player who knows
//               nothing about Deadlock's names
//   player      a typical player (what the payout table is set for): knows 60% of the names (KNOWN) and plays those like "lazy", plays the
//               rest like "frequency"
//   lazy        a player who knows every name but only types one once it is the only one that fits; letters in the order the chapter uses them
//   human       a player who knows the game's names but not the whole list: guesses the letters most of the chapter's words use (the same
//               order every time), and types the word as soon as 3 or fewer names fit, picking one of them (a wrong one costs a wrong guess)
//   solver      always guesses the letter that appears in most of the chapter's words that still fit what is known, and solves as soon as one
//               word fits: the best any player can do, knowing every name in the game (the chapter is shown, so they could)
// The payout table (PAYOUT in src/utils/paige.js) is set so the typical player is near 95% like the other games. A player who knows every name, and a
// script with the full name list, beat that table (the words are few and public): how far is printed, so the table can be tightened if anyone does it.
const { wordPool, lettersOf, winnings, PAYOUT, MAX_WRONG } = require('../src/utils/paige');

const KNOWN = 0.6; // the share of names a typical player recognises
const ENGLISH = 'ETAOINSHRDLCUMWFGYPBVKJXQZ';

// The words in `words` that still fit: same length and punctuation, the known letters exactly where they are, no other known or wrong letter.
function fits(words, secret, hits, wrong) {
  const letters = (w) => [...w].filter((c) => /[A-Z]/.test(c));
  return words.filter((w) => w.length === secret.length && [...w].every((c, i) => {
    const s = secret[i];
    if (!/[A-Z]/.test(s)) return c === s;
    if (hits.has(s)) return c === s;
    return /[A-Z]/.test(c) && !hits.has(c) && !wrong.has(c);
  }) && letters(w).length === letters(secret).length);
}

// Plays one word. Returns { won, wrong }. rnd: a 0-1 random (the human picks between the names that fit).
function play(secret, chapter, strategy, rnd = Math.random) {
  const hits = new Set(), wrong = new Set();
  const need = lettersOf(secret);
  const order = strategy === 'human' || strategy === 'lazy' ? [...ENGLISH].sort((a, b) => chapter.filter((w) => w.includes(b)).length - chapter.filter((w) => w.includes(a)).length) : null;
  let tried = chapter.filter(() => false); // the names the human typed that were wrong
  for (;;) {
    if (need.every((c) => hits.has(c))) return { won: true, wrong: wrong.size };
    let letter;
    if (strategy === 'human' || strategy === 'lazy') {
      const candidates = fits(chapter, secret, hits, wrong).filter((w) => !tried.includes(w));
      if (candidates.length && candidates.length <= (strategy === 'lazy' ? 1 : 3)) {
        const guess = candidates[Math.floor(rnd() * candidates.length)];
        if (guess === secret) { need.forEach((c) => hits.add(c)); continue; }
        tried = [...tried, guess]; wrong.add('?' + tried.length); // a wrong solve costs a wrong guess
        if (wrong.size >= MAX_WRONG) return { won: false, wrong: wrong.size };
        continue;
      }
      letter = order.find((c) => !hits.has(c) && !wrong.has(c));
    } else
    if (strategy === 'solver') {
      const candidates = fits(chapter, secret, hits, wrong);
      if (candidates.length === 1) { hits.clear(); need.forEach((c) => hits.add(c)); continue; } // solves it: no wrong guess
      const count = new Map();
      for (const w of candidates) for (const c of lettersOf(w)) if (!hits.has(c) && !wrong.has(c)) count.set(c, (count.get(c) ?? 0) + 1);
      letter = [...count.entries()].sort((a, b) => b[1] - a[1] || ENGLISH.indexOf(a[0]) - ENGLISH.indexOf(b[0]))[0][0];
    } else {
      letter = [...ENGLISH].find((c) => !hits.has(c) && !wrong.has(c));
    }
    if (secret.includes(letter)) hits.add(letter); else wrong.add(letter);
    if (wrong.size >= MAX_WRONG) return { won: false, wrong: wrong.size };
  }
}

// { rtp, winRate, avgWrong } for a strategy, with the bet as 1 (so rounding down to whole souls is left out).
function simulate(strategy, payout = PAYOUT) {
  const pool = wordPool();
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let back = 0, wins = 0, wrongSum = 0, n = 0;
  for (const chapter of Object.values(pool)) {
    let chapterBack = 0, chapterWins = 0, chapterWrong = 0;
    for (const word of chapter) {
      const r = play(word, chapter, strategy === 'player' ? (rnd() < KNOWN ? 'lazy' : 'frequency') : strategy, rnd);
      if (r.won) { chapterBack += payout[Math.min(r.wrong, payout.length - 1)]; chapterWins++; }
      chapterWrong += r.wrong;
    }
    back += chapterBack / chapter.length / 3; wins += chapterWins / chapter.length / 3; wrongSum += chapterWrong / chapter.length / 3; n++;
  }
  return { rtp: back, winRate: wins, avgWrong: wrongSum };
}

module.exports = { simulate, play, fits };

if (require.main === module) {
  console.log(`PAYOUT by wrong guesses made when solved: ${PAYOUT.join(', ')} (a 1,000-soul bet pays ${PAYOUT.map((_, w) => winnings(1000, w)).join(' / ')})`);
  for (const strategy of ['frequency', 'player', 'lazy', 'human', 'solver']) {
    const { rtp, winRate, avgWrong } = simulate(strategy);
    console.log(`${strategy.padEnd(10)} returns ${(rtp * 100).toFixed(1)}%  wins ${(winRate * 100).toFixed(1)}%  wrong guesses ${avgWrong.toFixed(2)} on average`);
  }
}
