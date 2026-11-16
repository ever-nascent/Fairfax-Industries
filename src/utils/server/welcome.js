// Welcome messages: one set of settings per server (/welcome-config, or /setup). Fairfax keeps its own walk-through
// (#welcome -> #rules -> #roles, events/welcome.js) and only uses the on / off switch; every other server gets one message in a
// channel its staff pick, with their own text.
const { getStore } = require('../../storage');
const { isHomeGuild } = require('../guild');

const DEFAULT_TEXT = 'Welcome to **{server}**, {member}!';
const MAX_TEXT = 1000;
const store = () => getStore('welcomeSettings'); // guild id -> { on, channelId, text }

const defaults = (guildId) => ({ on: isHomeGuild(guildId), channelId: null, text: DEFAULT_TEXT, roleId: null }); // roleId: given to every new member, whether or not the message is on
const getWelcome = async (guildId) => ({ ...defaults(guildId), ...(await store().get(guildId)) });
const updateWelcome = (guildId, patch) => store().update(guildId, (saved) => ({ ...defaults(guildId), ...saved, ...patch }));

// {member} is a mention, {server} the server's name, {count} the member count.
const render = (text, member) => text.replaceAll('{member}', `${member}`).replaceAll('{server}', member.guild.name).replaceAll('{count}', `${member.guild.memberCount}`);

module.exports = { DEFAULT_TEXT, MAX_TEXT, getWelcome, updateWelcome, render };
