// The startup check (his ask, Oct 16: "when i restart, it does everything it needs to ... check that we have all the needed data and
// that its up to date"). `Start Bot.bat` runs it after `npm install` and before the bot; it never stops the bot from starting.
// Nothing here calls Python (Oct 23): images and emojis are fetched in Node. data/startupCheck.json keeps the day and what each part was
// refreshed from (page edits, and the wiki's sha1 of every image).
//   every start   nothing, when the daily check already ran today and nothing is missing that was never tried: no request at all,
//                 one line of output. Missing and never tried (a hero just added to HEROES, a deleted image, an image with no record) runs
//                 the daily check right away; missing but already asked about (Nurse Harrow's voice lines, a portrait the wiki has no file
//                 for) waits for the next daily check.
//   once a day    (his call, Oct 16) new playable heroes the bot doesn't list (deadlock-api.com, only reported: adding one is his call);
//                 one wiki query for the last edit of every data page and the sha1 of every hero image (icons, full-body renders, the
//                 rival portraits of the two portrait categories, Silver's wolf too); only what changed is downloaded (a file's record is
//                 written after it is saved, so a failure is tried again; the first run replaces what differs from the wiki's; a file the wiki
//                 has nothing for is never touched); the hero emojis in the server (missing ones uploaded, one whose icon changed replaced,
//                 and the bot repairs the #roles menus at its start, src/events/reactionRolesReady.js); trivia data and Hero Farming data
//                 only when their pages changed (`tools/trivia-data.js`, `src/utils/farm/refresh.js`; each saves nothing unless its whole
//                 download checks out). (Oct 16: refreshing everything daily, ~50 requests back to back, got us throttled.)
// The end summary is grouped: Fetched, Changed on the wiki, Waiting on the wiki, Could not reach, Needs you.
// Touches nothing in data/ but that one file. Wiki requests are paced (src/utils/wikiFetch.js).
// `node tools/startup-check.js [--full]` (--full refreshes both data parts now, changed or not, and checks the emojis again).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROOT = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch {}
const { HEROES } = require('../src/utils/heroes');
const { roster } = require('../src/utils/farm/hero');
const { GUILD_ID } = require('../src/config');
const { wikiFetch } = require('../src/utils/wikiFetch');

const ASSETS = process.env.ASSETS_DIR || path.join(ROOT, 'assets');
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
// What the wiki has for each title, 50 to a request: { title: { rev, sha1, url } }. rev = last edit of a page (null if it doesn't
// exist), sha1 + url = a File: page's current file (null if there is none).
async function wikiInfo(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const params = new URLSearchParams({ action: 'query', prop: 'revisions|imageinfo', rvprop: 'ids', iiprop: 'sha1|url', formatversion: 2, format: 'json', titles: batch.join('|') });
    const { query } = await (await get(`https://deadlock.wiki/api.php?${params}`)).json();
    const asked = new Map((query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of query.pages) {
      const file = page.imageinfo?.[0];
      out[asked.get(page.title) ?? page.title] = { rev: page.revisions?.[0]?.revid ?? null, sha1: file?.sha1 ?? null, url: file?.url ?? null };
    }
  }
  return out;
}
const pick = (edits, pages) => Object.fromEntries(pages.map((t) => [t, edits[t] ?? null]));
const changedSince = (edits, old, pages) => pages.filter((t) => (edits[t] ?? null) !== (old?.[t] ?? null));

// setup.py's to_square_png(raw, 128, trim=True): cut the empty border, shrink to fit (never enlarge), centre on a transparent square.
const SIZE = 128;
const MAX_ICON_BYTES = 256 * 1024; // Discord's emoji limit
async function toSquarePng(raw) {
  const img = await loadImage(raw);
  const src = createCanvas(img.width, img.height);
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const { data } = sctx.getImageData(0, 0, img.width, img.height);
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (data[(y * img.width + x) * 4 + 3] === 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = img.width - 1; y1 = img.height - 1; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const k = Math.min(1, SIZE / w, SIZE / h);
  const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
  const out = createCanvas(SIZE, SIZE);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, y0, w, h, Math.floor((SIZE - dw) / 2), Math.floor((SIZE - dh) / 2), dw, dh);
  return out.toBuffer('image/png');
}

// Every hero image the wiki owns: the chat icon (converted) and the full-body render (saved as downloaded).
const heroFiles = () => HEROES.flatMap((h) => [
  { slug: h.slug, name: `${h.name}'s icon`, rel: `heroes/${h.slug}.png`, title: `File:${h.name}.png`, icon: true },
  { name: `${h.name}'s render`, rel: `heroes/full body/${h.slug}.png`, title: `File:${h.name} Render.png` },
]);
// ---- Rival portraits (assets/farm/rivals/<hero lower case>_<gloat|critical>.png), from the wiki's two portrait categories ----
const MOODS = { 'Gloat Portraits': 'gloat', 'Critical Health Portraits': 'critical' };
const ALIASES = { doorman: 'the doorman', bily: 'billy', 'werewolf silver': 'silver wolf' }; // the wiki's spellings (the only hand-kept names, with EXTRA)
const EXTRA = { violet: { gloat: 'File:Violet gloat.png', critical: 'File:Violet ciritcal.png' } }; // on the wiki, but in neither category
const portraitHeroes = () => [...roster().map((n) => n.toLowerCase()), 'silver wolf']; // Silver's wolf face is a hero of its own on the wiki
// "File:Mirage Gloat .png" -> "mirage"; null when it names nobody on our list.
function heroOfPortrait(title) {
  let name = title.replace(/^File:/i, '').replace(/\.\w+$/, '').trim();
  for (let again = true; again;) { const next = name.replace(/\s+(gloat|critical|health|portrait)$/i, '').trim(); again = next !== name; name = next; }
  name = name.toLowerCase();
  name = ALIASES[name] ?? name;
  return portraitHeroes().includes(name) ? name : null;
}
// { 'farm/rivals/haze_gloat.png': { title, sha1, url } } for every hero and mood: the newest upload when a name turns up twice, sha1 null when
// the wiki has none. `strays`: category files that match no hero.
function portraitFiles(categories, infos) {
  const found = {};
  const strays = [];
  for (const [category, files] of Object.entries(categories)) for (const f of files) {
    const hero = heroOfPortrait(f.title);
    if (!hero) { strays.push(f.title); continue; }
    const key = `${hero}_${MOODS[category]}`;
    if (!found[key] || f.ts > found[key].ts) found[key] = f;
  }
  const out = {};
  for (const hero of portraitHeroes()) for (const mood of Object.values(MOODS)) {
    const key = `${hero}_${mood}`;
    const info = found[key] ?? (EXTRA[hero] && infos[EXTRA[hero][mood]]?.sha1 ? { title: EXTRA[hero][mood], ...infos[EXTRA[hero][mood]] } : null);
    out[`farm/rivals/${key}.png`] = { name: `${hero}'s ${mood} portrait`, title: info?.title ?? null, sha1: info?.sha1 ?? null, url: info?.url ?? null };
  }
  return { files: out, strays };
}
async function categoryFiles(category) {
  const params = new URLSearchParams({ action: 'query', generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'file', gcmlimit: 'max', prop: 'imageinfo', iiprop: 'sha1|url|timestamp', formatversion: 2, format: 'json' });
  const { query } = await (await get(`https://deadlock.wiki/api.php?${params}`)).json();
  return (query?.pages ?? []).map((p) => ({ title: p.title, sha1: p.imageinfo?.[0]?.sha1 ?? null, url: p.imageinfo?.[0]?.url ?? null, ts: p.imageinfo?.[0]?.timestamp ?? '' }));
}

const sha1Of = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
// A file the stamp has no record of, or that was deleted although the wiki has one: worth the daily check right now.
const needsFetch = (stamp) => [...heroFiles().map((f) => f.rel), ...portraitHeroes().flatMap((h) => Object.values(MOODS).map((m) => `farm/rivals/${h}_${m}.png`))].some((rel) => {
  const rec = stamp.files?.[rel];
  return !rec || (rec.sha1 !== null && !fs.existsSync(path.join(ASSETS, rel)));
});
// Download what the wiki has a different file for. A record's sha1 is written only after the file is saved, so a failure is tried again.
// Returns true when every file went through.
async function syncImages(files, stamp, defer) {
  stamp.files ??= {};
  const refreshed = [];
  const pending = new Map(); // with `defer`, an icon's record is written by syncEmojis once its emoji is done
  let ok = true;
  for (const f of files) {
    const info = f.info;
    if (!info) continue;
    const abs = path.join(ASSETS, f.rel);
    const rec = stamp.files[f.rel];
    const exists = fs.existsSync(abs);
    if (!info.sha1) {
      stamp.files[f.rel] = { title: f.title, sha1: null };
      if (!rec) report.waiting.push(`${f.name}: not on the wiki${exists ? ', keeping the one on this PC' : ' yet'}`); // a local file the wiki has nothing for is never touched
      continue;
    }
    if (rec?.sha1 === info.sha1 && exists) continue;
    if (!f.icon && !rec && exists && sha1Of(abs) === info.sha1) { stamp.files[f.rel] = { title: f.title, sha1: info.sha1 }; continue; }
    try {
      const raw = Buffer.from(await (await get(info.url)).arrayBuffer());
      const png = f.icon ? await toSquarePng(raw) : raw;
      if (f.icon && png.length > MAX_ICON_BYTES) throw new Error(`the icon came out at ${Math.round(png.length / 1024)} KB, over Discord's 256 KB`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, png);
      if (f.icon && defer) pending.set(f.slug, { rel: f.rel, title: f.title, sha1: info.sha1, replace: !!rec?.sha1 && rec.sha1 !== info.sha1 });
      else stamp.files[f.rel] = { title: f.title, sha1: info.sha1 };
      refreshed.push(f.name);
    } catch (e) {
      report.unreachable.push(`${f.name}: ${e.message}`);
      ok = false;
    }
  }
  if (refreshed.length) report.fetched.push(`Images from the wiki (${refreshed.length}): ${refreshed.slice(0, 12).join(', ')}${refreshed.length > 12 ? ` and ${refreshed.length - 12} more` : ''}`);
  return { ok, pending };
}

// What the check did, printed once at the end in these groups.
const report = { fetched: [], changed: [], waiting: [], unreachable: [], needs: [] };

// A command of ours, in this window; true when it finished without an error.
function run(label, command, args) {
  console.log(`\n--- ${label} ---`);
  const out = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  return !out.error && out.status === 0;
}
const node = (label, file) => deps.run(label, process.execPath, [path.join(ROOT, file)]);
const deps = { run }; // a test swaps this for a fake

const today = () => new Date().toLocaleDateString('en-CA'); // the PC's own date, YYYY-MM-DD
const save = (stamp) => { fs.mkdirSync(path.dirname(STAMP), { recursive: true }); fs.writeFileSync(STAMP, JSON.stringify(stamp)); };
const readStamp = () => { try { return JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { return {}; } };

async function newHeroes() {
  try {
    const list = await (await get('https://api.deadlock-api.com/v1/assets/heroes?only_active=true')).json();
    const ours = new Set(HEROES.map((h) => h.name));
    const fresh = list.filter((h) => h.player_selectable && !h.disabled && !ours.has(h.name)).map((h) => h.name);
    if (fresh.length) report.needs.push(`New playable heroes not in the bot yet: ${fresh.join(', ')} (ask Claude to add them)`);
  } catch (e) {
    report.unreachable.push(`deadlock-api.com (new-hero check): ${e.message}`);
  }
}

// ---- Hero emojis in the server (Discord REST, no Python): missing ones are uploaded; one whose wiki icon changed is replaced ----
async function discord(method, route, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${route}`, {
      method, signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'User-Agent': UA, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    if (res.status === 429 && attempt === 0) { await sleep(((await res.json().catch(() => ({}))).retry_after ?? 1) * 1000); continue; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`Discord answered ${res.status}${err.message ? ` (${err.message})` : ''}`), { code: err.code });
    }
    return res.status === 204 ? null : res.json();
  }
}
// `pending`: icons saved this run whose record waits for their emoji: slug -> { rel, title, sha1, replace }. Returns false when a replace failed.
async function syncEmojis(pending, stamp) {
  const keep = ({ rel, title, sha1 }) => { stamp.files[rel] = { title, sha1 }; };
  if (!process.env.DISCORD_TOKEN) { report.needs.push('Hero emojis skipped: no DISCORD_TOKEN in .env'); return true; }
  const emojis = new Map((await discord('GET', `/guilds/${GUILD_ID}/emojis`)).map((e) => [e.name, e]));
  const made = [], replaced = [];
  let ok = true;
  const create = async (h) => discord('POST', `/guilds/${GUILD_ID}/emojis`, { name: h.slug, image: `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, 'heroes', `${h.slug}.png`)).toString('base64')}` });
  for (const h of HEROES) {
    const p = pending.get(h.slug);
    const old = emojis.get(h.slug);
    if (!fs.existsSync(path.join(ASSETS, 'heroes', `${h.slug}.png`))) continue;
    try {
      if (!old) { await create(h); made.push(h.name); }
      else if (p?.replace) {
        try { await create(h); } catch (e) { // the server is full: make room first
          if (e.code !== 30008) throw e;
          await discord('DELETE', `/guilds/${GUILD_ID}/emojis/${old.id}`);
          await create(h);
          replaced.push(h.name);
          if (p) keep(p);
          continue;
        }
        await discord('DELETE', `/guilds/${GUILD_ID}/emojis/${old.id}`);
        replaced.push(h.name);
      }
      if (p) keep(p);
    } catch (e) {
      report.unreachable.push(`${h.name}'s emoji (Discord): ${e.message}`);
      if (p?.replace) ok = false; else if (p) keep(p);
    }
  }
  if (made.length) report.fetched.push(`Emojis uploaded: ${made.join(', ')}`);
  if (replaced.length) report.fetched.push(`Emojis replaced: ${replaced.join(', ')}`);
  return ok;
}

async function main() {
  for (const key of Object.keys(report)) report[key] = [];
  const stamp = readStamp();
  const force = process.argv.includes('--full');
  // A hero with no trivia lines only counts as missing when the stamp never asked the wiki for its page; if it did (and the wiki had
  // nothing, e.g. Nurse Harrow), it waits for the next daily check, which re-runs when her page is edited.
  const lines = (() => { try { return JSON.parse(fs.readFileSync(path.join(ASSETS, 'trivia', 'trivia.json'), 'utf8')); } catch { return []; } })();
  const noLines = HEROES.filter((h) => !lines.some((x) => x.slug === h.slug) && !((`${h.name}/Voice lines`) in (stamp.edits?.trivia ?? {})));
  const daily = force || stamp.day !== today() || noLines.length > 0 || needsFetch(stamp);
  if (daily) console.log('Startup check: running the once-a-day check (this can take a while the first time)...');
  if (daily) await newHeroes();

  let edits = null; // what the wiki's pages are at now (once a day)
  let infos = null;
  let images = true;
  let pending = new Map();
  let changed = { trivia: [], farm: [] };
  if (daily) {
    try {
      infos = await wikiInfo([...new Set([...TRIVIA_PAGES, ...FARM_PAGES, ...heroFiles().map((f) => f.title), ...Object.values(EXTRA).flatMap((t) => Object.values(t))])]);
      edits = Object.fromEntries(Object.entries(infos).map(([t, v]) => [t, v.rev]));
      changed = { trivia: changedSince(edits, stamp.edits?.trivia, TRIVIA_PAGES), farm: changedSince(edits, stamp.edits?.farm, FARM_PAGES) };
      if (!stamp.edits) report.changed.push('Wiki: first check, trivia and Hero Farming data get refreshed');
    } catch (e) {
      report.unreachable.push(`deadlock.wiki (what changed): ${e.message}; trying again next start`);
    }
  }

  if (infos) {
    const files = heroFiles().map((f) => ({ ...f, info: infos[f.title] }));
    try {
      const categories = Object.fromEntries(await Promise.all(Object.keys(MOODS).map(async (c) => [c, await categoryFiles(c)])));
      const { files: portraits, strays } = portraitFiles(categories, infos);
      files.push(...Object.entries(portraits).map(([rel, p]) => ({ rel, name: p.name, title: p.title, info: p })));
      if (strays.length) report.waiting.push(`Portraits on the wiki that match no hero of ours: ${strays.join(', ')}`);
    } catch (e) {
      report.unreachable.push(`deadlock.wiki (portrait categories): ${e.message}; trying again next start`);
      images = false;
    }
    const synced = await syncImages(files, stamp, !!process.env.DISCORD_TOKEN);
    images = synced.ok && images;
    pending = synced.pending;
    save(stamp);
  } // saved now: a long download run shouldn't be lost to a later failure

  if (daily) {
    stamp.files ??= {};
    try { images = (await syncEmojis(pending, stamp)) && images; } catch (e) {
      report.unreachable.push(`Discord (hero emojis): ${e.message}`);
      if (pending.size) images = false; // their records wait
    }
    save(stamp);
  }

  let trivia = true;
  if (daily) { // heroes the wiki has no voice lines for yet (the stamp has seen their page); the daily check re-runs when it is edited
    const waiting = HEROES.filter((h) => !lines.some((x) => x.slug === h.slug) && !noLines.includes(h));
    if (waiting.length) report.waiting.push(`Trivia voice lines not written on the wiki yet: ${waiting.map((h) => h.name).join(', ')}`);
  }
  if (force || noLines.length || changed.trivia.length) {
    trivia = node('Trivia data (deadlock.wiki)', 'tools/trivia-data.js');
    if (!trivia) report.unreachable.push('Trivia data: not refreshed (see above)');
    else { report.changed.push(`Trivia data refreshed${changed.trivia.length ? ` (${changed.trivia.length} page${changed.trivia.length === 1 ? '' : 's'} changed)` : ''}`); if (edits) stamp.edits = { ...stamp.edits, trivia: pick(edits, TRIVIA_PAGES) }; }
  }

  let farm = true;
  if (force || changed.farm.length) {
    farm = node('Hero Farming data (deadlock.wiki)', 'src/utils/farm/refresh.js');
    if (!farm) report.unreachable.push('Hero Farming data: not refreshed (see above)');
    else { report.changed.push(`Hero Farming data refreshed${changed.farm.length ? ` (${changed.farm.length} page${changed.farm.length === 1 ? '' : 's'} changed)` : ''}`); if (edits) stamp.edits = { ...stamp.edits, farm: pick(edits, FARM_PAGES) }; }
  }

  if (edits && trivia && farm && images) stamp.day = today(); // the day counts only when the check went through; otherwise the next start tries again
  save(stamp);
  const groups = [['Fetched', report.fetched], ['Changed on the wiki', report.changed], ['Waiting on the wiki', report.waiting], ['Could not reach', report.unreachable], ['Needs you', report.needs]].filter(([, items]) => items.length);
  if (!groups.length) console.log(daily ? '\nStartup check: everything is there and up to date.' : 'Startup check: nothing to do (the daily check ran today).');
  else console.log(`\nStartup check (the bot starts anyway):\n${groups.map(([title, items]) => `  ${title}:\n${items.map((i) => `    - ${i}`).join('\n')}`).join('\n')}`);
}

module.exports = { main, deps, toSquarePng, heroOfPortrait, portraitFiles };
if (require.main === module) main().catch((e) => console.log(`\nStartup check stopped: ${e.message} (the bot starts anyway)`));
