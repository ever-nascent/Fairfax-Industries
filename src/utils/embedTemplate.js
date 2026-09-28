const { EmbedBuilder } = require('discord.js');
const { BRAND_COLOR } = require('../config');

// Shared machinery for the user-customizable embed templates (greeting
// messages, level-up announcements): the stored config shape, the slash
// command options that edit it, and the builder that renders it.

const CLEAR_HINT = "'clear' to reset";

function parseColor(hex, fallback = BRAND_COLOR) {
  if (!hex) return fallback;
  const parsed = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveImageUrl(url, avatarUrl) {
  return url === '{avatar}' ? avatarUrl : url;
}

// Renders an embed-template config ({ title, description, color, authorName,
// … }) into an EmbedBuilder. `apply` runs placeholder substitution on every
// text field; `avatarUrl` resolves the {avatar} image token;
// `fallbackDescription` is used when the template has no description of its own.
function buildTemplatedEmbed(embed, { apply, avatarUrl, fallbackDescription }) {
  const builder = new EmbedBuilder()
    .setDescription(apply(embed.description ?? fallbackDescription))
    .setColor(parseColor(embed.color));

  if (embed.title) builder.setTitle(apply(embed.title));
  if (embed.authorName) {
    builder.setAuthor({ name: apply(embed.authorName), iconURL: embed.authorIconUrl ?? undefined });
  }
  if (embed.footerText) {
    builder.setFooter({ text: apply(embed.footerText), iconURL: embed.footerIconUrl ?? undefined });
  }
  if (embed.thumbnailUrl) builder.setThumbnail(resolveImageUrl(embed.thumbnailUrl, avatarUrl));
  if (embed.imageUrl) builder.setImage(resolveImageUrl(embed.imageUrl, avatarUrl));
  if (embed.timestamp) builder.setTimestamp();

  return builder;
}

// Reads a string option that supports the literal 'clear' to reset the value.
// Returns true when the option was provided (and applied).
function applyClearableOption(interaction, name, applyFn) {
  const value = interaction.options.getString(name);
  if (value === null) return false;
  applyFn(value.toLowerCase() === 'clear' ? null : value);
  return true;
}

// option name -> embed-config key, plus the texts used in option descriptions
// and change summaries.
const EMBED_OPTIONS = [
  { option: 'title', key: 'title', label: 'title', hint: 'Embed title' },
  { option: 'description', key: 'description', label: 'description', hint: 'Embed description' },
  { option: 'color', key: 'color', label: 'color', hint: 'Hex color like #5865F2' },
  { option: 'author', key: 'authorName', label: 'author', hint: 'Embed author name' },
  { option: 'author-icon', key: 'authorIconUrl', label: 'author icon', hint: 'Embed author icon URL' },
  { option: 'footer', key: 'footerText', label: 'footer', hint: 'Embed footer text' },
  { option: 'footer-icon', key: 'footerIconUrl', label: 'footer icon', hint: 'Embed footer icon URL' },
  { option: 'thumbnail', key: 'thumbnailUrl', label: 'thumbnail', hint: 'Embed thumbnail URL, or {avatar}' },
  { option: 'image', key: 'imageUrl', label: 'image', hint: 'Embed image URL, or {avatar}' },
];

// Adds the shared embed-customization options (plus the timestamp toggle) to a
// subcommand builder. `descriptionHint` lists the placeholders the description
// field supports, e.g. '{user} {level}'.
function addEmbedTemplateOptions(sub, { descriptionHint = '' } = {}) {
  for (const { option, hint } of EMBED_OPTIONS) {
    const extra = option === 'description' && descriptionHint ? `${descriptionHint}. ` : '';
    sub.addStringOption((o) => o.setName(option).setDescription(`${hint}. ${extra}${CLEAR_HINT}`));
  }
  sub.addBooleanOption((o) => o.setName('timestamp').setDescription('Show the current time in the embed'));
  return sub;
}

// Applies whichever of the shared embed options were provided onto an
// embed-template config, returning human-readable change descriptions
// ("title updated", …) prefixed with `changePrefix`.
function applyEmbedOptions(interaction, embed, { changePrefix = '' } = {}) {
  const changes = [];
  for (const { option, key, label } of EMBED_OPTIONS) {
    if (applyClearableOption(interaction, option, (v) => (embed[key] = v))) {
      changes.push(`${changePrefix}${label} updated`);
    }
  }

  const timestamp = interaction.options.getBoolean('timestamp');
  if (timestamp !== null) {
    embed.timestamp = timestamp;
    changes.push(`${changePrefix}timestamp ${timestamp ? 'enabled' : 'disabled'}`);
  }

  return changes;
}

module.exports = {
  CLEAR_HINT,
  parseColor,
  buildTemplatedEmbed,
  applyClearableOption,
  addEmbedTemplateOptions,
  applyEmbedOptions,
};
