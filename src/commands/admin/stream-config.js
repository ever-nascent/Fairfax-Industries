const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { requirePermission } = require('../../utils/permissions');
const { replyEmbed } = require('../../utils/embeds');
const { getDescription, setDescription, liveMessage } = require('../../utils/streams');
const { TWITCH_LOGIN, TIKTOK_LOGIN } = require('../../config');

// Made-up streams, so staff can see the alerts with their description without going live.
const SAMPLES = {
  twitch: {
    name: TWITCH_LOGIN,
    title: '(your stream title goes here)',
    url: `https://www.twitch.tv/${TWITCH_LOGIN}`,
    game: 'Deadlock',
    image: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${TWITCH_LOGIN}-1280x720.jpg`,
  },
  tiktok: { name: TIKTOK_LOGIN, title: '(your stream title goes here)', url: `https://www.tiktok.com/@${TIKTOK_LOGIN}/live` },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream-config')
    .setDescription('Staff: manage the Twitch and TikTok go-live alerts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('description').setDescription('Edit the text shown under the stream title (empty = none)')),

  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;
    const modalId = `stream-config:${interaction.id}`;
    const input = new TextInputBuilder()
      .setCustomId('text')
      .setLabel('Description (leave empty for none)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(4000);
    const current = await getDescription();
    if (current) input.setValue(current); // no pre-fill when there's nothing saved yet
    await interaction.showModal(
      new ModalBuilder().setCustomId(modalId).setTitle('Go-Live Alert Description').addComponents(new ActionRowBuilder().addComponents(input)),
    );

    const submit = await interaction.awaitModalSubmit({ filter: (i) => i.customId === modalId, time: 15 * 60_000 }).catch(() => null);
    if (!submit) return; // closed or timed out
    const text = submit.fields.getTextInputValue('text').trim();
    await setDescription(text);
    const previews = Object.entries(SAMPLES).map(([platform, stream]) => liveMessage(platform, stream, text).embeds[0]);
    return submit.reply({
      embeds: [replyEmbed(text ? 'Saved. The next go-live alerts look like this:' : 'Description removed. The next go-live alerts look like this:'), ...previews],
      flags: MessageFlags.Ephemeral,
    });
  },
};
