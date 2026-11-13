// What the /descend run log says (src/utils/farm/descentLog.js, data/descentLog.jsonl): where runs end, what kills them, which affixes, bosses and items
// matter. Never touches Discord or the live data apart from reading the log.
// node tools/descend-stats.js [--hero=Haze] [--asc=3] [--bal=<era>|all] [--min=8]
// Default era: the newest one in the log (`bal` changes whenever TUNE, ASC, BOSS, RIVAL or TIER_WEIGHTS do). --min: the fewest fights a row needs to be listed.
const fs = require('node:fs');
const path = require('node:path');
const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const lines = ['descentLog.1.jsonl', 'descentLog.jsonl'].map((f) => path.join(DIR, f)).filter((f) => fs.existsSync(f))
  .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })).filter(Boolean);
if (!lines.length) { console.log('No log yet (data/descentLog.jsonl).'); process.exit(0); }
const era = arg('bal') ?? lines[lines.length - 1].bal;
const keep = (e) => (era === 'all' || e.bal === era) && (!arg('hero') || e.hero === arg('hero')) && (arg('asc') === undefined || e.asc === +arg('asc'));
const all = lines.filter(keep);
const MIN = +(arg('min') ?? 8);
const fights = all.filter((e) => e.e === 'fight');
const ends = all.filter((e) => e.e === 'end');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const avg = (list, f) => (list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0);
const table = (title, rows, head) => {
  if (!rows.length) return;
  console.log(`\n${title}`);
  const out = [head, ...rows].map((r) => r.map(String));
  const w = head.map((_, i) => Math.max(...out.map((r) => r[i].length)));
  out.forEach((r, k) => { console.log(`  ${r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ')}`); if (!k) console.log(`  ${w.map((n) => '-'.repeat(n)).join('  ')}`); });
};
const group = (list, key) => { const m = new Map(); for (const x of list) for (const k of [].concat(key(x))) if (k !== undefined && k !== null) (m.get(k) ?? m.set(k, []).get(k)).push(x); return m; };
const wins = (list) => list.filter((f) => f.won).length;
const floorOf = (room) => Math.ceil(room / 5);

console.log(`Era ${era} | ${new Set(all.map((e) => e.run)).size} runs, ${fights.length} fights${arg('hero') ? `, ${arg('hero')}` : ''}${arg('asc') !== undefined ? `, Ascension ${arg('asc')}` : ''}`);

// runs: how they ended, by hero and ascension
table('How runs end (hero, ascension)', [...group(ends, (e) => `${e.hero} A${e.asc}`)].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
  .map(([k, l]) => [k, l.length, pct(l.filter((e) => e.result === 'cleared').length, l.length), pct(l.filter((e) => e.result === 'died').length, l.length), pct(l.filter((e) => e.result === 'abandoned').length, l.length), (avg(l, (e) => e.rooms)).toFixed(1)]),
['', 'runs', 'cleared', 'died', 'quit', 'avg rooms']);

// rooms: how often a fight there is lost, health lost, how long
table('By room', [...group(fights, (f) => f.room)].sort((a, b) => a[0] - b[0]).filter(([, l]) => l.length >= MIN)
  .map(([room, l]) => [room, l[0].kind, l.length, pct(wins(l), l.length), `${Math.round(100 * avg(l, (f) => f.hpIn - f.hpOut))}%`, avg(l, (f) => f.seconds).toFixed(1), avg(l, (f) => f.rejuvsUsed).toFixed(2)]),
['room', 'kind', 'fights', 'won', 'health lost', 'seconds', 'rejuvs used']);

// who kills: the enemy that dealt most in lost fights
const foe = (f) => f.taken.find((t) => !t.self); // the hero's own costs (Victor) are on taken too
const killers = group(fights.filter((f) => !f.won && f.taken?.some((t) => !t.self)), (f) => foe(f).name.replace(/ \d+$/, ''));
table('What ends runs (the enemy that dealt most in a lost fight)', [...killers].sort((a, b) => b[1].length - a[1].length).slice(0, 15).map(([k, l]) => [k, l.length, pct(l.length, fights.filter((f) => !f.won).length)]), ['enemy', 'losses', 'share']);
const moves = group(fights.filter((f) => !f.won && f.taken?.some((t) => !t.self)), (f) => `${foe(f).name.replace(/ \d+$/, '')}: ${foe(f).by[0].name}`);
table('...and the move', [...moves].sort((a, b) => b[1].length - a[1].length).slice(0, 10).map(([k, l]) => [k, l.length]), ['enemy: move', 'losses']);

// affixes: a fight with the affix against one without it
const withAffix = group(fights.filter((f) => f.kind === 'fight'), (f) => [...new Set(f.groups.flatMap((g) => [g.affix, g.affix2]).filter(Boolean))]);
const plain = fights.filter((f) => f.kind === 'fight' && !f.groups.some((g) => g.affix));
table('Affixes (fights in rooms with it; "plain" = no affixes)', [['plain', plain.length, pct(wins(plain), plain.length), `${Math.round(100 * avg(plain, (f) => f.hpIn - f.hpOut))}%`],
  ...[...withAffix].filter(([, l]) => l.length >= MIN).sort((a, b) => wins(a[1]) / a[1].length - wins(b[1]) / b[1].length)
    .map(([k, l]) => [k, l.length, pct(wins(l), l.length), `${Math.round(100 * avg(l, (f) => f.hpIn - f.hpOut))}%`])], ['affix', 'fights', 'won', 'health lost']);

// bosses, rivals and the last room
const named = group(fights.filter((f) => f.kind !== 'fight'), (f) => (f.kind === 'rival' ? `rival ${f.rival}` : f.final ? 'final room' : `boss ${f.boss}`));
table('Bosses and rivals', [...named].filter(([, l]) => l.length >= Math.min(MIN, 4)).sort((a, b) => wins(a[1]) / a[1].length - wins(b[1]) / b[1].length)
  .map(([k, l]) => [k, l.length, pct(wins(l), l.length), `${Math.round(100 * avg(l, (f) => f.hpIn - f.hpOut))}%`, avg(l, (f) => f.seconds).toFixed(1)]), ['', 'fights', 'won', 'health lost', 'seconds']);

// ascensions
table('By ascension', [...group(fights, (f) => f.asc)].sort((a, b) => a[0] - b[0]).map(([k, l]) => [`A${k}`, l.length, pct(wins(l), l.length), `${Math.round(100 * avg(l, (f) => f.hpIn - f.hpOut))}%`]), ['', 'fights', 'won', 'health lost']);

// items: fights won with the item in the build against fights without (only a hint: strong builds also reach later rooms)
const withItem = group(fights, (f) => [...(f.build?.items ?? []), ...(f.build?.legendary ? [f.build.legendary] : [])]);
const rate = (l) => wins(l) / l.length;
table(`Items in the build (fights won with it vs the average ${pct(wins(fights), fights.length)}; weakest and strongest ${MIN}+ fights)`,
  [...withItem].filter(([, l]) => l.length >= MIN * 2).sort((a, b) => rate(b[1]) - rate(a[1])).map(([k, l]) => [k, l.length, pct(wins(l), l.length)]).filter((_, i, a) => i < 10 || i >= a.length - 10), ['item', 'fights', 'won']);

// picks: how often an offered item is taken
const picks = all.filter((e) => e.e === 'pick' && e.offer?.choices);
const offered = new Map();
const taken = new Map();
for (const p of picks) {
  const names = p.offer.choices.map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
  for (const n of names) offered.set(n, (offered.get(n) ?? 0) + 1);
  if (p.how === 'take' && names[p.index]) taken.set(names[p.index], (taken.get(names[p.index]) ?? 0) + 1);
}
table(`Picks (offered ${MIN}+ times; lowest take rate first)`, [...offered].filter(([, n]) => n >= MIN).map(([k, n]) => [k, n, taken.get(k) ?? 0, pct(taken.get(k) ?? 0, n)]).sort((a, b) => parseInt(a[3]) - parseInt(b[3])).slice(0, 25), ['item', 'offered', 'taken', 'rate']);
const how = group(picks, (p) => p.how);
console.log(`\nOffers: ${[...how].map(([k, l]) => `${k} ${l.length}`).join(', ')}`);
const walks = all.filter((e) => e.e === 'walk');
console.log(`Walks past a rival or stall: ${walks.length}${walks.length ? `, average health lost ${Math.round(100 * avg(walks, (w) => w.lost))}%` : ''}`);
