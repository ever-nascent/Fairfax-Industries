// The /descend bug sweep (descent.js): every hero with ability logic goes through whole runs with random play (picks, skips, a full build's
// swaps, ability points, walking past rivals, bosses' buffs and legendaries) until it falls or reaches --rooms. Every room's fight is checked
// (health a real number between 0 and the max, frames to replay) and every screen it would show against Discord's limits.
// Run: node tools/descend-smoke.js [hero] [--seeds=3 --rooms=60]   (a temp data folder; never touches data/)
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-dsmoke-'));
const path = require('node:path');
const ROOT = path.join(__dirname, '..', 'src', 'utils', 'farm');
const D = require(path.join(ROOT, 'descent'));
const V = require(path.join(ROOT, 'descentViews'));
const { roster } = require(path.join(ROOT, 'hero'));
const { SLOTS } = require(path.join(ROOT, 'levels'));
// the server's bar emojis, as long as the real ones (a health bar of them is about 380 characters)
const STREAK = ['left', 'mid', 'right'].flatMap((p) => ['on', 'off'].map((s) => `streak_${p}_${s}`));
require(path.join(__dirname, '..', 'src', 'utils', 'trivia')).loadStreakEmojis({ emojis: { cache: { find: (fn) => STREAK.map((name) => ({ name, toString: () => `<:${name}:1554307832742940715>` })).find(fn) } } });

const opt = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? Number(hit.slice(name.length + 3)) : fallback; };
const SEEDS = opt('seeds', 3);
const ROOMS = opt('rooms', 60);
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
      const d = D.newRun(hero, seed * 31 + hero.length);
      const fail = (what) => problems.push(`${hero} seed ${seed} room ${d.room}: ${what}`);
      try {
        for (;;) {
          const spec = D.roomSpec(d.seed, d.room, d.hero);
          problems.push(...limits(await V.roomView(member, d), `${hero} room ${d.room}`));
          if (spec.kind === 'rival' && rng() < 0.3) { d.room += 1; continue; } // Walk Away
          const run = D.fightRoom(d, spec, rng);
          if (!(run.health >= 0 && run.health <= 1)) fail(`health after the fight is ${run.health}`);
          if (run.frames.length < 2) fail('fewer than 2 frames');
          for (const f of run.frames) if (!Number.isFinite(f.hero.hp) || f.enemies.some((e) => !Number.isFinite(e.hp))) fail('a health that is not a number');
          if (d.room % 7 === 0) problems.push(...limits(await V.fightView(run, run.frames.at(-1)), `${hero} fight ${d.room}`));
          if (!run.won) { problems.push(...limits(await V.overView(member, { ...run, over: { ...d }, best: { rooms: d.room - 1, hero } }), `${hero} over`)); reached.push(d.room - 1); break; }
          D.afterWin(d, run);
          if (spec.final) { problems.push(...limits(await V.completeView(member, { ...run, complete: { ...d, clears: 1 } }), `${hero} cleared`)); reached.push(D.LAST_ROOM); break; }
          if (!d.offer.choices.length) fail(`an empty ${d.offer.kind} offer`);
          for (let n = Math.floor(rng() * 4); n > 0; n--) D.spendPoint(d, 1 + Math.floor(rng() * 4));
          if (d.room % 3 === 0) problems.push(...limits(await V.offerView(member, d, { run }), `${hero} offer ${d.room - 1}`));
          if (rng() < 0.1) D.skipChoice(d);
          else {
            const i = Math.floor(rng() * d.offer.choices.length);
            const r = D.takeChoice(d, i);
            if (r.error === 'full') {
              problems.push(...limits(await V.offerView(member, d, { replace: i }), `${hero} replace`));
              const all = SLOTS.flatMap((s) => d.items[s]);
              const r2 = D.takeChoice(d, i, all[Math.floor(rng() * all.length)]);
              if (!r2.ok) fail(`swap: ${r2.error}`);
            } else if (!r.ok) fail(`pick: ${r.error}`);
          }
          if (Object.values(d.items).flat().length > 12) fail('more than 12 items');
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
