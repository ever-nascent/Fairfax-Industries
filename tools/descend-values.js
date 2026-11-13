// What each shop item is worth to each hero in /descend (Nov 2, for balancing): `node tools/descend-values.js [--hero=Name|all] [--redo=1] [--seeds=3]`.
// Each hero gets a level-18 kit of 9 basic items; the enemies of 14 real Descend rooms (floor-4 rooms, base archetype rooms, 4 bosses) are scaled until that
// kit wins about half, then every item the runs offer is added to it (or, held, taken out) on the same seeds. An item's value is the average change in
// the fight's score (a win: 1 + health left; a loss: the share of enemy health taken off). Saved to assets/farm/descendValues.json ({ hero: { item: value } }),
// one hero at a time, so a stopped run carries on where it was (`--redo=1` measures again). Used by tools/farm-sim.js descend's good-pick bot.
// About 30-100 s a hero at idle priority. Never touches data/ (a temp DATA_DIR).
try { require('node:os').setPriority(0, require('node:os').constants.priority.PRIORITY_LOW); } catch {}
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-values-'));
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', 'src', 'utils', 'farm');
const { POOL, canBuy, priceFor, SLOT_OF, SLOTS } = require(path.join(ROOT, 'levels'));
const { itemByName } = require(path.join(ROOT, 'stats'));
const { roster } = require(path.join(ROOT, 'hero'));
const D = require(path.join(ROOT, 'descent'));

const FILE = path.join(__dirname, '..', 'assets', 'farm', 'descendValues.json');
const opt = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const SEEDS = Number(opt('seeds', 3));
const LEVEL = 18;
const BASE = { weapon: ['Extended Magazine', 'Rapid Rounds', 'Swift Striker'], vitality: ['Extra Health', 'Battle Vest', 'Extra Regen'], spirit: ['Extra Spirit', 'Mystic Burst', 'Compress Cooldown'] };
const SPECS = [];
for (let s = 1; SPECS.length < 7; s++) { const sp = D.roomSpec(s, 16 + (s % 4), 'Haze'); if (sp.kind === 'fight') SPECS.push(sp); } // the same rooms for every hero
for (const groups of [['tank', 'caster', 'glass'], ['bruiser', 'healer', 'swarm'], ['disruptor', 'grappler', 'trooper']]) SPECS.push({ room: 18, floor: 4, ascension: 0, kind: 'fight', groups: groups.map((type) => ({ type })) });
for (const boss of ['guardian', 'walker', 'mid-boss', 'shrine']) SPECS.push({ room: 20, floor: 4, ascension: 0, kind: 'boss', boss });

function measure(hero) {
  const run = (items) => {
    const d = D.newRun(hero, 1);
    Object.assign(d, { level: LEVEL, room: 18, health: 1, items });
    for (const t of [0, 1, 2]) for (let slot = 1; slot <= 4; slot++) if ((d.tiers[slot] ?? 0) === t) D.spendPoint(d, slot);
    return d;
  };
  const score = (items) => {
    const d = run(items);
    return SPECS.flatMap((sp, i) => Array.from({ length: SEEDS }, (_, s) => {
      const r = D.fightRoom(d, sp, seeded(1000 * i + s + 1));
      const last = r.frames.at(-1);
      return r.won ? 1 + r.health : 1 - last.enemies.reduce((a, e) => a + Math.max(0, e.hp), 0) / last.enemies.reduce((a, e) => a + e.max, 0);
    }));
  };
  const [h0, d0] = [D.TUNE.health, D.TUNE.dps];
  const scale = (k) => { D.TUNE.health = h0 * k; D.TUNE.dps = d0 * k; };
  let [lo, hi] = [0.1, 6];
  for (let i = 0; i < 8; i++) { const k = Math.sqrt(lo * hi); scale(k); if (mean(score(BASE).map((x) => (x >= 1 ? 1 : 0))) > 0.5) lo = k; else hi = k; }
  scale(Math.sqrt(lo * hi));
  const base = score(BASE);
  const clone = (it) => Object.fromEntries(SLOTS.map((s) => [s, [...it[s]]]));
  const without = (it, n) => { const c = clone(it); for (const s of SLOTS) c[s] = c[s].filter((x) => x !== n); return c; };
  const values = {};
  for (const slot of SLOTS) for (const n of POOL[slot]) {
    if (D.NO_RUN_ITEMS.has(n) || !canBuy(hero, n)) continue;
    const held = SLOTS.some((s) => BASE[s].includes(n));
    let it = clone(BASE);
    if (!held) { for (const u of priceFor(itemByName(n), BASE).used) it = without(it, u); it[SLOT_OF[itemByName(n).Slot]].push(n); }
    const [a, b] = held ? [score(without(BASE, n)), base] : [base, score(it)];
    values[n] = +mean(b.map((x, i) => x - a[i])).toFixed(3);
  }
  [D.TUNE.health, D.TUNE.dps] = [h0, d0];
  return values;
}

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const want = String(opt('hero', 'all'));
const heroes = want.toLowerCase() === 'all' ? roster() : want.split(',').map((x) => roster().find((n) => n.toLowerCase() === x.trim().toLowerCase())).filter(Boolean);
for (const hero of heroes) {
  if (read()[hero] && !opt('redo')) continue;
  const t0 = Date.now();
  const values = measure(hero);
  const all = read(); // read again: another copy of this tool may have saved a hero meanwhile
  all[hero] = values;
  fs.writeFileSync(FILE, `${JSON.stringify(Object.fromEntries(Object.keys(all).sort().map((h) => [h, all[h]])), null, 1)}\n`);
  console.log(`${hero}: ${Object.keys(values).length} items, ${Math.round((Date.now() - t0) / 1000)} s`);
}
