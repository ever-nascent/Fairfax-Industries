// Run: node --test
// Uses a throwaway data folder so the bot's real data is never touched.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const rr = require('../src/utils/reactionRoles');

test('drafts are saved to storage (survive a restart)', async () => {
  await rr.startDraft('g', 'u', { title: 'T', channelId: 'c', mode: 'single' });
  const draft = await rr.getDraft('g', 'u');
  rr.addPair(draft, '🔥', { id: 'r1' });
  await rr.saveDraft('g', 'u', draft);
  delete require.cache[require.resolve('../src/utils/reactionRoles')]; // fresh module, like a restart
  const again = await require('../src/utils/reactionRoles').getDraft('g', 'u');
  assert.deepStrictEqual(again.pairs, [{ key: '🔥', display: '🔥', roleId: 'r1' }]);
  await rr.clearDraft('g', 'u');
  assert.strictEqual(await rr.getDraft('g', 'u'), null);
});

test('a draft is full at 20 options, but re-adding an emoji is allowed', () => {
  const draft = { pairs: [] };
  for (let i = 0; i < rr.MAX_OPTIONS; i++) rr.addPair(draft, `<:e${i}:${100000000000000000n + BigInt(i)}>`, { id: `r${i}` });
  assert.strictEqual(rr.draftIsFull(draft, '🔥'), true);
  assert.strictEqual(rr.draftIsFull(draft, '<:e3:100000000000000003>'), false);
  assert.strictEqual(rr.draftIsFull({ pairs: [] }, '🔥'), false);
});

test('roleProblem blocks roles the bot cannot give', () => {
  const guild = { id: 'g', members: { me: { roles: { highest: { position: 5 } } } } };
  const role = (position, extra = {}) => ({
    id: 'r',
    managed: false,
    toString: () => '@Role',
    comparePositionTo: (other) => position - other.position,
    ...extra,
  });
  assert.strictEqual(rr.roleProblem(role(3), guild), null);
  assert.match(rr.roleProblem(role(5), guild), /at or above my highest role/);
  assert.match(rr.roleProblem(role(9), guild), /at or above my highest role/);
  assert.match(rr.roleProblem(role(1, { managed: true }), guild), /bot or integration/);
  assert.match(rr.roleProblem(role(0, { id: 'g' }), guild), /@everyone/);
});

test('a menu whose emoji was replaced: stale keys found, ids swapped in the roles and the text, order kept', () => {
  const A = '100000000000000001', B = '100000000000000002', C = '100000000000000003', NEW = '200000000000000002';
  const menu = { roles: { [A]: 'r1', [B]: 'r2', '🔥': 'r3', [C]: 'r4' } };
  assert.deepStrictEqual(rr.staleKeys(menu, new Set([A, C])), [B]); // unicode keys are never stale
  assert.deepStrictEqual(rr.staleKeys(menu, new Set([A, B, C])), []);
  const text = `> <:haze:${A}> \`-\` <@&r1>\n> <:abrams:${B}> \`-\` <@&r2>`;
  assert.deepStrictEqual([...rr.emojiNames(text)], [[A, 'haze'], [B, 'abrams']]);
  const fixed = rr.swapEmojis(menu, text, new Map([[B, NEW]]));
  assert.deepStrictEqual(Object.entries(fixed.roles), [[A, 'r1'], [NEW, 'r2'], ['🔥', 'r3'], [C, 'r4']]);
  assert.strictEqual(fixed.text, `> <:haze:${A}> \`-\` <@&r1>\n> <:abrams:${NEW}> \`-\` <@&r2>`);
});
