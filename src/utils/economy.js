// One knob for the whole souls economy (his call, Oct 2: souls are one universal currency, x10 everywhere). Every faucet (/urn, level-ups,
// /trivia, Lockle, farm trips) and every price (Shop, Hideout, game minimum bets) is written as "the old number x SCALE", so they stay in step.
// Hero Farming's item prices are the wiki's own and are NOT scaled; the souls the economy pays are what grew to meet them.
const { getStore } = require('../storage');

const SCALE = 10;

// Run once at startup: when SCALE went up since the last run, members' balances and hero progress (farm souls earned, which sets the level)
// grow by the same factor, after a backup copy of both files. The stored scale makes it run only once per increase.
async function migrate() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DATA_DIR } = require('../storage/jsonAdapter');
  const settings = getStore('economy');
  const before = (await settings.get('scale')) ?? 1;
  if (before >= SCALE) return false;
  const factor = SCALE / before;
  const backup = path.join(DATA_DIR, 'economy-backup');
  fs.mkdirSync(backup, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of ['xp.json', 'farm.json']) {
    const from = path.join(DATA_DIR, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(backup, `${stamp}-${file}`));
  }
  const xp = getStore('xp');
  for (const id of Object.keys(await xp.all())) await xp.update(id, (u) => ({ ...u, souls: Math.round((u.souls || 0) * factor) }));
  const farm = getStore('farm');
  const grow = (p) => ({ ...p, earned: Math.round((p.earned || 0) * factor) });
  for (const id of Object.keys(await farm.all())) { // every hero's progress (older records keep one `earned` on the member)
    await farm.update(id, (r) => ({ ...('earned' in r ? grow(r) : r), heroes: Object.fromEntries(Object.entries(r.heroes ?? {}).map(([name, p]) => [name, grow(p)])) }));
  }
  await settings.set('scale', SCALE);
  console.log(`[economy] Souls scale ${before} -> ${SCALE}: balances and hero progress x${factor} (backup in data/economy-backup)`);
  return true;
}

module.exports = { SCALE, migrate };
