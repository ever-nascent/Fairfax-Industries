// The souls ledger: one line for every change to a member's souls (who, how much, the balance after, why).
// Append-only JSON lines in data/soulsLedger.jsonl (one older file kept), so a wrong balance can be traced, a staff slip
// undone from the old value, and the economy checked: what each faucet pays and each sink takes.
// A Hero Farming hero's own souls (his call, Oct 11: separate per hero, not the server balance) are logged here too, tagged with the hero (`h`);
// their `b` is that hero's souls after the change.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../storage/jsonAdapter');

const FILE = () => path.join(DATA_DIR, 'soulsLedger.jsonl');
const OLD = () => path.join(DATA_DIR, 'soulsLedger.1.jsonl');
const MAX_BYTES = 8 * 1024 * 1024; // past this the file becomes the "old" one

// Reason names (what each caller passes) and how they read to members.
const LABELS = {
  'level-up': 'Level-up',
  urn: 'Soul Urn',
  trivia: 'Trivia',
  'soul-bag': 'Soul Bag',
  lockle: 'Lockle',
  farm: 'Hero Farming',
  'farm-shop': 'Hero Farming item shop',
  'farm-move': 'Moved to hero souls', // Oct 11, once: the server balance went into Haze's own souls (economy.js moveToHeroes)
  'shop:card': 'Hero card',
  'shop:boost': 'Soul Boost',
  'shop:rejuv': 'Rejuv',
  hideout: 'Hideout',
  staff: 'Staff edit',
  other: 'Other',
};
const GAMES = {
  doorman: 'Guess the Door', bj: 'Blackjack', hat: 'Rabbit in the Hat', clock: 'Borrowed Time', mines: "Bebop's Bombs", keg: 'Powder Keg',
  duel: 'Duel of Stances', roulette: 'Shotgun Roulette', remling: 'Remling Race', suitcase: 'Deal or No Deal',
};
const label = (reason) => (reason.startsWith('game:') ? GAMES[reason.slice(5)] ?? reason.slice(5) : LABELS[reason] ?? reason);

// Adds a line. `meta`: a reason string, or { reason, with, hero } (`with` = the other member, for a duel's pot; `hero` = a farm hero's own souls).
// Never throws: a full disk must not undo a purchase.
function record(userId, delta, meta, balance) {
  if (!delta) return;
  const { reason = 'other', with: other, hero } = typeof meta === 'string' ? { reason: meta } : meta ?? {};
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE()) && fs.statSync(FILE()).size > MAX_BYTES) fs.renameSync(FILE(), OLD());
    const line = { t: Date.now(), u: userId, d: delta, b: balance, r: reason, ...(other ? { w: other } : {}), ...(hero ? { h: hero } : {}) };
    fs.appendFileSync(FILE(), `${JSON.stringify(line)}\n`);
  } catch (error) {
    console.error('[ledger] Could not write:', error.message);
  }
}

// Every line, oldest first (the old file, then the current one).
function entries() {
  return [OLD(), FILE()].flatMap((file) =>
    fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      : [],
  );
}

// A member's last `count` changes, newest first. `heroes: false` leaves out their farm heroes' own souls (the server balance only).
const history = (userId, count = 10, { heroes = true } = {}) => entries().filter((e) => e.u === userId && (heroes || !e.h)).slice(-count).reverse();

// What came in and went out per reason since `since` (ms timestamp), plus duel pots by pair.
// Returns { rows: [{ reason, in, out, count }] sorted by net, pairs: [{ winner, loser, count, souls }] sorted by count }.
function report(since = 0) {
  const byReason = new Map();
  const pairs = new Map();
  for (const e of entries()) {
    if (e.t < since) continue;
    const row = byReason.get(e.r) ?? { reason: e.r, in: 0, out: 0, count: 0 };
    if (e.d > 0) row.in += e.d;
    else row.out -= e.d;
    row.count++;
    byReason.set(e.r, row);
    if (e.w) {
      const key = `${e.u}>${e.w}`;
      const pair = pairs.get(key) ?? { winner: e.u, loser: e.w, count: 0, souls: 0 };
      pair.count++;
      pair.souls += e.d / 2; // a pot is both stakes; the winner's own half isn't a transfer
      pairs.set(key, pair);
    }
  }
  return {
    rows: [...byReason.values()].sort((a, b) => b.in - b.out - (a.in - a.out)),
    pairs: [...pairs.values()].sort((a, b) => b.count - a.count),
  };
}

module.exports = { record, history, report, label, LABELS };
