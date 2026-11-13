// No build holds an item and its upgrade (his rule, Nov 5): a rival's rolled kit, and Descend's upgrade + BONUS offer.
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('./group')(__filename);
const assert = require('node:assert');
const { sameLine, ITEM_POOL, SLOT_OF } = require('../src/utils/farm/levels');
const { itemByName } = require('../src/utils/farm/stats');
const { rivalKit } = require('../src/utils/farm/encounter');
const D = require('../src/utils/farm/descent');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const clash = (list) => list.flatMap((a, i) => list.slice(i + 1).filter((b) => sameLine(a, b)).map((b) => `${a} + ${b}`));

test('sameLine: an item and anything it is built from, at any depth', () => {
  const up = ITEM_POOL.map(itemByName).find((c) => c.Tier === 3 && c.Components?.length);
  const part = ITEM_POOL.find((n) => sameLine(n, up.Name));
  assert.ok(part && sameLine(up.Name, part) && !sameLine(up.Name, up.Name));
});

test('a rival kit never holds an item and its upgrade', () => {
  const byTier = (t) => ITEM_POOL.filter((n) => itemByName(n).Tier === t);
  const kit = { boons: 20, unlocked: 4, points: 20, buffs: {}, items: [...byTier(1).slice(0, 4), ...byTier(2).slice(0, 4), ...byTier(3).slice(0, 2), ...byTier(4).slice(0, 2)] };
  for (let s = 1; s <= 400; s++) assert.deepStrictEqual(clash(rivalKit(kit, seeded(s), 'Haze').items), [], `seed ${s}`);
});

test("Descend's BONUS is never a part of the upgrade it comes with", () => {
  let bonuses = 0;
  for (let s = 1; s <= 300; s++) {
    const d = D.newRun('Haze', s);
    const t1 = ITEM_POOL.filter((n) => itemByName(n).Tier === 1 && ITEM_POOL.some((u) => itemByName(u).Tier >= 3 && sameLine(n, u)));
    for (const n of t1.slice(s % 5, (s % 5) + 3)) d.items[SLOT_OF[itemByName(n).Slot]].push(n);
    d.room = 20;
    const { choices, bonuses: b } = D.itemOffer(d, seeded(s));
    for (const [i, bonus] of Object.entries(b)) { bonuses++; assert.ok(!sameLine(bonus, choices[i]), `${bonus} comes with ${choices[i]}`); }
  }
  assert.ok(bonuses > 0, 'no BONUS was offered, so nothing was checked');
});
