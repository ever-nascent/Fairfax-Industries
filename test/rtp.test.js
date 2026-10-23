// Run: node --test. What each betting game gives back in the long run (his call, Oct 5: about 95% everywhere), so a
// change to a payout or a rule can't quietly move the odds. Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const doorman = require('../src/utils/doorman');
const sinclair = require('../src/utils/sinclair');
const yamato = require('../src/utils/yamato');
const bebop = require('../src/utils/bebop');
const paradox = require('../src/utils/paradox');
const rem = require('../src/utils/rem');
const bj = require('../src/utils/blackjack');
const silver = require('../src/utils/silver');

const BET = 100_000; // big, so rounding a prize down to whole souls doesn't show
const near = (value, target, slack, what) => assert.ok(Math.abs(value - target) <= slack, `${what}: ${value.toFixed(4)} is not within ${slack} of ${target}`);

test('fixed payouts return 95%: the Door (always switching), the Hat, a duel against Yamato', () => {
  near((doorman.winnings(BET) / BET) * (2 / 3), 0.95, 0.001, 'Guess the Door');
  near(sinclair.winnings(BET) / BET / 3, 0.95, 0.001, 'Rabbit in the Hat');
  near((yamato.winnings(BET) / BET + 1) / 3, 0.95, 0.001, 'Duel of Stances'); // win, tie (bet back), lose
});

test("Bebop's Bombs returns 95% however many tiles are cleared", () => {
  let survive = 1;
  for (let safe = 1; safe <= 16; safe++) {
    survive *= (16 - (safe - 1)) / (20 - (safe - 1)); // 16 safe tiles of 20
    near(bebop.multiplier(safe) * survive, 0.95, 0.01, `${safe} tiles`);
  }
});

test('Remling Race: every lane returns 95%', () => {
  for (const share of rem.SHARES) near((rem.prizeFor(BET, rem.oddsFor(share)) / BET) * (share / 100), 0.95, 0.01, `lane with a ${share}% chance`);
});

test('Borrowed Time returns 95% however many calls are made (the cut is taken once)', () => {
  const run = (calls, games = 60_000) => {
    let back = 0;
    for (let i = 0; i < games; i++) {
      let g = { bet: BET, prize: BET, hour: 1 + Math.floor(Math.random() * 12), history: [], done: false, lost: false, version: 0 };
      for (let made = 0; !g.done; ) {
        const moves = paradox.moves(g);
        if (made >= calls && moves.includes('cash')) g = paradox.play(g, 'cash');
        else if (moves.includes('spin')) g = paradox.play(g, 'spin');
        else {
          g = paradox.play(g, g.hour <= 6 ? 'higher' : 'lower');
          made++;
        }
      }
      back += g.lost ? 0 : g.prize;
    }
    return back / games / BET;
  };
  near(run(1), 0.95, 0.02, 'one call');
  near(run(4), 0.95, 0.04, 'four calls');
});

test('Blackjack with basic strategy returns a little under 100%, never more', () => {
  const value = (card) => bj.score([card]);
  const basic = (game) => {
    const hand = game.hands[game.active];
    const up = value(game.dealer[0]);
    const total = bj.score(hand.cards);
    const moves = bj.moves(game);
    const hard = hand.cards.reduce((sum, c) => sum + (c[0] === 'A' ? 1 : value(c)), 0);
    const soft = hard !== total;
    if (moves.includes('split') && ['A', '8'].includes(hand.cards[0].slice(0, -1))) return 'split';
    if (moves.includes('double') && !soft && (total === 11 || (total === 10 && up < 10) || (total === 9 && up >= 3 && up <= 6))) return 'double';
    if (soft) return total >= 19 || (total === 18 && up <= 8) ? 'stand' : 'hit';
    if (total >= 17) return 'stand';
    if (total >= 13) return up <= 6 ? 'stand' : 'hit';
    if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
    return 'hit';
  };
  let staked = 0;
  let back = 0;
  for (let i = 0; i < 60_000; i++) {
    let game = bj.deal(bj.newDeck(), 100);
    while (!game.done) game = bj.play(game, basic(game));
    staked += game.hands.reduce((sum, h) => sum + h.bet, 0);
    back += game.hands.reduce((sum, h) => sum + bj.payout(h), 0);
  }
  assert.ok(back / staked > 0.96 && back / staked < 1.005, `Blackjack returned ${(back / staked).toFixed(4)}`);
});

test("Shotgun Roulette against Silver: playing by her own item rules (the best plan found) stays under 100%", () => {
  const run = (strategy, games = 40_000) => {
    let wins = 0;
    for (let i = 0; i < games; i++) {
      const players = ['p', silver.SILVER];
      let g = { players, charges: { p: silver.CHARGES, [silver.SILVER]: silver.CHARGES }, shells: silver.loadShells(), turn: 'p', winner: null, log: [], items: silver.deal({ players }), known: {} };
      while (!g.winner) {
        const d = strategy(g);
        g = d.item ? { ...silver.useItem(g, d.item).game, acted: true } : silver.play(g, d.shoot);
      }
      if (g.winner === 'p') wins++;
    }
    return (wins / games) * (silver.winnings(BET) / BET);
  };
  const best = run((g) => silver.decide(g, 'p'));
  const noItems = run((g) => ({ shoot: silver.liveChance(g, 'p') === 0 })); // only shoot yourself on a sure blank
  assert.ok(best < 1.01, `her own rules returned ${best.toFixed(4)}`);
  assert.ok(noItems < best, 'ignoring the items should do worse');
});
