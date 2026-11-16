// /export-chat (utils/server/chatExport.js): member text can't run as code in the file, messages come out oldest first, a long channel is cut.
const test = require('./group')(__filename);
const assert = require('node:assert');
const { messageHtml, exportChannel } = require('../src/utils/server/chatExport');

const msg = (id, text, extra = {}) => ({
  id: String(id), type: 0, createdTimestamp: 1700000000000 + id * 1000, cleanContent: text,
  author: { username: 'haze', id: '1' }, attachments: new Map(), stickers: new Map(), embeds: [], ...extra,
});

// A fake channel: `fetch` answers newest first, 100 at a time, like Discord.
const channelOf = (messages) => ({
  name: 'general', guild: { name: 'Fairfax' },
  messages: {
    fetch: async ({ before }) => {
      const older = messages.filter((m) => !before || Number(m.id) < Number(before)).sort((a, b) => b.id - a.id).slice(0, 100);
      const batch = new Map(older.map((m) => [m.id, m]));
      batch.last = () => older[older.length - 1];
      return batch;
    },
  },
});

test('a message is escaped', () => {
  const html = messageHtml(msg(1, '<script>alert(1)</script>', {
    author: { username: '"><img src=x>', id: '1' },
    attachments: new Map([['a', { url: 'javascript:alert(1)', name: '<b>.png' }]]),
    embeds: [{ title: '<i>hi</i>', fields: [] }],
  }));
  assert.ok(!/<script|<img|<i>|href="javascript/.test(html), html);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the whole channel, oldest first', async () => {
  const messages = Array.from({ length: 250 }, (_, i) => msg(i + 1, `message ${i + 1}!`));
  const { html, count, cut } = await exportChannel(channelOf(messages), 'mod');
  assert.strictEqual(count, 250);
  assert.strictEqual(cut, false);
  assert.ok(html.indexOf('message 1!') < html.indexOf('message 250!'));
});

test('a channel too long for one file keeps the newest messages', async () => {
  const messages = Array.from({ length: 250 }, (_, i) => msg(i + 1, `message ${i + 1}!`));
  const { html, count, cut } = await exportChannel(channelOf(messages), 'mod', 5000);
  assert.strictEqual(cut, true);
  assert.ok(count > 0 && count < 250);
  assert.ok(html.includes('message 250!') && !html.includes('message 1!'));
});
