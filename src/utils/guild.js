// The home server (Fairfax) and setup helpers for channels and emojis. The bot serves any server; `isHomeGuild` is for the
// features that are built for Fairfax only (welcome, the audit log, stream alerts, Hideouts ...).
const { ChannelType } = require('discord.js');
const { GUILD_ID } = require('../config');

const isHomeGuild = (guildId) => guildId === GUILD_ID;
const ourGuild = (client) => client.guilds.cache.get(GUILD_ID) ?? null;

// The emoji called `name` in `guild`, else in the home server: the bot's emojis (heroes, :souls: ...) live in Fairfax, and the bot
// can show them in other servers. Undefined if neither has it.
const emojiNamed = (guild, name) => guild?.emojis.cache.find((e) => e.name === name) ?? (guild?.client?.guilds && ourGuild(guild.client))?.emojis.cache.find((e) => e.name === name);

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
  const found = emojiNamed(guild, name);
  if (!found) throw new Error(`no :${name}: emoji in the server`);
  return found;
}

module.exports = { isHomeGuild, ourGuild, emojiNamed, findOrCreateChannel, findEmoji };
