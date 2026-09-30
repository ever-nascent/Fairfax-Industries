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

// The server emoji called `name`. Emojis live in Discord (upload new ones with setup.py *-emojis), so this only
// looks them up; it throws if one is missing, and the caller keeps its plain fallback.
function findEmoji(guild, name) {
  const found = guild.emojis.cache.find((e) => e.name === name);
  if (!found) throw new Error(`no :${name}: emoji in the server`);
  return found;
}

module.exports = { isAllowedGuild, ourGuild, findOrCreateChannel, findEmoji };
