// /quests: today's 3 daily and this week's 2 weekly quests and how far along you are (only you see it). Paid automatically when done.
// The rules and the counting: utils/economy/quests.js (`track` is called where each thing happens).
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { questsEmbed } = require('../../utils/economy/quests');

module.exports = {
  data: new SlashCommandBuilder().setName('quests').setDescription('Your daily and weekly quests (only you see it)'),

  async execute(interaction) {
    return interaction.reply({ embeds: [await questsEmbed(interaction.user.id)], flags: MessageFlags.Ephemeral });
  },
};
