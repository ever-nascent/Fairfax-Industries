// One knob for the whole souls economy (his call, Oct 2: souls are one universal currency, x10 everywhere). Every faucet (/urn, level-ups,
// /trivia, Lockle, farm trips) and every price (Shop, Hideout, game minimum bets) is written as "the old number x SCALE", so they stay in step.
// Since Oct 11 Hero Farming's souls are each hero's own, apart from the server balance (his call; moveToHeroes below).
// Hero Farming's item prices are the wiki's own and are NOT scaled; the souls the economy pays are what grew to meet them.
const { getStore } = require('../storage');

const SCALE = 10;

// A copy of the souls files in data/economy-backup/ before a migration changes them.
function backupFiles(tag) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DATA_DIR } = require('../storage/jsonAdapter');
  const backup = path.join(DATA_DIR, 'economy-backup');
  fs.mkdirSync(backup, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of ['xp.json', 'farm.json']) {
    const from = path.join(DATA_DIR, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(backup, `${stamp}${tag ? `-${tag}` : ''}-${file}`));
  }
}

// Run once at startup: when SCALE went up since the last run, members' balances and hero progress (each hero's own souls, and the farm souls
// earned, which sets the level) grow by the same factor, after a backup copy of both files. The stored scale makes it run only once per increase.
async function migrate() {
  const settings = getStore('economy');
  const before = (await settings.get('scale')) ?? 1;
  if (before >= SCALE) return false;
  const factor = SCALE / before;
  backupFiles();
  const xp = getStore('xp');
  for (const id of Object.keys(await xp.all())) await xp.update(id, (u) => ({ ...u, souls: Math.round((u.souls || 0) * factor) }));
  const farm = getStore('farm');
  const grow = (p) => ({ ...p, earned: Math.round((p.earned || 0) * factor), ...('souls' in p ? { souls: Math.round(p.souls * factor) } : {}) });
  for (const id of Object.keys(await farm.all())) { // every hero's progress (older records keep one `earned` on the member)
    await farm.update(id, (r) => ({ ...('earned' in r ? grow(r) : r), heroes: Object.fromEntries(Object.entries(r.heroes ?? {}).map(([name, p]) => [name, grow(p)])) }));
  }
  await settings.set('scale', SCALE);
  console.log(`[economy] Souls scale ${before} -> ${SCALE}: balances and hero progress x${factor} (backup in data/economy-backup)`);
  return true;
}

// Run once at startup, after `migrate` (his calls, Oct 11): Hero Farming souls became each hero's own, so every member who has a hero gets
// their whole server balance moved into Haze's own souls (the only hero anyone had played; their current hero if they have no Haze), after a
// backup copy of both files. Their buffs, Rejuvs, growth, cooldowns and lanes, shared until now, go to the same hero (farm/play.js `load`);
// every farm record is rewritten in the per-hero layout. Both sides of each move are lines in the souls ledger ('farm-move').
async function moveToHeroes() {
  const settings = getStore('economy');
  if (await settings.get('heroSouls')) return false;
  backupFiles('hero-souls');
  const { getUser, changeSouls } = require('./xp');
  const { updateFarmUser, updateHero, hasHero, OLD_OWNER } = require('./farm/play');
  const ledger = require('./soulsLedger');
  const farm = getStore('farm');
  let members = 0;
  let moved = 0;
  for (const id of Object.keys(await farm.all())) {
    const r = await updateFarmUser(id, (record) => record); // read and written back in the new layout
    if (!r.hero) continue;
    const to = hasHero(r, OLD_OWNER) ? OLD_OWNER : r.hero;
    const { souls } = await getUser(id);
    if (!(souls > 0) || !(await changeSouls(id, -souls, 'farm-move'))) continue;
    const after = await updateHero(id, to, (h) => { h.souls += souls; return h.souls; });
    ledger.record(id, souls, { reason: 'farm-move', hero: to }, after);
    members++;
    moved += souls;
  }
  await settings.set('heroSouls', true);
  console.log(`[economy] Hero souls: moved ${moved} souls of ${members} members into their heroes (backup in data/economy-backup)`);
  return true;
}

module.exports = { SCALE, migrate, moveToHeroes };
