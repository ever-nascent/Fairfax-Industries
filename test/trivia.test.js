// Run: node --test
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'fairfax-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { getStore } = require('../src/storage');
const { getUser } = require('../src/utils/xp');
const tv = require('../src/utils/trivia');
const { HEROES } = require('../src/utils/heroes');

test('the trivia data covers every hero: lines, and 4 abilities with icons', () => {
  const data = tv.heroes();
  assert.deepStrictEqual(data.map((h) => h.slug).sort(), HEROES.map((h) => h.slug).sort());
  for (const h of data) {
    assert.ok(h.lines.length >= 20, h.name);
    assert.strictEqual(h.abilities.length, 4, h.name);
    for (const a of h.abilities) assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'assets', 'trivia', 'abilities', a.icon)), a.icon);
  }
});

test('every question type makes valid questions: different choices (4 buttons or a full dropdown), one right answer, labels fit', () => {
  for (const type of Object.values(tv.MODES).flat()) {
    for (let n = 0; n < 500; n++) {
      const q = tv.makeQuestion(type);
      if (q.typed) {
        assert.ok(q.reveal && q.art, type);
        continue;
      }
      const size = q.menu && tv.MODES.items.includes(type) ? tv.MENU_SIZE : 4; // item dropdowns have MENU_SIZE, the rest 4
      assert.strictEqual(q.choices.length, size, type);
      assert.strictEqual(new Set(q.choices.map((c) => c.label.toLowerCase())).size, size, `${type}: duplicate choice`);
      assert.ok(q.answer >= 0 && q.answer < size, type);
      for (const c of q.choices) assert.ok(c.label.length <= tv.MAX_LABEL, `${type}: ${c.label}`);
    }
  }
  assert.deepStrictEqual(tv.splitLine('one two three four five six seven'), ['one two three four', 'five six seven']);
});

test('the item data: shop items with art, cost matching the tier', () => {
  const items = tv.items();
  assert.ok(items.length >= 100);
  for (const i of items) {
    assert.strictEqual(i.cost, [800, 1600, 3200, 6400][i.tier - 1], i.name);
    assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'assets', 'trivia', 'items', i.icon)), i.icon);
  }
  assert.ok(items.filter((i) => i.stats.length).length >= 100);
});

test('modes: items only asks item questions, heroes only hero ones, and Next Question keeps the mode', async () => {
  for (let n = 0; n < 200; n++) {
    assert.ok(tv.MODES.items.includes(tv.makeQuestion(undefined, undefined, 'items').type));
    assert.ok(tv.MODES.heroes.includes(tv.makeQuestion(undefined, undefined, 'heroes').type));
  }
  const q = tv.makeQuestion('stat');
  assert.match(q.prompt, /\?\?%/);
  const { round } = await tv.startRound('m', null, async () => {}, { mode: 'items', question: q });
  const over = await tv.guess(round.id, 'm', q.answer, null);
  assert.strictEqual(over.payload.components.at(-1).components[0].data.custom_id, 'trivia_next:items');
  assert.match(over.payload.embeds[0].toJSON().description, /It's \*\*.+%/);
});

test('a solo round: only the runner answers, one guess, right pays once, wrong pays nothing', async () => {
  await getStore('xp').delete('a');
  await getStore('xp').delete('b');
  const question = tv.makeQuestion('cost'); // a button question
  const { round, payload } = await tv.startRound('a', null, async () => {}, { question });
  assert.strictEqual(payload.components[0].components.length, 4);
  assert.ok((await tv.guess(round.id, 'b', question.answer, null)).reply); // not their question
  const win = await tv.guess(round.id, 'a', question.answer, null);
  assert.ok(win.payload);
  assert.ok((await tv.guess(round.id, 'a', question.answer, null)).reply); // round over, no double pay
  assert.strictEqual((await getUser('a')).souls, 25);
  assert.strictEqual((await getUser('b')).souls, 0);
  assert.strictEqual(win.payload.components[0].components[question.answer].data.style, 3); // green
  assert.strictEqual(win.payload.components[1].components[0].data.label, 'Next Question');
  assert.match(win.payload.embeds[0].toJSON().description, /Streak ▰▱{9} \*\*1\/10\*\*/);

  // the next round offers the streak's pay; a wrong answer pays nothing and resets the streak
  const r2 = await tv.startRound('a', null, async () => {}, { question });
  assert.doesNotMatch(r2.payload.embeds[0].toJSON().description, /one guess|souls/); // no rules text while the round is open
  const wrong = (question.answer + 1) % 4;
  const lose = await tv.guess(r2.round.id, 'a', wrong, null);
  assert.strictEqual(lose.payload.components[0].components[wrong].data.style, 4); // red
  assert.match(lose.payload.embeds[0].toJSON().description, /Streak ▱{10} \*\*0\/10\*\*/);
  assert.strictEqual((await getUser('a')).souls, 25);
});

test('the item data knows upgrades: every upgrade is a higher-tier item in the list', () => {
  const byName = new Map(tv.items().map((i) => [i.name, i]));
  const components = tv.items().filter((i) => i.into.length);
  assert.ok(components.length >= 30);
  for (const i of components) for (const up of i.into) assert.ok(byName.get(up)?.tier > i.tier, `${i.name} -> ${up}`);
});

test('upgrade questions: the dropdown has one right upgrade, never the item itself or its other upgrades', () => {
  for (let n = 0; n < 300; n++) {
    const q = tv.makeQuestion('upgrade');
    const item = tv.items().find((i) => q.title === `What does ${i.name} upgrade into?`);
    const labels = q.choices.map((c) => c.label);
    assert.ok(item.into.includes(labels[q.answer]));
    assert.strictEqual(labels.filter((l) => item.into.includes(l)).length, 1);
    assert.ok(!labels.includes(item.name));
    assert.deepStrictEqual(labels, [...labels].sort());
  }
});

test('an upgrade question ends on the build graph and names the other upgrades', async () => {
  let q;
  do q = tv.makeQuestion('upgrade');
  while (!q.also);
  const { round } = await tv.startRound('g', null, async () => {}, { question: q });
  const over = await tv.guess(round.id, 'g', q.answer, null);
  assert.ok(over.payload.embeds[0].toJSON().description.includes(`Additionally, it builds into ${q.also}.`));
  assert.ok(Buffer.isBuffer(over.payload.files.find((f) => f.name === 'item.png').attachment));
});

test('hero questions are dropdowns of 4', async () => {
  for (const [type, placeholder] of [['voice', 'Pick the hero'], ['finish', 'Pick the ending'], ['ability', 'Pick the ability'], ['whose', 'Pick the hero']]) {
    const { payload } = await tv.startRound('h', null, async () => {}, { question: tv.makeQuestion(type) });
    const menu = payload.components[0].components[0].toJSON();
    assert.strictEqual(menu.type, 3, type);
    assert.strictEqual(menu.options.length, 4, type);
    assert.strictEqual(menu.placeholder, placeholder);
  }
});

test('dropdown rounds: the pick answers, the wrong pick is named, the blurred art comes back sharp', async () => {
  await getStore('xp').delete('e');
  const q = tv.makeQuestion('blur');
  const { round, payload } = await tv.startRound('e', null, async () => {}, { question: q });
  const menu = payload.components[0].components[0].toJSON();
  assert.strictEqual(menu.options.length, tv.MENU_SIZE);
  assert.strictEqual(menu.custom_id, `trivia:${round.id}`);
  const wrong = (q.answer + 1) % tv.MENU_SIZE;
  const over = await tv.guess(round.id, 'e', wrong, null);
  const text = over.payload.embeds[0].toJSON().description;
  assert.ok(text.includes(`you said **${q.choices[wrong].label}**`), text);
  assert.ok(text.includes(`It's **${q.reveal}**`), text);
  assert.strictEqual(over.payload.components.length, 1); // just Next Question
  const art = (p) => p.files.find((f) => f.name === 'item.png').attachment;
  assert.strictEqual(typeof art(over.payload), 'string'); // the art file itself, not the blurred copy
  assert.ok(Buffer.isBuffer(art(payload)));
});

test('typed rounds: capitals, spaces and punctuation are forgiven, spelling is not; only the player opens the pop-up', async () => {
  await getStore('xp').delete('f');
  const q = { ...tv.makeQuestion('name'), reveal: 'High-Velocity Rounds' };
  const r1 = await tv.startRound('f', null, async () => {}, { question: q });
  assert.strictEqual(r1.payload.components[0].components[0].data.custom_id, `trivia_type:${r1.round.id}`);
  assert.strictEqual(r1.payload.embeds[0].toJSON().footer.text, "Capitals and spaces don't matter");
  assert.ok(tv.roundError(r1.round.id, 'someone else'));
  assert.strictEqual(tv.roundError(r1.round.id, 'f'), null);
  assert.strictEqual(tv.answerModal(r1.round.id).toJSON().custom_id, `trivia_type:${r1.round.id}`);
  const win = await tv.guess(r1.round.id, 'f', '  high velocity ROUNDS ', null);
  assert.match(win.payload.embeds[0].toJSON().description, /got it/);
  assert.ok(tv.RIGHT_LINES.map((l) => `"${l}"`).includes(win.payload.embeds[0].toJSON().footer.text)); // the tip is gone, Dynamo's line instead
  assert.strictEqual((await getUser('f')).souls, 25);
  const r2 = await tv.startRound('f', null, async () => {}, { question: q });
  const lose = await tv.guess(r2.round.id, 'f', 'High Velocity Round', null);
  assert.match(lose.payload.embeds[0].toJSON().description, /you said \*\*High Velocity Round\*\*/);
  assert.strictEqual((await getUser('f')).souls, 25);
});

test('no cooldown, and time running out ends the round', async () => {
  assert.ok((await tv.startRound('c', null, async () => {})).payload);
  assert.ok((await tv.startRound('c', null, async () => {})).payload); // right away again
  const ended = await new Promise((resolve) => {
    tv.startRound('d', null, async (p) => resolve(p), { seconds: 0.05 });
  });
  assert.match(ended.embeds[0].toJSON().description, /Time's up/);
  assert.ok(tv.TIMEOUT_LINES.map((l) => `"${l}"`).includes(ended.embeds[0].toJSON().footer.text));
});

test("Dynamo hosts: his icon, his portrait while it's open, gloating when you're right, hurt when you're wrong", async () => {
  const q = tv.makeQuestion('cost');
  const face = (p) => p.embeds[0].toJSON().thumbnail.url;
  const r1 = await tv.startRound('k', null, async () => {}, { question: q });
  assert.strictEqual(r1.payload.embeds[0].toJSON().author.icon_url, 'attachment://singularity.png');
  assert.strictEqual(face(r1.payload), 'attachment://dynamo_portrait.png');
  assert.strictEqual(face((await tv.guess(r1.round.id, 'k', q.answer, null)).payload), 'attachment://dynamo_gloat.png');
  const r2 = await tv.startRound('k', null, async () => {}, { question: q });
  const lose = (await tv.guess(r2.round.id, 'k', (q.answer + 1) % 4, null)).payload;
  assert.strictEqual(face(lose), 'attachment://dynamo_injured.png');
  assert.ok(tv.WRONG_LINES.map((l) => `"${l}"`).includes(lose.embeds[0].toJSON().footer.text));
  for (const f of lose.files) if (typeof f.attachment === 'string') assert.ok(require('node:fs').existsSync(f.attachment), f.attachment);
});
