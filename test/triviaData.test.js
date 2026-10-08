// Run: node --test. The /trivia data refresh (tools/trivia-data.js): reading a wiki voice-lines page and listing
// what a refresh would change. No network.
const test = require('node:test');
const assert = require('node:assert');
const { voiceLines, cleanWikiText, changes, fileOf } = require('../tools/trivia-data');

const audio = (text) => `| {{Audio link|file.mp3|${text}}}`;

test('voice lines: only the hero\'s own, 25-150 characters, none that name them, no repeats', () => {
  const page = [
    '== Select ==',
    audio('This one is long enough to be a question.'),
    audio('This one is long enough to be a question.'), // a repeat
    audio('Too short.'),
    audio('Nobody outruns [[Lady Geist|Geist]] for very long, darling.'), // names her (an alias)
    audio('(laughs) this is a stage direction, not a line'),
    audio("A line with ''italics'' and a [[Link|shown word]] in it."),
    '== Conversations ==',
    audio('Someone else is talking to her in this section.'),
    '==Removed==',
    audio('This line was cut from the game a while ago.'),
  ].join('\n');
  assert.deepStrictEqual(voiceLines('Lady Geist', page), ['This one is long enough to be a question.', 'A line with italics and a shown word in it.']);
});

test('voice lines: a Japanese line uses the English translation in the next cell', () => {
  const page = ['== Kill ==', audio('斬る、ただそれだけのこと。'), '| I cut. That is all there is to it.', '|-'].join('\n');
  assert.deepStrictEqual(voiceLines('Yamato', page), ['I cut. That is all there is to it.']);
});

test('clean text and file names', () => {
  assert.strictEqual(cleanWikiText("<b>Hello</b>   [[Page]]  ''there''"), 'Hello Page there');
  assert.strictEqual(fileOf("Sinner's Sacrifice"), 'sinner_s_sacrifice.png');
});

test('changes: new and gone heroes and items, changed costs, stats, upgrades and lines', () => {
  const hero = (name, lines, abilities = ['A', 'B', 'C', 'D']) => ({ name, lines, abilities: abilities.map((n) => ({ name: n })) });
  const item = (name, extra = {}) => ({ name, tier: 1, cost: 800, stats: [], into: [], ...extra });
  const list = changes(
    [hero('Haze', ['a', 'b']), hero('Old', ['x'])],
    [hero('Haze', ['a', 'c', 'd'], ['A', 'B', 'C', 'E']), hero('New', ['y'])],
    [item('Kept'), item('Priced'), item('Gone')],
    [item('Kept'), item('Priced', { tier: 2, cost: 1600, into: ['Kept'] }), item('Fresh')],
  );
  assert.deepStrictEqual(list, [
    'Haze: +2 / -1 voice lines',
    'Haze: abilities A, B, C, D -> A, B, C, E',
    'new hero: New (1 lines)',
    'hero gone: Old',
    'Priced: Tier 1 800 -> Tier 2 1600',
    'Priced: upgrades into nothing -> Kept',
    'new item: Fresh (Tier 1, 800)',
    'item gone: Gone',
  ]);
  assert.deepStrictEqual(changes([hero('Haze', ['a'])], [hero('Haze', ['a'])], [item('Kept')], [item('Kept')]), []);
});
