// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { findPhrase, addPhrase, removePhrase, getPhrases, WARN_LINES } = require('../src/utils/censor');

test('phrases are stored normalized, no duplicates, removable', async () => {
  assert.equal(await addPhrase('g', '  Bad Word '), true);
  assert.equal(await addPhrase('g', 'bad word'), false);
  assert.deepEqual(await getPhrases('g'), ['bad word']);
  assert.equal(await removePhrase('g', 'BAD WORD'), true);
  assert.equal(await removePhrase('g', 'bad word'), false);
});

test('matches whole words only, ignoring case and accents', () => {
  const list = ['ass', 'bad word', 'a.b'];
  assert.equal(findPhrase('you are an ASS!', list), 'ass');
  assert.equal(findPhrase('what a Bád Wörd', list), 'bad word');
  assert.equal(findPhrase('first class assumption', list), null);
  assert.equal(findPhrase('axb', list), null); // "." is literal, not a regex wildcard
  assert.equal(findPhrase('hi', []), null);
});

test('warnings never contain the Knicks', () => {
  assert.ok(WARN_LINES.every((l) => !/knick/i.test(l)));
});
