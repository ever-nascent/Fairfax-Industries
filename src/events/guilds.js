// The bot joining or leaving a server: written to the console so you can see who invited it. A server's saved progress is kept when the bot leaves, so a re-invite picks up where it stopped.
module.exports = [
  {
    name: 'guildCreate',
    async execute(guild) {
      console.log(`[guilds] Joined "${guild.name}" (${guild.id}), ${guild.memberCount} members`);
    },
  },
  {
    name: 'guildDelete',
    async execute(guild) {
      console.log(`[guilds] Left "${guild.name ?? 'a server'}" (${guild.id})`);
    },
  },
];
