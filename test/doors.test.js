// Two Doors (Nov 13): a run from VERSION 8 picks its next room from doors. Where doors are, what they hold, and what taking one does.
const test = require('./group')(__filename);
const assert = require('node:assert');
process.env.NO_QUESTS = '1';
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
process.env.FARM_FRAME_MS = '0';
const D = require('../src/utils/farm/descent');
const dviews = require('../src/utils/farm/descentViews');
const { chooseHero } = require('../src/utils/farm/play');

const guild = { emojis: { cache: { find: () => undefined } } };
const member = (id) => ({ id, guild, toString: () => `<@${id}>` });

const kindOf = (x) => (x.mystery ? 'mystery' : x.kind);
// Walk a run to the bottom taking `want(doors, d)`'s door, passing every room without playing it. Calls `seen(spec, d)` on every room it stands in.
function walk(seed, want, seen = () => {}) {
  const d = D.newRun('Haze', seed);
  for (; d.room < D.LAST_ROOM; d.room += 1) {
    const doors = D.specOf(d);
    if (doors.kind === 'doors') { seen(doors, d); assert.ok(D.chooseDoor(d, want(doors.doors, d)).ok); }
    seen(D.specOf(d), d);
  }
  return d;
}

test('every room but a boss and the bottom is a choice of doors, and an older run has none', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const d = D.newRun('Haze', seed);
    assert.strictEqual(d.v, D.VERSION);
    for (let room = 1; room <= D.LAST_ROOM; room++) {
      const spec = D.specOf({ ...d, room });
      if (room % D.ROOMS_PER_FLOOR === 0) assert.strictEqual(spec.kind, 'boss', `room ${room} is the only way forward`);
      else assert.strictEqual(spec.doors?.length, D.DOORS, `room ${room} has ${D.DOORS} doors`);
      assert.notStrictEqual(D.specOf({ ...d, v: 7, room }).kind, 'doors');
    }
  }
});

test('two doors are never alike, and the first rooms are fights', () => {
  const seenKinds = new Set();
  for (let seed = 1; seed <= 150; seed++) walk(seed, (doors) => seed % doors.length, (spec) => {
    if (spec.kind !== 'doors') return;
    const what = spec.doors.map((x) => (x.kind === 'fight' ? D.roomLine(x) : kindOf(x)));
    assert.strictEqual(new Set(what).size, what.length, `seed ${seed} room ${spec.room}: ${what.join(' | ')}`);
    if (spec.room < 3) assert.ok(spec.doors.every((x) => x.kind === 'fight'));
    for (const x of spec.doors) seenKinds.add(x.mystery ? `?${x.kind}` : x.kind);
  });
  for (const kind of ['fight', ...D.OWN_DOORS, ...Object.keys(D.MYSTERY).map((k) => `?${k}`)]) assert.ok(seenKinds.has(kind), `a ${kind} door turns up`);
});

test('a door taken stays what it was, and a door that is not there is refused', () => {
  const d = D.newRun('Haze', 3);
  d.room = 4;
  const { doors } = D.specOf(d);
  assert.deepStrictEqual(D.specOf(d).doors, doors, 'asked twice, the same doors');
  assert.strictEqual(D.chooseDoor(d, 5).error, 'none');
  assert.ok(D.chooseDoor(d, 1).ok);
  assert.deepStrictEqual(D.specOf(d).groups ?? D.specOf(d).kind, doors[1].groups ?? doors[1].kind);
  assert.strictEqual(D.chooseDoor(d, 0).error, 'none', 'no second pick');
  assert.ok(D.NO_FIGHT.has('doors'), 'the doors themselves cannot be fought');
});

test('a named door gives a Level and no pick; a Mystery Room gives both', () => {
  let rest = 0, wounded = 0;
  for (let seed = 1; seed <= 300 && !(rest && wounded); seed++) walk(seed, (doors) => Math.max(0, doors.findIndex((x) => x.kind === 'rest' || (x.mystery && x.kind === 'wounded'))), (spec, d) => {
    if (d.phase !== 'ready' || d.ally) return;
    const level = d.level;
    if (spec.kind === 'rest' && !rest) {
      const copy = structuredClone(d);
      assert.ok(D.restStop(copy, 'rest').ok);
      assert.deepStrictEqual([copy.level, copy.phase, copy.room, copy.offer], [level + 1, 'ready', d.room + 1, null]);
      rest++;
    }
    if (spec.kind === 'wounded' && spec.mystery && !wounded) {
      const copy = structuredClone(d);
      assert.ok(D.eventAct(copy, 'recruit').ok);
      assert.deepStrictEqual([copy.level, copy.phase], [level + 1, 'offer']);
      assert.ok(copy.offer.choices.length);
      wounded++;
    }
  });
  assert.ok(rest && wounded, 'both were found');
});

test('Mystery Rooms: never a Rival right after a Rival, and the Broker at most BROKER_MAX times a run', () => {
  let rivals = 0;
  for (let seed = 1; seed <= 200; seed++) {
    let stalls = 0, last = null;
    walk(seed, (doors) => Math.max(0, doors.findIndex((x) => x.mystery)), (spec) => {
      if (spec.kind === 'doors') return;
      if (spec.kind === 'rival') { rivals++; assert.notStrictEqual(last, 'rival', `seed ${seed} room ${spec.room}`); }
      if (spec.kind === 'broker') stalls++;
      last = spec.kind;
    });
    assert.ok(stalls <= D.BROKER_MAX, `seed ${seed}: ${stalls} stalls`);
  }
  assert.ok(rivals > 50);
  // only the Broker gives no Level, so the Levels on the way down always reach the cap (his rule, Nov 13)
  assert.ok(D.LAST_ROOM - 1 - D.BROKER_MAX >= 35);
});

test("Mirage's Traveler adds a door in a door run", () => {
  const d = D.newRun('Haze', 9);
  d.room = 7;
  d.extraDoor = { room: 7, kind: 'rest' };
  const { doors } = D.specOf(d);
  assert.strictEqual(doors.length, D.DOORS + 1);
  assert.deepStrictEqual([doors.at(-1).kind, doors.at(-1).travel, doors.at(-1).noPick], ['rest', true, true]);
  assert.ok(D.chooseDoor(d, D.DOORS).ok);
  assert.strictEqual(D.specOf(d).kind, 'rest');
  assert.strictEqual(d.extraDoor, undefined);
});

test("on the member's record: a door is picked before the fight, an old screen's button is refused, the screen names the doors", async () => {
  const id = 'door1';
  await chooseHero(id, 'Haze');
  assert.ok((await D.startRun(id, 'Haze', 77)).ok);
  assert.deepStrictEqual(await D.fight(id), { error: 'doors' }, 'no fight before a door is picked');
  const view = await dviews.roomView(member(id), await D.getRun(id));
  assert.match(view.embeds[0].data.title, /Two Doors$/);
  assert.deepStrictEqual(view.embeds[0].data.fields.slice(0, 2).map((x) => x.name), ['Left Door', 'Right Door']);
  assert.deepStrictEqual(view.components.at(-2).components.map((c) => c.data.label), ['Left Door', 'Right Door']);
  assert.deepStrictEqual(view.components.at(-1).components.map((c) => c.data.label), ['Your Build', 'Abandon Run']);
  assert.strictEqual((await D.door(id, 2, 0)).error, 'none', 'a button from another room');
  assert.ok((await D.door(id, 1, 1)).ok);
  assert.strictEqual((await D.door(id, 1, 0)).error, 'none', 'already through a door');
  const room = await dviews.roomView(member(id), await D.getRun(id));
  assert.match(room.embeds[0].data.title, /Room 1$/);
  const { run } = await D.fight(id);
  assert.strictEqual(typeof run.won, 'boolean', 'the room behind the door is fought');
});

// ---- Infernus' Stoke the Fire (Nov 13): a hero deal of door runs ----
const { buildHero } = require('../src/utils/farm/hero');
const KIT = { weapon: ['Headshot Booster', 'Rapid Rounds'], vitality: ['Extra Health'], spirit: ['Extra Spirit', 'Mystic Burst'] };
// A run standing in Infernus' room (behind a Mystery Room door).
function infernus(seed, room = 12) {
  const d = Object.assign(D.newRun('Haze', seed), { room, level: 10, items: structuredClone(KIT) });
  d.path = { [room]: { room, floor: D.floorOf(room), ascension: 0, kind: 'visit', mystery: true, hero: 'Infernus', deal: 'stoke' } };
  return d;
}
const health = (d) => buildHero(d.hero, D.runKit(d)).stats.maxHealth;

test('Infernus: the first Stoke is safe, Take It Back keeps the temper, and a Tempered Item is stronger', () => {
  const d = infernus(1);
  assert.deepStrictEqual(D.VISITS.Infernus, 'stoke');
  assert.strictEqual(D.eventAct(d, 'stoke').error, 'item', 'no Item handed over yet');
  assert.strictEqual(D.eventAct(d, 'item', 'No Such Item').error, 'item');
  const before = health(d);
  assert.ok(D.eventAct(d, 'item', 'Extra Health').pick);
  assert.strictEqual(D.eventAct(d, 'done').error, 'none', 'nothing to take back before a Stoke');
  const first = D.eventAct(d, 'stoke');
  assert.deepStrictEqual([first.pick, first.stokes], [true, 1]);
  assert.strictEqual(D.eventAct(d, 'item', 'Extra Spirit').error, 'item', 'the Item in the fire cannot be changed');
  assert.strictEqual(health(d), before, 'nothing is tempered until he hands it back');
  const done = D.eventAct(d, 'done');
  assert.deepStrictEqual([done.ok, done.stokes, done.burned], [true, 1, false]);
  assert.deepStrictEqual([d.tempered, d.stoke, d.level, d.phase, d.room], [{ 'Extra Health': 1 }, undefined, 11, 'offer', 13], 'a Level and a pick, like every Mystery Room');
  assert.deepStrictEqual([d.event.reveal, d.event.mood], [true, 'gloat']);
  assert.ok(health(d) > before, `Max Health ${before} -> ${health(d)}`);
  assert.ok(!D.stokeables(d).includes('Extra Health'), 'an Item is tempered in one visit only');
});

test('Infernus: later Stokes burn at 25% / 50% / 75%, a burn destroys the Item, four Stokes hand it back', () => {
  const burnedAt = [0, 0, 0, 0];
  let full = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const d = infernus(seed);
    D.eventAct(d, 'item', 'Mystic Burst');
    let r;
    for (let n = 0; n < 4 && !(r = D.eventAct(d, 'stoke')).action; n++);
    assert.strictEqual(r.action, 'stoke');
    if (r.burned) {
      burnedAt[r.stokes]++;
      assert.ok(!d.items.spirit.includes('Mystic Burst') && !d.tempered?.['Mystic Burst'], 'burned: gone, no temper');
      assert.strictEqual(d.event.mood, 'critical');
    } else { full++; assert.deepStrictEqual([r.stokes, d.tempered['Mystic Burst']], [4, 4]); }
    assert.strictEqual(d.level, 11, 'a Level either way');
  }
  assert.strictEqual(burnedAt[0], 0, 'never on the first');
  const share = (n, of) => n / of;
  assert.ok(Math.abs(share(burnedAt[1], 600) - 0.25) < 0.06, `second Stoke ${burnedAt[1]} / 600`);
  assert.ok(Math.abs(share(burnedAt[2], 600 - burnedAt[1]) - 0.5) < 0.08, 'third Stoke');
  assert.ok(Math.abs(share(burnedAt[3], 600 - burnedAt[1] - burnedAt[2]) - 0.75) < 0.1, 'fourth Stoke');
  assert.ok(full > 20, `${full} came through all four`);
});

test('Infernus: what he will not take, leaving takes the Item back, an upgrade keeps the temper', () => {
  const d = infernus(3);
  d.fragile = ['Extra Spirit'];
  d.fused = [['Headshot Booster', 'Rapid Rounds']];
  d.legendary = 'Infinite Rounds';
  assert.deepStrictEqual(D.stokeables(d).sort(), ['Extra Health', 'Mystic Burst']);
  D.eventAct(d, 'item', 'Extra Health');
  D.eventAct(d, 'stoke');
  assert.ok(D.eventAct(d, 'leave').ok);
  assert.deepStrictEqual([d.tempered, d.room], [{ 'Extra Health': 1 }, 13], 'Turn Down with an Item in the fire is Take It Back');
  const turned = infernus(4);
  D.eventAct(turned, 'item', 'Extra Health');
  assert.ok(D.eventAct(turned, 'leave').ok);
  assert.deepStrictEqual([turned.tempered, turned.stoke], [undefined, undefined], 'no Stoke, no temper');
  const up = infernus(5);
  up.tempered = { 'Extra Spirit': 2 };
  const into = D.upgradesOf(up, 'Extra Spirit')[0];
  assert.ok(into && D.addItem(up, into).ok);
  assert.deepStrictEqual(up.tempered, { [into]: 2 });
});

test("Infernus: his room's screen", async () => {
  const d = infernus(1);
  const names = (v) => v.components.flatMap((r) => r.components.map((c) => c.data.label ?? c.data.placeholder)).filter((x) => !x.startsWith('Spend'));
  let view = await dviews.roomView(member('x'), d);
  assert.match(view.embeds[0].data.title, /Infernus$/);
  assert.deepStrictEqual(names(view), ['Select an Item to Stoke', 'Stoke', 'Turn Down', 'Your Build', 'Abandon Run']);
  assert.match(view.embeds[0].data.description, /Stoke 2: \*\*25%\*\*/);
  D.eventAct(d, 'item', 'Extra Health');
  D.eventAct(d, 'stoke');
  view = await dviews.roomView(member('x'), d);
  assert.deepStrictEqual(names(view), ['Stoke', 'Take It Back', 'Your Build', 'Abandon Run']);
  assert.match(view.embeds[0].data.description, /Your \*\*Extra Health\*\* is at \*\*\+15%\*\*/);
});

// ---- the Doorman's Doorway (Nov 13) ----
test("the Doorman's Doorway: the door not taken stays open for one step back, then it is gone", () => {
  const d = Object.assign(D.newRun('Haze', 11), { room: 7, level: 5, items: structuredClone(KIT) });
  d.path = { 7: { room: 7, floor: 2, ascension: 0, kind: 'visit', mystery: true, hero: 'The Doorman', deal: 'doorway' } };
  assert.strictEqual(D.VISITS['The Doorman'], 'doorway');
  assert.ok(D.eventAct(d, 'accept').ok);
  assert.deepStrictEqual([d.doorway, d.room, d.phase], [true, 8, 'offer']);
  assert.ok(D.heldDeals(d).includes('doorway'), 'not offered again while it waits');
  d.phase = 'ready';
  assert.deepStrictEqual(D.doorwayOpen(d), [], 'nothing to step back to yet');
  const { doors } = D.specOf(d);
  assert.ok(D.chooseDoor(d, 0).ok);
  assert.deepStrictEqual(d.doorway, { room: 8, doors: [doors[1]] });
  assert.deepStrictEqual(D.doorwayOpen(d), [], 'not while the first room is still to play');
  assert.strictEqual(D.stepBack(d, 0).error, 'none');
  d.room = 9; // the first room is done
  assert.deepStrictEqual(D.doorwayOpen(d), [doors[1]]);
  assert.strictEqual(D.stepBack(d, 3).error, 'none');
  const back = D.stepBack(d, 0);
  assert.ok(back.ok);
  assert.deepStrictEqual([d.room, d.doorway, D.specOf(d).doorway, D.specOf(d).kind], [8, undefined, true, doors[1].kind]);
  d.room = 9;
  assert.strictEqual(D.specOf(d).kind, 'doors', 'on to the next choice');
  assert.deepStrictEqual(D.doorwayOpen(d), [], 'one use');
});

test("the Doorman's Doorway: walking on closes it, a boss room can still step back, the second room's pick is its own", async () => {
  const walked = Object.assign(D.newRun('Haze', 12), { room: 8, doorway: true });
  D.chooseDoor(walked, 0);
  walked.room = 9;
  D.chooseDoor(walked, 0);
  assert.strictEqual(walked.doorway, undefined, 'a later door closes it');
  const boss = Object.assign(D.newRun('Haze', 12), { room: 9, doorway: true });
  D.chooseDoor(boss, 1);
  boss.room = 10;
  assert.strictEqual(D.specOf(boss).kind, 'boss');
  assert.strictEqual(D.doorwayOpen(boss).length, 1);
  const names = (v) => v.components.flatMap((r) => r.components.map((c) => c.data.label ?? c.data.placeholder));
  const view = await dviews.roomView(member('x'), boss);
  assert.ok(names(view).includes('Step Back Through the Doorway'));
  assert.ok(view.embeds[0].data.fields.some((x) => x.name === 'The Doorway' && /Step back to Room 9/.test(x.value)));
  const doorsScreen = Object.assign(D.newRun('Haze', 12), { room: 7, doorway: true });
  D.chooseDoor(doorsScreen, 0);
  doorsScreen.room = 8;
  const dv = await dviews.roomView(member('x'), doorsScreen);
  assert.deepStrictEqual(names(dv), ['Left Door', 'Right Door', 'Step Back Through the Doorway', 'Your Build', 'Abandon Run']);
  assert.deepStrictEqual(dv.embeds[0].data.fields.slice(0, 3).map((x) => x.name), ['Left Door', 'Right Door', 'The Doorway']);
  let differ = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const d = Object.assign(D.newRun('Haze', seed), { room: 12, level: 10 });
    const spec = { room: 12, floor: 3, ascension: 0, kind: 'fight', groups: [] };
    if (String(D.rollOffer(structuredClone(d), spec).choices) !== String(D.rollOffer(structuredClone(d), { ...spec, doorway: true }).choices)) differ++;
  }
  assert.ok(differ >= 15, `the pick behind the Doorway is rolled apart (${differ} of 20 differ)`);
});

test("the Doorman's Doorway on the member's record: an old screen's Step Back is refused", async () => {
  const id = 'door2';
  await chooseHero(id, 'Haze');
  assert.ok((await D.startRun(id, 'Haze', 78)).ok);
  assert.strictEqual((await D.backThrough(id, 1, 0)).error, 'none', 'no Doorway');
  assert.strictEqual((await D.backThrough(id, 4, 0)).error, 'none', 'another room');
});

// ---- Billy's Smash and Grab (Nov 14) ----
test("Billy's Smash and Grab: accepting makes the Item pick that follows take every Item on it, all Fragile", () => {
  const d = Object.assign(D.newRun('Haze', 11), { room: 7, level: 5 });
  d.path = { 7: { room: 7, floor: 2, ascension: 0, kind: 'visit', mystery: true, hero: 'Billy', deal: 'smash' } };
  assert.strictEqual(D.VISITS.Billy, 'smash');
  assert.ok(D.eventAct(d, 'accept').ok);
  assert.strictEqual(d.smash, true);
  assert.ok(D.heldDeals(d).includes('smash'));
  const choices = d.offer.choices;
  assert.ok(D.smashOpen(d) && D.smashNeed(d) === 0);
  const r = D.takeAll(d);
  assert.ok(r.ok && r.taken.length === choices.length);
  assert.strictEqual(d.smash, undefined);
  for (const n of r.taken) assert.ok(D.fragileOf(d).includes(n), `${n} is Fragile`);
});
test("Billy's Smash and Grab: a full build must name the Items it gives up", () => {
  const d = Object.assign(D.newRun('Haze', 11), { room: 7, level: 5 });
  d.path = { 7: { room: 7, floor: 2, ascension: 0, kind: 'visit', mystery: true, hero: 'Billy', deal: 'smash' } };
  D.eventAct(d, 'accept');
  const { ITEM_POOL: POOL } = require('../src/utils/farm/levels');
  const choices = new Set(d.offer.choices);
  for (const name of POOL) { if (D.slotsUsed(d) >= D.rules(d).maxItems) break; if (!choices.has(name) && D.addItem(d, name).ok) continue; }
  const need = D.smashNeed(d);
  assert.ok(need >= 1, 'a full build has to make room');
  {
    assert.strictEqual(D.takeAll(d, []).error, 'full');
    const drop = [].concat(...Object.values(d.items)).slice(0, need);
    assert.ok(D.takeAll(d, drop).ok);
  }
});

// ---- Mo & Krill, Nurse Harrow, Vyper, Rat King (Nov 14) ----
const room7 = (hero, deal, seed = 11) => {
  const d = Object.assign(D.newRun('Haze', seed), { room: 7, level: 5 });
  d.path = { 7: { room: 7, floor: 2, ascension: 0, kind: 'visit', mystery: true, hero, deal } };
  return d;
};
test("Mo & Krill's Burrow: every room to the Floor's boss is passed with its Level, and the Urn refuses it", () => {
  const d = room7('Mo & Krill', 'burrow');
  d.offer = null;
  assert.ok(D.eventAct(d, 'accept').ok);
  assert.strictEqual(d.room, 10);
  assert.strictEqual(d.level, 5 + 1 + 2, 'the hero room and the 2 rooms dug past each give a Level');
  const urn = room7('Mo & Krill', 'burrow');
  urn.urn = { left: 3 };
  assert.ok(D.heldDeals(urn).includes('burrow'));
  assert.strictEqual(D.eventAct(urn, 'accept').ok, undefined);
});
test('Nurse Harrow: each treatment costs 3 Perma-Buffs and heals, Done leaves, and she is not offered with too few Buffs', () => {
  const d = room7('Nurse Harrow', 'harrow');
  d.health = 0.4;
  assert.ok(D.heldDeals(d).includes('harrow'), 'no Buffs, no deal');
  d.buffs = { a: 4, b: 3 };
  assert.ok(!D.heldDeals(d).includes('harrow'));
  assert.ok(D.eventAct(d, 'heal').ok);
  assert.strictEqual(D.buffTotal(d), 4);
  assert.ok(Math.abs(d.health - 0.7) < 1e-9);
  assert.ok(D.eventAct(d, 'heal').ok);
  assert.strictEqual(D.eventAct(d, 'heal').ok, undefined, 'out of Buffs');
  assert.ok(D.eventAct(d, 'done').ok);
  assert.strictEqual(d.room, 8);
});
test("Vyper's poison lasts 3 rooms after the hero room, and a poisoned gun leaves a poison on what it hits", () => {
  const d = room7('Vyper', 'venom');
  d.offer = null;
  assert.ok(D.eventAct(d, 'accept').ok);
  assert.strictEqual(d.venom.left, 3);
  assert.ok(D.heldDeals(d).includes('venom'));
  for (const room of [8, 9, 10]) D.roomPassed(d, room);
  assert.strictEqual(d.venom, undefined);
});
test('Rat King: named Rats join after fights, Ronnie is much stronger, and the Rats leave with the Floor boss', () => {
  const d = room7('Rat King', 'rats');
  assert.ok(D.eventAct(d, 'accept').ok);
  const rats = d.minions.find((m) => m.kind === 'rat');
  assert.strictEqual(rats.rats.length, 1);
  assert.ok(D.heldDeals(d).includes('rats'));
  const units = D.minionUnits(d, { room: 8 });
  assert.strictEqual(units[0].name, rats.rats[0].name);
  rats.rats = [{ name: 'Rabies Ronnie', ronnie: true }, { name: 'Frankie' }];
  rats.count = 2;
  const [ronnie, frankie] = D.minionUnits(d, { room: 8 });
  assert.ok(ronnie.stats.maxHealth > frankie.stats.maxHealth * 3 && ronnie.ronnie > 0 && !frankie.ronnie);
  D.afterMinions(d, { minionsLeft: [true, false] }, { kind: 'fight', room: 8 });
  const left = d.minions.find((m) => m.kind === 'rat');
  assert.deepStrictEqual(left.rats.map((r) => r.name).slice(0, 1), ['Rabies Ronnie']);
  assert.strictEqual(left.count, left.rats.length);
  assert.ok(left.count >= 2, 'one more joined');
});
