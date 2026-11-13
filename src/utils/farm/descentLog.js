// The /descend run log (his ask, Oct 31): every fact that helps balance runs, nothing about who played. One JSON line per event in data/descentLog.jsonl
// (git-ignored): no member or server ids; a run is told apart only by its seed (`run`). Events: `start`, `fight`, `pick`, `walk`, `broker`, `end`.
// `bal` names the balance era (a hash of the numbers that shape a run), so lines from before a retune can be kept apart. Read with tools/descend-stats.js.
// Never throws: a full disk must not undo a room.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('../../storage/jsonAdapter');

const FILE = () => path.join(DATA_DIR, 'descentLog.jsonl');
const OLD = () => path.join(DATA_DIR, 'descentLog.1.jsonl');
const MAX_BYTES = 50 * 1024 * 1024; // past this the file becomes the "old" one (the stats tool reads both)

let ERA;
const era = (numbers) => (ERA ??= crypto.createHash('md5').update(JSON.stringify(numbers)).digest('hex').slice(0, 6));

// What the hero has at a moment: level, every item, the legendary, ability tiers, permanent buffs, Rejuvs.
const build = (d) => ({
  level: d.level, items: [...d.items.weapon, ...d.items.vitality, ...d.items.spirit], ...(d.legendary ? { legendary: d.legendary } : {}), tiers: d.tiers, buffs: d.buffs,
  ...(d.enhanced?.length ? { enhanced: d.enhanced } : {}), ...(d.fragile?.length ? { fragile: d.fragile } : {}), ...(d.corrupted && [].concat(d.corrupted).length ? { corrupted: [].concat(d.corrupted).map((c) => c.name) } : {}),
  rejuvs: d.rejuvs, health: +d.health.toFixed(3),
});

function record(numbers, d, event, data) {
  if (!d?.v) return; // a run on the old rules is not what is being tuned
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE()) && fs.statSync(FILE()).size > MAX_BYTES) fs.renameSync(FILE(), OLD());
    fs.appendFileSync(FILE(), `${JSON.stringify({ t: Date.now(), e: event, run: d.seed, bal: era(numbers), hero: d.hero, asc: d.ascension ?? 0, ...(d.rebirth ? { rebirth: d.rebirth } : {}), ...data })}\n`);
  } catch (error) {
    console.error('[descent log] Could not write:', error.message);
  }
}

// A fight, from the run before it (`d`), its room (`spec`) and the engine's result (`run`, play.js simulate's).
// An enemy as it started: its numbers, and the names of its blast, controls and debuffing attacks.
const foe = ({ name, stats: x = {} }) => ({ name, hp: Math.round(x.maxHealth), dps: round(x.dps), type: x.damageType, bulletResist: round(x.bulletResist ?? 0), spiritResist: round(x.spiritResist ?? 0), distance: x.distance,
  ...(x.healthRegen ? { regen: round(x.healthRegen) } : {}), ...(x.drain ? { drain: x.drain } : {}), ...(x.antiHeal ? { antiHeal: x.antiHeal } : {}), ...(x.accuracy ? { accuracy: x.accuracy } : {}),
  ...(x.blast ? { blast: { every: round(x.blast.every), damage: Math.round(x.blast.damage), tags: x.blast.tags } } : {}), ...(x.controls?.length ? { controls: x.controls.map((c) => ({ id: c.id, every: round(c.every), duration: round(c.duration) })) } : {}),
  ...(x.debuffs?.length ? { debuffs: x.debuffs.map((d) => ({ id: d.id, every: round(d.every), duration: d.duration })) } : {}), ...(x.undying ? { undying: x.undying } : {}), ...(x.adaptive ? { adaptive: true } : {}), ...(x.special?.name ? { special: x.special.name } : {}) });
const round = (n) => Math.round(n * 100) / 100;
function fightData(d, spec, run) {
  const foes = (run.foes ?? []).flatMap((f) => f.units ?? []);
  return {
    room: spec.room, kind: spec.kind, ...(spec.final ? { final: true } : {}), ...(spec.boss ? { boss: spec.boss } : {}), ...(spec.rival ? { rival: spec.rival } : {}), ...(spec.rivals ? { rivals: spec.rivals } : {}), ...(spec.hero ? { hero: spec.hero } : {}), ...(run.fled ? { fled: true } : {}),
    groups: (spec.groups ?? []).map((g) => ({ type: g.type, ...(g.family ? { family: g.family } : {}), ...(g.affix ? { affix: g.affix } : {}), ...(g.affix2 ? { affix2: g.affix2 } : {}) })),
    foes: foes.map(foe), heroStats: run.heroStats, // the enemies as they started, and the hero's numbers
    won: !!run.won, timedOut: !!run.timedOut, seconds: round(run.seconds ?? 0), cleared: run.cleared, stages: run.stageNames,
    hpIn: +d.health.toFixed(3), hpOut: +(run.health ?? 0).toFixed(3), rejuvsUsed: run.rejuvsUsed ?? 0, ...(run.fragileBroke?.length ? { fragileBroke: run.fragileBroke } : {}),
    dealt: run.damage, taken: run.taken, healed: run.healing && { ...run.healing, by: (run.healing.by ?? []).map(({ name, healed }) => ({ name, healed })) },
    build: build(d),
  };
}

module.exports = { record, fightData, build };
