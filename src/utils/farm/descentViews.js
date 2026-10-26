// /descend's messages (rules: descent.js). The same look as the farm's: souls-coloured menus and live fights, green a win, red the end of a run.
// One message per room: the room screen becomes the live fight and stays on its last moment; the result and the pick (the spinning cylinder,
// descentCard.js) are a new message, which becomes the next room's screen once a pick is made.
const path = require('node:path');
const { AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { HEROES: HERO_DATA, ABILITIES, itemByName } = require('./stats');
const { buildHero } = require('./hero');
const { heroCard } = require('./heroCard');
const { buffText, BRIDGE } = require('./buffs');
const { MAX_ITEMS, countItems, priceFor, SLOTS, MAX_TIER, TIER_COSTS, MAX_LEVEL, UNLOCKS } = require('./levels');
const { MAX_REJUVS, hasHero } = require('./play');
const D = require('./descent');
const { pickPicture, choicesOf } = require('./descentCard');
const { embed, soulsFile, picture, plural, row, barLine, enemyFields, heroText, rivalFace, rivalMood, voiceLine, heroPicture, clock, titleCase, itemStats, statsFor, WIN, LOSS } = require('./views');
const { roster } = require('./hero');
const { heroEmoji, HEROES } = require('../heroes');
const { rejuvIcon } = require('../format');
const { ASSETS } = require('../art');

const DHERO_ID = 'farm_dhero'; // select (start screen): farm_dhero:<user id>, value = hero
const DBEGIN_ID = 'farm_dbegin'; // button "Begin Descent": farm_dbegin:<user id>:<hero>
const DFIGHT_ID = 'farm_dfight'; // button "Fight": farm_dfight:<user id>:<room>
const DWALK_ID = 'farm_dwalk'; // button "Walk Away" (a rival room): farm_dwalk:<user id>:<room>
const DTAKE_ID = 'farm_dtake'; // button (the pick): farm_dtake:<user id>:<room>:<choice 0-2>
const DSKIP_ID = 'farm_dskip'; // button "Skip": farm_dskip:<user id>:<room>
const DSWAP_ID = 'farm_dswap'; // select (a full build): farm_dswap:<user id>:<room>:<choice>, value = the item given up for it
const DPOINT_ID = 'farm_dpoint'; // select: farm_dpoint:<user id>, value = ability slot
const DBUILD_ID = 'farm_dbuild'; // button "Build": farm_dbuild:<user id>
const DBACK_ID = 'farm_dback'; // button "Back": farm_dback:<user id> (the run's current screen)
const DQUIT_ID = 'farm_dquit'; // button "Abandon Run": farm_dquit:<user id>, then farm_dquit:<user id>:yes
const DAGAIN_ID = 'farm_dagain'; // button "Descend Again" (the end of a run): farm_dagain:<user id>

const TOKEN_ICON = path.join(ASSETS, 'farm', 'icons', 'unlock-token.png');
const KIND_NAME = { Weapon: 'Weapon', Armor: 'Vitality', Tech: 'Spirit' };
const dembed = (color) => embed(color).setAuthor({ name: 'Hero Farming  -  Descend', iconURL: 'attachment://souls.png' });
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setStyle(style);
const slugOf = (name) => HEROES.find((h) => h.name === name).slug;
const abilityName = (hero, slot) => ABILITIES[HERO_DATA[hero].BoundAbilities[slot].Key].Name;
const roomTitle = (spec) => `Floor ${spec.floor}  -  Room ${spec.room}${spec.final ? '  -  The Bottom' : spec.kind === 'boss' ? '  -  Boss' : spec.kind === 'rival' ? '  -  Rival' : ''}`;
const healthLine = (d, hero = buildHero(d.hero, D.runKit(d))) => barLine(d.health * hero.stats.maxHealth, hero.stats.maxHealth);
const bestText = (best) => (best?.rooms ? `${plural(best.rooms, 'room')} (${best.hero})` : 'None yet');
const sentence = (text) => `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;

// The fields every run screen shares: health, level, items, Rejuvs, points, rooms.
function runFields(d) {
  const left = D.pointsLeft(d);
  return [
    { name: d.hero, value: healthLine(d) },
    { name: 'Level', value: `${d.level}`, inline: true },
    { name: 'Items', value: `${countItems(d.items)} / ${MAX_ITEMS}${d.legendary ? ' + 1' : ''}`, inline: true },
    { name: 'Rejuvs', value: `${rejuvIcon()}${d.rejuvs} / ${MAX_REJUVS}`, inline: true },
    ...(left > 0 ? [{ name: 'Ability Points', value: `${left} to spend`, inline: true }] : []),
    { name: 'Rooms Cleared', value: `${d.room - 1}`, inline: true },
  ];
}

// "Spend an ability point": the run's own abilities (the hero's farm record is never touched).
function pointMenu(userId, d) {
  const left = D.pointsLeft(d);
  const open = [1, 2, 3, 4].filter((slot) => slot <= UNLOCKS(d.level) && (d.tiers[slot] ?? 0) < MAX_TIER);
  if (left <= 0 || !open.length) return null;
  return row(new StringSelectMenuBuilder().setCustomId(`${DPOINT_ID}:${userId}`).setPlaceholder(`Spend an ability point (${left} left)`)
    .addOptions(open.map((slot) => ({ label: `${abilityName(d.hero, slot)}  -  Tier ${(d.tiers[slot] ?? 0) + 1}`, value: String(slot), description: `Costs ${plural(TIER_COSTS[d.tiers[slot] ?? 0], 'ability point')}` }))));
}

// The room's picture: a boss's icon, the trooper render of its first enemy, a rival's face.
const roomFile = async (spec, mood = null, wolf = false, stage = 0) => (spec.kind === 'rival' ? rivalFace(spec.rival, mood, wolf) : picture(D.roomPicture(spec, stage)));

// ---- the start screen: rules, the member's best, and which hero to take down ----
async function startView(member, record, selected = null) {
  const guild = member.guild;
  const mine = roster().filter((n) => hasHero(record, n));
  const runs = Object.entries(record.descentBest ?? {}).filter(([, rooms]) => rooms > 0).sort((a, b) => b[1] - a[1]);
  const best = record.bestDescent?.rooms ? [record.bestDescent.hero, record.bestDescent.rooms] : runs[0];
  const runLine = ([hero, rooms]) => `${heroText(guild, hero)}${hero}  -  **${plural(rooms, 'Room')}**`;
  const e = dembed().setDescription([
    `Take one of your Heroes down **${D.FLOORS} Floors,**`,
    `**${D.LAST_ROOM} Rooms,** starting from **Level 0** with no **Items**.`,
    '',
    'Once a **Room** is **Cleared**, you pick **1 of 3 Random Items**.',
    '',
    'Every **5th** **Room** is a **Boss**, which when defeated, earns one',
    `**${rejuvIcon()}Rejuv** and **Item** and Buffs. Rivaling Heroes may attempt to`,
    'block your path in an attempt to end your run.',
    '',
    '**The Patron** waits at the bottom. **A single death ends the run.**',
  ].join('\n')).addFields(
    { name: 'Your Best Runs', value: best ? runLine(best) : 'None yet.' },
    { name: 'Other Runs.', value: runs.filter(([hero]) => hero !== best?.[0]).map(runLine).join('\n') || 'No other runs yet.' },
  );
  const files = [soulsFile()];
  if (selected) {
    e.setThumbnail('attachment://thumb.png');
    files.push(await heroPicture(selected));
  }
  e.setFooter({ text: 'Pick a Hero that you have unlocked.' });
  const options = mine.slice(0, 25).map((n) => ({ label: n, value: n, emoji: heroEmoji(guild, slugOf(n)), default: n === selected, description: record.descentBest?.[n] ? `Best: ${plural(record.descentBest[n], 'room')}` : 'No run yet' }));
  const components = [row(new StringSelectMenuBuilder().setCustomId(`${DHERO_ID}:${member.id}`).setPlaceholder('Choose a hero to take down').addOptions(options))];
  if (selected) components.push(row(button(`${DBEGIN_ID}:${member.id}:${selected}`, `Descend with ${selected}`, ButtonStyle.Success)));
  return { embeds: [e], components, files };
}

// ---- a room waiting to be fought (the telegraph: what is in it, so a pick can answer it) ----
async function roomView(member, d, { note = null, quit = false } = {}) {
  const spec = D.roomSpec(d.seed, d.room, d.hero);
  const e = dembed().setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png');
  const lines = note ? [note, ''] : [];
  if (quit) lines.push(`**Abandon the run?** It ends here with ${plural(d.room - 1, 'room')} cleared. Your best is kept.`);
  else if (spec.final) lines.push('**The Patron** waits at the bottom of the descent.', 'Beat it, then the **Weakened Patron**, in one go: health carries, no pick in between. Win and the descent is cleared.');
  else if (spec.kind === 'boss') lines.push(`**The ${D.BOSSES[spec.boss].name}** guards the end of Floor ${spec.floor}.`, `Beat it for a bigger pick and a ${rejuvIcon()}Rejuv.`);
  else if (spec.kind === 'rival') lines.push(`${heroText(member.guild, spec.rival)}**${spec.rival}** blocks the way and wants a duel.`, 'Win for a pick from their stash, a tier up. Walk Away to pass with nothing.');
  else lines.push(`**Next:** ${D.roomLine(spec)}`);
  e.setDescription(lines.join('\n'));
  if (spec.kind === 'fight' && !quit) {
    const seen = new Set();
    const about = spec.groups.filter(({ type, affix }) => !seen.has(`${type}${affix}`) && seen.add(`${type}${affix}`))
      .map(({ type, affix }) => `**${affix ? `${affix} ` : ''}${D.ARCHETYPES[type].name}**\n> ${sentence(D.ARCHETYPES[type].text)}${affix ? `\n> **Affix:** ${sentence(D.AFFIXES[affix].text)}` : ''}`);
    e.addFields({ name: 'Enemies', value: about.join('\n\n') });
  }
  e.addFields(runFields(d)).setFooter({ text: `Floor ${spec.floor} of ${D.FLOORS}  -  one death ends the run, health carries from room to room` });
  const components = [];
  if (quit) components.push(row(button(`${DQUIT_ID}:${member.id}:yes`, 'Abandon Run', ButtonStyle.Danger), button(`${DBACK_ID}:${member.id}`, 'Back')));
  else {
    const points = pointMenu(member.id, d);
    if (points) components.push(points);
    const fight = button(`${DFIGHT_ID}:${member.id}:${d.room}`, spec.kind === 'rival' ? `Fight ${spec.rival}` : spec.final ? 'Fight the Patron' : spec.kind === 'boss' ? `Fight the ${D.BOSSES[spec.boss].name}` : 'Fight', ButtonStyle.Danger);
    components.push(row(fight, ...(spec.kind === 'rival' ? [button(`${DWALK_ID}:${member.id}:${d.room}`, 'Walk Away')] : []), button(`${DBUILD_ID}:${member.id}`, 'Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')));
  }
  return { embeds: [e], components, files: [soulsFile(), await roomFile(spec)] };
}

// ---- the live fight, one snapshot (frames: play.js simulate) ----
async function fightView(run, frame) {
  const { spec } = run;
  const e = dembed().setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png')
    .setDescription(spec.kind === 'rival' ? `${run.hero} is duelling ${spec.rival}.` : spec.final ? `${run.hero} is fighting the ${run.stageNames[frame.stage]}${frame.stage ? '' : ', the Weakened Patron after it'}.` : `${run.hero} is fighting ${D.roomLine(spec)}.`)
    .addFields(
      { name: run.hero, value: `${barLine(frame.hero.hp, frame.hero.max)}${frame.hero.respawning ? '  -  Respawning' : ''}\nRejuvs Left: ${rejuvIcon()}${frame.rejuvs}` },
      ...enemyFields(frame),
      { name: 'Abilities', value: frame.abilities.map((a) => `${a.name}  -  ${a.status}`).join('\n') || 'None' },
      { name: 'Battle Log', value: frame.log.length ? frame.log.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing yet' },
    ).setFooter({ text: `Fight time ${clock(frame.t)}  -  one death ends the run` });
  return { embeds: [e], components: [], files: [soulsFile(), await roomFile(spec, spec.kind === 'rival' ? rivalMood(frame) : null, false, frame.stage)], attachments: [] };
}

// The run's current build, shared by the Build and item-replacement screens.
async function runCard(d) {
  const hero = buildHero(d.hero, D.runKit(d));
  const abilities = Object.keys(HERO_DATA[d.hero].BoundAbilities).map(Number).map((slot) => ({ slot, name: abilityName(d.hero, slot), tier: d.tiers[slot] ?? 0, locked: slot > UNLOCKS(d.level) }));
  return heroCard({
    hero: d.hero, progress: { level: d.level, into: (d.room - 1) % D.ROOMS_PER_FLOOR, needed: D.ROOMS_PER_FLOOR, max: d.level >= MAX_LEVEL },
    pointsLeft: Math.max(0, D.pointsLeft(d)), abilities, stats: statsFor(hero.stats), items: d.items, souls: 0, legendary: d.legendary ?? undefined,
    counter: { top: `FLOOR ${D.floorOf(d.room)}`, amount: `${d.room - 1}`, label: 'ROOMS CLEARED' },
  });
}

// ---- the pick: after a won room (with `run`, the fight's result on top), or redrawn while picking ----
// `animate`: the cylinder spins (the first time it is shown); `replace`: the choice the member picked with a full build (which item to give up).
async function offerView(member, d, { run = null, animate = false, replace = null } = {}) {
  const { offer } = d;
  const spec = D.roomSpec(d.seed, offer.room, d.hero);
  const cleared = spec.kind === 'boss' ? `${D.BOSSES[spec.boss].name} Defeated` : spec.kind === 'rival' ? `${spec.rival} Defeated` : `Room ${spec.room} Cleared`;
  const e = dembed(run ? WIN : undefined).setTitle(cleared).setThumbnail('attachment://thumb.png');
  const lines = [];
  if (run) {
    const voice = voiceLine(d.hero, spec.kind === 'rival' ? spec.rival : null).trim();
    if (voice) lines.push(voice, '');
    const unlocked = UNLOCKS(d.level) > UNLOCKS(d.level - 1) ? ` and unlocked **${abilityName(d.hero, UNLOCKS(d.level))}**` : '';
    lines.push(`${d.hero} reached **Level ${d.level}**${d.level >= MAX_LEVEL ? ' (the most)' : ''}${unlocked}.${spec.kind === 'boss' ? ` +${rejuvIcon()}1 Rejuv.` : ''}`);
  }
  if (d.find?.room === offer.room) lines.push(d.find.kind === 'little'
    ? `Found a little buff: **${buffText(d.find.key)}** (permanent for this run).`
    : `Found a big buff: **${BRIDGE[d.find.key].name} Bridge Buff** — ${BRIDGE[d.find.key].text}. Lasts through Floor ${spec.floor}.`);
  const upgrades = new Set(offer.kind === 'items' ? offer.choices.filter((n) => priceFor(itemByName(n), d.items).used.length) : []);
  if (replace != null) {
    const name = offer.choices[replace];
    lines.push(`Your build is full (${MAX_ITEMS} items). Choose an item to give up for **${name}**: it is lost, there are no souls in a run.`);
  } else if (offer.kind === 'buffs') lines.push(`Pick a permanent buff for this run (${D.BOSS_BUFFS} of it), or Skip to heal ${D.SKIP_HEAL * 100}%.`);
  else if (offer.kind === 'legendaries') lines.push(`Pick a legendary for the legendary slot${d.legendary ? ` (it replaces ${d.legendary})` : ''}, or Skip to heal ${D.SKIP_HEAL * 100}%.`);
  else lines.push(`Pick 1 of 3 items, or Skip to heal ${D.SKIP_HEAL * 100}%.${countItems(d.items) >= MAX_ITEMS ? ' Your build is full: an upgrade takes its part\'s place, anything else replaces an item.' : ''}`);
  e.setDescription(lines.join('\n'));
  // what each choice does
  const about = offer.choices.map((n) => {
    if (offer.kind === 'buffs') return `**${buffText(n, D.BOSS_BUFFS)}**`;
    const c = itemByName(n);
    const used = priceFor(c, d.items).used;
    const head = `**${n}**  -  ${offer.kind === 'legendaries' ? 'Legendary' : `${KIND_NAME[c.Slot]}, Tier ${c.Tier}`}${used.length ? `  -  upgrades ${used.join(' + ')}` : ''}`;
    return itemStats(c) ? `${head}\n${itemStats(c)}` : head;
  });
  e.addFields({ name: 'The Choices', value: about.join('\n').slice(0, 1024) }, ...runFields(d));
  if (run) e.addFields({ name: 'Fight Time', value: clock(run.seconds), inline: true });
  const pic = await pickPicture({
    choices: choicesOf(offer, upgrades, D.BOSS_BUFFS), animate: animate && replace == null,
    title: offer.kind === 'buffs' ? 'SELECT A BUFF' : offer.kind === 'legendaries' ? 'SELECT A LEGENDARY' : 'SELECT ITEMS',
    line: `${cleared.toUpperCase().replace(/[^A-Z0-9 ]/g, '')}`, hubText: ['PICK ONE', `OR SKIP`],
  });
  const file = replace != null ? new AttachmentBuilder(await runCard(d), { name: 'hero.png' })
    : pic.gif ? new AttachmentBuilder(pic.gif, { name: 'pick.gif' }) : new AttachmentBuilder(pic.png, { name: 'pick.png' });
  e.setImage(`attachment://${replace != null ? 'hero.png' : pic.gif ? 'pick.gif' : 'pick.png'}`).setFooter({ text: `Floor ${spec.floor} of ${D.FLOORS}  -  ${plural(d.room - 1, 'room')} of ${D.LAST_ROOM} cleared  -  one death ends the run` });
  const components = [];
  if (replace != null) {
    const all = SLOTS.flatMap((s) => d.items[s]);
    components.push(row(new StringSelectMenuBuilder().setCustomId(`${DSWAP_ID}:${member.id}:${offer.room}:${replace}`).setPlaceholder(titleCase(`Give up an item for ${offer.choices[replace]}`).slice(0, 150))
      .addOptions(all.map((n) => ({ label: n, value: n, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` })))));
    components.push(row(button(`${DBACK_ID}:${member.id}`, 'Back')));
  } else {
    const points = pointMenu(member.id, d);
    if (points) components.push(points);
    const short = (n) => (offer.kind === 'buffs' ? buffText(n, D.BOSS_BUFFS) : n);
    components.push(row(...offer.choices.map((n, i) => button(`${DTAKE_ID}:${member.id}:${offer.room}:${i}`, short(n), ButtonStyle.Primary)), button(`${DSKIP_ID}:${member.id}:${offer.room}`, `Skip (Heal ${D.SKIP_HEAL * 100}%)`)));
    components.push(row(button(`${DBUILD_ID}:${member.id}`, 'Build')));
  }
  return { embeds: [e], components, files: [soulsFile(), await heroPicture(d.hero), file] };
}

// ---- the run's build: the hero card (heroCard.js) with the run's level, abilities, items and stats ----
async function buildView(member, d) {
  const card = await runCard(d);
  const e = dembed().setTitle(`${d.hero}  -  Level ${d.level}  -  This Run`).setImage('attachment://hero.png').setThumbnail('attachment://thumb.png');
  const buffs = Object.entries(d.buffs);
  if (buffs.length) e.addFields({ name: 'Permanent Buffs (This Run)', value: buffs.map(([k, n]) => buffText(k, n)).join('\n'), inline: true });
  if (d.bridge?.length) e.addFields({ name: 'Big Buffs (This Floor)', value: d.bridge.map((k) => `${BRIDGE[k].name} — ${BRIDGE[k].text}`).join('\n'), inline: true });
  const imbued = Object.keys(d.imbues);
  if (imbued.length) e.addFields({ name: 'Imbued', value: imbued.map((n) => `${n} into ${abilityName(d.hero, d.imbues[n])}`).join('\n'), inline: true });
  e.setFooter({ text: 'This build is the run\'s own. Your hero\'s farm items, level and souls are untouched.' });
  const components = [];
  const points = pointMenu(member.id, d);
  if (points) components.push(points);
  components.push(row(button(`${DBACK_ID}:${member.id}`, 'Back')));
  return { embeds: [e], components, files: [soulsFile(), await heroPicture(d.hero), new AttachmentBuilder(card, { name: 'hero.png' })] };
}

// ---- the end of a run ----
async function overView(member, run) {
  const d = run.over;
  const { spec } = run;
  const rooms = d.room - 1;
  const e = dembed(LOSS).setTitle(`The Descent Ends  -  ${plural(rooms, 'Room')} Cleared`).setThumbnail('attachment://thumb.png');
  const how = run.timedOut ? `${d.hero} ran out of time in Room ${spec.room}.` : spec.kind === 'rival' ? `${spec.rival} won the duel in Room ${spec.room}.${voiceLine(spec.rival, d.hero)}`
    : `${d.hero} fell in Room ${spec.room} to ${D.roomLine(spec)}.`;
  e.setDescription(how);
  const lines = run.log.slice(-5);
  e.addFields(
    { name: 'Reached', value: `Floor ${spec.floor} of ${D.FLOORS}, Room ${spec.room}`, inline: true },
    { name: 'Level', value: `${d.level}`, inline: true },
    { name: 'Your Best', value: bestText(run.best), inline: true },
    { name: 'Battle Log', value: lines.length ? lines.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing happened' },
  ).setImage('attachment://hero.png').setFooter({ text: 'Every run starts again from level 0. Your hero keeps nothing from it, and loses nothing.' });
  return { embeds: [e], components: [row(button(`${DAGAIN_ID}:${member.id}`, 'Descend Again', ButtonStyle.Success))], files: [soulsFile(), await roomFile(spec, spec.kind === 'rival' ? 'gloat' : null, false, run.cleared), new AttachmentBuilder(await runCard(d), { name: 'hero.png' })], attachments: [] };
}

// ---- the descent cleared: the Patron and the Weakened Patron beaten in the last room (his call, Oct 24: nothing more than this and the leaderboard) ----
async function completeView(member, run) {
  const d = run.complete;
  const items = [...SLOTS.flatMap((s) => d.items[s]), ...(d.legendary ? [`${d.legendary} (Legendary)`] : [])];
  const e = dembed(WIN).setTitle('Descent Cleared').setThumbnail('attachment://thumb.png')
    .setDescription(`${d.hero} beat the Patron and the Weakened Patron at the bottom: all ${D.LAST_ROOM} rooms.${voiceLine(d.hero)}`)
    .addFields(
      { name: 'Level', value: `${d.level}`, inline: true },
      { name: 'Fight Time', value: clock(run.seconds), inline: true },
      { name: 'Descents Cleared', value: `${d.clears}`, inline: true },
      { name: 'Build', value: items.length ? items.join(', ').slice(0, 1024) : 'No items' },
    ).setFooter({ text: 'Every run starts again from level 0. Your hero keeps nothing from it, and loses nothing.' });
  return { embeds: [e], components: [row(button(`${DAGAIN_ID}:${member.id}`, 'Descend Again', ButtonStyle.Success))], files: [soulsFile(), await heroPicture(d.hero)], attachments: [] };
}

// ---- the Character Unlock Token for reaching TOKEN_ROOM (once per member) ----
function tokenView(hero) {
  const e = dembed(0xa98be8).setTitle('Character Unlock Token').setThumbnail('attachment://token.png')
    .setDescription(`${hero} cleared ${D.TOKEN_ROOM} rooms of the descent and earned a **Character Unlock Token**.\nUse it on the Switch Hero screen of \`/base\` to unlock any hero.`)
    .setFooter({ text: 'The descent pays one token per member.' });
  return { embeds: [e], files: [soulsFile(), new AttachmentBuilder(TOKEN_ICON, { name: 'token.png' })] };
}

// ---- /descend leaderboard ----
function leaderboardView(member, rows, record) {
  const mineAt = rows.findIndex((r) => r.id === member.id);
  const e = dembed().setTitle('Descend Leaderboard').setDescription(rows.length
    ? rows.slice(0, 10).map((r, i) => `**${i + 1}.** <@${r.id}>  -  ${r.rooms >= D.LAST_ROOM ? `**Cleared**${r.clears > 1 ? ` x${r.clears}` : ''}` : `${plural(r.rooms, 'room')} (Floor ${D.floorOf(r.rooms + 1)})`}  -  ${r.hero}`).join('\n')
    : 'Nobody has made a run yet. Start one with `/descend run`.');
  e.addFields({ name: 'Your Best', value: record.bestDescent?.rooms ? `${bestText(record.bestDescent)}${mineAt >= 0 ? `  -  #${mineAt + 1}` : ''}` : 'None yet', inline: true });
  const heroes = Object.entries(record.descentBest ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (heroes.length) e.addFields({ name: 'Your Heroes', value: heroes.map(([h, n]) => `${h}  -  ${plural(n, 'room')}`).join('\n'), inline: true });
  e.setFooter({ text: `Score: rooms cleared in one run, ${D.LAST_ROOM} at most.` });
  return { embeds: [e], components: [], files: [soulsFile()] };
}

// The run's current screen: the start screen (no run), the pick (still), or the next room.
const screen = async (member, record, opts = {}) => (!record.descent ? startView(member, record)
  : record.descent.phase === 'offer' ? offerView(member, record.descent, opts) : roomView(member, record.descent, opts));

module.exports = {
  DHERO_ID, DBEGIN_ID, DFIGHT_ID, DWALK_ID, DTAKE_ID, DSKIP_ID, DSWAP_ID, DPOINT_ID, DBUILD_ID, DBACK_ID, DQUIT_ID, DAGAIN_ID,
  startView, roomView, fightView, runCard, offerView, buildView, overView, completeView, tokenView, leaderboardView, screen, buffLine: (key) => buffText(key, D.BOSS_BUFFS),
};
