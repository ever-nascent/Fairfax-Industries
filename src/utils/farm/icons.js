// The ability and item emojis (Nov 4, his ask) and the line they sit in, his format: "Emoji : Name : Stack N : Cooldown/Active" (the
// Stack part only when there are stacks). Pictures: assets/emojis/a_<ability>.png and i_<item>.png, made by tools/icon-emojis.js.
const { emojiNamed } = require('../guild');

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const abilityEmojiName = (name) => `a_${slug(name)}`.slice(0, 32);
const itemEmojiName = (name) => `i_${slug(name)}`.slice(0, 32);

// The emoji as text, or '' when the bot has none.
const abilityIcon = (name) => `${emojiNamed(null, abilityEmojiName(name)) ?? ''}`;
const itemIcon = (name) => `${emojiNamed(null, itemEmojiName(name)) ?? ''}`;
// A map icon (Cursed Apple page, Nov 4): a bridge buff's power-up by its BRIDGE key, or 'teleporter' / 'curiosity_shop' / 'vault_camp'. '' when missing.
const powerupIcon = (key) => `${emojiNamed(null, `powerup_${key}`) ?? ''}`;
const mapIcon = (name) => emojiNamed(null, name);
// "<power-up> **Gun Bridge Buff**"-style label: the icon, then the text.
const withIcon = (icon, text) => [`${icon ?? ''}`, text].filter(Boolean).join(' ');
// Either, for a name that may be an ability or an item (the Damage Breakdown's lines).
const iconOf = (name) => abilityIcon(name) || itemIcon(name);

// One line: "<icon> : Name : Stack 3 : Cooldown 4s".
// Stacks read "3 Stacks" (his ask, Nov 4), between the name and the rest.
const iconLine = (icon, name, stacks, status) => [icon, name, stacks ? `${stacks} Stack${stacks === 1 ? '' : 's'}` : '', status].filter(Boolean).join(' : ');

// The fight's status words in his format: "12s" -> "Cooldown 12s", "Ready" -> "Active" ("Ready x2" -> "Active x2"); a hero's own wording
// (Passive, +30% Weapon, 50% ...) is kept.
// A cooldown number in one backtick each, Discord's code style (his ask, Nov 5): "Cooldown `12s`".
const cooldownText = (s) => `Cooldown \`${s}\``;
// A cooldown at the start ("4s  -  3 Marked") or after the charges ("Ready x1  -  4s") gets the same; "5s Left" / "Wolf 5s" are durations, kept.
// The charges in backticks too (his ask, Nov 6): "Active `x2`".
const statusWord = (s) => s.replace(/^Ready/, 'Active').replace(/^(\d+s)(?=$|  -  )|(?<=^Active x\d+  -  )(\d+s)$/, (t) => cooldownText(t)).replace(/^Active (x\d+)/, 'Active `$1`');

// The stacks an ability or item holds right now (a number on it: `stacks`, Glass Cannon's `kills`, an ability's kill count), or 0.
const stacksOf = (x) => [x.stacks, x.kills].find((n) => typeof n === 'number' && n > 0) ?? 0;

// An item's state in a fight: the time left on its cooldown (an active's, or a passive proc's), else "Active" for an active item that is
// ready, "Passive" for the rest.
const itemStatus = (it) => {
  const left = Math.max(it.cdLeft ?? 0, it.procLeft ?? 0);
  if (left > 0) return cooldownText(`${Math.ceil(left)}s`);
  return it.active ? 'Active' : 'Ready'; // a passive with a proc timer that is ready
};
// Whether an item has anything to show in a fight or on the hero screen (his ask, Nov 4: a plain passive has no charges or cooldowns, so it is left
// out): an active, a passive with its own cooldown or charge-up (a proc), or stacks right now.
const timed = (it) => !!it && (it.active || it.infos.some((i) => i.Cooldown || i.ChargeUp));
const shown = (it) => !!it && (timed(it) || stacksOf(it) > 0);

// The hero screen (out of a fight): an active item says Active with its cooldown, a passive with a proc timer its cooldown, the rest Passive.
const itemOutOfFight = (it) => {
  const cd = Math.round(it.cooldown || 0);
  return it.active ? `Active${cd ? ` (${cooldownText(`${cd}s`)})` : ''}` : it.infos.some((i) => i.Cooldown) && cd ? cooldownText(`${cd}s`) : 'Passive';
};
// An ability on the hero screen: Locked, its cooldown, or Passive (no cooldown).
const abilityOutOfFight = (a, locked) => {
  if (locked) return 'Locked';
  const cd = Math.round(a.cooldown || 0);
  return cd ? cooldownText(`${cd}s`) : 'Passive';
};

// The fight message's Abilities and Items fields from one snapshot (frames before Nov 4 have no items). Long lists are split into fields
// of at most 1,024 characters (Discord's limit).
function loadoutFields(frame) {
  const abilities = frame.abilities.map((a) => iconLine(abilityIcon(a.name), a.name, a.stacks, statusWord(a.status)));
  const items = (frame.items ?? []).map((it) => iconLine(itemIcon(it.name), it.name, it.stacks, it.status));
  return [...splitField('Abilities', abilities.length ? abilities : ['None']), ...(items.length ? splitField('Items', items) : [])];
}
function splitField(name, lines) {
  const fields = [];
  for (const line of lines) {
    const last = fields.at(-1);
    if (last && last.value.length + 1 + line.length <= 1024) last.value += `\n${line}`;
    else fields.push({ name: fields.length ? '​' : name, value: line.slice(0, 1024) });
  }
  return fields;
}

// Every item a built hero holds, as [name, its Item object or undefined for a plain-stat item] (hero.js: `held` is every name).
const heldItems = (hero) => (hero.held ?? hero.items.map((it) => it.name)).map((name) => [name, hero.items.find((it) => it.name === name)]);

// What a snapshot keeps of a hero's abilities and items (play.js simulate, encounter.js duel).
const loadoutOf = (hero, fight) => ({
  abilities: hero.abilities.filter((a) => !a.hidden).map((a) => ({ name: a.name, status: a.status(fight), stacks: stacksOf(a) })), // hidden: an ultimate Sinclair copied
  items: heldItems(hero).filter(([, it]) => shown(it)).map(([name, it]) => ({ name, status: timed(it) ? itemStatus(it) : '', stacks: stacksOf(it) })), // a plain passive is left out
});

module.exports = { powerupIcon, mapIcon, withIcon, slug, abilityEmojiName, itemEmojiName, abilityIcon, itemIcon, iconOf, iconLine, statusWord, stacksOf, itemStatus, itemOutOfFight, abilityOutOfFight, loadoutFields, splitField, loadoutOf, heldItems, timed, shown };
