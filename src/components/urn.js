const { MessageFlags } = require('discord.js');
const { claimUrn } = require('../utils/xp');
const { REJUV_ID, claimedMessage } = require('../commands/xp/urn');

// /urn's Use Rejuv / Start Over buttons: only the member whose streak it is can pick, then the urn is claimed.
async function onPick(interaction) {
  const [, userId, choice] = interaction.customId.split(':');
  if (userId !== interaction.user.id) {
    return interaction.reply({ content: "That's not your urn. Claim yours with `/urn`.", flags: MessageFlags.Ephemeral });
  }
  const result = await claimUrn(userId, new Date(), { rejuv: choice === 'use' });
  if (!result.claimed) return interaction.update({ components: [] }); // already claimed (double click)
  return interaction.update({ ...claimedMessage(interaction.member, result), attachments: [] });
}

module.exports = [
  {
    name: 'urn',
    label: 'Rejuv button',
    matches: (interaction) => interaction.isButton() && interaction.customId.startsWith(`${REJUV_ID}:`),
    execute: onPick,
  },
];
