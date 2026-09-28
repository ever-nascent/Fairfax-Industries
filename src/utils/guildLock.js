const { GUILD_ID } = require('../config');

function isAllowedGuild(guildId) {
  return guildId === GUILD_ID;
}

module.exports = { isAllowedGuild };
