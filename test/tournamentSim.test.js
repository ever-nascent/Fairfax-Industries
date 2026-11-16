// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { fakeTournament } = require('../src/utils/server/tournamentSim');
const B = require('../src/utils/server/bracket');
const P = require('../src/utils/server/tournamentPlay');

for (const format of ['single', 'double', 'robin']) {
  test(`${format}: every size plays through to a winner and the bracket view draws at each step`, () => {
    for (const count of [4, 6, 8]) {
      const t = fakeTournament(format, count);
      for (let m = P.readyIds(t.bracket)[0], guard = 0; m && guard++ < 200; m = P.readyIds(t.bracket)[0]) {
        P.bracketView(t); // never throws, never over Discord's limits
        assert.ok(P.bracketView(t).toJSON().fields?.length <= 23);
        B.setResult(t.bracket, m, B.resolve(t.bracket)[m].a);
      }
      assert.ok(B.complete(t.bracket), `${format} ${count}`);
      assert.ok(B.standings(t.bracket)[0].place === 1);
    }
  });
}
