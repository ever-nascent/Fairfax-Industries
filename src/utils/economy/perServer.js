// One-time move to a per-server economy (the bot goes public, every server has its own souls, XP and progress).
// Until then member data was saved under the user id alone, because the bot served one server. Now it is saved under `<server id>:<user id>`
// (storage/index.js), so everything saved so far becomes Fairfax's. Run once at startup, before anything reads the data:
//   1. copy the files into data/pre-per-server-backup/<time>/ (if this fails nothing is changed and the bot does not start);
//   2. rekey every member entry of the xp, farm, quests, lockle and hideouts stores (a key that already has a ':' is done; Lockle's shared 'daily' build stays);
//   3. stamp the games still in progress with their server (they are paid back in that server when they time out);
//   4. remember it is done (`perServer` in the economy store). Running it again changes nothing.
// The souls ledger is not rewritten: a line without a server (`g`) counts as Fairfax's (soulsLedger.js).
const fs = require('node:fs');
const path = require('node:path');
const { getRawStore, PER_SERVER } = require('../../storage');
const { DATA_DIR, flushPending } = require('../../storage/jsonAdapter');
const { GUILD_ID } = require('../../config');

const KEPT = { lockle: ['daily'] }; // keys in a per-server store that belong to no member
const GAME_STORES = ['doormanGames', 'blackjackGames', 'hatGames', 'clockGames', 'minesGames', 'kegGames', 'duelGames', 'rouletteGames', 'remlingGames', 'pocketGames', 'hangmanGames', 'interrogationGames'];

function backupFiles() {
  flushPending();
  const dir = path.join(DATA_DIR, 'pre-per-server-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const files = [...PER_SERVER, ...GAME_STORES, 'economy'].map((name) => `${name}.json`).concat(['soulsLedger.jsonl', 'soulsLedger.1.jsonl']);
  for (const file of files) {
    const from = path.join(DATA_DIR, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file));
  }
  return dir;
}

async function migratePerServer() {
  const economy = getRawStore('economy');
  if (await economy.get('perServer')) return false;
  const dir = backupFiles();
  const counts = {};
  for (const name of PER_SERVER) {
    const store = getRawStore(name);
    const entries = Object.entries(await store.all());
    const next = {};
    let moved = 0;
    for (const [key, value] of entries) {
      if (key.includes(':') || KEPT[name]?.includes(key)) next[key] = value;
      else { next[`${GUILD_ID}:${key}`] = value; moved++; }
    }
    if (moved) await store.replaceAll(next);
    counts[name] = moved;
  }
  let games = 0;
  for (const name of GAME_STORES) {
    const store = getRawStore(name);
    const all = await store.all();
    const open = Object.entries(all).filter(([, g]) => g && !g.guildId);
    if (!open.length) continue;
    await store.replaceAll({ ...all, ...Object.fromEntries(open.map(([id, g]) => [id, { ...g, guildId: GUILD_ID }])) });
    games += open.length;
  }
  await economy.set('perServer', true);
  console.log(`[per-server] Member data now saved per server: ${Object.entries(counts).map(([n, c]) => `${c} ${n}`).join(', ')}; ${games} game(s) in progress stamped (backup in ${dir})`);
  return true;
}

module.exports = { migratePerServer };
