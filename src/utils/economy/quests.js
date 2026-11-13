// Daily and weekly quests (his ask, Oct 30). The same quests for everyone: 3 dailies and 2 weeklies picked from the pools below by
// the date (UTC midnight, weeklies from Monday, like /urn), each paid the moment its goal is reached. Progress is counted by
// `track(userId, kind)`, called where the thing happens (a bet taken, a fight won, a counted chat message ...). Saved in data/quests.json.
const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getStore } = require('../../storage');
const { SCALE } = require('./economy');
const { changeSouls } = require('./xp');
const { soulsText } = require('../format');
const { REPLY_COLOR } = require('../../config');

const DAILY_SOULS = 40 * SCALE;
const WEEKLY_SOULS = 250 * SCALE;
const DAILY_COUNT = 3;
const WEEKLY_COUNT = 2;
// kind = what track() is told; goal = how many; text = how the quest reads.
const DAILY = [
  { kind: 'chat', goal: 10, text: 'Send 10 Messages That Earn XP' },
  { kind: 'game', goal: 3, text: 'Play 3 Betting Games' },
  { kind: 'fight', goal: 3, text: 'Win 3 Hero Farming Fights' },
  { kind: 'descend', goal: 3, text: 'Clear 3 Descend Rooms' },
  { kind: 'trivia', goal: 3, text: 'Answer 3 Trivia Questions Right' },
  { kind: 'urn', goal: 1, text: 'Claim Your Soul Urn' },
  { kind: 'lockle', goal: 1, text: 'Solve the Daily Lockle' },
];
const WEEKLY = [
  { kind: 'chat', goal: 60, text: 'Send 60 Messages That Earn XP' },
  { kind: 'game', goal: 20, text: 'Play 20 Betting Games' },
  { kind: 'fight', goal: 15, text: 'Win 15 Hero Farming Fights' },
  { kind: 'descend', goal: 20, text: 'Clear 20 Descend Rooms' },
  { kind: 'trivia', goal: 15, text: 'Answer 15 Trivia Questions Right' },
  { kind: 'urn', goal: 5, text: 'Claim Your Soul Urn on 5 Days' },
  { kind: 'lockle', goal: 4, text: 'Solve the Daily Lockle 4 Times' },
];

const store = () => getStore('quests'); // user id -> { day, week, p: { quest id: progress } }

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
// The Monday (UTC date) of `now`'s week.
function weekOf(now) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const nextDay = (now) => Date.parse(dayOf(now)) + 86_400_000;
const nextWeek = (now) => Date.parse(weekOf(now)) + 7 * 86_400_000;

// `count` quests of `pool`, the same for everyone: the pool ordered by a hash of the date.
const pick = (pool, count, seed) =>
  [...pool].sort((a, b) => hash(seed + a.kind).localeCompare(hash(seed + b.kind))).slice(0, count);
const hash = (text) => createHash('sha1').update(text).digest('hex');

// The quests running at `now`: [{ id, period, kind, goal, text, souls }].
function activeQuests(now = new Date()) {
  const make = (period, pool, count, seed, souls) => pick(pool, count, seed).map((q) => ({ ...q, id: `${period[0]}-${q.kind}`, period, souls }));
  return [
    ...make('daily', DAILY, DAILY_COUNT, dayOf(now), DAILY_SOULS),
    ...make('weekly', WEEKLY, WEEKLY_COUNT, weekOf(now), WEEKLY_SOULS),
  ];
}

// A quest paid while a command or button is being handled is announced to that member at the end of it (withQuests),
// privately, so the note never comes before the reply.
const noted = new AsyncLocalStorage();

// Counts `n` of `kind` for a member towards every running quest of that kind and pays the ones it completes.
// Never throws: a quest problem must not break the game or fight it was counted for. Returns the quests completed.
// ponytail: the payout comes after the progress is saved, so a crash between the two loses one reward; add a paid flag if that matters.
async function track(userId, kind, n = 1, now = new Date()) {
  if (process.env.NO_QUESTS) return []; // tests that count exact balances set this (a quest would pay into them)
  try {
    const open = activeQuests(now).filter((q) => q.kind === kind);
    if (!open.length) return [];
    const done = [];
    await store().update(userId, (cur) => {
      const day = dayOf(now);
      const week = weekOf(now);
      const rec = { day, week, p: {} };
      for (const [id, v] of Object.entries(cur?.p ?? {})) if (id[0] === 'd' ? cur.day === day : cur.week === week) rec.p[id] = v; // last period's progress is dropped
      let changed = JSON.stringify(rec) !== JSON.stringify(cur);
      for (const q of open) {
        const before = rec.p[q.id] ?? 0;
        if (before >= q.goal) continue;
        rec.p[q.id] = Math.min(q.goal, before + n);
        changed = true;
        if (rec.p[q.id] === q.goal) done.push(q);
      }
      return changed ? rec : cur;
    });
    for (const q of done) {
      await changeSouls(userId, q.souls, 'quest');
      noted.getStore()?.push(q);
    }
    return done;
  } catch (error) {
    console.error('[quests] Could not count', kind, error);
    return [];
  }
}

// Runs a command / button handler and, if it completed quests, tells the member afterwards in a private follow-up.
async function withQuests(interaction, handler) {
  const completed = [];
  const result = await noted.run(completed, handler);
  if (completed.length) {
    const embed = new EmbedBuilder()
      .setColor(REPLY_COLOR)
      .setTitle(completed.length > 1 ? 'Quests Complete' : 'Quest Complete')
      .addFields(completed.map((q) => ({ name: q.text, value: `${soulsText(q.souls)} Earned`, inline: true })));
    const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
    try {
      await (interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload));
    } catch (error) {
      console.error('[quests] Could not tell the member:', error.message);
    }
  }
  return result;
}

// /quests: the member's running quests and how far along they are.
async function questsEmbed(userId, now = new Date()) {
  const rec = await store().get(userId);
  const have = (q) => ((q.period === 'daily' ? rec?.day === dayOf(now) : rec?.week === weekOf(now)) ? rec?.p?.[q.id] ?? 0 : 0);
  const lines = (period) => activeQuests(now).filter((q) => q.period === period)
    .map((q) => (have(q) >= q.goal ? `**Done** ${q.text}` : `**${have(q)}/${q.goal}** ${q.text}: ${soulsText(q.souls)}`)).join('\n');
  return new EmbedBuilder()
    .setColor(REPLY_COLOR)
    .setTitle('Quests')
    .addFields(
      { name: `Daily (Refreshes In <t:${nextDay(now) / 1000}:R>)`, value: lines('daily') },
      { name: `Weekly (Refreshes In <t:${nextWeek(now) / 1000}:R>)`, value: lines('weekly') },
    )
    .setFooter({ text: 'Do the work and I pay on the spot.' });
}

module.exports = { track, withQuests, questsEmbed, activeQuests, weekOf, DAILY_SOULS, WEEKLY_SOULS };
