// Hero Farming, the member side: their farm record (hero, cooldowns, Rejuvs), and one trip. `play` claims the cooldown, runs the whole
// fight at once, pays the souls, and hands back snapshots the command replays as a live message. Rules: server-plan.md ("Hero Farming").
//   record (data/farm.json, per member). The member's own (his call, Oct 2: shared by all their heroes): { hero (the current one),
//   cooldowns: { <target | 'siege' | 'roam'>: ms timestamp it is ready again }, rejuvs, clears: { <target>: times cleared }, switchedAt: ms of their last hero switch,
//   down: { '<guardian | walker>:<lane>': ms timestamp until which it stays beaten } (the lanes, below), bestWave: the most waves cleared in one run,
//   buffs: { <buff key>: how many they hold } (permanent, from roaming; buffs.js), bridge: [bridge buff keys held for the next fight],
//   tokens: Character Unlock Tokens held, siegeTokens: [heroes whose siege win already paid a token] }
//   Each hero's own: heroes: { <hero name>: { earned: souls its trips have paid (hero level, levels.js), tiers: { <ability slot>: tier 0-3 },
//   items: { weapon | vitality | spirit: [item names] }, legendary, corrupted: { name, drawback, amount } (its one corrupted item, stats.js),
//   imbues: { <item name>: ability slot }, egg: souls its Golden Goose Egg has grown (wiki souls), giftTime: fight seconds towards the next
//   Eternal Gift buff, gifts: { <buff key>: count } (Eternal Gift's permanent buffs) } }. In the code the current hero's part sits on the record
//   itself (`load` below).
// The cooldown is claimed (and the result is known) when they press Send, so a restart mid-replay never loses or repeats a payout.
const path = require('node:path');
const { getStore } = require('../../storage');
const { ASSETS } = require('../art');
const { changeSouls } = require('../xp');
const { pickRandom } = require('../random');
const { buildHero, roster } = require('./hero');
const { TARGETS, SIEGE, WAVES, WAVE, wavesPay, LANES, LANED, WALKER_STEP, payout, runStages, clearSouls, strengthen, CLEAR_CAP } = require('./targets');
const { roam, COOLDOWN: ROAM_COOLDOWN } = require('./roam');
const { progress, pointsSpent, campMultiplier, TIER_COSTS, MAX_TIER, SLOTS, MAX_ITEMS, countItems, priceFor, heldIn, rollLegendary, waitingLegendary, SLOT_OF, ITEM_POOL, itemsOf, sellPrice,
  brokerOpen, brokerNext, corruptible, corruptPrice, rollDrawback } = require('./levels');
const { itemByName, effectValue } = require('./stats');
const { IMBUES } = require('./items');
const { rollAnyBuff } = require('./buffs');
const { PAYOUT_SCALE } = require('./targets');
const { rollRival, rivalKit, duel, ENCOUNTER_CHANCE } = require('./encounter');
const { HAUNTS } = require('./refresh'); // the Haunt families live with the download list that fetches their pictures

const SWITCH_WAIT = 24 * 3600 * 1000; // switching between unlocked heroes: once a day (his call, Oct 2)
const MAX_REJUVS = 3; // like the game's 3 credits per Mid-Boss kill; placeholder until he decides
const FRAME_STEPS = 30; // a snapshot every 3 seconds of fight
const MAX_FRAMES = 14; // the live message plays back at most this many snapshots (3 s apart on screen)

const farm = () => getStore('farm');
const blankRecord = () => ({ hero: null, heroes: {}, cooldowns: {}, down: {}, rejuvs: 0, buffs: {}, bridge: [], clears: {}, tokens: 0, siegeTokens: [] });
// Saved record -> the one the code works with: the current hero's own progress (`heroes[hero]`) is laid out at `earned`, `tiers`,
// `items` and `legendary` (the one it got, levels.js), so everything else reads and edits it there. Records from before progress was per hero kept those three on the
// member; they belong to the hero that member had. (The storage hands out copies, so this may be edited freely.)
// One hero's saved part -> the working copy, and back (empty parts are left out of the file).
const heroPart = (mine = {}) => ({
  earned: mine.earned ?? 0, tiers: { ...mine.tiers }, items: itemsOf(mine.items), legendary: mine.legendary ?? null, corrupted: mine.corrupted ?? null,
  imbues: { ...mine.imbues }, egg: mine.egg ?? 0, giftTime: mine.giftTime ?? 0, gifts: { ...mine.gifts },
});
const HERO_KEYS = Object.keys(heroPart());
const savedPart = (r) => Object.fromEntries(HERO_KEYS.map((k) => [k, r[k]]).filter(([k, v]) => ['earned', 'tiers', 'items'].includes(k) || (v && (typeof v !== 'object' || Object.keys(v).length))));
function load(saved) {
  const { earned, tiers, items, midbossKills, ...rest } = saved ?? {};
  const record = { ...blankRecord(), ...rest };
  if (midbossKills) record.clears = { ...record.clears, 'mid-boss': midbossKills }; // the first version counted only the Mid-Boss
  return { ...record, ...heroPart(record.heroes[record.hero] ?? { earned, tiers, items }) };
}
// ... and back: the hero's part goes into `heroes[hero]`, the other heroes' progress is left as it was.
function unload(working) {
  const record = Object.fromEntries(Object.entries(working).filter(([k]) => !HERO_KEYS.includes(k)));
  if (record.hero) record.heroes[record.hero] = savedPart(working);
  return record;
}
const getFarmUser = async (id) => load(await farm().get(id));

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

// ---- more heroes (his calls, Oct 2): unlock each extra one once, then switch between the unlocked ones, once a day ----
const hasHero = (record, name) => record.hero === name || !!record.heroes[name];
// How long until this member may switch again (0 = now). The testing switch (/farm-config cooldowns) turns this wait off too.
const switchLeft = (record, now = Date.now()) => (cooldownsOn ? Math.max(0, (record.switchedAt ?? 0) + SWITCH_WAIT - now) : 0);

// Unlocks another hero with a Character Unlock Token (his call, Oct 2: no souls price; a token comes from each hero's first siege win).
// It starts at level 0 with nothing and doesn't switch, so it can be unlocked during the wait.
// Returns { ok: true } or { error: 'unknown' | 'no-hero' | 'owned' | 'token' }.
const unlockHero = (userId, name) => updateFarmUser(userId, (r) => {
  if (!roster().includes(name)) return { error: 'unknown' };
  if (!r.hero) return { error: 'no-hero' };
  if (hasHero(r, name)) return { error: 'owned' };
  if (!(r.tokens > 0)) return { error: 'token' };
  r.tokens -= 1;
  r.heroes[name] = { earned: 0, tiers: {}, items: {} };
  return { ok: true };
});

// Makes an unlocked hero the current one. The hero left behind keeps its level, ability tiers and items for when the member comes back.
// Returns { ok: true } or { error: 'no-hero' | 'same' | 'locked' | 'wait', left? }.
const switchHero = (userId, name, now = Date.now()) => updateFarmUser(userId, (r) => {
  if (!r.hero) return { error: 'no-hero' };
  if (r.hero === name) return { error: 'same' };
  if (!r.heroes[name]) return { error: 'locked' };
  const left = switchLeft(r, now);
  if (left > 0) return { error: 'wait', left };
  r.heroes[r.hero] = savedPart(r);
  Object.assign(r, { hero: name, ...heroPart(r.heroes[name]), switchedAt: now });
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
function simulate(heroName, requested, { rng = Math.random, rejuvs = 0, buffs = {}, bridge = [], boons = 0, items = [], tiers = {}, unlocked = 4, corrupted = null, imbues = {}, copies = null, clears = 0, family: wanted, walkersDown: fallen = 0 } = {}) {
  const rnd = (n) => Math.floor(rng() * n);
  const isSiege = requested === 'siege';
  const isWaves = requested === 'waves';
  const key = requested;
  const target = isSiege || isWaves ? null : TARGETS[key];
  const hero = buildHero(heroName, { buffs, bridge, boons, items, tiers, unlocked, corrupted, imbues, copies });
  hero.rejuvs = isSiege ? rejuvs : 0; // Rejuvs are for the siege (his design); the Mid-Boss gives them, never takes them
  const size = CAMP_SIZE[key];
  // a camp's family: the one its details screen showed (`wanted`), else a random one of its size
  const family = !size ? null : campFamilies(key).includes(wanted) ? wanted : pickRandom(campFamilies(key), rnd);
  const grown = (stage) => ({ ...stage, enemies: () => stage.enemies().map((e) => strengthen(e, clears, key)) }); // it grows with every clear
  const stages = isWaves ? WAVES.stages : isSiege ? SIEGE.stages.map(grown) : [grown({
    name: target.name,
    enemies: () => target.enemies().map((e) => {
      if (key === 'walker' && fallen) { e.stats.maxHealth += WALKER_STEP * fallen; e.health = e.stats.maxHealth; } // tougher for every other Walker that is down
      if (family) {
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
      log.push([l.t, l.what === 'Rejuvenated' ? 'The Rejuvenator has expired.' : l.enemy ? (l.parried ? `${hero.name} parried ${l.who}'s ${l.what}` : l.dodged ? `${hero.name} dodged ${l.who}'s ${l.what}` : `${l.who} ${l.what === 'stomp' ? 'stomped' : 'cursed'} ${hero.name}`) : `${hero.name} used ${l.what}`]);
    }
    fight.enemies.forEach((e, i) => { if (!e.alive && !dead.has(i)) { dead.add(i); kills[stage]++; log.push([+fight.time.toFixed(1), `${label(fight, i)} went down`]); } });
    if (!hero.alive && !downLogged) { downLogged = true; log.push([+fight.time.toFixed(1), `${hero.name} went down`]); }
    fight.enemies.forEach((e, i) => { if (e.has('sleep')) slept.add(i); });
    if (++steps % FRAME_STEPS === 0) { frames.push(snapshot(fight, stage)); slept.clear(); }
  };

  const out = runStages(hero, stages, { rng, maxSecondsPerStage: isWaves ? WAVES.secondsPerWave : isSiege ? 900 : 600, watch });
  frames.push(snapshot(out.fight, Math.min(out.stage, stages.length - 1)));
  const killed = (n) => kills.slice(0, n).reduce((s, k) => s + (k ?? 0), 0);
  const total = isWaves ? 0 : isSiege ? SIEGE.stages.reduce((s, st) => s + st.souls, 0) : target.souls;
  if (isWaves) {
    return { key, waves: true, siege: false, hero: heroName, won: out.stage > 0, timedOut: out.timedOut, cleared: out.stage, stageNames: stages.map((s) => s.name), seconds: out.time,
      souls: wavesPay(out.stage) + payout(out.bonusSouls), itemSouls: payout(out.bonusSouls), kills: killed(out.stage), rejuvsUsed: 0, rejuvsEarned: 0, family: null, frames: downsample(frames, MAX_FRAMES), log };
  }
  return {
    key, siege: isSiege, hero: heroName, won: out.won, timedOut: out.timedOut,
    cleared: out.stage, stageNames: stages.map((s) => s.name), seconds: out.time,
    kills: out.won ? killed(stages.length) : 0, // only a won fight's kills count (legendary drops)
    souls: out.won ? Math.round(payout(total) * (family ? campMultiplier(boons) : 1) * clearSouls(clears)) + payout(out.bonusSouls) : 0, // camps pay more as the hero levels, every target as it grows
    itemSouls: out.won ? payout(out.bonusSouls) : 0, // what souls items (Trophy Collector, Cultist Sacrifice) added
    rejuvsUsed: isSiege ? rejuvs - hero.rejuvs : 0, rejuvsEarned: out.won && target ? target.rejuv || 0 : 0,
    family: family ? { key: family, name: familyName(family), size } : null,
    frames: downsample(frames, MAX_FRAMES), log,
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
  boons: progress(r.earned).level, unlocked: progress(r.earned).unlocks, points: progress(r.earned).points, tiers: r.tiers, items: Object.values(r.items).flat(), corrupted: r.corrupted ?? null, imbues: r.imbues ?? {},
  buffs: Object.entries(r.gifts ?? {}).reduce((all, [k, n]) => ({ ...all, [k]: (all[k] ?? 0) + n }), { ...r.buffs }),
  copies: roster().filter((n) => n !== r.hero && !!r.heroes?.[n]), // Sinclair copies the ultimate of one of the member's other unlocked heroes (his call, Oct 5)
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
  try {
    if (key === 'roam') {
      const haul = { ...roam(new Date(now).toISOString().slice(0, 10), rng, now), hero: claim.hero };
      await updateFarmUser(userId, (r) => { r.earned += haul.souls; for (const b of haul.buffs) r.buffs[b] = (r.buffs[b] ?? 0) + 1; if (haul.bridge && !r.bridge.includes(haul.bridge)) r.bridge.push(haul.bridge); });
      if (haul.souls) await changeSouls(userId, haul.souls, 'farm');
      return { haul };
    }
    const run = simulate(claim.hero, key, { rng, family, rejuvs: claim.rejuvs, bridge: claim.bridge, ...claim.kit });
    if (PER_LANE.has(key)) run.lane = lane;
    if (run.waves) { // a wave run: no clears, nothing goes down; the furthest they ever got is kept
      run.best = await updateFarmUser(userId, (r) => { r.earned += run.souls; r.bestWave = Math.max(r.bestWave ?? 0, run.cleared); run.legendary = dropLegendary(r, run.kills, rng); afterFight(r, run, rng); run.rival = meet(userId, r, run, rng, now); return r.bestWave; });
      if (run.souls) await changeSouls(userId, run.souls, 'farm');
      return { run };
    }
    await updateFarmUser(userId, (r) => { r.earned += run.souls; run.legendary = dropLegendary(r, run.kills, rng); afterFight(r, run, rng); if (run.won && LANED.has(key)) r.down[slot] = now + cooldownSeconds(slot) * 1000; r.clears[key] = Math.max(0, Math.min(CLEAR_CAP, (r.clears[key] ?? 0) + (run.won ? 1 : -1))); r.rejuvs = Math.max(0, Math.min(MAX_REJUVS, r.rejuvs - run.rejuvsUsed + run.rejuvsEarned));
      if (run.siege && run.won && !r.siegeTokens.includes(claim.hero)) { r.siegeTokens.push(claim.hero); r.tokens += 1; run.token = true; }
      run.rival = meet(userId, r, run, rng, now); }); // each hero's first siege win (his call, Oct 2)
    if (run.souls) await changeSouls(userId, run.souls, 'farm');
    return { run };
  } catch (error) {
    await updateFarmUser(userId, (r) => { delete r.cooldowns[slot]; r.bridge.push(...claim.bridge.filter((b) => !r.bridge.includes(b))); }); // it didn't finish, so nothing is used up
    throw error;
  }
}

// ---- encounters (his calls, Oct 2-3; the rules are in encounter.js) ----
// After a won fight (not the siege; a roam isn't a fight) a hero the member hasn't unlocked may show up: the offer is kept here, in memory, for
// OFFER_MS (his call: the rival leaves after 5 minutes; a restart just ends it). With the testing switch (cooldowns off) every won fight brings one.
const OFFER_MS = 5 * 60 * 1000;
const offers = new Map(); // user id -> { rival, until }
function meet(userId, r, run, rng = Math.random, now = Date.now()) {
  if (!run.won || run.siege) return null;
  const rival = rollRival((name) => hasHero(r, name), rng, cooldownsOn ? ENCOUNTER_CHANCE : 1);
  if (rival) offers.set(userId, { rival, until: now + OFFER_MS });
  return rival;
}
// The rival waiting for this member right now, or null.
const offerFor = (userId, now = Date.now()) => { const o = offers.get(userId); return o && o.until > now ? o.rival : null; };
// Walk Away (or the 5 minutes ran out): the offer is gone. Returns the rival that was waiting, or null.
function walkAway(userId, now = Date.now()) {
  const rival = offerFor(userId, now);
  offers.delete(userId);
  return rival;
}
// Fight: the duel is played at once (like a trip) and a win unlocks the rival, at level 0 with nothing; a loss costs nothing. Uses up the offer.
// Nothing else changes: no cooldown, souls, bridge buffs, Rejuvs or item time. Returns { run } or { error: 'gone' | 'no-hero' }.
async function fightRival(userId, { rng = Math.random, now = Date.now() } = {}) {
  const rival = walkAway(userId, now);
  if (!rival) return { error: 'gone' };
  const r = await getFarmUser(userId);
  if (!r.hero || hasHero(r, rival)) return { error: r.hero ? 'gone' : 'no-hero' };
  const kit = fightKit(r);
  const run = duel(r.hero, kit, rival, rivalKit(kit, rng), { rng });
  if (run.won) await updateFarmUser(userId, (rec) => { if (!hasHero(rec, rival)) rec.heroes[rival] = { earned: 0, tiers: {}, items: {} }; });
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

// Rolls the legendary drop for `kills` on a record (inside its update): a hero gets one at most, ever. It goes into the build, or waits
// for a free slot when the build is full. Returns { name, waiting } or null.
function dropLegendary(r, kills, rng = Math.random) {
  if (r.legendary || !kills) return null;
  const name = rollLegendary(kills, rng);
  if (!name) return null;
  r.legendary = name;
  const waiting = countItems(r.items) >= MAX_ITEMS;
  if (!waiting) r.items[SLOT_OF[itemByName(name).Slot]].push(name);
  return { name, waiting };
}

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

// Buys one of ITEM_POOL with souls from the server balance (it sells back for half, sellItem). A hero carries 12 items of any kind (MAX_ITEMS).
// An item the member owns a component of costs the difference, and the component is used up (priceFor in levels.js).
// A component of an owned item can't be bought again (heldIn). Returns { ok: true, paid, used: [components] }, { error: 'inside', holder },
// or { error: 'unknown' | 'no-hero' | 'owned' | 'full' | 'souls' | 'changed' }.
async function buyItem(userId, name) {
  const card = ITEM_POOL.includes(name) && itemByName(name);
  if (!card) return { error: 'unknown' };
  const slot = SLOT_OF[card.Slot];
  const record = await getFarmUser(userId);
  if (!record.hero) return { error: 'no-hero' };
  if (record.items[slot].includes(name)) return { error: 'owned' };
  const holder = heldIn(name, record.items);
  if (holder) return { error: 'inside', holder };
  const { price, used } = priceFor(card, record.items);
  if (record.corrupted && used.includes(record.corrupted.name)) return { error: 'corrupted', item: record.corrupted.name }; // sell it first: an upgrade would lose the corruption
  const held = (r) => (waitingLegendary(r) ? 1 : 0); // a legendary waiting for a slot gets the next free one
  if (countItems(record.items) - used.length + held(record) >= MAX_ITEMS) return { error: 'full' };
  if (!(await changeSouls(userId, -price, 'farm-shop'))) return { error: 'souls' };
  // the checks above only pick the message; this one, inside the lock, decides (two buys at once can't both take the last slot)
  const error = await updateFarmUser(userId, (r) => {
    if (r.items[slot].includes(name)) return 'owned';
    if (heldIn(name, r.items)) return 'changed';
    if (priceFor(card, r.items).price !== price) return 'changed'; // a component was sold or bought meanwhile
    if (countItems(r.items) - used.length + held(r) >= MAX_ITEMS) return 'full';
    if (r.corrupted && used.includes(r.corrupted.name)) return 'corrupted';
    for (const s of SLOTS) r.items[s] = r.items[s].filter((n) => !used.includes(n));
    for (const u of used) delete r.imbues[u];
    r.items[slot].push(name);
    if (IMBUES.includes(name)) r.imbues[name] = 1; // until the member picks (the shop asks right away)
    return null;
  });
  if (!error) return { ok: true, paid: price, used, ...(IMBUES.includes(name) ? { imbue: true } : {}) };
  await changeSouls(userId, price, 'farm-shop'); // paid for nothing: give it back
  return { error };
}

// Sells an item back for half its price (sellPrice); a waiting legendary takes the slot it frees. A legendary can't be sold.
// Returns { ok: true, refund, placed? } or { error: 'no-hero' | 'missing' | 'legendary' }.
async function sellItem(userId, name) {
  const card = itemByName(name);
  const sold = await updateFarmUser(userId, (r) => {
    if (!r.hero) return { error: 'no-hero' };
    const slot = card && SLOT_OF[card.Slot];
    if (!slot || !r.items[slot].includes(name)) return { error: 'missing' };
    if (name === r.legendary) return { error: 'legendary' };
    const refund = sellPrice(card, r.corrupted);
    if (r.corrupted?.name === name) r.corrupted = null;
    if (name === EGG.Name) r.egg = 0; // an unhatched egg's growth goes with it
    delete r.imbues[name];
    r.items[slot] = r.items[slot].filter((n) => n !== name);
    const placed = waitingLegendary(r);
    if (placed) r.items[SLOT_OF[itemByName(placed).Slot]].push(placed);
    return { ok: true, refund, ...(placed ? { placed } : {}) };
  });
  if (sold.ok) await changeSouls(userId, sold.refund, 'farm-shop');
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
  const record = await getFarmUser(userId);
  if (!record.hero) return { error: 'no-hero' };
  if (!record.items[slot].includes(name)) return { error: 'missing' };
  if (record.corrupted) return { error: 'one', name: record.corrupted.name };
  const price = corruptPrice(card);
  if (!(await changeSouls(userId, -price, 'farm-shop'))) return { error: 'souls' };
  const roll = rollDrawback(card, rng);
  const error = await updateFarmUser(userId, (r) => {
    if (r.corrupted) return 'one';
    if (!r.items[slot].includes(name)) return 'missing';
    r.corrupted = { name, ...roll };
    return null;
  });
  if (!error) return { ok: true, paid: price, ...roll };
  await changeSouls(userId, price, 'farm-shop'); // paid for nothing: give it back
  return { error };
}

// Points an owned imbue item at ability `slot` (1-4). Free, any time. Returns { ok: true } or { error: 'no-hero' | 'missing' | 'slot' }.
const setImbue = (userId, name, slot) => updateFarmUser(userId, (r) => {
  if (!r.hero) return { error: 'no-hero' };
  if (!IMBUES.includes(name) || !Object.values(r.items).flat().includes(name)) return { error: 'missing' };
  if (!(slot >= 1 && slot <= 4)) return { error: 'slot' };
  r.imbues[name] = slot;
  return { ok: true };
});

// Hatches the hero's Golden Goose Egg: it pays its 400 + what it grew, at the trip payout scale, plus one random permanent buff per 80 souls it grew in
// fights (the card: "a permanent buff per 80 souls accrued"), and is used up. Returns { ok: true, souls, buffs: [keys], placed? } or { error: 'no-hero' | 'missing' }.
async function hatchEgg(userId, rng = Math.random) {
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
    const placed = waitingLegendary(r);
    if (placed) r.items[SLOT_OF[itemByName(placed).Slot]].push(placed);
    return { ok: true, souls, buffs, ...(placed ? { placed } : {}) };
  });
  if (done.ok && done.souls) await changeSouls(userId, done.souls, 'farm');
  return done;
}

module.exports = { offerFor, walkAway, fightRival, OFFER_MS, cooldownsActive, corruptItem, setImbue, hatchEgg, afterFight, EGG, dropLegendary, PER_LANE, slotOf, isDown, walkersDown, lockedBy, SWITCH_WAIT, hasHero, switchLeft, unlockHero, switchHero, updateFarmUser, upgradeAbility, buyItem, sellItem, fightKit, setCooldowns, MAX_REJUVS, getFarmUser, chooseHero, cooldownSeconds, cooldownLeft, familyName, hauntFile, campFamilies, CAMP_SIZE, simulate, play };
