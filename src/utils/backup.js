// Daily copies of the files that hold members' souls and progress: data/backups/<UTC date>/, the newest 7 kept.
// The live files are written write-through, so a deleted or damaged file would otherwise lose everything.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, flushPending } = require('../storage/jsonAdapter');

const FILES = ['xp.json', 'xpSettings.json', 'farm.json', 'economy.json', 'hideouts.json', 'lockle.json', 'soulsLedger.jsonl'];
const KEEP_DAYS = 7;

// Copies FILES into today's folder unless it already exists. Returns the folder made, or null.
function backupToday(now = new Date()) {
  const root = path.join(DATA_DIR, 'backups');
  const dir = path.join(root, now.toISOString().slice(0, 10));
  if (fs.existsSync(dir)) return null;
  flushPending(); // chat XP is held in memory for a few seconds
  fs.mkdirSync(dir, { recursive: true });
  for (const file of FILES) {
    const from = path.join(DATA_DIR, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, file));
  }
  for (const old of fs.readdirSync(root).sort().slice(0, -KEEP_DAYS)) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  return dir;
}

module.exports = { backupToday, FILES, KEEP_DAYS };
