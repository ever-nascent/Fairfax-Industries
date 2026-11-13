// Each hero's /descend tuning (Nov 2, his ask: "find a way once and for all to balance the modes, so Ascension 20 is beatable for all characters"):
// the health and damage share (descent.js TUNING) at which the good-pick bot of tools/farm-sim.js clears `--target` of its Ascension 20 runs.
//   node tools/descend-tuning.js [--hero=Name,Name|all] [--target=0.4] [--runs=12] [--jobs=2] [--redo=1]
// Saved to assets/farm/descendTuning.json one hero at a time (a stopped run carries on; `--redo=1` measures again). Every try plays the same seeds, so two
// tunings differ only by the tuning. Re-run it after changing heroes, items, enemies, the engine or the ascensions. Idle priority; never touches data/.
try { require('node:os').setPriority(0, require('node:os').constants.priority.PRIORITY_LOW); } catch {}
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-tuning-'));
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { roster } = require(path.join(__dirname, '..', 'src', 'utils', 'farm', 'hero'));

const FILE = path.join(__dirname, '..', 'assets', 'farm', 'descendTuning.json');
const opt = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const TARGET = Number(opt('target', 0.4));
const RUNS = Number(opt('runs', 12));
const JOBS = Number(opt('jobs', 2));
const STEP = 1.25; // the health-and-damage multiplier moves by this much until the target is between two tries
const [LO, HI] = [0.4, 3]; // never tuned past these multipliers

// The share of RUNS good-pick runs at Ascension 20 that clear the descent with tuning `t`.
const cleared = (hero, t) => new Promise((resolve) => {
  execFile('node', [path.join(__dirname, 'farm-sim.js'), 'descend', `--hero=${hero}`, `--seeds=${RUNS}`, '--good-only=1', '--ascension=20', `--tuning=${t}`],
    { maxBuffer: 1e7 }, (err, out) => resolve(Number(/cleared (\d+)/.exec(out)?.[1] ?? 0) / RUNS));
});
const round = (m) => Math.round((m - 1) * 100) / 100;

async function tune(hero, start = 0) {
  const tries = new Map(); // multiplier -> cleared
  const at = async (m) => { m = Math.max(LO, Math.min(HI, m)); if (!tries.has(m)) tries.set(m, await cleared(hero, round(m))); return tries.get(m); };
  let m = 1 + start;
  let r = await at(m);
  const up = r < TARGET;
  for (let i = 0; i < 8 && (up ? r < TARGET : r >= TARGET) && m > LO && m < HI; i++) { m = up ? m * STEP : m / STEP; r = await at(m); }
  // bracketed (or at a limit): halve the gap twice, then read the multiplier off the line between the two closest tries
  for (let i = 0; i < 2; i++) {
    const below = [...tries].filter(([, x]) => x < TARGET).sort((a, b) => b[0] - a[0])[0];
    const above = [...tries].filter(([, x]) => x >= TARGET).sort((a, b) => a[0] - b[0])[0];
    if (!below || !above) break;
    await at(Math.sqrt(below[0] * above[0]));
  }
  const below = [...tries].filter(([, x]) => x < TARGET).sort((a, b) => b[0] - a[0])[0];
  const above = [...tries].filter(([, x]) => x >= TARGET).sort((a, b) => a[0] - b[0])[0];
  const best = !below ? above[0] : !above ? below[0] : below[0] + ((above[0] - below[0]) * (TARGET - below[1])) / Math.max(1e-9, above[1] - below[1]);
  return { tuning: round(best), tries: Object.fromEntries([...tries].sort((a, b) => a[0] - b[0]).map(([k, v]) => [round(k), v])) };
}

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { heroes: {} }; } };
const want = String(opt('hero', 'all'));
const heroes = want.toLowerCase() === 'all' ? roster() : want.split(',').map((x) => roster().find((n) => n.toLowerCase() === x.trim().toLowerCase())).filter(Boolean);
const todo = heroes.filter((h) => opt('redo') || read().heroes?.[h] === undefined);
let next = 0;
const worker = async () => {
  while (next < todo.length) {
    const hero = todo[next++];
    const { tuning, tries } = await tune(hero, read().heroes?.[hero] ?? 0);
    const all = read(); // read again: the other worker may have saved meanwhile
    all.heroes = Object.fromEntries(Object.entries({ ...all.heroes, [hero]: tuning }).sort(([a], [b]) => a.localeCompare(b)));
    all.measured = { ...(all.measured ?? {}), [hero]: tries };
    all.target = TARGET;
    all.runs = RUNS;
    fs.writeFileSync(FILE, `${JSON.stringify(all, null, 1)}\n`);
    console.log(`${hero}: ${tuning >= 0 ? '+' : ''}${Math.round(tuning * 100)}%   tries ${Object.entries(tries).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join(' ')}`);
  }
};
Promise.all(Array.from({ length: JOBS }, worker));
