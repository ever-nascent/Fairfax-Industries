// The bot's own emojis: every picture in assets/emojis/<name>.png is uploaded as an application emoji, which the
// bot can show in any server (server emojis only showed where the bot shares the server). Run by src/index.js before the bot logs in:
// a missing one is uploaded, one whose file changed is replaced (the sha1 of each uploaded file is kept in data/appEmojis.json).
// Emojis left in the app with no file are kept. Never fatal: lookups fall back to the server's emojis (guild.js emojiNamed).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

const FOLDER = path.join(__dirname, '..', '..', 'assets', 'emojis');
const RECORD = path.join(DATA_DIR, 'appEmojis.json');
const byName = new Map(); // name -> { id, name, animated, toString(), imageURL() }

const asEmoji = ({ id, name, animated }) => ({
  id, name, animated: !!animated,
  toString: () => `<${animated ? 'a' : ''}:${name}:${id}>`,
  imageURL: () => `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`,
});

async function discord(method, route, body) {
  for (;;) {
    const res = await fetch(`https://discord.com/api/v10${route}`, {
      method, signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = ((await res.json().catch(() => ({}))).retry_after ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Discord answered ${res.status} (${(await res.json().catch(() => ({}))).message ?? res.statusText})`);
    return res.status === 204 ? null : res.json();
  }
}

async function syncAppEmojis() {
  const appId = (await discord('GET', '/applications/@me')).id;
  const live = new Map((await discord('GET', `/applications/${appId}/emojis`)).items.map((e) => [e.name, e]));
  let record = {};
  try { record = JSON.parse(fs.readFileSync(RECORD, 'utf8')); } catch { /* first run */ }
  const made = [], replaced = [];
  for (const file of fs.readdirSync(FOLDER).filter((f) => f.endsWith('.png'))) {
    const name = file.slice(0, -4);
    const png = fs.readFileSync(path.join(FOLDER, file));
    const sha1 = crypto.createHash('sha1').update(png).digest('hex');
    const old = live.get(name);
    if (old && (record[name] ?? sha1) === sha1) { record[name] = sha1; continue; } // an emoji with no record is taken as this file
    try {
      if (old) await discord('DELETE', `/applications/${appId}/emojis/${old.id}`); // names are unique, so the old one goes first
      live.set(name, await discord('POST', `/applications/${appId}/emojis`, { name, image: `data:image/png;base64,${png.toString('base64')}` }));
      record[name] = sha1;
      (old ? replaced : made).push(name);
    } catch (e) {
      if (old) live.delete(name);
      console.error(`[emojis] :${name}: failed:`, e.message);
    }
  }
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, JSON.stringify(record));
  byName.clear();
  for (const e of live.values()) byName.set(e.name, asEmoji(e));
  if (made.length) console.log(`[emojis] Uploaded ${made.length}: ${made.join(', ')}`);
  if (replaced.length) console.log(`[emojis] Replaced ${replaced.length}: ${replaced.join(', ')}`);
  console.log(`[emojis] ${byName.size} app emojis ready`);
}

const appEmoji = (name) => byName.get(name);
// Fills the lookup without Discord (tests and the smoke tools: full-length emoji text when checking Discord's limits).
const useAppEmojis = (list) => { for (const e of list) byName.set(e.name, asEmoji(e)); };

module.exports = { syncAppEmojis, appEmoji, asEmoji, useAppEmojis, FOLDER };
