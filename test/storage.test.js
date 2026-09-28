// Run: node --test
// Uses a throwaway data folder so the bot's real data is never touched.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { addXp } = require('../src/utils/xp');

const file = (name) => path.join(process.env.DATA_DIR, `${name}.json`);

test('update writes nothing when the value is unchanged', async () => {
  const store = getStore('noop');
  await store.update('k', (current) => current);
  assert.strictEqual(fs.existsSync(file('noop')), false);
  await store.update('k', () => ({ a: 1 }));
  assert.deepStrictEqual(await store.get('k'), { a: 1 });
});

test('chat XP on cooldown does not rewrite xp.json', async () => {
  await addXp('cooldown-user', 20, { fromChat: true, cooldownSeconds: 60 });
  const old = new Date('2020-01-01');
  fs.utimesSync(file('xp'), old, old); // a write would bump the modified time
  assert.strictEqual(await addXp('cooldown-user', 20, { fromChat: true, cooldownSeconds: 60 }), null);
  assert.strictEqual(fs.statSync(file('xp')).mtimeMs, old.getTime());
});
