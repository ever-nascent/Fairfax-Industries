// View Enemy Build: before a fight, in Hero Farming and /descend, a private message with what the enemy fights with.
// Camps, bosses, lane enemies and Descend's enemies: health, damage, resists, range, and every blast, crowd control and special with its timing,
// then what answers it. A rival hero: its drawn hero card (level, ability tiers, items, stats) like the member's own Build screen.
const { AttachmentBuilder } = require('discord.js');
const { buildHero } = require('./hero');
const { heroCard } = require('./heroCard');
const { HEROES: HERO_DATA, ABILITIES } = require('./stats');
const { SLOTS, POOL, LEGENDARY_NAMES } = require('./levels');
const { embed, soulsFile, statsFor, heroPicture } = require('./views');
const { fmt, titleCase } = require('../format');

const COLOR = 0xc0504d;
const EFFECT = { stunned: 'Stun', silenced: 'Silence', grappled: 'Grapple', disarmed: 'Disarm', slept: 'Sleep', cursed: 'Curse' };
const EFFECT_TEXT = { disarmed: ' (no shooting)', slept: ' (no actions until hit)', cursed: ' (no actions)' };
const BLAST_EFFECT = { curse: 'a curse (no actions)', stun: 'a stun', silence: 'a silence', sleep: 'a sleep' };
const DAMAGE = { spirit: 'spirit', melee: 'melee', mixed: 'half weapon, half spirit' };
const num = (n) => +n.toFixed(1);
const cap = (text) => text[0].toUpperCase() + text.slice(1);

// What one enemy unit does: a bullet point each, "**Label:** what", in Title Case. Seconds and metres are written "8s" / "20m"
// so titleCase leaves them small.
function unitLines(unit) {
  const s = unit.stats;
  const lines = [
    ['Health', `${fmt(Math.round(s.maxHealth))}${s.healthRegen ? `, regenerates ${num(s.healthRegen)} a second` : ''}`],
    ['Damage', `${num(s.dps)} a second, from ${s.distance}m`],
    ['Damage Type', DAMAGE[s.damageType] ?? 'weapon'],
    ['Resists', `bullet ${Math.round(s.bulletResist * 100)}%, spirit ${Math.round(s.spiritResist * 100)}%`],
  ];
  if (s.blast) lines.push([cap(s.blast.what ?? 'curse'), `every ${num(s.blast.every)}s, ${fmt(Math.round(s.blast.damage))} true damage and ${BLAST_EFFECT[(s.blast.tags ?? ['sleep'])[0]] ?? 'a sleep'} for ${num(s.blast.curse)}s`]);
  if (s.slam) lines.push(['Melee Slam', `every ${num(s.slam.every)}s, ${fmt(Math.round(s.slam.damage * s.dps / s.slam.dps))} melee damage + ${num(s.slam.maxHealthPct * s.dps / s.slam.dps * 100)}% of your max health`]);
  for (const c of s.controls ?? []) lines.push([EFFECT[c.verb] ?? cap(c.verb), `every ${num(c.every)}s, for ${num(c.duration)}s${EFFECT_TEXT[c.verb] ?? ''}`]);
  if (s.special) lines.push([s.special.name, `${Math.round((s.special.chance ?? 0.1) * 100)}% chance each second, ${s.special.text ?? 'a special attack'}`]);
  if (s.drain) lines.push(['Lifesteal', `heals ${Math.round(s.drain * 100)}% of the damage it deals`]);
  if (s.antiHeal) lines.push(['Anti-Heal', `its hits cut your healing by ${Math.round(s.antiHeal.cut * 100)}% for ${num(s.antiHeal.seconds)}s`]);
  return lines.map(([label, text]) => `- **${label}:** ${titleCase(text)}`);
}
// What answers their curses and crowd control: its own field (it read oddly jammed into the footer).
const COUNTERS = ['Unstoppable', 'Cloak of Opportunity', 'Reactive Barrier', 'Indomitable', 'Dispel Magic', 'Counterspell', 'Debuff Resist'];
const counters = (units) => (units.some((u) => u.stats.blast || u.stats.controls?.length || u.stats.special)
  ? { name: 'Counters', value: COUNTERS.map((c) => `- ${c}`).join('\n') } : null);

// The enemies as one message: `sections` [{ label?, units }] (the siege has a section per stage), a field for each different enemy in a section
// (identical ones counted), then Counters. `note`: the footer, one plain sentence.
function npcBuildView(title, sections, note = null) {
  const e = embed(COLOR).setTitle(`Enemy Build  -  ${title}`);
  const fields = [];
  for (const { label, units } of sections) {
    const groups = new Map();
    for (const u of units) {
      const lines = unitLines(u);
      const key = `${u.name}|${lines.join('|')}`;
      groups.set(key, { name: u.name, lines, count: (groups.get(key)?.count ?? 0) + 1 });
    }
    for (const g of groups.values()) fields.push({ name: `${label ? `${label}: ` : ''}${g.count > 1 ? `${g.count}x ` : ''}${g.name}`.slice(0, 256), value: g.lines.join('\n').slice(0, 1024) });
  }
  const counter = counters(sections.flatMap((s) => s.units));
  e.addFields([...fields.slice(0, counter ? 24 : 25), ...(counter ? [counter] : [])]);
  if (note) e.setFooter({ text: note.slice(0, 2048) });
  return { embeds: [e], files: [soulsFile()] };
}

// A rival hero's build from the kit it will fight with (encounter.js rivalKit): the same drawn card as the member's own.
// `title` / `top` / `color`: the same card for the member's own hero (heroBuildView).
async function rivalBuildView(rival, kit, { health = 1, note = null, title = null, top = 'RIVAL', color = COLOR } = {}) {
  const unit = buildHero(rival, kit);
  const level = kit.boons ?? 0;
  const abilities = Object.entries(HERO_DATA[rival].BoundAbilities).map(([slot, { Key }]) => ({ slot: Number(slot), name: ABILITIES[Key].Name, tier: kit.tiers?.[slot] ?? 0, locked: Number(slot) > (kit.unlocked ?? 4) }));
  const items = Object.fromEntries(SLOTS.map((slot) => [slot, (kit.items ?? []).filter((n) => POOL[slot].includes(n))]));
  const legendary = (kit.items ?? []).find((n) => LEGENDARY_NAMES.includes(n));
  const card = await heroCard({
    hero: rival, progress: { level, into: 0, needed: 1, max: false }, pointsLeft: 0, abilities, stats: statsFor(unit.stats), items, souls: 0, enhanced: kit.enhanced ?? [], ...(legendary ? { legendary } : {}),
    counter: { top, amount: fmt(Math.round(unit.stats.maxHealth * health)), label: 'HEALTH' },
  });
  const e = embed(color).setTitle(title ?? `Enemy Build  -  ${rival}  -  Level ${level}`).setImage('attachment://rival-build.jpg').setThumbnail('attachment://rival.png');
  if (note) e.setFooter({ text: note });
  return { embeds: [e], files: [soulsFile(), (await heroPicture(rival)).setName('rival.png'), new AttachmentBuilder(card, { name: 'rival-build.jpg' })] };
}

// The member's own hero as it went into a fight (the breakdown's build page): the same card, the hero's own colours.
const heroBuildView = (hero, kit, note = 'The build as the fight started.') => rivalBuildView(hero, kit, { note, title: `${hero}'s Build  -  Level ${kit.boons ?? 0}`, top: 'AT THE FIGHT', color: undefined });

module.exports = { npcBuildView, rivalBuildView, heroBuildView, unitLines };
