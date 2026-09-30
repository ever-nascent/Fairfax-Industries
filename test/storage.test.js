// Run: node --test
// Uses a throwaway data folder so the bot's real data is never touched.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { flushPending } = require('../src/storage/jsonAdapter');
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
  flushPending(); // chat XP is written a few seconds later
  const old = new Date('2020-01-01');
  fs.utimesSync(file('xp'), old, old); // a write would bump the modified time
  assert.strictEqual(await addXp('cooldown-user', 20, { fromChat: true, cooldownSeconds: 60 }), null);
  assert.strictEqual(fs.statSync(file('xp')).mtimeMs, old.getTime());
});

test('deferred updates are in memory at once and reach the file on flush or the next normal write', async () => {
  const store = getStore('deferred');
  await store.update('a', () => ({ n: 1 }), { defer: true });
  assert.deepStrictEqual(await store.get('a'), { n: 1 });
  assert.strictEqual(fs.existsSync(file('deferred')), false);
  flushPending();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file('deferred'), 'utf8')), { a: { n: 1 } });
  await store.update('b', () => ({ n: 2 }), { defer: true });
  await store.set('c', { n: 3 }); // a normal write carries the deferred change too
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file('deferred'), 'utf8'))), ['a', 'b', 'c']);
});

test('values handed out are copies: changing one does not change the store', async () => {
  const store = getStore('copies');
  await store.set('k', { list: [1] });
  (await store.get('k')).list.push(2);
  assert.deepStrictEqual(await store.get('k'), { list: [1] });
});
