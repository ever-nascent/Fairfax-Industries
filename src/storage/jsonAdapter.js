const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { withLock } = require('./mutex');

// DATA_DIR env var lets tests use a throwaway folder instead of the live data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

function filePathFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

// Each collection is read from disk once and kept in memory; every write goes to disk too (write-through).
// Only this process writes data/, so the copy can't go stale. Callers get clones, so nothing they do to a
// returned value changes the cache without going through set/update.
const cache = new Map(); // collection -> parsed data
const pending = new Set(); // collections changed in memory but not yet on disk (deferred writes)
let flushTimer = null;
const FLUSH_MS = 5000;

function readCollection(collection) {
  if (!cache.has(collection)) {
    const filePath = filePathFor(collection);
    cache.set(collection, fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}') : {});
  }
  return cache.get(collection);
}

// Writes every collection with deferred changes, synchronously (also runs on exit).
function flushPending() {
  clearTimeout(flushTimer);
  flushTimer = null;
  for (const collection of pending) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(filePathFor(collection), JSON.stringify(cache.get(collection), null, 2));
    } catch (error) {
      console.error(`[storage] Could not save ${collection}:`, error.message);
      continue;
    }
    pending.delete(collection);
  }
}
process.on('exit', flushPending);

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];

// Write to a temp file then rename so a crash mid-write can't truncate or
// corrupt the live collection file (rename is atomic on the same filesystem).
// On Windows the rename can transiently fail with EPERM/EBUSY while antivirus
// or the search indexer holds the destination file — retry with backoff, then
// fall back to a plain copy (non-atomic, but far better than losing the write
// or crashing the caller).
async function writeCollection(collection, data) {
  pending.delete(collection); // this write carries any deferred changes too
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
      return structuredClone(readCollection(collection)[key] ?? null);
    },
    async set(key, value) {
      return withLock(collection, async () => {
        const data = readCollection(collection);
        data[key] = structuredClone(value);
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
    // concurrent updates can't lose each other's writes. If `mutator` returns the
    // value it was given unchanged, nothing is written.
    // `defer: true`: the change is kept in memory and written within FLUSH_MS (or by the next normal write to
    // this collection, or on exit). Only for changes that can be lost in a crash, like chat XP.
    async update(key, mutator, { defer = false } = {}) {
      return withLock(collection, async () => {
        const data = readCollection(collection);
        const current = structuredClone(data[key] ?? null);
        const next = mutator(current);
        if (next === current) return next;
        data[key] = structuredClone(next);
        if (!defer) return writeCollection(collection, data).then(() => next);
        pending.add(collection);
        flushTimer ??= setTimeout(flushPending, FLUSH_MS).unref();
        return next;
      });
    },
    // Deletes `key` if `predicate(value)` holds, inside the lock, so nothing can change it in between.
    // Returns the deleted value, or null.
    async take(key, predicate) {
      return withLock(collection, async () => {
        const data = readCollection(collection);
        const current = structuredClone(data[key] ?? null);
        if (!current || !predicate(current)) return null;
        delete data[key];
        await writeCollection(collection, data);
        return current;
      });
    },
    async all() {
      return structuredClone(readCollection(collection));
    },
  };
}

module.exports = { createJsonStore, DATA_DIR, flushPending };
