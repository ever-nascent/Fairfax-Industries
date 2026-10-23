// Hero Farming: downloads the wiki data the farm runs on into assets/farm (run `npm run farm-data`; re-run after a game
// patch or to add heroes). Touches nothing in Discord and nothing in data/. Credits: assets/CREDITS.txt.
//   heroes.json    the starter heroes' stats (Data:HeroData.json)
//   abilities.json their abilities (Data:AbilityData.json)
//   items.json     every shop item, tiers 1-4 (Data:ItemCards.json)
//   legendaries.json  the Tier 5 legendaries (Street Brawl's; the wiki has no cards for them), from the game's own item list on
//                  deadlock-api.com (unofficial), in the wiki's card shape: innate stats in an Innate Info, each other effect in its own Info
//   npcs.json      the farm targets (Data:NpcData.json) + the wiki's structure soul values (Data:GenericData.json)
//   icons/         target icons, haunts/  Haunt portraits, buffs/  the permanent buff pictures (deadlock.wiki files)
const fs = require('node:fs/promises');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const path = require('node:path');
const { ASSETS } = require('../art');
const { wikiFetch } = require('../wikiFetch');

const WIKI = 'https://deadlock.wiki';
const OUT = path.join(ASSETS, 'farm');
const FARM_HEROES = ['Mina', 'Haze', 'Celeste', 'Paige', 'Abrams', // the starter 5, his pick, Oct 1
  'Apollo', 'Bebop', 'Billy', 'Calico', 'The Doorman', 'Drifter', 'Dynamo', 'Graves', 'Grey Talon', 'Holliday', 'Infernus', 'Ivy', 'Kelvin', 'Lady Geist', 'Lash', 'McGinnis', 'Mirage', 'Mo & Krill', 'Paradox', 'Pocket', 'Rem', 'Seven', 'Shiv', 'Silver', 'Sinclair', 'Venator', 'Victor', 'Vindicta', 'Viscous', 'Vyper', 'Warden', 'Wraith', 'Yamato', // then the rest A to Z, one at a time (his call, Oct 3; each added with addHero below)
  'Baba', 'Rat King', 'Solomon', 'Deadman Danny', 'Nurse Harrow', 'Violet']; // the City Never Sleeps heroes, as they come out (Oct 10, Danny Oct 16, Harrow and Violet Oct 20; the wiki still flags them InDevelopment, so a selectable one counts as live)

// Target icons: the minimap camp icons (small / medium / large), each boss's / structure's own icon, and for Crate and Sinner's
// Sacrifice (the wiki has no icons for them) a square crop of its picture (CROPS) so it fits an embed thumbnail.
// icons/base-guardian.png, shrine.png, patron.png, patron-weakened.png and trooper*.png (the renders he supplied Oct 3, their background cut off) and icons/lane-*.png (the lane badges from his picture) are not
// downloaded either, so a refresh leaves them. icons/golden-statue.png is not downloaded: it is the owl statue picture he supplied (Oct 1), kept at its own proportions, so a refresh leaves it.
const ICONS = {
  'small-camp': 'MapEasyCampIcon.png', 'medium-camp': 'MapMediumCampIcon.png', 'large-camp': 'MapHardCampIcon.png',
  crate: 'Fairfax_crates.png', 'tough-crate': 'Tough_Crate.png', 'sinners-sacrifice': "Sinner's_Sacrifice_machine.png", 'mid-boss': 'Midboss.png',
  guardian: 'Guardian_Icon.png', walker: 'Walker_Icon.png',
};

// Haunt portraits (Haunts page): family -> size -> file. A camp's family depends on its district in the game; a fight picks
// a random family that has the camp's size.
const HAUNTS = {
  crabbage_pot: { small: 'Neutral_plant_weak.png', medium: 'Neutral_plant_normal.png', large: 'Neutral_plant_heavy.png' },
  gutter_ghoul: { small: 'Neutral_drain_creature_weak.png', medium: 'Neutral_drain_creature_normal.png', large: 'Neutral_drain_creature_strong.png' },
  specimen: { small: 'Neutral_specimen_weak.png', medium: 'Neutral_specimen_normal.png' },
  past_due: { small: 'Neutral_book_weak.png', medium: 'Neutral_book_normal.png' },
  barrel_mimic: { medium: 'Neutral_barrel_normal.png', large: 'Neutral_barrel_heavy.png' },
  festival_spirit: { medium: 'Neutral_lantern_normal.png', large: 'Neutral_lantern_strong.png' },
  slum_shroom: { medium: 'Neutral_mushroom_normal.png', large: 'Neutral_mushroom_heavy.png' },
  stage_hand: { medium: 'Neutral_stagehand_normal.png', large: 'Neutral_stagehand_heavy.png' },
  underhand: { medium: 'Neutral_underground_normal.png', large: 'Neutral_underground_heavy.png' },
};

// [x, y, size] of the square to keep from a downloaded picture
const CROPS = { crate: [366, 112, 160], 'tough-crate': [48, 0, 388], 'sinners-sacrifice': [60, 250, 440] };

// The buff pictures (the wiki's "Permanent Buff" tomes). Which tome is which buff is from the game's own data (Data:MiscData.json,
// each pickup's model), not from the file names: the "damage" tome is Fire Rate, "weapon" is Max Ammo and "battle" is Weapon Damage.
const BUFF_TOMES = {
  fireRate: 'Powerup_damage_tome.webp', maxAmmo: 'Powerup_weapon_tome.webp', cooldownReduction: 'Powerup_cooldown_tome.webp',
  weaponDamage: 'Powerup_battle_tome.webp', maxHealth: 'Powerup_health_tome.webp', spiritPower: 'Powerup_spirit_tome.webp',
  bulletResist: 'Powerup_armor_tome.webp', spiritResist: 'Powerup_spiritresist_tome.webp', moveSpeed: 'Powerup_movespeed_tome.webp',
  abilityRange: 'Powerup_spiritrange_tome.webp',
};

// bridge/<key>.png: the minimap icons of the four bridge buffs (buffs.js `BRIDGE`)
const BRIDGE_ICONS = { casting: 'Powerup_spirit.png', gun: 'Powerup_gun.png', movement: 'Powerup_movement.png', survival: 'Powerup_survival.png' };

const NPC_KEYS = ['neutral_trooper_weak', 'neutral_trooper_normal', 'neutral_trooper_strong', 'neutral_sinners_sacrifice',
  'npc_boss_tier1', 'npc_boss_tier2', 'npc_boss_tier3', 'npc_barrack_boss', 'npc_super_neutral', 'destroyable_building',
  'trooper_normal', 'trooper_melee', 'trooper_medic']; // the lane troopers (waves)

// the wiki's firewall blocks some user agents (e.g. a browser one with "bot" in it); this plain one works. Wiki requests are paced (wikiFetch).
const UA = 'FairfaxBot/1.0';
const get = (url) => (new URL(url).host.endsWith('deadlock.wiki') ? wikiFetch(url, { userAgent: UA }) : fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': UA } }));
// Pictures already in assets/farm are kept (Oct 16: the daily startup check runs this; they rarely change); `--all` downloads every one again.
const ALL = process.argv.includes('--all');
const have = (dir, name) => require('node:fs').existsSync(path.join(OUT, dir, name));
// A Data: page's JSON through the wiki's API (Oct 16: index.php?action=raw started answering 403 to this user agent; api.php still answers it).
const raw = async (page) => {
  const res = await get(`${WIKI}/api.php?${new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', formatversion: 2, format: 'json', titles: page })}`);
  if (!res.ok) throw new Error(`deadlock.wiki answered ${res.status} for ${page}`);
  const content = (await res.json()).query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
  if (content === undefined) throw new Error(`deadlock.wiki sent no ${page}`);
  return JSON.parse(content);
};
const save = (file, data) => fs.writeFile(path.join(OUT, file), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

const SLOT_NAMES = { weapon: 'Weapon', vitality: 'Armor', spirit: 'Tech' }; // deadlock-api's slot -> the wiki's
async function legendaries() {
  const api = await (await get('https://api.deadlock-api.com/v1/assets/items/by-type/upgrade')).json();
  const num = (p) => { const v = parseFloat(p?.value); return Number.isFinite(v) ? v : null; };
  const type = (i, sec) => ({ innate: 'Innate', active: 'Active', passive: 'Passive' })[sec.section_type] ?? (i.is_active_item ? 'Active' : 'Passive');
  return Object.fromEntries(api.filter((i) => i.shopable && !i.disabled && i.item_tier === 5).map((i) => {
    const card = { Key: i.class_name, Name: i.name, Description: i.description?.desc ?? null, Cost: i.cost, Tier: 5, Slot: SLOT_NAMES[i.item_slot_type],
      Activation: i.is_active_item ? 'Active' : 'Passive', Components: null, StreetBrawl: true };
    (i.tooltip_sections ?? []).forEach((sec, n) => {
      const keys = sec.section_attributes.flatMap((a) => [...(a.properties ?? []), ...(a.elevated_properties ?? []), ...(a.important_properties ?? [])]);
      const scale = (k) => { const f = i.properties[k]?.scale_function; return f?.specific_stat_scale_type === 'ETechPower' && f.stat_scale ? { Scale: { Value: f.stat_scale, Type: 'spirit' } } : {}; }; // x spirit power (Nullification Burst, Prism Blast, Shadow Strike)
      const lines = [...new Set(keys)].map((k) => ({ Key: k, Value: num(i.properties[k]), Label: i.properties[k]?.label ?? k, // the game's own label, sign and unit (shown on a drop)
        Prefix: i.properties[k]?.prefix ?? '', Postfix: i.properties[k]?.postfix ?? '', ...scale(k) })).filter((l) => l.Value !== null);
      card[`Info${n + 1}`] = { Type: type(i, sec), DescKey: null, Cooldown: num(i.properties.AbilityCooldown), ChargeUp: null, Main: lines, Alt: [] };
    });
    return [i.class_name, card];
  }));
}

// wiki file name -> download url, for up to 50 files per request
async function fileUrls(files) {
  const urls = {};
  for (let i = 0; i < files.length; i += 50) {
    const titles = files.slice(i, i + 50).map((f) => `File:${f}`).join('|');
    const url = `${WIKI}/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&format=json`;
    const { query } = await (await get(url)).json();
    const alias = Object.fromEntries((query.normalized || []).map((n) => [n.to, n.from])); // the wiki's title -> ours
    for (const p of Object.values(query.pages)) if (p.imageinfo) urls[alias[p.title] || p.title] = p.imageinfo[0].url;
  }
  return urls;
}

// Downloads { savedName: wikiFile } into `dir` (only the missing ones, unless --all); returns how many are there now (missing ones
// are reported). The names saved this time go into `saved`.
async function download(dir, files, saved = []) {
  await fs.mkdir(path.join(OUT, dir), { recursive: true });
  const wanted = Object.entries(files).filter(([name]) => ALL || !have(dir, name));
  const urls = wanted.length ? await fileUrls(wanted.map(([, file]) => file)) : {};
  let ok = Object.keys(files).length - wanted.length;
  for (const [name, file] of wanted) {
    const url = urls[`File:${file}`];
    if (!url) { console.log(`[FAIL] ${name}: no File:${file} on the wiki`); continue; }
    await fs.writeFile(path.join(OUT, dir, name), Buffer.from(await (await get(url)).arrayBuffer()));
    saved.push(name);
    ok++;
  }
  return ok;
}

// rivals/<hero>_gloat.png and <hero>_critical.png: the portraits an encounter's rival shows when it wins and when it is beaten (his OK, Oct 3).
// The wiki names them "<Hero> Gloat" / "<Hero> Critical", with the odd exception.
const RIVAL_FILES = { Celeste: { critical: 'Celeste_Critical_Health.png' }, Violet: { gloat: 'Violet_gloat.png', critical: 'Violet_ciritcal.png' } }; // Violet's as the wiki spells them (Oct 20)
const rivalArt = () => download('rivals', Object.fromEntries(FARM_HEROES.flatMap((name) => [['gloat', 'Gloat'], ['critical', 'Critical']]
  .map(([key, word]) => [`${name.toLowerCase()}_${key}.png`, RIVAL_FILES[name]?.[key] ?? `${name}_${word}.png`]))));

// A hero's second form (Silver's wolf): the wiki lists it as a hero of its own. Its entry is kept on the hero as `OtherForm`, its abilities with the rest.
const FORMS = { Silver: 'Silver (Transformed)' };
const withForm = (hero, list) => (FORMS[hero.Name] ? { ...hero, OtherForm: list.find((x) => x.Name === FORMS[hero.Name]) } : hero);
const slotsOf = (hero) => [...Object.values(hero.BoundAbilities), ...Object.values(hero.OtherForm?.BoundAbilities ?? {})];

// Adds one hero's wiki data (stats and abilities) to heroes.json / abilities.json without touching anything else: a new hero joins without a
// full refresh moving the other heroes' numbers under the tuning. Put the name in FARM_HEROES too, so the next full refresh keeps it.
// node -e "require('./src/utils/farm/refresh').addHero('Apollo')"
async function addHero(name) {
  const list = Object.values(await raw('Data:HeroData.json'));
  const found = list.find((x) => x.Name === name);
  if (!found || found.IsDisabled || (found.InDevelopment && !found.IsSelectable)) throw new Error(`${name}: not a live hero in the wiki's HeroData`);
  const hero = withForm(found, list);
  const all = await raw('Data:AbilityData.json');
  const read = async (file) => JSON.parse(await fs.readFile(path.join(OUT, file), 'utf8'));
  const [heroes, abilities] = [await read('heroes.json'), await read('abilities.json')];
  heroes[name] = hero;
  for (const slot of slotsOf(hero)) {
    if (!all[slot.Key]) throw new Error(`${name}: no ability data for ${slot.Key}`);
    abilities[slot.Key] = all[slot.Key];
  }
  await Promise.all([save('heroes.json', heroes), save('abilities.json', abilities)]);
  const w = hero.Weapon;
  console.log(`[ok] ${name}: ${hero.MaxHealth} HP, ${w.BulletDamage} x ${w.RoundsPerSecond.toFixed(1)}/s, clip ${w.ClipSize}, reload ${w.ReloadTime}s, ${Math.round(w.DPS)} DPS; ${Object.values(hero.BoundAbilities).map((s) => all[s.Key].Name).join(', ')}`);
}

// What a refresh would change in one saved file: the keys (heroes, abilities, items ...) whose data differs, added or removed.
async function changedKeys(file, next) {
  const old = await fs.readFile(path.join(OUT, file), 'utf8').then(JSON.parse, () => ({}));
  return [...new Set([...Object.keys(old), ...Object.keys(next)])].filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]));
}

async function refresh() {
  await fs.mkdir(OUT, { recursive: true });
  const heroData = Object.values(await raw('Data:HeroData.json'));
  const heroes = {};
  const failed = []; // the game numbers are saved only when every one of them came down (Start Bot runs this on its own, Oct 16)
  for (const name of FARM_HEROES) {
    const h = heroData.find((x) => x.Name === name);
    if (!h || h.IsDisabled || (h.InDevelopment && !h.IsSelectable)) { console.log(`[FAIL] ${name}: not a live hero in the wiki's HeroData`); failed.push(name); continue; }
    heroes[name] = withForm(h, heroData);
    const w = h.Weapon;
    console.log(`[ok] ${name} (${h.Type}): ${h.MaxHealth} HP, ${w.BulletDamage} x ${w.RoundsPerSecond.toFixed(1)}/s, clip ${w.ClipSize}, reload ${w.ReloadTime}s, ${Math.round(w.DPS)} DPS`);
  }
  const allAbilities = await raw('Data:AbilityData.json');
  const abilities = {};
  for (const hero of Object.values(heroes)) {
    for (const slot of slotsOf(hero)) {
      if (allAbilities[slot.Key]) abilities[slot.Key] = allAbilities[slot.Key];
      else { console.log(`[FAIL] ${slot.Name}: no ability data on the wiki`); failed.push(slot.Name); }
    }
  }
  const cards = await raw('Data:ItemCards.json');
  const items = Object.fromEntries(Object.entries(cards).filter(([, c]) => c.Name && !c.IsDisabled && [1, 2, 3, 4].includes(c.Tier)));
  const allNpcs = await raw('Data:NpcData.json');
  const npcs = { npcs: Object.fromEntries(NPC_KEYS.map((k) => [k, allNpcs[k]])), objectives: (await raw('Data:GenericData.json')).ObjectiveParams };
  const legends = await legendaries();
  if (!Object.keys(legends).length) failed.push('the legendaries (deadlock-api.com)');
  if (Object.keys(items).length < 100) failed.push(`only ${Object.keys(items).length} items (expected about 150)`);
  if (failed.length) {
    console.log(`\nNOTHING WAS SAVED. The download has problems: ${failed.join(', ')}`);
    return false;
  }
  const data = { 'heroes.json': heroes, 'abilities.json': abilities, 'items.json': items, 'npcs.json': npcs, 'legendaries.json': legends };
  for (const [file, next] of Object.entries(data)) {
    const changed = await changedKeys(file, next);
    console.log(changed.length ? `Changed in ${file} (${changed.length}): ${changed.slice(0, 12).join(', ')}${changed.length > 12 ? ', ...' : ''}` : `No changes in ${file}`);
  }
  await Promise.all(Object.entries(data).map(([file, next]) => save(file, next)));

  const fresh = [];
  const icons = await download('icons', Object.fromEntries(Object.entries(ICONS).map(([k, f]) => [`${k}.png`, f])), fresh);
  for (const [key, [x, y, size]] of Object.entries(CROPS).filter(([k]) => fresh.includes(`${k}.png`))) { // only a picture just downloaded is cropped
    const file = path.join(OUT, 'icons', `${key}.png`);
    const out = createCanvas(Math.min(size, 256), Math.min(size, 256));
    out.getContext('2d').drawImage(await loadImage(file), x, y, size, size, 0, 0, out.width, out.height);
    await fs.writeFile(file, out.toBuffer('image/png'));
  }
  const haunts = await download('haunts', Object.fromEntries(Object.entries(HAUNTS).flatMap(([fam, sizes]) => Object.entries(sizes).map(([size, f]) => [`${fam}_${size}.png`, f]))));
  // buffs/<key>.png: the tomes are 512 px webp files, kept as 256 px PNGs
  await fs.mkdir(path.join(OUT, 'buffs'), { recursive: true });
  const tomesWanted = Object.entries(BUFF_TOMES).filter(([key]) => ALL || !have('buffs', `${key}.png`));
  const tomeUrls = tomesWanted.length ? await fileUrls(tomesWanted.map(([, file]) => file)) : {};
  let tomes = Object.keys(BUFF_TOMES).length - tomesWanted.length;
  for (const [key, file] of tomesWanted) {
    const url = tomeUrls[`File:${file}`];
    if (!url) { console.log(`[FAIL] ${key}: no File:${file} on the wiki`); continue; }
    const img = await loadImage(Buffer.from(await (await get(url)).arrayBuffer()));
    const out = createCanvas(256, 256);
    out.getContext('2d').drawImage(img, 0, 0, 256, 256);
    await fs.writeFile(path.join(OUT, 'buffs', `${key}.png`), out.toBuffer('image/png'));
    tomes++;
  }
  await download('bridge', Object.fromEntries(Object.entries(BRIDGE_ICONS).map(([k, f]) => [`${k}.png`, f])));
  await rivalArt();
  const haunt = Object.values(HAUNTS).reduce((n, sizes) => n + Object.keys(sizes).length, 0);
  console.log(`\nSaved ${Object.keys(heroes).length}/${FARM_HEROES.length} heroes, ${Object.keys(abilities).length} abilities, ${Object.keys(items).length} items, ${Object.keys(legends).length} legendaries, ${NPC_KEYS.length} farm targets, ${icons}/${Object.keys(ICONS).length} icons, ${haunts}/${haunt} Haunt portraits, ${tomes}/${Object.keys(BUFF_TOMES).length} buff pictures to ${OUT}`);
  const ok = Object.keys(heroes).length === FARM_HEROES.length && Object.keys(legends).length > 0 && icons === Object.keys(ICONS).length && haunts === haunt && tomes === Object.keys(BUFF_TOMES).length;
  console.log(ok ? 'Checkpoint: compare the numbers above with each hero\'s wiki page' : 'FAILED: see the FAIL lines above');
  return ok;
}

module.exports = { refresh, addHero, rivalArt, FARM_HEROES, ICONS, HAUNTS, BUFF_TOMES };

// exitCode, not process.exit(): exiting with a download still open crashes Node on Windows ("Assertion failed: ... UV_HANDLE_CLOSING", Oct 16)
if (require.main === module) refresh().then((ok) => { process.exitCode = ok ? 0 : 1; }, (e) => { console.error(`NOTHING WAS SAVED. ${e.message}`); process.exitCode = 1; });
