const { MessageFlags } = require('discord.js');
const { getDraft, clearDraft, buildEmbed, saveMenu } = require('../utils/reactionRoles');
const { replyEmbed } = require('../utils/embeds');

// "Post" button on a reaction-role draft preview: sends the menu embed to the
// draft's target channel, seeds the reactions, and persists the menu.
async function handlePost(interaction) {
  const [, draftUserId] = interaction.customId.split(':');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const draft = getDraft(interaction.guildId, draftUserId);
  if (!draft) {
    await interaction.editReply({
      embeds: [replyEmbed('This draft has expired. Start a new one with `/reaction-roles new`.')],
    });
    return;
  }

  const channel = await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
  if (!channel) {
    await interaction.editReply('The target channel no longer exists.');
    return;
  }

  const message = await channel.send({ embeds: [buildEmbed(draft)] });
  for (const pair of draft.pairs) {
    await message
      .react(pair.display)
      .catch((error) => console.error('[reactionRoles] Failed to react:', error.message));
  }

  await saveMenu(message.id, interaction.guildId, channel.id, draft);
  clearDraft(interaction.guildId, draftUserId);

  await interaction.editReply({ embeds: [replyEmbed(`Posted in ${channel}.`)] });
}

module.exports = [
  {
    name: 'reactionRoles',
    label: 'Post button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith('rr_post:'),
    execute: handlePost,
  },
];
