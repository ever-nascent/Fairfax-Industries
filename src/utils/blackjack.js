// /blackjack, Wraith's Table: blackjack against Wraith with her Card Trick deck. Hit, Stand, Double Down,
// Split. One Joker in the deck: whoever draws it wins the hand outright. Rules: server-plan.md ("Games").
const crypto = require('node:crypto');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getStore } = require('../storage');
const { changeSouls } = require('./xp');
const { fmt, soulsIcon, soulsText, boldSouls } = require('./format');
const { pickRandom, shortId } = require('./random');
const { ASSETS, loadSouls, seeded, halftone, grain, grainAndVignette } = require('./art');
const { takeBet, resultFields, playAgainButton, gameMessage, timeoutMessage } = require('./casino');

const ART = path.join(ASSETS, 'wraith'); // deadlock.wiki, see assets/CREDITS.txt
const HOST = { color: 0xc2408f, name: "Wraith's Table", icon: path.join(ART, 'card_trick.png'), art: ART, prefix: 'wraith' }; // magenta; Card Trick

const BUTTON_ID = 'bj'; // custom id: bj:<game id>:<hit|stand|double|split>
const AGAIN_ID = 'bj_again'; // custom id: bj_again:<bet>:<player id>

// Wraith's lines when the hand ends: original lines written in her voice (deadlock.wiki "Wraith/Voice lines":
// a cocky New York racketeer who talks in bets, ledgers and markers). One random line goes in the footer.
const WIN_LINES = [
  "Enjoy it. Luck like that doesn't last at my table.",
  "Huh. You actually beat me. I'm writing that one in the ledger.",
  "Take your Souls. You'll be back, and I'll be waiting.",
  'Fine, fine. Consider it an investment in your next loss.',
];
const LOSE_LINES = [
  'Never stood a chance. Pleasure doing business.',
  "Don't feel bad. Everybody loses to me eventually.",
  "Your Souls, my ledger. That's how this works.",
  'Thanks for the donation. My operation appreciates it.',
];
// While the hand is being played.
const PLAY_LINES = [
  "House rules, pal: the house don't lose.",
  "Go on, hit me with your best shot. Or don't.",
  "Cards are dealt. Let's see what you're made of.",
  "Take your time. I'm charging interest.",
];
const PUSH_LINES = ["A push. Don't get used to it.", "Even. We'll settle it next hand."];
// When a game is called off for taking too long (she gloats).
const TIMEOUT_LINES = [
  "Clock ran out, pal. I don't hold a seat for nobody.",
  "Table's closed. Take your chips and scram.",
  'You snooze, you lose the seat. Next!',
  "Time's money, and you're wasting both of mine.",
];

// Games in progress, saved so a bot restart doesn't eat anyone's bet. key: game id
const games = () => getStore('blackjackGames');

// ---- cards and rules ---------------------------------------------------------------------------
// A card is a string: rank + suit letter ('10H', 'AS'), or 'JK' for the Joker.

const SUITS = { H: 'heart', S: 'spade', C: 'club', D: 'diamond' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rankOf = (card) => card.slice(0, -1);
const RANK_NAMES = { A: 'an Ace', J: 'a Jack', Q: 'a Queen', K: 'a King', 8: 'an 8' };
const cardName = (card) => (card === 'JK' ? 'the Joker' : RANK_NAMES[rankOf(card)] ?? `a ${rankOf(card)}`);

function newDeck(randomInt = crypto.randomInt) {
  const deck = ['JK'];
  for (const s of Object.keys(SUITS)) for (const r of RANKS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Best total (aces count 11 unless that busts). The Joker never counts: drawing it ends the hand.
function score(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card === 'JK') continue;
    const r = rankOf(card);
    if (r === 'A') aces++;
    total += r === 'A' ? 11 : ['J', 'Q', 'K'].includes(r) ? 10 : Number(r);
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}
const isBlackjack = (cards) => cards.length === 2 && !cards.includes('JK') && score(cards) === 21;

// What a hand pays back (bet included). result: win | joker | blackjack | push | lose | bust
function payout(hand) {
  if (hand.result === 'win' || hand.result === 'joker') return hand.bet * 2;
  if (hand.result === 'blackjack') return hand.bet + Math.floor(hand.bet * 1.5);
  if (hand.result === 'push') return hand.bet;
  return 0;
}

// Player draws: the Joker wins the hand, over 21 busts, 21 stands.
function drawTo(game, hand) {
  const card = game.deck.pop();
  hand.cards.push(card);
  if (card === 'JK') Object.assign(hand, { result: 'joker', done: true });
  else if (score(hand.cards) > 21) Object.assign(hand, { result: 'bust', done: true });
  else if (score(hand.cards) === 21) hand.done = true;
}

// Deals a new game: player, Wraith, player, Wraith (her second card face down).
function deal(deck, bet) {
  const game = { deck, dealer: [], hands: [{ cards: [], bet, done: false, result: null }], active: 0, reveal: false, dealerJoker: false, done: false, version: 0 };
  const hand = game.hands[0];
  for (let i = 0; i < 2; i++) {
    hand.cards.push(game.deck.pop());
    game.dealer.push(game.deck.pop());
  }
  if (game.dealer.includes('JK')) return settle(game, { dealerJoker: true });
  if (hand.cards.includes('JK')) {
    hand.result = 'joker';
    return settle(game);
  }
  if (isBlackjack(game.dealer)) {
    hand.result = isBlackjack(hand.cards) ? 'push' : 'lose';
    return settle(game);
  }
  if (isBlackjack(hand.cards)) {
    hand.result = 'blackjack';
    return settle(game);
  }
  return game;
}

function settle(game, { dealerJoker = false } = {}) {
  game.reveal = true;
  game.done = true;
  game.dealerJoker = dealerJoker;
  for (const hand of game.hands) {
    hand.done = true;
    if (dealerJoker && !hand.result) hand.result = 'lose';
  }
  return game;
}

// Which moves the hand in play allows.
function moves(game) {
  if (game.done) return [];
  const hand = game.hands[game.active];
  const list = ['hit', 'stand'];
  if (hand.cards.length === 2) list.push('double');
  if (game.hands.length === 1 && hand.cards.length === 2 && rankOf(hand.cards[0]) === rankOf(hand.cards[1])) list.push('split');
  return list;
}
// Extra souls a move takes (Double Down and Split put up another bet).
const extraCost = (game, move) => (move === 'double' || move === 'split' ? game.hands[game.active].bet : 0);

// Applies a move to a copy of the game and returns it (Wraith plays out her hand when yours are done).
function play(state, move) {
  const game = structuredClone(state);
  const hand = game.hands[game.active];
  if (move === 'hit') drawTo(game, hand);
  if (move === 'stand') hand.done = true;
  if (move === 'double') {
    hand.bet *= 2;
    drawTo(game, hand);
    hand.done = true;
  }
  if (move === 'split') {
    const second = { cards: [hand.cards.pop()], bet: hand.bet, done: false, result: null };
    game.hands.push(second);
    const aces = rankOf(second.cards[0]) === 'A';
    for (const h of game.hands) {
      drawTo(game, h);
      if (aces) h.done = true; // split aces get one card each
    }
  }
  while (game.active < game.hands.length && game.hands[game.active].done) game.active++;
  if (game.active >= game.hands.length) dealerPlays(game);
  game.version++;
  return game;
}

// Wraith reveals and draws to 17 (only if one of your hands is still standing), then every hand is scored.
function dealerPlays(game) {
  const live = game.hands.filter((h) => !h.result);
  let dealerJoker = false;
  if (live.length) {
    while (score(game.dealer) < 17) {
      const card = game.deck.pop();
      game.dealer.push(card);
      if (card === 'JK') {
        dealerJoker = true;
        break;
      }
    }
  }
  const d = score(game.dealer);
  for (const hand of live) {
    const p = score(hand.cards);
    hand.result = dealerJoker ? 'lose' : d > 21 || p > d ? 'win' : p === d ? 'push' : 'lose';
  }
  settle(game, { dealerJoker });
}

// ---- image -------------------------------------------------------------------------------------

const W = 600, H = 380;
const CW = 76, CH = Math.round(76 * (353 / 236));
const GOLD = '#e0b560', PINK = '#e04aa0', LAV = '#cfa9e6', INK = '#2a1638';
const GREEN = '#7cffc4', RED = '#ff7a7a';
const SUIT_COLOR = { heart: '#dd0000', spade: INK, club: '#006eb2', diamond: '#c46000' };

// Card art, the gold spade and her four suits as cut-outs, the table background: all made once.
let art;
async function loadArt() {
  if (art) return art;
  const faces = {};
  for (const s of ['heart', 'spade', 'club', 'diamond', 'joker']) faces[s] = await loadImage(path.join(ART, `card_${s}.png`));
  const souls = await loadSouls();

  // A suit cut out of its card: keep the non-lavender pixels in the middle of the card.
  const cutout = (src, recolor) => {
    const c = createCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const lavender = Math.abs(d.data[i] - 207) + Math.abs(d.data[i + 1] - 169) + Math.abs(d.data[i + 2] - 230) < 90;
      if (lavender) d.data[i + 3] = 0;
      else if (recolor) [d.data[i], d.data[i + 1], d.data[i + 2]] = recolor;
    }
    g.putImageData(d, 0, 0);
    const out = createCanvas(170, 170);
    out.getContext('2d').drawImage(c, 33, 85, 170, 170, 0, 0, 170, 170);
    return out;
  };
  const suits = Object.fromEntries(['heart', 'spade', 'club', 'diamond'].map((s) => [s, cutout(faces[s])]));
  const goldSpade = cutout(faces.spade, [224, 181, 96]);

  // Face-down card: dark plum like the cards she holds, lavender frame, gold spade.
  const back = createCanvas(236, 353);
  const b = back.getContext('2d');
  b.fillStyle = '#231a2c';
  b.beginPath();
  b.roundRect(0, 0, 236, 353, 14);
  b.fill();
  b.strokeStyle = LAV;
  b.lineWidth = 6;
  b.beginPath();
  b.roundRect(8, 8, 220, 337, 10);
  b.stroke();
  b.strokeStyle = 'rgba(224,74,160,0.18)';
  b.lineWidth = 1.5;
  for (let k = -353; k < 236; k += 18) {
    b.beginPath();
    b.moveTo(22 + k, 22);
    b.lineTo(22 + k + 309, 331);
    b.stroke();
    b.beginPath();
    b.moveTo(214 - k, 22);
    b.lineTo(214 - k - 309, 331);
    b.stroke();
  }
  b.drawImage(goldSpade, 38, 96, 160, 160);

  art = { faces, souls, suits, goldSpade, back };
  art.table = drawTable();
  art.grain = grain(W, H, 11, 50);
  return art;
}

// Plum felt with a Deadlock ritual circle, her suits along the arc, the rules, a gold art-deco frame.
function drawTable() {
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const rnd = seeded(3);
  const felt = g.createRadialGradient(W / 2, H * 0.5, 30, W / 2, H * 0.5, 420);
  felt.addColorStop(0, '#4d2656');
  felt.addColorStop(0.6, '#2c1432');
  felt.addColorStop(1, '#12081a');
  g.fillStyle = felt;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`;
    g.fillRect(rnd() * W, rnd() * H, 1, 1);
  }

  const ox = W / 2, oy = 196;
  g.strokeStyle = 'rgba(224,181,96,0.22)';
  g.lineWidth = 1.5;
  for (const r of [150, 132, 70]) {
    g.beginPath();
    g.arc(ox, oy, r, 0, 7);
    g.stroke();
  }
  const star = [...Array(7)].map((_, k) => [ox + 132 * Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / 7), oy + 132 * Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / 7)]);
  g.beginPath();
  star.forEach((_, k) => {
    const [px, py] = star[(k * 3) % 7];
    if (k) g.lineTo(px, py);
    else g.moveTo(px, py);
  });
  g.closePath();
  g.stroke();
  g.fillStyle = 'rgba(224,181,96,0.35)';
  for (const [px, py] of star) {
    g.beginPath();
    g.arc(px, py, 3.5, 0, 7);
    g.fill();
  }
  g.globalAlpha = 0.18;
  g.drawImage(art.goldSpade, ox - 60, oy - 60, 120, 120);
  g.globalAlpha = 1;

  g.strokeStyle = 'rgba(224,181,96,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(W / 2, -330, 520, 0.23 * Math.PI, 0.77 * Math.PI);
  g.stroke();
  g.strokeStyle = 'rgba(224,74,160,0.6)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(W / 2, -330, 529, 0.23 * Math.PI, 0.77 * Math.PI);
  g.stroke();
  ['heart', 'spade', 'club', 'diamond'].forEach((suit, k) => {
    const a = 0.5 * Math.PI + (k < 2 ? 1 : -1) * (k % 2 ? 0.1 : 0.15) * Math.PI;
    g.globalAlpha = 0.9;
    g.drawImage(art.suits[suit], W / 2 + 545 * Math.cos(a) - 10, -330 + 545 * Math.sin(a) - 10, 20, 20);
    g.globalAlpha = 1;
  });
  g.textAlign = 'center';
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 4;
  g.fillStyle = GOLD;
  g.font = '17px Retail';
  g.fillText('BLACKJACK PAYS 3 TO 2', W / 2, 186);
  g.fillStyle = LAV;
  g.font = '13px Retail';
  g.textAlign = 'right';
  g.fillText('DEALER STANDS ON 17', W / 2 - 10, 204);
  g.textAlign = 'left';
  g.fillText('JOKER WINS', W / 2 + 10, 204);
  g.shadowBlur = 0;
  g.fillStyle = GOLD;
  g.beginPath();
  g.moveTo(W / 2, 195);
  g.lineTo(W / 2 + 4, 199);
  g.lineTo(W / 2, 203);
  g.lineTo(W / 2 - 4, 199);
  g.fill();

  g.strokeStyle = GOLD;
  g.lineWidth = 2;
  g.strokeRect(7, 7, W - 14, H - 14);
  g.strokeStyle = 'rgba(224,181,96,0.45)';
  g.lineWidth = 1;
  g.strokeRect(13, 13, W - 26, H - 26);
  for (const [cx, cy, a0] of [[7, 7, 0], [W - 7, 7, 0.5], [W - 7, H - 7, 1], [7, H - 7, 1.5]]) {
    g.strokeStyle = GOLD;
    g.lineWidth = 1.5;
    for (const r of [10, 16, 22]) {
      g.beginPath();
      g.arc(cx, cy, r, a0 * Math.PI, (a0 + 0.5) * Math.PI);
      g.stroke();
    }
  }
  halftone(g, 14, 14, W - 28, H - 28, 7, (u, v) => Math.max(0, Math.abs(u - 0.5) * 1.3 - 0.4 + Math.abs(v - 0.5) * 0.5), 'rgba(5,2,8,0.5)');
  return c;
}

// One card, face up (with Card Trick's white-lavender glow) or face down.
function drawCard(g, x, y, card, tilt) {
  g.save();
  g.translate(x + CW / 2, y + CH / 2);
  g.rotate(tilt);
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 5;
  g.fillStyle = '#000';
  g.beginPath();
  g.roundRect(-CW / 2 + 2, -CH / 2 + 2, CW - 4, CH - 4, 6);
  g.fill();
  g.shadowOffsetY = 0;
  if (!card) {
    g.shadowBlur = 0;
    g.drawImage(art.back, -CW / 2, -CH / 2, CW, CH);
  } else {
    g.shadowColor = 'rgba(236,214,255,0.95)';
    g.shadowBlur = 20;
    g.fillStyle = '#e8d6f6';
    g.beginPath();
    g.roundRect(-CW / 2 + 1, -CH / 2 + 1, CW - 2, CH - 2, 6);
    g.fill();
    g.shadowBlur = 0;
    const suit = card === 'JK' ? 'joker' : SUITS[card.slice(-1)];
    g.drawImage(art.faces[suit], -CW / 2, -CH / 2, CW, CH);
    if (card !== 'JK') {
      g.fillStyle = SUIT_COLOR[suit];
      g.font = 'bold 15px Georgia, serif';
      g.textAlign = 'center';
      g.fillText(rankOf(card), -CW / 2 + 13, -CH / 2 + 22);
      g.rotate(Math.PI);
      g.fillText(rankOf(card), -CW / 2 + 13, -CH / 2 + 22);
    }
  }
  g.restore();
}

function drawHand(g, cards, cx, y, maxWidth) {
  const step = cards.length > 1 ? Math.min(58, (maxWidth - CW) / (cards.length - 1)) : 0;
  const width = CW + step * (cards.length - 1);
  cards.forEach((c, i) => drawCard(g, cx - width / 2 + i * step, y, c, (i - (cards.length - 1) / 2) * 0.05));
}

function pill(g, cx, y, text, color) {
  g.font = '24px Retail';
  const w = Math.max(g.measureText(text).width + 30, 52);
  g.fillStyle = 'rgba(10,6,14,0.92)';
  g.beginPath();
  g.roundRect(cx - w / 2, y - 18, w, 34, 17);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 2.5;
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.fillText(text, cx, y + 8);
}

function plate(g, cx, y, text, color) {
  g.font = '19px Retail';
  const w = g.measureText(text).width + 28;
  g.fillStyle = 'rgba(10,6,14,0.85)';
  g.beginPath();
  g.roundRect(cx - w / 2, y - 16, w, 30, 4);
  g.fill();
  g.strokeStyle = 'rgba(224,181,96,0.8)';
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.fillText(text, cx, y + 6);
}

// The bet: a stack of magenta chips, the top one stamped with the souls icon.
function chips(g, cx, y, bet) {
  for (let k = 0; k < 4; k++) {
    const cy = y - k * 6;
    g.fillStyle = '#5a0f3a';
    g.beginPath();
    g.ellipse(cx, cy + 3, 24, 10, 0, 0, 7);
    g.fill();
    g.fillStyle = k % 2 ? '#b8307e' : '#d94a9c';
    g.beginPath();
    g.ellipse(cx, cy, 24, 10, 0, 0, 7);
    g.fill();
    g.strokeStyle = GOLD;
    g.lineWidth = 1.2;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.ellipse(cx, cy, 19, 7, 0, 0, 7);
    g.stroke();
    g.setLineDash([]);
  }
  g.drawImage(art.souls, cx - 5, y - 26, 10, 17);
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 4;
  g.fillStyle = GREEN;
  g.font = '16px Retail';
  g.textAlign = 'center';
  g.fillText(fmt(bet), cx + 46, y + 2);
  g.shadowBlur = 0;
}

// The label and colour of a hand's total pill.
function handPill(hand, playing) {
  const total = score(hand.cards);
  const text = { joker: 'JOKER', blackjack: 'BLACKJACK', bust: `BUST ${total}` }[hand.result] ?? String(total);
  if (!hand.result) return [text, GOLD];
  if (playing) return [text, GOLD];
  return [text, { win: GREEN, joker: GREEN, blackjack: GREEN, push: LAV }[hand.result] ?? RED];
}

function dealerPill(game) {
  if (!game.reveal) return String(score([game.dealer[0]]));
  if (game.dealerJoker) return 'JOKER';
  if (isBlackjack(game.dealer)) return 'BLACKJACK';
  const d = score(game.dealer);
  return d > 21 ? `BUST ${d}` : String(d);
}

async function renderTable(game, name) {
  await loadArt();
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(art.table, 0, 0);

  drawHand(g, game.reveal ? game.dealer : [game.dealer[0], null], W / 2, 30, 300);
  plate(g, 100, 84, 'WRAITH', LAV);
  pill(g, W - 100, 84, dealerPill(game), LAV);

  const player = name.toUpperCase().slice(0, 14);
  const staked = game.hands.reduce((sum, h) => sum + h.bet, 0);
  if (game.hands.length === 1) {
    drawHand(g, game.hands[0].cards, W / 2, 212, 280);
    pill(g, W - 100, 262, ...handPill(game.hands[0], !game.done));
    plate(g, 100, 262, player, GOLD);
    chips(g, W - 100, 330, staked);
  } else {
    game.hands.forEach((hand, i) => {
      const cx = i ? W * 0.72 : W * 0.28;
      drawHand(g, hand.cards, cx, 212, 150);
      pill(g, i ? W - 52 : 52, 262, ...handPill(hand, !game.done));
      if (!game.done && i === game.active) {
        g.fillStyle = GOLD;
        g.fillRect(cx - 50, 212 + CH + 8, 100, 3);
      }
    });
    plate(g, W / 2, 262, player, GOLD);
    chips(g, W / 2, 348, staked);
  }

  grainAndVignette(g, W, H, art.grain, { grainAlpha: 0.5, inner: 160, outer: 400, dark: 0.55 });
  return c.toBuffer('image/png');
}

// ---- messages ----------------------------------------------------------------------------------

const MOVE_LABELS = { hit: 'Hit', stand: 'Stand', double: 'Double Down', split: 'Split' };
const HAND_TEXT = {
  win: (p) => `You win with ${p}`,
  joker: () => 'You drew the Joker',
  blackjack: () => 'Blackjack',
  push: (p) => `Push at ${p}`,
  lose: (p) => `Wraith beats your ${p}`,
  bust: (p) => `Bust with ${p}`,
};

// The game is Wraith's, not the Shopkeeper's.
async function view(id, game, name) {
  const file = `table_${id}_${game.version}_${Date.now()}.png`; // new name each step so Discord doesn't reuse the old image
  const staked = game.hands.reduce((sum, h) => sum + h.bet, 0);
  const paid = game.hands.reduce((sum, h) => sum + payout(h), 0);
  const net = paid - staked;
  // her face once the hand is over: she gloats when you lose, she's hurt when you win
  const mood = !game.done || net === 0 ? 'portrait' : net > 0 ? 'injured' : 'gloat';
  const lines = [];
  let buttons;
  let footer = null;
  let fields = null;

  if (!game.done) {
    const hand = game.hands[game.active];
    const shows = `Wraith shows ${cardName(game.dealer[0])}.`;
    lines.push(`${name} is playing for ${boldSouls(staked)}.`);
    lines.push(
      game.hands.length > 1
        ? `**Hand ${game.active + 1} of 2: you have ${score(hand.cards)}. ${shows}**`
        : `**You have ${score(hand.cards)}. ${shows}**`,
    );
    buttons = moves(game).map((m) => {
      const cost = extraCost(game, m);
      const label = cost ? `${MOVE_LABELS[m]} (${fmt(cost)})` : MOVE_LABELS[m];
      return [`${BUTTON_ID}:${id}:${m}`, label, m === 'hit' ? ButtonStyle.Primary : ButtonStyle.Secondary];
    });
    footer = `"${pickRandom(PLAY_LINES)}"`;
  } else {
    if (game.dealerJoker) lines.push('Wraith drew the Joker!');
    else if (game.hands.some((h) => ['win', 'push', 'lose'].includes(h.result))) {
      const d = score(game.dealer);
      lines.push(isBlackjack(game.dealer) ? 'Wraith has blackjack.' : d > 21 ? `Wraith busts with ${d}.` : `Wraith has ${d}.`);
    }
    const handLines = game.hands.map((h) => HAND_TEXT[h.result](score(h.cards)));
    lines.push(game.hands.length > 1 ? handLines.map((t, i) => `Hand ${i + 1}: ${t}`).join('  ·  ') : `${handLines[0]}.`);
    lines.push(
      net > 0
        ? `**You win ${soulsText(paid)}.**`
        : net < 0
          ? `**You lose ${soulsText(staked - paid)}.**`
          : '**Your bet comes back.**',
    );
    footer = `"${pickRandom(net > 0 ? WIN_LINES : net < 0 ? LOSE_LINES : PUSH_LINES)}"`;
    fields = resultFields(staked, paid, game.balance);
    buttons = [playAgainButton(AGAIN_ID, game.startBet, game.userId)];
  }

  const image = { name: file, data: await renderTable(game, name) };
  return gameMessage(HOST, { lines, image, buttons, fields, footer, mood });
}

// Pays out a finished game, forgets it, and returns the result message.
async function finish(id, game, userId) {
  const paid = game.hands.reduce((sum, h) => sum + payout(h), 0);
  const user = await changeSouls(userId, paid);
  await games().delete(id);
  return view(id, { ...game, balance: user.souls }, game.name);
}

// Takes the bet and deals. Returns a message payload, or { error } if they can't play.
async function startGame(user, name, bet, deck = newDeck()) {
  const error = await takeBet(user.id, bet);
  if (error) return { error };
  const id = shortId();
  const game = { ...deal(deck, bet), userId: user.id, name, startBet: bet, at: Date.now() };
  if (game.done) return finish(id, game, user.id);
  await games().set(id, game);
  return view(id, game, name);
}

// A button press. Returns a message payload, { error } (shown only to the clicker), or null (stale click).
async function move(id, userId, action) {
  const current = await games().get(id);
  if (!current) return null;
  if (current.userId !== userId) return { error: `That's ${current.name}'s seat. Take your own with \`/mini-game\`.` };
  if (!moves(current).includes(action)) return null;
  const cost = extraCost(current, action);
  if (cost && !(await changeSouls(userId, -cost))) {
    return { error: `You need ${soulsIcon()}${fmt(cost)} more Souls to ${MOVE_LABELS[action].toLowerCase()}.` };
  }
  let next = null;
  await games().update(id, (game) => {
    if (!game || game.version !== current.version) return game; // someone clicked twice: only the first counts
    next = play(game, action);
    return next;
  });
  if (!next) {
    if (cost) await changeSouls(userId, cost); // the click didn't count, give the extra bet back
    return null;
  }
  if (next.done) return finish(id, next, userId);
  return view(id, next, next.name);
}

// Called off with no click for too long (casino.js expireGames): the table as it was, every bet back
// (Double Down and Split included).
const staked = (game) => game.hands.reduce((sum, h) => sum + h.bet, 0);
async function timeoutView(id, game, balance) {
  return timeoutMessage(HOST, {
    image: { name: `table_${id}_${Date.now()}.png`, data: await renderTable(game, game.name) },
    staked: staked(game), balance, againId: AGAIN_ID, bet: game.startBet, userId: game.userId,
    line: `"${pickRandom(TIMEOUT_LINES)}"`,
  });
}

module.exports = {
  games,
  staked,
  timeoutView,
  TIMEOUT_LINES,
  startGame,
  move,
  newDeck,
  deal,
  play,
  moves,
  score,
  payout,
  renderTable,
  WIN_LINES,
  LOSE_LINES,
  BUTTON_ID,
  AGAIN_ID,
};
