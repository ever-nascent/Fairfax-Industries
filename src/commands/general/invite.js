// /invite: a link to add The Shopkeeper to a server (a button under a short embed).
// The link is built by discord.js from the bot's own client ID; the permissions asked for are `PERMISSIONS` below.
const { SlashCommandBuilder, OAuth2Scopes, PermissionFlagsBits: P, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { replyEmbed } = require('../../utils/embeds');

// What the bot needs to work in another server. Edit this list to ask for more or less.
const PERMISSIONS = [
  P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory,
  P.UseExternalEmojis, P.AddReactions, P.ManageMessages, P.ManageRoles, P.ManageChannels,
];

module.exports = {
  data: new SlashCommandBuilder().setName('invite').setDescription('Get a link to add The Shopkeeper to your server'),

  async execute(interaction) {
    const url = interaction.client.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: PERMISSIONS });
    const button = new ButtonBuilder().setLabel('Add The Shopkeeper').setStyle(ButtonStyle.Link).setURL(url);
    return interaction.reply({
      embeds: [replyEmbed('Want me running your shop too? Hit the button and pick a server.')],
      components: [new ActionRowBuilder().addComponents(button)],
    });
  },
  PERMISSIONS,
};
