// Run: node --test. Don't Wake the Bookwyrm (Paige's Hangman): the rules, the payout, a game from bet to payout, the picture, the timeout.
// Throwaway data folder, never the live data/.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/xp');
const { expireGames } = require('../src/utils/casino');
const paige = require('../src/utils/paige');
const { renderBook, renderBookPng, layout } = require('../src/utils/paigeBook');
const { findComponentRoute } = require('../src/components');
const { simulate } = require('../tools/hangman-rtp');

const { guessLetter, solveWord, winnings, PAYOUT } = paige;
const BET = 1000;
const START = 100_000;
const fund = (id) => getStore('xp').set(id, { xp: 0, level: 0, souls: START });
const souls = async (id) => (await getUser(id)).souls;
const fresh = (word = 'MYSTIC BURST', extra = {}) => ({ userId: 'u', name: 'U', bet: BET, category: 'Items', word, hits: [], wrong: [], done: false, won: false, version: 0, ...extra });
const idOf = (payload) => payload.components[0].components[0].data.custom_id.split(':')[1];
const text = (payload) => payload.embeds[0].toJSON().description;
const field = (payload, name) => payload.embeds[0].toJSON().fields.find((f) => f.name === name)?.value;
const optionsOf = (payload, row) => payload.components[row].components[0].options.map((o) => o.data.value);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const GIF = Buffer.from('GIF89a');

test('the word chapters: every hero, ability and item, in capitals', () => {
  const pool = paige.wordPool();
  assert.ok(pool.Heroes.length >= 43 && pool.Abilities.length >= 150 && pool.Items.length >= 150);
  assert.ok(pool.Heroes.includes('THE DOORMAN') && pool.Heroes.includes('MO & KRILL'));
  assert.ok(pool.Items.includes('MYSTIC BURST') && pool.Abilities.includes("BABA'S BREW"));
  for (const word of Object.values(pool).flat()) assert.strictEqual(word, word.toUpperCase());
  assert.deepStrictEqual(paige.lettersOf("MO & KRILL"), ['M', 'O', 'K', 'R', 'I', 'L']);
  assert.strictEqual(paige.normalize('Éclair'), 'ECLAIR');
  const picks = new Set();
  for (let i = 0; i < 200; i++) picks.add(paige.pickWord().category);
  assert.deepStrictEqual([...picks].sort(), ['Abilities', 'Heroes', 'Items'], 'a chapter is picked first');
});

test('letters: a right one is kept, a wrong one counts, a used one does nothing, the last blank wins, the 6th wrong loses', () => {
  let g = guessLetter(fresh('HAZE'), 'A');
  assert.deepStrictEqual([g.hits, g.wrong, g.done], [['A'], [], false]);
  assert.strictEqual(guessLetter(g, 'A'), g, 'the same letter twice is ignored');
  g = guessLetter(g, 'Q');
  assert.deepStrictEqual(g.wrong, ['Q']);
  assert.strictEqual(guessLetter(g, 'q'), g, 'only capitals A-Z');
  for (const l of 'HZE') g = guessLetter(g, l);
  assert.deepStrictEqual([g.done, g.won, g.wrong.length], [true, true, 1]);
  assert.strictEqual(guessLetter(g, 'B'), g, 'nothing after the end');
  let lost = fresh('HAZE');
  for (const l of 'BCDFGJ') lost = guessLetter(lost, l);
  assert.deepStrictEqual([lost.done, lost.won, lost.wrong.length], [true, false, 6]);
});

test("names with punctuation: only the letters are blanks (Mo & Krill, Baba's Brew, Chimera Mk1)", () => {
  let g = fresh("BABA'S BREW");
  for (const l of 'BASRE') g = guessLetter(g, l);
  assert.strictEqual(g.done, false);
  g = guessLetter(g, 'W');
  assert.deepStrictEqual([g.done, g.won], [true, true]);
  let mk = fresh('CHIMERA MK1');
  for (const l of 'CHIMERAK') mk = guessLetter(mk, l);
  assert.strictEqual(mk.done, true, 'the digit is never asked for');
});

test('solving: the word typed any way wins, a wrong one costs a guess (a ? blot), six wrong ends it', () => {
  assert.deepStrictEqual([solveWord(fresh("MO & KRILL"), 'mo krill').won, solveWord(fresh("MO & KRILL"), 'MO&KRILL').done], [true, true]);
  const win = solveWord(fresh('MYSTIC BURST', { wrong: ['A', 'E'] }), '  mystic   burst ');
  assert.deepStrictEqual([win.won, win.wrong.length], [true, 2]);
  assert.deepStrictEqual(win.hits.sort(), paige.lettersOf('MYSTIC BURST').sort(), 'the whole word shows');
  let g = solveWord(fresh('MYSTIC BURST'), 'nope');
  assert.deepStrictEqual([g.wrong, g.done], [['?'], false]);
  for (let i = 0; i < 5; i++) g = solveWord(g, 'nope');
  assert.deepStrictEqual([g.done, g.won, g.wrong.length], [true, false, 6]);
});

test('the payout falls with every wrong guess and a win never pays less than the bet', () => {
  assert.strictEqual(PAYOUT.length, 6);
  for (let i = 1; i < PAYOUT.length; i++) assert.ok(PAYOUT[i] <= PAYOUT[i - 1]);
  assert.ok(PAYOUT.every((m) => m >= 1));
  assert.strictEqual(winnings(1000, 0), 1550);
  assert.strictEqual(winnings(1000, 5), 1000);
});

test('a typical player gets back about 95%; players who know the names do better, and that is on record', () => {
  const player = simulate('player').rtp;
  assert.ok(player > 0.93 && player < 0.97, `a typical player returns ${(player * 100).toFixed(1)}%`);
  assert.ok(simulate('frequency').rtp < 0.2, 'guessing letters blind almost never wins on these names');
  const solver = simulate('solver');
  assert.strictEqual(solver.winRate, 1);
  assert.ok(solver.rtp < 1.6, `the full-list solver returns ${(solver.rtp * 100).toFixed(0)}%: tighten PAYOUT if that is too much`);
});

test('a game: bet taken, two dropdowns and Solve It, only the player plays, a win pays, the game is gone', async () => {
  const user = { id: 'bw-win' };
  await fund(user.id);
  const start = await paige.startGame(user, 'Tester', BET, { category: 'Items', word: 'MYSTIC BURST' });
  assert.strictEqual(await souls(user.id), START - BET);
  const id = idOf(start);
  assert.strictEqual(start.components.length, 3);
  assert.deepStrictEqual(optionsOf(start, 0), [...'ABCDEFGHIJKLM'].map((l) => l), 'A to M');
  assert.deepStrictEqual(optionsOf(start, 1), [...'NOPQRSTUVWXYZ']);
  assert.match(start.components[2].components[0].data.custom_id, /^hangman_solve:/);
  assert.match(text(start), /Pick a letter below, or press \*\*Solve It\*\*/);
  assert.deepStrictEqual(start.embeds[0].toJSON().fields.map((f) => f.name), ['Guesses Left', 'Solving Pays', 'Bet']); // no Chapter field: the book names it (his call Oct 22)
  assert.strictEqual(field(start, 'Guesses Left'), '6 of 6');
  assert.match(field(start, 'Solving Pays'), /1,550/);
  assert.ok(start.files.some((f) => f.name.startsWith('book_')), 'the book picture is attached');
  assert.ok(!JSON.stringify(start).includes('MYSTIC'), 'the word is never in the message');

  assert.match((await paige.guess(id, 'someone-else', 'M')).error, /Tester's story/);
  const hit = await paige.guess(id, user.id, 'M');
  assert.match(text(hit), /\*\*M\*\* is in the story/);
  assert.ok(!optionsOf(hit, 0).includes('M'), 'a used letter leaves its dropdown');
  assert.strictEqual(await paige.guess(id, user.id, 'M'), null, 'the same letter twice is a stale click');
  const miss = await paige.guess(id, user.id, 'Z');
  assert.match(text(miss), /No \*\*Z\*\* in this story/);
  assert.strictEqual(field(miss, 'Guesses Left'), '5 of 6');
  assert.match(field(miss, 'Solving Pays'), /1,350/);

  assert.match((await paige.solveError(id, 'someone-else')), /Tester's story/);
  assert.strictEqual(await paige.solveError(id, user.id), null);
  const won = await paige.solve(id, user.id, 'Mystic Burst');
  assert.match(text(won), /^You solved it!\nThe word was \*\*MYSTIC BURST\*\*$/m); // a win: two lines, only the word in bold (his call, Oct 22)
  assert.match(field(won, 'Bet'), /^.*1,000 Souls$/);
  assert.match(field(won, 'Won'), /1,350 Souls/);
  assert.match(field(won, 'New Balance'), /100,350 Souls/);
  assert.strictEqual(await souls(user.id), START - BET + winnings(BET, 1), 'one wrong guess: 1.35x');
  assert.deepStrictEqual(await paige.games().all(), {});
  assert.match(won.components[0].components[0].data.custom_id, /^hangman_again:1000:bw-win/);
  assert.match((await paige.solveError(id, user.id)), /already finished/);
  assert.strictEqual(await paige.guess(id, user.id, 'A'), null);
});

test('a game lost on the 6th wrong guess: the bet stays gone, the word is shown', async () => {
  const user = { id: 'bw-lose' };
  await fund(user.id);
  const id = idOf(await paige.startGame(user, 'Tester', BET, { category: 'Heroes', word: 'HAZE' }));
  let last;
  for (const l of 'BCDFGJ') last = await paige.guess(id, user.id, l);
  assert.match(text(last), /\*\*The Bookwyrm awakens! The word was HAZE\.\*\*/);
  assert.match(field(last, 'Lost'), /1,000 Souls/);
  assert.match(field(last, 'New Balance'), /99,000 Souls/);
  assert.strictEqual(await souls(user.id), START - BET);
  assert.deepStrictEqual(await paige.games().all(), {});
});

test('finishing the word with letters pays by the wrong guesses made', async () => {
  const user = { id: 'bw-letters' };
  await fund(user.id);
  const id = idOf(await paige.startGame(user, 'Tester', BET, { category: 'Heroes', word: 'HAZE' }));
  for (const l of 'HAZ') await paige.guess(id, user.id, l);
  const won = await paige.guess(id, user.id, 'E');
  assert.match(text(won), /solved it/);
  assert.strictEqual(await souls(user.id), START - BET + winnings(BET, 0));
});

test('time runs out: nothing guessed gives the bet back, a story half read is lost', async () => {
  const sweep = async () => {
    const edits = [];
    for (const id of Object.keys(await paige.games().all())) await paige.games().update(id, (g) => ({ ...g, at: 0, channelId: 'c', messageId: 'm' }));
    await expireGames({ channels: { fetch: async () => ({ messages: { edit: async (_id, payload) => edits.push(payload) } }) } }, [paige]);
    assert.deepStrictEqual(await paige.games().all(), {});
    return edits;
  };
  const idle = { id: 'bw-idle' };
  await fund(idle.id);
  await paige.startGame(idle, 'Tester', BET, { category: 'Items', word: 'MYSTIC BURST' });
  const [back] = await sweep();
  assert.strictEqual(await souls(idle.id), START);
  assert.match(text(back), /Time's up/);

  const walked = { id: 'bw-walked' };
  await fund(walked.id);
  const id = idOf(await paige.startGame(walked, 'Tester', BET, { category: 'Items', word: 'MYSTIC BURST' }));
  await paige.guess(id, walked.id, 'M');
  const [lost] = await sweep();
  assert.strictEqual(await souls(walked.id), START - BET, 'no refund');
  assert.match(text(lost), /^\*\*Time ran out, so the game was finished\.\*\*/);
  assert.match(text(lost), /left the story unfinished\. The word was MYSTIC BURST/);
});

test('the dropdowns, Solve It and its pop-up are routed; the pop-up asks for one answer', () => {
  const pick = (type, customId) => ({ customId, isButton: () => type === 'button', isStringSelectMenu: () => type === 'select', isModalSubmit: () => type === 'modal' });
  assert.strictEqual(findComponentRoute(pick('select', 'hangman:abc:0')).label, 'Letter dropdown');
  assert.strictEqual(findComponentRoute(pick('button', 'hangman_solve:abc')).label, 'Solve It button');
  assert.strictEqual(findComponentRoute(pick('modal', 'hangman_solve:abc')).label, 'Solve It pop-up');
  assert.strictEqual(findComponentRoute(pick('button', 'hangman_again:1000:u')).label, 'Play Again button');
  const modal = paige.solveModal('abc').toJSON();
  assert.strictEqual(modal.custom_id, 'hangman_solve:abc');
  assert.strictEqual(modal.components[0].components[0].custom_id, 'answer');
});

const gif0 = (buffer) => buffer.subarray(0, 1000).toString('latin1'); // past the 768-byte colour table
test('the picture: every name in the game fits the page (3 lines at most) and every state draws an animated GIF', async () => {
  const avail = 306; // the right page's width between its margins
  for (const word of Object.values(paige.wordPool()).flat()) {
    const fit = layout(word, avail);
    assert.ok(fit.lines.length <= 3, `${word}: ${fit.lines.length} lines`);
    for (const line of fit.lines) assert.ok(fit.width(line) <= avail + 0.5, `${word}: a line is ${fit.width(line)} wide`);
    assert.ok(fit.size >= 18);
  }
  const longest = Object.values(paige.wordPool()).flat().sort((a, b) => b.length - a.length)[0];
  for (let wrong = 0; wrong <= 6; wrong++) {
    const gif = await renderBook({ word: longest, hits: ['E'], wrong: [...'AOLNDW'].slice(0, wrong), category: 'Items', result: wrong === 6 ? 'lost' : null });
    assert.ok(gif.subarray(0, 6).equals(GIF), `${wrong} wrong`);
    assert.ok(gif.length < 2_000_000, `${wrong} wrong: ${gif.length} bytes`); // Discord shows an embed picture up to 8 MB; this one should stay small
  }
  assert.ok((await renderBook({ word: 'HAZE', hits: [], wrong: ['?'], category: 'Heroes', result: 'won' })).subarray(0, 6).equals(GIF));
  assert.ok((await renderBookPng({ word: 'HAZE', hits: [], wrong: [], category: 'Heroes' })).subarray(0, 4).equals(PNG), 'the still picture');
  // it loops forever and the frames differ (the fireflies move): the file says how many times to repeat (the Netscape extension, 0 = forever)
  assert.ok(gif0(await renderBook({ word: 'HAZE', hits: [], wrong: [], category: 'Heroes' })).includes('NETSCAPE2.0'));
});
