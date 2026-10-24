const { setTimeout: sleep } = require('node:timers/promises');
const { MessageFlags } = require('discord.js');
const { getFarmUser, chooseHero, play, upgradeAbility, buyItem, sellItem, equipLegendary, unlockHero, switchHero, corruptItem, setImbue, hatchEgg, fightRival, walkAway, holdOffer } = require('../utils/farm/play');
const { drawbackLine } = require('../utils/farm/corruption');
const { buffText } = require('../utils/farm/buffs');
const { fmt } = require('../utils/format');
const { shortId } = require('../utils/random');
const { DAMAGE_ID, damageButton, damageView, DUEL_ID, WALK_ID, withRival, duelView, duelResultView, HERO_ID, PICK_ID, TARGET_ID, SEND_ID, BACK_ID, HEROCARD_ID, UPGRADE_ID, ITEM_ID, BUY_ID, SHOPMODE_ID, SELL_ID, SWITCH_ID, SWITCHTO_ID, UNLOCK_ID, IMBUE_ID, IMBUESET_ID, SHOPTAB_ID, CORRUPT_ID, HATCH_ID, LEGEND_ID, ROOM_ID, titleCase, timeLeft, pickView, homeView, heroView, shopView, targetView, fightView, resultView, legendaryView, tokenView, notReady } = require('../utils/farm/views');

const descent = require('../utils/farm/descent');
const dviews = require('../utils/farm/descentViews');

// the live fight message is edited this often (Discord allows about 5 edits per 5 s per channel); tests set FARM_FRAME_MS=0
const FRAME_MS = Number(process.env.FARM_FRAME_MS ?? 3000);

// The farm's dropdowns and buttons redraw the member's own message. Only the member who opened it can use them.
async function mine(interaction) {
  const [, ownerId] = interaction.customId.split(':');
  if (interaction.user.id === ownerId) return true;
  await interaction.reply({ content: 'This is not your farm. Open yours with `/base`.', flags: MessageFlags.Ephemeral });
  return false;
}

// The rival a Fight / Walk Away button belongs to (farm_duel:<user id>:<rival>); buttons from before Oct 11 have none.
const rivalOf = (interaction) => interaction.customId.split(':')[2];

// The fights a Damage Breakdown button can still show (in memory: a restart forgets them). ponytail: the oldest go past MAX_BREAKDOWNS.
const breakdowns = new Map(); // fight id -> { hero, rival?, seconds, damage }
const MAX_BREAKDOWNS = 500;
function withBreakdown(view, run, ownerId) {
  const id = shortId();
  breakdowns.set(id, { hero: run.hero, rival: run.encounter ? run.rival : null, seconds: run.seconds, damage: run.damage ?? [] });
  if (breakdowns.size > MAX_BREAKDOWNS) breakdowns.delete(breakdowns.keys().next().value);
  view.components.push(damageButton(ownerId, id));
  return view;
}
// The result's buttons once its rival is fought or let go: the Damage Breakdown stays.
const withoutRival = (interaction) => (interaction.message?.components ?? []).filter((r) => !r.components.some((c) => c.customId?.startsWith(`${DUEL_ID}:`)));

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
  if (result.kind === 'buffs') return `Took **${dviews.buffLine(result.name)}** for this run.`;
  if (result.kind === 'legendaries') return `**${result.name}** is in the legendary slot.`;
  if (result.used?.length) return `Upgraded ${result.used.join(' + ')} into **${result.name}**.`;
  return result.replaced ? `Gave up ${result.replaced} for **${result.name}**.` : `Took **${result.name}**.`;
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
    const say = { busy: 'That room is already being fought.', none: 'You have no run going. Start one with `/descend run`.', offer: 'Pick your reward first.' }[result.error];
    return interaction.followUp({ content: say, flags: MessageFlags.Ephemeral });
  }
  const { run } = result;
  for (const frame of run.frames) {
    await interaction.editReply(await dviews.fightView(run, frame));
    await sleep(FRAME_MS);
  }
  if (run.over) return interaction.followUp(withBreakdown(await dviews.overView(interaction.member, run), run, interaction.user.id));
  if (run.complete) {
    await interaction.followUp(withBreakdown(await dviews.completeView(interaction.member, run), run, interaction.user.id));
    return run.token ? interaction.followUp({ ...dviews.tokenView(run.hero), flags: MessageFlags.Ephemeral }) : null;
  }
  await interaction.followUp(withBreakdown(await dviews.offerView(interaction.member, run.next, { run, animate: true }), run, interaction.user.id));
  if (run.token) await interaction.followUp({ ...dviews.tokenView(run.hero), flags: MessageFlags.Ephemeral });
}

const descentRoutes = [
  {
    name: 'farm',
    label: 'Descend hero select',
    matches: (interaction) => interaction.isStringSelectMenu() && interaction.customId.startsWith(`${dviews.DHERO_ID}:`),
    execute: (interaction) => redraw(interaction, async () => {
      const record = await getFarmUser(interaction.user.id);
      return record.descent ? dviews.screen(interaction.member, record) : dviews.startView(interaction.member, record, interaction.values[0]);
    }),
  },
  {
    name: 'farm',
    label: 'Descend begin button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DBEGIN_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const result = await descent.startRun(interaction.user.id, interaction.customId.split(':').slice(2).join(':'));
      return { running: { say: 'You already have a run going. Here it is.' }, locked: { say: 'Unlock that hero first.' } }[result.error];
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
      return result.ok ? { note: 'You walked away. The rival lets you pass, and you gain nothing.' } : STALE;
    }),
  },
  {
    name: 'farm',
    label: 'Descend pick button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DTAKE_ID}:`),
    execute: (interaction) => descentAction(interaction, async () => {
      const index = Number(interaction.customId.split(':')[3]);
      const result = await descent.choose(interaction.user.id, roomOf(interaction), index);
      if (result.error === 'full') return { replace: index };
      return result.ok ? { note: picked(result) } : STALE;
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
      return result.ok ? { note: `You skipped the pick and healed ${descent.SKIP_HEAL * 100}%.` } : STALE;
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
    label: 'Descend build button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${dviews.DBUILD_ID}:`),
    execute: (interaction) => redraw(interaction, async () => {
      const record = await getFarmUser(interaction.user.id);
      return record.descent ? dviews.buildView(interaction.member, record.descent) : dviews.screen(interaction.member, record);
    }),
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
    label: 'Hero button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${HEROCARD_ID}:`),
    execute: (interaction) => redraw(interaction, () => heroScreen(interaction)),
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
      return { souls: "Your hero can't afford that item.", owned: 'You already have that item.', unknown: 'That item is not for sale.' }[result.error];
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
          return { souls: "Your hero can't afford that item, even after selling.", owned: 'You already have that item.', missing: 'You do not have that item to sell.', full: 'Your build is still full.', unknown: 'That item is not for sale.' }[result.error];
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
      const got = {};
      for (const b of result.buffs) got[b] = (got[b] ?? 0) + 1;
      const lines = [titleCase(`The egg hatched: +${fmt(result.souls)} souls${result.buffs.length ? ', and these permanent buffs:' : '.'}`), ...Object.entries(got).map(([k, n]) => buffText(k, n))];
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
    execute(interaction) {
      const run = breakdowns.get(interaction.customId.split(':')[2]);
      if (!run) return interaction.reply({ content: 'That breakdown is gone: the bot restarted since this fight.', flags: MessageFlags.Ephemeral });
      return interaction.reply({ ...damageView(run), flags: MessageFlags.Ephemeral });
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
