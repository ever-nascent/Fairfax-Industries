const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { replyEmbed: embed } = require('../../utils/embeds');
const { requirePermission } = require('../../utils/permissions');
const {
  MAX_OPTIONS,
  startDraft,
  getDraft,
  saveDraft,
  roleProblem,
  draftIsFull,
  addPair,
  removePair,
  buildEmbed,
  getMenu,
  deleteMenu,
  listMenus,
} = require('../../utils/reactionRoles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reaction-roles')
    .setDescription('Build reaction role menus.')
    // Hidden from members without Manage Roles (checked again below).
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub
        .setName('new')
        .setDescription('Start a new reaction role menu draft (discards any unfinished draft)')
        .addStringOption((option) => option.setName('title').setDescription('Embed title').setRequired(true))
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to post in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('mode')
            .setDescription('Can members pick more than one option?')
            .setRequired(true)
            .addChoices(
              { name: 'Multiple (keep every role they react to)', value: 'multi' },
              { name: 'Single (only the most recent reaction keeps a role)', value: 'single' },
            ),
        )
        .addStringOption((option) =>
          option.setName('description').setDescription('Embed description (shown above the options)'),
        )
        .addStringOption((option) => option.setName('color').setDescription('Hex color like #5865F2')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add an emoji-to-role option to the current draft')
        .addStringOption((option) => option.setName('emoji').setDescription('Emoji to react with').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Role to grant').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove an option from the current draft')
        .addStringOption((option) => option.setName('emoji').setDescription('Emoji to remove').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('preview').setDescription('Preview the draft and get a button to post it'))
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Stop tracking a posted reaction role menu')
        .addStringOption((option) =>
          option.setName('message-id').setDescription('Message ID of the menu').setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List active reaction role menus')),
  async execute(interaction) {
    if (!(await requirePermission(interaction, PermissionFlagsBits.ManageRoles))) return;

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (sub === 'new') {
      const channel = interaction.options.getChannel('channel');
      const color = interaction.options.getString('color');
      if (color && !/^#?[0-9a-f]{6}$/i.test(color)) {
        await interaction.reply({
          embeds: [embed("That color isn't a hex code. Use 6 digits like `#5865F2`.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await startDraft(guildId, userId, {
        title: interaction.options.getString('title'),
        description: interaction.options.getString('description'),
        color: color && (color.startsWith('#') ? color : `#${color}`),
        channelId: channel.id,
        mode: interaction.options.getString('mode'),
      });
      await interaction.reply({
        embeds: [
          embed(
            `Draft started for ${channel}.\nUse \`/reaction-roles add\` to add options,\nthen \`/reaction-roles preview\` when ready.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add' || sub === 'remove' || sub === 'preview') {
      const draft = await getDraft(guildId, userId);
      if (!draft) {
        await interaction.reply({
          embeds: [embed('No draft in progress. Start one with `/reaction-roles new`.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'add') {
        const emoji = interaction.options.getString('emoji');
        const role = interaction.options.getRole('role');
        const problem = roleProblem(role, interaction.guild);
        if (problem) {
          await interaction.reply({ embeds: [embed(problem)], flags: MessageFlags.Ephemeral });
          return;
        }
        if (draftIsFull(draft, emoji)) {
          await interaction.reply({
            embeds: [embed(`A menu can have at most ${MAX_OPTIONS} options (Discord's reaction limit). Start a second menu for the rest.`)],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        addPair(draft, emoji, role);
        await saveDraft(guildId, userId, draft);
        await interaction.reply({ embeds: [embed(`Added ${emoji} - ${role}.`)], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'remove') {
        const emoji = interaction.options.getString('emoji');
        const removed = removePair(draft, emoji);
        if (removed) await saveDraft(guildId, userId, draft);
        await interaction.reply({
          embeds: [embed(removed ? `Removed ${emoji}.` : `${emoji} wasn't in the draft.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (draft.pairs.length === 0) {
        await interaction.reply({
          embeds: [embed('Add at least one option before previewing.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rr_post:${userId}`).setLabel('Post').setStyle(ButtonStyle.Success),
      );
      await interaction.reply({ embeds: [buildEmbed(draft)], components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'delete') {
      const messageId = interaction.options.getString('message-id').trim();
      const menu = await getMenu(messageId);
      if (!menu || menu.guildId !== guildId) {
        await interaction.reply({
          embeds: [embed(`No menu with message ID \`${messageId}\`. \`/reaction-roles list\` shows the IDs.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await deleteMenu(messageId);
      await interaction.reply({
        embeds: [embed(`Stopped tracking menu \`${messageId}\`.\n(The message itself is untouched.)`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'list') {
      const menus = await listMenus(guildId);
      if (menus.length === 0) {
        await interaction.reply({ embeds: [embed('No active reaction role menus.')], flags: MessageFlags.Ephemeral });
        return;
      }
      const lines = menus.map(
        ([messageId, menu]) =>
          `\`${messageId}\` in <#${menu.channelId}> — ${menu.mode}, ${Object.keys(menu.roles).length} option(s)`,
      );
      await interaction.reply({
        embeds: [embed(lines.join('\n')).setTitle('Reaction Role Menus')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  },
};
