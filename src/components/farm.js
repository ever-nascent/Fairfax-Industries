// Hero Farming's and Descend's buttons and dropdowns. Button / dropdown / pop-up routes: each route has `matches` (is this click mine? usually by the customId prefix) and `execute`. components/index.js lists every route file.
// Each route mostly calls utils/farm/play.js (the rules) and a view in utils/farm/views.js or descentViews.js (the screens).
const { setTimeout: sleep } = require('node:timers/promises');
const { MessageFlags } = require('discord.js');
const { getFarmUser, chooseHero, play, upgradeAbility, buyItem, sellItem, equipLegendary, unlockHero, switchHero, corruptItem, setImbue, hatchEgg, fightRival, walkAway, holdOffer, rivalKitOf, targetEnemies } = require('../utils/farm/play');
const { npcBuildView, rivalBuildView, heroBuildView } = require('../utils/farm/enemyBuild');
const { TARGETS, LANES } = require('../utils/farm/targets');
const { drawbackLine } = require('../utils/farm/corruption');
const { buffText } = require('../utils/farm/buffs');
const { bonusLines } = require('../utils/farm/corruption');
const { fmt } = require('../utils/format');
const { shortId } = require('../utils/random');
const { DAMAGE_ID, DAMAGETAB_ID, damageButton, damageTabs, damageView, enemyDamageView, healingView, DUEL_ID, WALK_ID, withRival, duelView, duelResultView, HERO_ID, PICK_ID, TARGET_ID, SEND_ID, ENEMY_ID, BACK_ID, HEROCARD_ID, UPGRADE_ID, ITEM_ID, BUY_ID, SHOPMODE_ID, SELL_ID, SWITCH_ID, SWITCHTO_ID, UNLOCK_ID, IMBUE_ID, IMBUESET_ID, SHOPTAB_ID, CORRUPT_ID, HATCH_ID, LEGEND_ID, ROOM_ID, titleCase, timeLeft, pickView, homeView, heroView, shopView, targetView, fightView, resultView, legendaryView, tokenView, notReady } = require('../utils/farm/views');

const descent = require('../utils/farm/descent');
const dviews = require('../utils/farm/descentViews');

// the live fight message is edited this often (Discord allows about 5 edits per 5 s per channel); tests set FARM_FRAME_MS=0
const FRAME_MS = Number(process.env.FARM_FRAME_MS ?? 3000);

// The farm's dropdowns and buttons redraw the member's own message. Only the member who opened it can use them; anyone else is told,
// privately, what that button does and where to get their own (his ask, Oct 26: a line for each button, not one for the whole farm).
const BASE = 'Open your own farm with `/base`.';
const RUN = 'Start your own descent with `/descend run`.';
const NOT_YOURS = {
  [HERO_ID]: `pick a hero on this screen. ${BASE}`, [PICK_ID]: `pick a hero on this screen. ${BASE}`,
  [TARGET_ID]: `choose where their hero goes. ${BASE}`, [SEND_ID]: `send this fight. ${BASE}`, [BACK_ID]: `go back on this screen. ${BASE}`,
  [UPGRADE_ID]: `spend this hero's ability points. ${BASE}`, [ITEM_ID]: `shop for this hero. ${BASE}`, [BUY_ID]: `buy items for this hero. ${BASE}`,
  [ROOM_ID]: `sell this hero's items. ${BASE}`, [SELL_ID]: `sell this hero's items. ${BASE}`, [SHOPMODE_ID]: `open this hero's Item Shop. ${BASE}`,
  [SHOPTAB_ID]: `browse this hero's Item Shop. ${BASE}`, [LEGEND_ID]: `change this hero's legendary. ${BASE}`,
  [IMBUE_ID]: `change what this hero's items are imbued into. ${BASE}`, [IMBUESET_ID]: `change what this hero's items are imbued into. ${BASE}`,
  [CORRUPT_ID]: `deal with the Broker for this hero. ${BASE}`, [HATCH_ID]: `hatch this hero's egg. ${BASE}`,
  [SWITCH_ID]: `switch their hero. ${BASE}`, [SWITCHTO_ID]: `switch their hero. ${BASE}`, [UNLOCK_ID]: `spend their Character Unlock Token. ${BASE}`,
  [DUEL_ID]: 'fight this rival: it is waiting for them. Rivals find you after won fights from `/base`.', [WALK_ID]: 'let this rival go: it is waiting for them.',
  [dviews.DHERO_ID]: `pick the hero for this descent. ${RUN}`, [dviews.DASC_ID]: `pick the Ascension for this descent. ${RUN}`, [dviews.DBEGIN_ID]: `start this descent. ${RUN}`,
  [dviews.DFIGHT_ID]: `fight this room. ${RUN}`, [dviews.DWALK_ID]: `flee from this rival or leave this stall. ${RUN}`, [dviews.DBVIEW_ID]: `look at this stall's items. ${RUN}`, [dviews.DCORRUPT_ID]: `deal with the Broker in this run. ${RUN}`, [dviews.DFRAGILE_ID]: `deal with the Broker in this run. ${RUN}`, [dviews.DTAKE_ID]: `pick this run's reward. ${RUN}`,
  [dviews.DFEED_ID]: `feed this run's Lil Helper. ${RUN}`,
  [dviews.DSWAP_ID]: `choose what this run gives up. ${RUN}`, [dviews.DSKIP_ID]: `skip this run's reward. ${RUN}`, [dviews.DRECRUIT_ID]: `recruit the rival they beat. ${RUN}`, [dviews.DREROLL_ID]: `reroll this run's items. ${RUN}`,
  [dviews.DPOINT_ID]: `spend this run's ability points. ${RUN}`, [dviews.DBACK_ID]: `go back on this screen. ${RUN}`, [dviews.DQUIT_ID]: `abandon this run. ${RUN}`,
  [dviews.DAGAIN_ID]: `start another descent from here. ${RUN}`, [dviews.DIMBUE_ID]: `choose where this run's item is imbued. ${RUN}`,
  [dviews.DBONUSSWAP_ID]: `choose this run's bonus item. ${RUN}`,
  [dviews.DREST_ID]: `choose in this run's room. ${RUN}`, [dviews.DDEAL_ID]: `deal in this run's room. ${RUN}`, [dviews.DTINKER_ID]: `tinker with this run's items. ${RUN}`, [dviews.DTVIEW_ID]: `look at this rest stop's items. ${RUN}`,
};
const ownerOf = (interaction) => interaction.customId.split(':')[1];
async function mine(interaction) {
  const [prefix, ownerId] = interaction.customId.split(':');
  if (interaction.user.id === ownerId) return true;
  await interaction.reply({ content: `Only <@${ownerId}> can ${NOT_YOURS[prefix] ?? `use this. ${BASE}`}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  return false;
}
// A build screen pressed by someone else: the owner's, privately and read-only (his ask, Oct 26: anyone may look at builds, only the owner acts).
async function peek(interaction, view) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const shown = await view();
  return interaction.editReply(typeof shown === 'string' ? { content: shown } : { ...shown, components: [], allowedMentions: { parse: [] } });
}

// The rival a Fight / Walk Away button belongs to (farm_duel:<user id>:<rival>); buttons from before Oct 11 have none.
const rivalOf = (interaction) => interaction.customId.split(':')[2];

// The fights a Damage Breakdown button can still show (in memory: a restart forgets them). ponytail: the oldest go past MAX_BREAKDOWNS.
// fight id -> { hero, rival?, seconds, damage, taken, healing, kit (the hero's build as the fight started), foes (the enemies as they started) | theirs (a rival's kit), title }
const breakdowns = new Map();
const MAX_BREAKDOWNS = 500;
const fightTitle = (run) => (run.spec ? `Room ${run.spec.room}` : run.siege ? 'Base Siege' : run.waves ? 'Waves' : TARGETS[run.key]?.name ?? run.key ?? 'The Fight');
function withBreakdown(view, run, ownerId) {
  const id = shortId();
  const rival = run.encounter ? run.rival : run.spec?.kind === 'rival' ? run.spec.rival : null;
  breakdowns.set(id, { hero: run.hero, rival, seconds: run.seconds, damage: run.damage ?? [], taken: run.taken ?? [], healing: run.healing, kit: run.kit, foes: run.foes ?? [], theirs: run.theirs, theirHealth: run.theirHealth ?? 1, title: fightTitle(run) });
  if (breakdowns.size > MAX_BREAKDOWNS) breakdowns.delete(breakdowns.keys().next().value);
  const damage = damageButton(ownerId, id);
  const buildRow = view.components.find((r) => r.toJSON().components.some((c) => c.label === 'Your Build'));
  if (buildRow) buildRow.addComponents(damage.components[0]);
  else view.components.push(damage);
  return view;
}
// The result's buttons once its rival is fought or let go: the Damage Breakdown stays.
const withoutRival = (interaction) => (interaction.message?.components ?? []).filter((r) => !r.components.some((c) => c.customId?.startsWith(`${DUEL_ID}:`) || c.customId?.startsWith(`${ENEMY_ID}:${interaction.user.id}:rival:`)));

// Replays the fight the member just paid for (already settled when they pressed Send), then sends the result as a new message
// (his call, Oct 16): the fight message stays on its last moment.
async function replay(interaction, run) {
  for (const frame of run.frames) {
    await interaction.editReply(fightView(run, frame));
    await sleep(FRAME_MS);
  }
  if (run.rival) run.rival = holdOffer(interaction.user.id, run.rival); // its 5 minutes start now; it is dropped if it was unlocked meanwhile
  const result = resultView(run);
  await interaction.followUp(withBreakdown(run.rival ? await withRival(result, run.rival, interaction.user.id) : result, run, interaction.user.id)); // its own embed with Fight / Walk Away (his call, Oct 10)
  if (run.legendary) await interaction.followUp({ ...legendaryView(run.legendary.name, run.legendary.equipped), flags: MessageFlags.Ephemeral }); // its own message (his call, Oct 2)
  if (run.token) await interaction.followUp({ ...tokenView(run.hero), flags: MessageFlags.Ephemeral });
}

async function send(interaction) {
  const [, , key, variant] = interaction.customId.split(':'); // a camp's Send carries the Haunt family its screen showed, a Guardian's or Walker's its lane
  await interaction.deferUpdate();
  const result = await play(interaction.user.id, key, { family: variant, lane: variant });
  if (result.error === 'no-hero') return interaction.editReply({ ...(await pickView(interaction.member)), attachments: [] });
  if (result.error) { // on cooldown, or locked (a Walker behind its Guardian, the siege behind the Walkers): the screen says which
    const record = await getFarmUser(interaction.user.id);
    await interaction.editReply({ ...(await targetView(interaction.member, key, record, Date.now(), variant)), attachments: [] });
    const problem = result.error === 'cooldown' ? notReady('That', result.left) : result.by === 'guardian' ? "That lane's Guardian must fall first." : result.by === 'walkers' ? 'All three Walkers must be down first.' : null;
    return problem ? interaction.followUp({ content: problem, flags: MessageFlags.Ephemeral }) : null;
  }
  return replay(interaction, result.run);
}

async function redraw(interaction, view) {
  if (!(await mine(interaction))) return;
  await interaction.deferUpdate();
  await interaction.editReply({ ...(await view()), attachments: [] });
}

// The hero pick: the first pick for a member with no hero, the switch / unlock screen for one who has a hero.
const pickScreen = async (interaction, selected, mode) => pickView(interaction.member, selected, await getFarmUser(interaction.user.id), mode);

// both show the current hero's own souls (his call, Oct 11)
const heroScreen = async (interaction, mode = 'main') => heroView(interaction.member, await getFarmUser(interaction.user.id), mode);
const shopScreen = async (interaction, tab = 'weapon', tier = 1, picked = null, room = false) => shopView(interaction.member, await getFarmUser(interaction.user.id), tab, Date.now(), tier, picked, room);
// 'hero:<mode>', 'shop:<tab>[:<tier>]' or 'shop:<tab>:<tier>:room:<item>' (a full build: which item to sell for it) -> that screen
const screen = (interaction, where) => {
  const [kind, ...rest] = where.split(':');
  if (kind !== 'shop') return heroScreen(interaction, rest.join(':') || 'main');
  return rest[2] === 'room' ? shopScreen(interaction, rest[0], rest[1], rest.slice(3).join(':'), true) : shopScreen(interaction, rest[0], rest[1]);
};

// Redraws the hero screen or the item shop (`where`) after an action; `problem` (if any) is told to the member privately. `act` may return
// { say, where } to show another screen.
async function heroAction(interaction, act, where = 'hero:main') {
  if (!(await mine(interaction))) return;
  await interaction.deferUpdate();
  let problem = await act();
  if (problem && typeof problem === 'object') ({ say: problem, where = where } = problem);
  await interaction.editReply({ ...(await screen(interaction, where)), attachments: [] });
  if (problem) await interaction.followUp({ content: problem, flags: MessageFlags.Ephemeral });
}

// ---- /descend (rules: utils/farm/descent.js, messages: descentViews.js) ----
// Redraws the run's message: `act` changes the run and may return { say } (told privately) and options for the screen ({ note, quit, replace }).
async function descentAction(interaction, act = async () => ({})) {
  if (!(await mine(interaction))) return;
  await interaction.deferUpdate();
  const { say, ...opts } = (await act()) ?? {};
  const record = await getFarmUser(interaction.user.id);
  await interaction.editReply({ ...(await dviews.screen(interaction.member, record, opts)), attachments: [] });
  if (say) await interaction.followUp({ content: say, flags: MessageFlags.Ephemeral });
}
const roomOf = (interaction) => Number(interaction.customId.split(':')[2]);
const STALE = { say: 'That screen is out of date. Here is where your run stands.' };
// What a pick did, for the next room's screen.
function picked(result) {
  if (result.kind === 'buffs') return `Took **${dviews.buffLine(result.name, result.stacks)}** for this run.`;
  const name = `${result.enhanced ? 'Enhanced ' : ''}${result.name}`;
  if (result.kind === 'legendaries') return `**${name}** is in the legendary slot.`;
  if (result.enhancedHeld) return `You Enhanced **${result.name}**.`; // the enhanced copy of an item already held (his wording, Nov 5)
  if (result.used?.length) return `Upgraded ${result.used.join(' + ')} into **${name}**.${result.bonus ? ` BONUS: **${result.bonus}**.` : ''}`;
  return result.replaced ? `Gave up ${result.replaced} for **${name}**.` : `Took **${name}**.`;
}

// Fight: settled at once (descent.fight), replayed in the room's message, then the result and the pick (or the end of the run) as a new message.
async function descendFight(interaction) {
  if (!(await mine(interaction))) return;
  await interaction.deferUpdate();
  const record = await getFarmUser(interaction.user.id);
  if (record.descent?.room !== roomOf(interaction) || record.descent?.phase === 'offer') {
    await interaction.editReply({ ...(await dviews.screen(interaction.member, record)), attachments: [] });
    return interaction.followUp({ content: STALE.say, flags: MessageFlags.Ephemeral });
  }
  const result = await descent.fight(interaction.user.id);
  if (result.error) {
    const say = { busy: 'That room is already being fought.', broker: 'The Broker has no fight. Corrupt an item or leave.', rest: 'A rest stop has no fight. Rest or tinker.', breather: 'Nothing here wants a fight. Break the crates open.', urn: 'This room has no fight.', wounded: 'This room has no fight.', dealer: 'This room has no fight.', patron: 'This room has no fight.', teleporter: 'This room has no fight.', visit: 'This hero is not here to fight. Accept or turn them down.', none: 'You have no run going. Start one with `/descend run`.', offer: 'Pick your reward first.' }[result.error];
    return interaction.followUp({ content: say, flags: MessageFlags.Ephemeral });
  }
  const { run } = result;
  for (const [index, frame] of run.frames.entries()) {
    const view = await dviews.fightView(run, frame);
    await interaction.editReply(index === run.frames.length - 1 ? withBreakdown(view, run, interaction.user.id) : view);
    await sleep(FRAME_MS);
  }
  if (run.over) return interaction.followUp(await dviews.overView(interaction.member, run));
  if (run.fled) { // the Rift lost (Nov 6): the hero fled and the run goes on, to the next room
    const record = await getFarmUser(interaction.user.id);
    return interaction.followUp(await dviews.screen(interaction.member, record, { note: `You fled the Rift with **${Math.round(record.descent.health * 100)}%** health. No Rift Troopers this time.` }));
  }
  if (run.rescued) { // Ivy's Rescue (his ask, Nov 7): the fight is lost, the run goes on, back at a Rest Stop
    const record = await getFarmUser(interaction.user.id);
    return interaction.followUp(await dviews.screen(interaction.member, record, { note: `**Ivy** dropped in and pulled you out of Room ${run.rescued.until}. She set you down at a Rest Stop in Room ${run.rescued.back} with **${Math.round(record.descent.health * 100)}%** Health.` }));
  }
  if (run.complete) {
    await interaction.followUp(await dviews.completeView(interaction.member, run));
    return run.token ? interaction.followUp({ ...dviews.tokenView(run.hero), flags: MessageFlags.Ephemeral }) : null;
  }
  if (run.next.phase === 'ready') { // a room fought again after Ivy's Rescue: no Level and no pick
    const record = await getFarmUser(interaction.user.id);
    return interaction.followUp(await dviews.screen(interaction.member, record, { note: 'You cleared this room again. There is no Level and no pick for a room you already cleared.' }));
  }
  await interaction.followUp(await dviews.offerView(interaction.member, run.next, { run, animate: true }));
  if (run.token) await interaction.followUp({ ...dviews.tokenView(run.hero), flags: MessageFlags.Ephemeral });
}

// One page of a fight's breakdown (`tab`: damage | taken | heal | build | foes), with the page buttons under it.
async function breakdownPage(id, tab) {
  const run = breakdowns.get(id);
  const page = tab === 'taken' ? enemyDamageView(run) : tab === 'heal' ? healingView(run)
    : tab === 'build' ? (run.kit ? await heroBuildView(run.hero, run.kit) : { content: 'That build was not kept.' })
      : tab === 'foes' ? (run.theirs ? await rivalBuildView(run.rival, run.theirs, { health: run.theirHealth, note: 'The kit it fought with.' }) : npcBuildView(run.title, run.foes, 'The enemies as the fight started.'))
        : damageView(run);
  return { content: '', embeds: [], files: [], ...page, components: [damageTabs(id, run, tab)] };
}

const descentRoutes = [
  {
    name: 'farm',
    label: 'Descend view item select', // only the Item Choices text changes (his ask, Oct 28); anyone else sees that item privately
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DVIEW_ID}:`),
    async execute(interaction) {
      const d = (await getFarmUser(ownerOf(interaction))).descent;
      const index = Number(interaction.values[0]);
      if (d?.phase !== 'offer' || d.offer.room !== roomOf(interaction) || !d.offer.choices[index]) {
        return interaction.user.id === ownerOf(interaction) ? descentAction(interaction, async () => STALE) : interaction.reply({ content: 'That pick is over.', flags: MessageFlags.Ephemeral });
      }
      const about = dviews.choiceAbout(d, index);
      if (interaction.user.id !== ownerOf(interaction)) return interaction.reply({ content: about, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      const embed = interaction.message.embeds[0].toJSON();
      embed.fields = embed.fields.map((f) => (f.name === 'Item Choices' ? { ...f, value: about } : f));
      // the sent embed's pictures came back as CDN links; pointed back at the attachments, or Discord shows them loose above the embed.
      // An edit's attachment:// only reaches files uploaded with that edit (Oct 29: they still showed loose), so the message's own files go up again.
      await interaction.deferUpdate();
      const names = new Set(interaction.message.attachments.map((a) => a.name));
      const reattach = (url) => {
        const name = url && decodeURIComponent(new URL(url).pathname.split('/').pop());
        return names.has(name) ? `attachment://${name}` : url;
      };
      for (const part of [embed.image, embed.thumbnail]) if (part?.url) part.url = reattach(part.url);
      for (const part of [embed.author, embed.footer]) if (part?.icon_url) part.icon_url = reattach(part.icon_url);
      const components = interaction.message.components.map((r) => {
        const json = r.toJSON();
        for (const c of json.components) if (c.custom_id === interaction.customId) c.options = c.options.map((o) => ({ ...o, default: o.value === interaction.values[0] }));
        return json;
      });
      const files = interaction.message.attachments.map((a) => ({ attachment: a.url, name: a.name }));
      return interaction.editReply({ embeds: [embed], components, files, attachments: [] });
    },
  },
  {
    name: 'farm',
    label: 'Descend reroll button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DREROLL_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.reroll(interaction.user.id, roomOf(interaction));
      return result.ok ? { animate: true } : result.error === 'empty' ? { say: 'You have no rerolls left on this Floor.' } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend hero select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DHERO_ID}:`),
    execute: (interaction) => redraw(interaction, async () => {
      const record = await getFarmUser(interaction.user.id);
      const ascension = interaction.customId.split(':')[2];
      return record.descent ? dviews.screen(interaction.member, record) : dviews.startView(interaction.member, record, interaction.values[0], ascension ? Number(ascension) : null);
    }),
  },
  {
    name: 'farm',
    label: 'Descend ascension select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DASC_ID}:`),
    execute: (interaction) => redraw(interaction, async () => {
      const record = await getFarmUser(interaction.user.id);
      return record.descent ? dviews.screen(interaction.member, record) : dviews.startView(interaction.member, record, interaction.customId.split(':')[2] || null, Number(interaction.values[0]));
    }),
  },
  {
    name: 'farm',
    label: 'Descend begin button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DBEGIN_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const [, , hero, ascension = '0'] = interaction.customId.split(':'); // (a button from before ascensions has none: 0)
      const result = await descent.startRun(interaction.user.id, hero, undefined, Number(ascension));
      return { running: { say: 'You already have a run going. Here it is.' }, locked: { say: 'Unlock that hero first.' }, ascension: { say: 'You have not unlocked that Ascension yet.' } }[result.error];
    }),
  },
  {
    name: 'farm',
    label: 'Descend fight button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DFIGHT_ID}:`),
    execute: descendFight,
  },
  {
    name: 'farm',
    label: 'Descend walk away button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DWALK_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const before = await descent.getRun(interaction.user.id);
      if (before?.room !== roomOf(interaction)) return STALE;
      const result = await descent.walkPast(interaction.user.id);
      if (result.kind === 'broker') return { note: "You left the Broker's stall and went on." };
      return result.ok ? { note: `You walked away. The rival lets you pass, and you gain nothing.${result.lost > 0 ? ` It cost you **${Math.round(result.lost * 100)}%** of your health.` : ''}` } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend event button', // an event room's choices (Nov 4): rest, break, urn, recruit, bless, step (the Teleporter), leave
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DREST_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const action = interaction.customId.split(':')[3];
      if (action === 'found') return (await descent.seenFind(interaction.user.id)).ok ? {} : STALE; // the Buff window, on to the next room
      if (action === 'continue') return (await descent.seen(interaction.user.id, roomOf(interaction))).ok ? { animate: true } : STALE; // Violet's result screen, on to the pick
      const result = await descent.eventChoice(interaction.user.id, roomOf(interaction), action);
      if (result.error === 'carrying') return { say: action === 'step' ? "You carry the Soul Urn: the Teleporter won't take you." : 'You are already carrying the Soul Urn.' };
      if (result.error === 'ally') return { say: 'You already have an ally.' };
      if (!result.ok) return STALE;
      if (result.pick) return {}; // McGinnis' Upgrade Item with several to aim for: the screen now asks which
      if (action === 'step') return { note: 'The Teleporter hums, and the room around you changes.' };
      return { note: `${dviews.eventText({ action, ...result })}${result.replay ? '' : ' You gained a level.'}` }; // (the pick screen that follows says it too)
    }),
  },
  {
    name: 'farm',
    label: 'Descend dealer select', // the Curiosity Dealer: swap an item for a pick a tier higher, or sell one for a full heal (Nov 4)
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DDEAL_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const action = interaction.customId.split(':')[3];
      const result = await descent.eventChoice(interaction.user.id, roomOf(interaction), action, interaction.values[0]);
      if (result.error === 'none-higher') return { say: 'He has nothing a tier higher for that one.' };
      if (!result.ok) return STALE;
      if (result.pick) return {}; // Violet with a full build: the screen now asks which item to give up for the replica
      return { note: `${dviews.eventText(result)}${result.replay ? '' : ' You gained a level.'}` };
    }),
  },
  {
    name: 'farm',
    label: 'Descend tinker select', // a rest stop's Tinker: try to enhance the picked item
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DTINKER_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.eventChoice(interaction.user.id, roomOf(interaction), 'tinker', interaction.values[0]);
      if (!result.ok) return STALE;
      return { note: `${dviews.eventText(result)}${result.replay ? '' : ' You gained a level.'}` };
    }),
  },
  {
    name: 'farm',
    label: 'Descend tinker view select', // the owner's message shows that item's enhanced bonuses; anyone else sees them privately
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DTVIEW_ID}:`),
    async execute(interaction) {
      const d = (await getFarmUser(ownerOf(interaction))).descent;
      const name = interaction.values[0];
      const live = d?.room === roomOf(interaction) && descent.tinkerables(d).includes(name);
      if (interaction.user.id !== ownerOf(interaction)) return interaction.reply({ content: live ? `**${name}**\n${bonusLines(name, 'enhanced').join('\n') || 'None listed'}`.slice(0, 1900) : 'That rest stop is over.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return descentAction(interaction, async () => (live ? { viewing: name } : STALE));
    },
  },
  {
    name: 'farm',
    label: 'Descend broker view select', // the owner's message shows that item's corrupted effects; anyone else sees them privately
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DBVIEW_ID}:`),
    async execute(interaction) {
      const d = (await getFarmUser(ownerOf(interaction))).descent;
      const name = interaction.values[0];
      const live = d?.room === roomOf(interaction) && descent.corruptibles(d).includes(name);
      if (interaction.user.id !== ownerOf(interaction)) return interaction.reply({ content: live ? dviews.brokerAbout(name) : 'That stall is over.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return descentAction(interaction, async () => (live ? { viewing: name } : STALE));
    },
  },
  {
    name: 'farm',
    label: 'Descend broker select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DCORRUPT_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.visitBroker(interaction.user.id, roomOf(interaction), interaction.values[0]);
      if (result.error === 'health') return { say: 'You are too hurt to pay the Broker.' };
      return result.ok ? { note: `The Broker corrupted **${result.name}**: it keeps its corrupted bonuses and carries **${drawbackLine(result)}**. It cost you **${Math.round(result.lost * 100)}%** of your health.` } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend broker fragile button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DFRAGILE_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const action = interaction.customId.split(':')[3];
      const result = await descent.dealBroker(interaction.user.id, roomOf(interaction), action);
      if (!result.ok) return STALE;
      return { note: action === 'take'
        ? `The Broker pressed a **Fragile ${result.name}** into your hands. "Don't say I never gave ya nothin'." It's cracked and weaker than it should be, and it shatters if a Rejuv goes off or a fight leaves you under 10% health. Keep it until the next stall.`
        : `The Broker mended your **${result.name}** into an **Enhanced** one. On the house.` };
    }),
  },
  {
    name: 'farm',
    label: 'Descend pick button',
    matches: (interaction) => (interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(`${dviews.DTAKE_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const index = Number(interaction.values?.[0] ?? interaction.customId.split(':')[3]); // a rival's build is a dropdown
      const result = await descent.choose(interaction.user.id, roomOf(interaction), index);
      if (result.error === 'full') return { replace: index };
      return result.ok ? { note: picked(result) } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend feed select', // Rem's Lil Helper (Nov 7): feed it an offered Item you are not taking; the pick screen stays
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DFEED_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.feed(interaction.user.id, roomOf(interaction), Number(interaction.values[0]));
      if (!result.ok) return STALE;
      return result.done ? { note: 'You fed the Lil Helper every Item on offer. There is nothing left to pick.' } : {};
    }),
  },
  {
    name: 'farm',
    label: 'Descend give up select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DSWAP_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.choose(interaction.user.id, roomOf(interaction), Number(interaction.customId.split(':')[3]), interaction.values[0]);
      return result.ok ? { note: picked(result) } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend skip button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DSKIP_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.skip(interaction.user.id, roomOf(interaction));
      if (!result.ok) return STALE;
      const healed = result.healed > 0 ? `Skip: Healed **${Math.round(result.healed * 100)}%** of max health.` : 'Skip:';
      return { note: result.buffs.length ? [`${healed} Perma-Buffs:`, ...result.buffs.map((k) => buffText(k, 1))].join('\n') : healed };
    }),
  },
  {
    name: 'farm',
    label: 'Descend recruit button', // a beaten rival fights beside you for a few fights (no item)
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DRECRUIT_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.recruit(interaction.user.id, roomOf(interaction));
      if (result.error === 'ally') return { say: 'You already have an ally.' };
      return result.ok ? { note: `**${result.hero}** joined you for the next **${result.fights} fights**.` } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend imbue ability select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DIMBUE_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.imbue(interaction.user.id, Number(interaction.values[0]));
      return result.ok ? { note: `Imbued **${result.name}** into Ability ${result.slot}.` }
        : { locked: { say: "That ability isn't unlocked yet." }, ultimate: { say: 'That item cannot imbue an ultimate.' }, none: STALE }[result.error];
    }),
  },
  {
    name: 'farm',
    label: 'Descend bonus replacement select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DBONUSSWAP_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.takeBonusItem(interaction.user.id, interaction.values[0]);
      return result.ok ? { note: `Took BONUS **${result.name}**.` } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend ability point',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DPOINT_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.spend(interaction.user.id, Number(interaction.values[0]));
      return { locked: { say: "That ability isn't unlocked yet." }, max: { say: 'That ability is fully upgraded.' }, points: { say: "You don't have enough ability points for that tier." }, none: STALE }[result.error];
    }),
  },
  {
    name: 'farm',
    label: 'View Enemy Build button', // a private message: a target's enemies, or the rival waiting (anyone may look: it shows the owner's)
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${ENEMY_ID}:`),
    async execute(interaction) {
      const [, ownerId, key, ...rest] = interaction.customId.split(':');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (key === 'rival') {
        const kit = rivalKitOf(ownerId, rest.join(':'));
        return interaction.editReply(kit ? await rivalBuildView(rest.join(':'), kit, { note: 'The kit it will fight with.' }) : { content: 'That rival has already left.' });
      }
      const record = await getFarmUser(ownerId);
      const variant = rest.join(':');
      const { sections, note } = targetEnemies(record, key, { family: variant });
      const name = key === 'siege' ? 'Base Siege' : key === 'waves' ? 'Waves' : TARGETS[key]?.name ?? key;
      return interaction.editReply(npcBuildView(LANES[variant] ? `${LANES[variant].name} ${name}` : name, sections, note));
    },
  },
  {
    name: 'farm',
    label: 'Descend enemy build button', // a private message: what is in this room (anyone may look: it shows the owner's run)
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DENEMY_ID}:`),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const d = (await getFarmUser(ownerOf(interaction))).descent;
      if (!d || d.room !== roomOf(interaction) || d.phase === 'offer') return interaction.editReply({ content: STALE.say });
      const spec = descent.specOf(d);
      if (!['fight', 'boss', 'rival'].includes(spec.kind)) return interaction.editReply({ content: spec.kind === 'rift' ? `The Rift: ${spec.rivals.join(', ')}, everyone against everyone.` : 'Nothing in this room wants a fight.' }); // an event or a hero room (an old button)
      const held = descent.enemiesOf(d, spec);
      const under = d.level - held.kit?.boons;
      return interaction.editReply(held.rival
        ? await rivalBuildView(held.rival, held.kit, { health: held.health, note: `The kit it will fight with, ${under > 0 ? `${under === 1 ? 'one level' : `${under} levels`} under yours` : 'at your level'} and at ${Math.round(held.health * 100)}% health.` })
        : npcBuildView(spec.final ? `The ${descent.BOSSES[descent.finalKeys(spec)[0]].name}` : spec.kind === 'boss' ? `The ${descent.bossName(spec, true)}` : `Room ${spec.room}`, [{ units: held.units }], 'These are the enemies in this room.'));
    },
  },
  {
    name: 'farm',
    label: 'Descend build button', // the owner's message redraws; anyone else sees the run's build privately
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DBUILD_ID}:`),
    execute: (interaction) => (interaction.user.id !== ownerOf(interaction)
      ? peek(interaction, async () => {
        const d = (await getFarmUser(ownerOf(interaction))).descent;
        return d ? { ...(await dviews.buildView(interaction.member, d)), content: `<@${ownerOf(interaction)}>'s run.` } : 'That run is over.';
      })
      : redraw(interaction, async () => {
        const record = await getFarmUser(interaction.user.id);
        return record.descent ? dviews.buildView(interaction.member, record.descent) : dviews.screen(interaction.member, record);
      })),
  },
  {
    name: 'farm',
    label: 'Descend back button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DBACK_ID}:`),
    execute: (interaction) => descentAction(interaction),
  },
  {
    name: 'farm',
    label: 'Descend abandon button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DQUIT_ID}:`),
    async execute(interaction) {
      if (!interaction.customId.endsWith(':yes')) return descentAction(interaction, async () => ({ quit: true }));
      if (!(await mine(interaction))) return;
      await interaction.deferUpdate();
      const ended = await descent.abandon(interaction.user.id);
      const record = await getFarmUser(interaction.user.id);
      await interaction.editReply({ ...(await dviews.startView(interaction.member, record)), attachments: [] });
      return interaction.followUp({ content: ended ? `You abandoned the run with ${ended.hero} after ${ended.room - 1} rooms.` : 'There is no run to abandon.', flags: MessageFlags.Ephemeral });
    },
  },
  {
    name: 'farm',
    label: 'Descend again button', // a new message: the end of the last run stays
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DAGAIN_ID}:`),
    async execute(interaction) {
      if (!(await mine(interaction))) return;
      await interaction.deferReply();
      return interaction.editReply(await dviews.screen(interaction.member, await getFarmUser(interaction.user.id)));
    },
  },
];

module.exports = [
  ...descentRoutes,
  {
    name: 'farm',
    label: 'Hero button', // the owner's message redraws; anyone else sees that hero's build privately
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${HEROCARD_ID}:`),
    execute: (interaction) => (interaction.user.id !== ownerOf(interaction)
      ? peek(interaction, async () => {
        const record = await getFarmUser(ownerOf(interaction));
        return record.hero ? { ...(await heroView(interaction.member, record)), content: `<@${ownerOf(interaction)}>'s ${record.hero}.` } : 'They have no hero yet.';
      })
      : redraw(interaction, () => heroScreen(interaction))),
  },
  {
    name: 'farm',
    label: 'Ability upgrade',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${UPGRADE_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {
      const result = await upgradeAbility(interaction.user.id, Number(interaction.values[0]));
      return { locked: "That ability isn't unlocked yet.", max: 'That ability is fully upgraded.', points: "You don't have enough ability points for that tier." }[result.error];
    }),
  },
  {
    name: 'farm',
    label: 'Pick item',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${ITEM_ID}:`),
    execute: (interaction) => redraw(interaction, () => shopScreen(interaction, ...interaction.customId.split(':').slice(2, 4), interaction.values[0])), // shows the item; Buy buys it
  },
  {
    name: 'farm',
    label: 'Buy item',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${BUY_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {
      const name = interaction.customId.split(':').slice(4).join(':');
      const result = await buyItem(interaction.user.id, name);
      const said = result.used?.length ? titleCase(`Upgraded ${result.used.join(' + ')} into ${name} for ${fmt(result.paid)} souls.`) : null;
      if (result.imbue) return { say: said, where: `hero:imbue:${name}` }; // an imbue item asks which ability right away (his call, Oct 3)
      if (said) return said;
      if (result.error === 'inside') return titleCase(`You already have that in ${result.holder}.`);
      if (result.error === 'corrupted') return titleCase(`That would use up your corrupted ${result.item}. Sell it first.`);
      if (result.error === 'full') return { say: null, where: `shop:${interaction.customId.split(':').slice(2, 4).join(':')}:room:${name}` }; // which item to sell for it (his call, Oct 22)
      return { souls: "Your hero can't afford that item.", owned: 'You already have that item.', unknown: 'That item is not for sale.', banned: "Your hero can't buy that item." }[result.error];
    }, `shop:${interaction.customId.split(':').slice(2, 4).join(':')}`), // back on the tab and price it was bought from
  },
  {
    name: 'farm',
    label: 'Sell for a new item',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${ROOM_ID}:`),
    execute: (interaction) => {
      const [, , tab, tier, ...rest] = interaction.customId.split(':');
      const name = rest.join(':');
      return heroAction(interaction, async () => {
        const result = await buyItem(interaction.user.id, name, { sell: interaction.values[0] });
        if (!result.ok) {
          if (result.error === 'inside') return titleCase(`You already have that in ${result.holder}.`);
          if (result.error === 'corrupted') return titleCase(`That would use up your corrupted ${result.item}. Sell it first.`);
          return { souls: "Your hero can't afford that item, even after selling.", owned: 'You already have that item.', missing: 'You do not have that item to sell.', full: 'Your build is still full.', unknown: 'That item is not for sale.', banned: "Your hero can't buy that item." }[result.error];
        }
        const said = titleCase(`Sold ${result.sold} for ${fmt(result.refund)} souls and bought ${name}${result.used.length ? ` (upgraded from ${result.used.join(' + ')})` : ''} for ${fmt(result.paid)} souls.`);
        return result.imbue ? { say: said, where: `hero:imbue:${name}` } : said;
      }, `shop:${tab}:${tier}`);
    },
  },
  {
    name: 'farm',
    label: 'Legendary select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${LEGEND_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {
      const result = await equipLegendary(interaction.user.id, interaction.values[0]);
      return result.ok ? null : 'Your hero does not have that legendary.';
    }),
  },
  {
    name: 'farm',
    label: 'Item shop button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${SHOPMODE_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {}, interaction.customId.endsWith(':on') ? 'shop:weapon' : 'hero:main'),
  },
  {
    name: 'farm',
    label: 'Shop tab',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${SHOPTAB_ID}:`),
    execute: (interaction) => redraw(interaction, () => shopScreen(interaction, interaction.customId.split(':')[2], interaction.customId.split(':')[3])),
  },
  {
    name: 'farm',
    label: 'Sell item',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${SELL_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {
      const result = await sellItem(interaction.user.id, interaction.values[0]);
      return result.ok ? null : 'You do not have that item.';
    }, 'shop:sell'),
  },
  {
    name: 'farm',
    label: 'Imbue item select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${IMBUE_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {}, `hero:imbue:${interaction.values[0]}`),
  },
  {
    name: 'farm',
    label: 'Imbue ability select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${IMBUESET_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {
      const result = await setImbue(interaction.user.id, interaction.customId.split(':').slice(2).join(':'), Number(interaction.values[0]));
      return result.ok ? null : 'You do not have that item.';
    }),
  },
  {
    name: 'farm',
    label: 'Corrupt item',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${CORRUPT_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {
      const name = interaction.values[0];
      const result = await corruptItem(interaction.user.id, name);
      if (result.ok) return titleCase(`Corrupted ${name} for ${fmt(result.paid)} souls. Its drawback: ${drawbackLine(result)}. Its bonuses are on the Hero screen.`);
      if (result.error === 'closed') return titleCase(`The Broker is closed. He opens in ${timeLeft(result.opens - Date.now())}.`);
      return { souls: "Your hero can't afford that.", one: titleCase('Your hero already has a corrupted item.'), missing: 'You do not have that item.', unknown: "That item can't be corrupted." }[result.error];
    }, 'shop:broker'),
  },
  {
    name: 'farm',
    label: 'Hatch Egg button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${HATCH_ID}:`),
    execute: (interaction) => heroAction(interaction, async () => {
      const result = await hatchEgg(interaction.user.id);
      if (!result.ok) return 'You do not have an egg to hatch.';
      const lines = [titleCase(`The egg hatched: +${fmt(result.souls)} souls${result.buffs.length ? ', and these permanent buffs:' : '.'}`), ...result.buffs.map((k) => buffText(k, 1))];
      return lines.join('\n');
    }),
  },
  {
    name: 'farm',
    label: 'Hero select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${HERO_ID}:`),
    execute: (interaction) => redraw(interaction, () => pickScreen(interaction, interaction.values[0])),
  },
  {
    name: 'farm',
    label: 'Switch Hero button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${SWITCH_ID}:`),
    execute: (interaction) => redraw(interaction, () => pickScreen(interaction, null, interaction.customId.split(':')[2])),
  },
  {
    name: 'farm',
    label: 'Switch button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${SWITCHTO_ID}:`),
    async execute(interaction) {
      if (!(await mine(interaction))) return;
      const hero = interaction.customId.split(':')[2];
      await interaction.deferUpdate();
      const result = await switchHero(interaction.user.id, hero);
      if (result.ok) return interaction.editReply({ ...(await homeView(interaction.member, await getFarmUser(interaction.user.id))), attachments: [] });
      await interaction.editReply({ ...(await pickScreen(interaction, hero)), attachments: [] });
      const problem = { locked: 'Unlock that hero first.', same: 'That is already your hero.' }[result.error];
      if (problem) await interaction.followUp({ content: problem, flags: MessageFlags.Ephemeral });
    },
  },
  {
    name: 'farm',
    label: 'Unlock button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${UNLOCK_ID}:`),
    async execute(interaction) {
      if (!(await mine(interaction))) return;
      const hero = interaction.customId.split(':')[2];
      await interaction.deferUpdate();
      const result = await unlockHero(interaction.user.id, hero);
      await interaction.editReply({ ...(await pickScreen(interaction, hero)), attachments: [] });
      const problem = { token: 'You need a Character Unlock Token. Win the Base Siege with a hero to earn one.', owned: 'You already have that hero.', unknown: 'That hero is not available.' }[result.error];
      if (problem) await interaction.followUp({ content: problem, flags: MessageFlags.Ephemeral });
    },
  },
  {
    name: 'farm',
    label: 'Hero Select button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${PICK_ID}:`),
    async execute(interaction) {
      if (!(await mine(interaction))) return;
      const hero = interaction.customId.split(':')[2];
      await interaction.deferUpdate();
      if (!(await chooseHero(interaction.user.id, hero))) {
        await interaction.followUp({ content: 'You already picked a hero.', flags: MessageFlags.Ephemeral });
      }
      const record = await getFarmUser(interaction.user.id);
      await interaction.editReply({ ...(record.hero ? await homeView(interaction.member, record) : await pickView(interaction.member)), attachments: [] });
    },
  },
  {
    name: 'farm',
    label: 'Target select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${TARGET_ID}:`),
    execute: (interaction) => redraw(interaction, async () => { // a Guardian or Walker comes as '<key>:<lane>'
      const [key, lane] = interaction.values[0].split(':');
      if (key === 'shop') return shopScreen(interaction); // the item shop is an option of the /base dropdown (his call, Oct 3)
      return targetView(interaction.member, key, await getFarmUser(interaction.user.id), Date.now(), lane);
    }),
  },
  {
    name: 'farm',
    label: 'Back button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${BACK_ID}:`),
    execute: (interaction) => redraw(interaction, async () => homeView(interaction.member, await getFarmUser(interaction.user.id))),
  },
  {
    name: 'farm',
    label: 'Rival Fight button', // the duel is settled at once (play.js fightRival), then replayed like a trip
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${DUEL_ID}:`),
    async execute(interaction) {
      if (!(await mine(interaction))) return;
      await interaction.deferUpdate();
      const rival = rivalOf(interaction);
      const result = await fightRival(interaction.user.id, rival);
      if (result.error) {
        await interaction.editReply({ components: withoutRival(interaction) });
        return interaction.followUp({ content: result.error === 'owned' ? `You already have ${rival} unlocked.` : 'That rival has already left.', flags: MessageFlags.Ephemeral });
      }
      // The trip's result keeps its rival embed without the buttons; the duel plays in a message of its own, and its result is a new one (his call, Oct 16).
      await interaction.editReply({ components: withoutRival(interaction) });
      const [first, ...rest] = result.run.frames;
      const live = await interaction.followUp(await duelView(result.run, first));
      for (const frame of rest) {
        await sleep(FRAME_MS);
        await interaction.editReply({ ...(await duelView(result.run, frame)), message: live });
      }
      await sleep(FRAME_MS);
      return interaction.followUp(withBreakdown(await duelResultView(result.run), result.run, interaction.user.id));
    },
  },
  {
    name: 'farm',
    label: 'Rival Walk Away button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${WALK_ID}:`),
    async execute(interaction) {
      if (!(await mine(interaction))) return;
      await interaction.deferUpdate();
      const rival = walkAway(interaction.user.id, rivalOf(interaction));
      await interaction.editReply({ components: withoutRival(interaction) });
      return interaction.followUp({ content: rival ? `You let ${rival} go.` : 'That rival has already left.', flags: MessageFlags.Ephemeral });
    },
  },
  {
    name: 'farm',
    label: 'Damage Breakdown button', // anyone may look; the answer is private
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${DAMAGE_ID}:`),
    async execute(interaction) {
      const id = interaction.customId.split(':')[2];
      if (!breakdowns.has(id)) return interaction.reply({ content: 'That breakdown is gone: the bot restarted since this fight.', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return interaction.editReply(await breakdownPage(id, 'damage'));
    },
  },
  {
    name: 'farm',
    label: 'Damage Breakdown page button', // the breakdown's pages: the hero's damage, the enemies' damage, healing, both builds as the fight started
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${DAMAGETAB_ID}:`),
    async execute(interaction) {
      const [, id, tab] = interaction.customId.split(':');
      if (!breakdowns.has(id)) return interaction.reply({ content: 'That breakdown is gone: the bot restarted since this fight.', flags: MessageFlags.Ephemeral });
      await interaction.deferUpdate();
      return interaction.editReply({ ...(await breakdownPage(id, tab)), attachments: [] });
    },
  },
  {
    name: 'farm',
    label: 'Send button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${SEND_ID}:`),
    async execute(interaction) {
      if (!(await mine(interaction))) return;
      await send(interaction);
    },
  },
];
