process.env.WIKI_GAP_MS = '0';
process.env.WIKI_RETRY_WAITS_MS = '1,1';
const test = require('node:test');
const assert = require('node:assert');
const { wikiFetch } = require('../src/utils/wikiFetch');

// a fake fetch that answers from a list: a status number, or an Error to throw
function answers(list) {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const next = list.shift();
    if (next instanceof Error) throw next;
    return new Response('x', { status: next });
  };
  return calls;
}

test('wikiFetch: a refused or timed-out request is tried again, then the answer is handed back', async () => {
  const real = global.fetch;
  try {
    let calls = answers([403, new Error('timeout'), 200]);
    assert.strictEqual((await wikiFetch('https://deadlock.wiki/a', { userAgent: 'test' })).status, 200);
    assert.strictEqual(calls.length, 3, 'two retries');

    calls = answers([404]);
    assert.strictEqual((await wikiFetch('https://deadlock.wiki/b', { userAgent: 'test' })).status, 404, 'a missing page is not retried');
    assert.strictEqual(calls.length, 1);

    calls = answers([403, 403, 403]);
    assert.strictEqual((await wikiFetch('https://deadlock.wiki/c', { userAgent: 'test' })).status, 403, 'still refused after the retries: the caller sees it');
    assert.strictEqual(calls.length, 3);

    answers([new Error('down'), new Error('down'), new Error('down')]);
    await assert.rejects(wikiFetch('https://deadlock.wiki/d', { userAgent: 'test' }), /down/);
  } finally {
    global.fetch = real;
  }
});
