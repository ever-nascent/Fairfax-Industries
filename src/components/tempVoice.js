// TempVoice panel buttons, pickers and pop-ups (custom ids tv:<action>[:pick|modal], tv:admit|deny:<room>:<user>).
// What each action does: utils/server/tempVoice.js (`act`).
const { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const { replyEmbed } = require('../utils/embeds');
const tv = require('../utils/server/tempVoice');

const USER_ACTIONS = ['trust', 'untrust', 'invite', 'block', 'unblock', 'kick', 'transfer'];
const NOW = ['lock', 'hide', 'waiting', 'thread', 'nsfw', 'claim', 'delete'];
const embed = (text) => ({ embeds: [replyEmbed(text)] });

async function onTv(interaction) {
  const [, action, a, b] = interaction.customId.split(':');
  const { member } = interaction;

  if (action === 'admit' || action === 'deny') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const text = await tv.answerWaiting(interaction, a, b, action === 'admit');
    if (text.startsWith('Let in') || text.startsWith('Turned away')) await interaction.message.delete().catch(() => null);
    return interaction.editReply(embed(text));
  }

  // pop-up answered
  if (interaction.isModalSubmit()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const value = interaction.fields.getTextInputValue('value').trim();
    const input = action === 'name' ? value : action === 'bitrate' ? Number(value) * 1000 : Number(value);
    return interaction.editReply(embed(await tv.act(member, action, input)));
  }
  // a picker answered
  if (a === 'pick') {
    await interaction.deferUpdate();
    const input = action === 'region' ? interaction.values[0] : [...interaction.users.keys()];
    return interaction.editReply({ ...embed(await tv.act(member, action, input)), components: [] });
  }

  // a panel button: say why not before opening a pop-up or picker
  const found = await tv.roomOf(member);
  const refuse = (text) => interaction.reply({ ...embed(text), flags: MessageFlags.Ephemeral });
  if (!found) return refuse('Join your temporary voice channel first.');
  if (action !== 'claim' && found.rec.ownerId !== member.id) return refuse(`Only the owner (<@${found.rec.ownerId}>) can do that.`);

  if (['name', 'limit', 'bitrate'].includes(action)) return interaction.showModal(tv.inputModal(action, found.ch));
  const pick = (menu, text) => interaction.reply({ ...embed(text), components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
  if (USER_ACTIONS.includes(action)) {
    const menu = new UserSelectMenuBuilder().setCustomId(`tv:${action}:pick`).setPlaceholder('Pick Members').setMinValues(1).setMaxValues(action === 'transfer' ? 1 : 10);
    return pick(menu, `Who do you want to ${action}?`);
  }
  if (action === 'region') {
    const menu = new StringSelectMenuBuilder().setCustomId('tv:region:pick').setPlaceholder('Pick A Region')
      .addOptions([{ label: 'Automatic', value: 'auto' }, ...tv.REGIONS.map((r) => ({ label: r, value: r }))]);
    return pick(menu, 'Which region should the channel use?');
  }
  if (NOW.includes(action)) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(embed(await tv.act(member, action)));
  }
}

module.exports = [
  {
    name: 'tempvoice',
    label: 'TempVoice panel',
    matches: (interaction) => typeof interaction.customId === 'string' && interaction.customId.startsWith(`${tv.PANEL_ID}:`),
    execute: onTv,
  },
];
