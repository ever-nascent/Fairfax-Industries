// Requests to deadlock.wiki, paced (Oct 16: his first startup check sent ~50 page requests back to back; the wiki timed one out and
// then answered 403). One request at a time with WIKI_GAP_MS between them, and a refused, overloaded or timed-out request waits and
// tries again (RETRY_WAITS_MS, longer when the wiki says Retry-After). Hands back the Response; the caller checks `ok`.
const { setTimeout: sleep } = require('node:timers/promises');

const WIKI_GAP_MS = Number(process.env.WIKI_GAP_MS ?? 1000);
const RETRY_WAITS_MS = (process.env.WIKI_RETRY_WAITS_MS ?? '10000,30000').split(',').map(Number);
const AGAIN = new Set([403, 429, 500, 502, 503, 504]);

let last = 0;
async function wikiFetch(url, { userAgent, timeoutMs = 60_000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const wait = last + WIKI_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res = null;
    let error = null;
    try {
      res = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      error = e;
    }
    if (res && !AGAIN.has(res.status)) return res;
    if (attempt >= RETRY_WAITS_MS.length) {
      if (res) return res;
      throw error;
    }
    const after = Number(res?.headers.get('retry-after')) * 1000;
    const pause = Math.max(RETRY_WAITS_MS[attempt], Number.isFinite(after) ? after : 0);
    await res?.body?.cancel().catch(() => {});
    console.log(`  deadlock.wiki ${res ? `answered ${res.status}` : `didn't answer (${error.message})`}; trying again in ${Math.round(pause / 1000)} s`);
    await sleep(pause);
  }
}

module.exports = { wikiFetch, WIKI_GAP_MS };
