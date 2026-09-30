// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const [route] = require('../src/components/lfgPings');
const { pingMenuMessage } = require('../src/components/lfgPings');
const { PING_ROLES } = require('../src/utils/lfg');

// A member holding `has` (role names), picking `values` in the dropdown.
function fakePick(has, values) {
  const roles = [...PING_ROLES, 'Oracle'].map((name, i) => ({ id: String(i), name, toString: () => `@${name}` }));
  roles.find = Array.prototype.find;
  const held = new Set(roles.filter((r) => has.includes(r.name)).map((r) => r.id));
  const calls = [];
  return {
    held: () => roles.filter((r) => held.has(r.id)).map((r) => r.name),
    calls,
    values,
    guild: { roles: { cache: roles } },
    member: {
      roles: {
        cache: { has: (id) => held.has(id) },
        add: async (list) => list.forEach((r) => held.add(r.id)),
        remove: async (list) => list.forEach((r) => held.delete(r.id)),
      },
    },
    message: { components: [] },
    update: async (arg) => calls.push(['update', arg]),
    followUp: async (arg) => calls.push(['followUp', arg]),
  };
}

test('picks replace the LFG pings a member had, other roles stay', async () => {
  const i = fakePick(['LFG Standard', 'LFG Mystic', 'Oracle'], ['LFG Street Brawl', 'LFG Oracle']);
  await route.execute(i);
  assert.deepStrictEqual(i.held(), ['LFG Street Brawl', 'LFG Oracle', 'Oracle']);
  assert.match(i.calls[1][1].embeds[0].data.description, /Your LFG pings: @LFG Street Brawl, @LFG Oracle/);
});

test('No Pings removes every LFG ping, even if picked with others', async () => {
  const i = fakePick(['LFG Standard', 'Oracle'], ['none', 'LFG Seeker']);
  await route.execute(i);
  assert.deepStrictEqual(i.held(), ['Oracle']);
  assert.strictEqual(i.calls[1][1].embeds[0].data.description, 'You have no LFG pings.');
});

test('the dropdown lists No Pings then all 13 ping roles', () => {
  const options = pingMenuMessage().components[0].components[0].options.map((o) => o.data.label);
  assert.deepStrictEqual(options, ['No Pings', ...PING_ROLES]);
  assert.strictEqual(PING_ROLES.length, 13);
});
