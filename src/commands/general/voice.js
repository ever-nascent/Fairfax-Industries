// /voice: control your temporary voice channel (the same controls as the panel buttons). Logic: utils/server/tempVoice.js.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { replyEmbed } = require('../../utils/embeds');
const tv = require('../../utils/server/tempVoice');

const data = new SlashCommandBuilder().setName('voice').setDescription('Control your temporary voice channel');
const add = (name, description, fn) => data.addSubcommand((s) => { s.setName(name).setDescription(description); fn?.(s); return s; });

add('name', 'Rename your channel', (s) => s.addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(100).setRequired(true)));
add('limit', 'Set how many members can join', (s) => s.addIntegerOption((o) => o.setName('users').setDescription('0 = no limit').setMinValue(0).setMaxValue(99).setRequired(true)));
add('bitrate', 'Set the audio quality', (s) => s.addIntegerOption((o) => o.setName('kbps').setDescription('Bitrate in kbps').setMinValue(8).setMaxValue(384).setRequired(true)));
add('region', 'Set the voice region', (s) => s.addStringOption((o) => o.setName('region').setDescription('Region').setRequired(true).addChoices({ name: 'Automatic', value: 'auto' }, ...tv.REGIONS.map((r) => ({ name: r, value: r })))));
for (const [name, text] of [
  ['lock', 'Lock or unlock your channel'], ['hide', 'Hide or show your channel'], ['waiting-room', 'Add or remove a waiting room'],
  ['thread', 'Start a thread in your channel'], ['nsfw', 'Mark your channel NSFW or not'], ['claim', "Take over a channel whose owner left"], ['delete', 'Delete your channel'],
]) add(name, text);
for (const [name, text] of [
  ['trust', 'Let a member join while it is locked'], ['untrust', 'Take trust away'], ['invite', 'Invite a member'], ['block', 'Block a member from your channel'],
  ['unblock', 'Unblock a member'], ['kick', 'Remove a member from your channel'], ['transfer', 'Give your channel to a member in it'],
]) add(name, text, (s) => s.addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true)));

module.exports = {
  data,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const input = {
      name: () => interaction.options.getString('name'),
      limit: () => interaction.options.getInteger('users'),
      bitrate: () => interaction.options.getInteger('kbps') * 1000,
      region: () => interaction.options.getString('region'),
    }[sub]?.() ?? [interaction.options.getUser('member')?.id].filter(Boolean);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const text = await tv.act(interaction.member, sub === 'waiting-room' ? 'waiting' : sub, input);
    return interaction.editReply({ embeds: [replyEmbed(text)] });
  },
};
