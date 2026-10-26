// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
const test = require('node:test');
const assert = require('node:assert');
const { getUser } = require('../src/utils/xp');
const { getFarmUser, chooseHero, play, simulate, upgradeAbility, buyItem, sellItem, updateFarmUser: changeRecord } = require('../src/utils/farm/play');
const { progress, pointsSpent, campMultiplier, THRESHOLDS, MAX_LEVEL } = require('../src/utils/farm/levels');
const { PAYOUT_SCALE } = require('../src/utils/farm/targets');
const { buildHero } = require('../src/utils/farm/hero');
const views = require('../src/utils/farm/views');

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const member = (id) => ({ id, guild: { emojis: { cache: { find: () => undefined } } }, toString: () => `<@${id}>` });
// the current hero's own souls (his call, Oct 11: farm souls are per hero, apart from the server balance)
const giveSouls = (id, n) => changeRecord(id, (r) => { r.souls += n; });
const heroSouls = async (id) => (await getFarmUser(id)).souls;

test('levels follow the game table, scaled by the payout scale', () => {
  assert.strictEqual(THRESHOLDS.length, 36);
  assert.strictEqual(MAX_LEVEL, 35);
  assert.deepStrictEqual([progress(0).level, progress(0).unlocks, progress(0).points], [0, 1, 0]);
  const one = 200 * PAYOUT_SCALE; // level 1 is 800 souls at the game's scale, 600 start + 200
  assert.strictEqual(progress(one - 0.1).level, 0);
  assert.strictEqual(progress(one).level, 1);
  assert.strictEqual(progress(one).points, 1);
  const lvl4 = progress((2000 - 600) * PAYOUT_SCALE);
  assert.deepStrictEqual([lvl4.level, lvl4.unlocks, lvl4.points], [4, 3, 2]);
  const lvl7 = progress((3800 - 600) * PAYOUT_SCALE);
  assert.deepStrictEqual([lvl7.level, lvl7.unlocks, lvl7.points], [7, 4, 4]);
  const max = progress(1e9);
  assert.deepStrictEqual([max.level, max.unlocks, max.points, max.max], [35, 4, 32, true]);
  assert.ok(Array.from({ length: 36 }, (_, l) => progress(((THRESHOLDS[l] - 600) * PAYOUT_SCALE) + 0.001).level).every((l, i) => l === i));
  assert.strictEqual(pointsSpent({ 1: 3, 2: 1 }), 8 + 1);
});

test('a hero only has the abilities it unlocked, and uses the tiers bought', () => {
  const lvl0 = buildHero('Haze', { unlocked: 1 });
  assert.deepStrictEqual(lvl0.abilities.map((a) => a.status()), ['Ready', 'Locked', 'Locked', 'Locked']);
  const tiered = buildHero('Haze', { tiers: { 1: 2 } });
  assert.strictEqual(tiered.abilities[0].tier, 2);
  const stronger = buildHero('Haze', { boons: 10 });
  assert.ok(stronger.stats.maxHealth > buildHero('Haze').stats.maxHealth, 'boons add health');
});

test('ability points: only unlocked abilities, one tier at a time, 1 / 2 / 5 points', async () => {
  const id = 'lv1';
  await chooseHero(id, 'Haze');
  assert.strictEqual((await upgradeAbility(id, 1)).error, 'points', 'level 0 has no points');
  const { updateFarmUser } = require('../src/utils/farm/play');
  await updateFarmUser(id, (r) => { r.earned = (3800 - 600) * PAYOUT_SCALE; }); // level 7: 4 points, 4 abilities
  assert.deepStrictEqual(await upgradeAbility(id, 1), { ok: true, tier: 1 }); // 1 point
  assert.deepStrictEqual(await upgradeAbility(id, 1), { ok: true, tier: 2 }); // 2 more
  assert.strictEqual((await upgradeAbility(id, 1)).error, 'points', 'tier 3 costs 5, only 1 left');
  assert.deepStrictEqual(await upgradeAbility(id, 2), { ok: true, tier: 1 });
  assert.strictEqual((await getFarmUser(id)).tiers[1], 2);
  const other = 'lv2';
  await chooseHero(other, 'Haze');
  await updateFarmUser(other, (r) => { r.earned = 200 * PAYOUT_SCALE; }); // level 1: still only ability 1
  assert.strictEqual((await upgradeAbility(other, 3)).error, 'locked');
});

test('items: 12 of any kind, wiki prices from the hero\'s own souls, sell for half the price', async () => {
  const { POOL: all, MAX_ITEMS } = require('../src/utils/farm/levels');
  const { itemByName } = require('../src/utils/farm/stats');
  const POOL = { weapon: all.weapon.filter((n) => !itemByName(n).Components?.length) }; // nothing here upgrades from another
  assert.ok(POOL.weapon.length > MAX_ITEMS);
  const id = 'it1';
  await chooseHero(id, 'Haze');
  assert.strictEqual((await buyItem(id, 'Extra Health')).error, 'souls');
  await require('../src/utils/xp').changeSouls(id, 100000, 'staff');
  assert.strictEqual((await buyItem(id, 'Extra Health')).error, 'souls', 'the server balance buys nothing here');
  await giveSouls(id, 100000);
  const price = (n) => itemByName(n).Cost;
  assert.deepStrictEqual(await buyItem(id, 'Extra Health'), { ok: true, paid: price('Extra Health'), used: [] });
  assert.strictEqual((await heroSouls(id)), 100000 - price('Extra Health'));
  assert.strictEqual((await getUser(id)).souls, 100000, 'the server balance is untouched');
  assert.strictEqual((await buyItem(id, 'Extra Health')).error, 'owned');
  assert.strictEqual((await buyItem(id, 'Not An Item')).error, 'unknown');
  for (const name of POOL.weapon.slice(0, 11)) assert.ok((await buyItem(id, name)).ok); // one kind may fill the build
  assert.strictEqual((await buyItem(id, POOL.weapon[11])).error, 'full', 'only 12 items');
  assert.strictEqual((await getFarmUser(id)).items.weapon.length, 11);
  const before = (await heroSouls(id));
  assert.deepStrictEqual(await sellItem(id, POOL.weapon[0]), { ok: true, refund: price(POOL.weapon[0]) / 2 });
  assert.strictEqual((await heroSouls(id)), before + price(POOL.weapon[0]) / 2);
  assert.ok((await buyItem(id, POOL.weapon[11])).ok, 'a free slot again');
  assert.strictEqual((await sellItem(id, POOL.weapon.at(-1))).error, 'missing');
  const fight = require('../src/utils/farm/play').fightKit(await getFarmUser(id));
  assert.strictEqual(fight.items.length, 12, 'every owned item goes into the fight');
});

test('items: upgrade paths: owning a component makes the upgrade cost the difference and uses the component up', async () => {
  const { itemByName } = require('../src/utils/farm/stats');
  const price = (n) => itemByName(n).Cost;
  const id = 'it-up';
  await chooseHero(id, 'Haze');
  await giveSouls(id, 100000);
  await buyItem(id, 'Long Range');
  await buyItem(id, 'High-Velocity Rounds');
  await buyItem(id, 'Extra Health');
  const before = (await heroSouls(id));
  const paid = price('Sharpshooter') - price('Long Range') - price('High-Velocity Rounds');
  assert.deepStrictEqual(await buyItem(id, 'Sharpshooter'), { ok: true, paid, used: ['Long Range', 'High-Velocity Rounds'] });
  assert.strictEqual((await heroSouls(id)), before - paid);
  const items = (await getFarmUser(id)).items;
  assert.deepStrictEqual([items.weapon, items.vitality], [['Sharpshooter'], ['Extra Health']]);
  // a component of an owned item can't be bought again, at any depth (Transcendent Cooldown <- Superior Cooldown <- Compress Cooldown)
  assert.deepStrictEqual(await buyItem(id, 'Long Range'), { error: 'inside', holder: 'Sharpshooter' });
  await buyItem(id, 'Transcendent Cooldown');
  assert.deepStrictEqual(await buyItem(id, 'Compress Cooldown'), { error: 'inside', holder: 'Transcendent Cooldown' });
  // without a component it costs its full price
  await chooseHero('it-up2', 'Haze');
  await giveSouls('it-up2', 100000);
  assert.strictEqual((await buyItem('it-up2', 'Sharpshooter')).paid, price('Sharpshooter'));
  // The intermediate item is optional: a held first component still upgrades directly into tier 4.
  await chooseHero('it-up3', 'Haze');
  await giveSouls('it-up3', 100000);
  await buyItem('it-up3', 'Compress Cooldown');
  assert.deepStrictEqual(await buyItem('it-up3', 'Transcendent Cooldown'), { ok: true, paid: price('Transcendent Cooldown') - price('Compress Cooldown'), used: ['Compress Cooldown'] });
  assert.deepStrictEqual((await getFarmUser('it-up3')).items.spirit, ['Transcendent Cooldown']);
});

test('items: buys at the same moment cannot overfill the build or buy an item twice, and the losers get their souls back', async () => {
  const { POOL, MAX_ITEMS } = require('../src/utils/farm/levels');
  const { itemByName } = require('../src/utils/farm/stats');
  const id = 'it2';
  const w = POOL.weapon.filter((n) => !itemByName(n).Components?.length);
  await chooseHero(id, 'Haze');
  await giveSouls(id, 100000);
  for (const name of w.slice(0, 11)) await buyItem(id, name);
  const before = (await heroSouls(id));
  const results = await Promise.all([w[11], w[12], w[13], w[13]].map((name) => buyItem(id, name)));
  const bought = (await getFarmUser(id)).items.weapon;
  assert.strictEqual(bought.length, MAX_ITEMS);
  assert.strictEqual(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.error === 'full'));
  assert.strictEqual((await heroSouls(id)), before - itemByName(bought[11]).Cost, 'only the item that went in was paid for');
});

test('items and levels change the fight, and camps pay more as the hero levels', () => {
  const plain = simulate('Haze', 'small-camp', { rng: seeded(3) });
  const strong = simulate('Haze', 'small-camp', { rng: seeded(3), boons: 20 });
  assert.ok(plain.won && strong.won);
  assert.ok(strong.souls > plain.souls, 'a level 20 hero gets more from the same camp');
  assert.strictEqual(strong.souls, Math.round(plain.souls * campMultiplier(20)));
  assert.strictEqual(campMultiplier(0), 1);
  const kit = ['Titanic Magazine', 'Rapid Rounds', 'Extra Health', 'Bullet Lifesteal', 'Battle Vest', 'Extra Spirit'];
  const guardian = simulate('Haze', 'guardian', { rng: seeded(3), boons: 20, items: kit });
  assert.ok(guardian.won);
  assert.strictEqual(guardian.souls, simulate('Haze', 'guardian', { rng: seeded(3), boons: 30, items: kit }).souls, 'only camps scale');
});

test('a trip adds its souls to the hero (levels), and the hero screen fits Discord', async () => {
  const id = 'earn1';
  await chooseHero(id, 'Haze');
  const run = (await play(id, 'small-camp', { rng: seeded(4) })).run;
  assert.strictEqual((await getFarmUser(id)).earned, run.souls);
  const record = await getFarmUser(id);
  const view = await views.heroView(member(id), { ...record, souls: 1234, earned: 400, tiers: { 1: 1 }, items: { weapon: ['Rapid Rounds', 'Extended Magazine'], vitality: ['Extra Health'] } });
  assert.strictEqual(view.components.length, 2, 'upgrade menu, buttons');
  const sell = await views.shopView(member(id), { ...record, souls: 5, items: { weapon: ['Rapid Rounds'] } }, 'sell');
  assert.strictEqual(sell.components.length, 3, 'tabs, sell menu, Back / Hero');
  // the item shop (his calls, Oct 3): tabs, price buttons, one buy menu, Back / Hero; a picture drawn like the in-game shop
  for (const kind of ['weapon', 'vitality', 'spirit']) {
    const menus = [];
    for (const tier of [1, 2, 3, 4]) {
      const shop = await views.shopView(member(id), { ...record, souls: 5 }, kind, Date.now(), tier);
      assert.strictEqual(shop.components.length, 4, `${kind}: tabs, price buttons, the buy menu, Back / Hero`);
      assert.deepStrictEqual(shop.components[1].toJSON().components.map((b) => b.label), ['800', '1,600', '3,200', '6,400']);
      assert.ok(shop.files.some((f) => f.name === 'shop.png'));
      const ids = shop.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
      assert.strictEqual(new Set(ids).size, ids.length, `${kind} ${tier}: Discord refuses duplicate custom ids`);
      menus.push(shop.components[2].toJSON().components[0].options);
    }
    assert.strictEqual(menus.flat().length, require('../src/utils/farm/levels').POOL[kind].length, 'every item of the kind is for sale');
    for (const options of menus) {
      assert.ok(options.length >= 1 && options.length <= 25, `${kind}: ${options.length} items`);
      for (const o of options) assert.ok(o.description.length <= 100 && o.label.length <= 100);
    }
  }
  assert.ok(view.files.some((f) => f.name === 'hero.png'));
  const j = view.embeds[0].toJSON();
  assert.match(j.title, /Level/);
});

test('every target grows with each clear, up to a cap, and pays a little more', async () => {
  const { CLEAR_CAP, clearPower, clearSouls } = require('../src/utils/farm/targets');
  assert.strictEqual(clearPower(0, 'guardian'), 1);
  assert.ok(clearPower(3, 'guardian') > clearPower(2, 'guardian'));
  assert.strictEqual(clearPower(CLEAR_CAP + 5, 'guardian'), clearPower(CLEAR_CAP, 'guardian'), 'capped');
  for (const key of ['small-camp', 'guardian', 'mid-boss', 'siege']) {
    const first = simulate('Haze', key, { rng: seeded(1), clears: 0 }).frames[0].enemies[0];
    const grown = simulate('Haze', key, { rng: seeded(1), clears: 5 }).frames[0].enemies[0];
    assert.ok(grown.max > first.max && grown.hp > first.hp, `${key}: health grows (current health too)`);
  }
  const id = 'mb1';
  await chooseHero(id, 'Haze');
  const farm = require('../src/storage').getStore('farm');
  await require('../src/utils/farm/play').updateFarmUser(id, (r) => Object.assign(r, { earned: 1e6, tiers: { 1: 3, 2: 3, 3: 3, 4: 3 }, clears: { 'small-camp': CLEAR_CAP - 1 } }));
  const r1 = await play(id, 'small-camp', { now: Date.parse('2026-10-01T00:00:00Z'), rng: seeded(2) });
  assert.ok(r1.run.won);
  assert.strictEqual((await getFarmUser(id)).clears['small-camp'], CLEAR_CAP);
  assert.ok(clearSouls(CLEAR_CAP) > 1);
  // a failed attempt takes one clear back off, never below none
  await require('../src/utils/farm/play').updateFarmUser(id, (r) => Object.assign(r, { earned: 0, tiers: {}, clears: { 'mid-boss': 3 } }));
  for (const [day, left] of [[2, 2], [3, 1], [4, 0], [5, 0]]) {
    const lost = await play(id, 'mid-boss', { now: Date.parse(`2026-10-0${day}T00:00:00Z`), rng: seeded(2) });
    assert.ok(!lost.run.won, 'a level 0 hero loses to the Mid-Boss');
    assert.strictEqual((await getFarmUser(id)).clears['mid-boss'], left);
  }
  await farm.update('old1', () => ({ hero: 'Haze', midbossKills: 4 })); // the first version counted only the Mid-Boss
  assert.strictEqual((await getFarmUser('old1')).clears['mid-boss'], 4);
});

test('progress is per hero: souls, level, tiers, items, cooldowns, lanes, growth, Rejuvs and buffs are saved under the hero (his calls, Oct 2 and Oct 11)', async () => {
  const { updateFarmUser, updateHero } = require('../src/utils/farm/play');
  const farm = require('../src/storage').getStore('farm');
  // a record from before progress was per hero: its level, tiers and items become its hero's; what was shared until Oct 11 too
  await farm.set('ph1', { hero: 'Haze', earned: 500, tiers: { 1: 1 }, items: { weapon: ['Rapid Rounds'] }, buffs: { fireRate: 2 }, rejuvs: 1, clears: { guardian: 3 }, cooldowns: { roam: 5 }, switchedAt: 9 });
  const before = await getFarmUser('ph1');
  assert.deepStrictEqual([before.earned, before.tiers, before.items.weapon, before.buffs, before.rejuvs, before.clears, before.cooldowns, before.souls], [500, { 1: 1 }, ['Rapid Rounds'], { fireRate: 2 }, 1, { guardian: 3 }, { roam: 5 }, 0]);
  await updateFarmUser('ph1', (r) => { r.earned += 100; });
  const saved = await farm.get('ph1');
  assert.deepStrictEqual(saved.heroes, { Haze: { earned: 600, tiers: { 1: 1 }, items: { weapon: ['Rapid Rounds'], vitality: [], spirit: [] }, cooldowns: { roam: 5 }, clears: { guardian: 3 }, rejuvs: 1, buffs: { fireRate: 2 } } });
  for (const k of ['earned', 'tiers', 'items', 'buffs', 'rejuvs', 'clears', 'cooldowns', 'down', 'bridge', 'souls', 'switchedAt']) assert.ok(!(k in saved), `nothing of the hero is left on the member (${k})`);
  // another hero starts from nothing and keeps its own; the first hero's progress waits untouched
  await farm.update('ph1', (r) => ({ ...r, hero: 'Abrams' }));
  const fresh = await getFarmUser('ph1');
  assert.deepStrictEqual([fresh.earned, fresh.tiers, fresh.items.weapon, fresh.buffs, fresh.rejuvs, fresh.clears, fresh.cooldowns, fresh.souls], [0, {}, [], {}, 0, {}, {}, 0]);
  await updateFarmUser('ph1', (r) => { r.earned = 40; r.souls = 7; r.cooldowns.roam = 99; });
  assert.deepStrictEqual([(await farm.get('ph1')).heroes.Haze.earned, (await farm.get('ph1')).heroes.Haze.cooldowns], [600, { roam: 5 }]);
  await farm.update('ph1', (r) => ({ ...r, hero: 'Haze' }));
  assert.strictEqual((await getFarmUser('ph1')).earned, 600);
  assert.deepStrictEqual((await farm.get('ph1')).heroes.Abrams, { earned: 40, tiers: {}, items: { weapon: [], vitality: [], spirit: [] }, souls: 7, cooldowns: { roam: 99 } });
  // updateHero edits a hero that is not the current one, without switching
  assert.strictEqual(await updateHero('ph1', 'Abrams', (h, r) => { h.souls += 3; return `${r.hero} ${h.souls}`; }), 'Haze 10');
  assert.deepStrictEqual([(await getFarmUser('ph1')).hero, (await farm.get('ph1')).heroes.Abrams.souls], ['Haze', 10]);
  // what was shared until Oct 11 goes to Haze (his call: the only hero anyone had played), even when another hero is the current one
  await farm.set('ph2', { hero: 'Abrams', heroes: { Haze: { earned: 900, tiers: {}, items: {} }, Abrams: { earned: 0, tiers: {}, items: {} } }, buffs: { fireRate: 1 }, rejuvs: 2, down: { 'guardian:york': 5 }, bridge: ['gun'], bestWave: 4, tokens: 1 });
  await updateFarmUser('ph2', () => {});
  const moved = await farm.get('ph2');
  assert.deepStrictEqual(moved.heroes.Haze, { earned: 900, tiers: {}, items: { weapon: [], vitality: [], spirit: [] }, down: { 'guardian:york': 5 }, rejuvs: 2, buffs: { fireRate: 1 }, bridge: ['gun'] });
  assert.deepStrictEqual([moved.heroes.Abrams.rejuvs, moved.bestWave, moved.tokens], [undefined, 4, 1], 'the best wave and tokens stay the member\'s');
});

test('camp Haunts roll a random trait that moves their resists, and bosses resist stuns and every kind of damage', () => {
  const traits = new Set();
  const bullets = new Set();
  for (let s = 1; s <= 60; s++) {
    const run = simulate('Haze', 'medium-camp', { rng: seeded(s * 7919) });
    for (const e of run.frames[0].enemies) { const m = e.name.match(/^(Armored|Warded|Ironclad|Brittle) /); traits.add(m ? m[1] : 'plain'); }
    bullets.add(run.frames[0].enemies.length);
  }
  assert.deepStrictEqual([...traits].sort(), ['Armored', 'Brittle', 'Ironclad', 'Warded', 'plain']);
  const { TARGETS, SIEGE } = require('../src/utils/farm/targets');
  const { Fight } = require('../src/utils/farm/engine');
  for (const [key, t] of Object.entries({ guardian: TARGETS.guardian, walker: TARGETS.walker, 'mid-boss': TARGETS['mid-boss'] })) {
    const e = t.enemies()[0];
    assert.ok(e.stats.spiritResist >= 0.25 && e.stats.bulletResist > 0 && e.stats.ccResist >= 0.5, `${key} resists everything`);
  }
  for (const stage of SIEGE.stages) assert.ok(stage.enemies()[0].stats.spiritResist >= 0.3, stage.name);
  const boss = TARGETS['mid-boss'].enemies()[0];
  const hero = require('../src/utils/farm/hero').buildHero('Haze');
  const f = new Fight({ heroes: [hero], enemies: [boss] });
  f.addStatus(boss, { id: 'sleep', duration: 4, tags: ['sleep'] });
  assert.ok(Math.abs(boss.statuses.find((x) => x.id === 'sleep').until - 1) < 1e-9, 'a 4 s sleep lasts 1 s on a boss that shrugs off 75%');
});

test('legendaries: 0.5% a kill in a won fight, their own slot on top of the 12, every one kept, and the slot changed at will', async () => {
  const { rollLegendary, LEGENDARY_NAMES, POOL, MAX_ITEMS } = require('../src/utils/farm/levels');
  const { dropLegendary, equipLegendary, updateFarmUser, switchHero } = require('../src/utils/farm/play');
  const { itemByName } = require('../src/utils/farm/stats');
  assert.strictEqual(LEGENDARY_NAMES.length, 17);
  assert.ok(LEGENDARY_NAMES.every((n) => itemByName(n)?.Tier === 5));
  assert.strictEqual(rollLegendary(0, () => 0), null, 'no kills, no roll');
  assert.strictEqual(rollLegendary(1000, () => 0.005), null, 'at the exclusive upper edge');
  assert.strictEqual(rollLegendary(1, () => 0.0049), LEGENDARY_NAMES[0], 'just below the chance');
  assert.strictEqual(rollLegendary(1, () => 0, [LEGENDARY_NAMES[0]]), LEGENDARY_NAMES[1], 'never one the hero has');
  assert.strictEqual(rollLegendary(5, () => 0, LEGENDARY_NAMES), null, 'a hero with all 17 gets no more');
  assert.strictEqual(rollLegendary(1, () => 0.049, [], 0.05), LEGENDARY_NAMES[0], 'a won siege: just below 5%');
  assert.strictEqual(rollLegendary(1, () => 0.05, [], 0.05), null, 'a won siege: just above 5%');
  // a won camp counts every enemy in it; a lost fight counts none
  const won = simulate('Haze', 'small-camp', { rng: () => 0.5, boons: 30, items: POOL.weapon.slice(0, 6) });
  assert.ok(won.won);
  assert.strictEqual(won.kills, won.frames.at(-1).enemies.length);
  assert.strictEqual(simulate('Haze', 'siege', { rng: () => 0.5 }).kills, 0);

  const id = 'legend';
  await chooseHero(id, 'Haze');
  await giveSouls(id, 1e6);
  const plain = POOL.weapon.filter((n) => !itemByName(n).Components?.length);
  for (const name of plain.slice(0, MAX_ITEMS)) await buyItem(id, name);
  // a full build: the first legendary goes into its own slot anyway, never into the 12
  assert.deepStrictEqual(await updateFarmUser(id, (r) => dropLegendary(r, 5, () => 0)), { name: LEGENDARY_NAMES[0], equipped: true });
  let r = await getFarmUser(id);
  assert.strictEqual(r.legendary, LEGENDARY_NAMES[0]);
  assert.strictEqual(Object.values(r.items).flat().length, MAX_ITEMS);
  assert.ok(!Object.values(r.items).flat().includes(LEGENDARY_NAMES[0]));
  // a second one is kept, the slot keeps the first until the member changes it
  assert.deepStrictEqual(await updateFarmUser(id, (x) => dropLegendary(x, 5, () => 0)), { name: LEGENDARY_NAMES[1], equipped: false });
  r = await getFarmUser(id);
  assert.deepStrictEqual([r.legendary, r.legendaries], [LEGENDARY_NAMES[0], [LEGENDARY_NAMES[0], LEGENDARY_NAMES[1]]]);
  assert.deepStrictEqual(await equipLegendary(id, LEGENDARY_NAMES[1]), { ok: true });
  assert.strictEqual((await getFarmUser(id)).legendary, LEGENDARY_NAMES[1]);
  assert.deepStrictEqual(await equipLegendary(id, LEGENDARY_NAMES[5]), { error: 'missing' }, 'only one it has got');
  assert.deepStrictEqual(await sellItem(id, LEGENDARY_NAMES[1]), { error: 'missing' }, 'never sold');
  // the hero screen draws it and offers the change (two of them)
  const screen = await views.heroView(member(id), await getFarmUser(id));
  const ids = screen.components.flatMap((row) => row.components.map((c) => c.data.custom_id));
  assert.ok(ids.includes(`${views.LEGEND_ID}:${id}`));
  // it belongs to the hero: another hero starts without one and can get its own
  await updateFarmUser(id, (x) => { x.heroes.Abrams = {}; });
  assert.ok((await switchHero(id, 'Abrams')).ok);
  r = await getFarmUser(id);
  assert.deepStrictEqual([r.legendary, r.legendaries], [null, []]);
  assert.ok(await updateFarmUser(id, (x) => dropLegendary(x, 1, () => 0)));
  assert.strictEqual((await getFarmUser(id)).heroes.Haze.legendary, LEGENDARY_NAMES[1]);
});

test('a legendary from before the legendary slot moves out of the 12 into its own slot', async () => {
  const { LEGENDARY_NAMES } = require('../src/utils/farm/levels');
  const { updateFarmUser } = require('../src/utils/farm/play');
  const id = 'legend-old';
  await chooseHero(id, 'Haze');
  await updateFarmUser(id, (r) => { r.items.weapon.push(LEGENDARY_NAMES[0], 'Headshot Booster'); r.legendary = LEGENDARY_NAMES[0]; delete r.legendaries; });
  const r = await getFarmUser(id);
  assert.deepStrictEqual([r.items.weapon, r.legendary, r.legendaries], [['Headshot Booster'], LEGENDARY_NAMES[0], [LEGENDARY_NAMES[0]]]);
});

test('buying with a full build: the item picked to sell goes, the new one comes, in one go; nothing is sold if the buy fails', async () => {
  const { POOL, MAX_ITEMS, sellPrice } = require('../src/utils/farm/levels');
  const { itemByName } = require('../src/utils/farm/stats');
  const id = 'room';
  await chooseHero(id, 'Haze');
  await giveSouls(id, 1e6);
  const plain = POOL.weapon.filter((n) => !itemByName(n).Components?.length);
  for (const name of plain.slice(0, MAX_ITEMS)) await buyItem(id, name);
  const next = plain[MAX_ITEMS];
  assert.deepStrictEqual(await buyItem(id, next), { error: 'full' });
  // the shop asks which item to sell for it
  const room = await views.shopView(member(id), await getFarmUser(id), 'weapon', Date.now(), itemByName(next).Tier, next, true);
  const ids = room.components.flatMap((row) => row.components.map((c) => c.data.custom_id));
  assert.ok(ids.includes(`${views.ROOM_ID}:${id}:weapon:${itemByName(next).Tier}:${next}`));
  const before = await heroSouls(id);
  const result = await buyItem(id, next, { sell: plain[0] });
  assert.ok(result.ok);
  assert.strictEqual(result.sold, plain[0]);
  const r = await getFarmUser(id);
  assert.ok(r.items.weapon.includes(next) && !r.items.weapon.includes(plain[0]));
  assert.strictEqual(r.souls, before + sellPrice(itemByName(plain[0])) - result.paid);
  // selling what you don't have, or a buy that can't go through, changes nothing
  assert.deepStrictEqual(await buyItem(id, plain[1 + MAX_ITEMS], { sell: 'Extra Health' }), { error: 'missing' });
  await changeRecord(id, (x) => { x.souls = 0; });
  assert.deepStrictEqual(await buyItem(id, plain[1 + MAX_ITEMS], { sell: plain[1] }), { error: 'souls' });
  assert.ok((await getFarmUser(id)).items.weapon.includes(plain[1]), 'the item is still there');
  // short on souls but a sale covers it: Buy stays lit
  const want = plain[1 + MAX_ITEMS];
  await changeRecord(id, (x) => { x.souls = itemByName(want).Cost - 1; });
  const shop = await views.shopView(member(id), await getFarmUser(id), 'weapon', Date.now(), itemByName(want).Tier, want);
  const buy = shop.components.flatMap((row) => row.components).find((c) => c.data.custom_id?.startsWith(`${views.BUY_ID}:`));
  assert.ok(!buy.data.disabled, 'Buy is lit when selling an item covers the price');
});

test('the item shop keeps the price picked when the tab changes', async () => {
  const id = 'tabs';
  await chooseHero(id, 'Haze');
  const shop = await views.shopView(member(id), await getFarmUser(id), 'weapon', Date.now(), 4);
  const ids = shop.components[0].components.map((c) => c.data.custom_id);
  assert.ok(ids.includes(`${views.SHOPTAB_ID}:${id}:spirit:4`));
  const spirit = await views.shopView(member(id), await getFarmUser(id), 'spirit', Date.now(), 4);
  assert.match(spirit.embeds[0].data.title, /Spirit\s+-\s+6,400/);
});
