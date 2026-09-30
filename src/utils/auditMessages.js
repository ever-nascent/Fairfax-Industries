// Message memory for the audit log: the last 7 days of messages (text, mentions, image/GIF copies) saved in data/,
// so deleted and edited messages can still be shown after a restart. Our own bot's messages are only marked,
// so its deletes can be skipped.
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../storage/jsonAdapter');

const FILE = path.join(DATA_DIR, 'auditMessages.json');
const FILES_DIR = path.join(DATA_DIR, 'auditFiles');
const KEEP_MS = 7 * 24 * 60 * 60_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // the bot's upload limit

let messages = null; // message id → saved message
let dirty = false;

function all() {
  if (messages) return messages;
  try {
    messages = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    messages = {}; // no file yet (or unreadable): start fresh, it's only a cache
  }
  setInterval(save, 30_000).unref();
  process.on('exit', save);
  return messages;
}

function deleteCopies(saved) {
  for (const f of saved?.files ?? []) if (f.copy) fs.rmSync(path.join(FILES_DIR, f.copy), { force: true });
}

// Drops messages older than 7 days, then writes the file if anything changed.
// ponytail: rewrites the whole file every 30 s; fine for a community server, a database if it ever gets huge.
function save() {
  if (!messages) return;
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, saved] of Object.entries(messages)) {
    if (saved.at >= cutoff) continue;
    deleteCopies(saved);
    delete messages[id];
    dirty = true;
  }
  if (!dirty) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // temp file + rename, like the main store: a crash mid-write can't leave half a file (which would wipe the memory)
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(messages));
  fs.renameSync(`${FILE}.tmp`, FILE);
  dirty = false;
}

// Who a message pings, minus its author (for the ghost ping flag).
function mentionsOf(message) {
  const users = [...message.mentions.users.keys()].filter((id) => id !== message.author.id);
  const roles = [...message.mentions.roles.keys()];
  const everyone = message.mentions.everyone;
  return users.length || roles.length || everyone ? { users, roles, everyone } : null;
}

// What the log shows about an attachment (never its link: that dies with the message).
const fileInfo = (a) => ({
  id: a.id, name: a.name, size: a.size, type: a.contentType, width: a.width, height: a.height,
  seconds: a.duration, spoiler: a.spoiler, alt: a.description,
});

async function remember(message) {
  const saved = all();
  if (message.author.id === message.client.user.id) {
    saved[message.id] = { own: true, at: message.createdTimestamp };
    dirty = true;
    return;
  }
  const entry = {
    author: message.author.id,
    username: message.author.username,
    channel: message.channelId,
    at: message.createdTimestamp,
    content: message.content,
    mentions: mentionsOf(message),
    files: message.attachments.map(fileInfo),
    stickers: message.stickers.map((s) => s.name),
  };
  saved[message.id] = entry;
  dirty = true;

  // Copy images and GIFs now: Discord removes the file once the message is deleted.
  const attachments = [...message.attachments.values()];
  for (const [i, a] of attachments.entries()) {
    if (!a.contentType?.startsWith('image/') || a.size > MAX_IMAGE_BYTES) continue;
    const response = await fetch(a.url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!response?.ok) continue;
    const copy = `${message.id}-${i}${path.extname(a.name) || '.png'}`;
    fs.mkdirSync(FILES_DIR, { recursive: true });
    const data = await response.arrayBuffer().catch(() => null); // a timeout can also hit while the body downloads
    if (!data) continue;
    fs.writeFileSync(path.join(FILES_DIR, copy), Buffer.from(data));
    // Deleted while downloading: its log entry has gone out already, so the copy isn't needed.
    if (all()[message.id] !== entry) {
      fs.rmSync(path.join(FILES_DIR, copy), { force: true });
      continue;
    }
    entry.files[i].copy = copy;
    dirty = true;
  }
}

const get = (id) => all()[id] ?? null;

// Keeps the saved text and mentions in step with an edit.
function update(message) {
  const saved = get(message.id);
  if (!saved || saved.own) return;
  saved.content = message.content;
  saved.mentions = mentionsOf(message);
  dirty = true;
}

// Removes a deleted message and returns what was saved. Call `deleteCopies` once its images are posted.
function take(id) {
  const saved = get(id);
  if (saved) {
    delete messages[id];
    dirty = true;
  }
  return saved;
}

const copyPath = (file) => path.join(FILES_DIR, file.copy);

module.exports = { remember, get, update, take, deleteCopies, copyPath, mentionsOf, fileInfo, save };
