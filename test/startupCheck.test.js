// Run: node --test. The startup check's "what to do" rules: a same-day start makes no request, a missing thing the wiki
// was already asked about waits for the daily check. Fake wiki (global fetch), temp data + assets folders, no real commands run.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fairfax-sc-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.ASSETS_DIR = path.join(tmp, 'assets');
process.env.WIKI_GAP_MS = '0';
process.env.WIKI_RETRY_WAITS_MS = '0';
const test = require('node:test');
const assert = require('node:assert');
const { HEROES } = require('../src/utils/heroes');
const { createCanvas } = require('@napi-rs/canvas');
const { main, deps, toSquarePng, heroOfPortrait, portraitFiles } = require('../tools/startup-check');
const { roster } = require('../src/utils/farm/hero');
delete process.env.DISCORD_TOKEN; // .env was loaded; no Discord calls in tests

const A = process.env.ASSETS_DIR;
const STAMP = path.join(process.env.DATA_DIR, 'startupCheck.json');
const NO_LINES = 'Nurse Harrow';
fs.mkdirSync(path.join(A, 'heroes', 'full body'), { recursive: true });
fs.mkdirSync(path.join(A, 'trivia'), { recursive: true });
for (const h of HEROES) for (const f of [`${h.slug}.png`, path.join('full body', `${h.slug}.png`)]) fs.writeFileSync(path.join(A, 'heroes', f), 'x');
const writeLines = (without) => fs.writeFileSync(path.join(A, 'trivia', 'trivia.json'), JSON.stringify(HEROES.filter((h) => h.name !== without).map((h) => ({ slug: h.slug }))));
const today = new Date().toLocaleDateString('en-CA');
const TRIVIA_TITLES = [...HEROES.map((h) => `${h.name}/Voice lines`), 'Data:ItemCards.json', 'Data:Lang en.json'];

// a 200 x 100 picture, opaque only in its middle, as the wiki's file
const cv = createCanvas(200, 100);
const c2 = cv.getContext('2d');
c2.fillStyle = '#f00';
c2.fillRect(80, 30, 40, 40);
const PNG = cv.toBuffer('image/png');
const realFetch = global.fetch;
let wikiMissing = new Set(); // File: titles the wiki has nothing for
let wikiSha = (title) => `sha-${title}`;
let failDownloads = false;
let categories = {}; // 'Gloat Portraits' -> [{ title, sha1, ts }]
let urls = [];
let commands = [];
let discord = []; // 'METHOD route' of every Discord call
let serverEmojis = [];
let discordFails = new Set(); // 'POST' / 'DELETE'
global.fetch = async (url, opts = {}) => {
  if (String(url).includes('discord.com')) {
    const route = new URL(url).pathname.replace('/api/v10', '');
    const method = opts.method ?? 'GET';
    discord.push(`${method} ${route.replace(/\/emojis\/\d+/, '/emojis/ID')}`);
    if (discordFails.has(method)) return { ok: false, status: 400, json: async () => ({ message: 'nope' }) };
    if (method === 'GET') return { ok: true, status: 200, json: async () => serverEmojis };
    if (method === 'DELETE') return { ok: true, status: 204, json: async () => null };
    return { ok: true, status: 200, json: async () => ({ id: '999', name: JSON.parse(opts.body).name }) };
  }
  urls.push(String(url));
  if (String(url).includes('api.php') && new URL(url).searchParams.get('generator')) {
    const files = categories[new URL(url).searchParams.get('gcmtitle').replace('Category:', '')] ?? [];
    return { ok: true, status: 200, json: async () => ({ query: { pages: files.map((f) => ({ title: f.title, imageinfo: [{ sha1: f.sha1, url: `https://cdn.deadlock.wiki/${encodeURIComponent(f.title)}`, timestamp: f.ts ?? '' }] })) } }) };
  }
  if (String(url).includes('api.php')) {
    const titles = new URL(url).searchParams.get('titles').split('|');
    const page = (title) => (title.startsWith('File:')
      ? (wikiMissing.has(title) ? { title, missing: true } : { title, revisions: [{ revid: 1 }], imageinfo: [{ sha1: wikiSha(title), url: `https://cdn.deadlock.wiki/${encodeURIComponent(title)}` }] })
      : { title, revisions: [{ revid: 1 }] });
    return { ok: true, status: 200, json: async () => ({ query: { pages: titles.map(page) } }) };
  }
  if (String(url).includes('cdn.deadlock.wiki')) {
    if (failDownloads) return { ok: false, status: 500, headers: { get: () => null }, body: null };
    return { ok: true, status: 200, arrayBuffer: async () => PNG };
  }
  return { ok: true, status: 200, json: async () => [] };
};
deps.run = (label) => { commands.push(label); return true; };
test.after(() => { global.fetch = realFetch; });

const start = async (stamp) => {
  urls = []; commands = [];
  fs.mkdirSync(path.dirname(STAMP), { recursive: true });
  fs.writeFileSync(STAMP, JSON.stringify(stamp));
  const log = console.log;
  const out = [];
  console.log = (...args) => out.push(args.join(' '));
  try { await main(); } finally { console.log = log; }
  return out.join('\n');
};
const faces = [...roster().map((n) => n.toLowerCase()), 'silver wolf'].flatMap((h) => [`farm/rivals/${h}_gloat.png`, `farm/rivals/${h}_critical.png`]);
const noFiles = Object.fromEntries([...HEROES.flatMap((h) => [`heroes/${h.slug}.png`, `heroes/full body/${h.slug}.png`]), ...faces].map((rel) => [rel, { sha1: null }]));
const seen = Object.fromEntries(TRIVIA_TITLES.map((t) => [t, 1]));

test('same day, a hero the wiki has no lines for yet: no request, no trivia run', async () => {
  writeLines(NO_LINES);
  await start({ day: today, edits: { trivia: seen, farm: {} }, files: noFiles });
  assert.deepStrictEqual(urls, []);
  assert.deepStrictEqual(commands, []);
});

test('a new day runs the daily check', async () => {
  await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: noFiles });
  assert.ok(urls.some((u) => u.includes('api.php')));
});

test('a hero the stamp has never seen runs the daily check today', async () => {
  const { [`${NO_LINES}/Voice lines`]: _, ...rest } = seen;
  await start({ day: today, edits: { trivia: rest, farm: {} }, files: noFiles });
  assert.ok(urls.some((u) => u.includes('api.php')));
  assert.ok(commands.some((c) => c.startsWith('Trivia')));
});

// ---- Step 2: hero icons and renders by the wiki's sha1
const filesOf = (stamp) => stamp.files;
const readStamp = () => JSON.parse(fs.readFileSync(STAMP, 'utf8'));
const abrams = { icon: 'heroes/abrams.png', render: 'heroes/full body/abrams.png' };
const recorded = (sha) => ({ ...noFiles, [abrams.icon]: { title: 'File:Abrams.png', sha1: sha(`File:Abrams.png`) }, [abrams.render]: { title: 'File:Abrams Render.png', sha1: sha('File:Abrams Render.png') } });
const everyoneElse = (sha) => Object.fromEntries(HEROES.filter((h) => h.name !== 'Abrams').flatMap((h) => [[`heroes/${h.slug}.png`, `File:${h.name}.png`], [`heroes/full body/${h.slug}.png`, `File:${h.name} Render.png`]]).map(([rel, title]) => [rel, { title, sha1: sha(title) }]));
const upToDate = () => ({ ...recorded(wikiSha), ...everyoneElse(wikiSha) });
const reset = () => { discord = []; discordFails = new Set(); serverEmojis = HEROES.map((h, i) => ({ id: String(i + 1), name: h.slug })); delete process.env.DISCORD_TOKEN; categories = {}; wikiMissing = new Set(['File:Violet gloat.png', 'File:Violet ciritcal.png']); wikiSha = (t) => `sha-${t}`; failDownloads = false; };
const downloads = () => urls.filter((u) => u.includes('cdn.deadlock.wiki'));

test('an unchanged sha1 downloads nothing', async () => {
  reset();
  writeLines(null);
  await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: upToDate() });
  assert.deepStrictEqual(downloads(), []);
});

test('a changed sha1 downloads that one file and records the new sha1', async () => {
  reset();
  writeLines(null);
  const old = upToDate();
  old[abrams.icon].sha1 = 'old';
  await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: old });
  assert.strictEqual(downloads().length, 1);
  assert.strictEqual(readStamp().files[abrams.icon].sha1, wikiSha('File:Abrams.png'));
  assert.notStrictEqual(fs.readFileSync(path.join(A, abrams.icon), 'utf8'), 'x'); // the old placeholder was replaced
});

test('a failed download keeps the old sha1, and the next start tries again', async () => {
  reset();
  const old = upToDate();
  old[abrams.render].sha1 = 'old';
  failDownloads = true;
  await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: old });
  assert.strictEqual(readStamp().files[abrams.render].sha1, 'old');
  assert.notStrictEqual(readStamp().day, today); // the day isn't counted
  failDownloads = false;
  await start(readStamp());
  assert.strictEqual(readStamp().files[abrams.render].sha1, wikiSha('File:Abrams Render.png'));
});

test('a file the wiki has nothing for is recorded as null and not downloaded, nor asked again the same day', async () => {
  reset();
  wikiMissing.add('File:Abrams Render.png');
  const old = upToDate();
  delete old[abrams.render];
  await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: old });
  assert.deepStrictEqual(downloads(), []);
  assert.strictEqual(readStamp().files[abrams.render].sha1, null);
  await start(readStamp());
  assert.deepStrictEqual(urls, []);
});

test('the first run (no records) downloads and replaces every icon; a render equal to the wiki file is only recorded', async () => {
  reset();
  const sameAsWiki = path.join(A, abrams.render);
  const bytes = Buffer.from('render');
  fs.writeFileSync(sameAsWiki, bytes);
  wikiSha = (t) => (t === 'File:Abrams Render.png' ? require('node:crypto').createHash('sha1').update(bytes).digest('hex') : `sha-${t}`);
  await start({ day: today, edits: { trivia: seen, farm: {} } }); // today, but no file records: runs anyway
  assert.strictEqual(downloads().length, HEROES.length * 2 - 1);
  assert.ok(readStamp().files[abrams.render].sha1);
});

test('toSquarePng: trimmed, 128 x 128, transparent corners', async () => {
  const { loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(await toSquarePng(PNG));
  assert.deepStrictEqual([img.width, img.height], [128, 128]);
  const c = createCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  assert.strictEqual(ctx.getImageData(0, 0, 1, 1).data[3], 0);
  assert.strictEqual(ctx.getImageData(64, 64, 1, 1).data[3], 255);
});

// ---- Step 3: rival portraits from the wiki's categories
test('the wiki messy portrait names find their hero', () => {
  const names = {
    'File:Mirage Gloat .png': 'mirage', 'File:Bily Critical.png': 'billy', 'File:Doorman Gloat.png': 'the doorman',
    'File:Silver Gloat Portrait.png': 'silver', 'File:Werewolf Silver Critical.png': 'silver wolf', 'File:Celeste Critical Health.png': 'celeste',
    'File:Haze Gloat.png': 'haze', 'File:Nobody Yet Gloat.png': null,
  };
  for (const [title, hero] of Object.entries(names)) assert.strictEqual(heroOfPortrait(title), hero, title);
});

test('portraits: the newest upload wins, Violet comes from the table, a hero without one gets sha1 null', () => {
  const cats = {
    'Gloat Portraits': [{ title: 'File:Haze Gloat.png', sha1: 'old', ts: '2025' }, { title: 'File:Haze Portrait Gloat.png', sha1: 'old2', ts: '2024' }, { title: 'File:Haze Gloat Portrait.png', sha1: 'new', ts: '2026' }, { title: 'File:Zed Gloat.png', sha1: 'z', ts: '1' }],
    'Critical Health Portraits': [],
  };
  const { files, strays } = portraitFiles(cats, { 'File:Violet gloat.png': { sha1: 'v', url: 'u' }, 'File:Violet ciritcal.png': { sha1: null } });
  assert.strictEqual(files['farm/rivals/haze_gloat.png'].sha1, 'new');
  assert.strictEqual(files['farm/rivals/violet_gloat.png'].sha1, 'v');
  assert.strictEqual(files['farm/rivals/violet_critical.png'].sha1, null);
  assert.strictEqual(files['farm/rivals/nurse harrow_gloat.png'].sha1, null);
  assert.deepStrictEqual(strays, ['File:Zed Gloat.png']);
});

test('a portrait is downloaded from the category; a hero the wiki has none for keeps the local file', async () => {
  reset();
  categories = { 'Gloat Portraits': [{ title: 'File:Haze Gloat.png', sha1: 'h1' }], 'Critical Health Portraits': [] };
  fs.mkdirSync(path.join(A, 'farm', 'rivals'), { recursive: true });
  fs.writeFileSync(path.join(A, 'farm', 'rivals', 'nurse harrow_gloat.png'), 'mine');
  await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: upToDate() });
  assert.strictEqual(downloads().length, 1);
  assert.strictEqual(readStamp().files['farm/rivals/haze_gloat.png'].sha1, 'h1');
  assert.strictEqual(readStamp().files['farm/rivals/nurse harrow_gloat.png'].sha1, null);
  assert.strictEqual(fs.readFileSync(path.join(A, 'farm', 'rivals', 'nurse harrow_gloat.png'), 'utf8'), 'mine');
});

test('a duel against a wolf-form Silver has wolf: true on her entry, and the face is the wolf face', async () => {
  const { duel } = require('../src/utils/farm/encounter');
  const { duelResultView } = require('../src/utils/farm/views');
  const kit = { boons: 24, unlocked: 4, points: 20, tiers: { 1: 2, 2: 2, 3: 2, 4: 2 }, items: [], buffs: {} };
  let s = 5;
  const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const run = duel('Abrams', { ...kit, boons: 30 }, 'Silver', kit, { rng });
  assert.ok(run.frames.some((f) => f.enemies[0].wolf === true), 'she turns into the wolf');
  assert.ok(!run.frames[0].enemies[0].wolf, 'not at the start');
  const real = path.join(__dirname, '..', 'assets', 'farm', 'rivals', 'silver wolf_gloat.png');
  const made = !fs.existsSync(real);
  if (made) fs.writeFileSync(real, 'x');
  try {
    const frame = { ...run.frames[run.frames.length - 1], enemies: [{ ...run.frames[0].enemies[0], wolf: true }] };
    const lost = { ...run, won: false, timedOut: false, frames: [frame] };
    assert.match(String((await duelResultView(lost)).files[1].attachment), /silver wolf_gloat\.png$/);
    frame.enemies[0].wolf = false;
    assert.doesNotMatch(String((await duelResultView(lost)).files[1].attachment), /wolf/);
  } finally { if (made) fs.unlinkSync(real); }
});

// ---- Step 4: emojis follow the icon
const withToken = async (run) => { process.env.DISCORD_TOKEN = 'test-token'; try { await run(); } finally { delete process.env.DISCORD_TOKEN; } };
const changedIcon = () => { const f = upToDate(); f[abrams.icon].sha1 = 'old'; return f; };

test('a hero with no emoji in the server gets one uploaded', async () => {
  reset();
  serverEmojis = serverEmojis.filter((e) => e.name !== 'abrams');
  await withToken(() => start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: upToDate() }));
  assert.deepStrictEqual(discord, ['GET /guilds/1553860143639167086/emojis', 'POST /guilds/1553860143639167086/emojis']);
});

test('an icon changed from a recorded sha1 replaces its emoji: POST, then DELETE; the sha1 is recorded after', async () => {
  reset();
  await withToken(() => start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: changedIcon() }));
  assert.deepStrictEqual(discord.slice(1), ['POST /guilds/1553860143639167086/emojis', 'DELETE /guilds/1553860143639167086/emojis/ID']);
  assert.strictEqual(readStamp().files[abrams.icon].sha1, wikiSha('File:Abrams.png'));
});

test('the first run (no records) replaces no emoji', async () => {
  reset();
  await withToken(() => start({ day: today, edits: { trivia: seen, farm: {} } }));
  assert.deepStrictEqual(discord, ['GET /guilds/1553860143639167086/emojis']);
  assert.ok(readStamp().files[abrams.icon].sha1); // recorded all the same
});

test('a failed replace does not record the new icon sha1, so the next start tries again', async () => {
  reset();
  discordFails.add('POST');
  await withToken(() => start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: changedIcon() }));
  assert.strictEqual(readStamp().files[abrams.icon].sha1, 'old');
  assert.notStrictEqual(readStamp().day, today);
  assert.ok(!discord.some((c) => c.startsWith('DELETE'))); // the old emoji stays
});

test('without a DISCORD_TOKEN there are no Discord calls and the icon is recorded', async () => {
  reset();
  await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: changedIcon() });
  assert.deepStrictEqual(discord, []);
  assert.strictEqual(readStamp().files[abrams.icon].sha1, wikiSha('File:Abrams.png'));
});

// ---- Step 6: the summary
test('a quiet same-day start prints one line', async () => {
  reset();
  writeLines(NO_LINES);
  const out = await start({ day: today, edits: { trivia: seen, farm: {} }, files: noFiles });
  assert.strictEqual(out, 'Startup check: nothing to do (the daily check ran today).');
});

test('the daily summary groups what happened: a hero without voice lines is Waiting on the wiki', async () => {
  reset();
  writeLines(NO_LINES);
  const out = await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: upToDate() });
  assert.ok(out.includes('Waiting on the wiki:\n    - Trivia voice lines not written on the wiki yet: Nurse Harrow'), out);
  assert.doesNotMatch(out, /Fetched|Could not reach/);
});

test('the summary lists what was fetched and what could not be reached', async () => {
  reset();
  failDownloads = true;
  const out = await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: changedIcon() });
  assert.ok(out.includes("Could not reach:\n    - Abrams's icon"), out);
  reset();
  const ok = await start({ day: '2000-01-01', edits: { trivia: seen, farm: {} }, files: changedIcon() });
  assert.ok(ok.includes("Fetched:\n    - Images from the wiki (1): Abrams's icon"), ok);
});
