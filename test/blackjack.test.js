// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { changeSouls, getUser } = require('../src/utils/xp');
const bj = require('../src/utils/blackjack');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// A deck that deals `order` first (cards are drawn from the end). Deal order: you, Wraith, you, Wraith.
const stack = (...order) => [...'2C 3C 4C 5C 6C 7C 2D 3D 4D'.split(' '), ...order.reverse()];

test('scoring', () => {
  assert.strictEqual(bj.score(['AS', 'KH']), 21);
  assert.strictEqual(bj.score(['AS', 'AH', '9C']), 21);
  assert.strictEqual(bj.score(['KS', 'QS', '5H']), 25);
  assert.strictEqual(bj.score(['10S', 'JK']), 10);
  const deck = bj.newDeck();
  assert.strictEqual(deck.length, 53);
  assert.strictEqual(new Set(deck).size, 53);
});

test('the deal: blackjack, Joker for either side, Wraith blackjack', () => {
  let g = bj.deal(stack('AS', '9H', 'KD', '7C'), 100);
  assert.strictEqual(g.hands[0].result, 'blackjack');
  assert.strictEqual(bj.payout(g.hands[0]), 250);

  g = bj.deal(stack('5S', '9H', 'JK', '7C'), 100);
  assert.strictEqual(g.hands[0].result, 'joker');
  assert.strictEqual(bj.payout(g.hands[0]), 200);

  g = bj.deal(stack('AS', 'JK', 'KD', '7C'), 100); // Wraith's Joker beats even a blackjack
  assert.ok(g.done && g.dealerJoker);
  assert.strictEqual(bj.payout(g.hands[0]), 0);

  g = bj.deal(stack('9S', 'AH', '9D', 'KC'), 100);
  assert.strictEqual(g.hands[0].result, 'lose');
  g = bj.deal(stack('AS', 'AH', 'KD', 'KC'), 100);
  assert.strictEqual(g.hands[0].result, 'push');
});

test('hit, stand, bust, and Wraith draws to 17', () => {
  let g = bj.deal(stack('10S', '9H', '4D', '7C', 'KH'), 100); // you 14, Wraith 16
  assert.deepStrictEqual(bj.moves(g), ['hit', 'stand', 'double']);
  g = bj.play(g, 'hit'); // K -> 24
  assert.strictEqual(g.hands[0].result, 'bust');
  assert.ok(g.done);
  assert.deepStrictEqual(g.dealer, ['9H', '7C']); // she doesn't draw when you've busted

  g = bj.deal(stack('10S', '9H', '9D', '7C', '5H'), 100); // you 19, Wraith 16 then draws 5 = 21
  g = bj.play(g, 'stand');
  assert.strictEqual(g.hands[0].result, 'lose');
  g = bj.deal(stack('10S', '9H', '9D', '7C', '8H'), 100); // Wraith 16 + 8 = 24
  assert.strictEqual(bj.play(g, 'stand').hands[0].result, 'win');
  g = bj.deal(stack('10S', 'KH', '7D', '7C'), 100); // 17 vs 17
  assert.strictEqual(bj.play(g, 'stand').hands[0].result, 'push');
  g = bj.deal(stack('10S', '9H', '9D', '7C', 'JK'), 100); // Wraith draws the Joker
  const done = bj.play(g, 'stand');
  assert.ok(done.dealerJoker);
  assert.strictEqual(done.hands[0].result, 'lose');
});

test('double down and split', () => {
  let g = bj.deal(stack('6S', '9H', '5D', '7C', '10H', 'KD'), 100); // you 11, double gets 10 -> 21
  g = bj.play(g, 'double');
  assert.strictEqual(g.hands[0].bet, 200);
  assert.strictEqual(g.hands[0].cards.length, 3);
  assert.ok(g.done); // one card only, then Wraith plays (16 + K = bust)
  assert.strictEqual(bj.payout(g.hands[0]), 400);

  g = bj.deal(stack('8S', '9H', '8D', '7C', '3H', 'KC'), 100);
  assert.ok(bj.moves(g).includes('split'));
  g = bj.play(g, 'split'); // hand 1: 8 3, hand 2: 8 K
  assert.strictEqual(g.hands.length, 2);
  assert.deepStrictEqual(g.hands.map((h) => h.cards), [['8S', '3H'], ['8D', 'KC']]);
  assert.strictEqual(g.active, 0);
  assert.ok(!bj.moves(g).includes('split')); // only one split

  g = bj.deal(stack('AS', '9H', 'AD', '7C', '5H', '6C'), 100);
  g = bj.play(g, 'split'); // split aces: one card each, then done
  assert.ok(g.hands.every((h) => h.cards.length === 2 && h.done));
  assert.ok(g.done);
});

test('a full game with souls: bets, double, double clicks, only the owner plays', async () => {
  const user = { id: 'test-bj' };
  await getStore('xp').delete(user.id);
  assert.ok((await bj.startGame(user, 'Tester', 5)).error);
  assert.ok((await bj.startGame(user, 'Tester', 100)).error);
  await changeSouls(user.id, 1000);

  const start = await bj.startGame(user, 'Tester', 100, stack('6S', '9H', '5D', '7C', '10H', 'KD'));
  assert.strictEqual((await getUser(user.id)).souls, 900);
  assert.strictEqual(start.embeds[0].toJSON().author.icon_url, 'attachment://card_trick.png');
  const id = start.components[0].components[0].data.custom_id.split(':')[1];

  assert.ok((await bj.move(id, 'someone-else', 'hit')).error);
  // two Double Down clicks at once: only one counts, the other's extra bet comes back
  const [a, b] = await Promise.all([bj.move(id, user.id, 'double'), bj.move(id, user.id, 'double')]);
  const result = a ?? b;
  assert.ok(result && !(a && b));
  const embed = result.embeds[0].toJSON();
  assert.strictEqual(embed.thumbnail.url, 'attachment://wraith_injured.png'); // you won, she's hurt
  assert.ok(bj.WIN_LINES.includes(embed.footer.text.slice(1, -1)));
  assert.strictEqual((await getUser(user.id)).souls, 900 - 100 + 400); // doubled to 200, 21 beats her bust, paid 400
  assert.strictEqual(await bj.games().get(id), null);
});

test('table images render', async () => {
  const states = [
    bj.deal(stack('10S', 'KH', '4D', '7C'), 100),
    bj.play(bj.deal(stack('8S', '9H', '8D', '7C', '3H', 'KC'), 100), 'split'),
    bj.deal(stack('5S', '9H', 'JK', '7C'), 100),
  ];
  for (const s of states) assert.ok((await bj.renderTable(s, 'Tester')).subarray(0, 4).equals(PNG));
});
