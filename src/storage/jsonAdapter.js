const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { withLock } = require('./mutex');

// DATA_DIR env var lets tests use a throwaway folder instead of the live data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

function filePathFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readCollection(collection) {
  const filePath = filePathFor(collection);
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
}

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];

// Write to a temp file then rename so a crash mid-write can't truncate or
// corrupt the live collection file (rename is atomic on the same filesystem).
// On Windows the rename can transiently fail with EPERM/EBUSY while antivirus
// or the search indexer holds the destination file — retry with backoff, then
// fall back to a plain copy (non-atomic, but far better than losing the write
// or crashing the caller).
async function writeCollection(collection, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = filePathFor(collection);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));

  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (error) {
      if (RETRYABLE_RENAME_CODES.has(error.code) && attempt < RENAME_RETRY_DELAYS_MS.length) {
        await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      try {
        fs.copyFileSync(tmpPath, filePath);
        fs.unlinkSync(tmpPath);
        return;
      } catch {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // Best-effort cleanup — the rename/copy failure below is the real
          // error, and a leftover temp file must not mask it.
        }
        throw error;
      }
    }
  }
}

function createJsonStore(collection) {
  return {
    async get(key) {
      return readCollection(collection)[key] ?? null;
    },
    async set(key, value) {
      return withLock(collection, async () => {
        const data = readCollection(collection);
        data[key] = value;
        await writeCollection(collection, data);
        return value;
      });
    },
    async delete(key) {
      return withLock(collection, async () => {
        const data = readCollection(collection);
        delete data[key];
        await writeCollection(collection, data);
      });
    },
    // Atomically read the current value for a key, run it through `mutator`, and
    // persist the result. The whole sequence holds the collection lock, so
    // concurrent updates can't lose each other's writes.
    async update(key, mutator) {
      return withLock(collection, async () => {
        const data = readCollection(collection);
        const next = mutator(data[key] ?? null);
        data[key] = next;
        await writeCollection(collection, data);
        return next;
      });
    },
    // Atomically read several keys, run them through `mutator`, and persist the
    // result. `mutator` receives an object of { key: value|null } for the
    // requested keys and returns an object of the keys to write (null/undefined
    // values are skipped, so a no-op path can return the input untouched). The
    // whole sequence holds the collection lock, so a multi-key change like a
    // balance transfer can't be split or interleaved with other writes.
    async updateMany(keys, mutator) {
      return withLock(collection, async () => {
        const data = readCollection(collection);
        const current = Object.fromEntries(keys.map((key) => [key, data[key] ?? null]));
        const next = mutator(current);
        for (const key of Object.keys(next)) {
          if (next[key] != null) data[key] = next[key];
        }
        await writeCollection(collection, data);
        return next;
      });
    },
    async all() {
      return readCollection(collection);
    },
  };
}

module.exports = { createJsonStore };
