// The one server this bot serves, and setup helpers for its channels.
const { ChannelType } = require('discord.js');
const { GUILD_ID } = require('../config');

// The bot only works in the Fairfax Industries server (events/ready.js leaves any other).
const isAllowedGuild = (guildId) => guildId === GUILD_ID;
const ourGuild = (client) => client.guilds.cache.get(GUILD_ID) ?? null;

// The channel with `savedId`, else the one named `options.name` of `options.type`, else a new one made with
// `options` (as for guild.channels.create). Looks in the channel cache, so fetch the channels first.
async function findOrCreateChannel(guild, options, savedId) {
  const { cache } = guild.channels;
  const found = cache.get(savedId) ?? cache.find((c) => c.type === options.type && c.name === options.name);
  if (found) return found;
  const channel = await guild.channels.create(options);
  console.log(`[setup] Created ${options.type === ChannelType.GuildCategory ? 'category ' : '#'}${options.name}`);
  return channel;
}

// The server emoji called `name`, uploaded from `attachment` (a file path or a PNG buffer) if it's missing.
async function ensureEmoji(guild, name, attachment) {
  const found = guild.emojis.cache.find((e) => e.name === name);
  if (found) return found;
  const emoji = await guild.emojis.create({ attachment, name, reason: 'Used in bot messages' });
  console.log(`[setup] Uploaded the :${name}: emoji`);
  return emoji;
}

module.exports = { isAllowedGuild, ourGuild, findOrCreateChannel, ensureEmoji };
