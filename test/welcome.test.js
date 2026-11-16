// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { GUILD_ID } = require('../src/config');
const { getWelcome, updateWelcome, render } = require('../src/utils/server/welcome');

test('Fairfax starts with welcome messages on, every other server with them off and no channel', async () => {
  assert.strictEqual((await getWelcome(GUILD_ID)).on, true);
  const other = await getWelcome('some-server');
  assert.deepStrictEqual([other.on, other.channelId], [false, null]);
});

test('settings are kept per server and can be switched', async () => {
  await updateWelcome('a', { on: true, channelId: 'c1', text: 'Hi {member}' });
  assert.strictEqual((await getWelcome('a')).channelId, 'c1');
  assert.strictEqual((await getWelcome('b')).channelId, null);
  await updateWelcome(GUILD_ID, { on: false });
  assert.strictEqual((await getWelcome(GUILD_ID)).on, false);
});

test('the text fills in the member, the server and the count', () => {
  const member = { toString: () => '<@1>', guild: { name: 'Den', memberCount: 12 } };
  assert.strictEqual(render('{member} joined {server} (#{count}) {member}', member), '<@1> joined Den (#12) <@1>');
});
