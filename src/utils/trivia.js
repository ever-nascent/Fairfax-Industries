// /trivia: Deadlock trivia rounds from the wiki data in assets/trivia (built by `setup.py trivia`).
// Solo: one question (4 answer buttons, a dropdown of items, or a typed answer), only the runner answers, one guess; right wins souls (more for a streak,
// up to 10 paid answers a day: xp.js triviaAnswer). Rules: server-plan.md.
const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown,
} = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getUser, triviaAnswer, TRIVIA_MAX_STREAK } = require('./xp');
const { renderBarPiece } = require('./rankCard');
const { ensureEmoji } = require('./guild');
const { heroEmoji } = require('./heroes');
const { fmt, soulsIcon } = require('./format');
const { randomInt, pickRandom, shuffle, shortId } = require('./random');
const { ASSETS } = require('./art');

const DIR = path.join(ASSETS, 'trivia');
const ROUND_SECONDS = 20;
const COLOR = 0xe0b560;
const COLOR_HEX = '#e0b560';
const BUTTON_ID = 'trivia'; // custom id: trivia:<round id>:<choice index>
const NEXT_ID = 'trivia_next'; // custom id: trivia_next:<mode> (no mode = mixed)
const TYPE_ID = 'trivia_type'; // custom id: trivia_type:<round id> (the Type Your Answer button and its pop-up)
const MENU_SIZE = 5; // dropdown choices (his call, Sept 28; Discord allows up to 25)
const SLOW_SECONDS = 30; // dropdown and typed questions take longer to answer than 4 buttons
const MAX_LABEL = 80; // Discord's button label limit

// Dynamo hosts (a professor): his Singularity icon top left, portrait/gloat/injured from deadlock.wiki in assets/dynamo.
// Original lines modelled on his real ones (deadlock.wiki "Dynamo/Voice lines"): excitable ("Oooh", stretched words,
// dropped g's), his class and students, term papers, tenure, Marla, science. He's an encouraging teacher: proud when
// you get it right, never mocking when you don't (his call, Sept 28). One goes in the footer when the round ends.
const DYNAMO = path.join(ASSETS, 'dynamo');
const RIGHT_LINES = [
  "Remarkable! I'm telling the class about you on Monday!",
  'Top marks! Now if only my students did the reading like that.',
  'Oh, this is so exciting! Correct!',
  "Correct! Marla's never gonna believe someone actually studied.",
  'Splendid! If that doesn\'t earn you tenure, what does?',
  "I couldn't have explained it better myself. And believe me, I've tried!",
  'Right on the money! Science is a beautiful thing.',
  'Gold star! Well... a figurative gold star. Budget cuts.',
  'Was I worried? Not for a second! Well... maybe a second.',
  "Impressive work! You ever want an honorary degree, I know some people.",
  "Oooh, that's goin' in my lecture notes!",
  'Now THAT is applied knowledge!',
];
const WRONG_LINES = [
  "Not quite! But that's what practice is for.",
  "Oh, so close! Don't worry, you'll get the next one.",
  "Wrong, I'm afraid. Chin up, even I failed a quiz or two.",
  'Not the answer, but a fine effort! My office hours are always open.',
  "Ooh, not quite. That's... that's alright, we learn from these!",
  'Wrong answer, but a veeery interesting hypothesis!',
  "Oookay, not that one. Let's call it a learning opportunity.",
  "Don't let that get you down. Science is mostly bein' wrong first!",
  'Hmm, no. But I believe in you. So does Marla, probably.',
  'Not quite! Even my best students trip on that one.',
  "That's alright! Nobody gets tenure on their first try.",
  "Close! I'll give you partial credit. Well, in spirit.",
];
const TIMEOUT_LINES = [
  "Pencils down! Don't worry, there's always the next one.",
  "Out of time! Take a breath, you'll get the next one.",
  "Time's up! Even the best minds need a moment to think.",
  "Ah, the clock beat us! Let's try another, shall we?",
  "Time flies! Believe me, I've studied it.",
  'Out of time! Happens to me every grading season.',
  "Time's up! No harm done, let's go again.",
  'The clock ran out! Must be all those term papers on your mind.',
];

// [{ name, slug, lines: [..], abilities: [{ name, icon }] }]
let data;
const heroes = () => (data ??= JSON.parse(fs.readFileSync(path.join(DIR, 'trivia.json'), 'utf8')));
// [{ name, slot, tier, cost, icon, stats: [{ label, value, sign }], into: [item names] }] (only the % stats on the item's card)
let itemData;
const items = () => (itemData ??= JSON.parse(fs.readFileSync(path.join(DIR, 'items.json'), 'utf8')));
const COSTS = [800, 1600, 3200, 6400]; // tier 1-4
const pct = (stat, value = stat.value) => `${stat.sign}${value}%`;

// `count` random items from `list` that aren't `not`.
const others = (list, not, count, rnd) => shuffle(list.filter((x) => x !== not), rnd).slice(0, count);

// Typed answers: capitals, spaces and punctuation don't matter.
const norm = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// A dropdown question's choices: the answer + wrong item names (from `first`, then any item, never `skip`), A-Z.
function itemMenu(answer, first, skip, rnd) {
  const names = [answer];
  for (const name of [...shuffle(first, rnd), ...shuffle(items().map((i) => i.name), rnd)]) {
    if (names.length === MENU_SIZE) break;
    if (!names.includes(name) && !skip.includes(name)) names.push(name);
  }
  names.sort();
  return { choices: names.map((label) => ({ label })), answer: names.indexOf(answer), menu: true, seconds: SLOW_SECONDS };
}

// ---- questions ---------------------------------------------------------------------------------
// A question: { type, title, prompt?, icon?, hero (the answer's hero), choices: [{ label, slug? }], answer }

// Splits a line in the middle (by words): [start, ending].
function splitLine(line) {
  const words = line.split(' ');
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

const TYPES = {
  voice(rnd) {
    const hero = pickRandom(heroes(), rnd);
    const choices = shuffle([hero, ...others(heroes(), hero, 3, rnd)], rnd);
    return {
      type: 'voice',
      title: 'Whose voice line is this?',
      prompt: `"${pickRandom(hero.lines, rnd)}"`,
      hero,
      choices: choices.map((h) => ({ label: h.name, slug: h.slug })),
      answer: choices.indexOf(hero),
      menu: true, // hero questions use a dropdown (his call, Sept 28)
      placeholder: 'Pick the hero',
    };
  },
  finish(rnd) {
    // a hero with at least 4 lines long enough to split, whose endings fit on a button
    const fits = (l) => l.split(' ').length >= 7 && splitLine(l)[1].length + 3 <= MAX_LABEL;
    const hero = pickRandom(heroes().filter((h) => h.lines.filter(fits).length >= 4), rnd);
    const [line, ...rest] = shuffle(hero.lines.filter(fits), rnd);
    const [start, ending] = splitLine(line);
    const endings = [ending];
    for (const l of rest) {
      const e = splitLine(l)[1];
      if (!endings.some((x) => x.toLowerCase() === e.toLowerCase())) endings.push(e);
      if (endings.length === 4) break;
    }
    const choices = shuffle(endings, rnd);
    return {
      type: 'finish',
      title: `Finish ${hero.name}'s voice line`,
      prompt: `"${start.replace(/[.…]+$/, '')}..."`, // no "me......" when the line already trails off
      hero,
      choices: choices.map((e) => ({ label: `...${e}` })),
      answer: choices.indexOf(ending),
      menu: true,
      placeholder: 'Pick the ending',
    };
  },
  ability(rnd) {
    const hero = pickRandom(heroes(), rnd);
    const ability = pickRandom(hero.abilities, rnd);
    const all = heroes().flatMap((h) => h.abilities.map((a) => a.name));
    const choices = shuffle([ability.name, ...others(all, ability.name, 3, rnd)], rnd);
    return {
      type: 'ability',
      title: 'What is this ability called?',
      icon: ability.icon,
      hero,
      reveal: ability.name,
      choices: choices.map((label) => ({ label })),
      answer: choices.indexOf(ability.name),
      menu: true,
      placeholder: 'Pick the ability',
    };
  },
  whose(rnd) {
    const hero = pickRandom(heroes(), rnd);
    const ability = pickRandom(hero.abilities, rnd);
    const choices = shuffle([hero, ...others(heroes(), hero, 3, rnd)], rnd);
    return {
      type: 'whose',
      title: 'Whose ability is this?',
      icon: ability.icon,
      hero,
      reveal: ability.name,
      choices: choices.map((h) => ({ label: h.name, slug: h.slug })),
      answer: choices.indexOf(hero),
      menu: true,
      placeholder: 'Pick the hero',
    };
  },
  cost(rnd) {
    const item = pickRandom(items(), rnd);
    return {
      type: 'cost',
      title: `How many Souls does ${item.name} cost?`,
      art: item.icon,
      reveal: `${fmt(item.cost)} Souls (Tier ${item.tier})`,
      choices: COSTS.map((c) => ({ label: fmt(c) })),
      answer: COSTS.indexOf(item.cost),
    };
  },
  tier(rnd) {
    const item = pickRandom(items(), rnd);
    return {
      type: 'tier',
      title: `What tier is ${item.name}?`,
      art: item.icon,
      reveal: `Tier ${item.tier} (${fmt(item.cost)} souls)`,
      choices: [1, 2, 3, 4].map((t) => ({ label: `Tier ${t}` })),
      answer: item.tier - 1,
    };
  },
  stat(rnd) {
    const item = pickRandom(items().filter((i) => i.stats.length), rnd);
    const stat = pickRandom(item.stats, rnd);
    // wrong numbers: the same stat on other items first, then the closest % values from any item
    const same = shuffle(items().flatMap((i) => i.stats.filter((s) => s.label === stat.label).map((s) => s.value)), rnd);
    const near = items().flatMap((i) => i.stats.map((s) => s.value)).sort((a, b) => Math.abs(a - stat.value) - Math.abs(b - stat.value));
    const values = [stat.value];
    for (const v of [...same, ...near]) {
      if (!values.includes(v) && Math.sign(v) === Math.sign(stat.value)) values.push(v);
      if (values.length === 4) break;
    }
    values.sort((a, b) => a - b);
    return {
      type: 'stat',
      title: `Fill in the blank: ${item.name}`,
      prompt: `**${stat.value < 0 ? '-' : stat.sign}??% ${stat.label}**`,
      art: item.icon,
      reveal: `${pct(stat)} ${stat.label}`,
      choices: values.map((v) => ({ label: pct(stat, v) })),
      answer: values.indexOf(stat.value),
    };
  },
  blur(rnd) {
    const item = pickRandom(items(), rnd);
    const sameSlot = items().filter((i) => i.slot === item.slot).map((i) => i.name); // the blurred colour gives the slot away anyway
    return { type: 'blur', title: 'Which item is this?', art: item.icon, blur: true, reveal: item.name, ...itemMenu(item.name, sameSlot, [], rnd) };
  },
  name(rnd) {
    const item = pickRandom(items(), rnd);
    return {
      type: 'name',
      title: 'Name this item',
      prompt: 'Type its name.',
      footer: "Capitals and spaces don't matter",
      art: item.icon,
      reveal: item.name,
      typed: true,
      choices: [],
      seconds: SLOW_SECONDS,
    };
  },
  upgrade(rnd) {
    const item = pickRandom(items().filter((i) => i.into.length), rnd);
    const into = pickRandom(item.into, rnd);
    const also = item.into.filter((n) => n !== into); // other right answers stay out of the dropdown
    const higher = items().filter((i) => i.tier > item.tier).map((i) => i.name);
    return {
      type: 'upgrade',
      title: `What does ${item.name} upgrade into?`,
      art: item.icon,
      reveal: into,
      also: also.join(' and '),
      from: item.name, // for the build graph shown at the end
      ...itemMenu(into, higher, [item.name, ...also], rnd),
    };
  },
};
const MODES = { heroes: ['voice', 'finish', 'ability', 'whose'], items: ['cost', 'tier', 'stat', 'blur', 'name', 'upgrade'] };

// mode: 'heroes', 'items', or nothing for any question
function makeQuestion(type, rnd = randomInt, mode) {
  return TYPES[type ?? pickRandom(MODES[mode] ?? Object.keys(TYPES), rnd)](rnd);
}

// Ability icons are white, so they sit on a dark tile (readable in Discord's light theme too).
const tiles = new Map();
async function iconTile(file) {
  if (!tiles.has(file)) {
    const c = createCanvas(150, 150);
    const g = c.getContext('2d');
    g.fillStyle = '#1b1c20';
    g.beginPath();
    g.roundRect(3, 3, 144, 144, 18);
    g.fill();
    g.strokeStyle = COLOR_HEX;
    g.lineWidth = 3;
    g.stroke();
    g.drawImage(await loadImage(path.join(DIR, 'abilities', file)), 20, 20, 110, 110);
    tiles.set(file, c.toBuffer('image/png'));
  }
  return tiles.get(file);
}

async function blurred(file) {
  const c = createCanvas(200, 200);
  const g = c.getContext('2d');
  g.filter = 'blur(10px)';
  g.drawImage(await loadImage(path.join(DIR, 'items', file)), 0, 0, 200, 200);
  return c.toBuffer('image/png');
}

// The end of an upgrade question: the item on top, a line down to everything it builds into.
const SLOT_COLORS = { Weapon: '#d08b3a', Vitality: '#6fa03c', Spirit: '#9a63c9' }; // the in-game shop's slot colours
async function upgradeGraph(name) {
  const byName = new Map(items().map((i) => [i.name, i]));
  const from = byName.get(name);
  const kids = from.into.map((n) => byName.get(n));
  const W = 640, S = 100; // canvas width, item tile size
  const c = createCanvas(W, 430);
  const g = c.getContext('2d');
  g.fillStyle = '#1b1c20';
  g.beginPath();
  g.roundRect(3, 3, W - 6, 424, 18);
  g.fill();
  g.strokeStyle = COLOR_HEX;
  g.lineWidth = 3;
  g.stroke();

  const tile = async (item, cx, top, maxWidth) => {
    g.save();
    g.beginPath();
    g.roundRect(cx - S / 2, top, S, S, 10);
    g.clip();
    g.drawImage(await loadImage(path.join(DIR, 'items', item.icon)), cx - S / 2, top, S, S);
    g.restore();
    g.strokeStyle = SLOT_COLORS[item.slot];
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(cx - S / 2, top, S, S, 10);
    g.stroke();
    // name under the tile, wrapped to 2 lines if it's wider than its column
    g.font = '21px Radiance';
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    const words = item.name.split(' ');
    let lines = [item.name];
    if (g.measureText(item.name).width > maxWidth && words.length > 1) {
      const cut = Math.ceil(words.length / 2);
      lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
    }
    lines.forEach((line, i) => g.fillText(line, cx, top + S + 26 + i * 24));
  };

  const kidX = kids.map((_, i) => (W * (i + 0.5)) / kids.length);
  const barY = 190, kidTop = 240, gap = 14; // gap: between an arrow's tip and its item
  // colour-coded by slot: the stem in the item's colour, each path (along the bar, then down) in its upgrade's colour.
  // Outer paths first, so where two share the bar near the middle, the nearer upgrade's colour is on top.
  g.lineWidth = 4;
  g.strokeStyle = SLOT_COLORS[from.slot];
  g.beginPath();
  g.moveTo(W / 2, 170);
  g.lineTo(W / 2, barY);
  g.stroke();
  const outerFirst = [...kidX.keys()].sort((a, b) => Math.abs(kidX[b] - W / 2) - Math.abs(kidX[a] - W / 2));
  for (const i of outerFirst) {
    const x = kidX[i];
    g.strokeStyle = g.fillStyle = SLOT_COLORS[kids[i].slot];
    g.beginPath();
    g.moveTo(W / 2, barY);
    g.lineTo(x, barY);
    g.lineTo(x, kidTop - gap - 8);
    g.stroke();
    g.beginPath(); // arrowhead
    g.moveTo(x - 9, kidTop - gap - 12);
    g.lineTo(x + 9, kidTop - gap - 12);
    g.lineTo(x, kidTop - gap);
    g.fill();
  }
  await tile(from, W / 2, 22, W);
  for (const [i, kid] of kids.entries()) await tile(kid, kidX[i], kidTop, W / kids.length - 12);
  return c.toBuffer('image/png');
}

// ---- rounds ------------------------------------------------------------------------------------
// In memory: a round lasts 20 seconds and holds no bets, so a restart just drops it.

const rounds = new Map(); // round id -> round

async function view(round, guild) {
  const { question: q, id } = round;
  const over = round.over;
  const lines = [];
  // the hero's emoji (Dynamo has the thumbnail): shown from the start on "finish the line" (it says whose line it is),
  // otherwise only after
  const e = q.hero && heroEmoji(guild, q.hero.slug);
  const tag = e ? `<:${e.name}:${e.id}> ` : '';
  if (q.prompt) lines.push(q.type === 'finish' ? `${tag}${q.prompt}` : q.prompt);
  if (over) {
    const answer = q.choices[q.answer]?.label; // typed questions have no choices
    const it = MODES.items.includes(q.type) ? `It's **${q.reveal}**.${q.also ? ` Additionally, it builds into ${q.also}.` : ''}` : q.type === 'ability' ? `It's **${answer}** (${tag}${q.hero.name}).` : q.type === 'whose' ? `It's ${tag}**${answer}**'s ${q.reveal}.` : q.type === 'finish' ? `It was **${answer}**` : `It was ${tag}**${answer}**!`;
    lines.push(it);
    if (round.right) {
      const secs = ((round.guessedAt - round.startedAt) / 1000).toFixed(1);
      const paid = round.won ? `: ${soulsIcon()}**+${fmt(round.won)} Souls**.` : '. No Souls left today.';
      lines.push(`<@${round.userId}> got it (${secs}s)${paid}`);
    } else if (round.guess == null) lines.push(`Time's up, <@${round.userId}>.`);
    else lines.push(`Wrong one, <@${round.userId}>${round.picked ? ` (you said **${escapeMarkdown(round.picked)}**)` : ''}.`);
  }
  lines.push(`Streak ${streakBar(round.streak)} **${round.streak}/${TRIVIA_MAX_STREAK}**`);

  // Dynamo's face once it's over: he wants you to get it right, so he beams when you do and is hurt when you don't
  const mood = !over ? 'portrait' : round.right ? 'gloat' : 'injured';
  const embed = new EmbedBuilder()
    .setColor(!over ? COLOR : round.right ? 0x57f287 : 0xed4245) // Discord green / red once answered
    .setAuthor({ name: "Dynamo's Classroom", iconURL: 'attachment://singularity.png' })
    .setThumbnail(`attachment://dynamo_${mood}.png`)
    .setTitle(q.title)
    .setDescription(lines.join('\n\n'));
  // a tip for answering while it's open, his line once it's over
  const footer = over ? `"${pickRandom(round.right ? RIGHT_LINES : round.guess == null ? TIMEOUT_LINES : WRONG_LINES)}"` : q.footer;
  if (footer) embed.setFooter({ text: footer });
  const files = [
    new AttachmentBuilder(path.join(DYNAMO, 'singularity.png'), { name: 'singularity.png' }),
    new AttachmentBuilder(path.join(DYNAMO, `${mood}.png`), { name: `dynamo_${mood}.png` }),
  ];
  if (q.icon) {
    embed.setImage('attachment://ability.png');
    files.push(new AttachmentBuilder(await iconTile(q.icon), { name: 'ability.png' }));
  }
  if (q.art) {
    embed.setImage('attachment://item.png');
    // blurred until it's over; an upgrade question ends on its build graph
    const art = q.blur && !over ? await blurred(q.art) : q.from && over ? await upgradeGraph(q.from) : path.join(DIR, 'items', q.art);
    files.push(new AttachmentBuilder(art, { name: 'item.png' }));
  }

  const components = [];
  if (q.menu && !over) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${BUTTON_ID}:${id}`).setPlaceholder(q.placeholder ?? 'Pick the item')
        .addOptions(q.choices.map((c, i) => ({ label: c.label, value: String(i), emoji: c.slug && heroEmoji(guild, c.slug) }))),
    ));
  }
  if (q.typed && !over) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${TYPE_ID}:${id}`).setLabel('Type Your Answer').setStyle(ButtonStyle.Primary),
    ));
  }
  const buttons = q.menu || q.typed ? [] : q.choices.map((c, i) => {
    const b = new ButtonBuilder().setCustomId(`${BUTTON_ID}:${id}:${i}`).setLabel(c.label.slice(0, MAX_LABEL));
    const emoji = c.slug && heroEmoji(guild, c.slug);
    if (emoji) b.setEmoji(emoji);
    if (!over) return b.setStyle(ButtonStyle.Secondary);
    return b.setDisabled(true).setStyle(i === q.answer ? ButtonStyle.Success : i === round.guess ? ButtonStyle.Danger : ButtonStyle.Secondary);
  });
  if (buttons.length) components.push(new ActionRowBuilder().addComponents(buttons));
  if (over) {
    components.push(
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${NEXT_ID}:${round.mode ?? ''}`).setLabel('Next Question').setStyle(ButtonStyle.Primary)),
    );
  }
  return { embeds: [embed], files, components };
}

// Starts a round for one player. onEnd(payload) is called when time runs out without a guess (to edit the message).
// Returns { round, payload }.
async function startRound(userId, guild, onEnd, { mode, question = makeQuestion(undefined, randomInt, mode), now = Date.now(), seconds = question.seconds ?? ROUND_SECONDS } = {}) {
  const user = await getUser(userId);
  const round = { id: shortId(), userId, mode, question, startedAt: now, guess: null, over: false, streak: user.triviaStreak };
  rounds.set(round.id, round);
  round.timer = setTimeout(async () => {
    if (round.over) return;
    round.over = true;
    rounds.delete(round.id);
    try {
      round.streak = (await triviaAnswer(userId, false)).streak; // time's up breaks the streak
      await onEnd(await view(round, guild));
    } catch (error) {
      console.error('[trivia] Failed to end round:', error.message);
    }
  }, seconds * 1000);
  round.timer.unref?.();
  return { round, payload: await view(round, guild) };
}

// Why this person can't answer this round (or null if they can).
function roundError(roundId, userId) {
  const round = rounds.get(roundId);
  if (!round || round.over) return 'This question is already over.';
  if (userId !== round.userId) return `That's <@${round.userId}>'s question. Get your own with \`/trivia\`.`;
  return null;
}

// The Type Your Answer pop-up (only opened for the round's player: check roundError first).
function answerModal(roundId) {
  return new ModalBuilder().setCustomId(`${TYPE_ID}:${roundId}`).setTitle('Name This Item').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('answer').setLabel('Item Name').setStyle(TextInputStyle.Short).setMaxLength(60).setRequired(true),
    ),
  );
}

// An answer: a choice index (button or dropdown) or the typed text. Returns { reply } (only the clicker sees it)
// or { payload } (the round is over: edit the message).
async function guess(roundId, userId, choice, guild, now = Date.now()) {
  const error = roundError(roundId, userId);
  if (error) return { reply: error };
  const round = rounds.get(roundId);
  const q = round.question;
  // no await before this point, so a double click can't pay twice
  round.over = true;
  round.guess = choice;
  round.guessedAt = now;
  round.right = q.typed ? norm(String(choice)) === norm(q.reveal) : choice === q.answer;
  if (q.typed || q.menu) round.picked = q.typed ? String(choice) : q.choices[choice]?.label; // no red button to show it
  clearTimeout(round.timer);
  rounds.delete(roundId);
  const result = await triviaAnswer(userId, round.right); // pays by streak, up to the daily cap
  round.won = result.souls;
  round.streak = result.streak;
  return { payload: await view(round, guild) };
}

// The streak bar: `length` emoji pieces drawn like the /rank XP bar, filled up to the streak (/trivia: 10,
// /urn: 7). Uploaded on startup (ensureStreakEmojis); plain ▰▱ until then.
const barEmojis = {}; // 'left_on' -> '<:streak_left_on:id>'
const barPart = (i, length) => (i === 0 ? 'left' : i === length - 1 ? 'right' : 'mid');
const streakBar = (streak, length = TRIVIA_MAX_STREAK) =>
  Array.from({ length }, (_, i) => barEmojis[`${barPart(i, length)}_${i < streak ? 'on' : 'off'}`] ?? (i < streak ? '▰' : '▱')).join('');

async function ensureStreakEmojis(guild) {
  for (const part of ['left', 'mid', 'right']) {
    for (const on of [true, false]) {
      const key = `${part}_${on ? 'on' : 'off'}`;
      barEmojis[key] = (await ensureEmoji(guild, `streak_${key}`, renderBarPiece(part, on))).toString();
    }
  }
}

module.exports = {
  startRound, guess, roundError, answerModal, upgradeGraph, makeQuestion, splitLine, streakBar, ensureStreakEmojis, heroes, items, RIGHT_LINES, WRONG_LINES, TIMEOUT_LINES, MODES, BUTTON_ID, NEXT_ID, TYPE_ID, MAX_LABEL, MENU_SIZE,
};
