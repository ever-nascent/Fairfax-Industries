const { isAllowedGuild } = require('../utils/guildLock');
const { getSettings, addXp, announceLevelUp } = require('../utils/xp');

// Chat XP: one counted message per cooldown, random XP between min and max.
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot || !message.guild || !isAllowedGuild(message.guild.id)) return;
    const s = await getSettings(message.guild.id);
    const amount = s.minXp + Math.floor(Math.random() * (s.maxXp - s.minXp + 1));
    const result = await addXp(message.author.id, amount, { fromChat: true, cooldownSeconds: s.cooldownSeconds });
    await announceLevelUp(message.guild, message.author.id, result);
  },
};
