// Hero Farming, the member side: their farm record (hero, cooldowns, Rejuvs), and one trip. `play` claims the cooldown, runs the whole
// fight at once, pays the souls, and hands back snapshots the command replays as a live message. Rules: server-plan.md ("Hero Farming").
//   record (data/farm.json, per member). The member's own: { hero (the current one), bestWave: the most waves cleared in one run,
//   tokens: Character Unlock Tokens held, siegeTokens: [heroes whose siege win already paid a token] }
//   Each hero's own (his calls, Oct 2 and Oct 11: "for longevity", so a member can switch heroes and keep playing): heroes: { <hero name>: {
//   souls: its own souls (trips, roams, egg hatches and sell-backs pay into them, its items and corruption are bought with them; never the server balance),
//   earned: souls its trips have paid (hero level, levels.js), tiers: { <ability slot>: tier 0-3 },
//   items: { weapon | vitality | spirit: [item names] } (the 12 slots), legendary (the one in the legendary slot), legendaries: [every legendary it
//   has got], corrupted: { name, drawback, amount } (its one corrupted item, stats.js),
//   imbues: { <item name>: ability slot }, egg: souls its Golden Goose Egg has grown (wiki souls), giftTime: fight seconds towards the next
//   Eternal Gift buff, gifts: { <buff key>: count } (Eternal Gift's permanent buffs), kept: { <item>: stacks } (Glass Cannon's and Trophy Collector's kill stacks, kept until the hero dies),
//   cooldowns: { <target | '<guardian | walker | waves>:<lane>' | 'siege' | 'roam'>: ms timestamp it is ready again },
//   down: { '<guardian | walker>:<lane>': ms timestamp until which it stays beaten } (the lanes, below), clears: { <target>: times cleared },
//   rejuvs, buffs: { <buff key>: how many it holds } (permanent, from roaming; buffs.js), bridge: [bridge buff keys held for its next fight] } }.
//   In the code the current hero's part sits on the record itself (`load` below).
// The cooldown is claimed (and the result is known) when they press Send, so a restart mid-replay never loses or repeats a payout.
const path = require('node:path');
const { getStore } = require('../../storage');
const { ASSETS } = require('../art');
const ledger = require('../soulsLedger');
const { pickRandom } = require('../random');
const { buildHero, roster } = require('./hero');
const { TARGETS, SIEGE, WAVES, WAVE, wavesPay, LANES, LANED, WALKER_STEP, payout, runStages, clearSouls, strengthen, CLEAR_CAP } = require('./targets');
const { roam, COOLDOWN: ROAM_COOLDOWN } = require('./roam');
const { progress, pointsSpent, campMultiplier, TIER_COSTS, MAX_TIER, SLOTS, MAX_ITEMS, countItems, priceFor, heldIn, rollLegendary, SIEGE_LEGENDARY_CHANCE, LEGENDARY_NAMES, SLOT_OF, ITEM_POOL, itemsOf, sellPrice,
  brokerOpen, brokerNext, corruptible, corruptPrice, rollDrawback } = require('./levels');
const { itemByName, effectValue } = require('./stats');
const { IMBUES, NO_ULT_IMBUE, keptAfter } = require('./items');
const { rollAnyBuff } = require('./buffs');
const { PAYOUT_SCALE } = require('./targets');
const { rollRival, rivalKit, duel, ENCOUNTER_CHANCE } = require('./encounter');
const { specialFor } = require('./haunts');
const { HAUNTS } = require('./refresh'); // the Haunt families live with the download list that fetches their pictures

const MAX_REJUVS = 3; // like the game's 3 credits per Mid-Boss kill; placeholder until he decides
const FRAME_STEPS = 30; // a snapshot every 3 seconds of fight
const MAX_FRAMES = 14; // the live message plays back at most this many snapshots (3 s apart on screen)
const DESCEND_SECONDS = 300; // a /descend room nobody has won by then counts as lost (descent.js)

const farm = () => getStore('farm');
const blankRecord = () => ({ hero: null, heroes: {}, tokens: 0, siegeTokens: [] });
// Before the legendary slot (Oct 22) a legendary sat in one of the 12; it moves to its own slot.
const legendaryOut = (items) => Object.fromEntries(Object.entries(items).map(([slot, names]) => [slot, names.filter((n) => !LEGENDARY_NAMES.includes(n))]));
// One hero's saved part -> the working copy, and back (empty parts are left out of the file).
const heroPart = (mine = {}) => ({
  souls: mine.souls ?? 0, earned: mine.earned ?? 0, tiers: { ...mine.tiers }, items: legendaryOut(itemsOf(mine.items)), legendary: mine.legendary ?? null, legendaries: mine.legendaries ?? (mine.legendary ? [mine.legendary] : []), corrupted: mine.corrupted ?? null,
  imbues: { ...mine.imbues }, egg: mine.egg ?? 0, giftTime: mine.giftTime ?? 0, gifts: { ...mine.gifts }, kept: { ...(mine.glass ? { 'Glass Cannon': mine.glass } : {}), ...mine.kept }, // (`glass`: Glass Cannon's alone, Oct 22)
  cooldowns: { ...mine.cooldowns }, down: { ...mine.down }, clears: { ...mine.clears }, rejuvs: mine.rejuvs ?? 0, buffs: { ...mine.buffs }, bridge: [...(mine.bridge ?? [])],
});
const HERO_KEYS = Object.keys(heroPart());
const savedPart = (r) => Object.fromEntries(HERO_KEYS.map((k) => [k, r[k]]).filter(([k, v]) => ['earned', 'tiers', 'items'].includes(k) || (v && (typeof v !== 'object' || Object.keys(v).length))));
// Shared by all of a member's heroes until Oct 11, each hero's own since (his call). What a member had then goes to Haze (his call: the only hero
// anyone had played), or to their current hero if they have no Haze.
const SHARED_UNTIL_OCT_11 = ['cooldowns', 'down', 'clears', 'rejuvs', 'buffs', 'bridge'];
const OLD_OWNER = 'Haze';
// Saved record -> the one the code works with: the current hero's own part (`heroes[hero]`) is laid out on the record itself, so everything
// else reads and edits it there (`r.souls`, `r.items`, `r.cooldowns` ...). (The storage hands out copies, so this may be edited freely.)
function load(saved) {
  const { earned, tiers, items, midbossKills, switchedAt, ...rest } = saved ?? {}; // switchedAt: the once-a-day switch wait, gone since Oct 11
  const record = { ...blankRecord(), ...rest, heroes: { ...rest.heroes } };
  // records from before progress was per hero (Oct 2) kept the current hero's level, tiers and items on the member
  if (record.hero && !record.heroes[record.hero]) record.heroes[record.hero] = { earned, tiers, items };
  const old = Object.fromEntries(SHARED_UNTIL_OCT_11.filter((k) => k in record).map((k) => [k, record[k]]));
  for (const k of SHARED_UNTIL_OCT_11) delete record[k];
  if (midbossKills) old.clears = { ...old.clears, 'mid-boss': midbossKills }; // the first version counted only the Mid-Boss
  const owner = record.heroes[OLD_OWNER] ? OLD_OWNER : record.hero;
  if (owner && Object.keys(old).length) record.heroes[owner] = savedPart(heroPart({ ...old, ...record.heroes[owner] }));
  return { ...record, ...heroPart(record.heroes[record.hero]) };
}
// ... and back: the hero's part goes into `heroes[hero]`, the other heroes' progress is left as it was.
function unload(working) {
  const record = Object.fromEntries(Object.entries(working).filter(([k]) => !HERO_KEYS.includes(k)));
  if (record.hero) record.heroes[record.hero] = savedPart(working);
  return record;
}
const getFarmUser = async (id) => load(await farm().get(id));
// One of the member's heroes' own part (souls, level, buffs ...) to read, whether or not it is the current one.
const heroOf = (record, name) => (name === record.hero ? record : heroPart(record.heroes[name]));

// Changes one member's record inside the store lock; `change(record)` edits the copy and returns what the caller wants.
async function updateFarmUser(id, change) {
  let result;
  await farm().update(id, (current) => {
    const record = load(current);
    result = change(record);
    return unload(record);
  });
  return result;
}

// Changes one hero's own part (`change(hero, record)`), whether or not it is the current hero: a fight is settled on the hero that
// fought it, even if the member switched heroes while it was being played (switching takes no time since Oct 11).
const updateHero = (id, name, change) => updateFarmUser(id, (r) => {
  if (r.hero === name) return change(r, r);
  const part = heroPart(r.heroes[name]);
  const result = change(part, r);
  r.heroes[name] = savedPart(part);
  return result;
});

// A hero's own souls: every change is a line in the souls ledger (soulsLedger.js), tagged with the hero and that hero's souls after it.
const logSouls = (userId, hero, delta, reason, after) => ledger.record(userId, delta, { reason, hero }, after);

// Picks their first hero (free). Returns false if they already have one or it isn't pickable; more heroes: unlockHero / switchHero.
const chooseHero = (id, name) => updateFarmUser(id, (r) => {
  if (r.hero || !roster().includes(name)) return false;
  r.hero = name;
  return true;
});

// Testing switch (/farm-config): with cooldowns off every target is always Ready. Kept in memory on purpose, so a restart turns them back on.
let cooldownsOn = true;
const setCooldowns = (on) => { cooldownsOn = on; };
const cooldownsActive = () => cooldownsOn;

// ---- more heroes (his calls, Oct 2): unlock each extra one once, then switch between the unlocked ones (any time, his call Oct 11) ----
const hasHero = (record, name) => record.hero === name || !!record.heroes?.[name];

// Unlocks another hero with a Character Unlock Token (his call, Oct 2: no souls price; a token comes from each hero's first siege win).
// It starts at level 0 with nothing (no souls, buffs or Rejuvs either) and doesn't switch.
// Returns { ok: true } or { error: 'unknown' | 'no-hero' | 'owned' | 'token' }.
const unlockHero = (userId, name) => updateFarmUser(userId, (r) => {
  if (!roster().includes(name)) return { error: 'unknown' };
  if (!r.hero) return { error: 'no-hero' };
  if (hasHero(r, name)) return { error: 'owned' };
  if (!(r.tokens > 0)) return { error: 'token' };
  r.tokens -= 1;
  r.heroes[name] = { earned: 0, tiers: {}, items: {} };
  offers.get(userId)?.delete(name); // a rival waiting as that hero has nothing left to offer (only that one: the others keep their time)
  return { ok: true };
});

// Makes an unlocked hero the current one, any time (his call, Oct 11: no wait). The hero left behind keeps everything that is its own
// (souls, level, abilities, items, cooldowns, buffs, Rejuvs ...) for when the member comes back.
// Returns { ok: true } or { error: 'no-hero' | 'same' | 'locked' }.
const switchHero = (userId, name) => updateFarmUser(userId, (r) => {
  if (!r.hero) return { error: 'no-hero' };
  if (r.hero === name) return { error: 'same' };
  if (!r.heroes[name]) return { error: 'locked' };
  r.heroes[r.hero] = savedPart(r);
  Object.assign(r, { hero: name, ...heroPart(r.heroes[name]) });
  return { ok: true };
});

// ---- the lanes (his calls, Oct 3; the rules are spelled out at LANES in targets.js) ----
// A Guardian or Walker exists once per lane, so its cooldown and its "down" time are kept under '<key>:<lane>' (its slot); other targets under their key.
const PER_LANE = new Set([...LANED, 'waves']); // a wave run (`/lane run`) is per lane too, but nothing about it is ever "down" or locked
const slotOf = (key, lane) => (PER_LANE.has(key) ? `${key}:${lane}` : key);
const isDown = (record, key, lane, now = Date.now()) => (record.down?.[`${key}:${lane}`] ?? 0) > now;
const walkersDown = (record, now = Date.now()) => Object.keys(LANES).filter((lane) => isDown(record, 'walker', lane, now)).length;
// What still stands in the way of a target: 'guardian' (a Walker whose lane Guardian is up), 'walkers' (the siege while a Walker stands), or null.
const lockedBy = (record, key, lane, now = Date.now()) => (key === 'walker' && !isDown(record, 'guardian', lane, now) ? 'guardian'
  : key === 'siege' && walkersDown(record, now) < Object.keys(LANES).length ? 'walkers' : null);

const cooldownSeconds = (slot) => { const key = slot.split(':')[0]; return key === 'siege' ? SIEGE.cooldown : key === 'roam' ? ROAM_COOLDOWN : key === 'waves' ? WAVES.cooldown : TARGETS[key].cooldown; };
const cooldownLeft = (record, key, now = Date.now()) => (cooldownsOn ? Math.max(0, (record.cooldowns[key] ?? 0) - now) : 0);

const familyName = (key) => key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const CAMP_SIZE = { 'small-camp': 'small', 'medium-camp': 'medium', 'large-camp': 'large' };
// Each Haunt in a camp rolls a trait (his call, Oct 2: random resistances): armoured ones shrug off bullets, warded ones spirit damage.
// ponytail: the trait list and its sizes are placeholders.
const TRAITS = [{ name: null, bullet: 0, spirit: 0 }, { name: 'Armored', bullet: 0.2, spirit: -0.1 }, { name: 'Warded', bullet: -0.1, spirit: 0.2 },
  { name: 'Ironclad', bullet: 0.1, spirit: 0.1 }, { name: 'Brittle', bullet: -0.1, spirit: -0.1 }];
const resistClamp = (x) => Math.max(0, Math.min(0.9, x));
// The Haunt families a camp can hold (the ones that come in its size).
const campFamilies = (key) => Object.entries(HAUNTS).filter(([, sizes]) => sizes[CAMP_SIZE[key]]).map(([k]) => k);
const hauntFile = (family, size) => path.join(ASSETS, 'farm', 'haunts', `${family}_${size}.png`);

// Plays out `key` ('siege', 'waves' or a TARGETS key) with the member's hero at once. A wave run never "wins": it goes on until the hero falls,
// `cleared` is how many waves were beaten and every one of them pays. Returns the run:
//   { key, siege, hero, won, timedOut, cleared (stages beaten), stageNames, seconds, souls, rejuvsUsed, rejuvsEarned,
//     family: { key, name, size } | null (camps), frames (snapshots to replay), log: [[seconds, text]] }
function simulate(heroName, requested, { rng = Math.random, rejuvs = 0, buffs = {}, bridge = [], boons = 0, items = [], tiers = {}, unlocked = 4, corrupted = null, imbues = {}, copies = null, kept = {}, clears = 0, family: wanted, walkersDown: fallen = 0, stages: rooms = null, health = null } = {}) {
  const rnd = (n) => Math.floor(rng() * n);
  const isSiege = requested === 'siege';
  const isWaves = requested === 'waves';
  const isDescend = requested === 'descend'; // a /descend room (descent.js): its own `stages`, the run's health carried in (`health`, a share of max)
  const key = requested;
  const target = isSiege || isWaves || isDescend ? null : TARGETS[key];
  const hero = buildHero(heroName, { buffs, bridge, boons, items, tiers, unlocked, corrupted, imbues, copies, kept });
  hero.rejuvs = isSiege || isDescend ? rejuvs : 0; // Rejuvs are for the siege (his design) and a descent; the Mid-Boss gives them, never takes them
  if (health != null) hero.health = Math.max(1, health * hero.stats.maxHealth);
  const size = CAMP_SIZE[key];
  // a camp's family: the one its details screen showed (`wanted`), else a random one of its size
  const family = !size ? null : campFamilies(key).includes(wanted) ? wanted : pickRandom(campFamilies(key), rnd);
  const grown = (stage) => ({ ...stage, enemies: () => stage.enemies().map((e) => strengthen(e, clears, key)) }); // it grows with every clear
  const stages = isDescend ? rooms : isWaves ? WAVES.stages : isSiege ? SIEGE.stages.map(grown) : [grown({
    name: target.name,
    enemies: () => target.enemies().map((e) => {
      if (key === 'walker' && fallen) { e.stats.maxHealth += WALKER_STEP * fallen; e.health = e.stats.maxHealth; } // tougher for every other Walker that is down
      if (family) {
        e.stats.special = specialFor(family, e.name === 'Small Haunt'); // its family's special attack (medium and large Haunts only)
        const t = pickRandom(TRAITS, rnd);
        e.name = `${t.name ? `${t.name} ` : ''}${familyName(family)}`;
        e.stats.bulletResist = resistClamp(e.stats.bulletResist + t.bullet);
        e.stats.spiritResist = resistClamp(e.stats.spiritResist + t.spirit);
      }
      return e;
    }),
  })];

  const log = []; // [seconds, text]
  const frames = [];
  let seen = 0; // entries of this stage's fight.log already turned into lines
  let dead = new Set();
  const kills = []; // enemies killed in each stage (legendary drops)
  let steps = 0;
  let downLogged = false;
  const slept = new Set(); // enemies that were asleep at any moment since the last snapshot (a sleep is shorter than a frame)
  const label = (fight, i) => (fight.enemies.length > 1 ? `${fight.enemies[i].name} ${i + 1}` : fight.enemies[i].name);
  const snapshot = (fight, stage) => ({
    t: fight.time, stage,
    hero: { hp: hero.health, max: hero.stats.maxHealth, respawning: hero.has('rejuv') }, rejuvs: hero.rejuvs,
    enemies: fight.enemies.map((e, i) => ({ name: label(fight, i), hp: e.health, max: e.stats.maxHealth, asleep: slept.has(i) || e.has('sleep') })),
    abilities: hero.abilities.filter((a) => !a.hidden).map((a) => ({ name: a.name, status: a.status(fight) })), // hidden: an ultimate Sinclair copied
    log: log.slice(-4),
  });
  const watch = (fight, stage, phase) => {
    if (phase === 'start') {
      if (isWaves && stage > 0) hero.health = Math.min(hero.stats.maxHealth, hero.health + hero.stats.maxHealth * WAVE.rest); // a breather between two waves
      seen = 0; dead = new Set(); kills[stage] = 0; steps = 0; slept.clear(); frames.push(snapshot(fight, stage)); return;
    }
    for (; seen < fight.log.length; seen++) {
      const l = fight.log[seen];
      log.push([l.t, l.what === 'Rejuvenated' ? 'The Rejuvenator has expired.' : l.enemy ? (l.parried ? `${hero.name} parried ${l.who}'s ${l.what}` : l.dodged ? `${hero.name} dodged ${l.who}'s ${l.what}` : l.special ? `${l.who} used ${l.what}` : l.cc ? `${l.who} ${l.what} ${hero.name}` : l.verb ? `${l.who} ${l.verb} ${hero.name}` : `${l.who} ${l.what === 'stomp' ? 'stomped' : 'cursed'} ${hero.name}`) : l.melee ? `${l.who} landed a ${l.what} on ${l.target}` : `${l.who} used ${l.what}`]); // (a rival hero's casts are its own)
    }
    fight.enemies.forEach((e, i) => { if (!e.alive && !dead.has(i)) { dead.add(i); kills[stage]++; log.push([+fight.time.toFixed(1), `${label(fight, i)} went down`]); } });
    if (!hero.alive && !downLogged) { downLogged = true; log.push([+fight.time.toFixed(1), `${hero.name} went down`]); }
    fight.enemies.forEach((e, i) => { if (e.has('sleep')) slept.add(i); });
    if (++steps % FRAME_STEPS === 0) { frames.push(snapshot(fight, stage)); slept.clear(); }
  };

  const out = runStages(hero, stages, { rng, maxSecondsPerStage: isWaves ? WAVES.secondsPerWave : isSiege ? 900 : isDescend ? DESCEND_SECONDS : 600, watch });
  frames.push(snapshot(out.fight, Math.min(out.stage, stages.length - 1)));
  const killed = (n) => kills.slice(0, n).reduce((s, k) => s + (k ?? 0), 0);
  const total = isWaves || isDescend ? 0 : isSiege ? SIEGE.stages.reduce((s, st) => s + st.souls, 0) : target.souls;
  if (isDescend) {
    return { key, descend: true, hero: heroName, won: out.won, timedOut: out.timedOut, cleared: out.stage, stageNames: stages.map((s) => s.name), seconds: out.time, kills: killed(out.stage),
      rejuvsUsed: rejuvs - hero.rejuvs, health: hero.alive ? hero.health / hero.stats.maxHealth : 0, kept: keptAfter(hero), frames: downsample(frames, MAX_FRAMES), log, damage: out.damage };
  }
  if (isWaves) {
    return { key, waves: true, siege: false, hero: heroName, won: out.stage > 0, timedOut: out.timedOut, cleared: out.stage, stageNames: stages.map((s) => s.name), seconds: out.time,
      souls: wavesPay(out.stage) + payout(out.bonusSouls), itemSouls: payout(out.bonusSouls), kills: killed(out.stage), rejuvsUsed: 0, rejuvsEarned: 0, family: null, kept: keptAfter(hero), frames: downsample(frames, MAX_FRAMES), log, damage: out.damage };
  }
  return {
    key, siege: isSiege, hero: heroName, won: out.won, timedOut: out.timedOut,
    cleared: out.stage, stageNames: stages.map((s) => s.name), seconds: out.time,
    kills: out.won ? killed(stages.length) : 0, // only a won fight's kills count (legendary drops)
    souls: out.won ? Math.round(payout(total) * (family ? campMultiplier(boons) : 1) * clearSouls(clears)) + payout(out.bonusSouls) : 0, // camps pay more as the hero levels, every target as it grows
    itemSouls: out.won ? payout(out.bonusSouls) : 0, // what souls items (Trophy Collector, Cultist Sacrifice) added
    rejuvsUsed: isSiege ? rejuvs - hero.rejuvs : 0, rejuvsEarned: out.won && target ? target.rejuv || 0 : 0,
    family: family ? { key: family, name: familyName(family), size } : null, kept: keptAfter(hero),
    frames: downsample(frames, MAX_FRAMES), log, damage: out.damage,
  };
}

// At most `n` snapshots, evenly spread, always keeping the first and the last.
function downsample(frames, n) {
  if (frames.length <= n) return frames;
  return Array.from({ length: n }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (n - 1))]);
}

// Sends the member's hero to `key` ('siege', 'roam' or a TARGETS key). Claims the cooldown first (in one locked step, so a double
// click can't run it twice), then plays it, then pays and settles Rejuvs and buffs.
// A Guardian or Walker needs its `lane` (a LANES key). Returns { error: 'no-hero' | 'lane' | 'locked' (by: lockedBy) | 'cooldown', left? }, or { run } (a fight) or { haul } (a roam).
// What a member's hero fights with: boons (its level), the abilities unlocked, the tiers they bought, the items equipped.
// Permanent buffs are the member's (roams) plus this hero's own Eternal Gift ones.
const fightKit = (r) => ({
  boons: progress(r.earned).level, unlocked: progress(r.earned).unlocks, points: progress(r.earned).points, tiers: r.tiers, items: [...Object.values(r.items).flat(), ...(r.legendary ? [r.legendary] : [])], corrupted: r.corrupted ?? null, imbues: r.imbues ?? {},
  buffs: Object.entries(r.gifts ?? {}).reduce((all, [k, n]) => ({ ...all, [k]: (all[k] ?? 0) + n }), { ...r.buffs }),
  copies: roster().filter((n) => n !== r.hero && !!r.heroes?.[n]), // Sinclair copies the ultimate of one of the member's other unlocked heroes (his call, Oct 5)
  kept: { ...r.kept }, // Glass Cannon's and Trophy Collector's kill stacks (his calls, Oct 22: kept until the hero dies)
});

async function play(userId, key, { now = Date.now(), rng, family, lane } = {}) {
  if (PER_LANE.has(key) && !LANES[lane]) return { error: 'lane' };
  const slot = slotOf(key, lane);
  const claim = await updateFarmUser(userId, (r) => {
    if (!r.hero) return { error: 'no-hero' };
    const by = lockedBy(r, key, lane, now);
    if (by) return { error: 'locked', by };
    const left = cooldownLeft(r, slot, now);
    if (left > 0) return { error: 'cooldown', left };
    if (cooldownsOn) r.cooldowns[slot] = now + cooldownSeconds(slot) * 1000;
    return { hero: r.hero, rejuvs: r.rejuvs, kit: { ...fightKit(r), clears: r.clears[key] ?? 0, walkersDown: key === 'walker' ? walkersDown(r, now) : 0 }, bridge: key === 'roam' ? [] : r.bridge.splice(0) }; // a fight uses up held bridge buffs
  });
  if (claim.error) return claim;
  // everything is settled on the hero that went (claim.hero), its own souls included (his call, Oct 11)
  const settle = (change) => updateHero(userId, claim.hero, (h, r) => { change(h, r); return h.souls; });
  const paid = (souls, after) => { if (souls) logSouls(userId, claim.hero, souls, 'farm', after); };
  try {
    if (key === 'roam') {
      const haul = { ...roam(new Date(now).toISOString().slice(0, 10), rng, now), hero: claim.hero };
      paid(haul.souls, await settle((h) => { h.earned += haul.souls; h.souls += haul.souls; for (const b of haul.buffs) h.buffs[b] = (h.buffs[b] ?? 0) + 1; if (haul.bridge && !h.bridge.includes(haul.bridge)) h.bridge.push(haul.bridge); }));
      return { haul };
    }
    const run = simulate(claim.hero, key, { rng, family, rejuvs: claim.rejuvs, bridge: claim.bridge, ...claim.kit });
    if (PER_LANE.has(key)) run.lane = lane;
    if (run.waves) { // a wave run: no clears, nothing goes down; the member's furthest run is kept (his call, Oct 11: the member's, not the hero's)
      paid(run.souls, await settle((h, r) => { Object.assign(h.kept, run.kept); h.earned += run.souls; h.souls += run.souls; run.best = r.bestWave = Math.max(r.bestWave ?? 0, run.cleared); run.legendary = dropLegendary(h, run.kills, rng); afterFight(h, run, rng); run.rival = meet(userId, r, run, rng, now); }));
      return { run };
    }
    paid(run.souls, await settle((h, r) => {
      h.earned += run.souls; h.souls += run.souls; run.legendary = run.siege ? dropLegendary(h, run.won ? 1 : 0, rng, SIEGE_LEGENDARY_CHANCE) : dropLegendary(h, run.kills, rng); afterFight(h, run, rng); // a won siege: one 5% roll, not one per kill (his call, Oct 22)
      Object.assign(h.kept, run.kept);
      if (run.won && LANED.has(key)) h.down[slot] = now + cooldownSeconds(slot) * 1000;
      h.clears[key] = Math.max(0, Math.min(CLEAR_CAP, (h.clears[key] ?? 0) + (run.won ? 1 : -1)));
      h.rejuvs = Math.max(0, Math.min(MAX_REJUVS, h.rejuvs - run.rejuvsUsed + run.rejuvsEarned));
      if (run.siege && run.won && !r.siegeTokens.includes(claim.hero)) { r.siegeTokens.push(claim.hero); r.tokens += 1; run.token = true; } // each hero's first siege win (his call, Oct 2)
      run.rival = meet(userId, r, run, rng, now);
    }));
    return { run };
  } catch (error) {
    await updateHero(userId, claim.hero, (h) => { delete h.cooldowns[slot]; h.bridge.push(...claim.bridge.filter((b) => !h.bridge.includes(b))); }); // it didn't finish, so nothing is used up
    throw error;
  }
}

// ---- encounters (his calls, Oct 2-3; the rules are in encounter.js) ----
// After a won fight (not the siege; a roam isn't a fight) a hero the member hasn't unlocked may show up: the offer is kept here, in memory, for
// OFFER_MS (his call: the rival leaves after 5 minutes; a restart just ends it). With the testing switch (cooldowns off) every won fight brings one.
// A member can have several rivals waiting at once, one per result message (Oct 11: one offer per member meant each new rival sent the last one
// away early); each message's buttons name their own rival. A rival already waiting, or already unlocked, never shows up again.
const OFFER_MS = 5 * 60 * 1000;
const offers = new Map(); // user id -> Map(rival -> ms timestamp it leaves)
// The member's waiting rivals (the ones whose 5 minutes ran out are dropped).
function waiting(userId, now = Date.now()) {
  const mine = offers.get(userId) ?? new Map();
  for (const [rival, until] of mine) if (until <= now) mine.delete(rival);
  if (mine.size) offers.set(userId, mine); else offers.delete(userId);
  return mine;
}
function meet(userId, r, run, rng = Math.random, now = Date.now()) {
  if (!run.won || run.siege) return null;
  const mine = waiting(userId, now);
  const rival = rollRival((name) => hasHero(r, name) || mine.has(name), rng, cooldownsOn ? ENCOUNTER_CHANCE : 1);
  if (rival) offers.set(userId, mine.set(rival, now + OFFER_MS));
  return rival;
}
// Is `rival` still waiting for this member? Returns the rival, or null.
const offerFor = (userId, rival, now = Date.now()) => (waiting(userId, now).has(rival) ? rival : null);
// The 5 minutes start again when the fight's result is shown (the offer is made at Send, before the replay). Returns the rival, or null if it is gone.
function holdOffer(userId, rival, now = Date.now()) {
  if (!offerFor(userId, rival, now)) return null;
  waiting(userId, now).set(rival, now + OFFER_MS);
  return rival;
}
// Walk Away (or the 5 minutes ran out): that rival's offer is gone. Returns the rival if it was waiting, or null.
function walkAway(userId, rival, now = Date.now()) {
  const mine = waiting(userId, now);
  const was = mine.delete(rival) ? rival : null;
  if (!mine.size) offers.delete(userId);
  return was;
}
// Fight: the duel is played at once (like a trip) and a win unlocks the rival, at level 0 with nothing; a loss costs nothing but the Rejuvs it used (his call, Oct 10:
// the member's Rejuvs work in a duel and are used up). Uses up the offer.
// Nothing else changes: no cooldown, souls, bridge buffs or item time. Returns { run } or { error: 'gone' | 'owned' | 'no-hero' }.
async function fightRival(userId, rival, { rng = Math.random, now = Date.now() } = {}) {
  if (!walkAway(userId, rival, now)) return { error: 'gone' };
  const r = await getFarmUser(userId);
  if (!r.hero) return { error: 'no-hero' };
  if (hasHero(r, rival)) return { error: 'owned' }; // unlocked meanwhile (a token)
  const kit = fightKit(r);
  const run = duel(r.hero, kit, rival, rivalKit(kit, rng), { rng, rejuvs: r.rejuvs });
  if (run.won || run.rejuvsUsed || Object.keys(run.kept).length) await updateHero(userId, r.hero, (h, rec) => { Object.assign(h.kept, run.kept); h.rejuvs = Math.max(0, h.rejuvs - run.rejuvsUsed); if (run.won && !hasHero(rec, rival)) rec.heroes[rival] = { earned: 0, tiers: {}, items: {} }; }); // the Rejuvs of the hero that duelled
  return { run };
}

// What a fight's time does for the hero's items (inside its record update): a Golden Goose Egg grows by its souls per minute, and every 165 s of fight
// time with Eternal Gift is one of its permanent buffs (his calls, Oct 3). The buffs found are put on the run (`gifts`) for the result.
const EGG = itemByName('Golden Goose Egg');
const GIFT = itemByName('Eternal Gift');
const GIFT_EVERY = Object.values(GIFT).find((i) => i?.Cooldown)?.Cooldown ?? 165;
function afterFight(r, run, rng = Math.random) {
  const held = Object.values(r.items).flat();
  if (held.includes(EGG.Name)) r.egg = (r.egg ?? 0) + (effectValue(EGG, 'BonusGoldPerMinute') * run.seconds) / 60;
  if (!held.includes(GIFT.Name)) return;
  r.giftTime = (r.giftTime ?? 0) + run.seconds;
  run.gifts = [];
  for (; r.giftTime >= GIFT_EVERY; r.giftTime -= GIFT_EVERY) {
    const key = rollAnyBuff(rng);
    r.gifts[key] = (r.gifts[key] ?? 0) + 1;
    run.gifts.push(key);
  }
}

// Rolls the legendary drop for `kills` on a record (inside its update): one the hero hasn't got yet. The first goes into the legendary slot;
// later ones are kept to change to (equipLegendary). Returns { name, equipped } or null.
function dropLegendary(r, kills, rng = Math.random, chance) {
  if (!kills) return null;
  r.legendaries ??= [];
  const name = rollLegendary(kills, rng, r.legendaries, chance);
  if (!name) return null;
  r.legendaries.push(name);
  const equipped = !r.legendary;
  if (equipped) r.legendary = name;
  return { name, equipped };
}

// Puts another of the hero's legendaries in the legendary slot (his call, Oct 22: at will). Returns { ok: true } or { error: 'no-hero' | 'missing' }.
const equipLegendary = (userId, name) => updateFarmUser(userId, (r) => {
  if (!r.hero) return { error: 'no-hero' };
  if (!r.legendaries.includes(name)) return { error: 'missing' };
  r.legendary = name;
  return { ok: true };
});

// ---- the hero screen's two actions ----
// Puts an ability point into the next tier of ability `slot` (1-4). Returns { ok: true, tier } or { error: 'locked' | 'max' | 'points' | 'no-hero' }.
const upgradeAbility = (userId, slot) => updateFarmUser(userId, (r) => {
  if (!r.hero) return { error: 'no-hero' };
  const p = progress(r.earned);
  const tier = r.tiers[slot] ?? 0;
  if (slot > p.unlocks) return { error: 'locked' };
  if (tier >= MAX_TIER) return { error: 'max' };
  if (p.points - pointsSpent(r.tiers) < TIER_COSTS[tier]) return { error: 'points' };
  r.tiers[slot] = tier + 1;
  return { ok: true, tier: tier + 1 };
});

// Buys one of ITEM_POOL with the hero's own souls (his call, Oct 11; it sells back for half, sellItem). A hero carries 12 items of any kind (MAX_ITEMS).
// An item the member owns a component of costs the difference, and the component is used up (priceFor in levels.js).
// A component of an owned item can't be bought again (heldIn). Returns { ok: true, paid, used: [components] }, { error: 'inside', holder },
// { error: 'corrupted', item }, or { error: 'unknown' | 'no-hero' | 'owned' | 'full' | 'souls' | 'missing' }.
// `sell` (his call, Oct 22: a full build asks which item to sell for the new one): that item is sold first (sellItem's rules, its refund counts
// towards the price), all in one go: nothing is sold unless the buy goes through. Then also { sold, refund }.
async function buyItem(userId, name, { sell = null } = {}) {
  const card = ITEM_POOL.includes(name) && itemByName(name);
  if (!card) return { error: 'unknown' };
  const slot = SLOT_OF[card.Slot];
  const sellCard = sell && itemByName(sell);
  let paid = null; // [hero, price, souls after]
  let refunded = null; // [hero, refund, souls after]
  const result = await updateFarmUser(userId, (r) => {
    if (!r.hero) return { error: 'no-hero' };
    if (sell && !(sellCard && r.items[SLOT_OF[sellCard.Slot]]?.includes(sell))) return { error: 'missing' };
    const items = sell ? Object.fromEntries(SLOTS.map((s) => [s, r.items[s].filter((n) => n !== sell)])) : r.items; // the build once `sell` is gone
    const refund = sell ? sellPrice(sellCard, r.corrupted) : 0;
    if (items[slot].includes(name)) return { error: 'owned' };
    const holder = heldIn(name, items);
    if (holder) return { error: 'inside', holder };
    const { price, used } = priceFor(card, items);
    if (r.corrupted && r.corrupted.name !== sell && used.includes(r.corrupted.name)) return { error: 'corrupted', item: r.corrupted.name }; // sell it first: an upgrade would lose the corruption
    if (countItems(items) - used.length >= MAX_ITEMS) return { error: 'full' };
    if (r.souls + refund < price) return { error: 'souls' };
    if (sell) { sellOut(r, sell, sellCard); refunded = [r.hero, refund, r.souls]; }
    r.souls -= price;
    for (const s of SLOTS) r.items[s] = r.items[s].filter((n) => !used.includes(n));
    for (const u of used) delete r.imbues[u];
    r.items[slot].push(name);
    if (IMBUES.includes(name)) r.imbues[name] = 1; // until the member picks (the shop asks right away)
    paid = [r.hero, price, r.souls];
    return { ok: true, paid: price, used, ...(IMBUES.includes(name) ? { imbue: true } : {}), ...(sell ? { sold: sell, refund } : {}) };
  });
  if (refunded) logSouls(userId, ...refunded.slice(0, 2), 'farm-shop', refunded[2]);
  if (paid) logSouls(userId, paid[0], -paid[1], 'farm-shop', paid[2]);
  return result;
}

// Takes a sold item out of a hero's build (inside an update): its corruption, egg growth, kill stacks and imbue go with it; half its price back.
function sellOut(r, name, card) {
  const refund = sellPrice(card, r.corrupted);
  if (r.corrupted?.name === name) r.corrupted = null;
  if (name === EGG.Name) r.egg = 0; // an unhatched egg's growth goes with it
  delete r.kept[name]; // and Glass Cannon's / Trophy Collector's kill stacks
  delete r.imbues[name];
  const slot = SLOT_OF[card.Slot];
  r.items[slot] = r.items[slot].filter((n) => n !== name);
  r.souls += refund;
  return refund;
}

// Sells an item back for half its price (sellPrice), into the hero's own souls. A legendary is never in the 12 slots, so it can't be sold.
// Returns { ok: true, refund } or { error: 'no-hero' | 'missing' }.
async function sellItem(userId, name) {
  const card = itemByName(name);
  let paid = null;
  const sold = await updateFarmUser(userId, (r) => {
    if (!r.hero) return { error: 'no-hero' };
    const slot = card && SLOT_OF[card.Slot];
    if (!slot || !r.items[slot].includes(name)) return { error: 'missing' };
    const refund = sellOut(r, name, card);
    paid = [r.hero, refund, r.souls];
    return { ok: true, refund };
  });
  if (paid) logSouls(userId, ...paid.slice(0, 2), 'farm-shop', paid[2]);
  return sold;
}

// ---- corruption, imbues and the egg (his calls, Oct 3) ----
// The Broker corrupts one owned tier 3 or 4 item (one per hero) for its price again, while he is open (always, with the testing switch on).
// The drawback is rolled once and kept. Returns { ok: true, paid, drawback, amount } or { error: 'unknown' | 'closed' (opens) | 'no-hero' | 'missing' | 'one' (name) | 'souls' }.
async function corruptItem(userId, name, { now = Date.now(), rng = Math.random } = {}) {
  const card = itemByName(name);
  if (!corruptible(card)) return { error: 'unknown' };
  if (cooldownsOn && !brokerOpen(now)) return { error: 'closed', opens: brokerNext(now) };
  const slot = SLOT_OF[card.Slot];
  const price = corruptPrice(card);
  const roll = rollDrawback(card, rng);
  let paid = null;
  const result = await updateFarmUser(userId, (r) => {
    if (!r.hero) return { error: 'no-hero' };
    if (!r.items[slot].includes(name)) return { error: 'missing' };
    if (r.corrupted) return { error: 'one', name: r.corrupted.name };
    if (r.souls < price) return { error: 'souls' };
    r.souls -= price;
    r.corrupted = { name, ...roll };
    paid = [r.hero, price, r.souls];
    return { ok: true, paid: price, ...roll };
  });
  if (paid) logSouls(userId, paid[0], -paid[1], 'farm-shop', paid[2]);
  return result;
}

// Points an owned imbue item at ability `slot` (1-4). Free, any time. Returns { ok: true } or { error: 'no-hero' | 'missing' | 'slot' }.
const setImbue = (userId, name, slot) => updateFarmUser(userId, (r) => {
  if (!r.hero) return { error: 'no-hero' };
  if (!IMBUES.includes(name) || !Object.values(r.items).flat().includes(name)) return { error: 'missing' };
  if (!(slot >= 1 && slot <= (NO_ULT_IMBUE.has(name) ? 3 : 4))) return { error: 'slot' }; // Echo Shard, Omnicharge Signet: non-ultimates only (the wiki)
  r.imbues[name] = slot;
  return { ok: true };
});

// Hatches the hero's Golden Goose Egg: it pays its 400 + what it grew, at the trip payout scale, into the hero's own souls, plus one random permanent buff per 80 souls it grew in
// fights (the card: "a permanent buff per 80 souls accrued"), and is used up. Returns { ok: true, souls, buffs: [keys] } or { error: 'no-hero' | 'missing' }.
async function hatchEgg(userId, rng = Math.random) {
  let paid = null;
  const done = await updateFarmUser(userId, (r) => {
    if (!r.hero) return { error: 'no-hero' };
    if (!r.items.spirit.includes(EGG.Name)) return { error: 'missing' };
    const grown = r.egg ?? 0;
    const souls = Math.round((effectValue(EGG, 'StartingGold') + grown) * PAYOUT_SCALE);
    const buffs = Array.from({ length: Math.floor(grown / effectValue(EGG, 'BonusBuffsPerGold')) }, () => rollAnyBuff(rng));
    for (const b of buffs) r.buffs[b] = (r.buffs[b] ?? 0) + 1;
    r.items.spirit = r.items.spirit.filter((n) => n !== EGG.Name);
    delete r.imbues[EGG.Name];
    r.egg = 0;
    r.souls += souls;
    paid = [r.hero, souls, r.souls];
    return { ok: true, souls, buffs };
  });
  if (paid?.[1]) logSouls(userId, ...paid.slice(0, 2), 'farm', paid[2]);
  return done;
}

module.exports = { TRAITS, heroOf, offerFor, holdOffer, walkAway, fightRival, OFFER_MS, cooldownsActive, corruptItem, setImbue, hatchEgg, afterFight, EGG, dropLegendary, equipLegendary, PER_LANE, slotOf, isDown, walkersDown, lockedBy, hasHero, unlockHero, switchHero, updateFarmUser, updateHero, OLD_OWNER, upgradeAbility, buyItem, sellItem, fightKit, setCooldowns, MAX_REJUVS, getFarmUser, chooseHero, cooldownSeconds, cooldownLeft, hauntFile, campFamilies, CAMP_SIZE, simulate, play };
