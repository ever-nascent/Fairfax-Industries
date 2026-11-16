// /reaction-roles (Manage Roles): build an emoji -> role menu as a draft, then post it. A slash command. `data` is what Discord shows (name, description, options); `execute` runs when someone uses it.
// Drafts and menus: utils/server/reactionRoles.js.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');
const { replyEmbed, privateReply } = require('../../utils/embeds');
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
  parseEmoji,
  saveMenuRoles,
  saveMenuMode,
  saveMenuUnlock,
  fetchMenuMessage,
  withIntro,
  dropOption,
} = require('../../utils/server/reactionRoles');

const CLEAR = '-'; // typed as a menu's title or description to take it off

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
        .addStringOption((option) => option.setName('title').setDescription('Embed title'))
        .addStringOption((option) =>
          option.setName('description').setDescription('Embed description (shown above the options)'),
        )
        .addStringOption((option) => option.setName('color').setDescription('Hex color like #5865F2'))
        .addRoleOption((option) => option.setName('unlock-role').setDescription('Optional: picking anything on this menu also gives this role (make the menu your server gate)')),
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
        .addRoleOption((option) => option.setName('role').setDescription('Role to remove').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('preview').setDescription('Preview the draft and get a button to post it'))
    .addSubcommand((sub) =>
      sub
        .setName('menu-add')
        .setDescription('Add an option to a menu that is already posted')
        .addStringOption((option) => option.setName('message-id').setDescription('Message ID of the menu').setRequired(true))
        .addStringOption((option) => option.setName('emoji').setDescription('Emoji to react with').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Role to grant').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('menu-remove')
        .setDescription('Remove an option from a menu that is already posted')
        .addStringOption((option) => option.setName('message-id').setDescription('Message ID of the menu').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('Role to remove').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('menu-edit')
        .setDescription('Change the title, text, color or mode of a menu that is already posted')
        .addStringOption((option) => option.setName('message-id').setDescription('Message ID of the menu').setRequired(true))
        .addStringOption((option) => option.setName('title').setDescription(`New title (${CLEAR} removes it)`).setMaxLength(256))
        .addStringOption((option) =>
          option.setName('description').setDescription(`New text above the options (${CLEAR} removes it)`).setMaxLength(1500),
        )
        .addStringOption((option) => option.setName('color').setDescription('New hex color like #5865F2'))
        .addRoleOption((option) => option.setName('unlock-role').setDescription('Picking anything on this menu also gives this role'))
        .addBooleanOption((option) => option.setName('no-unlock-role').setDescription('True = stop giving the unlock role'))
        .addStringOption((option) =>
          option
            .setName('mode')
            .setDescription('Can members pick more than one option?')
            .addChoices(
              { name: 'Multiple (keep every role they react to)', value: 'multi' },
              { name: 'Single (only the most recent reaction keeps a role)', value: 'single' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('menu-change')
        .setDescription("Change an option's emoji or role on a menu that is already posted")
        .addStringOption((option) => option.setName('message-id').setDescription('Message ID of the menu').setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('The option to change, by its current role').setRequired(true))
        .addStringOption((option) => option.setName('new-emoji').setDescription('Emoji to use instead'))
        .addRoleOption((option) => option.setName('new-role').setDescription('Role to give instead')),
    )
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
    const reply = (text) => privateReply(interaction, text);

    if (sub === 'new') {
      const channel = interaction.options.getChannel('channel');
      const color = interaction.options.getString('color');
      if (color && !/^#?[0-9a-f]{6}$/i.test(color)) return reply("That color isn't a hex code. Use 6 digits like `#5865F2`.");
      const unlock = interaction.options.getRole('unlock-role');
      const problem = unlock && roleProblem(unlock, interaction.guild);
      if (problem) return reply(problem);
      await startDraft(guildId, userId, {
        unlockRoleId: unlock?.id,
        title: interaction.options.getString('title'),
        description: interaction.options.getString('description'),
        color: color && (color.startsWith('#') ? color : `#${color}`),
        channelId: channel.id,
        mode: interaction.options.getString('mode'),
      });
      return reply(`Draft started for ${channel}.\nUse \`/reaction-roles add\` to add options,\nthen \`/reaction-roles preview\` when ready.`);
    }

    if (sub === 'add' || sub === 'remove' || sub === 'preview') {
      const draft = await getDraft(guildId, userId);
      if (!draft) return reply('No draft in progress. Start one with `/reaction-roles new`.');

      if (sub === 'add') {
        const emoji = interaction.options.getString('emoji');
        const role = interaction.options.getRole('role');
        const problem = roleProblem(role, interaction.guild);
        if (problem) return reply(problem);
        if (draftIsFull(draft, emoji)) {
          return reply(`A menu can have at most ${MAX_OPTIONS} options (Discord's reaction limit). Start a second menu for the rest.`);
        }
        addPair(draft, emoji, role);
        await saveDraft(guildId, userId, draft);
        return reply(`Added ${emoji} - ${role}.`);
      }

      if (sub === 'remove') {
        const role = interaction.options.getRole('role');
        const removed = removePair(draft, role);
        if (removed) await saveDraft(guildId, userId, draft);
        return reply(removed ? `Removed ${role}.` : `${role} wasn't in the draft.`);
      }

      if (draft.pairs.length === 0) return reply('Please add at least one role before previewing');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rr_post:${userId}`).setLabel('Post').setStyle(ButtonStyle.Success),
      );
      return interaction.reply({ embeds: [buildEmbed(draft)], components: [row], flags: MessageFlags.Ephemeral });
    }

    if (sub.startsWith('menu-')) {
      const messageId = interaction.options.getString('message-id').trim();
      const menu = await getMenu(messageId);
      if (!menu || menu.guildId !== guildId) {
        return reply(`There is no Reaction Role Menu with the ID \`${messageId}\` in this server. \`/reaction-roles list\` shows the IDs.`);
      }
      const role = interaction.options.getRole('role');
      const message = await fetchMenuMessage(interaction.guild, messageId, menu);
      if (!message?.embeds[0]) return reply("I can't find that menu's message (deleted?).");
      const embed = EmbedBuilder.from(message.embeds[0]);
      const text = embed.data.description ?? '';

      if (sub === 'menu-edit') {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('color');
        const mode = interaction.options.getString('mode');
        const unlock = interaction.options.getRole('unlock-role');
        const dropUnlock = interaction.options.getBoolean('no-unlock-role');
        if (!title && !description && !color && !mode && !unlock && !dropUnlock) return reply('Pick at least one thing to change: title, description, color, mode or the unlock role.');
        const problem = unlock && roleProblem(unlock, interaction.guild);
        if (problem) return reply(problem);
        if (color && !/^#?[0-9a-f]{6}$/i.test(color)) return reply("That color isn't a hex code. Use 6 digits like `#5865F2`.");
        if (title) embed.setTitle(title === CLEAR ? null : title);
        if (description) embed.setDescription(withIntro(text, description === CLEAR ? '' : description));
        if (color) embed.setColor(color.startsWith('#') ? color : `#${color}`);
        if (title || description || color) await message.edit({ embeds: [embed] });
        if (mode) await saveMenuMode(messageId, menu, mode);
        if (unlock || dropUnlock) await saveMenuUnlock(messageId, { ...menu, ...(mode ? { mode } : {}) }, unlock ? unlock.id : null);
        const changed = [unlock && `unlock role (now ${unlock})`, dropUnlock && 'unlock role (removed)', title && 'title', description && 'description', color && 'color', mode && `mode (now ${mode === 'single' ? 'Single' : 'Multi'})`];
        return reply(`Updated menu \`${messageId}\`: ${changed.filter(Boolean).join(', ')}.`);
      }

      if (sub === 'menu-change') {
        const newEmoji = interaction.options.getString('new-emoji');
        const newRole = interaction.options.getRole('new-role');
        if (!newEmoji && !newRole) return reply('Give a new emoji, a new role, or both.');
        const key = Object.keys(menu.roles).find((k) => menu.roles[k] === role.id);
        const line = text.split('\n').find((l) => l.includes(`<@&${role.id}>`));
        if (!key || !line) return reply(`${role} isn't on that menu.`);
        if (newRole) {
          const problem = roleProblem(newRole, interaction.guild);
          if (problem) return reply(problem);
          if (Object.values(menu.roles).includes(newRole.id)) return reply(`${newRole} is already on that menu.`);
        }
        const picked = newEmoji && parseEmoji(newEmoji);
        if (picked && picked.key !== key && picked.key in menu.roles) return reply(`${picked.display} is already on that menu.`);
        if (picked && picked.key !== key) {
          try {
            await message.react(interaction.guild.emojis.cache.get(picked.key) ?? picked.key); // first, so a bad emoji changes nothing
          } catch {
            return reply(`I couldn't react with ${picked.display}. Is it a real emoji from this server?`);
          }
        }
        const display = picked?.display ?? line.match(/^> (.*) `-` <@&/)?.[1] ?? key;
        const next = `> ${display} \`-\` <@&${(newRole ?? role).id}>`;
        await message.edit({ embeds: [embed.setDescription(text.replace(line, () => next))] });
        await saveMenuRoles(messageId, menu, Object.fromEntries(Object.entries(menu.roles).map(([k, v]) => (k === key ? [picked?.key ?? k, (newRole ?? role).id] : [k, v]))));
        if (picked && picked.key !== key) await message.reactions.cache.get(key)?.remove().catch(() => {});
        return reply(`Menu \`${messageId}\`: ${next.slice(2).replace('`-`', '-')}\n(Members who already have the old role keep it.)`);
      }

      if (sub === 'menu-add') {
        const problem = roleProblem(role, interaction.guild);
        if (problem) return reply(problem);
        const emoji = interaction.options.getString('emoji');
        const { key, display } = parseEmoji(emoji);
        if (key in menu.roles) return reply(`${display} is already on that menu.`);
        if (Object.keys(menu.roles).length >= MAX_OPTIONS) return reply(`A menu can have at most ${MAX_OPTIONS} options (Discord's reaction limit).`);
        const react = interaction.guild.emojis.cache.get(key) ?? key;
        try {
          await message.react(react); // first, so a bad emoji changes nothing
        } catch {
          return reply(`I couldn't react with ${display}. Is it a real emoji from this server?`);
        }
        await message.edit({ embeds: [embed.setDescription(`${text}\n> ${display} \`-\` ${role}`)] });
        await saveMenuRoles(messageId, menu, { ...menu.roles, [key]: role.id });
        return reply(`Added ${display} - ${role} to menu \`${messageId}\`.`);
      }

      if (!(await dropOption(message, messageId, menu, role.id))) return reply(`${role} isn't on that menu.`);
      return reply(`Removed ${role} from menu \`${messageId}\`.\n(Members who already have the role keep it.)`);
    }

    if (sub === 'delete') {
      const messageId = interaction.options.getString('message-id').trim();
      const menu = await getMenu(messageId);
      if (!menu || menu.guildId !== guildId) {
        return reply(`There is no Reaction Role Menu with the ID \`${messageId}\` in this server. \`/reaction-roles list\` shows the IDs.`);
      }
      await deleteMenu(messageId);
      return reply(`Stopped tracking menu \`${messageId}\`.\n(The message itself is untouched.)`);
    }

    // list
    const menus = await listMenus(guildId);
    if (menus.length === 0) return reply("There are no active Reaction Role Menu's in this server");
    const lines = menus.map(
      ([messageId, menu]) =>
        `\`${messageId}\` in <#${menu.channelId}> — ${menu.mode === 'single' ? 'Single' : 'Multi'}, ${Object.keys(menu.roles).length} Choice(s)`,
    );
    return interaction.reply({ embeds: [replyEmbed(lines.join('\n')).setTitle('Reaction Role Menus')], flags: MessageFlags.Ephemeral });
  },
};
