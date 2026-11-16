// Descend's hero rooms and the Rift (his asks, Nov 6; server-plan.md "Hero Encounters"): who shows up, each approved deal, minions and the free-for-all.
process.env.DESCEND_V = '7'; // these checks are about the fixed rooms from before Two Doors (test/doors.test.js has the doors)
const test = require('./group')(__filename);
const assert = require('node:assert');
const D = require('../src/utils/farm/descent');
const { Fight, enemy } = require('../src/utils/farm/engine');
const { buildHero } = require('../src/utils/farm/hero');

const KIT = { weapon: ['Headshot Booster', 'Rapid Rounds'], vitality: ['Extra Health'], spirit: ['Extra Spirit', 'Mystic Burst'] };
const at = (pred) => { for (let seed = 1; seed < 2000; seed++) for (let room = 3; room < D.LAST_ROOM; room++) { const s = D.roomSpec(seed, room, 'Haze', 0, 7); if (pred(s)) return { seed, room }; } return null; };
const every = (pred, n) => { const out = []; for (let seed = 1; out.length < n && seed < 20000; seed++) for (let room = 3; room < D.LAST_ROOM; room++) if (pred(D.roomSpec(seed, room, 'Haze', 0, 7))) out.push({ seed, room }); return out; };
const run = (where, items = KIT) => Object.assign(D.newRun('Haze', where.seed), { room: where.room, level: 10, items: structuredClone(items) });
const visit = (deal) => run(at((s) => s.kind === 'visit' && s.deal === deal));

test('a rival room becomes, a third each, a rival, a wounded hero to assist or an approved interaction (version 4 runs only)', () => {
  const seen = { rival: 0, wounded: 0, visit: 0 };
  for (let seed = 1; seed <= 80; seed++) for (let room = 1; room < D.LAST_ROOM; room++) {
    const before = D.roomSpec(seed, room, 'Haze', 0, 3);
    assert.notStrictEqual(before.kind, 'visit', 'a version 3 run has none');
    if (before.kind !== 'rival') continue;
    const now = D.roomSpec(seed, room, 'Haze', 0, 4);
    seen[now.kind]++;
    if (now.kind === 'visit') assert.ok(now.hero !== 'Haze' && [].concat(D.VISITS[now.hero]).includes(now.deal));
    else if (now.kind === 'wounded') assert.ok(now.rival && now.rival !== 'Haze');
    else assert.strictEqual(now.kind, 'rival');
  }
  for (const [kind, n] of Object.entries(seen)) assert.ok(n > 40, `${kind} rooms turn up (${JSON.stringify(seen)})`);
});

test('Violet: an exact replica (same state, both copies work) or the original ruined; a full build asks what to give up first', () => {
  let made = 0, ruined = 0;
  for (const w of every((s) => s.kind === 'visit' && s.deal === 'replica', 40)) {
    const d = run(w);
    d.enhanced = ['Mystic Burst'];
    const r = D.eventAct(d, 'replica', 'Mystic Burst');
    assert.ok(r.ok && d.level === 11 && d.phase === 'offer');
    const copies = Object.values(d.items).flat().filter((n) => n === 'Mystic Burst').length;
    assert.ok(d.event.reveal, 'her try gets its own screen before the pick');
    if (r.success) { made++; assert.strictEqual(copies, 2); assert.deepStrictEqual(d.replicas, ['Mystic Burst'], 'her copy is painted'); assert.ok(d.enhanced.includes('Mystic Burst')); assert.strictEqual(buildHero('Haze', D.runKit(d)).items.filter((i) => i.name === 'Mystic Burst').length, 2); }
    else { ruined++; assert.strictEqual(copies, 0); assert.ok(!d.enhanced.includes('Mystic Burst')); }
  }
  assert.ok(made > 0 && ruined > 0, `both happen (${made} made, ${ruined} ruined)`);
  const full = visit('replica');
  full.items = { weapon: ['Headshot Booster', 'Rapid Rounds', 'Close Quarters', 'Monster Rounds'], vitality: ['Extra Health', 'Extra Regen', 'Extra Stamina', 'Healing Rite'], spirit: ['Extra Spirit', 'Mystic Burst', 'Extra Charge', 'Mystic Expansion'] };
  assert.ok(D.eventAct(full, 'replica', 'Extra Spirit').pick && full.phase === 'ready');
  assert.strictEqual(D.eventAct(full, 'replace', 'Extra Spirit').error, 'item', 'not the original');
  const done = D.eventAct(full, 'replace', 'Extra Stamina');
  assert.ok(done.ok && Object.values(full.items).flat().length <= 12 && !full.replicaPick);
});

test('one copy of a duplicate leaves at a time; its corruption goes with it, the rest of its state stays', () => {
  for (const w of every((s) => s.kind === 'visit' && s.deal === 'replica', 40)) {
    const d = run(w);
    d.items = { weapon: ['Headshot Booster', 'Rapid Rounds', 'Close Quarters', 'Monster Rounds'], vitality: ['Extra Health', 'Extra Regen', 'Extra Stamina', 'Healing Rite'], spirit: ['Extra Spirit', 'Mystic Burst', 'Mystic Burst', 'Extra Charge'] };
    d.corrupted = [{ name: 'Mystic Burst', drawback: 'x', amount: 1 }, { name: 'Mystic Burst', drawback: 'x', amount: 1 }];
    d.enhanced = ['Mystic Burst'];
    D.eventAct(d, 'replica', 'Extra Spirit');
    const r = D.eventAct(d, 'replace', 'Mystic Burst');
    if (!r.success) continue;
    assert.deepStrictEqual(d.items.spirit.filter((x) => x === 'Mystic Burst'), ['Mystic Burst']);
    assert.strictEqual(d.corrupted.length, 1);
    assert.ok(d.enhanced.includes('Mystic Burst'));
    break;
  }
});

test('McGinnis: an upgrade you aim (10% of current health, win or fail) or the item turns Fragile; her help trades an item for a floor-long Mini Turret', () => {
  let up = 0, broke = 0, asked = 0;
  for (const w of every((s) => s.kind === 'visit' && s.deal === 'upgrade', 30)) {
    const d = run(w);
    const hp = d.health;
    let r = D.eventAct(d, 'upgrade', 'Extra Spirit');
    assert.ok(r.ok);
    if (r.pick) { // several items to try for: asked next, nothing spent yet
      asked++;
      assert.strictEqual(d.health, hp);
      assert.strictEqual(D.eventAct(d, 'into', 'Extra Spirit').error, 'item');
      r = D.eventAct(d, 'into', D.upgradesOf(d, 'Extra Spirit')[0]);
      assert.ok(r.ok && !r.pick);
    }
    assert.ok(Math.abs(d.health - hp * (1 - D.UPGRADE_COST)) < 1e-9, 'costs a tenth of the current health either way');
    if (r.success) { up++; assert.ok(!Object.values(d.items).flat().includes('Extra Spirit') && Object.values(d.items).flat().includes(r.into)); }
    else { broke++; assert.ok(d.fragile.includes('Extra Spirit')); }
  }
  assert.ok(up > 0 && broke > 0);
  const help = visit('turret');
  assert.strictEqual(D.eventAct(help, 'turret', 'Headshot Booster').error, undefined);
  assert.ok(help.minions[0].floor && !help.minions[0].fights, 'lasts the floor, not a few fights');
  assert.ok(!Object.values(help.items).flat().includes('Headshot Booster'));
  // her other two jobs: enhance (Tinker's odds, a fail does nothing) and repair a Fragile item (always), both 10% of the health
  let enhanced = 0, failed = 0;
  for (const w of every((s) => s.kind === 'visit' && s.deal === 'upgrade', 30)) {
    const d = run(w);
    const hp = d.health;
    const r = D.eventAct(d, 'enhance', 'Extra Spirit');
    assert.ok(r.ok && Math.abs(d.health - hp * (1 - D.UPGRADE_COST)) < 1e-9);
    if (r.success) { enhanced++; assert.ok(d.enhanced.includes('Extra Spirit')); } else { failed++; assert.ok(!(d.enhanced ?? []).includes('Extra Spirit')); }
  }
  assert.ok(enhanced > 0 && failed > 0);
  // the flow in the room: pick an Item (a dropdown), then a button decides what she does with it
  const flow = visit('upgrade');
  assert.strictEqual(D.eventAct(flow, 'item', 'Not An Item').error, 'item');
  assert.ok(D.eventAct(flow, 'item', 'Extra Spirit').pick && flow.tinkerPick === 'Extra Spirit');
  assert.ok(D.workables(flow).includes('Extra Spirit'));
  const done = D.eventAct(flow, 'enhance');
  assert.ok(done.ok && !flow.tinkerPick);
  const mend = visit('upgrade');
  mend.fragile = ['Extra Spirit'];
  assert.strictEqual(D.eventAct(mend, 'enhance', 'Extra Spirit').error, 'item', 'a Fragile item is repaired first, not enhanced');
  assert.strictEqual(D.eventAct(mend, 'repair', 'Extra Spirit').success, true);
  assert.deepStrictEqual(mend.fragile, []);
  assert.strictEqual(D.eventAct(visit('upgrade'), 'repair', 'Extra Spirit').error, 'item', 'nothing Fragile to repair');
});

test('Graves, Sinclair, Paige, Solomon: Accept lends, Castling offers 3 of the same tier in another slot, Turn Down passes', () => {
  for (const n of [1, 2, 3]) { // Graves: how many Ghouls, each 5% of the current health (his call, Nov 7)
    const g = Object.assign(visit('ghouls'), { health: 0.8 });
    const r = D.eventAct(g, `ghouls-${n}`);
    assert.ok(r.ok && g.minions[0].kind === 'ghoul' && g.minions[0].count === n && g.level === 11 && g.phase === 'offer');
    assert.ok(Math.abs(g.health - 0.8 * (1 - 0.05 * n)) < 1e-9, `${n} Ghouls cost ${5 * n}% of 80%`);
    assert.deepStrictEqual([r.count, r.from, r.to], [n, 0.8, g.health]);
    assert.ok(g.minions[0].floor === D.specOf(g).floor && !('fights' in g.minions[0]), 'they stay for the floor, not for a number of fights');
  }
  { // one Ghoul a click: the room stays until the third, 'done' ends it early (needs one), each costs 5% of what is left
    const g = Object.assign(visit('ghouls'), { health: 0.8 });
    assert.ok(D.eventAct(g, 'done').error, 'nothing summoned yet');
    const first = D.eventAct(g, 'ghoul');
    assert.ok(first.pick && g.phase === 'ready' && g.minions[0].count === 1 && Math.abs(g.health - 0.8 * 0.95) < 1e-9);
    assert.ok(D.eventAct(g, 'ghoul').pick && g.minions[0].count === 2);
    const last = D.eventAct(g, 'ghoul');
    assert.ok(last.ok && !last.pick && g.minions[0].count === 3 && g.phase === 'offer' && g.level === 11);
    assert.deepStrictEqual([last.count, last.from], [3, 0.8]);
    assert.ok(Math.abs(g.health - 0.8 * 0.95 ** 3) < 1e-9);
    const early = Object.assign(visit('ghouls'), { health: 1 });
    D.eventAct(early, 'ghoul');
    const done = D.eventAct(early, 'done');
    assert.ok(done.ok && done.count === 1 && early.phase === 'offer' && !('ghoulFrom' in early));
  }
  const bad = visit('ghouls');
  assert.ok(D.eventAct(bad, 'ghouls-4').error && D.eventAct(bad, 'ghouls-0').error && !bad.minions && bad.health === 1, 'only 1 to 3, and nothing is paid for a refused one');
  const s = visit('assistant');
  assert.ok(D.eventAct(s, 'accept').ok && s.assistant.fights === D.ASSISTANT.fights);
  const p = visit('plot');
  assert.ok(D.eventAct(p, 'accept').ok && p.plotArmor);
  const c = visit('castling');
  const r = D.eventAct(c, 'castling', 'Rapid Rounds');
  assert.ok(r.ok && c.offer.castling === 'Rapid Rounds' && c.offer.choices.length === 3);
  for (const n of c.offer.choices) assert.ok(require('../src/utils/farm/stats').itemByName(n).Slot !== 'Weapon');
  const t = visit('ghouls');
  assert.ok(D.eventAct(t, 'leave').ok && !t.minions && t.level === 11);
});

test('Solomon: the Item is gone, the pick of 3 is its tier in other slots, taking one ends the room with the level', () => {
  const c = visit('castling');
  const { itemByName } = require('../src/utils/farm/stats');
  const tier = itemByName('Rapid Rounds').Tier;
  assert.ok(D.eventAct(c, 'castling', 'Not An Item').error, 'only a held Item');
  assert.ok(D.eventAct(c, 'castling', 'Rapid Rounds').ok);
  assert.ok(!c.items.weapon.includes('Rapid Rounds') && c.level === 11 && c.phase === 'offer', 'it left the build; the level is paid');
  for (const n of c.offer.choices) assert.ok(itemByName(n).Tier === tier && itemByName(n).Slot !== 'Weapon');
  const got = c.offer.choices[1];
  const took = D.takeChoice(c, 1);
  assert.ok(took.ok && took.name === got && c.phase === 'ready' && !c.offer);
  assert.ok(Object.values(c.items).flat().includes(got), 'the new Item is in the build');
  assert.ok(!c.items.weapon.includes('Rapid Rounds'));
});

test('McGinnis: her try gets a result screen (reveal) with the Gloat face on a success and the Critical face on a fail', () => {
  const win = visit('upgrade');
  D.eventAct(win, 'enhance', 'Extra Spirit');
  assert.ok(win.event.reveal && win.event.hero === 'McGinnis' && win.event.mood === (win.event.success ? 'gloat' : 'critical'));
  const fixed = visit('upgrade');
  fixed.fragile = ['Extra Spirit'];
  D.eventAct(fixed, 'repair', 'Extra Spirit');
  assert.ok(fixed.event.reveal && fixed.event.mood === 'gloat');
  const up = visit('upgrade');
  const r = D.eventAct(up, 'upgrade', 'Extra Spirit');
  assert.ok(r.ok && up.event.reveal && up.event.mood === (up.event.success ? 'gloat' : 'critical'));
});

test("Victor's Abomination: two Items, a chance by tiers; a success fuses them into one slot, a fail leaves both Fragile", () => {
  const { itemByName } = require('../src/utils/farm/stats');
  const places = every((s) => s.kind === 'visit' && s.deal === 'fuse', 40);
  assert.ok(places.length, 'Victor can show up');
  const stitch = (where, a = 'Rapid Rounds', b = 'Extra Spirit') => {
    const d = run(where);
    assert.ok(D.eventAct(d, 'fuse').error, 'nothing picked yet');
    assert.ok(D.eventAct(d, 'fuseA', 'Not An Item').error);
    assert.ok(D.eventAct(d, 'fuseA', a).pick && d.fusePick.a === a);
    assert.ok(D.eventAct(d, 'fuseB', a).error, 'not the same Item twice');
    assert.ok(D.eventAct(d, 'fuse').error, 'the second is missing');
    assert.ok(D.eventAct(d, 'fuseB', b).pick && d.fusePick.b === b);
    return { d, r: D.eventAct(d, 'fuse') };
  };
  assert.ok(Math.abs(D.fuseChance('Extra Health', 'Extra Health') - 0.9) < 1e-9);
  assert.ok(D.fuseChance('Improved Spirit', 'Improved Spirit') < 0.9 && D.fuseChance('Improved Spirit', 'Improved Spirit') >= 0.2);
  let win; let lose;
  for (const where of places) {
    const out = stitch(where);
    if (out.r.success) win ??= out; else lose ??= out;
    assert.ok(out.r.ok && out.d.level === 11 && out.d.phase === 'offer' && out.d.event.reveal && !out.d.fusePick);
    assert.strictEqual(out.d.event.mood, out.r.success ? 'gloat' : 'critical');
  }
  assert.ok(win, 'a success happens (needs luck on the seeds)');
  const { d } = win;
  assert.deepStrictEqual(d.fused, [['Rapid Rounds', 'Extra Spirit']]);
  assert.ok(d.items.weapon.includes('Rapid Rounds') && d.items.spirit.includes('Extra Spirit'), 'both stay in the build and keep working');
  assert.strictEqual(D.slotsUsed(d), 4, '5 Items, one pair: 4 slots');
  assert.ok(!D.fragileOf(d).length);
  assert.ok(!D.replicables(d).includes('Rapid Rounds') && !D.parts(d).includes('Extra Spirit') && !D.dealerItems(d).includes('Rapid Rounds'), 'the other deals leave a fusion alone');
  const kit = D.runKit(d);
  assert.ok(kit.items.includes('Rapid Rounds') && kit.items.includes('Extra Spirit'), 'both reach the fight');
  const full = structuredClone(d); // an upgrade of one part takes its place in the fusion
  const up = D.addItem(full, 'Improved Spirit');
  assert.ok(up.ok && up.used.includes('Extra Spirit') && full.fused.some((p) => p.includes('Improved Spirit') && p.includes('Rapid Rounds')));
  const gone = structuredClone(d); // giving a part up for room takes its partner too; losing one on its own ends the fusion
  D.dropItem(gone, 'Extra Spirit');
  assert.ok(!gone.fused && gone.items.weapon.includes('Rapid Rounds'));
  if (lose) {
    assert.deepStrictEqual([...D.fragileOf(lose.d)].sort(), ['Extra Spirit', 'Rapid Rounds']);
    assert.ok(!lose.d.fused && lose.d.items.weapon.includes('Rapid Rounds') && lose.d.items.spirit.includes('Extra Spirit'), 'a fail keeps both Items');
  }
  const { POOL } = require('../src/utils/farm/levels');
  const other = (slot, n, skip) => POOL[slot].filter((x) => itemByName(x).Tier === 1 && !skip.includes(x)).slice(0, n);
  const crowded = structuredClone(d); // 13 Items with one fusion = all 12 slots used
  crowded.items = { weapon: ['Rapid Rounds', ...other('weapon', 4, ['Rapid Rounds'])], vitality: other('vitality', 4, []), spirit: ['Extra Spirit', ...other('spirit', 3, ['Extra Spirit'])] };
  crowded.fused = [['Rapid Rounds', 'Extra Spirit']];
  assert.strictEqual(D.slotsUsed(crowded), 12);
  const held = Object.values(crowded.items).flat();
  const fresh = Object.values(POOL).flat().find((n) => !held.includes(n) && itemByName(n).Tier === 1 && D.addItem(structuredClone(crowded), n).error === 'full');
  assert.ok(fresh, 'a full build refuses one more');
  const swapped = structuredClone(crowded);
  assert.ok(D.addItem(swapped, fresh, 'Extra Spirit').ok && !swapped.fused && !swapped.items.weapon.includes('Rapid Rounds'), 'a fused part given up takes its partner too');
  assert.strictEqual(D.slotsUsed(swapped), 12, 'the pair held one slot; the new Item takes it');
  const picked = Object.assign(structuredClone(crowded), { phase: 'offer', offer: { kind: 'items', choices: [fresh], enhanced: [], room: crowded.room, roll: 0 } });
  assert.ok(D.takeChoice(picked, 0, 'Extra Spirit').ok && !picked.fused, 'the pick screen ends the fusion too (it used to stay and break the Hero card)');
});

test('a fused pair is drawn as his stitched template: A left of the scar, B right of it (fuseStitch.js, his pick Nov 7)', async () => {
  const { createCanvas } = require('@napi-rs/canvas');
  const { fusedTile } = require('../src/utils/farm/fuseStitch');
  const c = createCanvas(100, 100);
  const g = c.getContext('2d');
  await fusedTile(g, 0, 0, 100, { art: null, tile: ['#ff0000', '#ff0000'], rgb: '255,0,0' }, { art: null, tile: ['#0000ff', '#0000ff'], rgb: '0,0,255' });
  const px = (x, y) => [...g.getImageData(x, y, 1, 1).data];
  assert.ok(px(12, 50)[0] > 200 && px(12, 50)[2] < 60, 'the left half is A');
  assert.ok(px(88, 50)[2] > 200 && px(88, 50)[0] < 60, 'the right half is B');
  // the Hero card with fusions, marks on each half and Violet's spare copy of a fused Item draws without error
  const d = Object.assign(D.newRun('Victor', 7), { level: 5, room: 6, items: { weapon: ['Rapid Rounds', 'Toxic Bullets', 'Toxic Bullets'], vitality: ['Extra Health'], spirit: ['Extra Spirit', 'Mystic Burst'] } });
  Object.assign(d, { fused: [['Rapid Rounds', 'Extra Spirit'], ['Toxic Bullets', 'Mystic Burst']], enhanced: ['Extra Spirit'], fragile: ['Mystic Burst'], replicas: ['Toxic Bullets'] });
  assert.ok((await require('../src/utils/farm/descentViews').runCard(d)).length > 10000);
});

test("Paradox's Time Capsule: a cooldown Item leaves, keeps its slot, returns at a random room before the floor ends with 10% less cooldown a room away", () => {
  const { itemByName } = require('../src/utils/farm/stats');
  const places = every((s) => s.kind === 'visit' && s.deal === 'capsule', 60);
  assert.ok(places.length, 'Paradox can show up');
  const items = { weapon: ['Headshot Booster', 'Rapid Rounds'], vitality: ['Extra Health'], spirit: ['Extra Spirit'] };
  const backs = new Set();
  for (const where of places) {
    const d = run(where, structuredClone(items));
    assert.deepStrictEqual(D.capsulables(d), ['Headshot Booster'], 'only an Item with a cooldown');
    assert.ok(D.eventAct(d, 'capsule', 'Extra Spirit').error && D.eventAct(d, 'capsule', 'Rapid Rounds').error);
    const used = D.slotsUsed(d);
    assert.ok(D.eventAct(d, 'capsule', 'Headshot Booster').ok && d.level === 11 && d.phase === 'offer');
    const c = d.capsule;
    const boss = Math.ceil(where.room / 5) * 5;
    assert.ok(!d.items.weapon.includes('Headshot Booster') && D.slotsUsed(d) === used, 'gone from the build, its slot kept');
    assert.ok(c.from === where.room && c.back > where.room && c.back <= boss, 'it returns before the floor ends');
    assert.ok(!D.runKit(d).items.includes('Headshot Booster'));
    backs.add(c.back - where.room);
  }
  assert.ok(backs.size > 1, 'the return room varies');
  // the return: through roomPassed (every passed room), the multiplier is 1 - 10% x rooms away
  const d = run(places[0], structuredClone(items));
  D.eventAct(d, 'capsule', 'Headshot Booster');
  d.fragile = []; d.enhanced = ['Rapid Rounds'];
  const { back, from } = d.capsule;
  D.roomPassed(d, back - 1 >= from ? back - 1 : back); // before its room: still away unless it is the first
  if (back - 1 > from) assert.ok(d.capsule);
  D.roomPassed(d, back);
  assert.ok(!d.capsule && d.items.weapon.includes('Headshot Booster') && d.returned.item === 'Headshot Booster');
  assert.strictEqual(d.itemCd['Headshot Booster'], Math.max(0.2, +(1 - 0.1 * (back - from)).toFixed(2)));
  assert.ok(D.runKit(d).itemCd['Headshot Booster'] < 1 && D.runKit(d).items.includes('Headshot Booster'));
  // the cooldown really is shorter in the hero's hands
  const { buildHero } = require('../src/utils/farm/hero');
  const plain = buildHero('Haze', { items: ['Headshot Booster'] }).items[0];
  const quick = buildHero('Haze', { items: ['Headshot Booster'], itemCd: { 'Headshot Booster': 0.5 } }).items[0];
  assert.ok(Math.abs(quick.cooldown - plain.cooldown * 0.5) < 1e-9);
  // dropping it forgets the bonus; it is not offered again while it is away
  D.dropItem(d, 'Headshot Booster');
  assert.ok(!d.itemCd['Headshot Booster']);
  const away = run(places[0], structuredClone(items));
  D.eventAct(away, 'capsule', 'Headshot Booster');
  assert.ok(D.heldDeals(away).includes('capsule') && D.capsulables(away).length === 0);
  // Fragile / Enhanced state travels with the Item and comes back with it
  const state = run(places[0], structuredClone(items));
  state.enhanced = ['Headshot Booster']; state.fragile = ['Headshot Booster'];
  D.eventAct(state, 'capsule', 'Headshot Booster');
  assert.ok(!state.enhanced.includes('Headshot Booster') && !D.fragileOf(state).includes('Headshot Booster'));
  D.roomPassed(state, state.capsule.back);
  assert.ok(state.enhanced.includes('Headshot Booster') && D.fragileOf(state).includes('Headshot Booster'));
});

test("Paradox's Time Capsule: a legendary shatters out, and its cooldown is rerolled, better or worse", () => {
  const places = every((s) => s.kind === 'visit' && s.deal === 'capsule', 80);
  const levels = new Set();
  const named = [...require('../src/utils/farm/levels').LEGENDARY_NAMES].find((n) => D.hasCooldown(n));
  assert.ok(named, 'a legendary with a cooldown exists');
  let worse = 0; let better = 0;
  for (const where of places) {
    const d = Object.assign(run(where), { legendary: named });
    assert.ok(D.capsulables(d).includes(named), 'the legendary is allowed in the capsule');
    assert.ok(D.eventAct(d, 'capsule', named).legendary && !d.legendary && D.runKit(d).items.every((n) => n !== named));
    assert.ok(d.capsule.legendary);
    D.roomPassed(d, d.capsule.back);
    assert.strictEqual(d.legendary, named);
    const m = d.itemCd[named];
    assert.ok(m >= 0.5 && m <= 1.3, 'the roll is between 50% and 130% of its cooldown');
    if (m > 1) worse++; else better++;
    levels.add(m);
  }
  assert.ok(worse > 0 && better > 0 && levels.size > 3, 'it can come back better or worse, whatever the time away');
});

test("Mirage's Traveler: you pick the next room's type; never the room before a boss, never with the Urn, the Broker only from room 6", () => {
  const rooms = every((s) => s.kind === 'visit' && s.deal === 'travel', 80);
  assert.ok(rooms.length, 'Mirage can show up');
  for (const where of rooms) assert.notStrictEqual(where.room % 5, 4, 'never in the room before a boss (the boss cannot be replaced)');
  for (let seed = 1; seed < 400; seed++) for (const room of [4, 9, 14, 19, 24, 29, 34]) {
    const s = D.roomSpec(seed, room, 'Haze', 0, 5);
    assert.ok(!(s.kind === 'visit' && s.deal === 'travel'), 'the room before a boss is never Mirage');
  }
  let early; let later;
  for (const where of rooms) { if (where.room < 5) early ??= where; else later ??= where; }
  const go = (where, kind, tweak = (d) => d) => {
    const d = tweak(run(where));
    const next = D.specOf(d, where.room + 1).kind;
    const r = D.eventAct(d, 'travel', kind);
    return { d, r, next };
  };
  const base = run(rooms[0]);
  const kinds = D.travelKinds(base, rooms[0].room);
  assert.ok(kinds.length >= 4 && kinds.every((k) => D.TELEPORT_TO.includes(k)));
  assert.ok(!kinds.includes(D.specOf(base, rooms[0].room + 1).kind), 'not the kind the next room already is');
  const kind = kinds[0];
  const done = go(rooms[0], kind);
  assert.ok(done.r.ok && done.d.level === 11 && done.d.phase === 'offer' && done.d.room === rooms[0].room + 1);
  assert.strictEqual(D.specOf(done.d).kind, kind, 'the next room is the type picked');
  assert.strictEqual(D.specOf(done.d, rooms[0].room + 2).kind, D.specOf(run(rooms[0]), rooms[0].room + 2).kind, 'only the next room changes');
  assert.ok(D.eventAct(run(rooms[0]), 'travel', 'fight').error && D.eventAct(run(rooms[0]), 'travel', 'nope').error, 'only the no-fight rooms');
  assert.strictEqual(D.eventAct(Object.assign(run(rooms[0]), { urn: { left: 2 } }), 'travel', kind).error, 'carrying', 'the Urn carrier cannot be teleported');
  assert.ok(!D.travelKinds(Object.assign(run(rooms[0]), { ally: { hero: 'Abrams', kit: {}, left: 2 } }), rooms[0].room).includes('wounded'), 'no wounded hero while one fights with you');
  if (early) assert.ok(!D.travelKinds(run(early), early.room).includes('broker'), "the Broker's stall only from room 6 on");
  if (later) assert.ok(D.travelKinds(run(later), later.room).length >= 4);
  assert.ok(D.eventAct(run(rooms[0]), 'leave').ok, 'Turn Down still works');
});

test("Rem's Lil Helper: feed it an Item to take it, then the offered Items you are not taking; the slot picks the stat, 2% a tier, the aura is capped", () => {
  const { itemByName } = require('../src/utils/farm/stats');
  const { buildHero } = require('../src/utils/farm/hero');
  const rooms = every((s) => s.kind === 'visit' && s.deal === 'helper', 30);
  assert.ok(rooms.length, 'Rem can show up');
  const items = { weapon: ['Headshot Booster', 'Rapid Rounds'], vitality: ['Extra Health'], spirit: ['Extra Spirit', 'Mystic Burst'] };
  const d = run(rooms[0], structuredClone(items));
  assert.ok(D.eventAct(d, 'helper', 'Not An Item').error && !D.helperOf(d), 'only one of your Items');
  const used = D.slotsUsed(d);
  assert.ok(D.eventAct(d, 'helper', 'Extra Spirit').ok && d.level === 11 && d.phase === 'offer');
  assert.ok(!d.items.spirit.includes('Extra Spirit') && D.slotsUsed(d) === used - 1, 'the Item is given up for good');
  const h = D.helperOf(d);
  assert.deepStrictEqual([h.w ?? 0, h.v ?? 0, h.s, h.count], [0, 0, 1, 1], 'a Tier 1 Spirit Item: 1 tier point of aura');
  assert.ok(Math.abs(D.helperAura(d) - (1 - 0.98 * 0.98)) < 1e-9, '2% to start, then 2% of the rest a tier point');
  assert.ok(D.heldDeals(d).includes('helper'), 'not offered again while it lives');
  // the aura really lowers the damage a hero takes
  const plain = buildHero('Haze', {});
  const aura = buildHero('Haze', { aura: 0.12 });
  assert.ok(aura.stats.bulletResist > plain.stats.bulletResist && aura.stats.spiritResist > plain.stats.spiritResist);
  assert.strictEqual(D.runKit(d).aura, D.helperAura(d));
  // feeding on the pick screen: the Items you are not taking, one always stays
  const first = d.offer.choices.length;
  assert.ok(first >= 2);
  const name = d.offer.choices[0];
  const slotKey = { Weapon: 'w', Armor: 'v', Tech: 's' }[itemByName(name).Slot];
  const before = h[slotKey] ?? 0;
  const fed = D.feedOffer(d, 0);
  assert.ok(fed.ok && fed.pick && fed.name === name && d.offer.choices.length === first - 1 && !d.offer.choices.includes(name));
  assert.strictEqual(h[slotKey], before + Math.min(4, itemByName(name).Tier), 'its tier in points on the stat its slot picks');
  assert.ok(D.takeChoice(d, 0).ok, 'what is left can still be taken');
  assert.ok(D.feedOffer(d, 0).error, 'no pick open any more');
  const all = Object.assign(visit('helper'), { items: structuredClone(items) }); // no limit: feed every offered Item and the pick is over
  D.eventAct(all, 'helper', 'Extra Spirit');
  const n = all.offer.choices.length;
  let last;
  for (let i = 0; i < n; i++) last = D.feedOffer(all, 0);
  assert.ok(last.ok && last.done && !all.offer && all.phase === 'ready' && all.fedAll.names.length === n, 'feeding them all ends the pick');
  // the aura is capped, and the pet's stats grow with what it was fed
  D.helperOf(d).s = 100; // (taking a pick clones the run, so look it up again)
  assert.ok(D.helperAura(d) > 0.8 && D.helperAura(d) < 1, 'no cap, but never a plain 100%');
  D.helperOf(d).s = 1;
  assert.ok(Math.abs(D.helperAura(d) - (1 - 0.98 * 0.98)) < 1e-9, '2% to start, 2% of the rest for each tier point');
  const spec = D.specOf(d, 3);
  const small = D.minionUnits({ minions: [{ kind: 'helper', count: 1, w: 0, v: 0, s: 0 }] }, spec)[0];
  const big = D.minionUnits({ minions: [{ kind: 'helper', count: 1, w: 25, v: 50, s: 0 }] }, spec)[0];
  assert.ok(Math.abs(big.stats.maxHealth / small.stats.maxHealth - 2) < 1e-9, '50 tier points of health: +100%');
  assert.ok(Math.abs(big.stats.dps / small.stats.dps - 1.5) < 1e-9, '25 tier points of damage: +50%');
  // it stays until it falls (no fights, no floor), and a dead one is gone with its aura
  const stay = Object.assign(D.newRun('Haze', 1), { minions: [{ kind: 'helper', count: 1, v: 2 }] });
  D.afterMinions(stay, { minionsLeft: [true] }, { kind: 'boss', room: 5 });
  assert.ok(D.helperOf(stay), 'a boss does not take it');
  D.afterMinions(stay, { minionsLeft: [false] }, { kind: 'fight', room: 6 });
  assert.ok(!D.helperOf(stay) && D.helperAura(stay) === 0, 'it fell');
  assert.ok(D.eventAct(run(rooms[0], structuredClone(items)), 'leave').ok, 'Turn Down still works');
});

test("Dynamo's Lesson: study an enemy kind of the next floor; the hero's grade (the health kept) sets how much it helps, for that floor only", () => {
  const rooms = every((s) => s.kind === 'visit' && s.deal === 'lesson', 60);
  assert.ok(rooms.length, 'Dynamo can show up');
  for (const where of rooms) assert.ok(Math.ceil(where.room / 5) < D.FLOORS, 'never on the last floor: there is no next floor below it');
  assert.deepStrictEqual(D.GRADES.map((g) => g.letter), ['A', 'B', 'C', 'D', 'F']);
  assert.ok(D.GRADES.every((g, i) => i === 0 || g.power < D.GRADES[i - 1].power && g.min < D.GRADES[i - 1].min), 'a better grade is a stronger lesson');
  const at = (health) => Object.assign(run(rooms[0]), { health });
  assert.deepStrictEqual([1, 0.7, 0.5, 0.3, 0.05].map((h) => D.gradeOf(at(h)).letter), ['A', 'B', 'C', 'D', 'F'], 'the health kept is the grade');
  const where = rooms[0];
  const floor = Math.ceil(where.room / 5);
  const kinds = D.lessonKinds(where.room);
  assert.deepStrictEqual(kinds, [...new Set(D.FLOOR_ENEMIES[floor])], 'the kinds of the NEXT floor');
  assert.ok(kinds.length >= 1);
  const d = at(0.7);
  assert.ok(D.eventAct(d, 'lesson', 'not-a-kind').error);
  const r = D.eventAct(d, 'lesson', kinds[0]);
  assert.ok(r.ok && r.grade === 'B' && r.power === 0.28 && d.level === 11 && d.phase === 'offer');
  assert.ok(d.event.reveal && d.event.mood === 'gloat' && d.event.grade === 'B', 'his result screen: a good grade is a Gloat');
  assert.deepStrictEqual([d.lesson.floor, d.lesson.kind], [floor + 1, kinds[0]]);
  assert.strictEqual(D.runKit(d).lesson, null, 'nothing yet on this floor');
  assert.ok(D.heldDeals(d).includes('lesson'), 'one at a time');
  const below = { ...d, room: (floor) * 5 + 2 };
  assert.deepStrictEqual(D.runKit(below).lesson, { kinds: [kinds[0]], deal: 0.28, take: 0.28 }, 'in force on the next floor');
  assert.strictEqual(D.runKit({ ...d, room: (floor + 1) * 5 + 2 }).lesson, null, 'and not the floor after');
  D.roomPassed(d, floor * 5 + 3);
  assert.ok(d.lesson, 'not over before that floor ends');
  D.roomPassed(d, (floor + 1) * 5);
  assert.ok(!d.lesson, "its floor's boss beaten: over");
  assert.strictEqual(D.eventAct(at(0.05), 'lesson', kinds[0]).power, 0.06);
  assert.strictEqual(D.eventAct(Object.assign(at(0.05)), 'lesson', kinds[0]) && at(0.05).event?.mood, undefined);
  const weak = at(0.05); D.eventAct(weak, 'lesson', kinds[0]);
  assert.strictEqual(weak.event.mood, 'critical', 'a poor grade is his Critical face');
  const mid = at(0.5); D.eventAct(mid, 'lesson', kinds[0]);
  assert.ok(!mid.event.mood, 'a middling one is his plain card');
  // the engine: the studied kind takes more from the hero and deals less to it; other kinds are untouched
  const hit = (kind, lesson) => {
    const hero = buildHero('Haze', { boons: 10, unlocked: 4, ...(lesson && { lesson }) });
    const foe = enemy('Foe', { maxHealth: 1e6, dps: 50 });
    foe.kind = kind;
    const f = new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.5 });
    const before = hero.health;
    f.run(10);
    return { dealt: 1e6 - foe.health, taken: before - hero.health };
  };
  const plain = hit('tank', null);
  const studied = hit('tank', { kinds: ['tank'], deal: 0.5, take: 0.5 });
  const other = hit('glass', { kinds: ['tank'], deal: 0.5, take: 0.5 });
  assert.ok(Math.abs(studied.dealt / plain.dealt - 1.5) < 0.05, 'the hero deals 50% more to the studied kind');
  assert.ok(Math.abs(studied.taken / plain.taken - 0.5) < 0.05, 'and takes 50% less from it');
  assert.ok(Math.abs(other.dealt / plain.dealt - 1) < 0.05 && Math.abs(other.taken / plain.taken - 1) < 0.05, 'other kinds are untouched');
  assert.ok(D.unitsOf({ room: 3, ascension: 0, groups: [{ type: 'tank' }] }).every((u) => u.kind === 'tank'), 'a room enemy knows its kind');
});

test("Sinclair's Assistant is free: Accept costs nothing, its shots add damage in a fight, and it goes after its fights", () => {
  const s = visit('assistant');
  const hp = s.health;
  assert.ok(D.eventAct(s, 'accept').ok && s.health === hp && s.assistant.fights === D.ASSISTANT.fights && s.level === 11 && s.phase === 'offer');
  const hit = (echo) => {
    const hero = buildHero('Haze', { boons: 10, unlocked: 4 });
    if (echo) hero.echo = echo;
    const foe = enemy('Brute', { maxHealth: 1e6, dps: 0 });
    const fight = new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.5 });
    fight.run(10);
    return 1e6 - foe.health;
  };
  assert.ok(hit(D.ASSISTANT.echo) > hit(0) * 1.15, "the Assistant's shots add to the hero's damage");
  const run = Object.assign(D.newRun('Haze', 1), { assistant: { fights: 2 } });
  D.afterMinions(run, {}, { kind: 'fight', room: 3 });
  assert.equal(run.assistant.fights, 1);
  D.afterMinions(run, {}, { kind: 'fight', room: 4 });
  assert.ok(!run.assistant, 'gone after its last fight');
});

test('Plot Armor waits for the Rejuvs, then saves the hero at 25% health and nothing hurts it for a moment', () => {
  const { PLOT_ARMOR } = require('../src/utils/farm/engine');
  const hero = buildHero('Haze', { boons: 10, unlocked: 4 });
  const foe = enemy('Brute', { maxHealth: 5000, dps: 20 });
  const fight = new Fight({ heroes: [hero], enemies: [foe], rng: () => 0.5 });
  Object.assign(hero, { plotArmor: true, rejuvs: 1 });
  fight.damage(foe, hero, hero.health * 2, 'spirit', { unavoidable: true });
  assert.ok(hero.plotArmor && !hero.plotUsed && hero.rejuvs === 0, 'with a Rejuv in hand the death is the Rejuv\'s, Plot Armor is kept');
  const h2 = buildHero('Haze', { boons: 10, unlocked: 4 });
  const f2 = new Fight({ heroes: [h2], enemies: [foe], rng: () => 0.5 });
  Object.assign(h2, { plotArmor: true, rejuvs: 0, health: h2.stats.maxHealth * 0.1 });
  f2.damage(foe, h2, h2.health * 2, 'spirit', { unavoidable: true });
  assert.ok(h2.alive && Math.abs(h2.health - h2.stats.maxHealth * PLOT_ARMOR.health) < 1e-6 && !h2.plotArmor && h2.plotUsed);
  assert.equal(f2.damage(foe, h2, 500, 'spirit', { unavoidable: true }), 0, 'safe right after');
  f2.time += PLOT_ARMOR.safe + 0.1;
  f2.damage(foe, h2, h2.stats.maxHealth, 'spirit', { unavoidable: true });
  assert.ok(!h2.alive, 'and hurt again once the moment is over');
});

test('minions fight on the hero side, draw some fire, and last as long as they were lent', () => {
  const hero = buildHero('Haze', { boons: 10, unlocked: 4 });
  const foes = [0, 1, 2, 3, 4, 5].map(() => enemy('Brute', { maxHealth: 5000, dps: 20 })); // each enemy picks one target and keeps on it
  const minions = [0, 1, 2].map(() => enemy('Ghoul', { maxHealth: 400, dps: 30, damageType: 'melee' }));
  const fight = new Fight({ heroes: [hero], enemies: foes, minions, rng: (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() });
  for (let i = 0; i < 300; i++) fight.step();
  assert.ok(fight.dealt.get(minions[0]) > 0, 'a minion deals damage');
  assert.ok(minions.some((m) => m.health < m.stats.maxHealth), 'an enemy attacks a minion now and then');
  const d = D.newRun('Haze', 1);
  d.minions = [{ kind: 'ghoul', count: 3, fights: 1 }, { kind: 'rift', count: 5, floor: 2, rifts: 0 }];
  D.afterWin(d, { spec: D.specOf(d, 6), health: 1, rejuvsUsed: 0, kept: {}, stacks: {}, minionsLeft: [true, true, true, true, false, true, true, true] });
  assert.deepStrictEqual(d.minions, [{ kind: 'rift', count: 4, floor: 2, rifts: 0 }], 'the Ghouls were lent for 1 fight; one Rift Trooper fell');
  D.afterWin(d, { spec: D.specOf(d, 10), health: 1, rejuvsUsed: 0, kept: {}, stacks: {}, minionsLeft: [true, true, true, true] });
  assert.ok(!d.minions, 'Rift Troopers leave once their floor boss is beaten');
});

test('the Rift: 1-6 rivals who fight each other too; a loss is a flee (never a death), a win lends Rift Troopers for the floor', () => {
  const where = at((s) => s.kind === 'rift' && s.rivals.length >= 2);
  const d = run(where);
  const spec = D.specOf(d);
  assert.ok(spec.rivals.length >= 1 && spec.rivals.length <= 6 && !spec.rivals.includes('Haze'));
  let lost = null;
  for (const w of every((s) => s.kind === 'rift' && s.rivals.length >= 3, 12)) { // a level 0 hero against 3+: every fight ends in a win, a flee or time, never a death
    const r = D.fightRoom(Object.assign(run(w), { level: 0, items: { weapon: [], vitality: [], spirit: [] } }), D.specOf(run(w)));
    assert.ok(r.health > 0 && (r.won || r.fled || r.timedOut), 'the hero never dies in the Rift');
    if (!r.won) lost ??= r;
  }
  assert.ok(lost, 'a level 0 hero loses some');
  lost = { ...lost, spec };
  const fled = structuredClone(d);
  D.fleeRift(fled, lost);
  assert.ok(fled.health >= D.RIFT.flee && fled.room === spec.room + 1 && fled.phase === 'ready' && fled.level === d.level && !fled.offer, 'it flees with nothing (no level, no pick) and goes on');
  const won = structuredClone(d);
  D.afterWin(won, { spec, health: 0.6, rejuvsUsed: 0, kept: {}, stacks: {}, minionsLeft: [] });
  assert.deepStrictEqual(won.minions, [{ kind: 'rift', count: 5, floor: spec.floor, rifts: 0 }]);
  const troopers = D.minionUnits(won, D.specOf(won, spec.room + 1));
  assert.ok(troopers.length === 5 && troopers.every((t) => t.stats.meleeResist === D.RIFT.melee && t.stats.spiritResist === D.RIFT.spirit));
  // a free-for-all: rivals hurt each other
  const [a, b] = ['Abrams', 'Bebop'].map((n) => buildHero(n, { boons: 10, unlocked: 4 }));
  const ffa = new Fight({ heroes: [buildHero('Haze', { boons: 0, unlocked: 1 })], enemies: [a, b], ffa: true, rng: Math.random });
  for (let i = 0; i < 600; i++) ffa.step();
  assert.ok([a, b].some((x) => x.health < x.stats.maxHealth) && (ffa.dealt.get(a) > 0 || ffa.dealt.get(b) > 0));
});

test('your ally fights beside you in the Rift, and never shows up anywhere else while it is with you', () => {
  const rift = run(at((s) => s.kind === 'rift' && s.rivals.length >= 2));
  rift.ally = { hero: 'Abrams', kit: { boons: 10, unlocked: 4, tiers: {}, items: [], buffs: {} }, left: 3 };
  const fought = D.fightRoom(rift, D.specOf(rift));
  assert.ok(fought.frames.at(-1).allies?.[0]?.name === 'Abrams' && fought.log.some(([, t]) => /^Abrams /.test(t)), 'the ally fights in the Rift');
  let checked = 0;
  for (let seed = 1; seed <= 300; seed++) for (let room = 3; room < D.LAST_ROOM; room++) {
    const plain = D.roomSpec(seed, room, 'Haze', 0, 4);
    const ally = plain.kind === 'visit' ? plain.hero : plain.kind === 'rift' ? plain.rivals[0] : plain.rival;
    if (!ally) continue;
    const d = Object.assign(D.newRun('Haze', seed), { room, ally: { hero: ally, kit: {}, left: 2 } });
    const s = D.specOf(d);
    checked++;
    assert.ok(![s.rival, s.hero, ...(s.rivals ?? [])].includes(ally) && ![s.rival, s.hero, ...(s.rivals ?? [])].includes('Haze'), `room ${room} of seed ${seed} still has the ally`);
    if (s.kind === 'rift') assert.strictEqual(new Set(s.rivals).size, s.rivals.length, 'no hero twice in a Rift');
  }
  assert.ok(checked > 100);
});

test('the Rift with a Rejuv in hand: the hero fights on (dies and gets back up) instead of fleeing; rivals may flee and are out of it', () => {
  let rivalsFled = 0;
  for (const w of every((s) => s.kind === 'rift' && s.rivals.length >= 3, 12)) {
    const d = Object.assign(run(w), { level: 8, rejuvs: 1, items: { weapon: [], vitality: [], spirit: [] } });
    const r = D.fightRoom(d, D.specOf(d));
    assert.ok(!(r.fled && r.rejuvsUsed === 0), 'never flees with a Rejuv left');
    rivalsFled += r.frames.at(-1).enemies.filter((e) => e.fled).length;
  }
  assert.ok(rivalsFled > 0, 'some rivals flee');
});

test('a replica never lists its item twice in a dropdown (Nov 7: Discord refused the Give Up menu)', () => {
  const d = Object.assign(D.newRun('Haze', 1), { items: { weapon: ['Headshot Booster', 'Headshot Booster'], vitality: [], spirit: [] } });
  for (const list of [D.dealerItems(d), D.tinkerables(d)]) assert.strictEqual(new Set(list).size, list.length);
});

test("giving up Violet's replica takes her copy, not the original (Nov 7, his ask)", () => {
  const FILL = ['Rapid Rounds', 'Monster Rounds', 'Extended Magazine', 'Extra Health', 'Extra Regen', 'Extra Stamina', 'Extra Spirit', 'Mystic Burst', 'Spirit Sap', 'Spirit Strike'];
  const full = () => Object.assign(D.newRun('Haze', 1), { phase: 'bonus', pendingBonus: { name: 'Golden Goose Egg', upgraded: 'x', used: [] }, replicas: ['Headshot Booster'],
    items: { weapon: ['Headshot Booster', 'Headshot Booster', ...FILL.slice(0, 3)], vitality: FILL.slice(3, 6), spirit: FILL.slice(6) } });
  const a = full();
  assert.ok(D.takeBonus(a, `Headshot Booster${D.REPLICA}`).ok);
  assert.deepStrictEqual([a.items.weapon.filter((n) => n === 'Headshot Booster').length, a.replicas], [1, []], 'her copy went, its paint with it');
  const b = full();
  assert.strictEqual(D.takeBonus(b, 'Headshot Booster').replaced, 'Headshot Booster');
  assert.deepStrictEqual([b.items.weapon.filter((n) => n === 'Headshot Booster').length, b.replicas], [1, ['Headshot Booster']], 'the original went, her copy stays painted');
});

// ---- Nov 7: repeats ----
const KINDS_OF = (seed, v) => { const out = []; for (let room = 1; room < D.LAST_ROOM; room++) { const k = D.roomSpec(seed, room, 'Haze', 0, v).kind; if (k !== 'fight' && k !== 'boss') out.push(k); } return out; };
const sameInARow = (v) => { let n = 0, total = 0; for (let seed = 1; seed <= 400; seed++) { const ks = KINDS_OF(seed, v); total += ks.length; for (let i = 1; i < ks.length; i++) if (ks[i] === ks[i - 1]) n++; } return { n, total }; };

test('version 5: the same kind of special room twice in a row is rarer, with the same rooms special as before', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const was = KINDS_OF(seed, 4).length, now = KINDS_OF(seed, 5).length;
    assert.strictEqual(now, was, 'only the kinds move, never which rooms are special');
  }
  const [before, after] = [sameInARow(4), sameInARow(5)];
  assert.ok(after.n < before.n * 0.9, `fewer repeats (${before.n} -> ${after.n} of ${before.total})`);
});

test('a kind that came is back to normal once a different one came (the weights start at 1 again)', () => {
  const S = D.specials(7, 0);
  assert.ok(Object.keys(S.events).length + Object.keys(S.heroes).length > 0);
  assert.ok(D.EVENT_REPEAT < 1 && D.EVENT_REPEAT > 0);
});

test('a deal still running is not offered again: another deal, or a rival when none is left', () => {
  const held = { plot: (d) => { d.plotArmor = true; }, rescue: (d) => { d.rescue = true; }, assistant: (d) => { d.assistant = { fights: 2 }; }, ghouls: (d) => { d.minions = [{ kind: 'ghoul', count: 2, fights: 1 }]; }, turret: (d) => { d.minions = [{ kind: 'turret', count: 1, fights: 1 }]; } };
  for (const [deal, hold] of Object.entries(held)) {
    let checked = 0;
    for (const w of every((s) => s.kind === 'visit' && s.deal === deal, 25)) {
      const d = Object.assign(D.newRun('Haze', w.seed), { room: w.room });
      assert.strictEqual(D.specOf(d).deal, deal, 'offered while it is not held');
      hold(d);
      const s = D.specOf(d);
      assert.ok(!D.heldDeals(d).includes(s.deal), `${deal} held: not offered again`);
      assert.ok(s.kind === 'visit' || s.kind === 'rival');
      checked++;
    }
    assert.ok(checked > 0, `${deal} has rooms to check`);
  }
  const all = Object.assign(D.newRun('Haze', 1), { plotArmor: true, assistant: { fights: 2 }, minions: [{ kind: 'ghoul', count: 1, fights: 1 }, { kind: 'turret', count: 1, fights: 1 }] });
  const w = every((s) => s.kind === 'visit' && s.deal === 'plot', 1)[0];
  const d = Object.assign(all, { seed: w.seed, room: w.room });
  const s = D.specOf(d);
  assert.ok(s.kind === 'visit' && ['replica', 'castling', 'upgrade', 'fuse', 'travel', 'capsule', 'helper', 'lesson'].includes(s.deal), 'the deals that are not held (the ones that take an Item, the Traveler, the Lesson) come instead');
});

test("Graves' Ghouls stay while they live, fight after fight, until the floor's boss is beaten (his call, Nov 7)", () => {
  const d = D.newRun('Haze', 1);
  d.minions = [{ kind: 'ghoul', count: 3, floor: 1 }];
  for (const room of [1, 2, 3, 4]) D.afterWin(d, { spec: D.specOf(d, room), health: 1, rejuvsUsed: 0, kept: {}, stacks: {}, minionsLeft: [true, true, room < 3] });
  assert.deepStrictEqual(d.minions, [{ kind: 'ghoul', count: 2, floor: 1 }], 'one fell in room 3, the other two are still with you after 4 fights');
  D.afterWin(d, { spec: D.specOf(d, 5), health: 1, rejuvsUsed: 0, kept: {}, stacks: {}, minionsLeft: [true, true] });
  assert.ok(!d.minions, "gone once floor 1's boss is beaten");
});

test("Ivy's Rescue: a fight that kills takes the hero back to a Rest Stop at 25%, the rooms from there are fought again for no Level and no pick, once", () => {
  const w = every((s) => s.kind === 'visit' && s.deal === 'rescue', 1)[0];
  const given = Object.assign(D.newRun('Haze', w.seed), { room: w.room, level: 10 });
  assert.ok(D.eventAct(given, 'accept').ok && given.rescue === true && given.phase === 'offer');
  assert.ok(D.heldDeals(given).includes('rescue') && D.heldDeals(given).includes('plot'), 'held, and Plot Armor is not offered beside it');
  const plot = Object.assign(D.newRun('Haze', 1), { plotArmor: true });
  assert.ok(D.heldDeals(plot).includes('rescue'), 'not offered while Plot Armor is running');
  assert.ok(D.heldDeals(Object.assign(D.newRun('Haze', 1), { urn: { left: 2 } })).includes('rescue'), 'not offered while carrying the Urn');
  // dying in room 8 (floor 2 is rooms 6-10): back to room 6 (the floor's start is as far as she goes)
  const d = Object.assign(D.newRun('Haze', 7), { room: 8, level: 7, rescue: true, health: 0.05 });
  const lost = { spec: D.specOf(d), rejuvsUsed: 0, kept: {}, stacks: {} };
  assert.ok(D.canRescue(d, lost.spec));
  assert.ok(!D.canRescue(d, D.specOf(d, 6)), 'the first room of a floor has nowhere to go back to');
  assert.ok(!D.canRescue(d, D.specOf(d, 10)), 'not a boss');
  assert.deepStrictEqual(D.rescue(d, lost), { back: 6, until: 8 });
  assert.ok(!d.rescue && d.room === 6 && d.phase === 'ready' && d.health === D.RESCUE.health);
  assert.strictEqual(D.specOf(d).kind, 'rest', 'the room she sets the hero down in is a Rest Stop');
  const rest = D.eventAct(d, 'rest');
  assert.ok(rest.ok && rest.replay && d.level === 7 && d.phase === 'ready' && d.room === 7 && !d.offer, 'no Level, no pick');
  assert.ok(Math.abs(d.health - (D.RESCUE.health + D.REST_HEAL)) < 1e-9);
  assert.strictEqual(D.specOf(d).kind, 'fight', 'the room again, fresh');
  D.afterWin(d, { spec: D.specOf(d), health: 0.5, rejuvsUsed: 0, kept: {}, stacks: {} });
  assert.ok(d.level === 7 && d.phase === 'ready' && d.room === 8 && !d.offer && d.replay, 'a cleared room again pays nothing');
  D.afterWin(d, { spec: D.specOf(d), health: 0.5, rejuvsUsed: 0, kept: {}, stacks: {} });
  assert.ok(d.level === 8 && d.phase === 'offer' && d.room === 9 && !d.replay, 'the room that was lost pays as usual');
  assert.ok(!D.canRescue(d, D.specOf(d, 9)), 'once');
});

test('hero rooms are spaced against each other: never the same outcome three times in a row, whatever lies between them (version 7)', () => {
  let rivals = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const S = D.specials(seed, 14, 7);
    const order = Object.keys(S.heroes).map(Number).sort((a, b) => a - b).map((r) => S.heroes[r]);
    for (let i = 2; i < order.length; i++) assert.ok(!(order[i] === order[i - 1] && order[i] === order[i - 2]), `seed ${seed}: ${order.join(', ')}`);
    rivals += order.filter((k) => k === 'rival').length;
  }
  assert.ok(rivals > 0);
});
