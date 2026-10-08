const { PermissionFlagsBits } = require('discord.js');
const { isAllowedGuild } = require('../utils/guild');
const { getSettings, addXp, announceLevelUp, chatCounts } = require('../utils/xp');
const { findPhrase, getPhrases } = require('../utils/censor');

// Chat XP: one counted message per cooldown, random XP between min and max (chatCounts has what doesn't count).
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot || !message.guild || !isAllowedGuild(message.guild.id)) return;
    const s = await getSettings(message.guild.id);
    // A message the censor is about to delete earns nothing (staff are exempt from the censor, like there).
    const censored =
      !message.member?.permissions.has(PermissionFlagsBits.ManageMessages) && !!findPhrase(message.content, await getPhrases(message.guild.id));
    if (!chatCounts(message, s, censored)) return;
    const amount = s.minXp + Math.floor(Math.random() * (s.maxXp - s.minXp + 1));
    const result = await addXp(message.author.id, amount, { fromChat: true, cooldownSeconds: s.cooldownSeconds });
    await announceLevelUp(message.guild, message.author.id, result);
  },
};
