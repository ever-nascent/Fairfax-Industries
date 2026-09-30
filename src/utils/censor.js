// Censor: staff-chosen phrases get deleted, the author gets a warning in the Shopkeeper's voice.
const { getStore } = require('../storage');

const store = () => getStore('censor'); // { [guildId]: [phrases] }

// The Shopkeeper's warnings. They never repeat the phrase (that would just post it again).
const WARN_LINES = [
  "Hey, hey, hey! That kinda language ain't allowed in my shop. Watch your mouth or take it outside.",
  "Not in here, pal. I run a clean joint. Say that again and I'm showin' you the door.",
  "Whoa, whoa. I got customers with delicate ears. Keep it civil or keep walkin'.",
  "I heard that. I'm not deaf, I'm just busy. Clean it up, or the next one's on your tab.",
  "Kid, I sell relics, not swear words. That kinda talk stays outside my shop.",
];

// Lowercase, accents stripped, so "FÜCK" and "fuck" are the same word.
const normalize = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The first phrase found in `text` as a whole word / phrase ("ass" doesn't catch "class"), or null.
// ponytail: whole words only, so "fucking" needs its own entry; add wildcards if that gets tedious.
function findPhrase(text, phrases) {
  const t = normalize(text);
  return phrases.find((p) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(p)}(?![\\p{L}\\p{N}])`, 'u').test(t)) ?? null;
}

const getPhrases = async (guildId) => (await store().get(guildId)) ?? [];

// Returns false if it was already on the list.
async function addPhrase(guildId, phrase) {
  const p = normalize(phrase);
  let added = false;
  await store().update(guildId, (list) => {
    list = list ?? [];
    if (list.includes(p)) return list;
    added = true;
    return [...list, p];
  });
  return added;
}

// Returns false if it wasn't on the list.
async function removePhrase(guildId, phrase) {
  const p = normalize(phrase);
  let removed = false;
  await store().update(guildId, (list) => {
    list = list ?? [];
    if (!list.includes(p)) return list;
    removed = true;
    return list.filter((x) => x !== p);
  });
  return removed;
}

module.exports = { WARN_LINES, findPhrase, getPhrases, addPhrase, removePhrase };
