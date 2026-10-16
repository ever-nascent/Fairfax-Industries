// Rebuilds /trivia's question data from deadlock.wiki (run `npm run trivia-data`, or double-click "Refresh Trivia Data.bat";
// re-run after a game patch or a new hero). Touches nothing in Discord and nothing in data/. Credits: assets/CREDITS.txt.
//   assets/trivia/trivia.json   each hero's own voice lines and 4 abilities   ("<Hero>/Voice lines" pages)
//   assets/trivia/items.json    every shop item, tiers 1-4: cost, tier, the % stats on its card, what it upgrades into
//                               (Data:ItemCards.json + Data:Lang en.json)
//   assets/trivia/abilities/, items/   their pictures (only the missing ones are downloaded; --all fetches every one again;
//                               an ability icon the wiki doesn't have yet comes from deadlock-api.com)
// Nothing is written unless the whole download checks out, so a wiki hiccup can't leave /trivia with half its questions.
// `--check` only reports what would change. (Ported from `setup.py trivia`, which he no longer uses.)
const fs = require('node:fs');
const path = require('node:path');
const { HEROES } = require('../src/utils/heroes');
const { ASSETS } = require('../src/utils/art');
const { wikiFetch } = require('../src/utils/wikiFetch');

const WIKI = 'https://deadlock.wiki';
const DEADLOCK_API = 'https://api.deadlock-api.com'; // ability icons the wiki doesn't have yet (unofficial)
const OUT = path.join(ASSETS, 'trivia');
// Words that give the answer away if a line contains them (besides the hero's own name).
const ALIASES = {
  'Mo & Krill': ['Maurice', 'Momo', 'Mo', 'Krill'],
  Sinclair: ['Henry', 'Savannah'],
  'Lady Geist': ['Geist'],
  'Grey Talon': ['Talon'],
  'The Doorman': ['Doorman'],
};
// Sections of a "<Hero>/Voice lines" page that aren't the hero talking (or aren't in the game).
const SKIP_SECTIONS = ['conversation', 'other character', 'removed', 'unused', 'navigation'];
const SLOTS = { Weapon: 'Weapon', Armor: 'Vitality', Tech: 'Spirit' };

const fileOf = (name) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}.png`;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const UA = 'Mozilla/5.0 (fairfax-trivia-data)';
async function get(url, as = 'json') { // wiki requests are paced (wikiFetch); deadlock-api.com's go straight
  const res = new URL(url).host.endsWith('deadlock.wiki') ? await wikiFetch(url, { userAgent: UA })
    : await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url.split('?')[0]}: HTTP ${res.status}`);
  return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
}
const api = (params) => get(`${WIKI}/api.php?${new URLSearchParams({ ...params, format: 'json' })}`);
const raw = (page) => get(`${WIKI}/index.php?${new URLSearchParams({ title: page, action: 'raw' })}`);

function cleanWikiText(text) {
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1') // [[link|shown]] -> shown
    .replace(/<[^>]+>/g, '') // html tags
    .replaceAll("''", '') // ''italics''
    .replace(/\s+/g, ' ')
    .trim();
}

// One hero's own lines from their voice-lines page: 25-150 characters, no stage directions, none that name them.
function voiceLines(hero, text) {
  const names = [...hero.split(/[\s&]+/).filter((w) => w && w !== 'The'), ...(ALIASES[hero] ?? [])];
  const giveaway = new RegExp(`\\b(${names.map(escapeRegex).join('|')})\\b`, 'i');
  const lines = [];
  const seen = new Set();
  // level-2 sections ("== Select ==" or "==Select=="); keep only the hero's own lines
  for (const section of `\n${text}`.split(/\n(?===\s*[^=\s])/)) {
    const title = section.trim().split('\n', 1)[0].toLowerCase();
    if (SKIP_SECTIONS.some((skip) => title.includes(skip))) continue;
    const rows = section.split('\n');
    rows.forEach((row, i) => {
      const found = row.match(/\{\{Audio link\|[^|}]*\|([^}]*)\}\}/);
      if (!found) return;
      let said = found[1];
      // Yamato speaks Japanese: the wiki puts the English translation in the next table cell
      if (/[぀-ヿ一-鿿]/.test(said)) {
        const after = rows[i + 1] ?? '';
        if (!after.startsWith('|') || after.startsWith('|-') || after.startsWith('|}')) return;
        said = after.slice(1);
      }
      const line = cleanWikiText(said);
      if (line.length < 25 || line.length > 150 || '(['.includes(line[0]) || line.includes('[') || giveaway.test(line) || seen.has(line.toLowerCase())) return;
      seen.add(line.toLowerCase());
      lines.push(line);
    });
  }
  return lines;
}

// "File:<name>.png" -> its url, 50 titles per wiki query.
async function fileUrls(names) {
  const urls = new Map();
  for (let i = 0; i < names.length; i += 50) {
    const { query } = await api({ action: 'query', titles: names.slice(i, i + 50).map((n) => `File:${n}.png`).join('|'), prop: 'imageinfo', iiprop: 'url' });
    const asked = new Map((query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(query.pages)) {
      if (page.imageinfo) urls.set(asked.get(page.title) ?? page.title, page.imageinfo[0].url);
    }
  }
  return (name) => urls.get(`File:${name}.png`);
}

// deadlock-api.com's ability icons by name (lower case: it writes "Feed The Birds", the wiki "Feed the Birds").
// The same pictures as the wiki's (Haze's Sleep Dagger is identical); used only for an ability the wiki has no
// file for yet, e.g. a new hero's ultimate. A name on two entries (Solomon's pieces have an "undo" copy with no
// hero) keeps the one a hero owns.
function abilityIcons(list) {
  const urls = new Map();
  const owned = (a) => (a.heroes?.length ? 0 : 1);
  for (const a of [...list].sort((x, y) => owned(x) - owned(y))) {
    const key = a.name?.toLowerCase();
    if (key && a.image?.endsWith('.png') && !urls.has(key)) urls.set(key, a.image);
  }
  return (name) => urls.get(name.toLowerCase());
}

// The wikitext of many pages, PAGES_PER_REQUEST to a request (Oct 16: one request per hero, ~45 back to back, got the startup check
// throttled). Returns { title: text }, null for a page that doesn't exist. A page the wiki leaves out (its answer was too big) is asked again.
const PAGES_PER_REQUEST = 10;
async function pageTexts(titles) {
  const out = {};
  const pending = [...titles];
  while (pending.length) {
    const batch = pending.splice(0, PAGES_PER_REQUEST);
    const { query } = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', formatversion: 2, titles: batch.join('|') });
    const asked = new Map((query.normalized ?? []).map((n) => [n.to, n.from])); // the wiki's spelling -> ours
    const left = [];
    for (const page of query.pages) {
      const title = asked.get(page.title) ?? page.title;
      if (page.missing) out[title] = null;
      else if (page.revisions?.[0]?.slots?.main?.content !== undefined) out[title] = page.revisions[0].slots.main.content;
      else left.push(title);
    }
    if (left.length === batch.length) throw new Error(`the wiki sent none of ${batch.length} pages`);
    pending.unshift(...left);
  }
  return out;
}

async function buildHeroes(problems) {
  const heroes = [];
  const texts = await pageTexts(HEROES.map(({ name }) => `${name}/Voice lines`));
  for (const { name, slug } of HEROES) {
    const text = texts[`${name}/Voice lines`];
    if (text == null) {
      problems.push(`${name}: no "${name}/Voice lines" page on the wiki`);
      continue;
    }
    const lines = voiceLines(name, text);
    const abilities = [...text.matchAll(/===\s*\{\{AbilityIcon\|([^}]+)\}\}\s*===/g)].map((m) => cleanWikiText(m[1])).slice(0, 4);
    if (!lines.length || abilities.length !== 4) problems.push(`${name}: ${lines.length} lines, ${abilities.length} abilities (needs lines and 4 abilities)`);
    heroes.push({ name, slug, lines, abilities });
    console.log(`  ${name}: ${lines.length} lines, abilities: ${abilities.join(', ') || 'none found'}`);
  }
  const urlOf = await fileUrls(heroes.flatMap((h) => h.abilities));
  let apiUrlOf = null; // fetched only when the wiki is missing an icon
  if (heroes.some((h) => h.abilities.some((ability) => !urlOf(ability)))) {
    try {
      apiUrlOf = abilityIcons(await get(`${DEADLOCK_API}/v1/assets/items/by-type/ability`));
    } catch (error) {
      console.log(`  deadlock-api.com didn't answer (${error.message})`);
    }
  }
  const pictures = [];
  for (const hero of heroes) {
    hero.abilities = hero.abilities.flatMap((ability) => {
      let url = urlOf(ability);
      if (!url && apiUrlOf?.(ability)) {
        url = apiUrlOf(ability);
        console.log(`  icon for ${ability} (${hero.name}) from deadlock-api.com: the wiki has none yet`);
      }
      if (!url) {
        problems.push(`no icon for ${ability} (${hero.name})`);
        return [];
      }
      pictures.push({ file: path.join(OUT, 'abilities', fileOf(ability)), url });
      return [{ name: ability, icon: fileOf(ability) }];
    });
  }
  return { heroes, pictures };
}

async function buildItems() {
  const [cards, lang] = await Promise.all([raw('Data:ItemCards.json'), raw('Data:Lang en.json')]);
  const live = Object.values(cards).filter((card) => card.Name && !card.IsDisabled);
  const into = new Map(); // component key -> names of the items it builds into
  for (const card of live) for (const key of card.Components ?? []) into.set(key, [...(into.get(key) ?? []), card.Name]);
  const items = [];
  for (const card of live) {
    if (![1, 2, 3, 4].includes(card.Tier)) continue;
    let stats = [];
    for (const [key, info] of Object.entries(card)) {
      if (!key.startsWith('Info')) continue;
      for (const s of [...(info.Main ?? []), ...(info.Alt ?? [])]) {
        const label = lang[`${s.Key}_label`];
        const prefix = lang[`${s.Key}_prefix`];
        if (lang[`${s.Key}_postfix`] !== '%' || !label || typeof s.Value === 'string') continue;
        const sign = prefix === '+' || (prefix === '{s:sign}' && s.Value >= 0) ? '+' : prefix === '-' ? '-' : '';
        stats.push({ label, value: s.Value, sign });
      }
    }
    // a label twice on one card (e.g. innate and active Bullet Resist) would make the blank ambiguous
    stats = stats.filter((s) => stats.filter((t) => t.label === s.label).length === 1);
    items.push({ name: card.Name, slot: SLOTS[card.Slot], tier: card.Tier, cost: card.Cost, icon: fileOf(card.Name), stats, into: [...(into.get(card.Key) ?? [])].sort() });
  }
  const urlOf = await fileUrls(items.map((it) => it.name));
  const kept = [];
  const pictures = [];
  for (const item of items) {
    const url = urlOf(item.name);
    if (!url) {
      console.log(`  no art for ${item.name} (left out)`);
      continue;
    }
    pictures.push({ file: path.join(OUT, 'items', item.icon), url });
    kept.push(item);
  }
  kept.sort((a, b) => a.tier - b.tier || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { items: kept, pictures };
}

// What a refresh would change, in words.
function changes(oldHeroes, heroes, oldItems, items) {
  const out = [];
  const byName = (list) => new Map(list.map((x) => [x.name, x]));
  const [was, now] = [byName(oldHeroes), byName(heroes)];
  for (const hero of heroes) {
    const old = was.get(hero.name);
    if (!old) out.push(`new hero: ${hero.name} (${hero.lines.length} lines)`);
    else {
      const [a, b] = [new Set(old.lines), new Set(hero.lines)];
      const added = hero.lines.filter((l) => !a.has(l)).length;
      const gone = old.lines.filter((l) => !b.has(l)).length;
      if (added || gone) out.push(`${hero.name}: +${added} / -${gone} voice lines`);
      const [x, y] = [old.abilities.map((q) => q.name).join(', '), hero.abilities.map((q) => q.name).join(', ')];
      if (x !== y) out.push(`${hero.name}: abilities ${x} -> ${y}`);
    }
  }
  for (const old of oldHeroes) if (!now.has(old.name)) out.push(`hero gone: ${old.name}`);
  const [wasItem, nowItem] = [byName(oldItems), byName(items)];
  for (const item of items) {
    const old = wasItem.get(item.name);
    if (!old) out.push(`new item: ${item.name} (Tier ${item.tier}, ${item.cost})`);
    else {
      if (old.cost !== item.cost || old.tier !== item.tier) out.push(`${item.name}: Tier ${old.tier} ${old.cost} -> Tier ${item.tier} ${item.cost}`);
      if (JSON.stringify(old.stats) !== JSON.stringify(item.stats)) out.push(`${item.name}: % stats changed`);
      if (old.into.join() !== item.into.join()) out.push(`${item.name}: upgrades into ${old.into.join(', ') || 'nothing'} -> ${item.into.join(', ') || 'nothing'}`);
    }
  }
  for (const old of oldItems) if (!nowItem.has(old.name)) out.push(`item gone: ${old.name}`);
  return out;
}

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);

async function main(args = process.argv.slice(2)) {
  const check = args.includes('--check');
  const all = args.includes('--all');
  const problems = [];
  console.log('Voice lines and abilities (deadlock.wiki):');
  const { heroes, pictures: abilityPictures } = await buildHeroes(problems);
  console.log('Items (deadlock.wiki):');
  const { items, pictures: itemPictures } = await buildItems();
  if (heroes.length !== HEROES.length) problems.push(`only ${heroes.length} of ${HEROES.length} heroes`);
  if (items.length < 100) problems.push(`only ${items.length} items (expected about 150)`);
  if (problems.length) {
    console.log(`\nNOTHING WAS SAVED. The download has problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  const heroFile = path.join(OUT, 'trivia.json');
  const itemFile = path.join(OUT, 'items.json');
  const list = changes(readJson(heroFile), heroes, readJson(itemFile), items);
  console.log(list.length ? `\nChanges (${list.length}):\n${list.map((c) => `  - ${c}`).join('\n')}` : '\nNo changes: the data is up to date.');
  console.log(`\n${heroes.length} heroes, ${heroes.reduce((n, h) => n + h.lines.length, 0)} voice lines, ${items.length} items.`);
  if (check) {
    console.log('Check only: nothing was saved.');
    return;
  }

  let downloaded = 0;
  for (const { file, url } of [...abilityPictures, ...itemPictures]) {
    if (!all && fs.existsSync(file)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await get(url, 'bytes'));
    downloaded++;
  }
  fs.writeFileSync(heroFile, JSON.stringify(heroes, null, 1));
  fs.writeFileSync(itemFile, JSON.stringify(items, null, 1));
  console.log(`Saved to ${OUT} (${downloaded} pictures downloaded). Restart the bot to use it.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nNOTHING WAS SAVED. ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { voiceLines, cleanWikiText, changes, fileOf, abilityIcons };
