// The bot's own emojis: every emoji the code looks up has a picture in assets/emojis, and app emojis are written out right.
const test = require('./group')(__filename);
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FOLDER, asEmoji } = require('../src/utils/appEmojis');
const { HEROES } = require('../src/utils/heroes');

test('every emoji the bot uses has a file in assets/emojis', () => {
  const ranks = ['initiate', 'seeker', 'acolyte', 'sentinel', 'mystic', 'ritualist', 'emissary', 'oracle', 'phantom', 'ascendant', 'eternus'].map((r) => `rank_${r}`);
  const streak = ['left', 'mid', 'right'].flatMap((p) => [`streak_${p}_on`, `streak_${p}_off`]);
  const rest = ['souls', 'rejuv', 'hideout', 'archmother', 'hidden_king', 'sticky_bomb', 'power_slash', 'flying_strike', 'crimson_slash',
    'shell_live', 'shell_blank', 'charge', 'charge_lost', ...['red', 'yellow', 'green', 'blue', 'pink'].map((c) => `remling_${c}`)];
  const missing = [...HEROES.map((h) => h.slug), ...ranks, ...streak, ...rest].filter((n) => !fs.existsSync(path.join(FOLDER, `${n}.png`)));
  assert.deepStrictEqual(missing, []);
  for (const f of fs.readdirSync(FOLDER)) assert.ok(fs.statSync(path.join(FOLDER, f)).size <= 256 * 1024, `${f} is over Discord's 256 KB`);
});

test('every fight ability and every item has its icon emoji (else run node tools/icon-emojis.js)', () => {
  const { abilityEmojiName, itemEmojiName } = require('../src/utils/farm/icons');
  const { ITEM_POOL, LEGENDARY_NAMES } = require('../src/utils/farm/levels');
  const abilities = Object.values(require('../assets/farm/abilities.json')).map((a) => abilityEmojiName(a.Name));
  const missing = [...abilities, ...[...ITEM_POOL, ...LEGENDARY_NAMES].map(itemEmojiName)].filter((n) => !fs.existsSync(path.join(FOLDER, `${n}.png`)));
  assert.deepStrictEqual(missing, []);
});

test('the icon line and its fields', () => {
  const { iconLine, statusWord, splitField, loadoutFields } = require('../src/utils/farm/icons');
  assert.strictEqual(iconLine('<:a_x:1>', 'Sleep Dagger', 0, 'Cooldown 4s'), '<:a_x:1> : Sleep Dagger : Cooldown 4s');
  assert.strictEqual(iconLine('<:i_x:1>', 'Glass Cannon', 3, 'Passive'), '<:i_x:1> : Glass Cannon : 3 Stacks : Passive');
  assert.strictEqual(iconLine('', 'Gun', 0, 'Active'), 'Gun : Active');
  assert.deepStrictEqual([statusWord('12s'), statusWord('Ready'), statusWord('Ready x2'), statusWord('Passive')], ['Cooldown `12s`', 'Active', 'Active `x2`', 'Passive']);
  const fields = splitField('Items', Array.from({ length: 30 }, () => 'x'.repeat(100)));
  assert.ok(fields.length > 1 && fields.every((f) => f.value.length <= 1024) && fields[0].name === 'Items');
  assert.deepStrictEqual(loadoutFields({ abilities: [{ name: 'Sleep Dagger', status: 'Ready', stacks: 0 }] }).map((f) => f.name), ['Abilities']); // a frame from before Nov 4 has no items
});

test('an app emoji prints like a server emoji', () => {
  const e = asEmoji({ id: '123', name: 'souls' });
  assert.strictEqual(`${e}`, '<:souls:123>');
  assert.strictEqual(e.imageURL(), 'https://cdn.discordapp.com/emojis/123.png');
});
