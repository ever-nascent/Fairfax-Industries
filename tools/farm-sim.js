// Hero Farming balance simulations: the tool the enemy numbers in src/utils/farm/targets.js (HARDNESS, GROWTH, BOSS_RESISTS) were tuned with.
// Run: node tools/farm-sim.js <command>   (or double-click "Farm Simulation.bat" for the menu). Never touches data/ (a temp DATA_DIR).
//   ladder   win rates of typical (random) and best kits at each stage against every target: does each target open at its level?
//   tune     the HARDNESS each target would need for typical kits to win 55% (--wins=0.55 to change); compare with targets.js
//   siege    what a full siege run needs: item count, tier, Rejuvs, buffs and level, with typical kits
//   growth   how the clear scaling (GROWTH, CLEAR_RESIST) changes win rates at 0 / 5 / 10 clears
//   rank     how much each shop item helps on its own (what "best kit" means below)
//   lanes    the three Walkers (6000 / 9000 / 12000 health as the others fall) and the siege they open: what does a full lane run need?
//   waves    how far typical and best kits of each stage get in a wave run (/lane run), and what it pays
//   legendary  win rates of typical kits at each target's own stage with each legendary added, against none
//   race     every hero (or --hero=) from level 0 with no items, +1 level then +1 item...: the first step that wins each target, the fight's length, the souls it takes (--kits=6 --seeds=4)
//   retune   the HARDNESS at which the middle hero of the whole roster wins 55% at each target, and the spread around it (--target=<key> for one)
//   roster   every hero's win rates at every target, weakest first (--f= for harder enemies)
//   carry    what carries a hero: its win rates whole and without each ability in turn (--hero=, --f=)
//   best     can this hero win with the right kit? its best kit of each stage against that stage's target (--hero=, --f=1,1.5)
//   descend  /descend runs (descent.js): how deep a bot that picks at random gets, against one that picks well (tries each choice on the next room);
//            median, quarters and what ended the runs (--seeds=20 runs each; --hero=, or --hero=all for the roster, random and good medians only)
//   check    the gate for a new hero: a typical kit of each target's own stage must win at least 35% (heroes may differ, above 75% is only noted as easy)
// Options: --hero=Abrams (default Haze; tune and check every hero before it goes in the roster), --kits=24 --seeds=5 (kits x seeds fights per number).
// A "kit" is what a member would have at a stage: level, ability points spent in order, items, permanent buffs, Rejuvs. The stages are in STAGES.
try { require('node:os').setPriority(0, require('node:os').constants.priority.PRIORITY_LOW); } catch {} // idle priority (the sims took his whole CPU)
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-sim-'));
const path = require('node:path');
const ROOT = path.join(__dirname, '..', 'src', 'utils', 'farm');
const { Fight, enemy } = require(path.join(ROOT, 'engine'));
const { buildHero, heroNames, roster } = require(path.join(ROOT, 'hero'));
const { simulate } = require(path.join(ROOT, 'play'));
const { TARGETS, SIEGE, HARDNESS } = require(path.join(ROOT, 'targets'));
const { progress, THRESHOLDS, TIER_COSTS, POOL } = require(path.join(ROOT, 'levels'));
const { itemByName } = require(path.join(ROOT, 'stats'));

const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const pick = (arr, n, rng) => { const a = [...arr]; const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
const pct = (x) => `${Math.round(x * 100)}%`;
const opt = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const arg = (name, fallback) => Number(opt(name, fallback));
const HERO = heroNames().find((n) => n.toLowerCase() === String(opt('hero', 'Haze')).toLowerCase()) ?? (opt('hero') === 'all' ? 'Haze' : null); // 'all': descend's roster sweep
if (!HERO) { console.log(`Unknown hero. The farm has data for: ${heroNames().join(', ')}`); process.exit(1); }
// Every number is KITS x SEEDS fights (120), with the same kits in every command, so the commands agree with each other.
const KITS = arg('kits', 24);
const SEEDS = arg('seeds', 5);
const KIT_SEED = 424242;
const ONE_KIT = { seeds: KITS * SEEDS }; // a single kit (the best one) gets as many fights as the typical kits do together

// ---- kits ----
const STAGES = { // level, items per kind and the highest tier, permanent buffs, Rejuvs
  'small-camp': { level: 0, per: 0, cap: 1, buffs: 0 },
  'medium-camp': { level: 6, per: 1, cap: 1, only: 'weapon', buffs: 0 },
  'large-camp': { level: 12, per: 1, cap: 1, buffs: 0 },
  guardian: { level: 18, per: 2, cap: 2, buffs: 6 },
  walker: { level: 24, per: 3, cap: 3, buffs: 12 },
  'mid-boss': { level: 28, per: 4, cap: 3, buffs: 18 },
  siege: { level: 35, per: 4, cap: 4, buffs: 24, rejuvs: 3 },
};
const KEYS = Object.keys(STAGES);
const BUFF_ORDER = ['weaponDamage', 'fireRate', 'maxHealth', 'maxAmmo', 'spiritPower', 'cooldownReduction', 'bulletResist', 'spiritResist'];
const buffsOf = (n) => { const b = {}; for (let i = 0; i < n; i++) { const k = BUFF_ORDER[i % 8]; b[k] = (b[k] || 0) + 1; } return b; };
// ability points spent like a sensible member: every unlocked ability to tier 1, then the tier 2s, then the tier 3s
function allocate(level) {
  const p = progress((THRESHOLDS[level] - 600) * require(path.join(ROOT, 'targets')).PAYOUT_SCALE);
  let points = p.points;
  const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const tier of [0, 1, 2]) for (let s = 1; s <= p.unlocks; s++) if (tiers[s] === tier && points >= TIER_COSTS[tier]) { tiers[s]++; points -= TIER_COSTS[tier]; }
  return { tiers, unlocked: p.unlocks };
}
// a typical kit: random items of the stage's tiers (a member's choices vary a lot)
const randomKits = (st, seed = KIT_SEED, n = KITS) => { const rng = seeded(seed); return Array.from({ length: n }, () => Object.entries(POOL).filter(([k]) => !st.only || st.only === k).flatMap(([, names]) => pick(names.filter((x) => itemByName(x).Tier <= st.cap), st.per, rng))); };
let ranked = null; // rank()'s result, worked out once per run
// the best kit: the items that help most (rank), the top `per` of each kind up to the tier cap
function bestKit(st) {
  if (!ranked) rank(false);
  return Object.entries(ranked).filter(([k]) => !st.only || st.only === k).flatMap(([k, rows]) => rows.filter((r) => r.tier <= st.cap)
    .sort((a, b) => (k === 'vitality' ? b.sur - a.sur : b.off - a.off)).slice(0, st.per).map((r) => r.n));
}

// ---- running fights ----
// Enemy damage x f for the callback (HARDNESS is a multiplier on the wiki-based numbers, so this tries other settings without editing targets.js).
function withDamage(f, fn) {
  const saved = new Map();
  const wrap = (holder) => { saved.set(holder, holder.enemies); holder.enemies = () => saved.get(holder)().map((e) => { e.stats.dps *= f; e.stats.dpsMaxHealthPct *= f; if (e.stats.blast) { e.stats.blast.damage *= f; e.stats.blast.maxHealthPct *= f; } return e; }); };
  for (const t of Object.values(TARGETS)) wrap(t);
  for (const s of SIEGE.stages) wrap(s);
  try { return fn(); } finally { for (const [holder, orig] of saved) holder.enemies = orig; }
}
function winRate(key, st, lists, { f = 1, clears = 0, seeds = SEEDS, level = st.level, buffs = st.buffs, rejuvs = st.rejuvs ?? 3, walkersDown = 0, hero = HERO } = {}) {
  return withDamage(f, () => {
    const a = allocate(level);
    let w = 0;
    for (const items of lists) for (let s = 1; s <= seeds; s++) if (simulate(hero, key, { rng: seeded(s * 100003), boons: level, items, buffs: buffsOf(buffs), rejuvs, clears, walkersDown, ...a }).won) w++;
    return w / (lists.length * seeds);
  });
}

// ---- commands ----
function ladder() {
  console.log('Win rate of a typical kit (random items) of each stage (rows) against every target (columns), then the best kit.');
  for (const [title, kitFor] of [['typical kits', (st) => randomKits(st)], ['best kits', (st) => [bestKit(st)]]]) {
    console.log(`\n${title}\n${'kit'.padEnd(30)}${KEYS.map((k) => k.replace('-camp', '').padEnd(9)).join('')}`);
    for (const kk of KEYS) {
      const st = STAGES[kk];
      const lists = st.per ? kitFor(st) : [[]];
      console.log(`L${st.level} (${st.per * (st.only ? 1 : 3)} items, ${st.buffs} buffs)`.padEnd(30) + KEYS.map((t) => pct(winRate(t, st, lists, lists.length === 1 ? ONE_KIT : {})).padEnd(9)).join(''));
    }
  }
}

function tune() {
  const wins = arg('wins', 0.55);
  console.log(`The HARDNESS at which typical kits of a target's own stage win ${pct(wins)}. Compare with HARDNESS in targets.js (a lower number = easier).`);
  for (const key of KEYS.slice(1)) {
    const st = STAGES[key];
    const lists = randomKits(st);
    let lo = 0.02, hi = 6;
    for (let i = 0; i < 10; i++) { const mid = Math.sqrt(lo * hi); if (winRate(key, st, lists, { f: mid }) >= wins) lo = mid; else hi = mid; }
    console.log(`${key.padEnd(12)} now ${String(HARDNESS[key]).padEnd(6)} suggested ${+(HARDNESS[key] * lo).toFixed(3)}`);
  }
}

function siegeNeeds() {
  const base = STAGES.siege;
  const rate = (o) => pct(winRate('siege', { ...base, ...o }, randomKits({ ...base, ...o }), { level: o.level ?? base.level, buffs: o.buffs ?? base.buffs, rejuvs: o.rejuvs ?? 3 }));
  console.log('Siege win rate with typical kits (random items) when one thing is taken away from a full kit:\n');
  const cases = {
    'full kit (level 35, 12 items up to tier 4, 24 buffs, 3 Rejuvs)': {}, '12 items up to tier 3': { cap: 3 }, '12 items up to tier 2': { cap: 2 }, '9 items': { per: 3 }, '6 items': { per: 2 }, '3 items': { per: 1 },
    'no buffs': { buffs: 0 }, '12 buffs': { buffs: 12 }, '2 Rejuvs': { rejuvs: 2 }, '1 Rejuv': { rejuvs: 1 }, 'no Rejuvs': { rejuvs: 0 }, 'level 30': { level: 30 }, 'level 28': { level: 28 }, 'level 24': { level: 24 },
  };
  for (const [name, o] of Object.entries(cases)) console.log(name.padEnd(64), rate(o));
}

function growth() {
  console.log('Win rates after 0 / 5 / 10 clears of the same target (the clear scaling in targets.js).\n');
  const NEXT = { 'medium-camp': 'large-camp', 'large-camp': 'guardian', guardian: 'walker', walker: 'mid-boss', 'mid-boss': 'siege', siege: 'siege' };
  console.log(`${'target'.padEnd(13)}${'typical kit of its level'.padEnd(30)}${'best kit of its level'.padEnd(26)}best kit one stage later`);
  for (const key of KEYS.slice(1)) {
    const st = STAGES[key];
    const nx = STAGES[NEXT[key]];
    const cols = [
      [0, 5, 10].map((c) => pct(winRate(key, st, randomKits(st), { clears: c }))),
      [0, 5, 10].map((c) => pct(winRate(key, st, [bestKit(st)], { clears: c, ...ONE_KIT }))),
      [0, 5, 10].map((c) => pct(winRate(key, nx, [bestKit(nx)], { clears: c, ...ONE_KIT, level: nx.level, buffs: nx.buffs }))),
    ];
    console.log(key.padEnd(13) + cols.map((c, i) => c.join(' / ').padEnd(i < 2 ? (i ? 26 : 30) : 0)).join(''));
  }
}

function rank(print = true) {
  const offense = (items) => { let d = 0; for (let s = 1; s <= 5; s++) { const hero = buildHero(HERO, { items, boons: 20 }); const foe = enemy('Boss', { maxHealth: 20000, dps: 0, bulletResist: 0.2, spiritResist: 0.2, distance: 20 }); const f = new Fight({ heroes: [hero], enemies: [foe], rng: seeded(s * 7919) }); f.run(40); d += f.dealt.get(hero) || 0; } return d / 5 / 40; };
  // how long the hero lasts, against weapon damage and against spirit damage (the Walker and the Patron), averaged
  const survive = (items) => { let t = 0; for (const damageType of ['bullet', 'spirit']) for (let s = 1; s <= 5; s++) { const hero = buildHero(HERO, { items, boons: 20 }); const foe = enemy('Boss', { maxHealth: 1e7, dps: 40, damageType, bulletResist: 0.2, spiritResist: 0.2, distance: 20 }); const f = new Fight({ heroes: [hero], enemies: [foe], rng: seeded(s * 7919) }); f.run(200); t += f.time; } return t / 10; };
  const base = { off: offense([]), sur: survive([]) };
  const out = {};
  for (const [kind, names] of Object.entries(POOL)) out[kind] = names.map((n) => ({ n, tier: itemByName(n).Tier, off: +(offense([n]) / base.off).toFixed(3), sur: +(survive([n]) / base.sur).toFixed(3) }));
  ranked = out;
  if (!print) return;
  console.log(`How much each item helps alone (damage dealt for weapon and spirit items, how long the hero lasts for vitality items; 1.0 = no change), top 6 of each tier:`);
  for (const [kind, rows] of Object.entries(out)) {
    console.log(`\n${kind}`);
    for (const t of [1, 2, 3, 4]) console.log(`  tier ${t}: ${rows.filter((r) => r.tier === t).sort((a, b) => (kind === 'vitality' ? b.sur - a.sur : b.off - a.off)).slice(0, 6).map((r) => `${r.n} x${kind === 'vitality' ? r.sur : r.off}`).join(' | ')}`);
  }
}

// The siege only opens with all three Walkers down, and each Walker is tougher for every other one already down.
function lanes() {
  console.log('Typical kits of each stage against the first, second and third Walker (6000 / 9000 / 12000 health), then the chance of winning all three in a row, then the siege.\n');
  console.log(`${'kit'.padEnd(30)}${['1st', '2nd', '3rd', 'all 3', 'siege', 'all 3 + siege'].map((h) => h.padEnd(9)).join('')}`);
  for (const kk of ['walker', 'mid-boss', 'siege']) {
    const st = STAGES[kk];
    const kits = randomKits(st);
    const w = [0, 1, 2].map((n) => winRate('walker', st, kits, { walkersDown: n }));
    const all = w[0] * w[1] * w[2];
    const s = winRate('siege', st, kits);
    console.log(`L${st.level} (${st.per * 3} items, ${st.buffs} buffs)`.padEnd(30) + [...w, all, s, all * s].map((x) => pct(x).padEnd(9)).join(''));
  }
}

// A wave run goes on until the hero falls: how many waves does each stage's kit clear, and for how many souls?
function waves() {
  const { wavesPay } = require(path.join(ROOT, 'targets'));
  console.log('Waves cleared in one run (average, then the worst and best run) and the souls an average run pays, for typical and best kits of each stage.\n');
  console.log(`${'kit'.padEnd(30)}${'typical'.padEnd(26)}best kit`);
  const runs = (st, lists, seeds) => { const a = allocate(st.level); const out = []; for (const items of lists) for (let s = 1; s <= seeds; s++) out.push(simulate(HERO, 'waves', { rng: seeded(s * 100003), boons: st.level, items, buffs: buffsOf(st.buffs), ...a }).cleared); return out; };
  const show = (list) => { const avg = list.reduce((x, y) => x + y, 0) / list.length; return `${avg.toFixed(1)} (${Math.min(...list)}-${Math.max(...list)})  ${Math.round(wavesPay(Math.round(avg)))} souls`; };
  for (const kk of KEYS) {
    const st = STAGES[kk];
    const typical = runs(st, st.per ? randomKits(st) : [[]], st.per ? SEEDS : KITS * SEEDS);
    const best = runs(st, [st.per ? bestKit(st) : []], KITS * SEEDS);
    console.log(`L${st.level} (${st.per * (st.only ? 1 : 3)} items, ${st.buffs} buffs)`.padEnd(30) + show(typical).padEnd(26) + show(best));
  }
}

// The gate for a hero: a typical kit of each target's own stage should win some but not all of its fights there.
function check() {
  const [lo, hi] = [0.35, 0.75];
  console.log(`Typical kits of each target's own stage: at least ${pct(lo)} wins passes; above ${pct(hi)} is noted as easy (heroes are allowed to differ).
`);
  let bad = 0;
  for (const key of KEYS.slice(1)) {
    const r = winRate(key, STAGES[key], randomKits(STAGES[key]));
    if (r < lo) bad++;
    console.log(`${key.padEnd(12)} ${pct(r).padEnd(6)} ${r < lo ? 'TOO HARD' : r > hi ? 'ok (easy)' : 'ok'}`);
  }
  console.log(bad ? `
${HERO} fails ${bad} of ${KEYS.length - 1} targets.` : `
${HERO} passes every target.`);
  process.exitCode = bad ? 1 : 0;
}

// The same typical kits at each target's own stage, without a legendary and with each one added (in the legendary slot, on top of the 12).
function legendary() {
  const { LEGENDARY_NAMES } = require(path.join(ROOT, 'levels'));
  const keys = KEYS.slice(1);
  console.log(`Typical kits of each target's own stage, without and with each legendary (only what fights simulate of it).
${''.padEnd(22)}${keys.map((k) => k.replace('-camp', '').padEnd(10)).join('')}`);
  const base = keys.map((k) => winRate(k, STAGES[k], randomKits(STAGES[k])));
  console.log('no legendary'.padEnd(22) + base.map((r) => pct(r).padEnd(10)).join(''));
  for (const name of LEGENDARY_NAMES) {
    const rates = keys.map((k) => winRate(k, STAGES[k], randomKits(STAGES[k]).map((items) => [...items, name])));
    console.log(name.padEnd(22) + rates.map((r, i) => `${pct(r)}${r - base[i] >= 0.005 ? ` +${Math.round((r - base[i]) * 100)}` : ''}`.padEnd(10)).join(''));
  }
}

// Every hero from nothing, one step at a time: level 0 with no items, then a level, then an item, then a level... (12 items by
// level 12, then levels only up to 35). Items come three of each tier, tier 1 first, any kind, at random (--kits orders x --seeds fights a step).
// No permanent buffs, no clears; the siege gets 3 Rejuvs. A hero "wins" a target at the first step where at least half the fights are won.
// Souls needed = what the hero's trips must have paid to reach that level + the shop price of the items.
function race() {
  const { PAYOUT_SCALE } = require(path.join(ROOT, 'targets'));
  const only = opt('hero', null);
  const heroes = only ? [HERO] : roster();
  const kits = arg('kits', 6);
  const seeds = arg('seeds', 4);
  const all = Object.values(POOL).flat();
  const orders = Array.from({ length: kits }, (_, k) => { const rng = seeded(KIT_SEED + k); return [1, 2, 3, 4].flatMap((t) => pick(all.filter((x) => itemByName(x).Tier === t), 3, rng)); });
  const LAST = THRESHOLDS.length - 1 + 12;
  const at = (n) => ({ level: n <= 24 ? Math.ceil(n / 2) : n - 12, items: Math.min(12, Math.floor(n / 2)) });
  const souls = ({ level, items }) => Math.round((THRESHOLDS[level] - THRESHOLDS[0]) * PAYOUT_SCALE + orders.reduce((sum, o) => sum + o.slice(0, items).reduce((s, x) => s + itemByName(x).Cost, 0), 0) / kits);
  const fmt = (n) => n.toLocaleString('en-US');
  console.log(`Every hero from level 0 with no items: +1 level, then +1 item, and so on. First step where at least half of ${kits * seeds} fights are won.\n`);
  const summary = Object.fromEntries(heroes.map((h) => [h, []]));
  for (const key of KEYS) {
    const rows = heroes.map((hero) => {
      for (let n = 0; n <= LAST; n++) {
        const s = at(n);
        const a = allocate(s.level);
        let won = 0;
        let time = 0;
        for (const order of orders) for (let seed = 1; seed <= seeds; seed++) {
          const out = simulate(hero, key, { rng: seeded(seed * 100003), boons: s.level, items: order.slice(0, s.items), rejuvs: key === 'siege' ? 3 : 0, ...a });
          if (out.won) { won++; time += out.seconds; }
        }
        if (won * 2 >= kits * seeds) return { hero, n, ...s, rate: won / (kits * seeds), time: time / won, souls: souls(s) };
      }
      return { hero, n: Infinity };
    }).sort((x, y) => x.n - y.n || x.time - y.time);
    console.log(`${key}\n  ${'#'.padEnd(4)}${'hero'.padEnd(14)}${'level'.padEnd(7)}${'items'.padEnd(7)}${'wins'.padEnd(7)}${'fight'.padEnd(9)}souls needed`);
    rows.forEach((r, i) => {
      summary[r.hero].push(r.n);
      console.log(`  ${String(i + 1).padEnd(4)}${r.hero.padEnd(14)}${r.n === Infinity ? 'never, even at level 35 with 12 items' : `${String(r.level).padEnd(7)}${String(r.items).padEnd(7)}${pct(r.rate).padEnd(7)}${`${Math.round(r.time)} s`.padEnd(9)}${fmt(r.souls)}`}`);
    });
    console.log('');
  }
  console.log(`Overall (steps needed, added up over the ${KEYS.length} targets; fewer = stronger with less)`);
  Object.entries(summary).map(([h, ns]) => [h, ns.reduce((a, b) => a + (b === Infinity ? LAST + 1 : b), 0)]).sort((a, b) => a[1] - b[1]).forEach(([h, total], i) => console.log(`  ${String(i + 1).padEnd(4)}${h.padEnd(14)}${total}`));
}

// The roster-wide tune (the enemies were tuned on Haze, one of the weakest heroes): the HARDNESS at which the MIDDLE hero of the
// roster wins --wins (55%) with typical kits of each target's own stage, and how the whole roster then spreads around it.
// --target=walker does one target (they can run side by side); --at=0.25 tunes on the hero a quarter of the way up instead of the middle one;
// --kits=8 --seeds=2 fights per hero per try.
function retune() {
  const wins = arg('wins', 0.55);
  const only = opt('target', null);
  const kits = arg('kits', 8);
  const seeds = arg('seeds', 2);
  const heroes = roster();
  const at = arg('at', 0.5);
  for (const key of KEYS.slice(1).filter((k) => !only || k === only)) {
    const st = STAGES[key];
    const lists = randomKits(st, KIT_SEED, kits);
    const spread = (f) => heroes.map((hero) => [hero, winRate(key, st, lists, { f, seeds, hero })]).sort((a, b) => a[1] - b[1]);
    const middle = (rows) => rows[Math.floor(rows.length * at)][1]; // the hero that far up the roster (0.5 = the middle one, 0.25 = a quarter of the way up)
    let lo = 0.05, hi = 8;
    for (let i = 0; i < 9; i++) { const mid = Math.sqrt(lo * hi); if (middle(spread(mid)) >= wins) lo = mid; else hi = mid; }
    const rows = spread(lo);
    const under = rows.filter(([, r]) => r < 0.35).map(([h, r]) => `${h} ${pct(r)}`);
    console.log(`${key.padEnd(12)} now ${String(HARDNESS[key]).padEnd(6)} suggested ${+(HARDNESS[key] * lo).toFixed(3)} (x${lo.toFixed(2)})  weakest ${pct(rows[0][1])}, tuned hero ${pct(middle(rows))}, median ${pct(rows[Math.floor(rows.length / 2)][1])}, strongest ${pct(rows.at(-1)[1])}; under 35%: ${under.length ? under.join(', ') : 'nobody'}; over 75%: ${rows.filter(([, r]) => r > 0.75).length} of ${rows.length}`);
  }
}

// Every hero's win rate with typical kits at each target's own stage, weakest first (--f=1.5 to try harder enemies; --kits=12 --seeds=3).
function rosterTable() {
  const f = arg('f', 1);
  const kits = arg('kits', 12);
  const seeds = arg('seeds', 3);
  const keys = KEYS.slice(1);
  const rows = roster().map((hero) => [hero, keys.map((key) => winRate(key, STAGES[key], randomKits(STAGES[key], KIT_SEED, kits), { f, seeds, hero }))]);
  rows.sort((a, b) => a[1].reduce((x, y) => x + y, 0) - b[1].reduce((x, y) => x + y, 0));
  console.log(`Typical kits at each target's own stage, enemy damage x${f}, ${kits * seeds} fights per number, weakest hero first.
${''.padEnd(14)}${keys.map((k) => k.replace('-camp', '').padEnd(10)).join('')}average`);
  for (const [hero, rates] of rows) console.log(hero.padEnd(14) + rates.map((r) => pct(r).padEnd(10)).join('') + pct(rates.reduce((x, y) => x + y, 0) / rates.length));
}

// What carries a hero: its win rates with typical kits, whole and with each ability taken away in turn (--hero=, --f=1.5 for enemies hard enough to
// tell the difference; --kits=12 --seeds=3).
function carry() {
  const { logicOf } = require(path.join(ROOT, 'hero'));
  const { Unimplemented } = require(path.join(ROOT, 'ability'));
  const f = arg('f', 1);
  const kits = arg('kits', 12);
  const seeds = arg('seeds', 3);
  const keys = KEYS.slice(1);
  const logic = logicOf(HERO);
  const names = buildHero(HERO).abilities.map((a) => a.name);
  const line = (label) => console.log(label.padEnd(34) + keys.map((key) => pct(winRate(key, STAGES[key], randomKits(STAGES[key], KIT_SEED, kits), { f, seeds })).padEnd(10)).join(''));
  console.log(`${HERO}, typical kits at each target's own stage, enemy damage x${f}, ${kits * seeds} fights per number.
${''.padEnd(34)}${keys.map((k) => k.replace('-camp', '').padEnd(10)).join('')}`);
  line('whole kit');
  for (const slot of [1, 2, 3, 4]) {
    const real = logic.abilities[slot];
    logic.abilities[slot] = Unimplemented;
    try { line(`without ${names[slot - 1]}`); } finally { logic.abilities[slot] = real; }
  }
}

// Can this hero win with the right kit (his bar, Oct 5)? One line: the best kit of each target's own stage (the items that help this hero most,
// its ability points spent, the stage's buffs, 3 Rejuvs at the siege) against that target, at each --f (default 1 and 1.5). --hero=, --seeds=36.
function best() {
  const seeds = arg('seeds', 36);
  const keys = KEYS.slice(1);
  for (const f of String(opt('f', '1,1.5')).split(',').map(Number)) {
    console.log(`${HERO.padEnd(14)}x${String(f).padEnd(5)}${keys.map((key) => pct(winRate(key, STAGES[key], [bestKit(STAGES[key])], { f, seeds })).padEnd(10)).join('')}`);
  }
}

// /descend (descent.js): whole runs from room 1 until the hero falls. The random bot picks any choice (a full build gives up its cheapest item). The good
// bot plays like a member who knows the game: it takes the item worth the most to its hero over what it replaces (`worth`), gives up its least useful item
// when full, skips to heal when low with nothing much on offer, and for a boss's buff or legendary plays each choice on the next room and keeps the best.
// It flees a rival it loses to in two of three tries (Flee passes the room with nothing).
// Both spend ability points in order (tier 1s, then 2s, then 3s).
function descend() {
  const D = require(path.join(ROOT, 'descent'));
  const ASCENSION = Math.max(0, Math.min(D.MAX_ASCENSION, Number(opt('ascension', 0)) || 0)); // --ascension=N plays every run at that level
  const { SLOTS, countItems, priceFor } = require(path.join(ROOT, 'levels'));
  const runs = arg('seeds', 20);
  const FIRST = arg('first', 1); // --first=101: seeds from 101 on (Nov 2: to check a tuning on seeds it was not measured with)
  for (const k of ['health', 'dps', 'growth', 'knee', 'late', 'hpLate']) if (opt(k)) D.TUNE[k] = Number(opt(k)); // try other numbers without editing descent.js
  for (const k of ['boss-health', 'boss-dps']) if (opt(k)) D.BOSS[k.slice(5)] = Number(opt(k));
  if (opt('tuning')) for (const hero of roster()) D.TUNING[hero] = Number(opt('tuning')); // --tuning=0.2: try a Descend tuning (descent.js TUNING) on the hero(es) run
  // A build to try: --build=Item,Item takes those whenever offered (else the bot's own picks), --focus=<slot> puts ability points into that ability first,
  // --legendary=Name takes that legendary when offered.
  const BUILD = String(opt('build', '')).split(',').map((x) => x.trim()).filter(Boolean);
  const FOCUS = arg('focus', 0);
  const LEGENDARY = opt('legendary', '');
  const ALL_ENHANCED = !!opt('all-enhanced'); // --all-enhanced=1: every item and legendary offered is the enhanced one (the best case, for trying a build)
  const spendAll = (d) => { if (FOCUS) for (const tier of [0, 1, 2]) if ((d.tiers[FOCUS] ?? 0) === tier) D.spendPoint(d, FOCUS); for (const tier of [0, 1, 2]) for (let slot = 1; slot <= 4; slot++) if ((d.tiers[slot] ?? 0) === tier) D.spendPoint(d, slot); };
  const cheapest = (d) => SLOTS.flatMap((s) => d.items[s]).sort((a, b) => itemByName(a).Cost - itemByName(b).Cost)[0];
  const apply = (d, i) => { if (i < 0) return D.skipChoice(d); const r = D.takeChoice(d, i); if (r.error === 'full') D.takeChoice(d, i, cheapest(d)); return r; };
  const score = (d, i, rng) => { // how the next room goes after taking choice i (-1: skip)
    const copy = structuredClone(d);
    apply(copy, i);
    spendAll(copy);
    const spec = D.specOf(copy);
    if (D.NO_FIGHT.has(spec.kind)) return 0; // no fight to score
    let total = 0;
    for (let t = 0; t < 3; t++) { const run = D.fightRoom(copy, spec, rng); total += run.won ? 1 + run.health : 0; }
    return total;
  };
  // What one item is worth to this hero (a member who knows the game): how much more damage it deals and how much longer it lasts with it alone,
  // at level 12, against weapon and spirit damage (log-scaled, so a 10% gain in either counts the same). Kept per hero.
  const values = new Map();
  // Nov 2: the measured table (tools/descend-values.js: each item in real Descend rooms) when the hero has one. The guess below scored items on a 1e6-health
  // dummy and a 1e7-health Brute, so share-of-health items (Siphon Bullets, Toxic Bullets, Decay) came out on top for every hero.
  let TABLE = {};
  try { TABLE = require(path.join(__dirname, '..', 'assets', 'farm', 'descendValues.json')); } catch {}
  // Nov 14 ("use the finished builds as examples"): the builds of real cleared runs (assets/farm/descendBuilds.json, from the run log). The good bot
  // leans towards its hero's own finished builds' Items and takes their legendary when offered.
  let BUILDS = {};
  try { BUILDS = require(path.join(__dirname, '..', 'assets', 'farm', 'descendBuilds.json')); } catch {}
  const proven = (hero, name) => (BUILDS[hero] ?? []).some((x) => x.items.includes(name) || x.legendary === name);
  const PROVEN_WORTH = 0.1;
  // --decline=ghouls,rest,wounded: the bots turn these deals / events down and never take their door (to measure what one is worth)
  const DECLINE = String(opt('decline', '')).split(',').filter(Boolean);
  const ENHANCED_WORTH = 1.25; // an enhanced copy counted a quarter better; measure enhanced items in descend-values.js if picks hinge on it
  const worth = (hero, name, enhanced = false) => {
    const measured = TABLE[hero]?.[name];
    if (measured !== undefined) return measured * (enhanced ? ENHANCED_WORTH : 1) + (proven(hero, name) ? PROVEN_WORTH : 0);
    return guess(hero, name, enhanced);
  };
  const guess = (hero, name, enhanced = false) => { // `enhanced`: the offered copy is the enhanced one (Oct 29: the good bot takes those into account)
    const key = `${hero}|${name}${enhanced ? '|e' : ''}`;
    if (!values.has(key)) {
      const deal = (items, enh = []) => { let t = 0; for (let s = 1; s <= 2; s++) { const h = buildHero(hero, { items, boons: 12, enhanced: enh }); const f = new Fight({ heroes: [h], enemies: [enemy('Dummy', { maxHealth: 1e6, dps: 0, bulletResist: 0.15, spiritResist: 0.15, distance: 15 })], rng: seeded(s * 7919) }); f.run(30); t += f.dealt.get(h) || 0; } return t; };
      const last = (items, enh = []) => { let t = 0; for (const damageType of ['bullet', 'spirit']) { const h = buildHero(hero, { items, boons: 12, enhanced: enh }); const f = new Fight({ heroes: [h], enemies: [enemy('Brute', { maxHealth: 1e7, dps: 60, damageType, distance: 15 })], rng: seeded(31) }); f.run(120); t += f.time; } return t; };
      if (!values.has(`${hero}|`)) values.set(`${hero}|`, { deal: deal([]), last: last([]) });
      const base = values.get(`${hero}|`);
      const enh = enhanced ? [name] : [];
      values.set(key, Math.log(Math.max(1e-3, deal([name], enh) / base.deal)) + Math.log(Math.max(1e-3, last([name], enh) / base.last)));
    }
    return values.get(key);
  };
  const held = (d) => SLOTS.flatMap((s) => d.items[s]);
  const weakest = (d) => held(d).sort((a, b) => worth(d.hero, a) - worth(d.hero, b))[0];
  // the item worth the most over what it replaces (its part when it is an upgrade, the weakest item when the build is full); skip when nothing helps
  // or the hero is low and the best gain is small
  function itemPick(d) {
    let best = 0;
    let pick = -1;
    d.offer.choices.forEach((n, i) => {
      const used = priceFor(itemByName(n), d.items).used;
      const gain = (BUILD.includes(n) ? 5 : 0) + worth(d.hero, n, d.offer.enhanced?.includes(n)) - (used.length ? used.reduce((s, u) => s + worth(d.hero, u), 0) : countItems(d.items) >= D.rules(d).maxItems ? worth(d.hero, weakest(d)) : 0);
      if (gain > best) { best = gain; pick = i; }
    });
    return d.health < 0.35 && best < 0.1 ? -1 : pick;
  }
  // An imbue item waits for its ability (descent.js setImbue; Nov 2: the bot never chose, so its imbue items did nothing and a Broker stall could hold the
  // run forever): the ability whose next room goes best, from every one it may go on.
  function imbue(d, rng) {
    for (let i = 0; d.phase === 'imbue' && i < 4; i++) {
      let best = -1;
      let slot = 1;
      for (let s = 1; s <= 4; s++) {
        const copy = structuredClone(d);
        if (!D.setImbue(copy, s).ok) continue;
        const spec = D.specOf(copy);
        const sc = D.NO_FIGHT.has(spec.kind) ? 0 : [0, 1].reduce((t) => { const run = D.fightRoom(copy, spec, rng); return t + (run.won ? 1 + run.health : 0); }, 0);
        if (sc > best) { best = sc; slot = s; }
      }
      if (!D.setImbue(d, slot).ok) break;
    }
  }
  // The good bot's answer to a hero's deal (Nov 14: it turned down every deal that takes an Item, so those could not be measured). True when it took one.
  // It plays each like a member who knows the odds: copies or tempers its best Item, feeds its weakest, heals when hurt. Castling and the Time Capsule it turns down.
  function deal(d, spec) {
    const act = (a, n) => D.eventAct(d, a, n);
    const byWorth = (list) => [...list].sort((a, b) => worth(d.hero, b) - worth(d.hero, a)); // best first
    const full = countItems(d.items) >= D.rules(d).maxItems;
    switch (spec.deal) {
      case 'ghouls': case 'assistant': case 'plot': case 'rescue': case 'venom': case 'rats': case 'doorway': case 'smash': return !!act('accept').ok;
      case 'burrow': return d.health < 0.4 && !!act('accept').ok; // it digs past rooms and their picks: only to save a hurt hero
      case 'harrow': { let n = 0; while (d.health < 0.55 && act('heal').ok) n++; return n > 0 && !!act('done').ok; }
      case 'replica': { // the copy worth the most against the risk of losing the original
        const odds = (n) => D.REPLICA_CHANCE[Math.min(4, itemByName(n).Tier) - 1];
        const [best] = D.replicables(d).filter((n) => odds(n) > 0.5).sort((a, b) => worth(d.hero, b) * (2 * odds(b) - 1) - worth(d.hero, a) * (2 * odds(a) - 1));
        if (!best || worth(d.hero, best) <= 0) return false;
        const r = act('replica', best);
        return !!(r.pick ? act('replace', held(d).filter((n) => n !== best).sort((a, b) => worth(d.hero, a) - worth(d.hero, b))[0]).ok : r.ok);
      }
      case 'upgrade': { const [best] = byWorth(D.tinkerables(d)); return d.health > 0.5 && !!best && !!act('item', best).ok && !!act('enhance').ok; }
      case 'turret': { const part = byWorth(D.parts(d)).at(-1); return countItems(d.items) >= 6 && !!part && !!act('turret', part).ok; }
      case 'helper': return countItems(d.items) >= 6 && !!act('helper', weakest(d)).ok;
      case 'lesson': { const [kind] = D.lessonKinds(spec.room); return !!kind && !!act('lesson', kind).ok; }
      case 'stoke': { const [best] = byWorth(D.stokeables(d)); return !!best && !!act('item', best).ok && !!act('stoke').ok && !!act('done').ok; } // the first Stoke is safe
      case 'travel': { const kinds = D.travelKinds(d, spec.room); const want = (d.health < 0.6 ? ['rest', 'breather', 'urn'] : ['breather', 'urn', 'rest']).find((k) => kinds.includes(k)); return !!want && !!act('travel', want).ok; }
      case 'fuse': { if (!full) return false; const two = byWorth(D.fuseables(d)).slice(-2); return two.length === 2 && !!act('fuseA', two[0]).ok && !!act('fuseB', two[1]).ok && !!act('fuse').ok; } // a full build's two weakest: a slot back
      default: return false;
    }
  }
  // --events=1: what each event and deal is worth. At every such choice of a good-pick run the run is played on to its end both ways (the door taken or the
  // other one; the deal taken or turned down) on the same dice, --reps=2 times: cleared and rooms reached, each way.
  const EVENTS = !!opt('events');
  const EVENT_REPS = arg('reps', 2);
  const tally = {};
  function probe(d, label, a, b) {
    const t = (tally[label] ??= { n: 0, a: 0, b: 0, ra: 0, rb: 0 });
    for (let k = 1; k <= EVENT_REPS; k++) {
      const s = (Number(d.seed) || 1) * 31 + d.room * 977 + k;
      const [x, y] = [play(structuredClone(d), seeded(s), true, a && { ...a }), play(structuredClone(d), seeded(s), true, { ...b })];
      t.n += 1; t.a += x.end === 'cleared' ? 1 : 0; t.b += y.end === 'cleared' ? 1 : 0; t.ra += x.rooms; t.rb += y.rooms;
    }
  }
  const REBIRTH = arg('rebirth', 0); // --rebirth=10: every run's hero has that Rebirth rank
  const one = (hero, seed, good, ascension = ASCENSION) => play(Object.assign(D.newRun(hero, seed, ascension), REBIRTH ? { rebirth: REBIRTH } : {}), seeded(seed * 7919 + (good ? 1 : 0)), good, null, EVENTS && good);
  // Plays run `d` on to its end. `force`: { room, door } takes that door of that room's choice, { room, decline } turns down what that room holds. `probing`: measure each choice (probe).
  function play(d, rng, good, force = null, probing = false) {
    for (;;) {
      const spec = D.specOf(d);
      const forced = force && !force.used && force.room === d.room ? force : null;
      if (spec.kind === 'doors') { // Two Doors: a random bot takes any door; a good one a named no-fight door when hurt, else a room with a pick
        const hurt = d.health < 0.45;
        const want = (x) => (!good ? rng() : x.kind === 'rest' ? (hurt ? 5 : 0.5) : x.noPick && x.kind !== 'rift' ? (hurt ? 4 : 1) : x.mystery ? 3 : x.kind === 'fight' ? 2 : 1.5);
        const scores = spec.doors.map((x) => (DECLINE.includes(x.kind) ? -1 : want(x)));
        if (probing && opt('events') !== 'deals') spec.doors.forEach((x, i) => { if (x.noPick || x.mystery) probe(d, `door: ${x.mystery ? 'mystery' : x.kind}`, { room: d.room, door: i }, { room: d.room, door: i ? 0 : 1 }); });
        if (forced?.door != null) forced.used = true;
        D.chooseDoor(d, forced?.door ?? scores.indexOf(Math.max(...scores)));
        continue;
      }
      const inside = spec.kind === 'visit' ? `deal: ${spec.deal}` : spec.mystery || spec.kind === 'rival' ? `inside: ${spec.kind}` : null; // a choice made in the room itself
      if (probing && inside && (opt('events') !== 'deals' || spec.kind === 'visit')) probe(d, inside, null, { room: d.room, decline: true });
      const declined = !!forced?.decline || DECLINE.includes(spec.kind) || DECLINE.includes(spec.deal);
      if (forced?.decline) forced.used = true;
      if (spec.kind === 'broker') { const [name] = D.corruptibles(d); if (!(good && !declined && name && D.corrupt(d, name)?.ok)) d.room += 1; continue; } // a good bot corrupts its first tier 3-4 item, as a player would
      if (D.EVENT_KINDS.includes(spec.kind) || spec.kind === 'visit') { // an event room or a hero room; then its pick, like a won room's (EVENT_PICK)
        if (declined) D.eventAct(d, 'leave');
        else if (spec.kind === 'visit') { // a hero room: a random bot takes what needs no Item, a good one plays the deal (deal)
          if (!(good ? deal(d, spec) : D.eventAct(d, 'accept').ok)) D.eventAct(d, 'leave');
        } else if (spec.kind === 'breather') D.breakCrates(d);
        else if (spec.kind === 'rest') { // a good bot tinkers its dearest item while it has health to spare, else rests; a random one flips a coin
          const can = D.tinkerables(d).sort((a, b) => itemByName(b).Cost - itemByName(a).Cost);
          const tinker = can.length && (good ? d.health >= 0.6 : rng() < 0.5);
          D.restStop(d, tinker ? 'tinker' : 'rest', can[0]);
        } else { // the rest take what's offered (sell the cheapest item at the Dealer when hurt), else leave
          const cheapest = D.dealerItems(d).sort((a, b) => itemByName(a).Cost - itemByName(b).Cost)[0];
          const swap = good && spec.kind === 'dealer' && d.health >= 0.35 && countItems(d.items) >= 4 ? held(d).filter((n) => D.dealerItems(d).includes(n) && D.swapChoices(d, n).length).sort((x, y) => worth(d.hero, x) - worth(d.hero, y))[0] : null; // a good bot trades its weakest Item for 3 a tier up
          const want = { urn: 'urn', wounded: 'recruit', patron: 'bless', teleporter: 'step', dealer: swap ? 'swap' : cheapest && d.health < 0.35 ? 'sell' : 'leave' }[spec.kind];
          if (!D.eventAct(d, want, swap ?? cheapest).ok) D.eventAct(d, 'leave');
        }
        if (d.phase !== 'offer') continue;
      } else {
        if (spec.kind === 'rival' && (declined || (good && [0, 1, 2].filter(() => D.fightRoom(structuredClone(d), spec, rng).won).length < 2))) { D.walkAway(d); continue; } // Flee a duel it would usually lose, as a player can (from Ascension 3 it costs health)
        const run = D.fightRoom(d, spec, rng);
        if (!run.won && spec.kind === 'rift') { D.fleeRift(d, run); continue; } // the Rift lost: the hero flees, the run goes on
        if (!run.won && D.canRescue(d, spec)) { D.rescue(d, run); continue; } // Ivy's Rescue (the bots never used it before Nov 14)
        if (!run.won) return { rooms: d.room - 1, end: spec.kind, level: d.level };
        D.afterWin(d, run);
        if (LEGENDARY && opt('always') && d.offer?.kind === 'legendaries' && !d.offer.choices.includes(LEGENDARY)) d.offer.choices[0] = LEGENDARY; // --always=1: the legendary is in every legendary offer
        if (ALL_ENHANCED && d.offer?.choices && d.offer.kind !== 'buffs') d.offer.enhanced = [...d.offer.choices];
        if (spec.final) return { rooms: D.LAST_ROOM, end: 'cleared', level: d.level };
        if (d.phase !== 'offer') continue; // a room fought again after Ivy's Rescue: no pick
      }
      spendAll(d);
      let choice = Math.floor(rng() * d.offer.choices.length);
      if (good && d.offer.kind === 'items') choice = itemPick(d);
      else if (good) { let best = -1; choice = -1; for (let i = -1; i < d.offer.choices.length; i++) { const sc = score(d, i, rng); if (sc > best) { best = sc; choice = i; } } if (LEGENDARY && d.offer.kind === 'legendaries' && d.offer.choices.includes(LEGENDARY)) choice = d.offer.choices.indexOf(LEGENDARY); else if (d.offer.kind === 'legendaries' && d.offer.choices.some((n) => proven(d.hero, n))) choice = d.offer.choices.findIndex((n) => proven(d.hero, n)); }
      if (good && choice >= 0 && d.offer.kind === 'items' && countItems(d.items) >= D.rules(d).maxItems && !priceFor(itemByName(d.offer.choices[choice]), d.items).used.length) {
        D.takeChoice(d, choice, weakest(d)); // a full build gives up its least useful item, not its cheapest
      } else apply(d, choice);
      imbue(d, rng);
      spendAll(d);
    }
  }
  const stat = (list) => { const r = list.map((x) => x.rooms).sort((a, b) => a - b); const q = (f) => r[Math.min(r.length - 1, Math.floor(f * r.length))]; return { med: q(0.5), lo: q(0.25), hi: q(0.75), max: r.at(-1) }; };
  const floor = (rooms) => `room ${rooms} (floor ${Math.min(D.FLOORS, D.floorOf(rooms + 1))})`;
  // --ascension=all: how many good-pick runs clear the descent at each ascension (the bar, every level still beatable)
  if (String(opt('ascension', '')).toLowerCase() === 'all') {
    console.log(`${runs} good-pick runs per ascension: cleared, median rooms`);
    for (let a = 0; a <= D.MAX_ASCENSION; a++) {
      const list = Array.from({ length: runs }, (_, i) => one(HERO, i + 1, true, a));
      console.log(`A${String(a).padEnd(4)}${String(list.filter((x) => x.end === 'cleared').length).padStart(3)} / ${runs}   median ${stat(list).med}`);
    }
    return;
  }
  const heroes = String(opt('hero', 'Haze')).toLowerCase() === 'all' ? roster() : [HERO];
  if (heroes.length > 1) {
    console.log(`${runs} runs each${ASCENSION ? ` at Ascension ${ASCENSION}` : ''}, rooms cleared: median random / good (good runs that cleared)`);
    for (const hero of heroes) {
      const r = stat(Array.from({ length: runs }, (_, i) => one(hero, i + 1, false)));
      const goods = Array.from({ length: Math.max(4, Math.round(runs / 4)) }, (_, i) => one(hero, i + 1, true));
      const g = stat(goods);
      console.log(`${hero.padEnd(16)}${String(r.med).padEnd(6)}${String(g.med).padEnd(6)}(${goods.filter((x) => x.end === 'cleared').length} / ${goods.length})`);
    }
    return;
  }
  for (const good of opt('good-only') ? [true] : [false, true]) { // --good-only=1: just the good bot (half the time)
    const list = Array.from({ length: runs }, (_, i) => one(HERO, i + FIRST, good));
    const s2 = stat(list);
    const ends = {};
    for (const x of list) ends[x.end] = (ends[x.end] ?? 0) + 1;
    console.log(`${good ? 'Good picks  ' : 'Random picks'}  median ${floor(s2.med)}, quarters ${s2.lo}-${s2.hi}, best ${s2.max}   ended by: ${Object.entries(ends).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  if (EVENTS) console.log(`EVENTS ${JSON.stringify(tally)}`); // summed over heroes by tools/descend-events.js
}

const COMMANDS = { descend, ladder, tune, siege: siegeNeeds, growth, rank, lanes, waves, check, legendary, race, retune, roster: rosterTable, carry, best };
const name = process.argv[2];
if (!COMMANDS[name]) {
  console.log(`Usage: node tools/farm-sim.js <${Object.keys(COMMANDS).join(' | ')}>`);
  process.exit(name ? 1 : 0);
}
if (!['race', 'retune', 'roster', 'carry', 'best'].includes(name)) console.log(`Hero: ${HERO}${roster().includes(HERO) ? '' : ' (no ability logic yet: it fights with its gun only)'}  -  ${KITS * SEEDS} fights per number
`);
COMMANDS[name]();
