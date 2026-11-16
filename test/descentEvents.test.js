// Descend event rooms (Nov 4): the rest stop and the quiet corner, where they go, and what they do.
process.env.DESCEND_V = '7'; // these checks are about the fixed rooms from before Two Doors (test/doors.test.js has the doors)
const test = require('./group')(__filename);
const assert = require('node:assert');
const D = require('../src/utils/farm/descent');

const kinds = (d) => Array.from({ length: D.LAST_ROOM }, (_, i) => D.specOf(d, i + 1).kind);

test('only runs from version 3 get event rooms, and old runs keep every room as it was', () => {
  let found = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const d = D.newRun('Haze', seed);
    const before = kinds({ ...d, v: 2 });
    const now = kinds(d);
    const event = (k) => D.EVENT_KINDS.includes(k) || k === 'rift'; // the Rift is an event room from version 4
    assert.ok(!before.some(event));
    now.forEach((k, i) => {
      if (before[i] === 'rival' && ['rival', 'visit', 'wounded'].includes(k)) return; // a hero room (version 4): a rival, an interaction or a wounded hero
      if (event(k)) { found++; assert.strictEqual(before[i], 'fight', 'an event only replaces a fight room'); } else assert.strictEqual(k, before[i]);
    });
  }
  assert.ok(found > 40, `events turn up (${found} in 40 runs)`);
});

test('at most one event a floor, never beside a rival, a stall or another event', () => {
  for (let seed = 1; seed <= 60; seed++) for (const asc of [0, 20]) {
    const k = kinds(D.newRun('Haze', seed, asc));
    const events = new Set(Object.keys(D.eventRooms(seed, asc)).map((r) => Number(r) - 1)); // the event rooms (a wounded hero in a rival's room is a hero room)
    for (let f = 0; f < D.FLOORS; f++) assert.ok([...events].filter((i) => i >= f * 5 && i < f * 5 + 5).length <= 1);
    k.forEach((x, i) => {
      if (!events.has(i)) return;
      assert.ok(i + 1 >= 3, 'not before room 3');
      for (const n of [k[i - 1], k[i + 1]]) assert.ok(!['rival', 'visit', 'rift', 'broker', ...D.EVENT_KINDS].includes(n), `room ${i + 1} sits beside a ${n}`);
    });
  }
});

const runAt = (kind, from = 1) => {
  for (let seed = from; ; seed++) {
    const d = D.newRun('Haze', seed);
    const room = Object.entries(D.eventRooms(seed, 0)).find(([, k]) => k === kind)?.[0];
    if (room) return Object.assign(d, { room: Number(room), level: 5, health: 0.5, items: { weapon: ['Headshot Booster', 'Rapid Rounds'], vitality: ['Extra Health'], spirit: [] } });
  }
};

test('the rest stop: Rest heals and levels; Tinker enhances by the seed, and a failed one gives nothing', () => {
  const d = runAt('rest');
  const room = d.room;
  const r = D.restStop(d, 'rest');
  assert.ok(r.ok && Math.abs(d.health - (0.5 + D.REST_HEAL)) < 1e-9 && d.level === 6 && d.room === room + 1);
  assert.ok(d.phase === 'offer' && d.offer.room === room && d.offer.choices.length === 3, 'an event room is followed by its pick, like a won room');
  assert.deepStrictEqual(d.event, { room, action: 'rest', healed: r.healed });
  assert.strictEqual(D.restStop(d, 'rest').error, 'none', 'a fight room has no rest');
  let took = 0, missed = 0;
  for (let seed = 1; took + missed < 60; ) {
    const t = runAt('rest', seed);
    seed = t.seed + 1;
    const name = D.tinkerables(t)[0];
    const res = D.restStop(t, 'tinker', name);
    assert.ok(res.ok);
    assert.strictEqual(t.health, 0.5, 'tinkering never heals');
    assert.strictEqual(t.enhanced.includes(name), res.enhanced);
    if (res.enhanced) took++; else missed++;
  }
  assert.strictEqual(D.restStop(runAt('rest'), 'tinker', 'Not An Item').error, 'item');
  assert.ok(took > missed && missed > 0, `it takes more often than not (${took} of ${took + missed})`);
});

test('the quiet corner: one find and a level', () => {
  const d = runAt('breather');
  const r = D.breakCrates(d);
  assert.ok(r.ok && ['little', 'heal', 'big'].includes(r.find.kind) && d.level === 6);
});

test('both rooms draw within Discord limits', async () => {
  const V = require('../src/utils/farm/descentViews');
  const member = { id: '1', guild: null, displayName: 'T' };
  for (const kind of D.EVENT_KINDS) {
    const view = await V.roomView(member, runAt(kind));
    const e = view.embeds[0].toJSON();
    assert.ok(e.description.length <= 4096 && (e.fields ?? []).every((f) => f.value.length <= 1024));
    assert.ok(view.components.length <= 5);
  }
});

// ---- the second batch (Nov 4): the Soul Urn, a wounded rival, the Curiosity Dealer, a Patron's Favor, the Teleporter ----
const gear = { weapon: ['Headshot Booster', 'Rapid Rounds'], vitality: ['Extra Health'], spirit: [] };
const roomOf = (kind) => { const d = runAt(kind); Object.assign(d, { level: 8, items: structuredClone(gear) }); return d; };
const nextFight = (d) => { d.offer = null; d.phase = 'ready'; while (D.NO_FIGHT.has(D.specOf(d).kind)) d.room += 1; };

test('the Soul Urn: carried a random number of rooms, then delivered for 4 permanent buffs', () => {
  const d = roomOf('urn');
  const r = D.eventAct(d, 'urn');
  assert.ok(r.ok && r.rooms >= D.URN_ROOMS[0] && r.rooms <= D.URN_ROOMS[1] && d.urn.left === r.rooms);
  assert.ok(D.runKit(d).bridge.includes('urn'), "the carrier's buffs ride on the fight kit");
  const before = Object.values(d.buffs).reduce((s, n) => s + n, 0);
  const e = roomOf('urn');
  D.eventAct(e, 'urn');
  const left = e.urn.left;
  for (let i = 0; i < left; i++) { nextFight(e); const run = D.fightRoom(e, D.specOf(e), () => 0.5); if (!run.won) return; D.afterWin(e, run); }
  assert.strictEqual(e.urn, null);
  assert.strictEqual(Object.values(e.buffs).reduce((s, n) => s + n, 0) >= before + D.URN_BUFFS, true);
  assert.strictEqual(e.delivered.buffs.length, D.URN_BUFFS);
});

test('a wounded rival fights beside you, then leaves its build as the pick', () => {
  const d = roomOf('wounded');
  const r = D.eventAct(d, 'recruit');
  assert.ok(r.ok && d.ally.hero === r.hero && r.fights >= D.ALLY_FIGHTS[0] && r.fights <= D.ALLY_FIGHTS[1]);
  for (let i = 0; i < r.fights; i++) {
    nextFight(d);
    const run = D.fightRoom(d, D.specOf(d), () => 0.5);
    assert.ok(run.frames.at(-1).allies?.length === 1, 'the ally is in the fight');
    if (!run.won) return;
    D.afterWin(d, run);
  }
  assert.strictEqual(d.ally, null);
  assert.strictEqual(d.allyLeft.hero, r.hero);
  if (d.offer) assert.strictEqual(d.offer.rival, r.hero, "the pick is from the rival's build");
});

test('the Curiosity Dealer: sell for a full heal, swap for 3 a tier higher in the same slot', () => {
  const d = roomOf('dealer');
  d.health = 0.3;
  assert.ok(D.eventAct(d, 'sell', 'Extra Health').ok && d.health === 1 && !d.items.vitality.includes('Extra Health'));
  const e = roomOf('dealer');
  const r = D.eventAct(e, 'swap', 'Rapid Rounds');
  assert.ok(r.ok && !e.items.weapon.includes('Rapid Rounds') && e.phase === 'offer');
  assert.deepStrictEqual(e.offer.choices, r.choices);
  const { itemByName } = require('../src/utils/farm/stats');
  for (const n of r.choices) assert.ok(itemByName(n).Slot === itemByName('Rapid Rounds').Slot && itemByName(n).Tier === itemByName('Rapid Rounds').Tier + 1);
});

test("a Patron's Favor comes from the other Patron, and weakens both at the bottom", () => {
  const d = roomOf('patron');
  const r = D.eventAct(d, 'bless');
  assert.ok(r.ok && D.PATRONS.includes(D.patronOf(d)) && r.by === D.otherPatron(D.patronOf(d)));
  const keys = D.finalKeys(D.specOf(d, D.LAST_ROOM));
  assert.deepStrictEqual(keys.slice(-2), [D.patronOf(d), `${D.patronOf(d)}-weak`]);
});

test('the Teleporter lands in a no-fight room, and never takes the Urn carrier', () => {
  const d = roomOf('teleporter');
  assert.ok(D.eventAct(d, 'step').ok && D.TELEPORT_TO.includes(D.specOf(d).kind) && D.specOf(d).teleported);
  const e = roomOf('teleporter');
  e.urn = { left: 2 };
  assert.strictEqual(D.eventAct(e, 'step').error, 'carrying');
});

test("a Patron's Favor is a pick of four: restore, weaken, empower, or an ally", () => {
  const heal = roomOf('patron');
  heal.health = 0.2;
  assert.ok(D.eventAct(heal, 'heal').ok && heal.health === 1);
  const emp = roomOf('patron');
  const before = D.runKit(emp).rebirth;
  assert.ok(D.eventAct(emp, 'empower').ok && D.runKit(emp).rebirth > before, 'empowered: more Rebirth-style bonus in every fight after');
  const ally = roomOf('patron');
  const r = D.eventAct(ally, 'ally');
  assert.ok(r.ok && ally.ally.hero === r.hero && r.hero !== ally.hero);
  const twice = roomOf('patron');
  twice.ally = { hero: 'Abrams', kit: {}, left: 2 };
  assert.strictEqual(D.eventAct(twice, 'ally').error, 'ally');
});

test("a run that fights the Hidden King meets his amber troopers; the Archmother's stay blue", () => {
  const path = require('path');
  const pics = (want) => {
    for (let s = 1; ; s++) {
      const d = D.newRun('Haze', s);
      if (D.patronOf(d) !== want) continue;
      for (let room = 1; room < 5; room++) { const spec = D.specOf(d, room); if (spec.kind === 'fight' && !spec.groups[0].family) return path.basename(D.roomPicture(spec)); }
    }
  };
  assert.match(pics('hidden-king'), /^trooper-amber/);
  assert.doesNotMatch(pics('archmother'), /amber/);
});

test('/descend stats: records and counters, within Discord limits', async () => {
  const V = require('../src/utils/farm/descentViews');
  const record = { hero: 'Haze', heroes: { Haze: {} }, descentAscension: 3, descentClears: 2, descentCleared: 2, bestDescent: { hero: 'Haze', rooms: 40, ascension: 2 }, descentBest: { Haze: 40, Abrams: 12 },
    descentStats: { runs: 9, deaths: 6, abandoned: 1, rooms: 180, bosses: 30, rivals: 4, events: 11, killedBy: { Walker: 3, Sharpshooter: 2, Abrams: 1 } } };
  const view = V.statsView({ id: 'me', guild: null }, record, [{ id: 'x' }, { id: 'me' }]);
  const e = view.embeds[0].toJSON();
  assert.match(e.fields[0].value, /#2 of 2/);
  assert.match(e.fields[1].value, /Walker \(3\)/);
  assert.ok(e.fields.every((f) => f.value.length <= 1024));
});

test('Ascension 8+: the locked item slots and the rooms they open after (the build card draws them with a lock)', () => {
  const at = (room) => { const d = D.newRun('Haze', 1, 8); d.room = room; return D.rules(d); };
  assert.deepStrictEqual([at(5).maxItems, at(5).lockedSlots], [10, [20, 30]]);
  assert.deepStrictEqual([at(11).maxItems, at(11).lockedSlots], [10, [20, 30]]);
  assert.deepStrictEqual([at(21).maxItems, at(21).lockedSlots], [11, [30]]);
  assert.deepStrictEqual([at(31).maxItems, at(31).lockedSlots], [12, []]);
  assert.deepStrictEqual(D.rules(D.newRun('Haze', 1, 7)).lockedSlots, []);
});

test('a beaten rival can be recruited instead of looted: it fights a few fights, then leaves with no gift', () => {
  const d = D.newRun('Haze', 3);
  Object.assign(d, { room: 3, level: 5, phase: 'ready' });
  const spec = { room: 3, floor: 1, kind: 'rival', rival: 'Abrams' };
  const theirs = { boons: 1, unlocked: 2, tiers: {}, items: ['Extra Health'], buffs: {} };
  D.afterWin(d, { spec, health: 1, rejuvsUsed: 0, seconds: 10, theirs });
  assert.strictEqual(d.offer.recruit.hero, 'Abrams');
  const r = D.recruitDefeated(d);
  assert.ok(r.ok && d.ally.hero === 'Abrams' && d.ally.noGift && d.offer === null && d.phase === 'ready');
  assert.strictEqual(D.recruitDefeated(d).error, 'none', 'once only');
  for (let i = 0; i < r.fights; i++) {
    nextFight(d);
    const run = D.fightRoom(d, D.specOf(d), () => 0.5);
    if (!run.won) return;
    D.afterWin(d, run);
  }
  assert.strictEqual(d.ally, null);
  assert.strictEqual(d.allyLeft, undefined, 'no gift');
  assert.ok(!d.offer?.rival, 'the usual pick, not the rival\'s build');
});
