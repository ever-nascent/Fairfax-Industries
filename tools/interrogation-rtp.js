// What Abrams' Interrogation (solo) gives back, by how well the player plays. Run: node tools/interrogation-rtp.js [games]
// Run it after changing PAYOUT / HAND / MAX_QUESTIONS in src/utils/abrams.js, or any question or answer in abramsCase.js.
// Never touches data/ (a temp DATA_DIR).
//   strong   asks the hand's question with the best expected payout and accuses the moment accusing is worth more
//            than asking on (the plan the payouts are set for: about 95%)
//   greedy   always asks the question that splits the suspects most evenly, accuses when one is left or out of questions
//   random   asks a random question from the hand, accuses when one is left or out of questions
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-rtp-'));
const { answer } = require('../src/utils/abramsCase');
const { PAYOUT, HAND, MAX_QUESTIONS, NAMES, useful } = require('../src/utils/abrams');

const GAMES = Number(process.argv[2]) || 6000;
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const rng = seeded(424242);
const int = (n) => Math.floor(rng() * n);
const sample = (list, n) => { const a = [...list]; const out = []; while (out.length < n && a.length) out.push(a.splice(int(a.length), 1)[0]); return out; };
const split = (S, q) => { const y = S.filter((h) => answer(h, q)); return [y, S.filter((h) => !answer(h, q))]; };

// The strong player's value of a position: the best of accusing now and asking on, a hand sampled a few times.
const memo = new Map();
function value(S, asked) {
  const key = `${asked}|${S.join(',')}`;
  if (memo.has(key)) return memo.get(key);
  let best = PAYOUT[asked] / S.length;
  const U = asked < MAX_QUESTIONS && S.length > 1 ? useful(S) : [];
  if (U.length) {
    let total = 0;
    for (let i = 0; i < 6; i++) total += Math.max(...sample(U, HAND).map((q) => askValue(S, q, asked)));
    best = Math.max(best, total / 6);
  }
  memo.set(key, best);
  return best;
}
const askValue = (S, q, asked) => split(S, q).filter((p) => p.length).reduce((sum, p) => sum + (p.length / S.length) * value(p, asked + 1), 0);

const plans = {
  strong: (S, hand, asked) => {
    const q = hand.reduce((a, b) => (askValue(S, b, asked) > askValue(S, a, asked) ? b : a));
    return PAYOUT[asked] / S.length >= askValue(S, q, asked) ? null : q;
  },
  greedy: (S, hand) => hand.reduce((a, b) => (Math.abs(split(S, b)[0].length - S.length / 2) < Math.abs(split(S, a)[0].length - S.length / 2) ? b : a)),
  random: (S, hand) => hand[int(hand.length)],
};

for (const [name, plan] of Object.entries(plans)) {
  let back = 0;
  let wins = 0;
  let questions = 0;
  for (let i = 0; i < GAMES; i++) {
    const culprit = NAMES[int(NAMES.length)];
    let S = [...NAMES];
    let asked = 0;
    for (;;) {
      const U = asked < MAX_QUESTIONS && S.length > 1 ? useful(S) : [];
      if (!U.length) break;
      const q = plan(S, sample(U, HAND), asked);
      if (q === null) break;
      S = split(S, q).find((p) => p.includes(culprit));
      asked++;
    }
    questions += asked;
    if (S[int(S.length)] === culprit) {
      back += PAYOUT[asked];
      wins++;
    }
  }
  console.log(`${name.padEnd(7)} returns ${(back / GAMES * 100).toFixed(1)}%, wins ${(wins / GAMES * 100).toFixed(0)}% of cases, asks ${(questions / GAMES).toFixed(1)} questions`);
}
