// What the farm commands (/base, /jungle, /lane, /siege) do when run. The replies are public (his call, Oct 4); only the member who ran
// one can press its buttons. Rules: server-plan.md ("Hero Farming").
const { getFarmUser, play } = require('./play');
const { getUser } = require('../xp');
const { pickView, homeView, heroView, targetView, roamView, notReady } = require('./views');

const start = (interaction) => interaction.deferReply();

// /base: pick a hero (first time), then the base screen with every target and its cooldown.
async function openBase(interaction) {
  await start(interaction);
  const record = await getFarmUser(interaction.user.id);
  return interaction.editReply(record.hero ? await homeView(interaction.member, record) : await pickView(interaction.member));
}

// /hero: the hero screen (level, abilities, stats, items). No hero yet: pick one first.
async function openHero(interaction) {
  await start(interaction);
  const record = await getFarmUser(interaction.user.id);
  if (!record.hero) return interaction.editReply(await pickView(interaction.member));
  return interaction.editReply(await heroView(interaction.member, record, (await getUser(interaction.user.id)).souls));
}

// A target's details screen with Send (a camp, a lane's Guardian or Walker, the Mid-Boss or the siege). No hero yet: pick one first.
async function openTarget(interaction, key, lane) {
  await start(interaction);
  const record = await getFarmUser(interaction.user.id);
  return interaction.editReply(record.hero ? await targetView(interaction.member, key, record, Date.now(), lane) : await pickView(interaction.member));
}

// /jungle roam: goes straight to the result (a roam can't fail, so there is nothing to confirm).
async function runRoam(interaction) {
  await start(interaction);
  const record = await getFarmUser(interaction.user.id);
  if (!record.hero) return interaction.editReply(await pickView(interaction.member));
  const result = await play(interaction.user.id, 'roam');
  if (result.error === 'cooldown') return interaction.editReply({ content: notReady('Roaming', result.left), embeds: [], components: [], files: [] });
  return interaction.editReply(await roamView(result.haul));
}

module.exports = { openBase, openHero, openTarget, runRoam };
