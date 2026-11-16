// /descend's messages (rules: descent.js). The same look as the farm's: souls-coloured menus and live fights, green a win, red the end of a run.
// One message per room: the room screen becomes the live fight and stays on its last moment; the result and the pick (the spinning cylinder,
// descentCard.js) are a new message, which becomes the next room's screen once a pick is made.
const path = require('node:path');
const { AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { HEROES: HERO_DATA, ABILITIES, itemByName, enhancedCard, TEMPERED } = require('./stats');
const { crackedPicture } = require('./itemArt');
const { buildHero } = require('./hero');
const { NO_ULT_IMBUE } = require('./items');
const { heroCard } = require('./heroCard');
const { buffText, BRIDGE } = require('./buffs');
const { countItems, priceFor, SLOTS, MAX_TIER, TIER_COSTS, MAX_LEVEL, UNLOCKS } = require('./levels');
const { hasHero } = require('./play');
const { rankText, rankOf, BONUS, FIRST } = require('./rebirth');
const D = require('./descent');
const { pickPicture, choicesOf } = require('./descentCard');
const { rivalBuildView } = require('./enemyBuild');
const { bonusLines, drawbackLine } = require('./corruption');
const { powerupIcon, withIcon, splitField, abilityIcon } = require('./icons');
const { URN_CARRIER } = require('./buffs');
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
const DFRAGILE_ID = 'farm_dfragile'; // buttons (the Broker's stall): farm_dfragile:<user id>:<room>:take|mend
const DCORRUPT_ID = 'farm_dcorrupt'; // select (the Broker's stall): farm_dcorrupt:<user id>:<room>, value = item to corrupt
const DTAKE_ID = 'farm_dtake'; // button (the pick): farm_dtake:<user id>:<room>:<choice 0-2>; a rival's build is a select: farm_dtake:<user id>:<room>, value = choice
const the = (hero) => (hero === 'Lash' ? 'The Lash' : hero); // his call Nov 5: only Lash is called "The", like the game
const DRECRUIT_ID = 'farm_drecruit'; // button "Recruit <rival>" under a beaten rival's pick: farm_drecruit:<user id>:<room>
const DSKIP_ID = 'farm_dskip'; // button "Skip": farm_dskip:<user id>:<room>
const DREROLL_ID = 'farm_dreroll'; // button "Reroll": farm_dreroll:<user id>:<room>
const DSMASH_ID = 'farm_dsmash'; // Billy: button Take All (farm_dsmash:<user id>:<room>), or the give-up select when the build is full (value = the Items given up)
const DSWAP_ID = 'farm_dswap'; // select (a full build): farm_dswap:<user id>:<room>:<choice>, value = the item given up for it
const DPOINT_ID = 'farm_dpoint'; // select: farm_dpoint:<user id>, value = ability slot
const DBUILD_ID = 'farm_dbuild'; // button "Build": farm_dbuild:<user id>
const DBACK_ID = 'farm_dback'; // button "Back": farm_dback:<user id> (the run's current screen)
const DENEMY_ID = 'farm_denemy'; // button "View Enemy Build": farm_denemy:<user id>:<room> (a private message)
const DQUIT_ID = 'farm_dquit'; // button "Abandon Run": farm_dquit:<user id>, then farm_dquit:<user id>:yes
const DAGAIN_ID = 'farm_dagain'; // button "Descend Again" (the end of a run): farm_dagain:<user id>
const DIMBUE_ID = 'farm_dimbue'; // select: farm_dimbue:<user id>, value = ability slot for the pending item
const DBONUSSWAP_ID = 'farm_dbonusswap'; // select: farm_dbonusswap:<user id>, value = item given up for a pending BONUS
const DDOOR_ID = 'farm_ddoor'; // buttons "Left Door" / "Right Door" (a door run, Nov 13): farm_ddoor:<user id>:<room>:<door index>
const DREST_ID = 'farm_drest'; // buttons (a rest stop / a quiet corner): farm_drest:<user id>:<room>:rest|break
const DTINKER_ID = 'farm_dtinker'; // select (a rest stop): farm_dtinker:<user id>:<room>, value = item to try to enhance
const DDEAL_ID = 'farm_ddeal'; // selects (the Curiosity Dealer): farm_ddeal:<user id>:<room>:swap|sell, value = item
const DTVIEW_ID = 'farm_dtview'; // select "View Item" (a rest stop): farm_dtview:<user id>:<room>, value = item (its enhanced bonuses)
const DFEED_ID = 'farm_dfeed'; // select (a pick, with a Lil Helper): farm_dfeed:<user id>:<room>, value = the offered choice to feed it
const DVIEW_ID = 'farm_dview'; // select "View Item" (an item or legendary pick): farm_dview:<user id>:<room>, value = choice 0-2

const TOKEN_ICON = path.join(ASSETS, 'farm', 'icons', 'unlock-token.png');
const KIND_NAME = { Weapon: 'Weapon', Armor: 'Vitality', Tech: 'Spirit' };
// The author line (his call, Oct 26): "Descend  -  Ascension N" on a run's screens, "Descend" where there is no run.
const dembed = (color, ascension = null) => embed(color).setAuthor({ name: ascension == null ? 'Descend' : `Descend  -  Ascension ${ascension}`, iconURL: 'attachment://souls.png' });
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setStyle(style);
const slugOf = (name) => HEROES.find((h) => h.name === name).slug;
const abilityName = (hero, slot) => ABILITIES[HERO_DATA[hero].BoundAbilities[slot].Key].Name;
const EVENT_TITLE = { urn: 'The Soul Urn', wounded: 'A Wounded Rival', dealer: 'The Curiosity Dealer', patron: "A Patron's Favor", teleporter: 'Teleporter', rift: 'The Rift', visit: 'A Hero' };
const RIFT_PICTURE = path.join(ASSETS, 'farm', 'icons', 'unstable-rift.png'); // the wiki's Unstable Rift icon (the thumbnail, his ask Nov 6)
const pct = (x) => `${Math.round(x * 100)}%`;
// A hero room (Nov 6): what the hero offers or asks for, in full (the room screen), and the items each deal can take.
function visitLines(guild, d, spec) {
  const who = `${heroText(guild, spec.hero)}**${the(spec.hero)}**`;
  const [m1, m2] = [D.MINIONS.ghoul, D.MINIONS.turret];
  if (spec.deal === 'replica') {
    const lines = [`${who} sets down her brushes.`, '"Mind if I borrow something? Just for reference."', '',
      '**A Replica**', 'Lend her one of your Items and she paints an **exact copy** of it.', 'Enhanced, Fragile or Corrupted, her artistic prowess knows no bounds!', '',
      '**Chances of Replication**', ...D.REPLICA_CHANCE.map((c, i) => `Tier ${i + 1}: **${pct(c)}**`), '',
      '**If she fails to replicate your Item, it will be destroyed.**', '',
      "Violet can't replicate Legendaries, after all,", 'no one can create a copy of a masterpiece.'];
    if (d.replicaPick) lines.push('', `She'll copy your **${d.replicaPick}** (**${pct(D.replicaChance(d.replicaPick))}**). Your build is full: choose an Item to give up for the replica.`);
    else if (D.slotsUsed(d) >= D.rules(d).maxItems) lines.push('', 'Your build is full: if she succeeds, you give up an Item for the replica (you choose it before she tries).');
    if (!D.replicables(d).length) lines.push('', 'You hold no Items for her to copy.');
    return lines;
  }
  if (spec.deal === 'upgrade') {
    const pick = d.tinkerPick;
    return [`${who} squints at your gear. "I can make that better. Probably."`, '',
      'Select an Item to have McGinnis Tinker with.', '',
      `**Enhance It:** **${pct(D.TINKER_CHANCE)}** chance. If she fails, nothing happens.`,
      `**Upgrade Item:** she tries to turn it into an Item it builds into, the one you choose. Tier 1 **${pct(D.MCGINNIS_CHANCE[0])}**, Tier 2 **${pct(D.MCGINNIS_CHANCE[1])}**, Tier 3 **${pct(D.MCGINNIS_CHANCE[2])}**. **If she fails, the Item turns Fragile.**`,
      '**Repair the Item:** a Fragile Item becomes a normal one. Always works.', '',
      `**Whatever she does costs ${pct(D.UPGRADE_COST)} of your current Health**, win or lose (you have **${pct(d.health)}**, so **${pct(d.health * (1 - D.UPGRADE_COST))}** after).`,
      ...(d.upgradePick ? ['', `She'll try to upgrade your **${d.upgradePick}** (**${pct(D.mcginnisChance(d.upgradePick))}**). Choose the Item she aims for.`]
        : pick ? ['', `She's tinkering with your **${pick}**${D.fragileOf(d).includes(pick) ? ' (Fragile)' : ''}. What should she do?`] : []),
      ...(D.workables(d).length ? [] : ['', 'She has nothing to work on right now.'])];
  }
  if (spec.deal === 'fuse') {
    const { a, b } = d.fusePick ?? {};
    return [`${who} cracks his knuckles. "Spare parts make the best monsters."`, '',
      '**Abomination**', 'Pick 2 of your Items. Victor stitches them into 1 Item that keeps both effects and uses **1** slot.', '',
      '**Chances of Stitching**', `Two Tier 1 Items: **${pct(D.FUSE_CHANCE - 0.2)}**`, `Two Tier 4 Items: **${pct(D.FUSE_CHANCE - 0.8)}**`, '',
      '**If he fails to stitch your Items, both will turn Fragile.**',
      ...(a ? ['', b ? `Victor will stitch your **${a}** to your **${b}** (**${pct(D.fuseChance(a, b))}**).` : `Stitching your **${a}**. Choose the second Item.`] : []),
      ...(D.fuseables(d).length >= 2 ? [] : ['', 'You need **2** Items that are not already stitched together.'])];
  }
  if (spec.deal === 'doorway') return [`${who} bows, one gloved hand on a door that was not in this wall a moment ago.`, '"Allow me. At The Baroness, no door is ever truly closed."', '',
    `${abilityIcon('Doorway')} **Doorway**`.trim(), 'At your next choice of doors, the door you do not pick stays open.', 'When the room you picked is done, you can step back through and play the other room too.', '',
    'It works **1** time. Until then it waits for you.',
    ...(d.doorway ? ['', 'You already have a Doorway waiting.'] : [])];
  if (spec.deal === 'burrow') return [`${who} dig through the floor in a spray of dirt.`, '"We know a shortcut. Hold your breath."', '',
    '**Burrow**', `They dig straight to this Floor's boss. Every room between is passed: you get its **Level**, and no pick and no find.`, '',
    `**${plural(D.floorBoss(spec.room) - spec.room - 1, 'room')}** to dig past.`, ...(d.urn ? ['', 'You carry the Soul Urn. They will not dig with it.'] : [])];
  if (spec.deal === 'harrow') {
    const n = d.harrowN ?? 0;
    return [`${who} checks your chart and frowns. "Sit. This will cost you."`, '',
      '**Treatment**', `Each treatment heals **${pct(D.HARROW.heal)}** of your Max Health and costs **${D.HARROW.cost}** Perma-Buffs. You can have as many as you have Perma-Buffs for, and leave when you like.`, '',
      `You have **${D.buffTotal(d)}** Perma-Buffs and **${pct(d.health)}** Health.${n ? ` Treatments so far: **${n}**.` : ''}`, ...(D.buffTotal(d) < D.HARROW.cost ? ['', 'You cannot pay for another treatment.'] : [])];
  }
  if (spec.deal === 'venom') return [`${who} unscrews a small vial and tips it over your weapon.`, '"Don\'t lick it. Seriously."', '',
    '**Poisoned Weapon**', `For the next **${D.VENOM_ROOMS}** rooms, every bullet you hit leaves a poison on the enemy.`, ...(d.venom ? ['', 'Your weapon is already poisoned.'] : [])];
  if (spec.deal === 'rats') return [`${who} whistles, and something small scurries out of the dark.`, `"Keep this one in your sight. They're my idiots, and now they're yours."`, '',
    '**A Rat of Ratannia**', `A Rat joins you. It bites, and each bite takes a little Bullet Resist off the enemy. After every fight you win with a Rat standing, another joins, up to **${D.RAT.cap}** Rats.`, '',
    `They stay until they fall or this Floor's boss is beaten. Every Rat has a name. Watch out for **Rabies Ronnie**.`];
  if (spec.deal === 'smash') return [`${who} spins his bat and grins at the next shop window.`, '"Why pick one? Let\'s smash the case and take the lot."', '',
    '**Smash and Grab**', 'At your next Item pick, you take every Item on the screen.', 'Each one is Fragile.', '',
    '**Fragile Items** are weaker, and shatter when you fall below **10%** Health or use a Rejuv.', 'It works **1** time. A full build only keeps what fits.',
    ...(d.smash ? ['', 'You already have a Smash and Grab waiting.'] : [])];
  if (spec.deal === 'stoke') {
    const s = d.stoke;
    const n = s?.n ?? 0;
    const line = n > 1 ? '"You sure? I know how this goes. I used to be the guy who never stopped."' : n ? '"There. That\'s got some heat in it now."' : '"Lemme see what you\'re carryin\', pal. First one\'s on the house."';
    return [`${who} snaps his fingers and a flame sits in his palm.`, line, '',
      '**Stoke the Fire**', `Hand him **1** Item. Each Stoke tempers it: **+${pct(TEMPERED)}** to its stats.`, 'You can take it back after any Stoke and keep the heat it has.', '',
      '**Chances of Burning**', ...D.STOKE.burn.map((c, i) => `Stoke ${i + 1}: **${pct(c)}**`), '',
      '**If it burns, the Item is destroyed.**',
      ...(s ? ['', n ? `Your **${s.name}** is at **+${pct(TEMPERED * n)}**. The next Stoke burns it **${pct(D.STOKE.burn[n])}** of the time.` : `He is holding your **${s.name}**.`]
        : D.stokeables(d).length ? [] : ['', 'You hold no Items he can temper.'])];
  }
  if (spec.deal === 'lesson') {
    const grade = D.gradeOf(d);
    const next = D.floorOf(spec.room) + 1;
    return [`${who} straightens his tie. "Class is in session. Let me see how you've done, then I'll teach you what's waiting below."`, '',
      `**Floor ${next}: ${D.FLOOR_NAMES[next - 1]}**`, `You will meet: **${D.lessonKinds(spec.room).map((k) => D.kindName(k)).join('**, **')}**.`, '',
      '**The Lesson**', `Pick **1** Enemy to study. For the whole of Floor ${next}, you take less damage from it and deal more damage to it.`, '',
      '**Your Grade**', `Dynamo grades you on the Health you have kept. You have **${pct(d.health)}**, so your Grade is **${grade.letter}**.`,
      D.GRADES.map((g) => `${g.letter} **${pct(g.power)}**`).join(', '),
      `Right now your Lesson is worth **${pct(grade.power)}**.`,
      ...(d.lesson ? ['', 'You already have a Lesson running.'] : [])];
  }
  if (spec.deal === 'helper') return [`${who} tucks a small bundle into your arms. "This one's a Lil Helper. Feed it, and it grows on you."`, '',
    `${abilityIcon('Lil Helpers')} **Lil Helper**`.trim(), `It fights beside you until it falls. While it lives, you gain **${pct(D.HELPER.aura)}** Bullet Resist and Spirit Resist.`, '',
    `**Feed It an Item** to take it. That Item is gone for good. The Item's slot picks the stat, and each Tier is worth **${pct(D.HELPER.perTier)}**:`,
    '**Weapon** Items: its Damage', '**Vitality** Items: its Health', '**Spirit** Items: the Resist it gives you', '',
    'After that, every pick screen lets you feed it any Item you were offered and are not taking. There is no limit.',
    ...(D.helperOf(d) ? ['', 'You already have a Lil Helper.'] : D.fuseables(d).length ? [] : ['', 'You hold no Items to feed it.'])];
  if (spec.deal === 'travel') return [`${who} unfolds a map that was not there a moment ago. "Name a room. I'll take you there."`, '',
    '**The Traveler**', (d.v ?? 0) >= 8 ? 'Pick a type of room. Mirage opens one more door to it at your next choice.' : 'Pick the type of the next room. Mirage teleports you there with his ultimate, and it replaces the next room.', '',
    ...(d.urn ? ['You carry the **Soul Urn**, so the Traveler will not take you.'] : D.travelKinds(d, spec.room).length ? [] : ['There is nowhere else to go from here.'])];
  if (spec.deal === 'capsule') return [`${who} turns a dial. "Lend me something. I'll give it back, and it will have had time to think."`, '',
    '**Time Capsule**', `Seal **1** Item in her capsule. It comes back at a random moment before this Floor ends. Its Cooldown is **${pct(D.CAPSULE.perRoom)}** shorter for every room it was away, for the rest of the run, and its slot stays reserved while it is gone.`, '',
    `Only Items with a Cooldown can be sealed. If it is your **Legendary**, it shatters the capsule when it comes back and its Cooldown is rerolled, anywhere from **${pct(1 - D.CAPSULE.legendary[0])}** shorter to **${pct(D.CAPSULE.legendary[1] - 1)}** longer.`,
    ...(D.capsulables(d).length ? [] : ['', 'You hold no Item with a Cooldown for her to take.'])];
  if (spec.deal === 'turret') return [`${who} pats her Mini Turret. "She's yours for a while, if you've got a part to spare."`, '',
    `**Give her a Tier 1 or 2 Item** and her **${m2.name}** fights beside you until it falls or this Floor's boss is beaten. A Tier 2 Item builds a sturdier one: **${pct(m2.tiers[1] - 1)}** more Health and damage.`, ...(D.parts(d).length ? [] : ['', 'You hold no Tier 1 or 2 Items to give her.'])];
  if (spec.deal === 'ghouls') {
    const have = d.minions?.find((m) => m.kind === 'ghoul')?.count ?? 0;
    return [`${who} rattles her jar. "Take a few of mine. They don't bite. Much."`, '',
      `Up to **${m1.count} ${m1.name}s** fight beside you until they fall or this Floor's boss is beaten. They claw at the enemies and draw fire. A ${m1.name} that falls is gone.`, '',
      `**Each ${m1.name} costs ${pct(D.GHOUL_COST)} of your current Health.** Click for one Ghoul at a time: **${have} / ${m1.count}**. You have **${pct(d.health)}** Health${have < m1.count ? `; the next one leaves you **${pct(d.health * (1 - D.GHOUL_COST))}**` : ''}.`];
  }
  if (spec.deal === 'castling') return [`${who} studies the board. "A sound move, if you're brave enough."`, '',
    '**Castling:** give up one of your Items for a pick of **3** Items of the same tier in another slot (Weapon, Vitality or Spirit).', ...(D.castleables(d).length ? [] : ['', 'None of your Items can be castled right now.'])];
  if (spec.deal === 'assistant') return [`${who} snaps his fingers. "My Assistant will see you through. Do try to return them in one piece."`, '',
    `**Accept:** his **Spectral Assistant** follows you for the next **${plural(D.ASSISTANT.fights, 'fight')}**: after every shot you land, it fires one at **${pct(D.ASSISTANT.echo)}** of its damage.`];
  if (spec.deal === 'rescue') return [`${who} lands beside you and shakes the dust off her wings. "If it goes badly down there, I'll be watching."`, '',
    '**Air Drop**', `The next time a fight would kill you, **Ivy** drops in and pulls you out. She takes you back **${D.RESCUE.back}** rooms, never past the start of the Floor, to a Rest Stop with **${pct(D.RESCUE.health)}** of your Health.`, '',
    'You fight the rooms from there again with fresh enemies, for no Level and no pick. The room you lost pays as usual. Once.', '',
    "She can't help with a boss, the Patron or the first room of a Floor."];
  return [`${who} opens her book. "Every hero deserves a happy ending."`, '', `**Plot Armor:** once you have no Rejuv left, the next time you would die this run you live at **${Math.round(require('./engine').PLOT_ARMOR.health * 100)}%** health instead, and nothing can hurt you for **${require('./engine').PLOT_ARMOR.safe}** seconds. Once.`];
}
// A give-up dropdown's options: each held item once, and Violet's copy of one as its own '<item> (Replica)' option (his ask, Nov 7).
const giveUp = (d, names, opt) => names.flatMap((n) => {
  const count = SLOTS.reduce((s, slot) => s + d.items[slot].filter((x) => x === n).length, 0);
  const reps = Math.min(count, (d.replicas ?? []).filter((x) => x === n).length);
  const partner = D.fusedOf(d).find((p) => p.includes(n))?.find((x) => x !== n); // a fused part goes with its partner
  const plainOpt = partner ? { ...opt(n), description: `Fused with ${partner}: both are lost`.slice(0, 100) } : opt(n);
  return [...(count > reps ? [plainOpt] : []), ...(reps ? [{ ...opt(n), label: n + D.REPLICA, value: n + D.REPLICA }] : [])];
}).slice(0, 25);
const itemOpt = (n) => ({ label: n, value: n, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` });
// The room types Mirage can take you to (his ask, Nov 7): [name, what is there].
const TRAVEL_ROOMS = { rest: ['A Rest Stop', 'Heal, or Tinker with an Item'], breather: ['A Quiet Corner', 'Break the crates for a find'], broker: ["The Broker's Stall", 'Corrupt an Item'], urn: ['The Soul Urn', 'Carry it for permanent buffs'], wounded: ['A Wounded Rival', 'Recruit a hero as an ally'], dealer: ['The Curiosity Dealer', 'Swap an Item up, or sell one to heal'] };
const VISIT_ITEMS = { replica: (d) => (d.replicaPick ? null : D.replicables(d)), upgrade: () => null, turret: D.parts, castling: D.castleables, capsule: D.capsulables, helper: (d) => (D.helperOf(d) ? [] : D.fuseables(d)) };
const VISIT_PROMPT = { replica: 'Lend Violet an Item to copy', upgrade: 'Have McGinnis upgrade an Item', turret: 'Give McGinnis a Tier 1 or 2 Item', castling: 'Castle an Item', capsule: 'Seal an Item in the Capsule', helper: 'Feed the Lil Helper an Item' };
// What feeding Item `n` to the Lil Helper adds: the stat its slot picks, per tier.
const feedGain = (n) => `+${pct(D.HELPER.perTier * Math.min(4, itemByName(n).Tier))} ${{ Weapon: 'Damage', Armor: 'Health', Tech: 'Resist for You' }[itemByName(n).Slot]}`;
const visitChance = (deal, n) => (deal === 'helper' ? `, ${feedGain(n)}` : deal === 'replica' ? `, ${pct(D.replicaChance(n))} chance` : deal === 'upgrade' ? `, ${pct(D.mcginnisChance(n))} chance` : deal === 'turret' && itemByName(n).Tier > 1 ? `, turret +${pct(D.MINIONS.turret.tiers[1] - 1)}` : '');
// The bottom's two Patrons, as the screens name them: the run's own (VERSION 3: the Archmother or the Hidden King), else the Patron.
const patronNames = (spec) => { const keys = D.finalKeys(spec).slice(-2); return keys.map((k) => D.BOSSES[k].name); };
const roomTitle = (spec) => `Floor ${spec.floor}  -  Room ${spec.room}${spec.kind === 'doors' ? `  -  ${['', 'One Door', 'Two Doors', 'Three Doors', 'Four Doors'][spec.doors.length]}` : spec.final ? '  -  The Bottom' : spec.kind === 'boss' ? '  -  Boss' : spec.kind === 'rival' ? '  -  Rival' : spec.kind === 'broker' ? '  -  The Broker' : spec.kind === 'rest' ? '  -  Rest Stop' : spec.kind === 'breather' ? '  -  A Quiet Corner' : spec.kind === 'visit' ? `  -  ${spec.hero}` : EVENT_TITLE[spec.kind] ? `  -  ${EVENT_TITLE[spec.kind]}` : ''}`;
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
  const [name, unit] = UPGRADE_LABELS[key] ?? [key.replace(/Tech/g, 'Spirit').replace(/([a-z])([A-Z])/g, '$1 $2'), stat.Postfix?.trim() ?? ''];
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
    { name: 'Items', value: `**${D.slotsUsed(d)} / ${r.maxItems}${d.legendary ? ' + 1' : ''}**`, inline: true },
    { name: 'Rejuvs', value: `${rejuvIcon()}**${d.rejuvs} / ${r.maxRejuvs}**`, inline: true },
    ...(left > 0 ? [{ name: 'Ability Points', value: `**${left}** To Spend`, inline: true }] : []),
    { name: 'Rooms Cleared', value: `**${d.room - 1}**`, inline: true },
    ...(r.ascension ? [{ name: 'Ascension', value: `**${r.ascension}**`, inline: true }] : []),
    ...(d.urn || d.ally || d.blessing || d.empowered || d.minions?.length || d.assistant || d.plotArmor || d.rescue || d.capsule || d.lesson || d.doorway || d.smash || d.venom ? [{ name: 'With You', value: [ // the event rooms' and hero rooms' lasting effects (Nov 4, Nov 6)
      d.empowered && `**Empowered** by the ${D.BOSSES[d.empowered].name}: **+${Math.round(D.EMPOWER * 100)}%** health, weapon damage and spirit power`,
      d.urn && `**Soul Urn:** ${plural(d.urn.left, 'room')} to deliver it`,
      d.ally && `**${the(d.ally.hero)}**`,
      ...(d.minions ?? []).map((m) => (m.kind === 'helper' ? `${abilityIcon('Lil Helpers')}**Lil Helper**: Damage **+${Math.round(D.HELPER.perTier * (m.w ?? 0) * 100)}%**, Health **+${Math.round(D.HELPER.perTier * (m.v ?? 0) * 100)}%**, Resist **+${Math.round(D.helperAura(d) * 100)}%**, until it falls` : null) ?? `**${m.count} ${m.count === 1 ? D.MINIONS[m.kind].name : `${D.MINIONS[m.kind].name}s`}**: ${m.fights ? `${plural(m.fights, 'more fight')}` : `until the Floor ${m.floor} boss is beaten`}`),
      d.assistant && `**Spectral Assistant**: ${plural(d.assistant.fights, 'more fight')}`,
      d.lesson && `**Dynamo's Lesson** (Grade ${d.lesson.grade}): **${pct(d.lesson.power)}** less damage from **${D.kindName(d.lesson.kind)}** and **${pct(d.lesson.power)}** more damage to them, for Floor ${d.lesson.floor}`,
      d.capsule && `**Time Capsule**: your **${d.capsule.item}** is away and comes back before this Floor ends`,
      d.rescue && `**Ivy's Rescue**: the next time a fight would kill you, she takes you back **${D.RESCUE.back}** rooms to a Rest Stop`,
      d.plotArmor && '**Plot Armor**: the next time you would die with no Rejuv left, you live',
      d.doorway && (d.doorway === true ? "**The Doorman's Doorway**: at your next choice of doors, the door you do not pick stays open" : "**The Doorman's Doorway**: the door you left is still open"),
      d.venom && `**Vyper's poison**: every bullet you hit poisons the enemy, ${plural(d.venom.left, 'more room')}`,
      d.smash && "**Billy's Smash and Grab**: at your next Item pick you take every Item on it, all Fragile",
      d.blessing && `**The ${D.BOSSES[d.blessing].name}'s blessing** against the Patron at the bottom`,
    ].filter(Boolean).join('\n') }] : []),
    ...(D.corruptedOf(d).length ? [{ name: 'Corrupted', value: D.corruptedOf(d).map((c) => `**${c.name}**  -  ${drawbackLine(c)}`).join('\n').slice(0, 1024) }] : []),
  ];
}

// "Spend an ability point": the run's own abilities (the hero's farm record is never touched).
function pointMenu(userId, d) {
  const left = D.pointsLeft(d);
  const open = [1, 2, 3, 4].filter((slot) => slot <= UNLOCKS(d.level) && (d.tiers[slot] ?? 0) < MAX_TIER);
  if (left <= 0 || !open.length) return null;
  return row(new StringSelectMenuBuilder().setCustomId(`${DPOINT_ID}:${userId}`).setPlaceholder(`Spend an Ability Point (${left} Remaining)`)
    .addOptions(open.map((slot) => ({ label: `${abilityName(d.hero, slot)}  -  Tier ${(d.tiers[slot] ?? 0) + 1}`, value: String(slot), description: `Costs ${plural(TIER_COSTS[d.tiers[slot] ?? 0], 'Ability Point')}` }))));
}

// The room's picture: a boss's icon, the trooper render of its first enemy, a rival's face.
const roomFile = async (spec, mood = null, wolf = false, stage = 0) => (spec.kind === 'rival' ? rivalFace(spec.rival, mood, wolf) : spec.kind === 'rift' ? picture(RIFT_PICTURE) : picture(D.roomPicture(spec, stage)));
// The run's hero while playing (his ask, Oct 28): the gloat portrait above half health, the beat-up one at or below it (the pick screen keeps the icon).
const runFace = (d) => rivalFace(d.hero, d.health > 0.5 ? 'gloat' : 'critical');

// ---- the start screen: rules, the member's best, and which hero to descend with ----
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
    'Traverse the depths of the Soul',
    'Sanctum with one of your Heroes.',
    `**${D.FLOORS} Floors, ${D.LAST_ROOM} Rooms,** starting`,
    'from **Level 0** with no **Items**.',
    '',
    "Once a **Room** is **Cleared**, you'll choose",
    'to receive **1 of 3 Random Items**.',
    '',
    'Every **5th** **Room** is a **Boss**, which',
    'when defeated, will earn your Hero',
    `one **${rejuvIcon()} Rejuv**, an **Item**, and Buffs.`,
    '',
    'A **Patron** (the Archmother or the', 'Hidden King) waits at the bottom,',
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
  e.setFooter({ text: top ? 'The Ascension cannot be changed once the run starts.' : 'Pick a Hero that you have unlocked.' });
  const options = mine.slice(0, 25).map((n) => ({ label: n, value: n, emoji: heroEmoji(guild, slugOf(n)), default: n === selected, description: record.descentBest?.[n] ? `Best: ${plural(record.descentBest[n], 'room')}` : 'No run yet' }));
  const components = [row(new StringSelectMenuBuilder().setCustomId(`${DHERO_ID}:${member.id}:${asc}`).setPlaceholder('Choose a Hero to descend with.').addOptions(options))];
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
// How a wounded hero is found (Nov 14, his ask: 5 variations). Each finishes "<emoji> <Hero> ...".
const WOUNDED_LINES = [
  'lies injured against the wall.',
  'staggers into the room from behind you.',
  'slumps against a crate, clutching their side.',
  'limps out of the dark, leaving a trail behind them.',
  'crawls toward you from a pile of rubble.',
  'sits propped against the doorway, barely staying upright.',
];
const brokerLine = (seed, room) => BROKER_LINES[Math.floor(D.dice(seed, room, 'broker-line')() * BROKER_LINES.length)];

// What corrupting `name` changes, in full (the Broker's View Item dropdown).
const brokerAbout = (name) => `**${name}**\n${(bonusLines(name).join('\n') || 'None listed').slice(0, 960)}`;

// ---- Two Doors (Nov 13): the doors a run stands before, what each one shows, and a button per door ----
const DOOR_ROOMS = { ...TRAVEL_ROOMS, teleporter: ['A Teleporter', 'Step In and land in a room with no fight'] };
const doorNames = (doors) => doors.map((x, i) => (x.travel ? "Mirage's Door" : (doors.filter((y) => !y.travel).length === 2 ? ['Left Door', 'Right Door'] : ['Left Door', 'Middle Door', 'Right Door'])[i]));
function doorLines(door) {
  if (door.mystery) return ['**Mystery Room**', 'What waits inside is not known.'];
  if (door.kind === 'fight') return ['**Fight Room**', ...D.roomLine(door).split(', ')];
  if (door.kind === 'rift') return ['**The Rift**', `**${door.rivals.length}** ${door.rivals.length === 1 ? 'Hero is' : 'Heroes are'} Battling to Win it.`];
  const [name, about] = DOOR_ROOMS[door.kind];
  return [`**${name}**`, `${about}.`];
}
// The Doorman's Doorway, on the screen of the room after the one it was used in: what is behind the door left open, and its Step Back button.
const doorwayFields = (d) => D.doorwayOpen(d).map((x) => ({ name: 'The Doorway', value: [...doorLines(x), `Step back to Room ${x.room} and play it too.`].join('\n').slice(0, 1024), inline: true }));
const doorwayRow = (member, d) => { const open = D.doorwayOpen(d); return open.length ? [row(...open.map((x, i) => button(`${DDOOR_ID}:${member.id}:${d.room}:b${i}`, open.length > 1 ? `Step Back: ${doorLines(x)[0].replaceAll('*', '')}`.slice(0, 80) : 'Step Back Through the Doorway')))] : []; };
async function doorsView(member, d, spec, note) {
  const names = doorNames(spec.doors);
  const e = dembed(undefined, d.ascension ?? 0).setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png')
    .setDescription([...(note ? [note, ''] : []), 'The way forward splits here. Pick a door.', '', 'A Fight Room and a Mystery Room give a Level and a pick.', 'Every other door gives a Level and what is inside it.'].join('\n'))
    .addFields(spec.doors.map((x, i) => ({ name: names[i], value: doorLines(x).join('\n').slice(0, 1024), inline: true })))
    .addFields(doorwayFields(d))
    .addFields(runFields(d)).setFooter({ text: `Floor ${spec.floor} of ${D.FLOORS}: ${D.FLOOR_NAMES[spec.floor - 1]}` });
  const points = pointMenu(member.id, d);
  return { embeds: [e], files: [soulsFile(), await runFace(d)], components: [...(points ? [points] : []),
    row(...spec.doors.map((x, i) => button(`${DDOOR_ID}:${member.id}:${d.room}:${i}`, names[i], ButtonStyle.Primary))),
    ...doorwayRow(member, d),
    row(button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run'))] };
}

// ---- a room waiting to be fought (the telegraph: what is in it, so a pick can answer it) ----
async function roomView(member, d, { note = null, quit = false, viewing = null } = {}) {
  const spec = D.specOf(d);
  const e = dembed(undefined, d.ascension ?? 0).setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png');
  if (spec.kind === 'doors' && !quit) return doorsView(member, d, spec, note);
  const lines = note ? [note, ''] : [];
  let crackedShown = null; // the Fragile Item the stall shows (the one he is about to hand over, or the one you carry)
  if (quit) lines.push(`**Abandon the run?** It ends here with ${plural(d.room - 1, 'room')} cleared. Your best is kept.`);
  else if (spec.final) {
    const [patron, weak] = patronNames(spec);
    // his wording (Nov 5): the other Patron grants your wish; a run from before Nov 4 has no side, so it keeps the plain line
    const side = D.patronOf(d);
    const wish = (who) => (side ? `Defeat ${who}, and the **${D.BOSSES[D.otherPatron(side)].name}** will grant your wish.` : 'Win and the descent is cleared.');
    if (spec.siege) lines.push(`**The whole siege** waits at the bottom of the descent: the **Base Guardian**, the **Shrine**, the **${patron}** and the **${weak}**.`, wish('them all'));
    else if (spec.first) lines.push(`**The ${D.BOSSES[spec.first].name}** stands before **the ${patron}** at the bottom of the descent.`, wish('them'));
    else lines.push(`The **${patron}** awaits you at the bottom of the descent.`, wish(side === 'hidden-king' ? 'him' : 'her'));
    if (d.blessing) lines.push(`> **The ${D.BOSSES[d.blessing].name}'s blessing:** both fight you with **${Math.round(D.BLESSING * 100)}%** less health and damage.`);
  }
  else if (spec.kind === 'boss') {
    const r = D.rules(d);
    lines.push(`**The ${D.bossName(spec, true)}** guards the end of Floor ${spec.floor}${D.escorted(spec) ? ' with **2 Swarmlings**' : ''}.`, ...(spec.affix ? [`> **Affix:** ${sentence(D.AFFIXES[spec.affix].text)}`] : []),
      `Beat it for a bigger pick and a ${rejuvIcon()}Rejuv${r.bossHeal ? `, and heal back to ${r.bossHeal < 1 ? `**${Math.round(r.bossHeal * 100)}%**` : "**full**"} health` : ""}.`);
  }
  else if (spec.kind === 'rival') lines.push(`${heroText(member.guild, spec.rival)}**${the(spec.rival)}** crosses your path.`, '', 'If you Defeat them, you can choose to Recruit them as a temporary Ally, or to pick an Item from their build.', '', `If you choose to Flee, **${the(spec.rival)}** won't allow you to leave unscathed.`);
  else if (spec.kind === 'broker') {
    const held = D.corruptibles(d);
    const due = D.fragileDue(d);
    const cracked = D.fragileOf(d)[0];
    crackedShown = due ? D.fragileGift(d) : cracked ?? null;
    if (crackedShown) e.setImage('attachment://fragile.jpg');
    lines.push("The Broker's stall calls to you. The Broker can corrupt one of your items, but it'll cost ya...");
    if (due) lines.push('', `He looks you over and shakes his head. "Nothing on ya worth my time, pal. I pity ya, I really do. So here, on the house: a cracked **${crackedShown}**. Ain't much to look at yet, but it's worth the taking."`, `**Fragile Item:** weaker than the real thing, and it shatters if a Rejuv goes off or you drop under **${Math.round(D.FRAGILE_BREAK * 100)}%** health. Keep it in one piece until the next stall and he'll mend it into an **Enhanced** one, free.`);
    else if (cracked) lines.push('', `He eyes your cracked **${cracked}**. "Still in one piece? I'll mend that into an **Enhanced** one. On the house."`);
    else if (!held.length) lines.push('', 'He needs an uncorrupted **Tier 3 or 4** Item to work on, and you hold none.');
    if (!due && held.length && d.health <= D.BROKER_COST) lines.push('', 'You are too hurt to pay him.');
    if (held.length) e.addFields({ name: 'Corrupted Effects', value: held.includes(viewing) ? brokerAbout(viewing) : 'Select an Item in the drop\ndown below to view what corrupting it changes.' }); // one item at a time: all of them was too much text
  }
  else if (spec.kind === 'rest') {
    lines.push(d.replay ? `**A Rest Stop.**\n**Ivy** set you down here after Room ${d.replay.until}. Catch your breath, then fight the rooms again. There is no Level and no pick for a room you already cleared.` : '**A Rest Stop.**\nCatch your breath, or tinker with your Items.', '',
      `**Rest:** Heal **${Math.round(D.REST_HEAL * 100)}%** of your Max Health.`,
      `**Tinker:** Attempt to Enhance an Item.`);
    if (!D.tinkerables(d).length) lines.push('', 'None of your Items can be Enhanced right now.');
    else e.addFields({ name: 'Enhanced Bonuses', value: D.tinkerables(d).includes(viewing) ? `**${viewing}**\n${(bonusLines(viewing, 'enhanced').join('\n') || 'None listed').slice(0, 960)}` : 'Select an Item in the drop\ndown below to view what enhancing it adds.' });
  }
  else if (spec.kind === 'breather') lines.push('**A Quiet Corner.** Crates are stacked against the wall, and a **Golden Statue** stands in the corner. Nothing here wants a fight.', '', 'Break them open for a small find, and gain a level.');
  else if (spec.kind === 'urn') {
    const [lo, hi] = D.URN_ROOMS;
    lines.push('**The Soul Urn** sits here, humming with souls.', '', `**Pick it up** and carry it through the next **${lo} to ${hi}** rooms. While you carry it: ${URN_CARRIER.text.replace(', No Parry', '')}. But you **can't parry** or use a **Teleporter**.`,
      `Survive until it's delivered for **${D.URN_BUFFS} permanent buffs**.`);
    if (d.urn) lines.push('', `You are already carrying one (**${plural(d.urn.left, 'room')}** to go).`);
  }
  else if (spec.kind === 'wounded') {
    const [lo, hi] = D.ALLY_FIGHTS;
    const how = WOUNDED_LINES[Math.floor(D.dice(d.seed, spec.room, 'wounded-line')() * WOUNDED_LINES.length)]; // fixed by the seed, so a redraw keeps its line
    lines.push(`${heroText(member.guild, spec.rival)}**${the(spec.rival)}** ${how} They could use your assistance.`, '', `**Recruit:** they fight beside you for the next **${lo} to ${hi}** fights, at **${Math.round(D.allyHealth(d.ascension ?? 0) * 100)}%** health, then leave you any one Item from their build.`);
    if (d.ally) lines.push('', `You already have an ally: **${d.ally.hero}**.`);
  }
  else if (spec.kind === 'dealer') lines.push('**The Curiosity Dealer** waves you into his back room. No souls down here, so he trades.', '', '**Swap:** give him an Item for a pick of 3 a tier higher in the same slot.', '**Sell:** give him an Item for a **full heal**.');
  else if (spec.kind === 'patron') {
    const [patron, weak] = patronNames(D.specOf(d, D.LAST_ROOM));
    const by = D.BOSSES[D.otherPatron(D.patronOf(d) ?? 'archmother')].name;
    const [lo, hi] = D.ALLY_FIGHTS;
    lines.push(`**The ${by}** reaches out to you. "The ${patron} waits at the bottom. Take my blessing."`, '', 'Choose one:',
      '**Restore:** heal to **full health** now.',
      `**Weaken the ${patron}:** at the bottom, the **${patron}** and the **${weak}** fight you with **${Math.round(D.BLESSING * 100)}%** less health and damage.`,
      `**Empower:** **+${Math.round(D.EMPOWER * 100)}%** health, weapon damage and spirit power for the rest of the run.`,
      `**Send an Ally:** a hero fights beside you for the next **${lo} to ${hi}** fights, then leaves you any one item from their build.${d.ally ? ' (You already have an ally.)' : ''}`);
  }
  else if (spec.kind === 'teleporter') {
    lines.push('A **Teleporter** hums in the corner. Step in, and it sends you to a room with no fight: a rest stop, a quiet corner, the Broker\'s stall, the Soul Urn, a wounded rival or the Curiosity Dealer.');
    if (d.urn) lines.push('', "You carry the Soul Urn: the Teleporter won't take you.");
  }
  else if (spec.kind === 'visit') lines.push(...visitLines(member.guild, d, spec));
  else if (spec.kind === 'rift') {
    const n = spec.rivals.length;
    lines.push('**An Unstable Rift is Opening!**', '',
      `**${n}** ${n === 1 ? 'Hero is' : 'Heroes are'} Battling to Win it:`,
      ...spec.rivals.map((h, i) => `${heroText(member.guild, h)}${the(h)}${i === n - 1 ? '.' : ','}`), '',
      `Everyone fights everyone. **Win** and **${D.MINIONS.rift.count} Rift Troopers** fight beside you for the rest of this Floor, its boss included.`,
      `**Lose** and you flee with the health you have left (at least **${pct(D.RIFT.flee)}**) and gain nothing: the Rift can't end your run.`, '', spec.noPick ? 'Walk past it for a Level.' : 'Walk past it for a level and a pick.');
  }
  else lines.push(`**Next:** ${D.roomLine(spec)}`);
  if (spec.teleported) lines.unshift('The Teleporter brought you here.', '');
  if ((D.EVENT_KINDS.includes(spec.kind) || spec.kind === 'visit') && !['rest', 'breather'].includes(spec.kind)) lines.push('', spec.noPick ? 'You gain a Level either way.' : 'You gain a Level and a Pick either way.');
  e.setDescription(lines.join('\n'));
  if (spec.kind === 'fight' && !quit) {
    const seen = new Set();
    const affixes = (g) => [g.affix, g.affix2].filter(Boolean);
    const about = spec.groups.filter((g) => !seen.has(`${g.type}${g.family}${affixes(g)}`) && seen.add(`${g.type}${g.family}${affixes(g)}`))
      .map((g) => `**${[...affixes(g).map((a) => D.affixTag(a, true)), D.groupName(g)].join(' ')}**\n> ${sentence(D.groupText(g))}${!spec.legacy && D.groupSpecial(g) ? `\n> **Special Attack:** ${sentence(D.groupSpecial(g))}` : ''}${affixes(g).map((a) => `\n> **Affix:** ${sentence(D.AFFIXES[a].text)}`).join('')}`);
    e.addFields({ name: 'Enemies', value: about.join('\n\n') });
  }
  if (!quit) e.addFields(doorwayFields(d));
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
      const cracked = D.fragileOf(d)[0];
      const deals = D.fragileDue(d) ? [button(`${DFRAGILE_ID}:${member.id}:${d.room}:take`, 'Take the Fragile Item', ButtonStyle.Success)] // forced: no Leave
        : [button(`${DWALK_ID}:${member.id}:${d.room}`, 'Leave', ButtonStyle.Danger), ...(cracked ? [button(`${DFRAGILE_ID}:${member.id}:${d.room}:mend`, `Mend ${cracked}`.slice(0, 80), ButtonStyle.Success)] : [])];
      components.push(row(...deals, button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')));
      return { embeds: [e], components, files: [soulsFile(), brokerPicture(), ...(crackedShown ? [new AttachmentBuilder(await crackedPicture(crackedShown), { name: 'fragile.jpg' })] : [])] };
    }
    if (spec.kind === 'rest' || spec.kind === 'breather') {
      if (spec.kind === 'rest' && D.tinkerables(d).length) {
        const options = (selected) => D.tinkerables(d).slice(0, 25).map((n) => ({ label: n, value: n, ...(selected && { default: n === viewing }), description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` }));
        components.push(row(new StringSelectMenuBuilder().setCustomId(`${DTVIEW_ID}:${member.id}:${d.room}`).setPlaceholder('View Item').addOptions(options(true))));
        components.push(row(new StringSelectMenuBuilder().setCustomId(`${DTINKER_ID}:${member.id}:${d.room}`).setPlaceholder('Tinker: Attempt to Enhance an Item').addOptions(options(false))));
      }
      const act = spec.kind === 'rest' ? button(`${DREST_ID}:${member.id}:${d.room}:rest`, `Rest (Heal ${Math.round(D.REST_HEAL * 100)}%)`, ButtonStyle.Success) : button(`${DREST_ID}:${member.id}:${d.room}:break`, 'Break Them Open', ButtonStyle.Success);
      components.push(row(act, button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')));
      return { embeds: [e], components, files: [soulsFile(), spec.kind === 'breather' ? picture(path.join(ASSETS, 'farm', 'icons', 'golden-statue.png')) : await runFace(d)] };
    }
    if (spec.kind === 'visit') { // a hero room (Nov 6): Accept, or a dropdown of the Items its deal takes, and Turn Down
      const act = (action, label, style = ButtonStyle.Success, disabled = false) => button(`${DREST_ID}:${member.id}:${d.room}:${action}`, label, style).setDisabled(disabled);
      const items = VISIT_ITEMS[spec.deal]?.(d);
      const opt = (n) => ({ label: n, value: n, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}${spec.deal === 'capsule' && n === d.legendary ? ', Legendary' : ''}${visitChance(spec.deal, n)}`.slice(0, 100) });
      if (spec.deal === 'replica' && d.replicaPick) {
        const give = [...new Set(SLOTS.flatMap((s) => d.items[s]))].filter((n) => n !== d.replicaPick);
        components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:replace`).setPlaceholder(`Give up an Item for the ${d.replicaPick} replica`.slice(0, 150)).addOptions(giveUp(d, give, opt))));
      } else if (spec.deal === 'upgrade' && d.upgradePick) {
        components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:into`).setPlaceholder(`Upgrade your ${d.upgradePick} into...`.slice(0, 150)).addOptions(D.upgradesOf(d, d.upgradePick).slice(0, 25).map(itemOpt))));
      } else if (spec.deal === 'upgrade' && !d.upgradePick) { // McGinnis (his ask, Nov 7): one dropdown of Items, then Enhance It / Upgrade Item / Repair the Item
        const note = (n) => (D.fragileOf(d).includes(n) ? ', Fragile' : (d.enhanced ?? []).includes(n) ? ', Enhanced' : '');
        const options = D.workables(d).slice(0, 25).map((n) => ({ label: n, value: n, default: n === d.tinkerPick, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}${note(n)}` }));
        if (options.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:item`).setPlaceholder('Select an Item to Tinker with').addOptions(options)));
      } else if (spec.deal === 'stoke') { // Infernus: one dropdown of Items (until the first Stoke), then Stoke / Take It Back
        const options = D.stokeables(d).slice(0, 25).map((n) => ({ ...opt(n), default: n === d.stoke?.name }));
        if (options.length && !d.stoke?.n) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:item`).setPlaceholder('Select an Item to Stoke').addOptions(options)));
      } else if (spec.deal === 'lesson') { // Dynamo: one dropdown of the kinds of enemy on the next Floor
        if (!d.lesson) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:lesson`).setPlaceholder('Pick an Enemy to Study')
          .addOptions(D.lessonKinds(spec.room).slice(0, 25).map((k) => ({ label: D.kindName(k), value: k, description: D.ARCHETYPES[k].text.slice(0, 100) })))));
      } else if (spec.deal === 'travel') { // Mirage: one dropdown of the room types, the pick is the choice
        const kinds = D.travelKinds(d, spec.room);
        if (kinds.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:travel`).setPlaceholder('Pick the Next Room').addOptions(kinds.map((k) => ({ label: TRAVEL_ROOMS[k][0], value: k, description: TRAVEL_ROOMS[k][1] })))));
      } else if (spec.deal === 'fuse') { // Victor (his ask, Nov 7): the first Item, then the second, then Stitch Them Together
        const { a, b } = d.fusePick ?? {};
        const loose = D.fuseables(d);
        if (loose.length >= 2) {
          const pickOpt = (chosen) => (n) => ({ ...itemOpt(n), default: n === chosen });
          components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:fuseA`).setPlaceholder('Select the first Item').addOptions(loose.slice(0, 25).map(pickOpt(a)))));
          if (a) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:fuseB`).setPlaceholder('Select the second Item').addOptions(loose.filter((n) => n !== a).slice(0, 25).map(pickOpt(b)))));
        }
      } else if (items?.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:${spec.deal}`).setPlaceholder(VISIT_PROMPT[spec.deal]).addOptions(items.slice(0, 25).map(opt))));
      const tinker = spec.deal === 'upgrade' && d.tinkerPick && !d.upgradePick ? (D.fragileOf(d).includes(d.tinkerPick) ? [act('repair', 'Repair the Item')]
        : [act('enhance', 'Enhance It', ButtonStyle.Success, !D.tinkerables(d).includes(d.tinkerPick)), act('upgrade', 'Upgrade Item', ButtonStyle.Success, !D.upgradeables(d).includes(d.tinkerPick))]) : []; // (the picked Item decides)
      const accept = tinker.length ? tinker : spec.deal === 'ghouls' ? [act('ghoul', `Summon a ${D.MINIONS.ghoul.name}`)] // one a click, up to the third (his call, Nov 7)
        : spec.deal === 'fuse' ? [act('fuse', 'Stitch Them Together', ButtonStyle.Success, !(d.fusePick?.a && d.fusePick?.b))]
          : spec.deal === 'stoke' ? [act('stoke', 'Stoke', ButtonStyle.Success, !d.stoke)]
          : spec.deal === 'harrow' ? [act('heal', 'Treat Me', ButtonStyle.Success, D.buffTotal(d) < D.HARROW.cost)]
          : spec.deal === 'burrow' ? [act('accept', 'Dig', ButtonStyle.Success, !!d.urn)]
          : ['assistant', 'plot', 'rescue', 'doorway', 'smash', 'venom', 'rats'].includes(spec.deal) ? [act('accept', 'Accept')] : [];
      const tail = [button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')];
      const summoned = spec.deal === 'ghouls' && d.minions?.some((m) => m.kind === 'ghoul'); // some summoned: Turn Down becomes Done
      const treated = spec.deal === 'harrow' && d.harrowN; // treated: Turn Down becomes Done
      const stoked = spec.deal === 'stoke' && d.stoke?.n; // an Item in his fire: Turn Down becomes Take It Back
      components.push(row(...accept, summoned || treated ? act('done', 'Done') : stoked ? act('done', 'Take It Back', ButtonStyle.Secondary) : act('leave', 'Turn Down', ButtonStyle.Danger), ...tail));
      return { embeds: [e], components, files: [soulsFile(), await rivalFace(spec.hero)] };
    }
    if (spec.kind === 'rift') { // the Rift (Nov 6): fight for it or walk past
      components.push(row(button(`${DFIGHT_ID}:${member.id}:${d.room}`, 'Fight for the Rift', ButtonStyle.Danger), button(`${DREST_ID}:${member.id}:${d.room}:leave`, 'Walk Past'), button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')));
      return { embeds: [e], components, files: [soulsFile(), picture(RIFT_PICTURE)] }; // the Rift's icon as the thumbnail
    }
    if (D.EVENT_KINDS.includes(spec.kind)) { // the second batch of event rooms (Nov 4)
      const act = (action, label, style = ButtonStyle.Success, disabled = false) => button(`${DREST_ID}:${member.id}:${d.room}:${action}`, label, style).setDisabled(disabled);
      const leave = act('leave', spec.kind === 'teleporter' ? 'Walk Past' : spec.kind === 'patron' ? 'Refuse' : 'Leave', ButtonStyle.Danger);
      if (spec.kind === 'dealer') {
        const items = D.dealerItems(d);
        const swaps = items.filter((n) => D.swapChoices(d, n).length);
        const opt = (n) => ({ label: n, value: n, description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}` });
        if (swaps.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:swap`).setPlaceholder('Swap an Item out for another Item').addOptions(giveUp(d, swaps, opt))));
        if (items.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DDEAL_ID}:${member.id}:${d.room}:sell`).setPlaceholder('Sell an Item in exchange for a Full Heal').addOptions(giveUp(d, items, opt))));
      }
      const main = spec.kind === 'urn' ? [act('urn', 'Pick Up the Urn', ButtonStyle.Success, !!d.urn)]
        : spec.kind === 'wounded' ? [act('recruit', `Recruit ${the(spec.rival)}`.slice(0, 80), ButtonStyle.Success, !!d.ally)]
          : spec.kind === 'patron' ? [] // its four blessings get a row of their own (below)
            : spec.kind === 'teleporter' ? [act('step', 'Step In', ButtonStyle.Primary, !!d.urn)] : [];
      if (spec.kind === 'patron') {
        const patron = patronNames(D.specOf(d, D.LAST_ROOM))[0];
        components.push(row(act('heal', 'Restore'), act('bless', `Weaken the ${patron}`.slice(0, 80)), act('empower', 'Empower'), act('ally', 'Send an Ally', ButtonStyle.Success, !!d.ally)));
      }
      components.push(row(...main, leave, button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')));
      const pic = spec.kind === 'wounded' ? await rivalFace(spec.rival, 'critical')
        : picture(spec.kind === 'urn' ? path.join(ASSETS, 'farm', 'icons', 'soul-urn.png') : spec.kind === 'dealer' ? path.join(ASSETS, 'shop', 'art', 'curiosity_shop.png')
          : spec.kind === 'patron' ? D.BOSSES[D.otherPatron(D.patronOf(d) ?? 'archmother')].icon : path.join(ASSETS, 'farm', 'icons', 'teleporter.png'));
      return { embeds: [e], components, files: [soulsFile(), pic] };
    }
    const fight = button(`${DFIGHT_ID}:${member.id}:${d.room}`, spec.kind === 'rival' ? `Fight ${spec.rival}` : spec.final ? `Fight the ${D.BOSSES[D.finalKeys(spec)[0]].name}` : spec.kind === 'boss' ? `Fight the ${D.bossName(spec, true)}` : 'Fight', ButtonStyle.Danger);
    components.push(row(fight, ...(spec.kind === 'rival' ? [button(`${DWALK_ID}:${member.id}:${d.room}`, 'Flee')] : []), button(`${DQUIT_ID}:${member.id}`, 'Abandon Run')),
      row(button(`${DBUILD_ID}:${member.id}`, 'Your Build'), button(`${DENEMY_ID}:${member.id}:${d.room}`, "Enemy's Build")), ...doorwayRow(member, d));
  }
  return { embeds: [e], components, files: [soulsFile(), await roomFile(spec)] };
}

// One line per kind of minion, its health added up (Nov 7: a bar each, 5 Rift Troopers ran past a field's 1,024 characters and the whole
// message past Discord's 6,000 with Ghouls, a turret and an ally).
const minionLines = (minions) => [...Map.groupBy(minions, (m) => m.name)].map(([name, group]) => {
  const up = group.filter((m) => m.hp > 0);
  const hp = up.reduce((s, m) => s + m.hp, 0), max = group.reduce((s, m) => s + m.max, 0);
  return `${group.length > 1 ? `${name}s, ${up.length} of ${group.length}` : name}: ${up.length ? barLine(hp, max) : 'Down'}`;
});

// ---- the live fight, one snapshot (frames: play.js simulate) ----
async function fightView(run, frame) {
  const { spec } = run;
  const e = dembed(undefined, spec.ascension ?? 0).setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png')
    .addFields(
      { name: run.hero, value: `${barLine(frame.hero.hp, frame.hero.max)}${frame.hero.respawning ? '  -  Respawning' : ''}\nRejuvs Remaining: ${rejuvIcon()}${frame.rejuvs}` },
      ...(frame.allies ?? []).map((a) => ({ name: `${a.name} (Ally)`, value: a.hp > 0 ? barLine(a.hp, a.max) : 'Down' })), // a recruited rival (Nov 4)
      ...(frame.minions?.length ? splitField('Minions', minionLines(frame.minions)) : []), // Rift Troopers, Ghouls, a Mini Turret (Nov 6)
      ...enemyFields(frame),
      ...require('./icons').loadoutFields(frame),
      { name: 'Battle Log', value: frame.log.length ? frame.log.map(([t, text]) => `${clock(t)}   ${text}`).join('\n') : 'Empty' },
    ).setFooter({ text: `Total Time Elapsed: ${clock(frame.t)}` }); // no "one death ends the run" while fighting (his ask, Oct 29)
  return { embeds: [e], components: [], files: [soulsFile(), await roomFile(spec, spec.kind === 'rival' ? rivalMood(frame) : null, false, frame.stage)], attachments: [] };
}

// The run's current build, shared by the Build and item-replacement screens.
async function runCard(d) {
  const hero = buildHero(d.hero, D.runKit(d));
  const abilities = Object.keys(HERO_DATA[d.hero].BoundAbilities).map(Number).map((slot) => ({ slot, name: abilityName(d.hero, slot), tier: d.tiers[slot] ?? 0, locked: slot > UNLOCKS(d.level) }));
  return heroCard({
    hero: d.hero, progress: { level: d.level, into: (d.room - 1) % D.ROOMS_PER_FLOOR, needed: D.ROOMS_PER_FLOOR, max: d.level >= MAX_LEVEL },
    maxItems: D.rules(d).maxItems, lockedNotes: (D.rules(d).lockedSlots ?? []).map((r) => `Unlocks: Room ${r + 1}`), // Ascension 8+: the locked slots and when they open
    pointsLeft: Math.max(0, D.pointsLeft(d)), abilities, stats: statsFor(hero.stats), items: d.items, fused: D.fusedOf(d), souls: 0, legendary: d.legendary ?? undefined, enhanced: d.enhanced ?? [], fragile: D.fragileOf(d), tempered: d.tempered ?? {}, replicas: d.replicas ?? [], corrupted: D.corruptedOf(d).map((c) => c.name), rebirth: d.rebirth ?? 0,
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
// What happened in an event room (descent.js passEvent keeps it on the run as `event`): one line for the pick screen.
const upgradeCost = (ev) => ` It cost you **${pct(ev.from)}** to **${pct(ev.to)}** Health.`;
function eventText(ev, hero = 'You') {
  if (ev.action === 'rest') return `You rested and healed **${Math.round(ev.healed * 100)}%**.`;
  // the hero rooms (Nov 6)
  if (ev.action === 'leave' && ev.kind === 'visit') return `You turned down **${the(ev.hero)}**.`;
  if (ev.action === 'leave' && ev.kind === 'rift') return 'You walked past the Rift and let them fight it out.';
  if (ev.action === 'burrow') return `**Mo & Krill** dug past **${plural(ev.rooms, 'room')}** to the boss. You gained **${plural(ev.rooms + 1, 'Level')}**.`;
  if (ev.action === 'harrow') return `**Nurse Harrow** treated you **${plural(ev.count, 'time')}**. Health **${pct(ev.from)}** to **${pct(ev.to)}**.`;
  if (ev.action === 'ghouls') return `**Graves** lent you **${plural(ev.count, 'Ghoul')}** until they fall or this Floor's boss is beaten. They cost you **${pct(ev.from)}** to **${pct(ev.to)}** Health.`;
  if (ev.action === 'accept') return { assistant: `**Sinclair's Spectral Assistant** follows you for the next **${plural(D.ASSISTANT.fights, 'fight')}**.`, plot: '**Paige** wrote you **Plot Armor**: the next time you would die with no Rejuv left, you live.', rescue: `**Ivy** promised to pluck you out of the next fight that would kill you, and take you back **${D.RESCUE.back}** rooms.`, venom: `**Vyper** poisoned your weapon for **${D.VENOM_ROOMS}** rooms.`, rats: '**The Rat King** sent you a Rat. More will follow while one stands.', smash: '**Billy** smashed the case.', doorway: "**The Doorman** placed a **Doorway** for you. At your next choice of doors, the door you do not pick stays open." }[ev.deal];
  if (ev.action === 'replica') return ev.success ? `**Violet** painted an exact replica of your **${ev.name}**!${ev.replaced ? ` You gave up your **${ev.replaced}** for it.` : ''}` : `**Violet** ruined your **${ev.name}**. It's gone.`;
  if (ev.action === 'enhance') return ev.success ? `**McGinnis** enhanced your **${ev.name}**!${upgradeCost(ev)}` : `**McGinnis** tried to enhance your **${ev.name}**, but it didn't take.${upgradeCost(ev)}`;
  if (ev.action === 'repair') return `**McGinnis** repaired your **${ev.name}**. It is no longer Fragile.${upgradeCost(ev)}`;
  if (ev.action === 'upgrade') return ev.success ? `**McGinnis** upgraded your **${ev.name}** into **${ev.into}**.${upgradeCost(ev)}` : `**McGinnis** botched it: your **${ev.name}** is now **Fragile**.${upgradeCost(ev)}`;
  if (ev.action === 'stoke') return ev.burned ? `"Ahh, hell. Sorry, buddy. Old habits." **Infernus** burned your **${ev.name}** to ash. It is destroyed.`
    : `"${ev.stokes >= D.STOKE.burn.length ? 'There. Nobody\'s takin\' that any hotter.' : 'Smart. Took me years to learn that one.'}" **Infernus** tempered your **${ev.name}**: **+${pct(TEMPERED * ev.stokes)}** to its stats.`;
  if (ev.action === 'fuse') return ev.success ? `**Victor** stitched your **${ev.a}** and your **${ev.b}** into one **Abomination**. Both keep working and use **1** slot.` : `**Victor** failed to stitch your **${ev.a}** and your **${ev.b}**. Both are **Fragile** now.`;
  if (ev.action === 'lesson') return `**Dynamo** graded **${hero === 'You' ? 'you' : hero}**: **${ev.grade}**.\nLesson on **${D.kindName(ev.kind)}**: for the whole of Floor ${ev.floor}, you take **${pct(ev.power)}** less damage from them and deal **${pct(ev.power)}** more damage to them.`;
  if (ev.action === 'helper') return `**Rem** tucked a **Lil Helper** in beside you and fed it your **${ev.name}**. It fights beside you until it falls.`;
  if (ev.action === 'travel') return ev.door ? `**Mirage** opened a door for you. **${TRAVEL_ROOMS[ev.kind][0]}** is one of your next doors.` : `**Mirage** teleported you ahead. The next room is **${TRAVEL_ROOMS[ev.kind][0]}**.`;
  if (ev.action === 'capsule') return `**Paradox** sealed your ${ev.legendary ? 'Legendary ' : ''}**${ev.name}** in a **Time Capsule**. It comes back before this Floor ends.`;
  if (ev.action === 'turret') return `**McGinnis** took your **${ev.name}** for parts. Her **Mini Turret** fights beside you until it falls or this Floor's boss is beaten.`;
  if (ev.action === 'castling') return `**Solomon** took your **${ev.name}**. Pick what takes its place.`;
  if (ev.action === 'leave') return { urn: 'You left the Soul Urn where it was.', wounded: 'You left the wounded rival to it.', dealer: 'You left the Curiosity Dealer without a deal.', patron: 'You refused the blessing.', teleporter: 'You walked past the Teleporter.' }[ev.kind] ?? 'You moved on.';
  if (ev.action === 'urn') return `You picked up the **Soul Urn**. Carry it **${plural(ev.rooms, 'room')}** to deliver it.`;
  if (ev.action === 'recruit') return `**${ev.hero}** joined you for the next **${plural(ev.fights, 'fight')}**.`;
  if (ev.action === 'sell') return `The Curiosity Dealer took your **${ev.name}** and patched you up to **full health**.`;
  if (ev.action === 'swap') return `The Curiosity Dealer took your **${ev.name}**. Pick what you get for it.`;
  if (ev.action === 'bless') return `**The ${D.BOSSES[ev.by].name}** blessed you against the Patron at the bottom.`;
  if (ev.action === 'heal') return `**The ${D.BOSSES[ev.by].name}** restored you to **full health**.`;
  if (ev.action === 'empower') return `**The ${D.BOSSES[ev.by].name}** empowered you: **+${Math.round(D.EMPOWER * 100)}%** health, weapon damage and spirit power for the rest of the run.`;
  if (ev.action === 'ally') return `**The ${D.BOSSES[ev.by].name}** sent **${ev.hero}** to fight beside you for the next **${plural(ev.fights, 'fight')}**.`;
  if (ev.action === 'tinker') return `${hero} tinkered with their **${ev.name}**${ev.enhanced ? ', and it was a success!' : ', but did not succeed.'}`;
  const f = ev.find;
  const found = f.kind === 'little' ? `a **${buffText(f.key, 1)}** buff, permanent for this run` : f.kind === 'heal' ? `a moment's peace: you healed **${Math.round(f.healed * 100)}%**` : `a ${withIcon(powerupIcon(f.key), `**${BRIDGE[f.key].name} Bridge Buff**`)} (${BRIDGE[f.key].text}), until this Floor's boss`;
  return `You broke open the crates and the Golden Statue and found ${found}.`;
}
// Violet's try, on a screen of its own before the pick (his ask, Nov 7): what happened, then Continue.
async function revealView(member, d) {
  const ev = d.event;
  const spec = D.specOf(d, ev.room);
  const lines = ev.action !== 'replica' ? [eventText(ev, d.hero)] // McGinnis' enhance / upgrade / repair
    : ev.success
      ? ['**Violet** painted an exact replica of your', `**${ev.name}**!`, ...(ev.replaced ? ['', `You gave up your **${ev.replaced}** for it.`] : [])]
      : ['**Violet** ruined your', `**${ev.name}**. It's gone.`];
  lines.push('', `${d.hero} reached **Level ${d.level}**.`);
  const e = dembed((ev.success ?? ev.mood !== 'critical') ? WIN : LOSS, d.ascension ?? 0).setTitle(roomTitle(spec)).setThumbnail('attachment://thumb.png').setDescription(lines.join('\n')).addFields(runFields(d))
    .setFooter({ text: `Floor ${spec.floor} of ${D.FLOORS}` });
  const components = [row(button(`${DREST_ID}:${member.id}:${ev.room}:continue`, 'Continue', ButtonStyle.Success), button(`${DBUILD_ID}:${member.id}`, 'Your Build'))];
  return { embeds: [e], components, files: [soulsFile(), await rivalFace(ev.hero, ev.mood)] };
}
async function offerView(member, d, { run = null, animate = false, replace = null } = {}) {
  const { offer } = d;
  if (d.event?.reveal && d.event.room === offer.room) return revealView(member, d);
  const spec = D.specOf(d, offer.room);
  const r = D.rules(d);
  const cleared = spec.kind === 'boss' ? `${D.bossName(spec, true)} Defeated` : spec.kind === 'rival' ? `${spec.rival} Defeated` : `Room ${spec.room} Cleared`;
  const e = dembed(run ? WIN : undefined, d.ascension ?? 0).setThumbnail('attachment://thumb.png'); // the title is always the ascension (his ask Nov 5)
  const lines = [];
  const addEvent = (text) => {
    if (lines.length) lines.push('');
    lines.push(text);
  };
  if (run) {
    const voice = voiceLine(d.hero, spec.kind === 'rival' ? spec.rival : null).trim();
    if (voice) addEvent(voice);
    const unlocked = UNLOCKS(d.level) > UNLOCKS(d.level - 1) ? ` and unlocked **${abilityName(d.hero, UNLOCKS(d.level))}**` : '';
    addEvent(`${d.hero} reached **Level ${d.level}**${unlocked}${spec.kind === 'boss' ? `, and earnt +${rejuvIcon()}1 Rejuv` : ''}.`);
  }
  if (d.event?.room === offer.room) addEvent(`${eventText(d.event, d.hero)}\n${d.hero} reached **Level ${d.level}**.`); // an event room (Nov 4): what happened there, then its pick
  if (d.returned?.room === offer.room) addEvent(d.returned.legendary
    ? `Your Legendary **${d.returned.item}** shattered the Time Capsule. Its Cooldown was rerolled: **${Math.abs(Math.round((1 - d.returned.mult) * 100))}% ${d.returned.mult <= 1 ? 'shorter' : 'longer'}**.`
    : `The Time Capsule opened: your **${d.returned.item}** is back after **${plural(d.returned.rooms, 'room')}**, with a Cooldown **${Math.round((1 - d.returned.mult) * 100)}% shorter**.`);
  if (offer.fed?.length) addEvent(`You fed the **Lil Helper** your offered **${offer.fed.join('**, **')}**.`);
  if (d.allyLeft?.room === offer.room) addEvent(`**${d.allyLeft.hero}** is strong enough to go on alone. As thanks, take any one Item from their build.`);
  if (d.delivered?.room === offer.room) addEvent(`You delivered the **Soul Urn**: **${d.delivered.buffs.map((k) => buffText(k, 1)).join('**, **')}**, permanent for this run.`);
  if (d.shattered?.room === offer.room) addEvent(`${d.shattered.why === 'health' ? `You fell below **${Math.round(D.FRAGILE_BREAK * 100)}%** health and` : `A ${rejuvIcon()}Rejuv went off and`} your Fragile ${d.shattered.names.length > 1 ? 'Items' : 'Item'} shattered.\n**${d.shattered.names.join('**, **')}** ${d.shattered.names.length > 1 ? 'are' : 'is'} gone.`);
  const upgrades = new Set(offer.kind === 'items' ? offer.choices.filter((n) => priceFor(itemByName(n), d.items).used.length) : []);
  const heal = `Heal **${Math.round(r.skipHeal * 100)}%**`;
  const skipText = offer.kind === 'buffs' ? `Skip: ${heal}.` : offer.kind === 'legendaries' ? `Skip: Gain **${D.LEGEND_SKIP_BUFFS} Perma-Buffs**.` : `Skip: ${heal} and **${r.skipBuffs} Perma-Buffs**.`;
  if (replace != null) {
    const name = offer.choices[replace];
    addEvent(`Your build is full (**${r.maxItems}** items). Choose an Item to give up for **${name}**: it is lost, there are no souls in a run.`);
  } else if (offer.kind === 'buffs') addEvent(`Pick a Permanent Buff as a reward. ${skipText}`);
  else if (offer.kind === 'legendaries') addEvent(`Pick a legendary for the legendary slot${d.legendary ? ` (it replaces ${d.legendary})` : ''}, or ${skipText}`);
  else if (offer.rival) addEvent(`${d.hero} defeated ${the(offer.rival)}.\n\nRetrieve **1** Item from ${the(offer.rival)},${offer.recruit ? ` Recruit ${the(offer.rival)},\nor` : ' or'} Skip and Heal ${Math.round(r.skipHeal * 100)}% HP and ${r.skipBuffs} Perma-Buffs${D.slotsUsed(d) >= r.maxItems ? "\n\nYour build is full: an upgrade takes its part's place, anything else replaces an Item." : ''}`);
  else if (d.smash) addEvent(`**Smash and Grab:** Take All **${offer.choices.length}** Items, each Fragile. Or ${skipText}${D.smashNeed(d) ? ` You must give up **${D.smashNeed(d)}** of your Items to make room.` : ''}`);
  else addEvent(`Pick **1 of ${offer.choices.length}** items, or ${skipText}${D.slotsUsed(d) >= r.maxItems ? ' Your build is full: an upgrade takes its part\'s place, anything else replaces an Item.' : ''}`);
  e.setDescription(lines.join('\n'));
  // what each choice does: buffs all at once; an item only once it is picked in View Item (his ask, Oct 28: three in full was too much to read)
  const about = offer.kind === 'buffs' ? offer.choices.map((n, i) => choiceAbout(d, i)) : [VIEW_PROMPT];
  // buffs are short, so they share one field, a line each (a field per buff left a blank row between them)
  const fields = offer.kind === 'buffs' ? [{ name: 'Buff Choices', value: about.join('\n') }] : about.map((value, i) => ({ name: i ? '​' : 'Item Choices', value }));
  e.addFields(...fields, ...runFields(d));
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
    const all = [...new Set(SLOTS.flatMap((s) => d.items[s]))]; // once each (dropdown values must differ); giveUp adds Violet's copy apart
    components.push(row(new StringSelectMenuBuilder().setCustomId(`${DSWAP_ID}:${member.id}:${offer.room}:${replace}`).setPlaceholder(titleCase(`Give up an Item for ${offer.choices[replace]}`).slice(0, 150))
      .addOptions(giveUp(d, all, itemOpt))));
    components.push(row(button(`${DBACK_ID}:${member.id}`, 'Back')));
  } else {
    const points = pointMenu(member.id, d);
    if (points) components.push(points);
    const short = (n) => (offer.kind === 'buffs' ? buffText(n, r.bossBuffs) : n);
    // a rival's whole build is too many for buttons: a dropdown (his ask, Oct 29)
    const need = D.smashOpen(d) ? D.smashNeed(d) : 0;
    if (need) components.push(row(new StringSelectMenuBuilder().setCustomId(`${DSMASH_ID}:${member.id}:${offer.room}`).setPlaceholder(titleCase(`Give up ${need} ${need === 1 ? 'Item' : 'Items'} to Take All`)).setMinValues(need).setMaxValues(need)
      .addOptions(giveUp(d, [...new Set(SLOTS.flatMap((s) => d.items[s]))], itemOpt))));
    const picks = D.smashOpen(d) ? (need ? [] : [button(`${DSMASH_ID}:${member.id}:${offer.room}`, 'Take All', ButtonStyle.Success)]) : offer.rival ? [new StringSelectMenuBuilder().setCustomId(`${DTAKE_ID}:${member.id}:${offer.room}`).setPlaceholder(`Take an Item from ${the(offer.rival)}`)
      .addOptions(offer.choices.map((n, i) => ({ label: n, value: String(i), description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}${SLOTS.some((s) => d.items[s].includes(n)) ? ', enhances yours' : ''}${upgrades.has(n) ? `, upgrades ${priceFor(itemByName(n), d.items).used.join(' + ')}` : ''}`.slice(0, 100) })))]
      : offer.choices.map((n, i) => button(`${DTAKE_ID}:${member.id}:${offer.room}:${i}`, short(n), ButtonStyle.Primary));
    if (offer.kind !== 'buffs') components.push(row(new StringSelectMenuBuilder().setCustomId(`${DVIEW_ID}:${member.id}:${offer.room}`).setPlaceholder('View Item')
      .addOptions(offer.choices.map((n, i) => ({ label: `${offer.enhanced?.includes(n) ? '[Enhanced] ' : ''}${n}`, value: String(i) })))));
    const actions = [button(`${DSKIP_ID}:${member.id}:${offer.room}`, offer.kind === 'buffs' ? `Skip ; Heal ${Math.round(r.skipHeal * 100)}%` : offer.kind === 'legendaries' ? `Skip ; Gain ${D.LEGEND_SKIP_BUFFS} Perma-Buffs` : `Skip ; Heal ${Math.round(r.skipHeal * 100)}% and gain ${r.skipBuffs} Buffs`, ButtonStyle.Danger), button(`${DBUILD_ID}:${member.id}`, 'Your Build')];
    if (offer.recruit) actions.push(button(`${DRECRUIT_ID}:${member.id}:${offer.room}`, `Recruit ${the(offer.recruit.hero)}`.slice(0, 80), ButtonStyle.Success).setDisabled(!!d.ally));
    if (offer.kind === 'items' && !offer.rival) actions.push(button(`${DREROLL_ID}:${member.id}:${offer.room}`, `Reroll (${d.rerolls ?? r.rerolls} Left)`, ButtonStyle.Success).setDisabled((d.rerolls ?? r.rerolls) <= 0));
    if (D.helperOf(d) && offer.kind === 'items' && !offer.rival && offer.choices.length > 0) { // Rem's Lil Helper (his ask, Nov 7): the Items you are not taking can go to it
      components.push(row(new StringSelectMenuBuilder().setCustomId(`${DFEED_ID}:${member.id}:${offer.room}`).setPlaceholder('Feed the Lil Helper an Item')
        .addOptions(offer.choices.map((n, i) => ({ label: n, value: String(i), description: `${KIND_NAME[itemByName(n).Slot]}, Tier ${itemByName(n).Tier}: ${feedGain(n)}`.slice(0, 100) })))));
    }
    components.push(row(...picks), row(...actions));
  }
  return { embeds: [e], components, files: [soulsFile(), await runFace(d), file] }; // always the hero's own face: a visiting hero's (Violet's, McGinnis') stays on their own screens (his ask, Nov 7)
}

// ---- the run's build: the hero card (heroCard.js) with the run's level, abilities, items and stats ----
async function buildView(member, d) {
  const card = await runCard(d);
  const e = dembed(undefined, d.ascension ?? 0).setTitle(`${d.hero}  -  Level ${d.level}  -  This Run`).setImage('attachment://hero.jpg').setThumbnail('attachment://thumb.png');
  const buffs = Object.entries(d.buffs);
  if (buffs.length) e.addFields({ name: 'Permanent Buffs (This Run)', value: buffs.map(([k, n]) => buffText(k, n)).join('\n'), inline: true });
  if (d.bridge?.length) e.addFields({ name: 'Big Buffs (This Floor)', value: d.bridge.map((k) => withIcon(powerupIcon(k), `${BRIDGE[k].name} — ${BRIDGE[k].text}`)).join('\n'), inline: true });
  if (d.enhanced?.length) e.addFields({ name: 'Enhanced Items', value: d.enhanced.join('\n'), inline: true });
  if (D.fragileOf(d).length) e.addFields({ name: 'Fragile Items', value: D.fragileOf(d).join('\n'), inline: true });
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
    .setDescription(`Choose which unlocked ability receives **${name}**. This Item must be imbued before you can continue.`)
    .setFooter({ text: `Floor ${D.floorOf(d.room)} of ${D.FLOORS}` });
  return {
    embeds: [e],
    components: [row(new StringSelectMenuBuilder().setCustomId(`${DIMBUE_ID}:${member.id}`).setPlaceholder(`Imbue ${name} into`)
      .addOptions(slots.map((slot) => ({ label: abilityName(d.hero, slot), value: String(slot), description: slot === 4 ? 'Ultimate' : `Ability ${slot}` }))))],
    files: [soulsFile(), await runFace(d)],
  };
}

async function bonusView(member, d) {
  const pending = d.pendingBonus;
  const all = [...new Set(SLOTS.flatMap((s) => d.items[s]))].filter((n) => n !== pending.upgraded); // everything but the item just upgraded into
  const e = dembed(undefined, d.ascension ?? 0).setTitle('Upgrade Taken').setThumbnail('attachment://thumb.png')
    .setDescription(`**${pending.upgraded}** replaced **${pending.used.join(' + ')}**.\n\n**BONUS: ${pending.name}**\nChoose an Item to give up for the bonus.`)
    .setImage('attachment://hero.jpg');
  return {
    embeds: [e],
    components: [row(new StringSelectMenuBuilder().setCustomId(`${DBONUSSWAP_ID}:${member.id}`).setPlaceholder(`Give up an Item for ${pending.name}`)
      .addOptions(giveUp(d, all, itemOpt)))],
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
  ).setImage('attachment://hero.jpg'); // no footer (his call, Nov 6)
  return { embeds: [e], components: [row(button(`${DAGAIN_ID}:${member.id}`, 'Descend Again', ButtonStyle.Success))], files: [soulsFile(), await roomFile(spec, spec.kind === 'rival' ? 'gloat' : null, false, run.cleared), new AttachmentBuilder(await runCard(d), { name: 'hero.jpg' })], attachments: [] };
}

// ---- the descent cleared: the Patron and the Weakened Patron beaten in the last room (his call, Oct 24: nothing more than this and the leaderboard) ----
async function completeView(member, run) {
  const d = run.complete;
  const e = dembed(WIN, d.ascension ?? 0).setTitle('Descent Cleared').setThumbnail('attachment://thumb.png')
    .setDescription(`${d.hero} defeated the ${patronNames(D.specOf(d, D.LAST_ROOM))[0]} in **${clock(run.seconds)}**${d.ascension ? ` on Ascension ${d.ascension}` : ''}!${d.unlocked ? `\n\nAscension ${d.unlocked} unlocked for all your Hero's:\n${D.ASCENSIONS[d.unlocked].text}` : ''}${voiceLine(d.hero, null, undefined, true)}`)
    .addFields(
      ...(d.reborn?.to ? [{ name: 'Reborn', value: `${d.hero} is reborn as **${rankText(member.guild, d.reborn.to)}**: +${Math.round(BONUS * d.reborn.to * 100)}% Health, Weapon Damage and Spirit Power, for good, in the farm and in Descend.` }]
        : d.reborn?.locked ? [{ name: 'Rebirth', value: `To unlock Rebirth's, you must clear a Siege with ${d.hero}.\nUse /farm to start your journey! All Ascension's that you've won with a Hero will count towards your Rebirth!` }] : []),
      ...(d.token ? [{ name: 'Character Unlock Token', value: `Clearing Ascension ${d.ascension} for the first time earnt you a Character Unlock Token!\nUse it on the Switch Hero screen of \`/base\` to unlock a hero of your choice!` }] : []), // his call, Oct 28
      { name: 'Level', value: `${d.level}`, inline: true },
      { name: 'Fight Time', value: clock(run.seconds), inline: true },
      { name: 'Descents Cleared', value: `${d.clears}`, inline: true },
    ).setImage('attachment://hero.jpg');
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
// /descend stats (his ask, Nov 4; private): the member's records (kept all along) and the run counters (counted from Nov 4, `descentStats`).
function statsView(member, record, rows) {
  const s = record.descentStats ?? {};
  const place = rows.findIndex((r) => r.id === member.id);
  const best = record.bestDescent;
  const records = [
    `**Highest Ascension Unlocked:** ${D.ascensionOf(record)}`,
    `**Highest Ascension Cleared:** ${record.descentCleared >= 0 ? record.descentCleared : 'None yet'}`,
    `**Descents Cleared:** ${record.descentClears ?? 0}`,
    `**Best Run:** ${best?.rooms ? `${best.hero}, ${best.rooms >= D.LAST_ROOM ? 'Cleared' : plural(best.rooms, 'room')}${best.ascension ? ` on Ascension ${best.ascension}` : ''}` : 'None yet'}`,
    `**Leaderboard:** ${place >= 0 ? `#${place + 1} of ${rows.length}` : 'Not on it yet'}`,
  ];
  const killers = Object.entries(s.killedBy ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const counters = [
    `**Runs Started:** ${s.runs ?? 0}`, `**Deaths:** ${s.deaths ?? 0}`, `**Abandoned:** ${s.abandoned ?? 0}`,
    `**Rooms Cleared:** ${s.rooms ?? 0}`, `**Bosses Beaten:** ${s.bosses ?? 0}`, `**Rivals Beaten:** ${s.rivals ?? 0}`, `**Event Rooms:** ${s.events ?? 0}`,
    `**Deadliest:** ${killers.length ? killers.map(([what, n]) => `${what} (${n})`).join(', ') : 'Nothing yet'}`,
  ];
  const heroes = Object.entries(record.descentBest ?? {}).filter(([, rooms]) => rooms > 0).sort((a, b) => b[1] - a[1])
    .map(([hero, rooms]) => { const rank = rankOf(record.heroes?.[hero]?.rebirth); return `${heroText(member.guild, hero)}${hero}  -  ${rooms >= D.LAST_ROOM ? 'Cleared' : plural(rooms, 'room')}${rank ? `  -  ${rankText(member.guild, rank)}` : ''}`; });
  const e = dembed().setTitle('Your Descend Stats').addFields(
    { name: 'Records', value: records.join('\n') },
    { name: 'Runs', value: counters.join('\n') },
    ...splitField('Best Room by Hero', heroes.length ? heroes : ['No runs yet.']),
  ).setFooter({ text: 'Run counters started on Nov 4, 2026.' });
  if (record.descent) e.setDescription(`In a run now: **${record.descent.hero}**, Room ${record.descent.room}${record.descent.ascension ? `, Ascension ${record.descent.ascension}` : ''}.`);
  return { embeds: [e], files: [soulsFile()] };
}
function leaderboardView(member, rows, record) {
  const mineAt = rows.findIndex((r) => r.id === member.id);
  const e = dembed().setTitle('Descend Leaderboard').setDescription(rows.length
    ? rows.slice(0, 10).map((r, i) => `**${i + 1}.** <@${r.id}>  -  ${r.ascension ? `**Ascension ${r.ascension}**, ` : ''}${r.rooms >= D.LAST_ROOM ? `**Cleared**${r.clears > 1 ? ` x${r.clears}` : ''}` : `${plural(r.rooms, 'room')} (Floor ${D.floorOf(r.rooms + 1)})`}  -  ${r.hero}${r.rebirth ? `  -  ${rankText(member.guild, r.rebirth)}` : ''}`).join('\n')
    : 'Nobody has made a run yet. Start one with `/descend run`.');
  e.addFields({ name: 'Your Best', value: record.bestDescent?.rooms ? `${bestText(record.bestDescent)}${mineAt >= 0 ? `  -  #${mineAt + 1}` : ''}` : 'None yet', inline: true });
  const heroes = Object.entries(record.descentBest ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (heroes.length) e.addFields({ name: 'Your Heroes', value: heroes.map(([h, n]) => `${h}  -  ${plural(n, 'room')}`).join('\n'), inline: true });
  e.setFooter({ text: `Score: the highest Ascension, then rooms cleared in one run (${D.LAST_ROOM} at most).` });
  return { embeds: [e], components: [], files: [soulsFile()] };
}

// A Buff found in the room just left: a window of its own between the pick and the next room (his ask, Nov 10). Not a room, no fight, just Continue.
function findView(member, d, { note = null } = {}) {
  const f = d.finding;
  const little = f.kind === 'little';
  const lines = [...(note ? [note, ''] : []), 'Found a Buff.',
    ...(little ? [`**${buffText(f.key)}**`, 'Permanent for this run.']
      : [`**${BRIDGE[f.key].name} Bridge Buff**`, BRIDGE[f.key].text, `Lasts through Floor **${D.floorOf(f.room)}**.`])];
  const icon = little ? path.join(ASSETS, 'farm', 'buffs', `${f.key}.png`) : path.join(ASSETS, 'emojis', `powerup_${f.key}.png`);
  const e = dembed(undefined, d.ascension ?? 0).setTitle('Buff Found').setThumbnail('attachment://thumb.png').setDescription(lines.join('\n')).addFields(runFields(d))
    .setFooter({ text: `Floor ${D.floorOf(f.room)} of ${D.FLOORS}` });
  const components = [row(button(`${DREST_ID}:${member.id}:${f.room}:found`, 'Continue', ButtonStyle.Success), button(`${DBUILD_ID}:${member.id}`, 'Your Build'))];
  return { embeds: [e], components, files: [soulsFile(), picture(icon)] };
}

// The run's current screen: the start screen (no run), the pick (still), the Buff window, or the next room.
const screen = async (member, record, opts = {}) => (!record.descent ? startView(member, record)
  : record.descent.phase === 'offer' ? offerView(member, record.descent, opts)
    : record.descent.phase === 'imbue' ? imbueView(member, record.descent)
      : record.descent.phase === 'bonus' ? bonusView(member, record.descent)
        : record.descent.finding ? findView(member, record.descent, opts) : roomView(member, record.descent, opts));

module.exports = {
  DDOOR_ID, DHERO_ID, DASC_ID, DBEGIN_ID, DFIGHT_ID, DWALK_ID, DBVIEW_ID, DCORRUPT_ID, DFRAGILE_ID, DENEMY_ID, DTAKE_ID, DSKIP_ID, DRECRUIT_ID, DREROLL_ID, DSWAP_ID, DSMASH_ID, DPOINT_ID, DBUILD_ID, DBACK_ID, DQUIT_ID, DAGAIN_ID, DIMBUE_ID, DBONUSSWAP_ID, DVIEW_ID, DFEED_ID, DREST_ID, DTINKER_ID, DTVIEW_ID, DDEAL_ID,
  statsView, eventText, choiceAbout, brokerAbout, startView, roomView, fightView, runCard, offerView, buildView, imbueView, bonusView, overView, completeView, tokenView, leaderboardView, screen, buffLine: (key, n = D.BOSS_BUFFS) => buffText(key, n),
};
