// Every hero's good-pick clear rate at each ascension, side by side (every hero above 45% at every ascension).
//   node tools/descend-matrix.js [--hero=Name,Name|all] [--asc=0,5,10,15,20|all] [--seeds=20] [--first=1] [--jobs=7] [--bar=0.45]
// Any other --option (and the environment) is passed on to `farm-sim.js descend`. Never touches data/.
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
process.env.DATA_DIR = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'fairfax-matrix-'));
const { roster } = require(path.join(__dirname, '..', 'src', 'utils', 'farm', 'hero'));

const opt = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const OWN = ['hero', 'asc', 'seeds', 'first', 'jobs', 'bar'];
const pass = process.argv.slice(2).filter((a) => !OWN.some((k) => a.startsWith(`--${k}=`)));
const want = String(opt('hero', 'all'));
const heroes = want.toLowerCase() === 'all' ? roster() : want.split(',').map((x) => roster().find((n) => n.toLowerCase() === x.trim().toLowerCase())).filter(Boolean);
const ascs = String(opt('asc', '0,5,10,15,20')) === 'all' ? Array.from({ length: 21 }, (_, i) => i) : String(opt('asc', '0,5,10,15,20')).split(',').map(Number);
const SEEDS = Number(opt('seeds', 20));
const BAR = Number(opt('bar', 0.45));

const cleared = (hero, a) => new Promise((resolve) => {
  execFile('node', [path.join(__dirname, 'farm-sim.js'), 'descend', `--hero=${hero}`, `--seeds=${SEEDS}`, `--first=${opt('first', 1)}`, '--good-only=1', `--ascension=${a}`, ...pass],
    { maxBuffer: 1e7 }, (err, out) => resolve(err ? NaN : Number(/cleared (\d+)/.exec(out)?.[1] ?? 0) / SEEDS));
});

(async () => {
  const jobs = heroes.flatMap((hero) => ascs.map((a) => ({ hero, a })));
  const got = {};
  let next = 0;
  await Promise.all(Array.from({ length: Number(opt('jobs', 7)) }, async () => {
    while (next < jobs.length) { const j = jobs[next++]; (got[j.hero] ??= {})[j.a] = await cleared(j.hero, j.a); }
  }));
  const pct = (x) => `${Math.round(x * 100)}%`.padStart(5);
  console.log(`${'Hero'.padEnd(16)}${ascs.map((a) => `A${a}`.padStart(5)).join('')}   lowest`);
  const rows = heroes.map((h) => ({ h, low: Math.min(...ascs.map((a) => got[h][a])) })).sort((x, y) => x.low - y.low);
  for (const { h, low } of rows) console.log(`${h.padEnd(16)}${ascs.map((a) => pct(got[h][a])).join('')}   ${pct(low)}${low < BAR ? '  under' : ''}`);
  const mean = (a) => heroes.reduce((s, h) => s + got[h][a], 0) / heroes.length;
  console.log(`${'Roster'.padEnd(16)}${ascs.map((a) => pct(mean(a))).join('')}`);
  console.log(`Under ${pct(BAR).trim()}: ${rows.filter((r) => r.low < BAR).length} of ${heroes.length} heroes`);
})();
