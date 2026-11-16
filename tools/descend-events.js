// What each Descend event, door and hero deal is worth ("ensure that an event is adequately powerful, or weaken them if they are too strong").
//   node tools/descend-events.js [--hero=Name,Name|all] [--ascension=10] [--seeds=12] [--jobs=7] [--events=1|deals]
// Good-pick runs (farm-sim.js descend --events): at every door, Mystery Room and deal the run is played to its end both ways on the same dice (the door
// taken or the other one; the deal taken or turned down). Listed: how often each way cleared the descent and the rooms it reached. `--events=deals`
// leaves the doors out (most of the time goes there). Never touches data/.
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
process.env.DATA_DIR = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'fairfax-events-'));
const { roster } = require(path.join(__dirname, '..', 'src', 'utils', 'farm', 'hero'));

const opt = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const want = String(opt('hero', 'Haze,Victor,Vindicta,Grey Talon,Holliday,Silver,Vyper,Sinclair'));
const heroes = want.toLowerCase() === 'all' ? roster() : want.split(',').map((x) => roster().find((n) => n.toLowerCase() === x.trim().toLowerCase())).filter(Boolean);
const SEEDS = Number(opt('seeds', 12));
const CHUNK = 3;
const pass = process.argv.slice(2).filter((a) => !['hero', 'seeds', 'jobs', 'ascension', 'events'].some((k) => a.startsWith(`--${k}=`)));

const run = (hero, first) => new Promise((resolve) => {
  execFile('node', [path.join(__dirname, 'farm-sim.js'), 'descend', `--hero=${hero}`, `--seeds=${CHUNK}`, `--first=${first}`, '--good-only=1', `--ascension=${opt('ascension', 10)}`, `--events=${opt('events', 1)}`, ...pass],
    { maxBuffer: 1e7 }, (err, out) => resolve(JSON.parse(/^EVENTS (.*)$/m.exec(out ?? '')?.[1] ?? '{}')));
});

(async () => {
  const jobs = heroes.flatMap((hero) => Array.from({ length: Math.ceil(SEEDS / CHUNK) }, (_, i) => ({ hero, first: 1 + i * CHUNK })));
  const total = {};
  let next = 0;
  await Promise.all(Array.from({ length: Number(opt('jobs', 7)) }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      for (const [label, t] of Object.entries(await run(j.hero, j.first))) { const s = (total[label] ??= { n: 0, a: 0, b: 0, ra: 0, rb: 0 }); for (const k of Object.keys(s)) s[k] += t[k]; }
    }
  }));
  const pct = (x) => `${Math.round(x * 100)}%`.padStart(5);
  console.log(`${'Choice'.padEnd(22)}${'tries'.padStart(6)}  cleared: taken / not   change   rooms: taken / not`);
  for (const [label, t] of Object.entries(total).sort(([x], [y]) => x.localeCompare(y))) {
    const d = (t.a - t.b) / t.n;
    console.log(`${label.padEnd(22)}${String(t.n).padStart(6)}  ${pct(t.a / t.n)} / ${pct(t.b / t.n)}        ${(d >= 0 ? '+' : '') + Math.round(d * 100)}`.padEnd(58) + `${(t.ra / t.n).toFixed(1)} / ${(t.rb / t.n).toFixed(1)}`);
  }
})();
