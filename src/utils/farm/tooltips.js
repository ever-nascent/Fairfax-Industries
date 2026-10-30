// The game's own item tooltips (his ask, Oct 28: every item says exactly what it does, never "effect only"): each section (innate, passive,
// active) with its text and the numbers the game shows under it, labels and units included ("+20% Weapon Damage within Range", "15m Close Range").
// From deadlock-api.com (unofficial), saved in assets/farm/tooltips.json by the corruption labels' weekly download (corruption.js).
// A number is read from the item's own card when it has it, so an enhanced or corrupted card shows its own numbers.
const fs = require('node:fs');
const path = require('node:path');
const { ASSETS } = require('../art');

const FILE = path.join(ASSETS, 'farm', 'tooltips.json');
let data = null;
const read = () => (data ??= (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } })());

// deadlock-api's item list -> { item name: [{ type: 'innate' | 'passive' | 'active', text, stats: [{ key, label, value, prefix, postfix, conditional }] }] }
function fromApi(items) {
  const out = {};
  for (const i of items) {
    if (!i.name || !i.tooltip_sections?.length) continue;
    out[i.name] = i.tooltip_sections.map((s) => {
      const keys = [];
      for (const a of s.section_attributes ?? []) for (const k of ['important_properties', 'properties', 'elevated_properties']) for (const p of a[k] ?? []) if (!keys.includes(p)) keys.push(p);
      return {
        type: s.section_type ?? 'passive', // the game leaves a plain passive section unnamed
        text: (s.section_attributes ?? []).map((a) => a.loc_string).filter(Boolean).join(' '),
        stats: keys.map((key) => ({ key, p: i.properties?.[key] })).filter(({ p }) => p?.label && p.value !== undefined) // status names (StatusEffectStun ...) have no label or number
          .map(({ key, p }) => ({ key, label: p.label, value: String(p.value), prefix: p.prefix ?? '', postfix: p.postfix ?? '', conditional: p.conditional ?? null })),
      };
    });
  }
  return out;
}

const save = (fresh) => { fs.writeFileSync(FILE, JSON.stringify(fresh)); data = fresh; };

// The card's own number for a key (its Info blocks, then Other), else the tooltip's.
const cardValue = (card, key) => Object.values(card ?? {}).filter((v) => v?.Main).flatMap((v) => [...v.Main, ...v.Alt]).find((v) => v.Key === key)?.Value ?? card?.Other?.[key]?.Value;

// One number as the game writes it: "+20% Weapon Damage within Range", "15m Close Range". Null when there is no number.
function statText(stat, card) {
  const n = parseFloat(cardValue(card, stat.key) ?? stat.value);
  if (!Number.isFinite(n) || n === 0) return null;
  const sign = stat.prefix === '{s:sign}' || stat.prefix === '+' ? (n > 0 ? '+' : '-') : stat.prefix === '-' || n < 0 ? '-' : ''; // '-': a slow or a cut ("-24% Move Speed")
  const when = stat.conditional && !stat.label.includes('NPC') ? ` ${stat.conditional.toLowerCase()}` : ''; // not "vs. NPCs against NPCs"
  return `${sign}${+Math.abs(n).toFixed(2)}${stat.postfix} ${stat.label}${when}`;
}
const HIDDEN = new Set(['Eternal Gift:BuffFrequency']); // the game's number, not this one's (views.js ITEM_NOTES)

// card -> [{ type, text (raw, with the game's markup), stats: ['+20% Weapon Damage within Range', ...] }]; [] when the file has nothing for it.
const sections = (card) => (read()[card?.Name] ?? []).map((s) => ({ type: s.type, text: s.text, stats: s.stats.filter((st) => !HIDDEN.has(`${card.Name}:${st.key}`)).map((st) => statText(st, card)).filter(Boolean) }));

module.exports = { FILE, fromApi, save, sections, setTooltips: (d) => { data = d; } };
