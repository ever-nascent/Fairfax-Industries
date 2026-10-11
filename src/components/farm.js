const { setTimeout: sleep } = require('node:timers/promises');
const { MessageFlags } = require('discord.js');
const { getFarmUser, chooseHero, play, upgradeAbility, buyItem, sellItem, unlockHero, switchHero, corruptItem, setImbue, hatchEgg, fightRival, walkAway, holdOffer } = require('../utils/farm/play');
const { drawbackText } = require('../utils/farm/stats');
const { buffText } = require('../utils/farm/buffs');
const { getUser } = require('../utils/xp');
const { fmt } = require('../utils/format');
const { DUEL_ID, WALK_ID, withRival, duelView, duelResultView, HERO_ID, PICK_ID, TARGET_ID, SEND_ID, BACK_ID, HEROCARD_ID, UPGRADE_ID, ITEM_ID, BUY_ID, SHOPMODE_ID, SELL_ID, SWITCH_ID, SWITCHTO_ID, UNLOCK_ID, IMBUE_ID, IMBUESET_ID, SHOPTAB_ID, CORRUPT_ID, HATCH_ID, titleCase, timeLeft, pickView, homeView, heroView, shopView, targetView, fightView, resultView, legendaryView, tokenView, notReady } = require('../utils/farm/views');

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

// Replays the fight the member just paid for (already settled when they pressed Send), then shows the result.
async function replay(interaction, run) {
  for (const frame of run.frames) {
    await interaction.editReply(fightView(run, frame));
    await sleep(FRAME_MS);
  }
  if (run.rival) run.rival = holdOffer(interaction.user.id, run.rival); // its 5 minutes start now; it is dropped if it was unlocked meanwhile
  await interaction.editReply(resultView(run, interaction.user.id)); // with Fight / Walk Away if a rival showed up
  if (run.legendary) await interaction.followUp({ ...legendaryView(run.legendary.name), flags: MessageFlags.Ephemeral }); // its own message (his call, Oct 2)
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
const pickScreen = async (interaction, selected) => pickView(interaction.member, selected, await getFarmUser(interaction.user.id));

const heroScreen = async (interaction, mode = 'main') => heroView(interaction.member, await getFarmUser(interaction.user.id), (await getUser(interaction.user.id)).souls, mode);
const shopScreen = async (interaction, tab = 'weapon', tier = 1, picked = null) => shopView(interaction.member, await getFarmUser(interaction.user.id), (await getUser(interaction.user.id)).souls, tab, Date.now(), tier, picked);
// 'hero:<mode>' or 'shop:<tab>[:<tier>]' -> that screen
const screen = (interaction, where) => { const [kind, ...rest] = where.split(':'); return kind === 'shop' ? shopScreen(interaction, rest[0], rest[1]) : heroScreen(interaction, rest.join(':') || 'main'); };

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

module.exports = [
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
      return { souls: "You can't afford that item.", owned: 'You already have that item.', full: 'Your build is full (12 items). Sell one first.', changed: 'Your items just changed. Try again.', unknown: 'That item is not for sale.' }[result.error];
    }, `shop:${interaction.customId.split(':').slice(2, 4).join(':')}`), // back on the tab and price it was bought from
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
      if (result.placed) return titleCase(`Your legendary ${result.placed} took the free slot.`);
      return result.ok ? null : result.error === 'legendary' ? titleCase("A legendary can't be sold.") : 'You do not have that item.';
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
      if (result.ok) return titleCase(`Corrupted ${name} for ${fmt(result.paid)} souls. Its drawback: ${drawbackText(result)}.`);
      if (result.error === 'closed') return titleCase(`The Broker is closed. He opens in ${timeLeft(result.opens - Date.now())}.`);
      return { souls: "You can't afford that.", one: titleCase('Your hero already has a corrupted item.'), missing: 'You do not have that item.', unknown: "That item can't be corrupted." }[result.error];
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
      if (result.placed) lines.push(titleCase(`Your legendary ${result.placed} took the free slot.`));
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
    execute: (interaction) => redraw(interaction, () => pickScreen(interaction)),
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
      const problem = { wait: notReady('Switching', result.left ?? 0), locked: 'Unlock that hero first.', same: 'That is already your hero.' }[result.error];
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
        await interaction.editReply({ components: [] });
        return interaction.followUp({ content: result.error === 'owned' ? `You already have ${rival} unlocked.` : 'That rival has already left.', flags: MessageFlags.Ephemeral });
      }
      for (const frame of result.run.frames) {
        await interaction.editReply(await duelView(result.run, frame));
        await sleep(FRAME_MS);
      }
      return interaction.editReply(await duelResultView(result.run));
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
      await interaction.editReply({ components: [] });
      return interaction.followUp({ content: rival ? `You let ${rival} go.` : 'That rival has already left.', flags: MessageFlags.Ephemeral });
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
