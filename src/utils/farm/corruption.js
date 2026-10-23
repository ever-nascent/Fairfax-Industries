// What corrupting an item does, written for members (his ask, Oct 22: show the benefits and the drawback, neatly).
// The bonuses are shown the way the wiki and the game show them: each changed stat with the game's own label, before -> after
// ("Shock Damage 43 -> 80", "Jump Radius 10m -> 15m"). The labels, units and base values come from deadlock-api.com (unofficial; the
// same API the legendaries come from), saved in assets/farm/corrupted.json and refreshed once a week at startup (loadCorruptionLabels).
// Without that file (offline, the API down) the bonuses fall back to the item card's CorruptedUpgrades with names made from their keys.
const fs = require('node:fs');
const path = require('node:path');
const { ASSETS } = require('../art');
const { itemByName, DRAWBACKS } = require('./stats');

const FILE = path.join(ASSETS, 'farm', 'corrupted.json');
const API = 'https://api.deadlock-api.com/v1/assets/items/by-type/upgrade';
const MAX_AGE = 7 * 24 * 3600 * 1000;

// { item name: [{ key, bonus, label, postfix, prefix, base, shown, round }] }
let labels = null;
function readLabels() {
  if (labels) return labels;
  try {
    labels = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    labels = {};
  }
  return labels;
}

// deadlock-api's item list -> the labels file's shape: every shop item with corrupted upgrades.
function fromApi(items) {
  const out = {};
  for (const i of items) {
    if (!i.shopable || i.disabled || !i.corrupted_info?.property_upgrades?.length) continue;
    const shown = new Set();
    for (const s of i.tooltip_sections ?? []) for (const a of s.section_attributes ?? []) for (const k of ['properties', 'important_properties', 'elevated_properties']) for (const p of a[k] ?? []) shown.add(p);
    out[i.name] = i.corrupted_info.property_upgrades.map((u) => {
      const p = i.properties?.[u.name] ?? {};
      return { key: u.name, bonus: String(u.bonus), label: p.label ?? null, postfix: p.postfix ?? '', prefix: p.prefix ?? '', base: p.value ?? null, shown: shown.has(u.name), round: !!u.round_corrupted_bonus, section: p.tooltip_section ?? null };
    });
  }
  return out;
}

// On startup: download the labels when the file is missing or a week old. Never throws; the old file (or the fallback) stays in use.
async function loadCorruptionLabels({ fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    if (fs.existsSync(FILE) && now - fs.statSync(FILE).mtimeMs < MAX_AGE) return readLabels();
    const res = await fetchImpl(API, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`deadlock-api.com answered ${res.status}`);
    const fresh = fromApi(await res.json());
    if (Object.keys(fresh).length < 20) throw new Error(`only ${Object.keys(fresh).length} corruptible items came back`);
    fs.writeFileSync(FILE, JSON.stringify(fresh));
    labels = fresh;
    console.log(`[farm] Corruption labels saved for ${Object.keys(fresh).length} items`);
  } catch (e) {
    console.error('[farm] Corruption labels:', e.message);
  }
  return readLabels();
}

const num = (v) => parseFloat(String(v ?? 0)) || 0;
const show = (n) => `${+n.toFixed(2)}`;
// A value as the game writes it: `prefix` '{s:sign}' = a sign on anything but 0, '+' / '-' = that sign written before it.
function written(value, { prefix, postfix }) {
  const sign = prefix === '{s:sign}' ? (value > 0 ? '+' : value < 0 ? '-' : '') : prefix === '+' || prefix === '-' ? prefix : value < 0 ? '-' : '';
  return `${sign}${show(Math.abs(value))}${postfix}`;
}
// "BonusFireRate" -> "Fire Rate" (only when the labels file has nothing for an item).
const nameOfKey = (key) => key.replace(/^Bonus/, '').replace(/Tech/g, 'Spirit').replace(/Magic/g, 'Spirit').replace(/Percent|Pct/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

// The corrupted bonuses of an item, one line each: "Shock Damage 43 → 80". Only the stats the game's tooltip shows, each once.
function bonusLines(name) {
  const list = readLabels()[name];
  if (!list?.length) {
    const ups = itemByName(name)?.CorruptedUpgrades ?? {};
    return Object.entries(ups).map(([key, v]) => `${nameOfKey(key)} ${num(v) > 0 ? '+' : ''}${show(num(v))}${/m$/.test(String(v)) ? 'm' : ''}`);
  }
  const seen = new Set();
  const lines = [];
  // two stats with one label (Frenzy's always-on Fire Rate and its active one): the one outside the innate section is named by its section
  const shownList = list.filter((u) => u.shown && u.label);
  const twice = new Set(shownList.map((u) => u.label).filter((l, i, all) => all.indexOf(l) !== i));
  for (const u of shownList) {
    const label = twice.has(u.label) && u.section && u.section !== 'innate' ? `${u.label} (${u.section[0].toUpperCase()}${u.section.slice(1)})` : u.label;
    const base = num(u.base);
    let after = base + num(u.bonus);
    if (u.round) after = Math.round(after);
    const line = `${label} ${written(base, u)} → ${written(after, u)}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

// The drawback, label first like the bonuses: "Move Speed -2.1 m/s".
const drawbackLine = ({ drawback, amount }) => `${DRAWBACKS[drawback].name} -${show(amount)}${DRAWBACKS[drawback].unit}`;

// A corrupted item's whole block for an embed field: Bonuses, then Drawback (a field holds at most 1,024 characters).
function corruptionBlock(corrupted) {
  const bonuses = bonusLines(corrupted.name);
  return [`**Bonuses**`, ...(bonuses.length ? bonuses : ['None listed']), '', '**Drawback**', drawbackLine(corrupted)].join('\n').slice(0, 1024);
}

// Tests: use these labels instead of the file.
const setLabels = (data) => { labels = data; };

module.exports = { loadCorruptionLabels, fromApi, setLabels, bonusLines, drawbackLine, corruptionBlock, FILE };
