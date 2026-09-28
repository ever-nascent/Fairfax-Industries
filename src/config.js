// Fairfax Industries bot settings. Secrets (the token) live in .env, not here.
module.exports = {
  // The only server this bot will operate in (overridable with DISCORD_GUILD_ID in .env).
  GUILD_ID: process.env.DISCORD_GUILD_ID || '1553860143639167086',
  // Default embed color. Placeholder (Discord blurple) until we pick the server's colors.
  BRAND_COLOR: 0x5865f2,
  // Green of the level flask. Used for short bot replies (approved per reply, see server-plan.md).
  REPLY_COLOR: 0x6aa98a,
};
