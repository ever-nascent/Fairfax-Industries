// The /descend bug sweep (descent.js): every hero with ability logic goes through whole runs with random play (picks, skips, a full build's
// swaps, ability points, walking past rivals, bosses' buffs and legendaries) until it falls or reaches --rooms. Every room's fight is checked
// (health a real number between 0 and the max, frames to replay) and every screen it would show against Discord's limits.
// Run: node tools/descend-smoke.js [hero] [--seeds=3 --rooms=60 --ascension=0]   (a temp data folder; never touches data/)
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-dsmoke-'));
const path = require('node:path');
const ROOT = path.join(__dirname, '..', 'src', 'utils', 'farm');
const D = require(path.join(ROOT, 'descent'));
const V = require(path.join(ROOT, 'descentViews'));
const { roster } = require(path.join(ROOT, 'hero'));
const { SLOTS, priceFor } = require(path.join(ROOT, 'levels'));
const { itemByName } = require(path.join(ROOT, 'stats'));
// the server's bar emojis, as long as the real ones (a health bar of them is about 380 characters)
const STREAK = ['left', 'mid', 'right'].flatMap((p) => ['on', 'off'].map((s) => `streak_${p}_${s}`));
require(path.join(__dirname, '..', 'src', 'utils', 'games', 'trivia')).loadStreakEmojis({ emojis: { cache: { find: (fn) => STREAK.map((name) => ({ name, toString: () => `<:${name}:1554307832742940715>` })).find(fn) } } });

const opt = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? Number(hit.slice(name.length + 3)) : fallback; };
const SEEDS = opt('seeds', 3);
const ROOMS = opt('rooms', 60);
const ASCENSION = opt('ascension', 0); // every run at this ascension (descent.js ASCENSIONS)
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const heroes = only ? roster().filter((n) => n.toLowerCase() === only.toLowerCase()) : roster();
if (!heroes.length) { console.log(`Unknown hero. The roster: ${roster().join(', ')}`); process.exit(1); }
const member = { id: '1', guild: { emojis: { cache: { find: () => undefined } } } };
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

// Discord's limits on one message (as in the tests).
function limits(payload, what) {
  const bad = [];
  for (const e of payload.embeds ?? []) {
    const j = e.toJSON();
    const size = (j.title?.length ?? 0) + (j.description?.length ?? 0) + (j.footer?.text.length ?? 0) + (j.author?.name.length ?? 0) + (j.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
    if (size > 6000) bad.push(`${what}: embed ${size} characters`);
    if ((j.fields ?? []).length > 25) bad.push(`${what}: ${j.fields.length} fields`);
    for (const f of j.fields ?? []) if (!f.value.length || f.value.length > 1024 || f.name.length > 256) bad.push(`${what}: field ${f.name}`);
  }
  for (const r of (payload.components ?? []).map((x) => x.toJSON())) {
    if (r.components.length > 5) bad.push(`${what}: ${r.components.length} in a row`);
    for (const c of r.components) {
      if (c.label?.length > 80 || c.custom_id.length > 100) bad.push(`${what}: ${c.custom_id}`);
      if ((c.options ?? []).length > 25 || (c.options ?? []).some((o) => o.label.length > 100 || (o.description ?? '').length > 100)) bad.push(`${what}: options`);
    }
  }
  return bad;
}

(async () => {
  const started = Date.now();
  const problems = [];
  for (const hero of heroes) {
    const reached = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = seeded(seed * 104729 + hero.length);
      const d = D.newRun(hero, seed * 31 + hero.length, ASCENSION);
      const fail = (what) => problems.push(`${hero} seed ${seed} room ${d.room}: ${what}`);
      try {
        for (;;) {
          const spec = D.specOf(d);
          problems.push(...limits(await V.roomView(member, d), `${hero} room ${d.room}`));
          if (D.doorwayOpen(d).length && rng() < 0.7) { // the Doorman's Doorway (Nov 13): step back and play the door left behind
            const back = d.room - 1;
            if (!D.stepBack(d, 0).ok || d.room !== back || !D.specOf(d).doorway || d.doorway) fail('the Doorway refused');
            continue;
          }
          if (spec.kind === 'doors') { // Two Doors (Nov 13): a random door
            d.phase = 'ready';
            if (new Set(spec.doors.map((x) => (x.mystery ? 'mystery' : x.kind === 'fight' ? D.roomLine(x) : x.kind))).size !== spec.doors.length) fail('two doors alike');
            if (!D.chooseDoor(d, Math.floor(rng() * spec.doors.length)).ok || D.specOf(d).kind === 'doors') fail('a door refused');
            continue;
          }
          if (spec.kind === 'rival' && rng() < 0.3) { d.room += 1; continue; } // Walk Away
          if (D.EVENT_KINDS.includes(spec.kind) || spec.kind === 'visit' || (spec.kind === 'rift' && rng() < 0.3)) { // an event room or a hero room: a random choice, or leave (a Rift: walked past now and then)
            d.phase = 'ready';
            const can = D.tinkerables(d);
            const items = D.dealerItems(d);
            const any = (list) => list[Math.floor(rng() * list.length)];
            let r;
            if (spec.kind === 'breather') r = D.breakCrates(d);
            else if (spec.kind === 'rest') r = can.length && rng() < 0.5 ? D.restStop(d, 'tinker', any(can)) : D.restStop(d, 'rest');
            else if (spec.kind === 'rift') r = D.eventAct(d, 'leave');
            else if (spec.kind === 'visit') { // a hero room (Nov 6): its deal with a random item, or Turn Down
              const items = { replica: D.replicables, upgrade: D.upgradeables, turret: D.parts, castling: D.castleables, capsule: D.capsulables, helper: D.fuseables }[spec.deal]?.(d);
              if (spec.deal === 'lesson') { // Dynamo (Nov 7): an enemy kind of the next floor to study, or Turn Down
                r = rng() < 0.2 ? D.eventAct(d, 'leave') : D.eventAct(d, 'lesson', any(D.lessonKinds(spec.room)));
              } else if (spec.deal === 'travel') { // Mirage (Nov 7): a room type for the next room, or Turn Down
                const kinds = D.travelKinds(d, spec.room);
                r = rng() < 0.2 || !kinds.length ? D.eventAct(d, 'leave') : D.eventAct(d, 'travel', any(kinds));
              } else if (spec.deal === 'stoke') { // Infernus (Nov 13): an Item, 1 to 4 Stokes, then Take It Back (or it burns, or Turn Down)
                const can = D.stokeables(d);
                r = rng() < 0.2 || !can.length ? D.eventAct(d, 'leave') : D.eventAct(d, 'item', any(can));
                const name = d.stoke?.name;
                const before = SLOTS.flatMap((x) => d.items[x]).filter((n) => n === name).length;
                for (let n = 1 + Math.floor(rng() * 4); r.pick; n--) {
                  problems.push(...limits(await V.roomView(member, d), `${hero} stoke ${d.room}`));
                  r = n > 0 ? D.eventAct(d, 'stoke') : D.eventAct(d, rng() < 0.5 ? 'done' : 'leave'); // (leaving with an Item in the fire takes it back)
                }
                if (r.ok && name) {
                  const after = SLOTS.flatMap((x) => d.items[x]).filter((n) => n === name).length;
                  if (r.burned ? after !== before - 1 : after !== before || d.tempered?.[name] !== r.stokes) fail(`a Stoke left ${name} wrong (${JSON.stringify(r)})`);
                  if (d.stoke) fail('an Item was left in the fire');
                }
              } else if (spec.deal === 'fuse') { // Victor (Nov 7): two Items, then Stitch (or Turn Down)
                const two = D.fuseables(d);
                r = rng() < 0.2 || two.length < 2 ? D.eventAct(d, 'leave') : D.eventAct(d, 'fuseA', any(two));
                if (r.pick) {
                  problems.push(...limits(await V.roomView(member, d), `${hero} fuse pick ${d.room}`));
                  D.eventAct(d, 'fuseB', any(two.filter((n) => n !== d.fusePick.a)));
                  problems.push(...limits(await V.roomView(member, d), `${hero} fuse stitch ${d.room}`));
                  r = D.eventAct(d, 'fuse');
                }
              } else if (spec.deal === 'harrow') { // Nurse Harrow (Nov 14): heal while there are Perma-Buffs to pay with, then Done (or Turn Down before the first)
                let n = 0;
                while (rng() < 0.7 && D.eventAct(d, 'heal').ok) { n += 1; problems.push(...limits(await V.roomView(member, d), `${hero} harrow ${d.room}`)); }
                r = D.eventAct(d, n ? 'done' : 'leave');
              } else if (spec.deal === 'burrow') { // Mo & Krill (Nov 14): refused with the Urn or too close to the boss, then Turn Down
                r = rng() < 0.8 ? D.eventAct(d, 'accept') : { error: 'none' };
                if (!r.ok) r = D.eventAct(d, 'leave');
              } else
              r = rng() < 0.2 ? D.eventAct(d, 'leave') : items ? (items.length ? D.eventAct(d, spec.deal, any(items)) : D.eventAct(d, 'leave')) : D.eventAct(d, 'accept');
              if (r.pick && spec.deal === 'upgrade') { problems.push(...limits(await V.roomView(member, d), `${hero} upgrade into ${d.room}`)); r = D.eventAct(d, 'into', any(D.upgradesOf(d, d.upgradePick))); } // McGinnis asks which Item to try for when there are several
              else if (r.pick) { problems.push(...limits(await V.roomView(member, d), `${hero} replica pick ${d.room}`)); r = D.eventAct(d, 'replace', any([...new Set(SLOTS.flatMap((x) => d.items[x]))].filter((n) => n !== d.replicaPick))); }
              while (d.phase === 'imbue') if (!D.setImbue(d, 1).ok) { fail('a hero room imbue was refused'); break; }
            }
            else {
              const tries = { urn: ['urn'], wounded: ['recruit'], patron: D.PATRON_GIFTS, teleporter: ['step'], dealer: ['swap', 'sell'] }[spec.kind];
              const action = rng() < 0.75 ? any(tries) : 'leave';
              r = D.eventAct(d, action, action === 'swap' ? any(items.filter((n) => D.swapChoices(d, n).length)) : any(items));
              if (!r.ok && ['carrying', 'ally', 'item', 'none-higher'].includes(r.error)) r = D.eventAct(d, 'leave');
              if (r.ok && action === 'step') { problems.push(...limits(await V.roomView(member, d), `${hero} teleported ${d.room}`)); continue; } // landed: the next loop plays the room it landed in
            }
            if (!r.ok) fail(`the ${spec.kind}${spec.deal ? ` (${spec.deal})` : ''} room refused: ${r.error}`);
            if (!(d.health >= 0 && d.health <= 1)) fail(`health after the ${spec.kind} room is ${d.health}`);
            if (d.phase === 'offer') { // its pick, like a won room's: the screen, then a random choice or a skip
              problems.push(...limits(await V.offerView(member, d), `${hero} ${spec.kind} offer ${d.room - 1}`));
              if (!d.offer.choices.length) fail(`an empty ${d.offer.kind} offer after the ${spec.kind} room`);
              const i = Math.floor(rng() * d.offer.choices.length);
              let r2 = rng() < 0.2 ? D.skipChoice(d) : D.takeChoice(d, i);
              if (r2.error === 'full') { const used = priceFor(itemByName(d.offer.choices[i]), d.items).used; r2 = D.takeChoice(d, i, SLOTS.flatMap((s) => d.items[s]).find((n) => !used.includes(n))); }
              if (!r2.ok) fail(`the ${spec.kind} pick: ${r2.error}`);
              d.phase = 'ready';
            }
            continue;
          }
          if (spec.kind === 'broker') { // the Broker's stall: corrupt a random item half the time, else leave
            d.phase = 'ready'; // (this sweep never answers an imbue prompt, which leaves the phase on 'imbue')
            const held = D.corruptibles(d);
            if (held.length && rng() < 0.5) { const r = D.corrupt(d, held[Math.floor(rng() * held.length)]); if (!r.ok && r.error !== 'health') fail(`the Broker refused: ${r.error}`); } else d.room += 1;
            continue;
          }
          const run = D.fightRoom(d, spec, rng);
          if (!(run.health >= 0 && run.health <= 1)) fail(`health after the fight is ${run.health}`);
          if (spec.kind === 'rift' && !run.won) { // the Rift lost: the hero flees, the run goes on (Nov 6)
            if (!run.fled && !run.timedOut) fail('the Rift was lost without fleeing');
            if (d.room % 2 === 0) problems.push(...limits(await V.fightView(run, run.frames.at(-1)), `${hero} rift ${d.room}`));
            D.fleeRift(d, run);
            if (!(d.health >= D.RIFT.flee && d.health <= 1)) fail(`health after fleeing the Rift is ${d.health}`);
            continue;
          }
          if (spec.kind === 'rift' && run.frames.some((f) => f.enemies.length !== spec.rivals.length)) fail('a Rift frame lost a rival');
          if (run.frames.length < 2) fail('fewer than 2 frames');
          for (const f of run.frames) if (!Number.isFinite(f.hero.hp) || f.enemies.some((e) => !Number.isFinite(e.hp))) fail('a health that is not a number');
          if (d.room % 7 === 0) problems.push(...limits(await V.fightView(run, run.frames.at(-1)), `${hero} fight ${d.room}`));
          if (!run.won) { problems.push(...limits(await V.overView(member, { ...run, over: { ...d }, best: { rooms: d.room - 1, hero } }), `${hero} over`)); reached.push(d.room - 1); break; }
          D.afterWin(d, run);
          if (spec.final) { problems.push(...limits(await V.completeView(member, { ...run, complete: { ...d, clears: 1 } }), `${hero} cleared`)); reached.push(D.LAST_ROOM); break; }
          if (!d.offer.choices.length) fail(`an empty ${d.offer.kind} offer`);
          for (let n = Math.floor(rng() * 4); n > 0; n--) D.spendPoint(d, 1 + Math.floor(rng() * 4));
          if (d.room % 3 === 0) problems.push(...limits(await V.offerView(member, d, { run }), `${hero} offer ${d.room - 1}`));
          if (d.offer.kind === 'items' && d.rerolls > 0 && rng() < 0.25) {
            D.rerollChoice(d);
            problems.push(...limits(await V.offerView(member, d, { animate: true }), `${hero} reroll ${d.room - 1}`));
          }
          for (let n = 0; D.helperOf(d) && d.offer.kind === 'items' && !d.offer.rival && d.offer.choices.length > 1 && n < 2 && rng() < 0.7; n++) { // Rem's Lil Helper (Nov 7): feed it the ones not taken
            const f = D.feedOffer(d, Math.floor(rng() * d.offer.choices.length));
            if (!f.ok) fail(`feed: ${f.error}`);
            problems.push(...limits(await V.offerView(member, d), `${hero} fed ${d.room - 1}`));
          }
          if (rng() < 0.1) D.skipChoice(d);
          else {
            const i = Math.floor(rng() * d.offer.choices.length);
            const r = D.takeChoice(d, i);
            if (r.error === 'full') {
              problems.push(...limits(await V.offerView(member, d, { replace: i }), `${hero} replace`));
              const used = priceFor(itemByName(d.offer.choices[i]), d.items).used;
              const all = SLOTS.flatMap((s) => d.items[s]).filter((name) => !used.includes(name));
              const r2 = D.takeChoice(d, i, all[Math.floor(rng() * all.length)]);
              if (!r2.ok) fail(`swap: ${r2.error}`);
            } else if (!r.ok) fail(`pick: ${r.error}`);
          }
          if (D.slotsUsed(d) > D.rules(d).maxItems) fail(`more than ${D.rules(d).maxItems} items`);
          if (d.room > ROOMS) { reached.push(ROOMS); break; }
        }
        if (seed === 1) problems.push(...limits(await V.buildView(member, d), `${hero} build`));
      } catch (error) {
        fail(`${error.stack}`);
        reached.push(d.room - 1);
      }
    }
    console.log(`${hero.padEnd(16)}rooms ${reached.join(', ')}`);
  }
  console.log(problems.length ? `\n${problems.length} problem(s):\n${[...new Set(problems)].slice(0, 40).join('\n')}` : `\nNo problems. ${heroes.length} heroes x ${SEEDS} runs in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  process.exitCode = problems.length ? 1 : 0;
})();
