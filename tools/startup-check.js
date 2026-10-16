// The startup check (his ask, Oct 16: "when i restart, it does everything it needs to ... check that we have all the needed data and
// that its up to date"). `Start Bot.bat` runs it after `npm install` and before the bot; it never stops the bot from starting.
//   every start   new playable heroes the bot doesn't list yet (deadlock-api.com, only reported: adding a hero is his call),
//                 missing hero chat icons (`setup.py hero-icons`), full-body renders (the wiki, only the missing ones),
//                 hero emojis in the server (`setup.py hero-emojis` uploads the missing ones), a hero missing from the trivia data,
//                 a Hero Farming hero missing its gloat / critical portraits: anything missing is fetched right away
//   once a day    the up-to-date check (his call, Oct 16): one request asks the wiki for the last edit of every page the trivia data
//                 and the Hero Farming data come from; only a part whose pages changed since its last refresh is refreshed
//                 (`tools/trivia-data.js`, `src/utils/farm/refresh.js`, applied automatically, his call Oct 16); each saves nothing
//                 unless its whole download checks out. (Oct 16: refreshing everything daily, ~50 requests back to back, got us
//                 throttled.) data/startupCheck.json keeps the day and the page edits each part was refreshed from.
// Touches nothing in data/ but that one file. Wiki requests are paced (src/utils/wikiFetch.js).
// `node tools/startup-check.js [--full]` (--full refreshes both now, changed or not).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
const { HEROES } = require('../src/utils/heroes');
const { roster } = require('../src/utils/farm/hero');
const { GUILD_ID } = require('../src/config');
const { wikiFetch } = require('../src/utils/wikiFetch');

const ASSETS = path.join(ROOT, 'assets');
const STAMP = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'startupCheck.json');
const UA = 'FairfaxBot/1.0'; // the wiki's firewall lets this one through (refresh.js)
async function get(url, headers = {}) {
  const res = new URL(url).host.endsWith('deadlock.wiki') ? await wikiFetch(url, { userAgent: UA })
    : await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}

// The wiki pages each part is built from (trivia-data.js, refresh.js).
const TRIVIA_PAGES = [...HEROES.map((h) => `${h.name}/Voice lines`), 'Data:ItemCards.json', 'Data:Lang en.json'];
const FARM_PAGES = ['Data:HeroData.json', 'Data:AbilityData.json', 'Data:ItemCards.json', 'Data:NpcData.json', 'Data:GenericData.json'];
// The last edit (revision id) of each page, 50 pages to a request: { title: id }, null for a page that doesn't exist.
async function lastEdits(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const params = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids', formatversion: 2, format: 'json', titles: batch.join('|') });
    const { query } = await (await get(`https://deadlock.wiki/api.php?${params}`)).json();
    const asked = new Map((query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of query.pages) out[asked.get(page.title) ?? page.title] = page.revisions?.[0]?.revid ?? null;
  }
  return out;
}
const pick = (edits, pages) => Object.fromEntries(pages.map((t) => [t, edits[t] ?? null]));
const changedSince = (edits, old, pages) => pages.filter((t) => (edits[t] ?? null) !== (old?.[t] ?? null));

const problems = [];
const say = (text) => console.log(`  ${text}`);

// A command of ours, in this window; true when it finished without an error.
function run(label, command, args) {
  console.log(`\n--- ${label} ---`);
  const out = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  return !out.error && out.status === 0;
}
// setup.py through the Python launcher Windows installs (`py`), else `python`
function setup(command) {
  if (!process.env.DISCORD_TOKEN) { problems.push(`setup.py ${command}: no DISCORD_TOKEN in .env (setup.py would stop to ask for it)`); return false; }
  for (const [exe, pre] of [['py', ['-3']], ['python', []], ['python3', []]]) {
    const probe = spawnSync(exe, [...pre, '--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return run(`setup.py ${command}`, exe, [...pre, 'setup.py', command]);
  }
  problems.push(`setup.py ${command}: Python was not found`);
  return false;
}
const node = (label, file) => run(label, process.execPath, [path.join(ROOT, file)]);

const today = () => new Date().toLocaleDateString('en-CA'); // the PC's own date, YYYY-MM-DD
const readStamp = () => { try { return JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { return {}; } };

async function newHeroes() {
  try {
    const list = await (await get('https://api.deadlock-api.com/v1/assets/heroes?only_active=true')).json();
    const ours = new Set(HEROES.map((h) => h.name));
    const fresh = list.filter((h) => h.player_selectable && !h.disabled && !ours.has(h.name)).map((h) => h.name);
    say(fresh.length ? `New playable heroes not in the bot yet: ${fresh.join(', ')} (ask Claude to add them)` : 'Hero list: up to date');
    if (fresh.length) problems.push(`new heroes to add: ${fresh.join(', ')}`);
  } catch (e) {
    say(`Hero list: could not reach deadlock-api.com (${e.message})`);
  }
}

// The full-body renders for Shop cards (what Get-DeadlockFullBody.ps1 does, only the missing ones).
async function renders(missing) {
  const titles = missing.map((h) => `File:${h.name} Render.png`).join('|');
  const { query } = await (await get(`https://deadlock.wiki/api.php?action=query&prop=imageinfo&iiprop=url&format=json&titles=${encodeURIComponent(titles)}`)).json();
  const urls = Object.fromEntries(Object.values(query.pages).filter((p) => p.imageinfo).map((p) => [p.title, p.imageinfo[0].url]));
  for (const hero of missing) {
    const url = urls[`File:${hero.name} Render.png`];
    if (!url) { problems.push(`${hero.name}: no full-body render on the wiki yet`); continue; }
    fs.writeFileSync(path.join(ASSETS, 'heroes', 'full body', `${hero.slug}.png`), Buffer.from(await (await get(url)).arrayBuffer()));
    say(`Downloaded ${hero.name}'s full-body render`);
  }
}

// Hero emojis already in the server (read only: the bot never uploads emojis; setup.py does).
async function missingEmojis() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) { say('Emojis: no DISCORD_TOKEN in .env, skipped'); return []; }
  const res = await get(`https://discord.com/api/v10/guilds/${GUILD_ID}/emojis`, { Authorization: `Bot ${token}` });
  const names = new Set((await res.json()).map((e) => e.name));
  return HEROES.filter((h) => !names.has(h.slug));
}

async function main() {
  const stamp = readStamp();
  const force = process.argv.includes('--full');
  const daily = force || stamp.day !== today();
  console.log(`Startup check (${daily ? 'with the once-a-day up-to-date check' : 'missing files only; the up-to-date check already ran today'})`);
  await newHeroes();

  let edits = null; // what the wiki's pages are at now (once a day)
  let changed = { trivia: [], farm: [] };
  if (daily) {
    try {
      edits = await lastEdits([...new Set([...TRIVIA_PAGES, ...FARM_PAGES])]);
      changed = { trivia: changedSince(edits, stamp.edits?.trivia, TRIVIA_PAGES), farm: changedSince(edits, stamp.edits?.farm, FARM_PAGES) };
      say(!stamp.edits ? 'Wiki: first check, both parts get refreshed'
        : `Wiki: ${changed.trivia.length || changed.farm.length ? `changed since the last refresh: ${[...new Set([...changed.trivia, ...changed.farm])].join(', ')}` : 'nothing changed since the last refresh'}`);
    } catch (e) {
      problems.push(`could not ask the wiki what changed (${e.message}); trying again next start`);
    }
  }

  const has = (...parts) => fs.existsSync(path.join(ASSETS, ...parts));
  const noIcon = HEROES.filter((h) => !has('heroes', `${h.slug}.png`));
  if (noIcon.length && !setup('hero-icons')) problems.push(`hero icons missing: ${noIcon.map((h) => h.name).join(', ')}`);
  else say(noIcon.length ? `Hero icons: fetched ${noIcon.map((h) => h.name).join(', ')}` : 'Hero icons: all there');

  const noRender = HEROES.filter((h) => !has('heroes', 'full body', `${h.slug}.png`));
  if (noRender.length) await renders(noRender).catch((e) => problems.push(`full-body renders: ${e.message}`));
  else say('Full-body renders: all there');

  try {
    const noEmoji = await missingEmojis();
    if (noEmoji.length) {
      say(`Hero emojis missing in the server: ${noEmoji.map((h) => h.name).join(', ')}`);
      if (!setup('hero-emojis')) problems.push('hero emojis: setup.py hero-emojis failed');
    } else if (process.env.DISCORD_TOKEN) say('Hero emojis: all there');
  } catch (e) {
    problems.push(`hero emojis: ${e.message}`);
  }

  let trivia = true;
  const lines = (() => { try { return JSON.parse(fs.readFileSync(path.join(ASSETS, 'trivia', 'trivia.json'), 'utf8')); } catch { return []; } })();
  const noLines = HEROES.filter((h) => !lines.some((x) => x.slug === h.slug));
  if (force || noLines.length || changed.trivia.length) {
    if (noLines.length) say(`Trivia data missing: ${noLines.map((h) => h.name).join(', ')}`);
    trivia = node('Trivia data (deadlock.wiki)', 'tools/trivia-data.js');
    if (!trivia) problems.push('trivia data: not refreshed (see above)');
    else if (edits) stamp.edits = { ...stamp.edits, trivia: pick(edits, TRIVIA_PAGES) };
  } else say(edits ? 'Trivia data: up to date' : 'Trivia data: every hero there');

  let farm = true;
  const noFace = roster().filter((name) => ['gloat', 'critical'].some((mood) => !has('farm', 'rivals', `${name.toLowerCase()}_${mood}.png`)));
  if (force || noFace.length || changed.farm.length) {
    if (noFace.length) say(`Rival portraits missing: ${noFace.join(', ')}`);
    farm = node('Hero Farming data (deadlock.wiki)', 'src/utils/farm/refresh.js');
    if (!farm) problems.push('Hero Farming data: not refreshed (see above)');
    else if (edits) stamp.edits = { ...stamp.edits, farm: pick(edits, FARM_PAGES) };
  } else say(edits ? 'Hero Farming data: up to date' : 'Hero Farming portraits: all there');

  if (edits && trivia && farm) stamp.day = today(); // the day counts only when the check went through; otherwise the next start tries again
  fs.mkdirSync(path.dirname(STAMP), { recursive: true });
  fs.writeFileSync(STAMP, JSON.stringify(stamp));
  console.log(problems.length ? `\nStartup check found problems (the bot starts anyway):\n${problems.map((p) => `  - ${p}`).join('\n')}` : '\nStartup check: everything is there and up to date.');
}

main().catch((e) => console.log(`\nStartup check stopped: ${e.message} (the bot starts anyway)`));
