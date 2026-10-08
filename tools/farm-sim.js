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
//   race     every hero (or --hero=) from level 0 with no items, +1 level then +1 item ...: the first step that wins each target, the fight's length, the souls it takes (--kits=6 --seeds=4)
//   retune   the HARDNESS at which the middle hero of the whole roster wins 55% at each target, and the spread around it (--target=<key> for one)
//   roster   every hero's win rates at every target, weakest first (--f= for harder enemies)
//   carry    what carries a hero: its win rates whole and without each ability in turn (--hero=, --f=)
//   best     can this hero win with the right kit? its best kit of each stage against that stage's target (--hero=, --f=1,1.5)
//   check    the gate for a new hero: a typical kit of each target's own stage must win at least 35% (heroes may differ, his call Oct 2: above 75% is only noted as easy)
// Options: --hero=Abrams (default Haze; tune and check every hero before it goes in the roster), --kits=24 --seeds=5 (kits x seeds fights per number).
// A "kit" is what a member would have at a stage: level, ability points spent in order, items, permanent buffs, Rejuvs. The stages are in STAGES.
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
const HERO = heroNames().find((n) => n.toLowerCase() === String(opt('hero', 'Haze')).toLowerCase());
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

// The same typical kits at each target's own stage, without a legendary and with each one added (it takes a free slot; a full kit drops its last item).
function legendary() {
  const { LEGENDARY_NAMES, MAX_ITEMS } = require(path.join(ROOT, 'levels'));
  const keys = KEYS.slice(1);
  console.log(`Typical kits of each target's own stage, without and with each legendary (only what fights simulate of it).
${''.padEnd(22)}${keys.map((k) => k.replace('-camp', '').padEnd(10)).join('')}`);
  const base = keys.map((k) => winRate(k, STAGES[k], randomKits(STAGES[k])));
  console.log('no legendary'.padEnd(22) + base.map((r) => pct(r).padEnd(10)).join(''));
  for (const name of LEGENDARY_NAMES) {
    const rates = keys.map((k) => winRate(k, STAGES[k], randomKits(STAGES[k]).map((items) => [...items.slice(0, MAX_ITEMS - 1), name])));
    console.log(name.padEnd(22) + rates.map((r, i) => `${pct(r)}${r - base[i] >= 0.005 ? ` +${Math.round((r - base[i]) * 100)}` : ''}`.padEnd(10)).join(''));
  }
}

// Every hero from nothing, one step at a time (his ask, Oct 5): level 0 with no items, then a level, then an item, then a level ... (12 items by
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

// The roster-wide tune (his call, Oct 5: the enemies were tuned on Haze, one of the weakest heroes): the HARDNESS at which the MIDDLE hero of the
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

const COMMANDS = { ladder, tune, siege: siegeNeeds, growth, rank, lanes, waves, check, legendary, race, retune, roster: rosterTable, carry, best };
const name = process.argv[2];
if (!COMMANDS[name]) {
  console.log(`Usage: node tools/farm-sim.js <${Object.keys(COMMANDS).join(' | ')}>`);
  process.exit(name ? 1 : 0);
}
if (!['race', 'retune', 'roster', 'carry', 'best'].includes(name)) console.log(`Hero: ${HERO}${roster().includes(HERO) ? '' : ' (no ability logic yet: it fights with its gun only)'}  -  ${KITS * SEEDS} fights per number
`);
COMMANDS[name]();
