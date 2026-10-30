// /descend's messages (rules: descent.js). The same look as the farm's: souls-coloured menus and live fights, green a win, red the end of a run.
// One message per room: the room screen becomes the live fight and stays on its last moment; the result and the pick (the spinning cylinder,
// descentCard.js) are a new message, which becomes the next room's screen once a pick is made.
const path = require('node:path');
const { AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { HEROES: HERO_DATA, ABILITIES, itemByName, enhancedCard } = require('./stats');
const { buildHero } = require('./hero');
const { NO_ULT_IMBUE } = require('./items');
const { heroCard } = require('./heroCard');
const { buffText, BRIDGE } = require('./buffs');
const { countItems, priceFor, SLOTS, MAX_TIER, TIER_COSTS, MAX_LEVEL, UNLOCKS } = require('./levels');
const { hasHero } = require('./play');
const D = require('./descent');
const { pickPicture, choicesOf } = require('./descentCard');
const { rivalBuildView } = require('./enemyBuild');
const { bonusLines, drawbackLine } = require('./corruption');
const { embed, soulsFile, picture, brokerPicture, plural, row, barLine, enemyFields, heroText, rivalFace, rivalMood, voiceLine, heroPicture, clock, titleCase, itemText, itemStats, itemLines, stackLines, statsFor, WIN, LOSS } = require('./views');
const { roster } = require('./hero');
const { heroEmoji, HEROES } = require('../heroes');
const { rejuvIcon } = require('../format');
const { ASSETS } = require('../art');

const DHERO_ID = 'farm_dhero'; // select (start screen): farm_dhero:<user id>:<ascension picked>, value = hero
const DASC_ID = 'farm_dasc'; // select (start screen): farm_dasc:<user id>:<hero picked or empty>, value = ascension
const DBEGIN_ID = 'farm_dbegin'; // button "Begin Descent": farm_dbegin:<user id>:<hero>:<ascension>
const DFIGHT_ID = 'farm_dfight'; // button "Fight": farm_dfight:<user id>:<room>
const DWALK_ID = 'farm_dwalk'; // button "Flee" (a rival room) / "Leave" (the Broker's stall): farm_dwalk:<user id>:<room>
const DBVIEW_ID = 'farm_dbview'; // select "View Item" (the Broker's stall): farm_dbview:<user id>:<room>, value = item
const DCORRUPT_ID = 'farm_dcorrupt'; // select (the Broker's stall): farm_dcorrupt:<user id>:<room>, value = item to corrupt
const DTAKE_ID = 'farm_dtake'; // button (the pick): farm_dtake:<user id>:<room>:<choice 0-2>; a rival's build is a select: farm_dtake:<user id>:<room>, value = choice
const DSKIP_ID = 'farm_dskip'; // button "Skip": farm_dskip:<user id>:<room>
const DREROLL_ID = 'farm_dreroll'; // button "Reroll": farm_dreroll:<user id>:<room>
const DSWAP_ID = 'farm_dswap'; // select (a full build): farm_dswap:<user id>:<room>:<choice>, value = the item given up for it
const DPOINT_ID = 'farm_dpoint'; // select: farm_dpoint:<user id>, value = ability slot
const DBUILD_ID = 'farm_dbuild'; // button "Build": farm_dbuild:<user id>
const DBACK_ID = 'farm_dback'; // button "Back": farm_dback:<user id> (the run's current screen)
const DENEMY_ID = 'farm_denemy'; // button "View Enemy Build": farm_denemy:<user id>:<room> (a private message)
const DQUIT_ID = 'farm_dquit'; // button "Abandon Run": farm_dquit:<user id>, then farm_dquit:<user id>:yes
const DAGAIN_ID = 'farm_dagain'; // button "Descend Again" (the end of a run): farm_dagain:<user id>
const DIMBUE_ID = 'farm_dimbue'; // select: farm_dimbue:<user id>, value = ability slot for the pending item
const DBONUSSWAP_ID = 'farm_dbonusswap'; // select: farm_dbonusswap:<user id>, value = item given up for a pending BONUS
const DVIEW_ID = 'farm_dview'; // select "View Item" (an item or legendary pick): farm_dview:<user id>:<room>, value = choice 0-2

const TOKEN_ICON = path.join(ASSETS, 'farm', 'icons', 'unlock-token.png');
const KIND_NAME = { Weapon: 'Weapon', Armor: 'Vitality', Tech: 'Spirit' };
// The author line (his call, Oct 26): "Descend  -  Ascension N" on a run's screens, "Descend" where there is no run.
const dembed = (color, ascension = null) => embed(color).setAuthor({ name: ascension == null ? 'Descend' : `Descend  -  Ascension ${ascension}`, iconURL: 'attachment://souls.png' });
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setStyle(style);
const slugOf = (name) => HEROES.find((h) => h.name === name).slug;
const abilityName = (hero, slot) => ABILITIES[HERO_DATA[hero].BoundAbilities[slot].Key].Name;
const roomTitle = (spec) => `Floor ${spec.floor}  -  Room ${spec.room}${spec.final ? '  -  The Bottom' : spec.kind === 'boss' ? '  -  Boss' : spec.kind === 'rival' ? '  -  Rival' : spec.kind === 'broker' ? '  -  The Broker' : ''}`;
const healthLine = (d, hero = buildHero(d.hero, D.runKit(d))) => barLine(d.health * hero.stats.maxHealth, hero.stats.maxHealth);
const boldHealthLine = (d) => healthLine(d).replace(/(\d[\d,]* \/ \d[\d,]*)$/, '**$1**');
const bestText = (best) => (best?.rooms ? `${plural(best.rooms, 'room')} (${best.hero}${best.ascension ? `, Ascension ${best.ascension}` : ''})` : 'None yet');
// "Ascension 3" (no names, his call Oct 29) and what it adds (every level keeps the ones below it).
const ascensionName = (a) => (a ? `Ascension ${a}` : 'No Ascension');
const ascensionText = (a) => (a ? `${D.ASCENSIONS[a].text}${a > 1 ? `\nPlus every level below it (1-${a - 1}).` : ''}` : 'The descent as it is.')
const sentence = (text) => `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
const UPGRADE_LABELS = {
  WeaponPowerPerStack: ['Weapon Damage per Hero Hit', '%'], WeaponPowerPerStackNonHero: ['Weapon Damage per Camp Hit', '%'],
  TechRangeMultiplier: ['Ability Range', '%'], TechRadiusMultiplier: ['Ability Radius', '%'], AbilityDuration: ['Duration', ' s'],
  ParryCooldownReduction: ['Parry Cooldown', ' s'], MeleeResistPercent: ['Melee Resist', '%'], BonusDamagePercent: ['Bonus Damage', '%'],
  BonusHealth: ['Health', ''], CloseRangeBonusWeaponPower: ['Close-Range Damage', '%'], SpiritDamage: ['Spirit Damage', ''], TechArmorDamageReduction: ['Spirit Resist', '%'],
  ItemCooldownReduction: ['Item Cooldown Reduction', '%'], CooldownReduction: ['Cooldown Reduction', '%'], OutOfCombatHealthRegen: ['Regen Out of Combat', ''],
};
const property = (card, key) => Object.values(card).filter((v) => v?.Main).flatMap((v) => [...v.Main, ...v.Alt]).find((v) => v.Key === key) ?? card.Other?.[key];
const propertyText = (card, key) => {
  const stat = property(card, key);
  if (!stat || typeof stat.Value !== 'number') return null;
  const [name, unit] = UPGRADE_LABELS[key] ?? [key.replace(/([a-z])([A-Z])/g, '$1 $2'), stat.Postfix?.trim() ?? ''];
  return { name, value: `${stat.Value >= 0 ? '+' : ''}${+stat.Value.toFixed(2)}${unit}` };
};
const enhancedEffect = (base, card) => Object.keys(base.PropertyUpgrades ?? {}).map((key) => {
  const before = propertyText(base, key);
  const after = propertyText(card, key);
  return before && after ? `${before.name}: **${before.value} → ${after.value}**` : null;
}).filter(Boolean).join('; ');
// A choice in full (his ask, Oct 28: every item says exactly what it does, nothing cut): each choice is a field of its own (1,024 characters).
const choiceText = (lines) => {
  const text = lines.filter(Boolean).join('\n');
  return text.length > 1024 ? `${text.slice(0, 1021).replace(/\s+\S*$/, '')}...` : text;
};

// The fields every run screen shares: health, level, items, Rejuvs, points, rooms.
function runFields(d) {
  const left = D.pointsLeft(d);
  const r = D.rules(d);
  const stacks = stackLines(buildHero(d.hero, D.runKit(d))); // abilities' and items' stacks, kept for the run (his ask, Oct 28)
  return [
    { name: d.hero, value: boldHealthLine(d) },
    ...(stacks.length ? [{ name: 'Stacks', value: stacks.join('\n').slice(0, 1024) }] : []),
    { name: 'Level', value: `**${d.level}**`, inline: true },
    { name: 'Items', value: `**${countItems(d.items)} / ${r.maxItems}${d.legendary ? ' + 1' : ''}**`, inline: true },
    { name: 'Rejuvs', value: `${rejuvIcon()}**${d.rejuvs} / ${r.maxRejuvs}**`, inline: true },
    ...(left > 0 ? [{ name: 'Ability Points', value: `**${left}** to spend`, inline: true }] : []),
    { name: 'Rooms Cleared', value: `**${d.room - 1}**`, inline: true },
    ...(r.ascension ? [{ name: 'Ascension', value: `**${r.ascension}**`, inline: true }] : []),
    ...(D.corruptedOf(d).length ? [{ name: 'Corrupted', value: D.corruptedOf(d).map((c) => `**${c.name}**  -  ${drawbackLine(c)}`).join('\n').slice(0, 1024) }] : []),
  ];
}

// "Spend an ability point": the run's own abilities (the hero's farm record is never touched).
function pointMenu(userId, d) {
  const left = D.pointsLeft(d);
  const open = [1, 2, 3, 4].filter((slot) => slot <= UNLOCKS(d.level) && (d.tiers[slot] ?? 0) < MAX_TIER);
  if (left <= 0 || !open.length) return null;
  return row(new StringSelectMenuBuilder().setCustomId(`${DPOINT_ID}:${userId}`).setPlaceholder(`Spend an Ability Point (${left} Remaining)`)
    .addOptions(open.map((slot) => ({ label: `${abilityName(d.hero, slot)}  -  Tier ${(d.tiers[slot] ?? 0) + 1}`, value: String(slot), description: `Costs ${plural(TIER_COSTS[d.tiers[slot] ?? 0], 'ability point')}` }))));
}

// The room's picture: a boss's icon, the trooper render of its first enemy, a rival's face.
const roomFile = async (spec, mood = null, wolf = false, stage = 0) => (spec.kind === 'rival' ? rivalFace(spec.rival, mood, wolf) : picture(D.roomPicture(spec, stage)));
// The run's hero while playing (his ask, Oct 28): the gloat portrait above half health, the beat-up one at or below it (the pick screen keeps the icon).
const runFace = (d) => rivalFace(d.hero, d.health > 0.5 ? 'gloat' : 'critical');

// ---- the start screen: rules, the member's best, and which hero to take down ----
// `ascension`: the level picked (default: the highest unlocked); it is fixed once the run starts (his call, Oct 26).
async function startView(member, record, selected = null, ascension = null) {
  const guild = member.guild;
  const top = D.ascensionOf(record);
  const asc = Number.isInteger(ascension) && ascension >= 0 && ascension <= top ? ascension : top;
  const mine = roster().filter((n) => hasHero(record, n));
  const runs = Object.entries(record.descentBest ?? {}).filter(([, rooms]) => rooms > 0).sort((a, b) => b[1] - a[1]);
  const best = record.bestDescent?.rooms ? [record.bestDescent.hero, record.bestDescent.rooms, record.bestDescent.ascension] : runs[0];
  const runLine = ([hero, rooms, a]) => `${heroText(guild, hero)}${hero}  -  **${plural(rooms, 'Room')}**${a ? `  -  Ascension ${a}` : ''}`;
  // his own wording and line breaks (Oct 28)
  const e = dembed(undefined, top ? asc : null).setDescription([
    '• Traverse the depths of the',
    'Soul Sanctum one of your Heroes.',
    `**${D.FLOORS} Floors, ${D.LAST_ROOM} Rooms,** starting`,
    'from **Level 0** with no **Items**.',
    '',
    '• Once a **Room** is **Cleared**,',
    'you’ll receive **1 of 3 Random Items**.',
    '',
    '• Every **5th** **Room** is a **Boss**,',
    `which when defeated, earns one **${rejuvIcon()} Rejuv**,`,
    'an **Item** and Buffs.',
    '',
    '• Rivaling Heroes will attempt to',
    'end your run by blocking your path.',
    '',
    '**The Patron** waits at the bottom,',
    'and a **single** death ends your run.',
  ].join('\n')).addFields(
    { name: 'Your Best Runs', value: best ? runLine(best) : 'None yet.' },
    { name: 'Other Runs.', value: runs.filter(([hero]) => hero !== best?.[0]).map(runLine).join('\n') || 'No other runs yet.' },
  );
  if (top) e.addFields({ name: ascensionName(asc), value: ascensionText(asc) }); // (shown once Ascension 1 is unlocked: clearing the descent says so)
  const files = [soulsFile()];
  if (selected) {
    e.setThumbnail('attachment://thumb.png');
    files.push(await heroPicture(selected));
  }
  e.setFooter({ text: top ? 'Pick a Hero that you have unlocked, and an Ascension. The Ascension cannot change once the run starts.' : 'Pick a Hero that you have unlocked.' });
  const options = mine.slice(0, 25).map((n) => ({ label: n, value: n, emoji: heroEmoji(guild, slugOf(n)), default: n === selected, description: record.descentBest?.[n] ? `Best: ${plural(record.descentBest[n], 'room')}` : 'No run yet' }));
  const components = [row(new StringSelectMenuBuilder().setCustomId(`${DHERO_ID}:${member.id}:${asc}`).setPlaceholder('Choose a hero to take down').addOptions(options))];
  if (top) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(`${DASC_ID}:${member.id}:${selected ?? ''}`).setPlaceholder('Choose an Ascension')
      .addOptions(Array.from({ length: top + 1 }, (_, a) => ({ label: ascensionName(a).slice(0, 100), value: String(a), default: a === asc, description: (a ? D.ASCENSIONS[a].text : 'The descent as it is.').slice(0, 100) })))));
  }
  if (selected) components.push(row(button(`${DBEGIN_ID}:${member.id}:${selected}:${asc}`, `Descend with ${selected}${asc ? ` (Ascension ${asc})` : ''}`, ButtonStyle.Success)));
  return { embeds: [e], components, files };
}

// The Broker's footer (his voice, original lines in his style: a streetwise New York dealer, grey-area jokes). Fixed by the seed, so a redraw keeps its line.
const BROKER_LINES = [
  'Psst. Over here. I got something with a little bite to it.',
  "It ain't a curse. It's a feature with a side order of regret.",
  "Everything's a little cursed if you squint.",
  'No refunds, no receipts, no cops. Pay the man.',
  "Power ain't free, pal. It's just cheaper than you think.",
  "A little pain now, a lot of gain later. That's the whole pitch.",
  'I never sold you nothing. We just had a nice chat.',
  'Drink some water. Cursed items dry you out.',
];
const brokerLine = (seed, room) => BROKER_LINES[Math.floor(D.dice(seed, room, 'broker-line')() * BROKER_LINES.length)];

// What corrupting `name` changes, in full (the Broker's View Item dropdown).
const brokerAbout = (name) => `**${name}**\n${(bonusLines(name).join('\n') || 'None listed').slice(0, 960)}`;

// ---- a room waiting to be fought (the telegraph: what is in it, so a pick can answer it) ----
async function roomView(member, d, { note = null, quit = false, viewing = null } = {}) {
  const spec = D.specOf(d);
  const e = dembed(undefined, d.ascension ?? 0).setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png');
  const lines = note ? [note, ''] : [];
  if (quit) lines.push(`**Abandon the run?** It ends here with ${plural(d.room - 1, 'room')} cleared. Your best is kept.`);
  else if (spec.final && spec.siege) lines.push('**The whole siege** waits at the bottom of the descent: the **Base Guardian**, the **Shrine**, the **Patron** and the **Weakened Patron**.', 'Beat them all in one go: health carries, no pick in between. Win and the descent is cleared.');
  else if (spec.final && spec.first) lines.push(`**The ${D.BOSSES[spec.first].name}** stands before **the Patron** at the bottom of the descent.`, 'Beat it, the **Patron** and the **Weakened Patron**, in one go: health carries, no pick in between. Win and the descent is cleared.');
  else if (spec.final) lines.push('**The Patron** waits at the bottom of the descent.', 'Beat it, then the **Weakened Patron**, in one go: health carries, no pick in between. Win and the descent is cleared.');
  else if (spec.kind === 'boss') {
    const r = D.rules(d);
    lines.push(`**The ${D.bossName(spec, true)}** guards the end of Floor ${spec.floor}${D.escorted(spec) ? ' with **2 Swarmlings**' : ''}.`, ...(spec.affix ? [`> **Affix:** ${sentence(D.AFFIXES[spec.affix].text)}`] : []),
      ...(r.bossRejuv ? [`> It gets back up once at **${Math.round(D.ASC.bossRejuv * 100)}%** health.`] : []), `Beat it for a bigger pick and a ${rejuvIcon()}Rejuv${r.bossHeal ? `, and heal back to ${r.bossHeal < 1 ? `**${Math.round(r.bossHeal * 100)}%**` : "**full**"} health` : ""}.`);
  }
  else if (spec.kind === 'rival') lines.push(`${heroText(member.guild, spec.rival)}**${spec.rival}** blocks the way and wants a duel.`, `Win for a pick from their stash, a tier up. Flee to pass with nothing${D.rules(d).walkCost ? ` but **${Math.round(D.rules(d).walkCost * 100)}%** of your health` : ''}.`);
  else if (spec.kind === 'broker') {
    const held = D.corruptibles(d);
    lines.push("The Broker's stall calls to you. The Broker can corrupt one of your items, but it'll cost ya...");
    if (!held.length) lines.push('', 'He needs an uncorrupted **Tier 3 or 4** item to work on, and you hold none.');
    else if (d.health <= D.BROKER_COST) lines.push('', 'You are too hurt to pay him.');
    if (held.length) e.addFields({ name: 'Corrupted Effects', value: held.includes(viewing) ? brokerAbout(viewing) : 'Select an item in the drop\ndown below to view what corrupting it changes.' }); // one item at a time: all of them was too much text
  }
  else lines.push(`**Next:** ${D.roomLine(spec)}`);
  e.setDescription(lines.join('\n'));
  if (spec.kind === 'fight' && !quit) {
    const seen = new Set();
    const affixes = (g) => [g.affix, g.affix2].filter(Boolean);
    const about = spec.groups.filter((g) => !seen.has(`${g.type}${g.family}${affixes(g)}`) && seen.add(`${g.type}${g.family}${affixes(g)}`))
      .map((g) => `**${[...affixes(g).map((a) => D.affixTag(a, true)), D.groupName(g)].join(' ')}**\n> ${sentence(D.groupText(g))}${!spec.legacy && D.groupSpecial(g) ? `\n> **Special Attack:** ${sentence(D.groupSpecial(g))}` : ''}${affixes(g).map((a) => `\n> **Affix:** ${sentence(D.AFFIXES[a].text)}`).join('')}`);
    e.addFields({ name: 'Enemies', value: about.join('\n\n') });
  }
  e.addFields(runFields(d)).setFooter({ text: spec.kind === 'broker' ? brokerLine(d.seed, spec.room) : `Floor ${spec.floor} of ${D.FLOORS}${spec.legacy ? '' : `: ${D.FLOOR_NAMES[spec.floor - 1]}`}` });
  const components = [];
  if (quit) components.push(row(button(`${DQUIT_ID}:${member.id}:yes`, 'Abandon Run', ButtonStyle.Danger), button(`${DBACK_ID}:${member.id}`, 'Back')));
  else {
    const points = pointMenu(member.id, d);
    if (points) components.push(points);
    if (spec.kind === 'broker') {
      const held = D.corruptibles(d);
      if (held.length) {
        components.push(row(new StringSelectMenuBuilder().setCustomId(`${DBVIEW_ID}:${member.id}:${d.room}`).setPlaceholder('View Item')
          .addOptions(held.slice(0, 25).map((n) => ({ label: n, value: n, default: n === viewing, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` })))));
      }
      if (held.length && d.health > D.BROKER_COST) {
        components.push(row(new StringSelectMenuBuilder().setCustomId(`${DCORRUPT_ID}:${member.id}:${d.room}`).setPlaceholder(`Corrupt an Item (Costs ${Math.round(D.BROKER_COST * 100)}% Health)`)
          .addOptions(held.slice(0, 25).map((n) => ({ label: n, value: n, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` })))));
      }
      components.push(row(button(`${DWALK_ID}:${member.id}:${d.room}`, 'Leave', ButtonStyle.Primary), button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')));
      return { embeds: [e], components, files: [soulsFile(), brokerPicture()] };
    }
    const fight = button(`${DFIGHT_ID}:${member.id}:${d.room}`, spec.kind === 'rival' ? `Fight ${spec.rival}` : spec.final ? `Fight the ${D.BOSSES[D.finalKeys(spec)[0]].name}` : spec.kind === 'boss' ? `Fight the ${D.bossName(spec, true)}` : 'Fight', ButtonStyle.Danger);
    components.push(row(fight, ...(spec.kind === 'rival' ? [button(`${DWALK_ID}:${member.id}:${d.room}`, 'Flee')] : []), button(`${DBUILD_ID}:${member.id}`, 'Your Build')),
      row(button(`${DENEMY_ID}:${member.id}:${d.room}`, 'View Enemy Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')));
  }
  return { embeds: [e], components, files: [soulsFile(), await roomFile(spec)] };
}

// ---- the live fight, one snapshot (frames: play.js simulate) ----
async function fightView(run, frame) {
  const { spec } = run;
  const e = dembed(undefined, spec.ascension ?? 0).setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png')
    .addFields(
      { name: run.hero, value: `${barLine(frame.hero.hp, frame.hero.max)}${frame.hero.respawning ? '  -  Respawning' : ''}\nRejuvs Left: ${rejuvIcon()}${frame.rejuvs}` },
      ...enemyFields(frame),
      { name: 'Abilities', value: frame.abilities.map((a) => `${a.name}  -  ${a.status}`).join('\n') || 'None' },
      { name: 'Battle Log', value: frame.log.length ? frame.log.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing yet' },
    ).setFooter({ text: `Fight time ${clock(frame.t)}` }); // no "one death ends the run" while fighting (his ask, Oct 29)
  return { embeds: [e], components: [], files: [soulsFile(), await roomFile(spec, spec.kind === 'rival' ? rivalMood(frame) : null, false, frame.stage)], attachments: [] };
}

// The run's current build, shared by the Build and item-replacement screens.
async function runCard(d) {
  const hero = buildHero(d.hero, D.runKit(d));
  const abilities = Object.keys(HERO_DATA[d.hero].BoundAbilities).map(Number).map((slot) => ({ slot, name: abilityName(d.hero, slot), tier: d.tiers[slot] ?? 0, locked: slot > UNLOCKS(d.level) }));
  return heroCard({
    hero: d.hero, progress: { level: d.level, into: (d.room - 1) % D.ROOMS_PER_FLOOR, needed: D.ROOMS_PER_FLOOR, max: d.level >= MAX_LEVEL },
    pointsLeft: Math.max(0, D.pointsLeft(d)), abilities, stats: statsFor(hero.stats), items: d.items, souls: 0, legendary: d.legendary ?? undefined, enhanced: d.enhanced ?? [], corrupted: D.corruptedOf(d).map((c) => c.name),
    counter: { top: `FLOOR ${Math.min(D.floorOf(d.room), D.FLOORS)}`, amount: `${d.room - 1}`, label: 'ROOMS CLEARED' },
  });
}

// What choice `i` of the run's offer does, in full.
const VIEW_PROMPT = 'Select an Item in the drop\ndown below to view its effect.';
function choiceAbout(d, i) {
  const { offer } = d;
  const n = offer.choices[i];
  if (offer.kind === 'buffs') return `**${buffText(n, D.rules(d).bossBuffs)}**`;
  const base = itemByName(n);
  const enhanced = offer.enhanced?.includes(n);
  const c = enhanced ? enhancedCard(base) : base;
  const used = priceFor(base, d.items).used;
  const effect = itemLines(base).join('\n');
  const improvement = enhanced ? enhancedEffect(base, c) : null;
  const head = `${enhanced ? '[Enhanced] ' : ''}**${n}**`;
  const type = `**${offer.kind === 'legendaries' ? 'Legendary' : KIND_NAME[c.Slot]}** ; __Tier ${c.Tier}__`;
  const upgrades = used.length ? `Upgrades **${used.join(' + ')}**` : '';
  const bonus = offer.bonuses?.[i] ? `**BONUS:** ${offer.bonuses[i]} ; __Tier ${itemByName(offer.bonuses[i]).Tier}__` : '';
  return choiceText([head, type, effect, improvement && `**Enhanced:** ${improvement}`, upgrades, bonus]);
}

// ---- the pick: after a won room (with `run`, the fight's result on top), or redrawn while picking ----
// `animate`: the cylinder spins (the first time it is shown); `replace`: the choice the member picked with a full build (which item to give up).
async function offerView(member, d, { run = null, animate = false, replace = null } = {}) {
  const { offer } = d;
  const spec = D.specOf(d, offer.room);
  const r = D.rules(d);
  const cleared = spec.kind === 'boss' ? `${D.bossName(spec, true)} Defeated` : spec.kind === 'rival' ? `${spec.rival} Defeated` : `Room ${spec.room} Cleared`;
  const e = dembed(run ? WIN : undefined).setAuthor({ name: `Descend - Room ${spec.room} Cleared`, iconURL: 'attachment://souls.png' }).setThumbnail('attachment://thumb.png');
  const lines = [];
  const addEvent = (text) => {
    if (lines.length) lines.push('');
    lines.push(text);
  };
  if (run) {
    const voice = voiceLine(d.hero, spec.kind === 'rival' ? spec.rival : null).trim();
    if (voice) addEvent(voice);
    const unlocked = UNLOCKS(d.level) > UNLOCKS(d.level - 1) ? ` and unlocked **${abilityName(d.hero, UNLOCKS(d.level))}**` : '';
    addEvent(`${d.hero} reached **Level ${d.level}**${unlocked}.${spec.kind === 'boss' ? ` +${rejuvIcon()}1 Rejuv.` : ''}`);
  }
  if (d.find?.room === offer.room) addEvent(d.find.kind === 'little'
    ? `Found a Buff.\n**${buffText(d.find.key)}**\nPermanent for this run.`
    : `Found a Buff.\n**${BRIDGE[d.find.key].name} Bridge Buff**\n${BRIDGE[d.find.key].text}\nLasts through Floor **${spec.floor}**.`);
  const upgrades = new Set(offer.kind === 'items' ? offer.choices.filter((n) => priceFor(itemByName(n), d.items).used.length) : []);
  const heal = `Heal **${Math.round(r.skipHeal * 100)}%**`;
  const skipText = offer.kind === 'buffs' ? `Skip: ${heal}.` : `Skip: ${heal} and **${r.skipBuffs} Perma-Buffs**.`;
  if (replace != null) {
    const name = offer.choices[replace];
    addEvent(`Your build is full (**${r.maxItems}** items). Choose an item to give up for **${name}**: it is lost, there are no souls in a run.`);
  } else if (offer.kind === 'buffs') addEvent(`Pick a permanent buff for this run (**${r.bossBuffs}** of it), or ${skipText}`);
  else if (offer.kind === 'legendaries') addEvent(`Pick a legendary for the legendary slot${d.legendary ? ` (it replaces ${d.legendary})` : ''}, or ${skipText}`);
  else if (offer.rival) addEvent(`Take **1** item from ${offer.rival}'s build, or ${skipText}${countItems(d.items) >= r.maxItems ? ` Your build is full: an upgrade takes its part's place, anything else replaces an item.` : ''}`);
  else addEvent(`Pick **1 of ${offer.choices.length}** items, or ${skipText}${countItems(d.items) >= r.maxItems ? ' Your build is full: an upgrade takes its part\'s place, anything else replaces an item.' : ''}`);
  e.setDescription(lines.join('\n'));
  // what each choice does: buffs all at once; an item only once it is picked in View Item (his ask, Oct 28: three in full was too much to read)
  const about = offer.kind === 'buffs' ? offer.choices.map((n, i) => choiceAbout(d, i)) : [VIEW_PROMPT];
  e.addFields(...about.map((value, i) => ({ name: i ? '​' : offer.kind === 'buffs' ? 'Buff Choices' : 'Item Choices', value })), ...runFields(d));
  if (run) e.addFields({ name: 'Fight Time', value: `**${clock(run.seconds)}**`, inline: true });
  const pic = offer.rival ? { png: (await rivalBuildView(offer.rival, offer.theirs)).files[2].attachment } : await pickPicture({
    choices: choicesOf(offer, upgrades, r.bossBuffs), animate: animate && replace == null,
    title: offer.kind === 'buffs' ? 'SELECT A BUFF' : offer.kind === 'legendaries' ? 'SELECT A LEGENDARY' : 'SELECT ITEMS',
    line: `${cleared.toUpperCase().replace(/[^A-Z0-9 ]/g, '')}`,
  });
  const file = replace != null ? new AttachmentBuilder(await runCard(d), { name: 'hero.jpg' })
    : pic.gif ? new AttachmentBuilder(pic.gif, { name: 'pick.gif' }) : new AttachmentBuilder(pic.png, { name: 'pick.png' });
  e.setImage(`attachment://${replace != null ? 'hero.jpg' : pic.gif ? 'pick.gif' : 'pick.png'}`).setFooter({ text: `Floor ${spec.floor} of ${D.FLOORS}  -  ${d.room - 1} ${d.room - 1 === 1 ? 'Room' : 'Rooms'} of ${D.LAST_ROOM} Cleared` });
  const components = [];
  if (replace != null) {
    const all = SLOTS.flatMap((s) => d.items[s]);
    components.push(row(new StringSelectMenuBuilder().setCustomId(`${DSWAP_ID}:${member.id}:${offer.room}:${replace}`).setPlaceholder(titleCase(`Give up an item for ${offer.choices[replace]}`).slice(0, 150))
      .addOptions(all.map((n) => ({ label: n, value: n, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` })))));
    components.push(row(button(`${DBACK_ID}:${member.id}`, 'Back')));
  } else {
    const points = pointMenu(member.id, d);
    if (points) components.push(points);
    const short = (n) => (offer.kind === 'buffs' ? buffText(n, r.bossBuffs) : n);
    // a rival's whole build is too many for buttons: a dropdown (his ask, Oct 29)
    const picks = offer.rival ? [new StringSelectMenuBuilder().setCustomId(`${DTAKE_ID}:${member.id}:${offer.room}`).setPlaceholder(`Take an item from ${offer.rival}`)
      .addOptions(offer.choices.map((n, i) => ({ label: n, value: String(i), description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}${upgrades.has(n) ? `, upgrades ${priceFor(itemByName(n), d.items).used.join(' + ')}` : ''}`.slice(0, 100) })))]
      : offer.choices.map((n, i) => button(`${DTAKE_ID}:${member.id}:${offer.room}:${i}`, short(n), ButtonStyle.Primary));
    if (offer.kind !== 'buffs') components.push(row(new StringSelectMenuBuilder().setCustomId(`${DVIEW_ID}:${member.id}:${offer.room}`).setPlaceholder('View Item')
      .addOptions(offer.choices.map((n, i) => ({ label: `${offer.enhanced?.includes(n) ? '[Enhanced] ' : ''}${n}`, value: String(i) })))));
    const actions = [button(`${DSKIP_ID}:${member.id}:${offer.room}`, offer.kind === 'buffs' ? `Skip ; Heal ${Math.round(r.skipHeal * 100)}%` : `Skip ; Heal ${Math.round(r.skipHeal * 100)}% and gain ${r.skipBuffs} Buffs`), button(`${DBUILD_ID}:${member.id}`, 'Your Build')];
    if (offer.kind === 'items' && !offer.rival) actions.push(button(`${DREROLL_ID}:${member.id}:${offer.room}`, `Reroll (${d.rerolls ?? r.rerolls} left)`).setDisabled((d.rerolls ?? r.rerolls) <= 0));
    components.push(row(...picks), row(...actions));
  }
  return { embeds: [e], components, files: [soulsFile(), await runFace(d), file] };
}

// ---- the run's build: the hero card (heroCard.js) with the run's level, abilities, items and stats ----
async function buildView(member, d) {
  const card = await runCard(d);
  const e = dembed(undefined, d.ascension ?? 0).setTitle(`${d.hero}  -  Level ${d.level}  -  This Run`).setImage('attachment://hero.jpg').setThumbnail('attachment://thumb.png');
  const buffs = Object.entries(d.buffs);
  if (buffs.length) e.addFields({ name: 'Permanent Buffs (This Run)', value: buffs.map(([k, n]) => buffText(k, n)).join('\n'), inline: true });
  if (d.bridge?.length) e.addFields({ name: 'Big Buffs (This Floor)', value: d.bridge.map((k) => `${BRIDGE[k].name} — ${BRIDGE[k].text}`).join('\n'), inline: true });
  if (d.enhanced?.length) e.addFields({ name: 'Enhanced Items', value: d.enhanced.join('\n'), inline: true });
  const imbued = Object.keys(d.imbues);
  if (imbued.length) e.addFields({ name: 'Imbued', value: imbued.map((n) => `${n} into ${abilityName(d.hero, d.imbues[n])}`).join('\n'), inline: true });
  e.setFooter({ text: 'This run\s build, items, and ability upgrades will not impact /farm hero\s.' });
  const components = [];
  const points = pointMenu(member.id, d);
  if (points) components.push(points);
  components.push(row(button(`${DBACK_ID}:${member.id}`, 'Back')));
  return { embeds: [e], components, files: [soulsFile(), await runFace(d), new AttachmentBuilder(card, { name: 'hero.jpg' })] };
}

// Descend owns its build, so an imbue item must ask here rather than borrowing the
// farm hero's picker. There is no bypass: the run waits for this choice.
async function imbueView(member, d) {
  const name = d.imbuing;
  const slots = [1, 2, 3, 4].filter((slot) => slot <= UNLOCKS(d.level) && (!NO_ULT_IMBUE.has(name) || slot !== 4));
  const e = dembed(undefined, d.ascension ?? 0).setTitle(`Imbue ${name}`).setThumbnail('attachment://thumb.png')
    .setDescription(`Choose which unlocked ability receives **${name}**. This item must be imbued before you continue.`)
    .setFooter({ text: `Floor ${D.floorOf(d.room)} of ${D.FLOORS}  -  your run waits for this choice` });
  return {
    embeds: [e],
    components: [row(new StringSelectMenuBuilder().setCustomId(`${DIMBUE_ID}:${member.id}`).setPlaceholder(`Imbue ${name} into`)
      .addOptions(slots.map((slot) => ({ label: abilityName(d.hero, slot), value: String(slot), description: slot === 4 ? 'Ultimate' : `Ability ${slot}` }))))],
    files: [soulsFile(), await runFace(d)],
  };
}

async function bonusView(member, d) {
  const pending = d.pendingBonus;
  const all = SLOTS.flatMap((s) => d.items[s]).filter((n) => n !== pending.upgraded); // everything but the item just upgraded into
  const e = dembed(undefined, d.ascension ?? 0).setTitle('Upgrade Taken').setThumbnail('attachment://thumb.png')
    .setDescription(`**${pending.upgraded}** replaced **${pending.used.join(' + ')}**.\n\n**BONUS: ${pending.name}**\nChoose an item to give up for the bonus.`)
    .setImage('attachment://hero.jpg');
  return {
    embeds: [e],
    components: [row(new StringSelectMenuBuilder().setCustomId(`${DBONUSSWAP_ID}:${member.id}`).setPlaceholder(`Give up an item for ${pending.name}`)
      .addOptions(all.map((n) => ({ label: n, value: n, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` }))))],
    files: [soulsFile(), await runFace(d), new AttachmentBuilder(await runCard(d), { name: 'hero.jpg' })],
  };
}

// ---- the end of a run ----
async function overView(member, run) {
  const d = run.over;
  const { spec } = run;
  const rooms = d.room - 1;
  const e = dembed(LOSS, d.ascension ?? 0).setTitle(`The Descent Ends  -  ${plural(rooms, 'Room')} Cleared`).setThumbnail('attachment://thumb.png');
  const how = run.timedOut ? `${d.hero} ran out of time in Room ${spec.room}.` : spec.kind === 'rival' ? `${spec.rival} won the duel in Room ${spec.room}.${voiceLine(spec.rival, d.hero)}`
    : `${d.hero} fell in Room ${spec.room} to ${D.roomLine(spec)}.`;
  e.setDescription(how);
  const lines = run.log.slice(-5);
  e.addFields(
    { name: 'Reached', value: `Floor ${spec.floor} of ${D.FLOORS}, Room ${spec.room}`, inline: true },
    { name: 'Level', value: `${d.level}`, inline: true },
    ...(d.ascension ? [{ name: 'Ascension', value: `${d.ascension}`, inline: true }] : []),
    { name: 'Your Best', value: bestText(run.best), inline: true },
    { name: 'Battle Log', value: lines.length ? lines.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Nothing happened' },
  ).setImage('attachment://hero.jpg').setFooter({ text: 'Every run starts again from level 0. Your hero keeps nothing from it, and loses nothing.' });
  return { embeds: [e], components: [row(button(`${DAGAIN_ID}:${member.id}`, 'Descend Again', ButtonStyle.Success))], files: [soulsFile(), await roomFile(spec, spec.kind === 'rival' ? 'gloat' : null, false, run.cleared), new AttachmentBuilder(await runCard(d), { name: 'hero.jpg' })], attachments: [] };
}

// ---- the descent cleared: the Patron and the Weakened Patron beaten in the last room (his call, Oct 24: nothing more than this and the leaderboard) ----
async function completeView(member, run) {
  const d = run.complete;
  const e = dembed(WIN, d.ascension ?? 0).setTitle('Descent Cleared').setThumbnail('attachment://thumb.png')
    .setDescription(`${d.hero} beat the Patron and the Weakened Patron at the bottom: all ${D.LAST_ROOM} rooms${d.ascension ? ` on **Ascension ${d.ascension}**` : ''}.${d.unlocked ? `\n\n**Ascension ${d.unlocked}** unlocked for all your heroes: ${D.ASCENSIONS[d.unlocked].text}` : ''}${voiceLine(d.hero)}`)
    .addFields(
      ...(d.token ? [{ name: 'Character Unlock Token', value: `Clearing **Ascension ${d.ascension}** for the first time earned a token. Use it on the Switch Hero screen of \`/base\` to unlock any hero.` }] : []), // his call, Oct 28
      { name: 'Level', value: `${d.level}`, inline: true },
      { name: 'Fight Time', value: clock(run.seconds), inline: true },
      { name: 'Descents Cleared', value: `${d.clears}`, inline: true },
    ).setImage('attachment://hero.jpg').setFooter({ text: 'Every run starts again from level 0. Your hero keeps nothing from it, and loses nothing.' });
  return { embeds: [e], components: [row(button(`${DAGAIN_ID}:${member.id}`, 'Descend Again', ButtonStyle.Success))], files: [soulsFile(), await runFace(d), new AttachmentBuilder(await runCard(d), { name: 'hero.jpg' })], attachments: [] };
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
    ? rows.slice(0, 10).map((r, i) => `**${i + 1}.** <@${r.id}>  -  ${r.ascension ? `**Ascension ${r.ascension}**, ` : ''}${r.rooms >= D.LAST_ROOM ? `**Cleared**${r.clears > 1 ? ` x${r.clears}` : ''}` : `${plural(r.rooms, 'room')} (Floor ${D.floorOf(r.rooms + 1)})`}  -  ${r.hero}`).join('\n')
    : 'Nobody has made a run yet. Start one with `/descend run`.');
  e.addFields({ name: 'Your Best', value: record.bestDescent?.rooms ? `${bestText(record.bestDescent)}${mineAt >= 0 ? `  -  #${mineAt + 1}` : ''}` : 'None yet', inline: true });
  const heroes = Object.entries(record.descentBest ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (heroes.length) e.addFields({ name: 'Your Heroes', value: heroes.map(([h, n]) => `${h}  -  ${plural(n, 'room')}`).join('\n'), inline: true });
  e.setFooter({ text: `Score: the highest Ascension, then rooms cleared in one run (${D.LAST_ROOM} at most).` });
  return { embeds: [e], components: [], files: [soulsFile()] };
}

// The run's current screen: the start screen (no run), the pick (still), or the next room.
const screen = async (member, record, opts = {}) => (!record.descent ? startView(member, record)
  : record.descent.phase === 'offer' ? offerView(member, record.descent, opts)
    : record.descent.phase === 'imbue' ? imbueView(member, record.descent)
      : record.descent.phase === 'bonus' ? bonusView(member, record.descent) : roomView(member, record.descent, opts));

module.exports = {
  DHERO_ID, DASC_ID, DBEGIN_ID, DFIGHT_ID, DWALK_ID, DBVIEW_ID, DCORRUPT_ID, DENEMY_ID, DTAKE_ID, DSKIP_ID, DREROLL_ID, DSWAP_ID, DPOINT_ID, DBUILD_ID, DBACK_ID, DQUIT_ID, DAGAIN_ID, DIMBUE_ID, DBONUSSWAP_ID, DVIEW_ID,
  choiceAbout, brokerAbout, startView, roomView, fightView, runCard, offerView, buildView, imbueView, bonusView, overView, completeView, tokenView, leaderboardView, screen, buffLine: (key, n = D.BOSS_BUFFS) => buffText(key, n),
};
