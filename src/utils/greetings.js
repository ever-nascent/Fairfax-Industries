const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getStore } = require('../storage');
const { requirePermission } = require('./permissions');
const {
  CLEAR_HINT,
  buildTemplatedEmbed,
  applyClearableOption,
  addEmbedTemplateOptions,
  applyEmbedOptions,
} = require('./embedTemplate');

function configKey(guildId, type) {
  return `${guildId}_${type}`;
}

function defaultText(type) {
  if (type === 'welcome') return 'Welcome {user} to {server}!';
  if (type === 'boost') return 'Thank you {user} for boosting {server}! It now has {boost} boosts. 💜';
  return '{user} has left {server}.';
}

function defaultConfig() {
  return {
    enabled: false,
    channelId: null,
    mode: 'text',
    text: null,
    embed: {
      title: null,
      description: null,
      color: null,
      authorName: null,
      authorIconUrl: null,
      footerText: null,
      footerIconUrl: null,
      thumbnailUrl: null,
      imageUrl: null,
      timestamp: false,
    },
  };
}

function store() {
  return getStore('greetingConfig');
}

async function getConfig(guildId, type) {
  const config = await store().get(configKey(guildId, type));
  return config ?? defaultConfig();
}

async function saveConfig(guildId, type, config) {
  await store().set(configKey(guildId, type), config);
}

function applyPlaceholders(template, member) {
  const guild = member.guild;
  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{tag}', member.user.tag)
    .replaceAll('{server}', guild.name)
    .replaceAll('{guild}', guild.name)
    .replaceAll('{boost}', String(guild.premiumSubscriptionCount ?? 0))
    .replaceAll('{memberCount}', String(guild.memberCount));
}

function buildPayload(config, type, member) {
  if (config.mode !== 'embed') {
    return { content: applyPlaceholders(config.text ?? defaultText(type), member) };
  }

  return {
    embeds: [
      buildTemplatedEmbed(config.embed, {
        apply: (text) => applyPlaceholders(text, member),
        avatarUrl: member.displayAvatarURL({ size: 512 }),
        fallbackDescription: defaultText(type),
      }),
    ],
  };
}

async function replyWithPreview(interaction, type, config, note) {
  const payload = buildPayload(config, type, interaction.member);
  const content = payload.content ? [note, payload.content].filter(Boolean).join('\n\n') : note;
  await interaction.reply({ content, embeds: payload.embeds, flags: MessageFlags.Ephemeral });
}

const PLACEHOLDER_HINT = '{user} {username} {tag} {server} {guild} {boost} {memberCount}';

const LABELS = { welcome: 'welcome', goodbye: 'goodbye', boost: 'boost' };

function buildGreetingCommand(type) {
  const label = LABELS[type] ?? type;

  return new SlashCommandBuilder()
    .setName(type)
    .setDescription(`Configure the ${label} message.`)
    .addSubcommand((sub) => {
      sub
        .setName('config')
        .setDescription(`Configure the ${label} message. Only the options you set are changed.`)
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription(`Channel ${label} messages are sent to`)
            .addChannelTypes(ChannelType.GuildText),
        )
        .addBooleanOption((option) => option.setName('enabled').setDescription('Turn the message on or off'))
        .addStringOption((option) =>
          option
            .setName('mode')
            .setDescription('Plain text or embed')
            .addChoices({ name: 'Embed', value: 'embed' }, { name: 'Plain text', value: 'text' }),
        )
        .addStringOption((option) =>
          option.setName('text').setDescription(`Text message. ${PLACEHOLDER_HINT}. ${CLEAR_HINT}`),
        );
      addEmbedTemplateOptions(sub);
      return sub.addBooleanOption((option) =>
        option.setName('reset-embed').setDescription('Reset all embed customization'),
      );
    })
    .addSubcommand((sub) => sub.setName('preview').setDescription('Preview the current message'));
}

async function executeGreetingCommand(interaction, type) {
  if (!(await requirePermission(interaction, PermissionFlagsBits.ManageGuild))) return;

  const sub = interaction.options.getSubcommand();
  const config = await getConfig(interaction.guildId, type);

  if (sub === 'preview') {
    await replyWithPreview(interaction, type, config, null);
    return;
  }

  const changes = [];

  const channel = interaction.options.getChannel('channel');
  if (channel) {
    config.channelId = channel.id;
    changes.push(`channel set to ${channel}`);
  } else if (!config.channelId) {
    // No channel has ever been set, so default to where the command was run.
    config.channelId = interaction.channelId;
    changes.push(`channel set to <#${interaction.channelId}>`);
  }

  const enabled = interaction.options.getBoolean('enabled');
  if (enabled !== null) {
    config.enabled = enabled;
    changes.push(`${enabled ? 'enabled' : 'disabled'}`);
  }

  const mode = interaction.options.getString('mode');
  if (mode !== null) {
    config.mode = mode;
    changes.push(`mode set to ${mode}`);
  }

  if (applyClearableOption(interaction, 'text', (v) => (config.text = v))) changes.push('text updated');

  changes.push(...applyEmbedOptions(interaction, config.embed, { changePrefix: 'embed ' }));

  const resetEmbed = interaction.options.getBoolean('reset-embed');
  if (resetEmbed) {
    config.embed = defaultConfig().embed;
    changes.push('embed reset');
  }

  if (changes.length === 0) {
    await replyWithPreview(interaction, type, config, 'No changes made.');
    return;
  }

  await saveConfig(interaction.guildId, type, config);
  await replyWithPreview(interaction, type, config, `Updated: ${changes.join(', ')}.`);
}

module.exports = { getConfig, buildPayload, buildGreetingCommand, executeGreetingCommand };
